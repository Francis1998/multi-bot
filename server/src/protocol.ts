export type ProviderName = "simulator";

export type RunStatus = "running" | "succeeded" | "failed";

export interface StartRunRequest {
  prompt: string;
  subagents?: number;
  provider?: ProviderName;
}

export interface RunRecord {
  id: string;
  prompt: string;
  provider: ProviderName;
  subagents: number;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BridgeEvent {
  id: null;
  event: string;
  data: Record<string, unknown>;
}

export interface BridgeResponse {
  id: string;
  result?: Record<string, unknown>;
  error?: {
    message: string;
    type: string;
  };
}

export interface StoredEvent {
  id: number;
  runId: string;
  eventName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const DEFAULT_SUBAGENTS = 5;
const MAX_SUBAGENTS = 8;
const MAX_PROMPT_LENGTH = 4000;

export function normalizeStartRunRequest(body: unknown): Required<StartRunRequest> {
  if (typeof body !== "object" || body === null) {
    throw new Error("request body must be an object");
  }

  const candidate = body as Record<string, unknown>;
  if (typeof candidate.prompt !== "string" || candidate.prompt.trim().length === 0) {
    throw new Error("prompt must be a non-empty string");
  }

  const rawSubagents = candidate.subagents;
  const subagents = typeof rawSubagents === "number" && Number.isInteger(rawSubagents)
    ? Math.max(1, Math.min(rawSubagents, MAX_SUBAGENTS))
    : DEFAULT_SUBAGENTS;

  const provider = candidate.provider === "simulator" || candidate.provider === undefined
    ? "simulator"
    : undefined;
  if (provider === undefined) {
    throw new Error("provider must be simulator");
  }

  return {
    prompt: candidate.prompt.trim().slice(0, MAX_PROMPT_LENGTH),
    subagents,
    provider,
  };
}

export function isBridgeEvent(payload: unknown): payload is BridgeEvent {
  return (
    typeof payload === "object"
    && payload !== null
    && (payload as BridgeEvent).id === null
    && typeof (payload as BridgeEvent).event === "string"
    && typeof (payload as BridgeEvent).data === "object"
    && (payload as BridgeEvent).data !== null
  );
}

export function isBridgeResponse(payload: unknown): payload is BridgeResponse {
  return (
    typeof payload === "object"
    && payload !== null
    && typeof (payload as BridgeResponse).id === "string"
    && ("result" in payload || "error" in payload)
  );
}
