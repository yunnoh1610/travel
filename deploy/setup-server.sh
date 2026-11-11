#!/usr/bin/env bash
# 오라클 무료 서버(Ubuntu 22.04/24.04)에서 실행되는 설치·업데이트 스크립트.
# deploy.ps1 이 자동으로 올려서 실행해요. 여러 번 실행해도 안전해요(처음엔 설치, 그다음부터는 업데이트).
#   사용법: sudo DOMAIN=<주소> bash setup-server.sh <앱 파일이 있는 폴더>
set -euo pipefail

SRC="${1:?앱 파일 폴더를 지정해 주세요}"
DOMAIN="${DOMAIN:?DOMAIN 환경변수가 필요해요}"
APP_DIR=/opt/travel-diary
DATA_DIR=/var/lib/travel-diary
BACKUP_DIR=/var/backups/travel-diary
SVC=travel-diary
APP_PORT=3000

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "sudo로 실행해 주세요"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# ---------- 스왑 (메모리 1GB짜리 무료 서버에서 설치가 멈추지 않도록) ----------
if [ -z "$(swapon --show --noheadings)" ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 2000000 ]; then
  log "스왑 1GB 만들기"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 프로그램 설치 ----------
node_major=0
if command -v node >/dev/null; then node_major="$(node -p 'process.versions.node.split(".")[0]')"; fi
if [ "$node_major" -lt 24 ]; then
  log "Node.js 24 설치"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  log "Caddy 설치 (https 인증서를 자동으로 받아줌)"
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

if ! command -v sqlite3 >/dev/null; then
  log "sqlite3 설치 (백업용)"
  apt-get update -y
  apt-get install -y sqlite3
fi

# ---------- 앱 전용 사용자와 폴더 ----------
id travel >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin travel
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# PC에 있던 데이터를 처음 한 번만 옮김 (서버에 이미 데이터가 있으면 덮어쓰지 않음)
if [ -f "$SRC/data.tar.gz" ]; then
  if [ -f "$DATA_DIR/travel.db" ]; then
    echo "※ 서버에 이미 데이터가 있어서 PC 데이터는 옮기지 않았어요 (덮어쓰기 방지)"
  else
    log "PC 데이터 옮기기"
    tar -xzf "$SRC/data.tar.gz" -C "$DATA_DIR"
  fi
fi
chown -R travel:travel "$DATA_DIR"
chmod 750 "$DATA_DIR"

# ---------- 앱 설치/업데이트 ----------
log "앱 파일 설치"
rm -rf "$APP_DIR/public"
cp "$SRC/server.js" "$SRC/package.json" "$SRC/package-lock.json" "$APP_DIR/"
cp -r "$SRC/public" "$APP_DIR/public"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)

cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Travel diary web app
After=network.target

[Service]
User=travel
Group=travel
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$DATA_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

# ---------- https (Caddy) ----------
log "https 설정: $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 100MB
	}
	reverse_proxy 127.0.0.1:$APP_PORT
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

# ---------- 서버 안쪽 방화벽 (오라클 Ubuntu는 기본으로 80/443을 막아둠) ----------
log "방화벽에서 80, 443 포트 열기"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save >/dev/null 2>&1 || true
fi

# ---------- 매일 자동 백업 (DB는 14일, 사진은 7일치 보관) ----------
cat > /etc/cron.daily/travel-diary-backup <<EOF
#!/bin/sh
set -e
TS=\$(date +%Y%m%d)
sqlite3 $DATA_DIR/travel.db ".backup '$BACKUP_DIR/travel-\$TS.db'"
tar -czf $BACKUP_DIR/uploads-\$TS.tar.gz -C $DATA_DIR uploads
find $BACKUP_DIR -name 'travel-*.db' -mtime +14 -delete
find $BACKUP_DIR -name 'uploads-*.tar.gz' -mtime +7 -delete
EOF
chmod 755 /etc/cron.daily/travel-diary-backup

# ---------- 시작 ----------
log "앱 다시 시작"
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1; then
  echo "✖ 앱이 시작되지 않았어요. 최근 로그:"
  journalctl -u "$SVC" -n 40 --no-pager
  exit 1
fi
echo "✔ 앱 실행 중"

# https 최종 확인은 PC 쪽(deploy.ps1)에서 함. 여기선 Caddy가 살아 있는지만 확인.
if ! systemctl is-active --quiet caddy; then
  echo "✖ Caddy가 실행되지 않았어요. 로그:"
  journalctl -u caddy -n 30 --no-pager
  exit 1
fi
echo "✔ Caddy 실행 중 (https 인증서는 첫 접속 때 자동으로 받아요)"
