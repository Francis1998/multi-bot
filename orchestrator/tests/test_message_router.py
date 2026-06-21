"""Tests for multi-bot message routing invariants."""

from __future__ import annotations

import asyncio

import pytest

from multibot.message_router import LEADER_ID, MessageRouter
from multibot.models import AgentRole, Message, TaskUnit


def test_router_blocks_subagent_to_subagent_route() -> None:
    """SubAgent peers must not be allowed to message each other directly."""

    async def scenario() -> bool:
        """Run the asynchronous routing scenario.

        Returns:
            Whether the forbidden route was accepted.
        """

        router = MessageRouter()
        await router.register_agent("subagent-0", AgentRole.SUBAGENT)
        await router.register_agent("subagent-1", AgentRole.SUBAGENT)
        return await router.route_message(
            Message(
                sender_id="subagent-0",
                recipient_id="subagent-1",
                content="peer question",
                run_id="run-test",
            )
        )

    assert asyncio.run(scenario()) is False


def test_router_allows_leader_to_subagent_route() -> None:
    """Leader-to-SubAgent traffic must remain valid."""

    async def scenario() -> tuple[bool, Message]:
        """Run the asynchronous routing scenario.

        Returns:
            Route result and delivered message.
        """

        router = MessageRouter()
        await router.register_agent(LEADER_ID, AgentRole.LEADER)
        queue = await router.register_agent("subagent-0", AgentRole.SUBAGENT)
        accepted = await router.route_message(
            Message(
                sender_id=LEADER_ID,
                recipient_id="subagent-0",
                content="handle docs",
                run_id="run-test",
            )
        )
        delivered = await queue.get()
        return accepted, delivered

    accepted, delivered = asyncio.run(scenario())
    assert accepted is True
    assert delivered.content == "handle docs"


def test_task_unit_rejects_subagent_dependencies() -> None:
    """SubAgent task units must be independent."""

    with pytest.raises(ValueError, match="independent"):
        TaskUnit(
            task_id="task-1",
            title="Blocked",
            description="This incorrectly depends on another task.",
            assignee_id="subagent-0",
            dependencies=("task-0",),
        )
