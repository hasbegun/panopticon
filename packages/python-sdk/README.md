# panopticon-py

Python SDK for the **Panopticon** AI Agent & MCP Observability Platform.

## Installation

```bash
pip install panopticon-py

# With LangChain support
pip install panopticon-py[langchain]

# With CrewAI support
pip install panopticon-py[crewai]
```

## Quick Start

```python
from panopticon import Panopticon, SpanType

pan = Panopticon(
    endpoint="http://localhost:4400",
    api_key="pan_...",
    project_id="my-project",
)

with pan.start_trace(agent_id="my-agent") as trace:
    with trace.start_span(SpanType.LLM_CALL, "gpt-4o") as span:
        span.set_input({"prompt": "Hello, world!"})
        # ... call your LLM ...
        span.set_output({"response": "Hi there!"})

pan.shutdown()
```

## LangChain Integration

```python
from panopticon import Panopticon
from panopticon.integrations.langchain import PanopticonCallbackHandler

pan = Panopticon(endpoint="...", api_key="...", project_id="...")
handler = PanopticonCallbackHandler(pan, agent_id="my-chain")

chain.invoke({"input": "..."}, config={"callbacks": [handler]})
```

## CrewAI Integration

```python
from panopticon import Panopticon
from panopticon.integrations.crewai import instrument_crew

pan = Panopticon(endpoint="...", api_key="...", project_id="...")
crew = Crew(agents=[...], tasks=[...])
instrumented = instrument_crew(pan, crew, agent_id="my-crew")
result = instrumented.kickoff()
```

## API Reference

### `Panopticon(endpoint, api_key, project_id, batch_size=100, flush_interval=5.0, debug=False)`
Main client. Buffers spans and flushes to the API periodically.

### `Trace`
Groups related spans. Use as context manager or call `.end()`.

### `Span`
A single operation. Supports `.set_input()`, `.set_output()`, `.set_metadata()`, `.set_error()`. Use as context manager or call `.end()`.

### `SpanType`
Enum: `AGENT_STEP`, `LLM_CALL`, `MCP_REQUEST`, `TOOL_CALL`, `RESOURCE_READ`

### `SpanStatus`
Enum: `OK`, `ERROR`, `TIMEOUT`
