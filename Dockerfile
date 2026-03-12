FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- Build stage ----
FROM base AS builder
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN SKIP_ENV_VALIDATION=1 pnpm --dir apps/server build

# ---- Runtime stage ----
FROM base AS runner
WORKDIR /app

# Keep full workspace layout from the builder stage so pnpm symlinks resolve correctly.
COPY --from=builder /app /app

WORKDIR /app/apps/server

EXPOSE 3000

CMD ["node", "dist/index.mjs"]
