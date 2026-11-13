# APK Factory - Backend API
FROM node:20-slim AS builder

WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY backend/ .
# The Prisma client types must exist before compiling (ProjectSourceType, ProjectType, ...)
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends curl git openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# Owner account creation on a private instance: `docker compose exec backend npm run user:create`
COPY --from=builder /app/scripts ./scripts
RUN npx prisma generate

RUN mkdir -p /app/uploads/projects /app/uploads/apks /app/uploads/qr /app/uploads/keystores /app/uploads/tmp

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "dist/main"]
