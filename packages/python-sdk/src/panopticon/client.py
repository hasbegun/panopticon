"""Main Panopticon client — manages traces, buffering, and flushing to the API."""

from __future__ import annotations

import atexit
import logging
import threading
from typing import Optional

import httpx

from panopticon.trace import Trace
from panopticon.types import SpanData

logger = logging.getLogger("panopticon")

DEFAULT_BATCH_SIZE = 100
DEFAULT_FLUSH_INTERVAL = 5.0  # seconds
API_KEY_HEADER = "x-api-key"


class Panopticon:
    """
    Panopticon SDK client.

    Usage::

        pan = Panopticon(
            endpoint="http://localhost:4400",
            api_key="pan_...",
            project_id="my-project",
        )

        with pan.start_trace(agent_id="my-agent") as trace:
            with trace.start_span(SpanType.LLM_CALL, "gpt-4o") as span:
                span.set_input({"prompt": "Hello"})
                result = call_llm(...)
                span.set_output(result)

        pan.shutdown()
    """

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        project_id: str,
        batch_size: int = DEFAULT_BATCH_SIZE,
        flush_interval: float = DEFAULT_FLUSH_INTERVAL,
        debug: bool = False,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._project_id = project_id
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._debug = debug

        self._buffer: list[SpanData] = []
        self._lock = threading.Lock()
        self._active_trace: Optional[Trace] = None
        self._client = httpx.Client(timeout=30.0)

        # Periodic flush timer
        self._timer: Optional[threading.Timer] = None
        self._running = True
        self._schedule_flush()

        # Ensure flush on exit
        atexit.register(self.shutdown)

    def start_trace(self, agent_id: str) -> Trace:
        """Start a new trace."""
        trace = Trace(agent_id=agent_id, on_span_end=self._enqueue_span)
        self._active_trace = trace
        return trace

    @property
    def active_trace(self) -> Optional[Trace]:
        return self._active_trace

    @property
    def pending_spans(self) -> int:
        with self._lock:
            return len(self._buffer)

    def flush(self) -> None:
        """Flush all buffered spans to the API."""
        with self._lock:
            if not self._buffer:
                return
            batch = self._buffer[:]
            self._buffer.clear()

        if self._debug:
            logger.debug("Flushing %d spans", len(batch))

        try:
            response = self._client.post(
                f"{self._endpoint}/v1/traces",
                json={
                    "projectId": self._project_id,
                    "spans": [s.to_dict() for s in batch],
                },
                headers={API_KEY_HEADER: self._api_key},
            )
            response.raise_for_status()
            if self._debug:
                logger.debug("Flushed %d spans successfully", len(batch))
        except Exception as exc:
            # Put spans back for retry
            with self._lock:
                self._buffer = batch + self._buffer
            logger.error("Flush failed: %s", exc)
            raise

    def shutdown(self) -> None:
        """Stop the flush timer and flush remaining spans."""
        self._running = False
        if self._timer:
            self._timer.cancel()
            self._timer = None
        try:
            self.flush()
        except Exception:
            pass
        self._client.close()

    def _enqueue_span(self, span: SpanData) -> None:
        with self._lock:
            self._buffer.append(span)
            should_flush = len(self._buffer) >= self._batch_size

        if should_flush:
            try:
                self.flush()
            except Exception:
                pass

    def _schedule_flush(self) -> None:
        if not self._running:
            return
        self._timer = threading.Timer(self._flush_interval, self._periodic_flush)
        self._timer.daemon = True
        self._timer.start()

    def _periodic_flush(self) -> None:
        try:
            self.flush()
        except Exception:
            pass
        self._schedule_flush()
