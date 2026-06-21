import DatabaseConstructor from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ProviderName, RunRecord, RunStatus, StoredEvent } from "./protocol.js";

interface RunRow {
  id: string;
  prompt: string;
  provider: ProviderName;
  subagents: number;
  status: RunStatus;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  run_id: string;
  event_name: string;
  payload: string;
  created_at: string;
}

export class MultiBotDatabase {
  private readonly database: SqliteDatabase;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseConstructor(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  createRun(run: RunRecord): void {
    this.database
      .prepare(
        `INSERT INTO runs (id, prompt, provider, subagents, status, created_at, updated_at)
         VALUES (@id, @prompt, @provider, @subagents, @status, @createdAt, @updatedAt)`,
      )
      .run(run);
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    this.database
      .prepare("UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, runId);
  }

  listRuns(limit = 50): RunRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as RunRow[];
    return rows.map(mapRunRow);
  }

  insertEvent(runId: string, eventName: string, payload: Record<string, unknown>): void {
    this.database
      .prepare(
        `INSERT INTO events (run_id, event_name, payload, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(runId, eventName, JSON.stringify(payload));
  }

  listEvents(runId: string): StoredEvent[] {
    const rows = this.database
      .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as EventRow[];
    return rows.map(mapEventRow);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        provider TEXT NOT NULL,
        subagents INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );
    `);
  }
}

function mapRunRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    prompt: row.prompt,
    provider: row.provider,
    subagents: row.subagents,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRow(row: EventRow): StoredEvent {
  return {
    id: row.id,
    runId: row.run_id,
    eventName: row.event_name,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}
