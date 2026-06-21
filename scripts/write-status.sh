#!/usr/bin/env bash
set -euo pipefail

workspace="${1:-$PWD}"
status="${2:-waiting}"
message="${3:-Ready for the next instruction}"
progress="${4:-0}"

mkdir -p "${workspace}/.multi-bot"

python3 - "$workspace" "$status" "$message" "$progress" <<'PY'
import json
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
status = sys.argv[2]
message = sys.argv[3]
progress = int(sys.argv[4])

payload = {
    "status": status,
    "progress": progress,
    "message": message,
    "sessionName": workspace.name,
    "icon": "bot",
    "tasks": [],
    "prLink": None,
}

(workspace / ".multi-bot" / "status.json").write_text(json.dumps(payload, indent=2) + "\n")
PY
