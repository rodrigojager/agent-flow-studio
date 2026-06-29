from typing import Any

from pydantic import BaseModel, Field


class IdempotentBody(BaseModel):
    idempotency_key: str | None = Field(default=None, min_length=1)


class CreateSessionRequest(IdempotentBody):
    metadata: dict[str, Any] = Field(default_factory=dict)
    max_turns: int = Field(default=3, ge=1, le=50)
    auto_start: bool = False


class EmptyIdempotentRequest(IdempotentBody):
    pass


class TurnRequest(IdempotentBody):
    user_message: str = Field(..., min_length=1)


class SessionView(BaseModel):
    session_id: str
    status: str
    phase: str
    turn: int
    max_turns: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_complete: bool


class MessageView(BaseModel):
    seq: int
    role: str
    code: str | None = None
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class EventView(BaseModel):
    seq: int
    event_type: str
    node: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AssistantMessageView(BaseModel):
    code: str
    text: str


class SafetyView(BaseModel):
    blocked: bool = False
    decision: str = "allow"
    category: str | None = None
    reason: str | None = None


class CreateSessionResponse(BaseModel):
    session: SessionView
    messages: list[MessageView] = Field(default_factory=list)


class StartResponse(BaseModel):
    session: SessionView
    messages: list[MessageView]


class TurnResponse(BaseModel):
    session: SessionView
    assistant_message: AssistantMessageView
    safety: SafetyView
    can_finish: bool


class FinishResponse(BaseModel):
    session: SessionView
    message: MessageView | None = None


class MetadataResponse(BaseModel):
    service: str
    runtime: str
    contract: str
    llm_adapter: str
    supports_multi_agent_bundle: bool
