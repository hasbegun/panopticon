---
title: Kubernetes / Helm
description: Deploy Panopticon to Kubernetes with Helm
---

# Kubernetes Deployment

Panopticon includes a Helm chart for production Kubernetes deployments.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.x

## Install

```bash
helm install panopticon ./helm/panopticon \
  --namespace panopticon \
  --create-namespace
```

## Configuration

Override values in `values.yaml` or via `--set`:

```bash
helm install panopticon ./helm/panopticon \
  --set api.replicaCount=3 \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=panopticon.example.com
```

### Key Values

| Value | Default | Description |
|-------|---------|-------------|
| `api.replicaCount` | 2 | API server replicas |
| `dashboard.replicaCount` | 1 | Dashboard replicas |
| `worker.replicaCount` | 1 | Worker replicas |
| `ingress.enabled` | false | Enable Ingress |
| `ingress.className` | nginx | Ingress class |
| `postgres.enabled` | true | Deploy PostgreSQL sub-chart |
| `clickhouse.enabled` | true | Deploy ClickHouse sub-chart |
| `redis.enabled` | true | Deploy Redis sub-chart |

## Using External Databases

To use existing infrastructure, disable the sub-charts and provide connection URLs:

```yaml
postgres:
  enabled: false
api:
  env:
    POSTGRES_URL: "postgres://user:pass@my-postgres:5432/panopticon"
    CLICKHOUSE_URL: "http://my-clickhouse:8123"
    REDIS_URL: "redis://my-redis:6379"
```

## Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: panopticon.example.com
      paths:
        - path: /
          service: dashboard
        - path: /v1
          service: api
  tls:
    - secretName: panopticon-tls
      hosts:
        - panopticon.example.com
```
