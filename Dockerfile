# Astro-Backend — Vyotish-Astro backend API
# Local dev parity only (DECISIONS.md D2) — production deploys via `wrangler deploy`.
# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:${BUN_VERSION}-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
EXPOSE 3000
USER bun
CMD ["bun", "src/index.ts"]
