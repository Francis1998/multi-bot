"""JSON-Lines protocol helpers for the Python orchestrator."""

from __future__ import annotations

from typing import Any, NotRequired, TypedDict


class JsonRpcRequest(TypedDict):
    """Request envelope sent by the TypeScript bridge."""

    id: str
    method: str
    params: dict[str, Any]


class JsonRpcResponse(TypedDict):
    """Response envelope returned to the TypeScript bridge."""

    id: str
    result: NotRequired[dict[str, Any]]
    error: NotRequired[dict[str, Any]]


class JsonRpcEvent(TypedDict):
    """Async event envelope emitted by the orchestrator."""

    id: None
    event: str
    data: dict[str, Any]


class StartRunParams(TypedDict):
    """Parameters for a start_run request."""

    prompt: str
    subagents: int
    provider: str


def normalize_start_params(params: dict[str, Any]) -> StartRunParams:
    """Validate and normalize start_run parameters.

    Args:
        params: Untrusted request parameters.

    Returns:
        Normalized start-run parameters.

    Raises:
        ValueError: If required values are missing or invalid.
    """

    prompt = params.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("params.prompt must be a non-empty string")

    raw_subagents = params.get("subagents", 5)
    if not isinstance(raw_subagents, int):
        raise ValueError("params.subagents must be an integer")
    subagents = max(1, min(raw_subagents, 8))

    provider = params.get("provider", "simulator")
    if provider != "simulator":
        raise ValueError("only the simulator provider is available in this public demo")

    return {
        "prompt": prompt.strip()[:4000],
        "subagents": subagents,
        "provider": provider,
    }
