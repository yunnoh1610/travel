<#
  여행 기록 앱을 오라클 서버에 배포(처음 설치 + 이후 업데이트)하는 스크립트.

  사용법 (travel_diary 폴더에서):
    powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -ServerIp 123.45.67.89

  옵션:
    -KeyPath        SSH 개인키 경로 (기본: ~\.ssh\oracle_travel)
    -User           서버 사용자 (Ubuntu 이미지 기본: ubuntu)
    -Domain         내 도메인이 있으면 지정. 없으면 <IP>.sslip.io 무료 주소를 씀
    -CopyLocalData  PC의 data 폴더(계정, 기록, 사진)를 서버로 옮김. 서버에 데이터가 없을 때만 적용됨.
                    옮기기 전에 PC에서 실행 중인 서버(npm start)를 꼭 끄세요.
#>
param(
  [Parameter(Mandatory = $true)][string]$ServerIp,
  [string]$KeyPath = (Join-Path $HOME '.ssh\oracle_travel'),
  [string]$User = 'ubuntu',
  [string]$Domain = '',
  [switch]$CopyLocalData
)
$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`n✖ $msg" -ForegroundColor Red; exit 1 }

if ($ServerIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { Fail "서버 IP 형식이 이상해요: $ServerIp (예: 123.45.67.89)" }
if (-not (Test-Path $KeyPath)) { Fail "SSH 키 파일이 없어요: $KeyPath" }
if (-not $Domain) { $Domain = ($ServerIp -replace '\.', '-') + '.sslip.io' }

$root = Split-Path -Parent $PSScriptRoot
$target = "$User@$ServerIp"
$sshOpts = @('-i', $KeyPath, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')

# ---------- 1. 올릴 파일 묶기 ----------
Step '올릴 파일 묶는 중'
$staging = Join-Path $env:TEMP 'travel-diary-deploy'
$archive = Join-Path $env:TEMP 'travel-diary-deploy.tar.gz'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
Copy-Item (Join-Path $root 'server.js'), (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json') $staging
Copy-Item -Recurse (Join-Path $root 'public') (Join-Path $staging 'public')
# 윈도우 줄바꿈(CRLF)이 섞이면 리눅스에서 스크립트가 깨지므로 LF로 저장
$sh = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'setup-server.sh')) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $staging 'setup-server.sh'), $sh, (New-Object Text.UTF8Encoding $false))

if ($CopyLocalData) {
  $dataDir = Join-Path $root 'data'
  if (-not (Test-Path (Join-Path $dataDir 'travel.db'))) { Fail "옮길 데이터가 없어요: $dataDir" }
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'server\.js' -and (Get-NetTCPConnection -OwningProcess $_.ProcessId -State Listen -ErrorAction SilentlyContinue) }
  if ($running) { Write-Host '※ PC에서 node server.js 가 실행 중이에요. travel_diary 서버라면 먼저 끄고 다시 실행하는 게 안전해요.' -ForegroundColor Yellow }
  Step 'PC 데이터 묶는 중'
  tar -czf (Join-Path $staging 'data.tar.gz') -C $dataDir .
  if ($LASTEXITCODE -ne 0) { Fail '데이터 묶기에 실패했어요' }
}

if (Test-Path $archive) { Remove-Item -Force $archive }
tar -czf $archive -C $staging .
if ($LASTEXITCODE -ne 0) { Fail '파일 묶기에 실패했어요' }

# ---------- 2. 서버로 보내기 ----------
Step "서버($ServerIp)로 보내는 중"
scp @sshOpts $archive "${target}:/tmp/travel-diary-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail "서버에 접속하지 못했어요. IP, SSH 키, 오라클 보안 목록의 22번 포트를 확인해 주세요." }

# ---------- 3. 서버에서 설치/업데이트 ----------
Step '서버에서 설치·업데이트 중 (처음엔 3~5분 걸려요)'
$remote = "set -e; rm -rf /tmp/travel-diary-deploy; mkdir -p /tmp/travel-diary-deploy; " +
  "tar -xzf /tmp/travel-diary-deploy.tar.gz -C /tmp/travel-diary-deploy; " +
  "sudo DOMAIN='$Domain' bash /tmp/travel-diary-deploy/setup-server.sh /tmp/travel-diary-deploy; " +
  "rm -rf /tmp/travel-diary-deploy /tmp/travel-diary-deploy.tar.gz"
ssh @sshOpts $target $remote
if ($LASTEXITCODE -ne 0) { Fail '서버 설치 중 오류가 났어요. 위 로그를 확인해 주세요.' }

Remove-Item -Recurse -Force $staging, $archive -ErrorAction SilentlyContinue

# ---------- 4. 내 PC에서 https 접속 확인 ----------
Step "https://$Domain 접속 확인 (인증서 발급에 1분 정도 걸릴 수 있어요)"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "https://$Domain/healthz"
    if ($r.StatusCode -eq 200) {
      Write-Host "`n✔ 배포 완료!  https://$Domain" -ForegroundColor Green
      exit 0
    }
  } catch { Start-Sleep -Seconds 4 }
}
Fail ("https://$Domain 에 접속되지 않아요. 오라클 콘솔 > 서브넷 > 보안 목록에 " +
  "TCP 80, 443 수신 규칙(소스 0.0.0.0/0)을 추가했는지 확인한 뒤 다시 실행해 주세요.")
