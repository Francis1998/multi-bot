import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { PythonBridge, type BridgeEvent } from "./bridge.js";
import { MultiBotDatabase } from "./database.js";
import { normalizeStartRunRequest, type RunRecord } from "./protocol.js";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const database = new MultiBotDatabase(path.join(rootDir, "server", "data", "multi-bot.db"));
const app = express();

app.use(express.json({ limit: "32kb" }));

const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws" });
const websocketClients = new Set<WebSocket>();

websocketServer.on("connection", (socket) => {
  websocketClients.add(socket);
  socket.send(JSON.stringify({ event: "connected", data: { service: "multi-bot" } }));
  socket.on("close", () => websocketClients.delete(socket));
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "multi-bot" });
});

app.get("/api/runs", (_request, response) => {
  response.json({ runs: database.listRuns() });
});

app.get("/api/runs/:runId/events", (request, response) => {
  response.json({ events: database.listEvents(request.params.runId) });
});

app.post("/api/runs", (request, response) => {
  try {
    const normalizedRequest = normalizeStartRunRequest(request.body);
    const now = new Date().toISOString();
    const runRecord: RunRecord = {
      id: randomUUID(),
      prompt: normalizedRequest.prompt,
      provider: normalizedRequest.provider,
      subagents: normalizedRequest.subagents,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };

    database.createRun(runRecord);
    void executeRun(runRecord, normalizedRequest);
    response.status(202).json({ run: runRecord });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(400).json({ error: message });
  }
});

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";

server.listen(port, host, () => {
  console.log(`multi-bot server listening at http://${host}:${port}`);
});

async function executeRun(runRecord: RunRecord, request: Parameters<PythonBridge["startRun"]>[1]): Promise<void> {
  const bridge = new PythonBridge(rootDir);

  bridge.on("event", (event: BridgeEvent) => {
    if (event.event !== "ready") {
      database.insertEvent(runRecord.id, event.event, event.data);
      broadcast({ ...event, data: { ...event.data, runId: runRecord.id } });
    }
    if (event.event === "run_completed") {
      database.updateRunStatus(runRecord.id, "succeeded");
    }
  });

  bridge.on("log", (line) => {
    if (typeof line === "string" && line.length > 0) {
      broadcast({ event: "bridge_log", data: { runId: runRecord.id, line } });
    }
  });

  try {
    await bridge.startRun(runRecord.id, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    database.updateRunStatus(runRecord.id, "failed");
    database.insertEvent(runRecord.id, "run_failed", { runId: runRecord.id, message });
    broadcast({ event: "run_failed", data: { runId: runRecord.id, message } });
  } finally {
    bridge.stop();
  }
}

function broadcast(payload: unknown): void {
  const serializedPayload = JSON.stringify(payload);
  for (const socket of websocketClients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serializedPayload);
    }
  }
}
