"""LangChain callback handler that sends traces to Panopticon.

Usage::

    from panopticon import Panopticon
    from panopticon.integrations.langchain import PanopticonCallbackHandler

    pan = Panopticon(endpoint="...", api_key="...", project_id="...")
    handler = PanopticonCallbackHandler(pan, agent_id="my-langchain-agent")

    chain.invoke({"input": "..."}, config={"callbacks": [handler]})
"""

from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from panopticon.client import Panopticon
from panopticon.types import SpanType, SpanStatus
from panopticon.span import Span

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:
    raise ImportError(
        "langchain-core is required for the LangChain integration. "
        "Install it with: pip install panopticon-py[langchain]"
    )


class PanopticonCallbackHandler(BaseCallbackHandler):
    """LangChain callback handler that creates Panopticon traces and spans."""

    def __init__(self, client: Panopticon, agent_id: str = "langchain") -> None:
        super().__init__()
        self._client = client
        self._agent_id = agent_id
        self._spans: dict[UUID, Span] = {}

    # ── LLM ────────────────────────────────────────────────────────────────

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        trace = self._client.active_trace
        if trace is None:
            trace = self._client.start_trace(agent_id=self._agent_id)

        model_name = serialized.get("id", ["unknown"])[-1] if serialized.get("id") else "llm"
        parent_id = self._spans[parent_run_id].span_id if parent_run_id and parent_run_id in self._spans else None
        span = trace.start_span(SpanType.LLM_CALL, model_name, parent_span_id=parent_id)
        span.set_input(prompts)
        if kwargs.get("invocation_params"):
            span.set_metadata("model", kwargs["invocation_params"].get("model_name", ""))
        self._spans[run_id] = span

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> None:
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        try:
            text = response.generations[0][0].text if response.generations else str(response)
        except (IndexError, AttributeError):
            text = str(response)
        span.set_output(text)
        if hasattr(response, "llm_output") and response.llm_output:
            token_usage = response.llm_output.get("token_usage", {})
            if token_usage:
                span.set_metadata("prompt_tokens", token_usage.get("prompt_tokens", 0))
                span.set_metadata("completion_tokens", token_usage.get("completion_tokens", 0))
        span.end()

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        span.set_status(SpanStatus.ERROR)
        span.set_metadata("error", str(error))
        span.end()

    # ── Chain ──────────────────────────────────────────────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        trace = self._client.active_trace
        if trace is None:
            trace = self._client.start_trace(agent_id=self._agent_id)

        chain_name = serialized.get("id", ["chain"])[-1] if serialized.get("id") else "chain"
        parent_id = self._spans[parent_run_id].span_id if parent_run_id and parent_run_id in self._spans else None
        span = trace.start_span(SpanType.AGENT_STEP, chain_name, parent_span_id=parent_id)
        span.set_input(inputs)
        self._spans[run_id] = span

    def on_chain_end(self, outputs: dict[str, Any], *, run_id: UUID, **kwargs: Any) -> None:
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        span.set_output(outputs)
        span.end()

    def on_chain_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        span.set_status(SpanStatus.ERROR)
        span.set_metadata("error", str(error))
        span.end()

    # ── Tool ───────────────────────────────────────────────────────────────

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        trace = self._client.active_trace
        if trace is None:
            trace = self._client.start_trace(agent_id=self._agent_id)

        tool_name = serialized.get("name", "tool")
        parent_id = self._spans[parent_run_id].span_id if parent_run_id and parent_run_id in self._spans else None
        span = trace.start_span(SpanType.TOOL_CALL, tool_name, parent_span_id=parent_id)
        span.set_input(input_str)
        self._spans[run_id] = span

    def on_tool_end(self, output: str, *, run_id: UUID, **kwargs: Any) -> None:
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        span.set_output(output)
        span.end()

    def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        span.set_status(SpanStatus.ERROR)
        span.set_metadata("error", str(error))
        span.end()
