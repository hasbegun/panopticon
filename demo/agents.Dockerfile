FROM oven/bun:1.1-slim AS base
WORKDIR /app

# Install workspace dependencies
COPY package.json bun.lockb* turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Build packages/shared → packages/sdk
COPY packages/shared/ ./packages/shared/
COPY packages/sdk/ ./packages/sdk/
RUN cd packages/shared && bun run build
RUN cd packages/sdk && bun run build

# Copy agent scripts
COPY demo/agents/ ./demo/agents/

# Default: run all three agents in sequence
CMD ["bun", "run", "demo/agents/code-review-agent.ts"]
