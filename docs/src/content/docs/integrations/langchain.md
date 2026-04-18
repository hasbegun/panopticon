---
title: LangChain
description: Automatically trace LangChain chains, LLMs, and tools
---

# LangChain Integration

The Panopticon Python SDK includes a LangChain callback handler that automatically creates spans for LLM calls, chain executions, and tool invocations.

## Setup

```bash
pip install panopticon-py[langchain]
```

## Usage

```python
from panopticon import Panopticon
from panopticon.integrations.langchain import PanopticonCallbackHandler

pan = Panopticon(
    endpoint="http://localhost:4400",
    api_key="pan_...",
    project_id="my-project",
)

handler = PanopticonCallbackHandler(pan, agent_id="my-langchain-agent")

# Use with any LangChain chain
chain.invoke(
    {"input": "What is the weather?"},
    config={"callbacks": [handler]},
)
```

## What Gets Traced

| LangChain Event | Panopticon Span Type | Captured Data |
|----------------|---------------------|---------------|
| LLM start/end | `llm_call` | Model name, prompts, response, token usage |
| Chain start/end | `agent_step` | Chain name, inputs, outputs |
| Tool start/end | `tool_call` | Tool name, input, output |

## Token Usage

When available, the handler captures `prompt_tokens` and `completion_tokens` from the LLM response metadata.
