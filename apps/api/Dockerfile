FROM oven/bun:1.1-slim AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — install all workspace dependencies (used by dev overlay too)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json bun.lockb* turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/api/package.json ./apps/api/
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source (needed for dev --watch and for builder)
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

# Build shared types
RUN cd packages/shared && bun run build

# ---------------------------------------------------------------------------
# builder — production build
# ---------------------------------------------------------------------------
FROM deps AS builder
RUN cd apps/api && bun run build

# ---------------------------------------------------------------------------
# runner — minimal production image
# ---------------------------------------------------------------------------
FROM base AS runner
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./

ENV NODE_ENV=production
ENV PORT=4400

EXPOSE 4400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:4400/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "dist/index.js"]
