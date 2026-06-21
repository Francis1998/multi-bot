# multi-bot

`multi-bot` is a mobile-friendly coordinator for running several long-lived coding-agent sessions from one browser UI. It recreates the core product idea from an internal multi-agent workflow: a TypeScript server owns HTTP/WebSocket access, a Python orchestrator decomposes work into Leader/SubAgent execution, and a React client gives engineers phone-friendly visibility into remote runs.

This repository is a public, local-first recreation. It does not include private employer integrations, credentials, internal hostnames, or proprietary agent plugins. The default provider is a deterministic simulator so the architecture can be tested without any external agent runtime installed.

## What It Demonstrates

- **Leader/SubAgent topology**: one Leader coordinates N SubAgents.
- **Strict routing rules**: SubAgents cannot message other SubAgents directly.
- **JSON-Lines IPC**: the TypeScript server talks to Python over stdin/stdout.
- **Process isolation**: each orchestration run is a child process with bounded lifecycle.
- **Mobile-first visibility**: the React UI streams events over WebSocket.
- **Status-hook contract**: workspaces can publish `.multi-bot/status.json` for live UI state.

## Architecture

```text
Browser / phone
  |
  | HTTP + WebSocket
  v
TypeScript server (Express + ws + sqlite)
  |
  | newline-delimited JSON over stdin/stdout
  v
Python orchestrator (multibot)
  |
  +-- Leader agent
  +-- SubAgent 0
  +-- SubAgent 1
  +-- SubAgent N
```

Communication is intentionally asymmetric:

| From | To | Allowed |
| --- | --- | --- |
| User | Leader | Yes |
| User | SubAgent | Yes |
| Leader | SubAgent | Yes |
| SubAgent | Leader | Yes |
| SubAgent | User stream | Yes |
| SubAgent | SubAgent | No |

The no-SubAgent-to-SubAgent rule keeps coordination serial through the Leader. That removes a common multi-agent failure mode: peer agents waiting on each other without a single owner that can reassign or recover work.

## Quickstart

```bash
npm install
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e orchestrator pytest

npm run build
npm test
```

Run the server:

```bash
npm run dev:server
```

In another terminal, run the client:

```bash
npm run dev:client
```

Open the Vite URL and submit a prompt. The server starts a Python orchestration child process, streams JSONL events back to Node, persists them in sqlite, and broadcasts them to the browser.

## API

Start a run:

```bash
curl -X POST http://localhost:8787/api/runs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Audit this repository and split work across agents","subagents":3,"provider":"simulator"}'
```

List recent runs:

```bash
curl http://localhost:8787/api/runs
```

Stream events:

```text
ws://localhost:8787/ws
```

## JSON-Lines Protocol

Request from Node to Python:

```json
{"id":"run-123","method":"start_run","params":{"prompt":"Create a migration plan","subagents":3,"provider":"simulator"}}
```

Events from Python to Node:

```json
{"id":null,"event":"run_started","data":{"runId":"run-123","subagents":3}}
{"id":null,"event":"agent_message","data":{"runId":"run-123","sender":"leader","recipient":"subagent-0","content":"Handle docs and README."}}
{"id":null,"event":"route_blocked","data":{"runId":"run-123","sender":"subagent-0","recipient":"subagent-1","reason":"SubAgent to SubAgent communication is forbidden"}}
{"id":"run-123","result":{"status":"succeeded"}}
```

## Status Hook Contract

Long-running workspaces can expose live status by writing:

```json
{
  "status": "running",
  "progress": 64,
  "message": "SubAgent 2 is drafting tests",
  "sessionName": "repo-audit",
  "icon": "bot",
  "tasks": [
    {"name": "router tests", "status": "done"},
    {"name": "README polish", "status": "running"}
  ],
  "prLink": null
}
```

The expected path is:

```text
<workspace>/.multi-bot/status.json
```

## Reliability Notes

The production version of this product pattern should run under a service manager with explicit memory limits, restart policy, and a persistent SSH agent socket. Example scripts live in `scripts/` as documented starting points; they are not installed automatically.

## Repository Layout

```text
client/        React mobile-friendly UI
server/        Express API, WebSocket fanout, sqlite persistence, Python bridge
orchestrator/  Python package implementing multibot
scripts/       Status hook and service-management examples
```

## Security Model

This demo binds to localhost by default and uses a simulator provider. A production deployment needs authentication, authorization, TLS termination, request auditing, command allowlists, and per-user workspace isolation before exposing remote terminal control beyond a trusted development machine.
