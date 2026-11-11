# 여행 기록 앱 — 배포용 컨테이너
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public

# DB와 사진은 /data 에 저장됨 → 플랫폼에서 이 경로에 영구 볼륨(디스크)을 연결해야 데이터가 안 날아감
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]
