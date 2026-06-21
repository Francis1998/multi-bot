"""Tests for the JSON-Lines orchestration runtime."""

from __future__ import annotations

import asyncio

import pytest

from multibot.orchestrator import build_event, run_simulated_orchestration
from multibot.protocol import JsonRpcEvent, normalize_start_params


def test_normalize_start_params_caps_subagent_count() -> None:
    """The public demo caps SubAgent fanout to a bounded local value."""

    params = normalize_start_params(
        {
            "prompt": "ship the demo",
            "subagents": 99,
            "provider": "simulator",
        }
    )

    assert params["subagents"] == 8


def test_normalize_start_params_rejects_unknown_provider() -> None:
    """Only the deterministic simulator provider is enabled in this repo."""

    with pytest.raises(ValueError, match="simulator"):
        normalize_start_params(
            {
                "prompt": "ship the demo",
                "subagents": 2,
                "provider": "claude",
            }
        )


def test_build_event_uses_async_event_envelope() -> None:
    """Events use the JSON-RPC async envelope expected by the bridge."""

    event = build_event("ready", {"runtime": "test"})

    assert event == {"id": None, "event": "ready", "data": {"runtime": "test"}}


def test_run_simulated_orchestration_emits_route_block() -> None:
    """The simulator should demonstrate the SubAgent route block."""

    emitted_events: list[JsonRpcEvent] = []

    async def scenario() -> dict[str, object]:
        """Run the simulator and capture events.

        Returns:
            Final orchestration result.
        """

        return await run_simulated_orchestration(
            "run-test",
            {"prompt": "build multi-bot", "subagents": 2, "provider": "simulator"},
            emitted_events.append,
        )

    result = asyncio.run(scenario())
    event_names = [event["event"] for event in emitted_events]

    assert result["status"] == "succeeded"
    assert "route_blocked" in event_names
    assert event_names[-1] == "run_completed"
