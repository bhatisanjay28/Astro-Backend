# Astro-Backend — Vyotish-Astro backend API
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

# Run as non-root
USER node

CMD ["node", "src/server.js"]
