import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { delimiter } from "node:path";
import type { BridgeEvent, BridgeResponse, StartRunRequest } from "./protocol.js";
import { isBridgeEvent, isBridgeResponse } from "./protocol.js";

interface PendingRequest {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class PythonBridge extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private readonly pending = new Map<string, PendingRequest>();
  private readyResolver?: () => void;
  private readyRejecter?: (error: Error) => void;

  constructor(
    private readonly rootDir: string,
    private readonly pythonCommand = process.env.PYTHON ?? "python3",
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.process !== undefined) {
      return;
    }

    const orchestratorSource = path.join(this.rootDir, "orchestrator", "src");
    this.process = spawn(this.pythonCommand, ["-m", "multibot"], {
      cwd: this.rootDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: process.env.PYTHONPATH
          ? `${orchestratorSource}${delimiter}${process.env.PYTHONPATH}`
          : orchestratorSource,
      },
    });

    this.process.stdout.on("data", (chunk: Buffer) => this.handleData(chunk.toString("utf8")));
    this.process.stderr.on("data", (chunk: Buffer) => this.emit("log", chunk.toString("utf8").trim()));
    this.process.on("exit", (code, signal) => this.handleExit(code, signal));
    this.process.on("error", (error) => this.readyRejecter?.(error));

    await new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });
  }

  async startRun(runId: string, request: Required<StartRunRequest>): Promise<BridgeResponse> {
    await this.start();
    const processHandle = this.process;
    if (processHandle === undefined) {
      throw new Error("Python bridge is not running");
    }

    const payload = {
      id: runId,
      method: "start_run",
      params: request,
    };

    return await new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(runId);
        reject(new Error(`Python request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(runId, { resolve, reject, timer });
      processHandle.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  stop(): void {
    const processHandle = this.process;
    if (processHandle === undefined) {
      return;
    }

    processHandle.stdin.end();
    setTimeout(() => {
      if (!processHandle.killed) {
        processHandle.kill("SIGTERM");
      }
    }, 1000).unref();
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        continue;
      }

      try {
        this.handleMessage(JSON.parse(trimmedLine) as unknown);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit("log", `Unparseable Python output: ${message}`);
      }
    }
  }

  private handleMessage(payload: unknown): void {
    if (isBridgeEvent(payload)) {
      if (payload.event === "ready") {
        this.readyResolver?.();
      }
      this.emit("event", payload);
      return;
    }

    if (!isBridgeResponse(payload)) {
      this.emit("log", `Ignored unknown bridge payload: ${JSON.stringify(payload)}`);
      return;
    }

    const pendingRequest = this.pending.get(payload.id);
    if (pendingRequest === undefined) {
      return;
    }

    clearTimeout(pendingRequest.timer);
    this.pending.delete(payload.id);

    if (payload.error !== undefined) {
      pendingRequest.reject(new Error(payload.error.message));
      return;
    }

    pendingRequest.resolve(payload);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const error = new Error(`Python bridge exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    this.readyRejecter?.(error);
    for (const [requestId, pendingRequest] of this.pending) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
      this.pending.delete(requestId);
    }
    this.process = undefined;
  }
}

export type { BridgeEvent };
