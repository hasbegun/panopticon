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

# Copy demo script
COPY demo/sdk-example.ts ./demo/sdk-example.ts

CMD ["bun", "run", "demo/sdk-example.ts"]
