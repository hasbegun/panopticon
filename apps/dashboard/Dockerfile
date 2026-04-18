FROM oven/bun:1.1-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — install all workspace dependencies (used by dev overlay too)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json bun.lockb* turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY apps/dashboard/ ./apps/dashboard/

# Build shared types
RUN cd packages/shared && bun run build

# ---------------------------------------------------------------------------
# builder — production build
# ---------------------------------------------------------------------------
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/dashboard && bun run build

# ---------------------------------------------------------------------------
# runner — minimal production image
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000 || exit 1

CMD ["bun", "run", "apps/dashboard/server.js"]
