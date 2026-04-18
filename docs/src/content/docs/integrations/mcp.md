---
title: MCP Servers
description: Trace Model Context Protocol interactions
---

# MCP Server Instrumentation

Panopticon has first-class support for the Model Context Protocol. The TypeScript SDK can wrap any MCP client to automatically create spans for `callTool`, `readResource`, and `getPrompt`.

## TypeScript SDK

```typescript
import { Panopticon } from '@panopticon/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pan = new Panopticon({
  endpoint: 'http://localhost:4400',
  apiKey: 'pan_...',
  projectId: 'my-project',
});

const client = new Client({ name: 'my-app', version: '1.0' });
await client.connect(new StdioClientTransport({ command: 'my-mcp-server' }));

const instrumented = pan.instrumentMCP(client, { serverName: 'my-mcp-server' });

// All MCP calls automatically create spans
const result = await instrumented.callTool({ name: 'search', arguments: { q: 'test' } });
const resource = await instrumented.readResource({ uri: 'file:///path' });
```

## What Gets Captured

| MCP Method | Span Type | Metadata |
|-----------|-----------|----------|
| `callTool` | `tool_call` | Tool name, arguments, result |
| `readResource` | `resource_read` | Resource URI, contents |
| `getPrompt` | `mcp_request` | Prompt name, arguments |

## Server Registry

Panopticon automatically discovers MCP servers from span metadata and maintains a registry in PostgreSQL. View connected servers, their tools, and call statistics in the **Topology** page.
