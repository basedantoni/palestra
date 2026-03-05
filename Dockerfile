FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- Build stage ----
FROM base AS builder
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=server

# ---- Runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app

# tsdown bundles all @src/* packages inline; only external deps (hono, pg, etc.) need node_modules
COPY --from=builder /app/apps/server/dist ./dist

# Migration SQL files (read by drizzle migrator at runtime)
COPY --from=builder /app/packages/db/src/migrations ./migrations

# package.json required so Node treats the ESM output as "type: module"
COPY --from=builder /app/apps/server/package.json ./package.json

# Copy full workspace node_modules (external deps live here)
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/index.js"]
