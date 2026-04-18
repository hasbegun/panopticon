"""Span class — represents a single operation within a trace."""

from __future__ import annotations

import uuid
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from panopticon.types import SpanData, SpanType, SpanStatus


class Span:
    """A single span within a trace. Call .end() when the operation completes."""

    def __init__(
        self,
        trace_id: str,
        agent_id: str,
        span_type: SpanType,
        name: str,
        on_end: Callable[[SpanData], None],
        parent_span_id: Optional[str] = None,
    ) -> None:
        self.span_id = uuid.uuid4().hex[:16]
        self._trace_id = trace_id
        self._agent_id = agent_id
        self._type = span_type
        self._name = name
        self._parent_span_id = parent_span_id
        self._on_end = on_end
        self._status = SpanStatus.OK
        self._start = time.monotonic()
        self._start_time = datetime.now(timezone.utc).isoformat()
        self._end_time: Optional[str] = None
        self._duration_ms: Optional[int] = None
        self._input: Any = None
        self._output: Any = None
        self._metadata: dict[str, Any] = {}
        self._security_flags: list[str] = []
        self._ended = False

    def set_input(self, data: Any) -> Span:
        self._input = data
        return self

    def set_output(self, data: Any) -> Span:
        self._output = data
        return self

    def set_status(self, status: SpanStatus) -> Span:
        self._status = status
        return self

    def set_metadata(self, key: str, value: Any) -> Span:
        self._metadata[key] = value
        return self

    def set_error(self, error: Exception) -> Span:
        self._status = SpanStatus.ERROR
        self._metadata["error"] = str(error)
        self._metadata["error_type"] = type(error).__name__
        return self

    def end(self) -> None:
        if self._ended:
            return
        self._ended = True
        self._end_time = datetime.now(timezone.utc).isoformat()
        self._duration_ms = int((time.monotonic() - self._start) * 1000)

        span_data = SpanData(
            trace_id=self._trace_id,
            span_id=self.span_id,
            parent_span_id=self._parent_span_id,
            agent_id=self._agent_id,
            span_type=self._type,
            name=self._name,
            status=self._status,
            start_time=self._start_time,
            end_time=self._end_time,
            duration_ms=self._duration_ms,
            input=self._input,
            output=self._output,
            metadata=self._metadata,
            security_flags=self._security_flags,
        )
        self._on_end(span_data)

    def __enter__(self) -> Span:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_val is not None:
            self.set_error(exc_val)
        self.end()
