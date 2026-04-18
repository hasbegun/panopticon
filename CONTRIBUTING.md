# Contributing to Panopticon

Thank you for your interest in contributing to Panopticon! This guide will help you get started.

## Development Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ or [Bun](https://bun.sh)
- Python 3.9+ (for the Python SDK)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/panopticon-oss/panopticon.git
cd panopticon

# Copy environment file
cp .env.example .env

# Start infrastructure (ClickHouse, PostgreSQL, Redis)
make dev

# Install dependencies
bun install

# Run API in dev mode
cd apps/api && bun run dev

# Run dashboard in dev mode
cd apps/dashboard && bun run dev
```

## Project Structure

```
panopticon/
├── apps/
│   ├── api/          # Hono API server (Bun)
│   └── dashboard/    # Next.js dashboard
├── packages/
│   ├── sdk/          # TypeScript SDK
│   ├── shared/       # Shared types and constants
│   └── python-sdk/   # Python SDK
├── helm/             # Kubernetes Helm chart
├── docs/             # Starlight documentation site
├── demo/             # Demo environment and seed data
└── docker-compose.yml
```

## Making Changes

### Branch Naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation
- `refactor/description` — Code refactoring

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add batch trace deletion endpoint
fix(dashboard): fix timezone offset in trace waterfall
docs: update Python SDK examples
```

### Code Style

- **TypeScript** — Follow existing patterns, use the project's Prettier config
- **Python** — Follow PEP 8, use ruff for linting
- **Components** — Use Tailwind CSS utility classes, match existing UI patterns

### Testing

```bash
# TypeScript
bun test

# Python SDK
cd packages/python-sdk
pip install -e ".[dev]"
pytest
```

## Pull Request Process

1. Fork the repository and create a branch from `main`
2. Make your changes with clear, focused commits
3. Ensure tests pass and add tests for new functionality
4. Update documentation if needed
5. Open a PR with a clear description of the changes
6. Link any related issues

## Reporting Issues

Use GitHub Issues with the provided templates:
- **Bug Report** — For bugs and unexpected behavior
- **Feature Request** — For new features and enhancements

## Code of Conduct

Be respectful, constructive, and inclusive. We're all here to build something great together.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
