import { useEffect, useMemo, useState, type ReactElement } from "react";

interface RunRecord {
  id: string;
  prompt: string;
  provider: "simulator";
  subagents: number;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
}

interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

const apiBase = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";

export function App(): ReactElement {
  const [prompt, setPrompt] = useState("Create a release plan for a multi-agent coding assistant.");
  const [subagents, setSubagents] = useState(5);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const websocketUrl = useMemo(() => apiBase.replace(/^http/, "ws") + "/ws", []);

  useEffect(() => {
    void refreshRuns();
  }, []);

  useEffect(() => {
    const socket = new WebSocket(websocketUrl);
    socket.onmessage = (messageEvent: MessageEvent<string>) => {
      const parsedEvent = JSON.parse(messageEvent.data) as StreamEvent;
      setEvents((currentEvents) => [parsedEvent, ...currentEvents].slice(0, 80));
      if (parsedEvent.event === "run_completed" || parsedEvent.event === "run_failed") {
        void refreshRuns();
      }
    };
    return () => socket.close();
  }, [websocketUrl]);

  async function refreshRuns(): Promise<void> {
    const response = await fetch(`${apiBase}/api/runs`);
    const payload = (await response.json()) as { runs: RunRecord[] };
    setRuns(payload.runs);
  }

  async function startRun(): Promise<void> {
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, subagents, provider: "simulator" }),
      });
      if (!response.ok) {
        throw new Error(`server returned ${response.status}`);
      }
      await refreshRuns();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">multi-bot</p>
        <h1>Coordinate many coding agents from one mobile-friendly control plane.</h1>
        <p>
          The demo uses a deterministic simulator, but preserves the product topology: Node bridge,
          Python Leader/SubAgent runtime, JSON-Lines IPC, sqlite persistence, and WebSocket streaming.
        </p>
      </section>

      <section className="panel">
        <label htmlFor="prompt">Task</label>
        <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <div className="controls">
          <label htmlFor="subagents">SubAgents</label>
          <input
            id="subagents"
            type="number"
            min={1}
            max={8}
            value={subagents}
            onChange={(event) => setSubagents(Number(event.target.value))}
          />
          <button type="button" disabled={isSubmitting} onClick={() => void startRun()}>
            {isSubmitting ? "Starting..." : "Start run"}
          </button>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Runs</h2>
          <div className="stack">
            {runs.map((run) => (
              <article className="run" key={run.id}>
                <strong>{run.status}</strong>
                <span>{run.subagents} SubAgents</span>
                <p>{run.prompt}</p>
              </article>
            ))}
            {runs.length === 0 ? <p className="muted">No runs yet.</p> : null}
          </div>
        </div>

        <div className="panel">
          <h2>Live stream</h2>
          <div className="stream">
            {events.map((event, index) => (
              <article className="event" key={`${event.event}-${index}`}>
                <strong>{event.event}</strong>
                <pre>{JSON.stringify(event.data, null, 2)}</pre>
              </article>
            ))}
            {events.length === 0 ? <p className="muted">Waiting for WebSocket events.</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
