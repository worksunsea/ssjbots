FROM node:20-alpine

WORKDIR /app

# Deps first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=3000
ENV AUTH_DIR=/app/auth

EXPOSE 3000

CMD ["node", "src/index.js"]
