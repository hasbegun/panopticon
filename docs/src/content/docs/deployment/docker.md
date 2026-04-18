---
title: Docker Compose
description: Deploy Panopticon with Docker Compose
---

# Docker Compose Deployment

The simplest way to run Panopticon.

## Production

```bash
cp .env.example .env
# Edit .env with your settings
make up
```

This starts:
- **API** on port 4400
- **Dashboard** on port 3000
- **ClickHouse** on port 8123
- **PostgreSQL** on port 5432
- **Redis** on port 6379

## Development (with hot reload)

```bash
make dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4400 | API port |
| `POSTGRES_URL` | `postgres://...` | PostgreSQL connection string |
| `CLICKHOUSE_URL` | `http://clickhouse:8123` | ClickHouse HTTP endpoint |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `API_KEY_SALT` | — | Salt for API key hashing |

## Data Persistence

Docker volumes are used for ClickHouse and PostgreSQL data. Data survives container restarts.

To reset all data:

```bash
make down
docker volume rm panopticon_clickhouse-data panopticon_postgres-data
make up
```
