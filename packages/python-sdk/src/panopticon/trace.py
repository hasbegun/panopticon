"""Trace class — groups related spans under a single trace ID."""

from __future__ import annotations

import uuid
from typing import Any, Callable, Optional

from panopticon.span import Span
from panopticon.types import SpanData, SpanType


class Trace:
    """A trace groups related spans. Create spans via start_span() and call end() when done."""

    def __init__(self, agent_id: str, on_span_end: Callable[[SpanData], None]) -> None:
        self.trace_id = uuid.uuid4().hex
        self._agent_id = agent_id
        self._on_span_end = on_span_end
        self._spans: list[Span] = []

    def start_span(
        self,
        span_type: SpanType,
        name: str,
        parent_span_id: Optional[str] = None,
    ) -> Span:
        """Start a new span within this trace."""
        span = Span(
            trace_id=self.trace_id,
            agent_id=self._agent_id,
            span_type=span_type,
            name=name,
            on_end=self._on_span_end,
            parent_span_id=parent_span_id,
        )
        self._spans.append(span)
        return span

    def end(self) -> None:
        """End all unfinished spans in this trace."""
        for span in self._spans:
            span.end()

    def __enter__(self) -> Trace:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.end()
