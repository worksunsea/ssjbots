FROM node:20-alpine

WORKDIR /app

# Baileys transitive deps pull from GitHub, so git + minimal build tools
# must be present before `npm install`.
RUN apk add --no-cache git python3 make g++ libc6-compat

# Deps first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=3000
ENV AUTH_DIR=/app/auth

EXPOSE 3000

CMD ["node", "src/index.js"]
