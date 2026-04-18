"""CrewAI integration that wraps Crew execution with Panopticon tracing.

Usage::

    from panopticon import Panopticon
    from panopticon.integrations.crewai import instrument_crew

    pan = Panopticon(endpoint="...", api_key="...", project_id="...")
    crew = Crew(agents=[...], tasks=[...])
    instrumented_crew = instrument_crew(pan, crew, agent_id="my-crew")
    result = instrumented_crew.kickoff()
"""

from __future__ import annotations

from typing import Any

from panopticon.client import Panopticon
from panopticon.types import SpanType, SpanStatus


def instrument_crew(client: Panopticon, crew: Any, agent_id: str = "crewai") -> Any:
    """
    Wrap a CrewAI Crew instance to automatically create Panopticon traces.

    Returns a proxy that intercepts kickoff() to create a top-level trace
    with spans for each task execution.
    """
    original_kickoff = crew.kickoff

    def instrumented_kickoff(*args: Any, **kwargs: Any) -> Any:
        trace = client.start_trace(agent_id=agent_id)
        crew_span = trace.start_span(SpanType.AGENT_STEP, f"crew:{agent_id}")
        crew_span.set_input({"args": args, "kwargs": kwargs})

        # Wrap individual task execute methods
        _patch_tasks(trace, crew)

        try:
            result = original_kickoff(*args, **kwargs)
            crew_span.set_output(str(result) if result else None)
            crew_span.end()
            return result
        except Exception as exc:
            crew_span.set_status(SpanStatus.ERROR)
            crew_span.set_metadata("error", str(exc))
            crew_span.end()
            raise
        finally:
            trace.end()
            try:
                client.flush()
            except Exception:
                pass

    crew.kickoff = instrumented_kickoff
    return crew


def _patch_tasks(trace: Any, crew: Any) -> None:
    """Patch each task's execute method to create spans."""
    tasks = getattr(crew, "tasks", [])
    for task in tasks:
        if not hasattr(task, "execute"):
            continue

        original_execute = task.execute
        task_name = getattr(task, "description", "task")[:60]
        assigned_agent = getattr(task, "agent", None)
        agent_role = getattr(assigned_agent, "role", "unknown") if assigned_agent else "unknown"

        def make_instrumented_execute(orig: Any, name: str, role: str) -> Any:
            def instrumented_execute(*args: Any, **kwargs: Any) -> Any:
                span = trace.start_span(SpanType.AGENT_STEP, f"task:{name}")
                span.set_metadata("agent_role", role)
                span.set_input({"task": name})

                try:
                    result = orig(*args, **kwargs)
                    span.set_output(str(result) if result else None)
                    span.end()
                    return result
                except Exception as exc:
                    span.set_status(SpanStatus.ERROR)
                    span.set_metadata("error", str(exc))
                    span.end()
                    raise

            return instrumented_execute

        task.execute = make_instrumented_execute(original_execute, task_name, agent_role)
