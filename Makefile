# =============================================================================
# Panopticon — Container-first development
# Prerequisites: Docker with Compose v2
# =============================================================================

COMPOSE       = docker compose
COMPOSE_DEV   = $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
API_CONTAINER = panopticon-api

.PHONY: help build dev up down restart logs \
        migrate test lint typecheck \
        demo demo-sdk demo-reset \
        clean nuke status health

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
build: ## Build all container images
	$(COMPOSE) build

build-api: ## Build only the API image
	$(COMPOSE) build api

build-dashboard: ## Build only the dashboard image
	$(COMPOSE) build dashboard

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
dev: ## Start dev mode (hot-reload via volume mounts)
	$(COMPOSE_DEV) up --build

dev-d: ## Start dev mode (detached)
	$(COMPOSE_DEV) up --build -d

up: ## Start production stack (detached)
	$(COMPOSE) up --build -d

down: ## Stop all services
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE_DEV) restart

logs: ## Tail all logs
	$(COMPOSE_DEV) logs -f

logs-api: ## Tail API logs
	$(COMPOSE_DEV) logs -f api

logs-dashboard: ## Tail dashboard logs
	$(COMPOSE_DEV) logs -f dashboard

logs-worker: ## Tail worker logs
	$(COMPOSE_DEV) logs -f worker

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
migrate: ## Run DB migrations inside API container
	$(COMPOSE_DEV) exec api bun run src/db/migrate.ts

migrate-fresh: ## Drop and recreate (DESTRUCTIVE)
	$(COMPOSE_DEV) exec postgres psql -U panopticon -c "DROP DATABASE IF EXISTS panopticon; CREATE DATABASE panopticon;"
	$(MAKE) migrate

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------
test: ## Run tests inside containers
	$(COMPOSE_DEV) exec api bun test

lint: ## Lint + typecheck inside containers
	$(COMPOSE_DEV) exec api bun run typecheck

typecheck: lint ## Alias for lint

# ---------------------------------------------------------------------------
# Shell access
# ---------------------------------------------------------------------------
shell-api: ## Open shell in API container
	$(COMPOSE_DEV) exec api sh

shell-db: ## Open psql shell
	$(COMPOSE_DEV) exec postgres psql -U panopticon -d panopticon

shell-ch: ## Open clickhouse-client shell
	$(COMPOSE_DEV) exec clickhouse clickhouse-client -d panopticon

shell-redis: ## Open redis-cli
	$(COMPOSE_DEV) exec redis redis-cli

# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
status: ## Show container status
	$(COMPOSE_DEV) ps

health: ## Check health of all services
	@echo "--- Postgres ---"
	@$(COMPOSE_DEV) exec postgres pg_isready -U panopticon 2>/dev/null && echo "OK" || echo "DOWN"
	@echo "--- ClickHouse ---"
	@$(COMPOSE_DEV) exec clickhouse clickhouse-client --query "SELECT 1" 2>/dev/null && echo "OK" || echo "DOWN"
	@echo "--- Redis ---"
	@$(COMPOSE_DEV) exec redis redis-cli ping 2>/dev/null || echo "DOWN"
	@echo "--- API ---"
	@curl -sf http://localhost:4400/health | head -c 200 2>/dev/null && echo "" || echo "DOWN"
	@echo "--- Dashboard ---"
	@curl -sf http://localhost:3000 >/dev/null 2>&1 && echo "OK" || echo "DOWN"

# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------
demo: ## Seed demo data (8 traces, ~50 spans)
	$(COMPOSE_DEV) --profile demo run --rm --build demo

demo-sdk: ## Run SDK usage example (3 traces via @panopticon/sdk)
	$(COMPOSE_DEV) --profile demo run --rm --build demo-sdk

demo-reset: ## Clear all data and re-seed demo
	$(MAKE) migrate-fresh
	$(COMPOSE_DEV) exec postgres psql -U panopticon -d panopticon -c "INSERT INTO projects (id, name, api_key, settings) VALUES ('seed', 'Default Project', 'pan_seed_key_for_dev', '{\"retentionDays\": 30, \"piiRedaction\": false, \"securityClassification\": true}') ON CONFLICT DO NOTHING;"
	$(MAKE) demo

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
clean: ## Stop services and remove volumes
	$(COMPOSE) down -v
	$(COMPOSE_DEV) down -v 2>/dev/null || true

nuke: ## Remove everything (volumes, images, orphans)
	$(COMPOSE) down -v --rmi all --remove-orphans
	$(COMPOSE_DEV) down -v --rmi all --remove-orphans 2>/dev/null || true

.DEFAULT_GOAL := help
