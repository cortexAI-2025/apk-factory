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

# Docker CLI: the worker starts sandboxed build containers through the host socket.
# Installed from Docker's pinned static release instead of an apt repository, so the same
# file works on any Debian/Ubuntu base and does not depend on a per-codename repository.
ARG DOCKER_CLI_VERSION=27.3.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openjdk-17-jdk-headless \
    && curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" -o /tmp/docker.tgz \
    && tar -xzf /tmp/docker.tgz -C /tmp docker/docker \
    && install -m 0755 /tmp/docker/docker /usr/local/bin/docker \
    && rm -rf /tmp/docker /tmp/docker.tgz /var/lib/apt/lists/* \
    && apt-get purge -y curl && apt-get autoremove -y >/dev/null \
    && docker --version && keytool -help >/dev/null && jarsigner -help >/dev/null

WORKDIR /app
COPY worker/package*.json ./
RUN npm install --omit=dev
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
