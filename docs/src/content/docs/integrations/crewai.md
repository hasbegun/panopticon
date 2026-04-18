---
title: CrewAI
description: Trace CrewAI crew executions with Panopticon
---

# CrewAI Integration

Wrap your CrewAI Crew to automatically trace task executions.

## Setup

```bash
pip install panopticon-py[crewai]
```

## Usage

```python
from crewai import Crew, Agent, Task
from panopticon import Panopticon
from panopticon.integrations.crewai import instrument_crew

pan = Panopticon(
    endpoint="http://localhost:4400",
    api_key="pan_...",
    project_id="my-project",
)

crew = Crew(agents=[...], tasks=[...])
instrumented = instrument_crew(pan, crew, agent_id="my-crew")
result = instrumented.kickoff()
```

## What Gets Traced

- **Top-level span** for the entire crew `kickoff()` execution
- **Per-task spans** with agent role metadata
- Errors are captured with full context
- Flush is called automatically after crew completion
