# APK Factory - Build Worker
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY worker/package*.json ./

RUN npm install --omit=dev

# Copy compiled source (build first)
COPY worker/dist ./dist
COPY backend/prisma ./prisma

RUN npx prisma generate

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
