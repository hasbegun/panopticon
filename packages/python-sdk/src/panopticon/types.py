"""Core type definitions mirroring the TypeScript shared package."""

from __future__ import annotations

from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Optional


class SpanType(str, Enum):
    AGENT_STEP = "agent_step"
    LLM_CALL = "llm_call"
    MCP_REQUEST = "mcp_request"
    TOOL_CALL = "tool_call"
    RESOURCE_READ = "resource_read"


class SpanStatus(str, Enum):
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout"


@dataclass
class SpanData:
    """Internal representation of a completed span ready for batching."""

    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    agent_id: str
    span_type: SpanType
    name: str
    status: SpanStatus
    start_time: str
    end_time: Optional[str]
    duration_ms: Optional[int]
    input: Any = None
    output: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)
    security_flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "parentSpanId": self.parent_span_id,
            "agentId": self.agent_id,
            "spanType": self.span_type.value,
            "name": self.name,
            "status": self.status.value,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "durationMs": self.duration_ms,
            "input": self.input,
            "output": self.output,
            "metadata": self.metadata,
            "securityFlags": self.security_flags,
        }
