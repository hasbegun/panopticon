---
title: Introduction
description: What is Panopticon and why you need it
---

# Panopticon

**Panopticon** is an open-source observability platform purpose-built for **AI agents** and the **Model Context Protocol (MCP)**. It provides deep visibility into multi-agent systems, LLM calls, tool invocations, and MCP server interactions.

## Why Panopticon?

Modern AI applications involve chains of LLM calls, tool executions, and MCP server interactions. Understanding what happened—and why—requires specialized observability:

- **Trace every step** — From agent reasoning to LLM calls to tool invocations, every span is captured with full context.
- **Security first** — Automatic detection of prompt injection attempts and PII leakage in real-time.
- **MCP-native** — First-class support for MCP tools, resources, and prompts with server registry and topology visualization.
- **Cost tracking** — Token usage and cost aggregation by agent, model, and time window.
- **Alerting** — Configurable rules for error rates, latency spikes, and security events with webhook/Slack dispatch.

## Architecture

Panopticon is a full-stack TypeScript/Python application:

| Component | Tech | Description |
|-----------|------|-------------|
| **API** | Hono (Bun) | Ingestion, query, and management endpoints |
| **Dashboard** | Next.js | Real-time UI with trace waterfall, topology graph, security dashboard |
| **ClickHouse** | — | High-performance columnar store for spans and audit log |
| **PostgreSQL** | — | Project metadata, alert rules, MCP server registry |
| **Redis** | — | Real-time streaming (Redis Streams) and job queues (BullMQ) |
| **Workers** | BullMQ | Span enrichment, security classification, alert evaluation |

## Getting Started

See the [Quick Start](/guides/quickstart/) guide to get Panopticon running in under 5 minutes.
