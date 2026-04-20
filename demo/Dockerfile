FROM oven/bun:1.1-slim
WORKDIR /demo
COPY demo/seed.ts ./seed.ts
COPY demo/live-agent.ts ./live-agent.ts
COPY demo/agents/ ./agents/
CMD ["bun", "run", "seed.ts"]
