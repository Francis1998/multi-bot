"""Message routing with explicit multi-agent communication rules."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence

from multibot.models import AgentRole, Message

LOGGER = logging.getLogger(__name__)

USER_ID = "user"
LEADER_ID = "leader"


class MessageRouter:
    """Route messages while blocking direct SubAgent-to-SubAgent traffic."""

    def __init__(self, queue_size: int = 128) -> None:
        """Initialize an empty router.

        Args:
            queue_size: Maximum queue size for each registered recipient.
        """

        self._queue_size = queue_size
        self._queues: dict[str, asyncio.Queue[Message]] = {}
        self._agent_roles: dict[str, AgentRole] = {}
        self._transcript: list[Message] = []
        self._event_callbacks: list[asyncio.Queue[Message]] = []
        self._lock = asyncio.Lock()

    async def register_agent(self, agent_id: str, role: AgentRole) -> asyncio.Queue[Message]:
        """Register an agent and return its inbound queue.

        Args:
            agent_id: Agent identifier.
            role: Role assigned to the agent.

        Returns:
            Inbound queue for messages addressed to the agent.
        """

        queue: asyncio.Queue[Message] = asyncio.Queue(maxsize=self._queue_size)
        self._queues[agent_id] = queue
        self._agent_roles[agent_id] = role
        return queue

    def subscribe_events(self, queue_size: int = 256) -> asyncio.Queue[Message]:
        """Subscribe to best-effort routed-message events.

        Args:
            queue_size: Maximum event queue size.

        Returns:
            Queue receiving routed messages.
        """

        queue: asyncio.Queue[Message] = asyncio.Queue(maxsize=queue_size)
        self._event_callbacks.append(queue)
        return queue

    def get_transcript(self) -> Sequence[Message]:
        """Return the routed transcript.

        Returns:
            Ordered message sequence.
        """

        return tuple(self._transcript)

    async def route_message(self, message: Message) -> bool:
        """Route a message if it satisfies communication rules.

        Args:
            message: Message to route.

        Returns:
            True when the message was accepted, otherwise False.
        """

        if not self._validate_route(message):
            return False

        async with self._lock:
            self._transcript.append(message)

        recipient_queue = self._queues.get(message.recipient_id)
        if recipient_queue is not None:
            await recipient_queue.put(message)

        for callback_queue in self._event_callbacks:
            try:
                callback_queue.put_nowait(message)
            except asyncio.QueueFull:
                LOGGER.debug("Dropped event for slow subscriber: %s", message.message_id)

        return True

    def _validate_route(self, message: Message) -> bool:
        """Validate whether a message is allowed to flow.

        Args:
            message: Message to validate.

        Returns:
            True when the route is allowed, otherwise False.
        """

        sender_id = message.sender_id
        recipient_id = message.recipient_id

        if sender_id == USER_ID or recipient_id == USER_ID:
            return True

        if sender_id == LEADER_ID or recipient_id == LEADER_ID:
            return True

        if self._agent_roles.get(sender_id) == AgentRole.LEADER:
            return True

        if self._agent_roles.get(recipient_id) == AgentRole.LEADER:
            return True

        if self._is_sub_agent(sender_id) and self._is_sub_agent(recipient_id):
            LOGGER.warning("Blocked forbidden SubAgent route: %s -> %s", sender_id, recipient_id)
            return False

        return True

    def _is_sub_agent(self, agent_id: str) -> bool:
        """Return whether an agent identifier belongs to a SubAgent.

        Args:
            agent_id: Agent identifier.

        Returns:
            True when the registered role or naming convention marks a SubAgent.
        """

        return self._agent_roles.get(agent_id) == AgentRole.SUBAGENT or agent_id.startswith("subagent-")
