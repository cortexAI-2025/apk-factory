# APK Factory - Backend API
FROM node:20-slim AS builder

WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY backend/ .
RUN npm run build

FROM node:20-slim AS runner

WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

RUN mkdir -p /app/uploads/{projects,apks,qr,keystores,tmp}

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "dist/main"]
