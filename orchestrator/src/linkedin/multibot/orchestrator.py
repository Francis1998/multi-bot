"""Executable JSON-Lines orchestration runtime."""

from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import Callable
from typing import Any

from linkedin.multibot.message_router import LEADER_ID, USER_ID, MessageRouter
from linkedin.multibot.models import AgentRole, Message, TaskUnit
from linkedin.multibot.protocol import JsonRpcEvent, JsonRpcRequest, JsonRpcResponse, normalize_start_params

Emitter = Callable[[JsonRpcEvent], None]


def emit_json_line(payload: dict[str, Any]) -> None:
    """Write one JSON object to stdout as a JSON-Lines frame.

    Args:
        payload: JSON-serializable payload.
    """

    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def build_event(event_name: str, data: dict[str, Any]) -> JsonRpcEvent:
    """Create an async JSON-RPC event envelope.

    Args:
        event_name: Event name consumed by the TypeScript bridge.
        data: Event payload.

    Returns:
        JSON-RPC event envelope.
    """

    return {"id": None, "event": event_name, "data": data}


async def run_simulated_orchestration(run_id: str, params: dict[str, Any], emit: Emitter) -> dict[str, Any]:
    """Run a deterministic Leader/SubAgent orchestration.

    Args:
        run_id: Request identifier supplied by Node.
        params: Raw request parameters.
        emit: Callback used to stream events.

    Returns:
        Final result payload.

    Raises:
        ValueError: If the request parameters are invalid.
    """

    normalized_params = normalize_start_params(params)
    router = MessageRouter()
    await router.register_agent(USER_ID, AgentRole.USER)
    await router.register_agent(LEADER_ID, AgentRole.LEADER)

    subagent_ids = [f"subagent-{index}" for index in range(normalized_params["subagents"])]
    for subagent_id in subagent_ids:
        await router.register_agent(subagent_id, AgentRole.SUBAGENT)

    emit(
        build_event(
            "run_started",
            {
                "runId": run_id,
                "prompt": normalized_params["prompt"],
                "subagents": len(subagent_ids),
                "provider": normalized_params["provider"],
            },
        )
    )

    await _route_and_emit(
        router,
        Message(
            sender_id=USER_ID,
            recipient_id=LEADER_ID,
            content=normalized_params["prompt"],
            run_id=run_id,
            metadata={"phase": "intake"},
        ),
        emit,
    )

    task_units = _build_task_units(normalized_params["prompt"], subagent_ids)
    emit(build_event("leader_plan", {"runId": run_id, "tasks": [task.__dict__ for task in task_units]}))

    for task_unit in task_units:
        await _route_and_emit(
            router,
            Message(
                sender_id=LEADER_ID,
                recipient_id=task_unit.assignee_id,
                content=f"{task_unit.title}: {task_unit.description}",
                run_id=run_id,
                metadata={"phase": "dispatch", "taskId": task_unit.task_id},
            ),
            emit,
        )
        await asyncio.sleep(0.05)
        await _route_and_emit(
            router,
            Message(
                sender_id=task_unit.assignee_id,
                recipient_id=LEADER_ID,
                content=f"Completed {task_unit.title}. Key output is ready for synthesis.",
                run_id=run_id,
                metadata={"phase": "completion", "taskId": task_unit.task_id},
            ),
            emit,
        )

    if len(subagent_ids) > 1:
        forbidden_message = Message(
            sender_id=subagent_ids[0],
            recipient_id=subagent_ids[1],
            content="Can you share your draft directly?",
            run_id=run_id,
            metadata={"phase": "safety-check"},
        )
        routed = await router.route_message(forbidden_message)
        if not routed:
            emit(
                build_event(
                    "route_blocked",
                    {
                        "runId": run_id,
                        "sender": forbidden_message.sender_id,
                        "recipient": forbidden_message.recipient_id,
                        "reason": "SubAgent to SubAgent communication is forbidden",
                    },
                )
            )

    emit(
        build_event(
            "run_completed",
            {
                "runId": run_id,
                "status": "succeeded",
                "messages": len(router.get_transcript()),
            },
        )
    )
    return {"status": "succeeded", "messages": len(router.get_transcript())}


def _build_task_units(prompt: str, subagent_ids: list[str]) -> list[TaskUnit]:
    """Create independent task units for the simulator.

    Args:
        prompt: User request.
        subagent_ids: Available SubAgent identifiers.

    Returns:
        Independent task units.
    """

    task_titles = ["Plan", "Implement", "Verify", "Document", "Package", "Review", "Observe", "Ship"]
    task_units: list[TaskUnit] = []
    for index, subagent_id in enumerate(subagent_ids):
        title = task_titles[index % len(task_titles)]
        task_units.append(
            TaskUnit(
                task_id=f"task-{index}",
                title=title,
                description=f"Handle the {title.lower()} slice for: {prompt}",
                assignee_id=subagent_id,
            )
        )
    return task_units


async def _route_and_emit(router: MessageRouter, message: Message, emit: Emitter) -> bool:
    """Route a message and emit an event when accepted.

    Args:
        router: Message router.
        message: Message to route.
        emit: Event callback.

    Returns:
        True when routing succeeded.
    """

    routed = await router.route_message(message)
    if routed:
        emit(build_event("agent_message", message.to_event_data()))
    return routed


async def handle_request(request: JsonRpcRequest, emit: Emitter) -> JsonRpcResponse:
    """Handle a single JSON-RPC request.

    Args:
        request: Request envelope.
        emit: Event callback.

    Returns:
        Response envelope.
    """

    request_id = request.get("id", "")
    try:
        if request.get("method") != "start_run":
            raise ValueError(f"unknown method: {request.get('method')}")
        result = await run_simulated_orchestration(request_id, request.get("params", {}), emit)
        return {"id": request_id, "result": result}
    except Exception as error:
        return {"id": request_id, "error": {"message": str(error), "type": type(error).__name__}}


def main() -> int:
    """Run the JSON-Lines request loop.

    Returns:
        Process exit code.
    """

    emit_json_line({"id": None, "event": "ready", "data": {"runtime": "linkedin.multibot"}})
    for raw_line in sys.stdin:
        stripped_line = raw_line.strip()
        if not stripped_line:
            continue
        try:
            request = json.loads(stripped_line)
        except json.JSONDecodeError as error:
            emit_json_line({"id": "", "error": {"message": str(error), "type": type(error).__name__}})
            continue
        response = asyncio.run(handle_request(request, emit_json_line))
        emit_json_line(response)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
