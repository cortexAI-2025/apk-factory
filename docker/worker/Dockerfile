# APK Factory - Build Worker
FROM node:20-slim AS builder

WORKDIR /app
COPY worker/package*.json ./
RUN npm install
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY worker/ .
RUN npm run build

FROM node:20-slim AS runner

# Docker CLI: the worker spawns sandboxed build containers via the host socket
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/package*.json ./
RUN npm install --omit=dev
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
