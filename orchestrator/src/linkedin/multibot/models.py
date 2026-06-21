"""Core data models for multi-bot orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4


class AgentRole(str, Enum):
    """Role assigned to an agent in a multi-bot run."""

    USER = "user"
    LEADER = "leader"
    SUBAGENT = "subagent"


@dataclass(frozen=True)
class Message:
    """Message routed between user, leader, and subagents.

    Attributes:
        sender_id: Agent identifier that emitted the message.
        recipient_id: Agent identifier that should receive the message.
        content: Human-readable message content.
        run_id: Identifier for the orchestration run.
        message_id: Unique message identifier.
        created_at: UTC ISO timestamp.
        metadata: Optional structured metadata.
    """

    sender_id: str
    recipient_id: str
    content: str
    run_id: str
    message_id: str = field(default_factory=lambda: str(uuid4()))
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_event_data(self) -> dict[str, Any]:
        """Convert the message into JSON-serializable event data.

        Returns:
            A dictionary suitable for JSON-Lines output.
        """

        return {
            "messageId": self.message_id,
            "runId": self.run_id,
            "sender": self.sender_id,
            "recipient": self.recipient_id,
            "content": self.content,
            "createdAt": self.created_at,
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class TaskUnit:
    """Independent unit of work assigned by the Leader.

    SubAgent work is deliberately dependency-free. Ordered work should be
    represented as separate phases instead of peer dependencies.

    Attributes:
        task_id: Unique task identifier.
        title: Short task title.
        description: Detailed task instructions.
        assignee_id: Agent identifier assigned to execute the task.
        dependencies: Task identifiers that must complete first.
    """

    task_id: str
    title: str
    description: str
    assignee_id: str
    dependencies: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        """Reject SubAgent tasks that declare peer dependencies.

        Raises:
            ValueError: If a SubAgent task contains dependencies.
        """

        if self.assignee_id.startswith("subagent-") and self.dependencies:
            raise ValueError("SubAgent tasks must be independent; serialize ordered work as phases.")
