---
title: Python SDK
description: Instrument your Python agents with Panopticon
---

# Python SDK

## Installation

```bash
pip install panopticon-py

# With framework integrations
pip install panopticon-py[langchain]
pip install panopticon-py[crewai]
```

## Basic Usage

```python
from panopticon import Panopticon, SpanType

pan = Panopticon(
    endpoint="http://localhost:4400",
    api_key="pan_...",
    project_id="my-project",
)

# Context manager style
with pan.start_trace(agent_id="my-agent") as trace:
    with trace.start_span(SpanType.LLM_CALL, "gpt-4o") as span:
        span.set_input({"prompt": "Hello"})
        result = call_llm(...)
        span.set_output(result)

pan.shutdown()
```

## Span Types

```python
class SpanType(str, Enum):
    AGENT_STEP = "agent_step"
    LLM_CALL = "llm_call"
    MCP_REQUEST = "mcp_request"
    TOOL_CALL = "tool_call"
    RESOURCE_READ = "resource_read"
```

## Error Handling

```python
with trace.start_span(SpanType.TOOL_CALL, "risky-tool") as span:
    try:
        result = risky_operation()
        span.set_output(result)
    except Exception as e:
        span.set_error(e)  # sets status=ERROR and records error details
        raise
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `endpoint` | — | Panopticon API URL |
| `api_key` | — | Project API key |
| `project_id` | — | Project identifier |
| `batch_size` | 100 | Spans buffered before auto-flush |
| `flush_interval` | 5.0 | Seconds between periodic flushes |
| `debug` | False | Enable debug logging |
