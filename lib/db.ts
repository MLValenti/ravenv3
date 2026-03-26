import fs from "node:fs";
import path from "node:path";

import initSqlJs from "sql.js";

import type { Database, SqlJsStatic } from "sql.js";

import type { ProfileState } from "./profile";
import type { StructuredRollingSummary } from "./chat/conversation-state.ts";
import { normalizeStructuredRollingSummary } from "./chat/conversation-state.ts";

export type ChatHistoryRow = {
  id: number;
  session_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type LongTermMemoryRow = {
  id: string;
  key: string;
  value: string;
  type: MemoryType;
  tags: string[];
  importance: number;
  stability: number;
  confidence: number;
  is_active: boolean;
  is_pinned: boolean;
  reinforcement_count: number;
  last_recalled_at: string | null;
  created_at: string;
  updated_at: string;
  source_turn_id: string | null;
  source_session_id: string | null;
};

export type SessionSummaryRow = {
  session_id: string;
  summary: string;
  summary_json: string | null;
  structured_summary: StructuredRollingSummary | null;
  created_at: string;
  updated_at: string;
  turn_count: number;
};

export type CustomItemRow = {
  id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export type CustomItemRefRow = {
  id: string;
  item_id: string;
  image_data_url: string;
  embedding: number[];
  created_at: string;
};

export type MemorySuggestionRow = {
  id: string;
  key: string;
  value: string;
  type: MemoryType;
  tags: string[];
  importance: number;
  stability: number;
  confidence: number;
  suggestion_kind: "new" | "update";
  created_at: string;
  decided_at: string | null;
  user_feedback: string | null;
  source_turn_id: string | null;
  source_session_id: string | null;
  status: MemorySuggestionStatus;
};

export type MemoryType = "preference" | "goal" | "constraint" | "setup" | "habit" | "misc";

export type MemorySuggestionStatus = "pending" | "approved" | "rejected";

export type MemoryPreferencesRow = {
  auto_save: boolean;
  auto_save_goals: boolean;
  auto_save_constraints: boolean;
  auto_save_preferences: boolean;
  suggestion_snooze_until: string | null;
};

export type RelationshipStateRow = {
  trust_score: number;
  rapport_score: number;
  reliability_score: number;
  relationship_label: string;
  last_updated_ts: number;
};

export type RuntimeStateRow = {
  emergency_stop: boolean;
  emergency_stop_reason: string | null;
  emergency_stop_updated_at: string;
};

export type TaskStatus = "active" | "completed" | "failed" | "expired" | "cancelled";

export type TaskEvidenceType = "camera" | "manual" | "mixed";
export type TaskEvidenceRecordType = "camera" | "manual" | "file_upload";

export type TaskCreatedBy = "raven" | "user";
export type TaskScheduleType = "one_time" | "daily";
export type TaskProgramKind = "task" | "habit" | "rule" | "challenge";
export type TaskStrictnessMode = "standard" | "soft" | "hard";
export type TaskPlanApprovalStatus = "pending" | "approved" | "auto_approved" | "rejected";

export type TaskPlanSelection = {
  catalog_id: string;
  params: Record<string, unknown>;
  approval_status: TaskPlanApprovalStatus;
  updated_at: string;
};

export type TaskCameraCheck = {
  capability: string;
  required_duration_ms?: number;
  confidence_threshold?: number;
  params?: Record<string, unknown>;
};

export type TaskEvidencePolicy = {
  required: boolean;
  type: TaskEvidenceType;
  camera_plan: TaskCameraCheck[];
  max_attempts: number;
  deny_user_override: boolean;
};

export type TaskSchedulePolicy = {
  type: TaskScheduleType;
  window_seconds: number;
  per_repeat_timeout_seconds: number | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  occurrences_per_day: number;
  allow_make_up: boolean;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  due_at: string;
  repeats_required: number;
  repeats_completed: number;
  points_awarded: number;
  points_possible: number;
  status: TaskStatus;
  evidence_policy: TaskEvidencePolicy;
  schedule_policy: TaskSchedulePolicy;
  reward_plan: TaskPlanSelection | null;
  consequence_plan: TaskPlanSelection | null;
  program_kind: TaskProgramKind;
  strictness_mode: TaskStrictnessMode;
  session_id: string | null;
  turn_id: string | null;
  created_by: TaskCreatedBy;
};

export type TaskEvidenceEventStatus =
  | "pass"
  | "pass_manual"
  | "fail"
  | "timeout"
  | "inconclusive"
  | "blocked";

export type TaskEvidenceEventRow = {
  id: string;
  task_id: string;
  occurrence_id: string | null;
  repeat_index: number;
  attempt_index: number;
  evidence_type: TaskEvidenceRecordType;
  status: TaskEvidenceEventStatus;
  summary: string;
  confidence: number;
  raw: Record<string, unknown>;
  created_at: string;
};

export type TaskOccurrenceStatus = "pending" | "completed" | "missed" | "verified_failed";

export type TaskOccurrenceReviewState = "not_required" | "pending_review" | "approved" | "rejected";

export type TaskOccurrenceRow = {
  id: string;
  task_id: string;
  occurrence_index: number;
  scheduled_date: string;
  deadline_at: string;
  status: TaskOccurrenceStatus;
  review_state: TaskOccurrenceReviewState;
  reviewed_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type TaskOutcomeType = "reward_applied" | "consequence_applied" | "info";

export type TaskOutcomeEventRow = {
  id: string;
  task_id: string;
  outcome_type: TaskOutcomeType;
  catalog_id: string | null;
  summary: string;
  params: Record<string, unknown>;
  created_at: string;
};

export type TaskPreferencesRow = {
  require_reward_consequence_approval: boolean;
};

export type ProfileProgressTier = "bronze" | "silver" | "gold" | "platinum";

export type ProfileProgressRow = {
  total_points: number;
  current_tier: ProfileProgressTier;
  free_pass_count: number;
  streak_days: number;
  last_task_completed_at: string | null;
  last_completion_summary: string | null;
  updated_at: string;
};

const DB_FILE = process.env.RAVEN_DB_FILE
  ? path.resolve(process.cwd(), process.env.RAVEN_DB_FILE)
  : path.join(process.cwd(), "raven-memory.sqlite");

let sqlitePromise: Promise<SqlJsStatic> | null = null;
let databasePromise: Promise<Database> | null = null;
let writeChain = Promise.resolve();

function getSqlite() {
  if (!sqlitePromise) {
    sqlitePromise = initSqlJs({
      locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    });
  }

  return sqlitePromise;
}

function getTableColumns(db: Database, tableName: string): Set<string> {
  const result = db.exec(`PRAGMA table_info(${tableName})`);
  if (!result.length) {
    return new Set();
  }
  const columns = new Set<string>();
  for (const row of result[0].values) {
    columns.add(getTextValue(row[1]));
  }
  return columns;
}

function ensureColumn(db: Database, tableName: string, columnName: string, definition: string) {
  const columns = getTableColumns(db, tableName);
  if (columns.has(columnName)) {
    return;
  }
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

async function loadDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const SQL = await getSqlite();
      const db = fs.existsSync(DB_FILE)
        ? new SQL.Database(fs.readFileSync(DB_FILE))
        : new SQL.Database();

      db.run(`
        CREATE TABLE IF NOT EXISTS user_profile (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TEXT
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS chat_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          role TEXT,
          content TEXT,
          created_at TEXT
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS long_term_memory (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'misc',
          tags_json TEXT NOT NULL,
          importance REAL NOT NULL DEFAULT 0.6,
          stability REAL NOT NULL DEFAULT 0.6,
          confidence REAL NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          reinforcement_count INTEGER NOT NULL DEFAULT 0,
          last_recalled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          source_turn_id TEXT,
          source_session_id TEXT
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS session_summaries (
          session_id TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          summary_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          turn_count INTEGER NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_suggestions (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'misc',
          tags_json TEXT NOT NULL,
          importance REAL NOT NULL DEFAULT 0.6,
          stability REAL NOT NULL DEFAULT 0.6,
          confidence REAL NOT NULL,
          suggestion_kind TEXT NOT NULL DEFAULT 'new',
          created_at TEXT NOT NULL,
          decided_at TEXT,
          user_feedback TEXT,
          source_turn_id TEXT,
          source_session_id TEXT,
          status TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          auto_save INTEGER NOT NULL DEFAULT 0,
          auto_save_goals INTEGER NOT NULL DEFAULT 1,
          auto_save_constraints INTEGER NOT NULL DEFAULT 0,
          auto_save_preferences INTEGER NOT NULL DEFAULT 0,
          suggestion_snooze_until TEXT
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS relationship_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          trust_score REAL NOT NULL,
          rapport_score REAL NOT NULL,
          reliability_score REAL NOT NULL,
          relationship_label TEXT NOT NULL,
          last_updated_ts INTEGER NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS runtime_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          emergency_stop INTEGER NOT NULL DEFAULT 0,
          emergency_stop_reason TEXT,
          emergency_stop_updated_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS custom_items (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS custom_item_refs (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          image_data_url TEXT NOT NULL,
          embedding_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          due_at TEXT NOT NULL,
          repeats_required INTEGER NOT NULL DEFAULT 1,
          repeats_completed INTEGER NOT NULL DEFAULT 0,
          points_awarded INTEGER NOT NULL DEFAULT 0,
          points_possible INTEGER NOT NULL DEFAULT 5,
          status TEXT NOT NULL DEFAULT 'active',
          evidence_required INTEGER NOT NULL DEFAULT 1,
          evidence_type TEXT NOT NULL DEFAULT 'manual',
          camera_plan_json TEXT,
          max_attempts INTEGER NOT NULL DEFAULT 2,
          deny_user_override INTEGER NOT NULL DEFAULT 0,
          window_seconds INTEGER NOT NULL DEFAULT 600,
          per_repeat_timeout_seconds INTEGER,
          meta_json TEXT,
          session_id TEXT,
          turn_id TEXT,
          created_by TEXT NOT NULL DEFAULT 'raven'
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS task_occurrences (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          occurrence_index INTEGER NOT NULL,
          scheduled_date TEXT NOT NULL,
          deadline_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          review_state TEXT NOT NULL DEFAULT 'not_required',
          reviewed_at TEXT,
          completed_at TEXT,
          metadata_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS task_evidence_events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          occurrence_id TEXT,
          repeat_index INTEGER NOT NULL,
          attempt_index INTEGER NOT NULL,
          evidence_type TEXT NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          raw_json TEXT,
          created_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS task_outcome_events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          outcome_type TEXT NOT NULL,
          catalog_id TEXT,
          summary TEXT NOT NULL,
          params_json TEXT,
          created_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS task_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          require_reward_consequence_approval INTEGER NOT NULL DEFAULT 1
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS profile_progress (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          total_points INTEGER NOT NULL DEFAULT 0,
          current_tier TEXT NOT NULL DEFAULT 'bronze',
          free_pass_count INTEGER NOT NULL DEFAULT 0,
          streak_days INTEGER NOT NULL DEFAULT 0,
          last_task_completed_at TEXT,
          last_completion_summary TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_long_term_memory_key_updated
        ON long_term_memory (key, updated_at DESC);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_memory_suggestions_status_created
        ON memory_suggestions (status, created_at DESC);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_memory_suggestions_key_value_status
        ON memory_suggestions (key, value, status, created_at DESC);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_custom_items_label
        ON custom_items (label);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_custom_item_refs_item_id
        ON custom_item_refs (item_id, created_at DESC);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_tasks_status_due
        ON tasks (status, due_at);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_tasks_updated
        ON tasks (updated_at DESC);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_task_evidence_events_task_repeat
        ON task_evidence_events (task_id, repeat_index, created_at DESC);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_task_occurrences_task_status_deadline
        ON task_occurrences (task_id, status, deadline_at);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_task_occurrences_scheduled_date
        ON task_occurrences (scheduled_date, status);
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_task_outcome_events_task_created
        ON task_outcome_events (task_id, created_at DESC);
      `);
      ensureColumn(db, "long_term_memory", "type", "type TEXT NOT NULL DEFAULT 'misc'");
      ensureColumn(db, "long_term_memory", "importance", "importance REAL NOT NULL DEFAULT 0.6");
      ensureColumn(db, "long_term_memory", "stability", "stability REAL NOT NULL DEFAULT 0.6");
      ensureColumn(db, "long_term_memory", "is_active", "is_active INTEGER NOT NULL DEFAULT 1");
      ensureColumn(db, "long_term_memory", "is_pinned", "is_pinned INTEGER NOT NULL DEFAULT 0");
      ensureColumn(
        db,
        "long_term_memory",
        "reinforcement_count",
        "reinforcement_count INTEGER NOT NULL DEFAULT 0",
      );
      ensureColumn(db, "long_term_memory", "last_recalled_at", "last_recalled_at TEXT");
      ensureColumn(db, "memory_suggestions", "type", "type TEXT NOT NULL DEFAULT 'misc'");
      ensureColumn(db, "memory_suggestions", "importance", "importance REAL NOT NULL DEFAULT 0.6");
      ensureColumn(db, "memory_suggestions", "stability", "stability REAL NOT NULL DEFAULT 0.6");
      ensureColumn(
        db,
        "memory_suggestions",
        "suggestion_kind",
        "suggestion_kind TEXT NOT NULL DEFAULT 'new'",
      );
      ensureColumn(db, "memory_suggestions", "decided_at", "decided_at TEXT");
      ensureColumn(db, "memory_suggestions", "user_feedback", "user_feedback TEXT");
      ensureColumn(db, "chat_history", "session_id", "session_id TEXT");
      ensureColumn(db, "session_summaries", "summary_json", "summary_json TEXT");
      ensureColumn(db, "tasks", "meta_json", "meta_json TEXT");
      ensureColumn(db, "task_evidence_events", "occurrence_id", "occurrence_id TEXT");
      ensureColumn(
        db,
        "task_occurrences",
        "review_state",
        "review_state TEXT NOT NULL DEFAULT 'not_required'",
      );
      ensureColumn(db, "task_occurrences", "reviewed_at", "reviewed_at TEXT");
      ensureColumn(
        db,
        "profile_progress",
        "free_pass_count",
        "free_pass_count INTEGER NOT NULL DEFAULT 0",
      );
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_chat_history_session_created
        ON chat_history (session_id, id DESC);
      `);
      db.run(`
        UPDATE memory_suggestions
        SET status = 'rejected'
        WHERE status = 'dismissed'
      `);
      db.run(
        `INSERT OR IGNORE INTO memory_preferences
         (id, auto_save, auto_save_goals, auto_save_constraints, auto_save_preferences, suggestion_snooze_until)
         VALUES (1, 0, 1, 0, 0, NULL)`,
      );
      db.run(
        `INSERT OR IGNORE INTO task_preferences
         (id, require_reward_consequence_approval)
         VALUES (1, 1)`,
      );
      db.run(
        `INSERT OR IGNORE INTO profile_progress
         (id, total_points, current_tier, free_pass_count, streak_days, last_task_completed_at, last_completion_summary, updated_at)
         VALUES (1, 0, 'bronze', 0, 0, NULL, NULL, ?)`,
        [new Date().toISOString()],
      );
      db.run(
        `INSERT OR IGNORE INTO runtime_state
         (id, emergency_stop, emergency_stop_reason, emergency_stop_updated_at)
         VALUES (1, 0, NULL, ?)`,
        [new Date().toISOString()],
      );
      saveDatabase(db);
      return db;
    })();
  }

  return databasePromise;
}

function saveDatabase(db: Database) {
  const buffer = Buffer.from(db.export());
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.writeFileSync(DB_FILE, buffer);
      return;
    } catch (error) {
      lastError = error;
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (!["UNKNOWN", "EBUSY", "EPERM", "EACCES"].includes(code) || attempt === 3) {
        throw error;
      }
      const waitUntil = Date.now() + 25 * (attempt + 1);
      while (Date.now() < waitUntil) {
        // Retry transient Windows file-open failures instead of hard-failing the route.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to save database.");
}

async function withWrite<T>(operation: (db: Database) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const db = await loadDatabase();
    const result = await operation(db);
    saveDatabase(db);
    return result;
  };

  const pending = writeChain.then(run);
  writeChain = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function getTextValue(row: unknown): string {
  return typeof row === "string" ? row : String(row ?? "");
}

function parseStructuredSummaryJson(value: string | null): StructuredRollingSummary | null {
  if (!value) {
    return null;
  }
  try {
    return normalizeStructuredRollingSummary(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
      .filter((item) => item.length > 0)
      .slice(0, 24);
  } catch {
    return [];
  }
}

function serializeTags(tags: string[]): string {
  return JSON.stringify(
    tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0)
      .slice(0, 24),
  );
}

function parseEmbedding(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const values: number[] = [];
    for (const item of parsed) {
      const numeric = Number(item);
      if (!Number.isFinite(numeric)) {
        continue;
      }
      values.push(Number(numeric.toFixed(6)));
      if (values.length >= 2048) {
        break;
      }
    }
    return values;
  } catch {
    return [];
  }
}

function serializeEmbedding(values: number[]): string {
  const cleaned: number[] = [];
  for (const item of values) {
    if (!Number.isFinite(item)) {
      continue;
    }
    cleaned.push(Number(item.toFixed(6)));
    if (cleaned.length >= 2048) {
      break;
    }
  }
  return JSON.stringify(cleaned);
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as T[];
  } catch {
    return [];
  }
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  if (
    value === "active" ||
    value === "completed" ||
    value === "failed" ||
    value === "expired" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "active";
}

function normalizeTaskProgramKind(value: unknown): TaskProgramKind {
  if (value === "task" || value === "habit" || value === "rule" || value === "challenge") {
    return value;
  }
  return "task";
}

function normalizeTaskStrictnessMode(value: unknown): TaskStrictnessMode {
  if (value === "standard" || value === "soft" || value === "hard") {
    return value;
  }
  return "standard";
}

function normalizeTaskEvidenceType(value: unknown): TaskEvidenceType {
  if (value === "camera" || value === "manual" || value === "mixed") {
    return value;
  }
  return "manual";
}

function normalizeTaskEvidenceRecordType(value: unknown): TaskEvidenceRecordType {
  if (value === "camera" || value === "manual" || value === "file_upload") {
    return value;
  }
  return "manual";
}

function normalizeTaskCreatedBy(value: unknown): TaskCreatedBy {
  if (value === "raven" || value === "user") {
    return value;
  }
  return "raven";
}

function normalizeTaskScheduleType(value: unknown): TaskScheduleType {
  if (value === "one_time" || value === "daily") {
    return value;
  }
  return "one_time";
}

function normalizeTaskPlanApprovalStatus(value: unknown): TaskPlanApprovalStatus {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "auto_approved" ||
    value === "rejected"
  ) {
    return value;
  }
  return "pending";
}

function normalizeTaskEvidenceEventStatus(value: unknown): TaskEvidenceEventStatus {
  if (
    value === "pass" ||
    value === "pass_manual" ||
    value === "fail" ||
    value === "timeout" ||
    value === "inconclusive" ||
    value === "blocked"
  ) {
    return value;
  }
  return "inconclusive";
}

function normalizeTaskOccurrenceStatus(value: unknown): TaskOccurrenceStatus {
  if (
    value === "pending" ||
    value === "completed" ||
    value === "missed" ||
    value === "verified_failed"
  ) {
    return value;
  }
  return "pending";
}

function normalizeTaskOccurrenceReviewState(value: unknown): TaskOccurrenceReviewState {
  if (
    value === "not_required" ||
    value === "pending_review" ||
    value === "approved" ||
    value === "rejected"
  ) {
    return value;
  }
  return "not_required";
}

function normalizeTaskOutcomeType(value: unknown): TaskOutcomeType {
  if (value === "reward_applied" || value === "consequence_applied" || value === "info") {
    return value;
  }
  return "info";
}

function normalizeProfileProgressTier(value: unknown): ProfileProgressTier {
  if (value === "bronze" || value === "silver" || value === "gold" || value === "platinum") {
    return value;
  }
  return "bronze";
}

function normalizeTaskCameraPlan(value: unknown): TaskCameraCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const plan: TaskCameraCheck[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const capability = typeof row.capability === "string" ? row.capability.trim() : "";
    if (!capability) {
      continue;
    }
    const normalized: TaskCameraCheck = { capability };
    if (typeof row.required_duration_ms === "number" && Number.isFinite(row.required_duration_ms)) {
      normalized.required_duration_ms = Math.max(
        200,
        Math.min(60_000, Math.floor(row.required_duration_ms)),
      );
    }
    if (typeof row.confidence_threshold === "number" && Number.isFinite(row.confidence_threshold)) {
      normalized.confidence_threshold = toConfidence(row.confidence_threshold);
    }
    if (row.params && typeof row.params === "object" && !Array.isArray(row.params)) {
      normalized.params = row.params as Record<string, unknown>;
    }
    plan.push(normalized);
    if (plan.length >= 6) {
      break;
    }
  }
  return plan;
}

function normalizeTaskEvidencePolicy(
  value: unknown,
  fallback?: Partial<TaskEvidencePolicy>,
): TaskEvidencePolicy {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    required: typeof record.required === "boolean" ? record.required : (fallback?.required ?? true),
    type: normalizeTaskEvidenceType(record.type ?? fallback?.type),
    camera_plan: normalizeTaskCameraPlan(record.camera_plan ?? fallback?.camera_plan ?? []),
    max_attempts: Math.max(
      1,
      Math.min(
        6,
        Math.floor(
          typeof record.max_attempts === "number" && Number.isFinite(record.max_attempts)
            ? record.max_attempts
            : (fallback?.max_attempts ?? 2),
        ),
      ),
    ),
    deny_user_override:
      typeof record.deny_user_override === "boolean"
        ? record.deny_user_override
        : (fallback?.deny_user_override ?? false),
  };
}

function normalizeTaskSchedulePolicy(
  value: unknown,
  fallback?: Partial<TaskSchedulePolicy>,
): TaskSchedulePolicy {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const perRepeatRaw =
    typeof record.per_repeat_timeout_seconds === "number" &&
    Number.isFinite(record.per_repeat_timeout_seconds)
      ? Math.floor(record.per_repeat_timeout_seconds)
      : (fallback?.per_repeat_timeout_seconds ?? null);
  return {
    type: normalizeTaskScheduleType(record.type ?? fallback?.type),
    window_seconds: Math.max(
      30,
      Math.min(
        86_400,
        Math.floor(
          typeof record.window_seconds === "number" && Number.isFinite(record.window_seconds)
            ? record.window_seconds
            : (fallback?.window_seconds ?? 600),
        ),
      ),
    ),
    per_repeat_timeout_seconds:
      typeof perRepeatRaw === "number" && Number.isFinite(perRepeatRaw)
        ? Math.max(5, Math.min(3_600, perRepeatRaw))
        : null,
    start_date:
      typeof record.start_date === "string"
        ? record.start_date.trim().slice(0, 20) || null
        : (fallback?.start_date ?? null),
    end_date:
      typeof record.end_date === "string"
        ? record.end_date.trim().slice(0, 20) || null
        : (fallback?.end_date ?? null),
    days:
      typeof record.days === "number" && Number.isFinite(record.days)
        ? Math.max(1, Math.min(365, Math.floor(record.days)))
        : typeof fallback?.days === "number"
          ? Math.max(1, Math.min(365, Math.floor(fallback.days)))
          : null,
    occurrences_per_day:
      typeof record.occurrences_per_day === "number" && Number.isFinite(record.occurrences_per_day)
        ? Math.max(1, Math.min(24, Math.floor(record.occurrences_per_day)))
        : typeof fallback?.occurrences_per_day === "number"
          ? Math.max(1, Math.min(24, Math.floor(fallback.occurrences_per_day)))
          : 1,
    allow_make_up:
      typeof record.allow_make_up === "boolean"
        ? record.allow_make_up
        : (fallback?.allow_make_up ?? false),
  };
}

function normalizeTaskPlanSelection(value: unknown): TaskPlanSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const catalogId = typeof row.catalog_id === "string" ? row.catalog_id.trim() : "";
  if (!catalogId) {
    return null;
  }
  return {
    catalog_id: catalogId.slice(0, 64),
    params:
      row.params && typeof row.params === "object" && !Array.isArray(row.params)
        ? (row.params as Record<string, unknown>)
        : {},
    approval_status: normalizeTaskPlanApprovalStatus(row.approval_status),
    updated_at:
      typeof row.updated_at === "string" && row.updated_at.trim().length > 0
        ? row.updated_at
        : new Date().toISOString(),
  };
}

function normalizeCustomItemLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 48);
}

function toConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}

function toUnitScore(value: number, fallback = 0.6): number {
  if (!Number.isFinite(value)) {
    return Number(fallback.toFixed(3));
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}

function toBooleanInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function fromBooleanInt(value: unknown): boolean {
  return Number(value) > 0;
}

function normalizeMemoryType(value: string | undefined): MemoryType {
  if (
    value === "preference" ||
    value === "goal" ||
    value === "constraint" ||
    value === "setup" ||
    value === "habit"
  ) {
    return value;
  }
  return "misc";
}

export async function getProfileFromDb(): Promise<ProfileState> {
  const db = await loadDatabase();
  const result = db.exec(`SELECT key, value FROM user_profile ORDER BY key ASC`);
  if (!result.length) {
    return {};
  }

  const profile: ProfileState = {};
  for (const row of result[0].values) {
    const key = getTextValue(row[0]);
    const value = getTextValue(row[1]);
    profile[key as keyof ProfileState] = value;
  }
  return profile;
}

export async function upsertProfileInDb(profile: ProfileState): Promise<void> {
  await withWrite((db) => {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(profile)) {
      if (!value) {
        continue;
      }

      db.run(
        `INSERT INTO user_profile (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        [key, value, now],
      );
    }
  });
}

export async function appendChatHistory(
  role: "user" | "assistant" | "system",
  content: string,
  sessionId: string | null = null,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  await withWrite((db) => {
    db.run(`INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`, [
      sessionId,
      role,
      trimmed,
      new Date().toISOString(),
    ]);
    db.run(
      `DELETE FROM chat_history
       WHERE id NOT IN (SELECT id FROM chat_history ORDER BY id DESC LIMIT 200)`,
    );
  });
}

export async function getRecentChatHistory(
  sessionId: string | null = null,
  limit = 12,
): Promise<ChatHistoryRow[]> {
  const db = await loadDatabase();
  const result =
    sessionId === null
      ? db.exec(
          `SELECT id, session_id, role, content, created_at
           FROM chat_history
           WHERE session_id IS NULL
           ORDER BY id DESC
           LIMIT ?`,
          [limit],
        )
      : db.exec(
          `SELECT id, session_id, role, content, created_at
           FROM chat_history
           WHERE session_id = ?
           ORDER BY id DESC
           LIMIT ?`,
          [sessionId, limit],
        );
  if (!result.length) {
    return [];
  }

  return result[0].values
    .map((row) => ({
      id: Number(row[0]),
      session_id: getTextValue(row[1]),
      role: getTextValue(row[2]) as ChatHistoryRow["role"],
      content: getTextValue(row[3]),
      created_at: getTextValue(row[4]),
    }))
    .reverse();
}

export async function createLongTermMemory(input: {
  key: string;
  value: string;
  type?: MemoryType;
  tags?: string[];
  importance?: number;
  stability?: number;
  confidence?: number;
  isActive?: boolean;
  isPinned?: boolean;
  reinforcementCount?: number;
  lastRecalledAt?: string | null;
  sourceTurnId?: string | null;
  sourceSessionId?: string | null;
}): Promise<LongTermMemoryRow> {
  const key = input.key.trim().toLowerCase();
  const value = input.value.trim();
  const type = normalizeMemoryType(input.type);
  const now = new Date().toISOString();
  const row: LongTermMemoryRow = {
    id: crypto.randomUUID(),
    key,
    value,
    type,
    tags: input.tags ?? [],
    importance: toUnitScore(input.importance ?? 0.6),
    stability: toUnitScore(input.stability ?? 0.6),
    confidence: toConfidence(input.confidence ?? 0.65),
    is_active: input.isActive !== false,
    is_pinned: input.isPinned === true,
    reinforcement_count: Math.max(0, Math.floor(input.reinforcementCount ?? 1)),
    last_recalled_at: input.lastRecalledAt ?? null,
    created_at: now,
    updated_at: now,
    source_turn_id: input.sourceTurnId ?? null,
    source_session_id: input.sourceSessionId ?? null,
  };

  let finalRow = row;

  await withWrite((db) => {
    const existingResult = db.exec(
      `SELECT id, key, value, type, tags_json, importance, stability, confidence, is_active, is_pinned, reinforcement_count, last_recalled_at, created_at, updated_at, source_turn_id, source_session_id
       FROM long_term_memory
       WHERE key = ? AND LOWER(value) = LOWER(?) AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [row.key, row.value],
    );

    if (existingResult.length && existingResult[0].values.length > 0) {
      const existing = existingResult[0].values[0];
      const mergedTags = Array.from(
        new Set([
          ...parseTags(getTextValue(existing[4])),
          ...row.tags.map((tag) => tag.trim().toLowerCase()),
        ]),
      ).slice(0, 24);
      const mergedImportance = toUnitScore(Math.max(Number(existing[5]) || 0, row.importance));
      const mergedStability = toUnitScore(Math.max(Number(existing[6]) || 0, row.stability));
      const mergedConfidence = toConfidence(Math.max(Number(existing[7]) || 0, row.confidence));
      const mergedPinned = fromBooleanInt(existing[9]) || row.is_pinned;
      const mergedReinforcementCount =
        Math.max(0, Math.floor(Number(existing[10]) || 0)) +
        Math.max(1, Math.floor(row.reinforcement_count || 1));
      const mergedLastRecalledAt =
        row.last_recalled_at ?? (existing[11] == null ? null : getTextValue(existing[11]));
      const mergedSourceTurnId =
        row.source_turn_id ?? (existing[14] == null ? null : getTextValue(existing[14]));
      const mergedSourceSessionId =
        row.source_session_id ?? (existing[15] == null ? null : getTextValue(existing[15]));

      db.run(
        `UPDATE long_term_memory
         SET type = ?, tags_json = ?, importance = ?, stability = ?, confidence = ?, is_active = ?, is_pinned = ?, reinforcement_count = ?, last_recalled_at = ?, updated_at = ?, source_turn_id = ?, source_session_id = ?
         WHERE id = ?`,
        [
          row.type,
          serializeTags(mergedTags),
          mergedImportance,
          mergedStability,
          mergedConfidence,
          toBooleanInt(true),
          toBooleanInt(mergedPinned),
          mergedReinforcementCount,
          mergedLastRecalledAt,
          now,
          mergedSourceTurnId,
          mergedSourceSessionId,
          getTextValue(existing[0]),
        ],
      );

      finalRow = {
        id: getTextValue(existing[0]),
        key: getTextValue(existing[1]),
        value: getTextValue(existing[2]),
        type: normalizeMemoryType(getTextValue(existing[3])),
        tags: mergedTags,
        importance: mergedImportance,
        stability: mergedStability,
        confidence: mergedConfidence,
        is_active: true,
        is_pinned: mergedPinned,
        reinforcement_count: mergedReinforcementCount,
        last_recalled_at: mergedLastRecalledAt,
        created_at: getTextValue(existing[12]),
        updated_at: now,
        source_turn_id: mergedSourceTurnId,
        source_session_id: mergedSourceSessionId,
      };
      return;
    }

    db.run(
      `INSERT INTO long_term_memory
       (id, key, value, type, tags_json, importance, stability, confidence, is_active, is_pinned, reinforcement_count, last_recalled_at, created_at, updated_at, source_turn_id, source_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.key,
        row.value,
        row.type,
        serializeTags(row.tags),
        row.importance,
        row.stability,
        row.confidence,
        toBooleanInt(row.is_active),
        toBooleanInt(row.is_pinned),
        row.reinforcement_count,
        row.last_recalled_at,
        row.created_at,
        row.updated_at,
        row.source_turn_id,
        row.source_session_id,
      ],
    );
  });

  return finalRow;
}

export async function listLongTermMemories(
  limit = 200,
  options: { includeInactive?: boolean } = {},
): Promise<LongTermMemoryRow[]> {
  const db = await loadDatabase();
  const includeInactive = options.includeInactive === true;
  const result = db.exec(
    `SELECT id, key, value, type, tags_json, importance, stability, confidence, is_active, is_pinned, reinforcement_count, last_recalled_at, created_at, updated_at, source_turn_id, source_session_id
     FROM long_term_memory
     ${includeInactive ? "" : "WHERE is_active = 1"}
     ORDER BY is_pinned DESC, reinforcement_count DESC, updated_at DESC
     LIMIT ?`,
    [Math.max(1, Math.min(1000, Math.floor(limit)))],
  );
  if (!result.length) {
    return [];
  }

  return result[0].values.map((row) => ({
    id: getTextValue(row[0]),
    key: getTextValue(row[1]),
    value: getTextValue(row[2]),
    type: normalizeMemoryType(getTextValue(row[3])),
    tags: parseTags(getTextValue(row[4])),
    importance: toUnitScore(Number(row[5])),
    stability: toUnitScore(Number(row[6])),
    confidence: Number(row[7]),
    is_active: fromBooleanInt(row[8]),
    is_pinned: fromBooleanInt(row[9]),
    reinforcement_count: Math.max(0, Math.floor(Number(row[10]) || 0)),
    last_recalled_at: row[11] == null ? null : getTextValue(row[11]),
    created_at: getTextValue(row[12]),
    updated_at: getTextValue(row[13]),
    source_turn_id: row[14] == null ? null : getTextValue(row[14]),
    source_session_id: row[15] == null ? null : getTextValue(row[15]),
  }));
}

export async function updateLongTermMemory(
  id: string,
  patch: {
    key?: string;
    value?: string;
    type?: MemoryType;
    tags?: string[];
    importance?: number;
    stability?: number;
    confidence?: number;
    is_active?: boolean;
    is_pinned?: boolean;
  },
): Promise<LongTermMemoryRow | null> {
  const memories = await listLongTermMemories(1000, { includeInactive: true });
  const target = memories.find((memory) => memory.id === id);
  if (!target) {
    return null;
  }

  const next: LongTermMemoryRow = {
    ...target,
    key: patch.key ? patch.key.trim().toLowerCase() : target.key,
    value: patch.value ? patch.value.trim() : target.value,
    type: patch.type ? normalizeMemoryType(patch.type) : target.type,
    tags: patch.tags ?? target.tags,
    importance:
      typeof patch.importance === "number" ? toUnitScore(patch.importance) : target.importance,
    stability:
      typeof patch.stability === "number" ? toUnitScore(patch.stability) : target.stability,
    confidence:
      typeof patch.confidence === "number" ? toConfidence(patch.confidence) : target.confidence,
    is_active: typeof patch.is_active === "boolean" ? patch.is_active : target.is_active,
    is_pinned: typeof patch.is_pinned === "boolean" ? patch.is_pinned : target.is_pinned,
    updated_at: new Date().toISOString(),
  };

  await withWrite((db) => {
    db.run(
      `UPDATE long_term_memory
       SET key = ?, value = ?, type = ?, tags_json = ?, importance = ?, stability = ?, confidence = ?, is_active = ?, is_pinned = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.key,
        next.value,
        next.type,
        serializeTags(next.tags),
        next.importance,
        next.stability,
        next.confidence,
        toBooleanInt(next.is_active),
        toBooleanInt(next.is_pinned),
        next.updated_at,
        id,
      ],
    );
  });

  return next;
}

export async function markMemoriesRecalled(memoryIds: string[]): Promise<void> {
  const normalizedIds = Array.from(
    new Set(
      memoryIds
        .map((memoryId) => memoryId.trim())
        .filter((memoryId) => memoryId.length > 0),
    ),
  );
  if (normalizedIds.length === 0) {
    return;
  }

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const now = new Date().toISOString();
  await withWrite((db) => {
    db.run(
      `UPDATE long_term_memory
       SET reinforcement_count = reinforcement_count + 1,
           last_recalled_at = ?
       WHERE id IN (${placeholders})`,
      [now, ...normalizedIds],
    );
  });
}

export async function deleteLongTermMemory(id: string): Promise<boolean> {
  return withWrite((db) => {
    db.run(`DELETE FROM long_term_memory WHERE id = ?`, [id]);
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) > 0;
  });
}

export async function deleteAllLongTermMemories(): Promise<number> {
  return withWrite((db) => {
    db.run(`DELETE FROM long_term_memory`);
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) || 0;
  });
}

export async function forgetLongTermMemories(query: string): Promise<number> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return 0;
  }
  return withWrite((db) => {
    db.run(
      `DELETE FROM long_term_memory
       WHERE LOWER(key) LIKE ? OR LOWER(value) LIKE ? OR LOWER(tags_json) LIKE ?`,
      [`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`],
    );
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) || 0;
  });
}

export async function upsertSessionSummary(input: {
  sessionId: string;
  summary: string;
  structuredSummary?: StructuredRollingSummary | null;
  turnCount: number;
}): Promise<SessionSummaryRow> {
  const sessionId = input.sessionId.trim();
  const summary = input.summary.trim().slice(0, 4000);
  const structuredSummary = input.structuredSummary
    ? normalizeStructuredRollingSummary(input.structuredSummary)
    : null;
  const summaryJson = structuredSummary ? JSON.stringify(structuredSummary) : null;
  const now = new Date().toISOString();

  await withWrite((db) => {
    db.run(
      `INSERT INTO session_summaries (session_id, summary, summary_json, created_at, updated_at, turn_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id)
       DO UPDATE SET summary = excluded.summary,
                     summary_json = excluded.summary_json,
                     updated_at = excluded.updated_at,
                     turn_count = excluded.turn_count`,
      [sessionId, summary, summaryJson, now, now, Math.max(0, Math.floor(input.turnCount))],
    );
  });

  return {
    session_id: sessionId,
    summary,
    summary_json: summaryJson,
    structured_summary: structuredSummary,
    created_at: now,
    updated_at: now,
    turn_count: Math.max(0, Math.floor(input.turnCount)),
  };
}

export async function getLatestSessionSummary(
  excludingSessionId?: string,
): Promise<SessionSummaryRow | null> {
  const db = await loadDatabase();
  const result = excludingSessionId
    ? db.exec(
        `SELECT session_id, summary, summary_json, created_at, updated_at, turn_count
         FROM session_summaries
         WHERE session_id != ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [excludingSessionId],
      )
    : db.exec(
        `SELECT session_id, summary, summary_json, created_at, updated_at, turn_count
         FROM session_summaries
         ORDER BY updated_at DESC
         LIMIT 1`,
      );
  if (!result.length || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const summaryJson = getTextValue(row[2]);
  return {
    session_id: getTextValue(row[0]),
    summary: getTextValue(row[1]),
    summary_json: summaryJson,
    structured_summary: parseStructuredSummaryJson(summaryJson),
    created_at: getTextValue(row[3]),
    updated_at: getTextValue(row[4]),
    turn_count: Number(row[5]),
  };
}

export async function getSessionSummary(sessionId: string): Promise<SessionSummaryRow | null> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT session_id, summary, summary_json, created_at, updated_at, turn_count
     FROM session_summaries
     WHERE session_id = ?
     LIMIT 1`,
    [sessionId],
  );
  if (!result.length || result[0].values.length === 0) {
    return null;
  }
  const row = result[0].values[0];
  const summaryJson = getTextValue(row[2]);
  return {
    session_id: getTextValue(row[0]),
    summary: getTextValue(row[1]),
    summary_json: summaryJson,
    structured_summary: parseStructuredSummaryJson(summaryJson),
    created_at: getTextValue(row[3]),
    updated_at: getTextValue(row[4]),
    turn_count: Number(row[5]),
  };
}

const REJECTED_SUGGESTION_COOLDOWN_DAYS = 30;
const REJECTION_LEARNED_IMPORTANCE_FLOOR = 0.75;

export async function createMemorySuggestion(input: {
  key: string;
  value: string;
  type?: MemoryType;
  tags?: string[];
  importance?: number;
  stability?: number;
  confidence?: number;
  suggestionKind?: "new" | "update";
  userFeedback?: string | null;
  sourceTurnId?: string | null;
  sourceSessionId?: string | null;
}): Promise<MemorySuggestionRow | null> {
  const nowIso = new Date().toISOString();
  let row: MemorySuggestionRow = {
    id: crypto.randomUUID(),
    key: input.key.trim().toLowerCase(),
    value: input.value.trim(),
    type: normalizeMemoryType(input.type),
    tags: input.tags ?? [],
    importance: toUnitScore(input.importance ?? 0.6),
    stability: toUnitScore(input.stability ?? 0.6),
    confidence: toConfidence(input.confidence ?? 0.6),
    suggestion_kind: input.suggestionKind ?? "new",
    created_at: nowIso,
    decided_at: null,
    user_feedback: input.userFeedback ?? null,
    source_turn_id: input.sourceTurnId ?? null,
    source_session_id: input.sourceSessionId ?? null,
    status: "pending",
  };

  if (!row.key || !row.value) {
    return null;
  }

  let created: MemorySuggestionRow | null = row;
  await withWrite((db) => {
    const activeMemory = db.exec(
      `SELECT id FROM long_term_memory
       WHERE key = ? AND LOWER(value) = LOWER(?) AND is_active = 1
       LIMIT 1`,
      [row.key, row.value],
    );
    if (activeMemory.length > 0 && activeMemory[0].values.length > 0) {
      created = null;
      return;
    }

    const sameKeyDifferentValue = db.exec(
      `SELECT id FROM long_term_memory
       WHERE key = ? AND LOWER(value) != LOWER(?) AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [row.key, row.value],
    );
    if (sameKeyDifferentValue.length > 0 && sameKeyDifferentValue[0].values.length > 0) {
      row = {
        ...row,
        suggestion_kind: "update",
        importance: toUnitScore(Math.max(row.importance, 0.62)),
        stability: toUnitScore(Math.max(row.stability, 0.6)),
        tags: Array.from(new Set([...row.tags, "update"])).slice(0, 24),
      };
    }
    created = row;

    const decisionStats = db.exec(
      `SELECT status, COUNT(*)
       FROM memory_suggestions
       WHERE key = ?
       GROUP BY status`,
      [row.key],
    );
    if (decisionStats.length > 0) {
      let approvedCount = 0;
      let rejectedCount = 0;
      for (const valueRow of decisionStats[0].values) {
        const status = getTextValue(valueRow[0]);
        const count = Number(valueRow[1]);
        if (status === "approved") {
          approvedCount += count;
        } else if (status === "rejected") {
          rejectedCount += count;
        }
      }
      const rejectionBias = rejectedCount - approvedCount;
      if (rejectionBias > 0 && row.importance < REJECTION_LEARNED_IMPORTANCE_FLOOR) {
        created = null;
        return;
      }
    }

    const pendingExisting = db.exec(
      `SELECT id, key, value, type, tags_json, importance, stability, confidence, suggestion_kind, created_at, decided_at, user_feedback, source_turn_id, source_session_id, status
       FROM memory_suggestions
       WHERE key = ? AND LOWER(value) = LOWER(?) AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.key, row.value],
    );
    if (pendingExisting.length > 0 && pendingExisting[0].values.length > 0) {
      const existing = pendingExisting[0].values[0];
      created = {
        id: getTextValue(existing[0]),
        key: getTextValue(existing[1]),
        value: getTextValue(existing[2]),
        type: normalizeMemoryType(getTextValue(existing[3])),
        tags: parseTags(getTextValue(existing[4])),
        importance: toUnitScore(Number(existing[5])),
        stability: toUnitScore(Number(existing[6])),
        confidence: toConfidence(Number(existing[7])),
        suggestion_kind: getTextValue(existing[8]) === "update" ? "update" : "new",
        created_at: getTextValue(existing[9]),
        decided_at: existing[10] == null ? null : getTextValue(existing[10]),
        user_feedback: existing[11] == null ? null : getTextValue(existing[11]),
        source_turn_id: existing[12] == null ? null : getTextValue(existing[12]),
        source_session_id: existing[13] == null ? null : getTextValue(existing[13]),
        status: getTextValue(existing[14]) as MemorySuggestionStatus,
      };
      return;
    }

    const cooldownCutoff = new Date(
      Date.now() - REJECTED_SUGGESTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recentRejected = db.exec(
      `SELECT id
       FROM memory_suggestions
       WHERE key = ? AND LOWER(value) = LOWER(?) AND status = 'rejected' AND decided_at IS NOT NULL AND decided_at >= ?
       LIMIT 1`,
      [row.key, row.value, cooldownCutoff],
    );
    if (recentRejected.length > 0 && recentRejected[0].values.length > 0) {
      created = null;
      return;
    }

    db.run(
      `INSERT INTO memory_suggestions
       (id, key, value, type, tags_json, importance, stability, confidence, suggestion_kind, created_at, decided_at, user_feedback, source_turn_id, source_session_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.key,
        row.value,
        row.type,
        serializeTags(row.tags),
        row.importance,
        row.stability,
        row.confidence,
        row.suggestion_kind,
        row.created_at,
        row.decided_at,
        row.user_feedback,
        row.source_turn_id,
        row.source_session_id,
        row.status,
      ],
    );
  });

  return created;
}

export async function listMemorySuggestions(
  status: MemorySuggestionStatus | "all" = "pending",
): Promise<MemorySuggestionRow[]> {
  const db = await loadDatabase();
  const result =
    status === "all"
      ? db.exec(
          `SELECT id, key, value, type, tags_json, importance, stability, confidence, suggestion_kind, created_at, decided_at, user_feedback, source_turn_id, source_session_id, status
           FROM memory_suggestions
           ORDER BY created_at DESC`,
        )
      : db.exec(
          `SELECT id, key, value, type, tags_json, importance, stability, confidence, suggestion_kind, created_at, decided_at, user_feedback, source_turn_id, source_session_id, status
           FROM memory_suggestions
           WHERE status = ?
           ORDER BY created_at DESC`,
          [status],
        );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => ({
    id: getTextValue(row[0]),
    key: getTextValue(row[1]),
    value: getTextValue(row[2]),
    type: normalizeMemoryType(getTextValue(row[3])),
    tags: parseTags(getTextValue(row[4])),
    importance: toUnitScore(Number(row[5])),
    stability: toUnitScore(Number(row[6])),
    confidence: Number(row[7]),
    suggestion_kind: getTextValue(row[8]) === "update" ? "update" : "new",
    created_at: getTextValue(row[9]),
    decided_at: row[10] == null ? null : getTextValue(row[10]),
    user_feedback: row[11] == null ? null : getTextValue(row[11]),
    source_turn_id: row[12] == null ? null : getTextValue(row[12]),
    source_session_id: row[13] == null ? null : getTextValue(row[13]),
    status: getTextValue(row[14]) as MemorySuggestionStatus,
  }));
}

export async function approveMemorySuggestion(
  id: string,
  patch?: {
    key?: string;
    value?: string;
    type?: MemoryType;
    tags?: string[];
    isPinned?: boolean;
    userFeedback?: string | null;
  },
): Promise<LongTermMemoryRow | null> {
  const suggestions = await listMemorySuggestions("pending");
  const target = suggestions.find((suggestion) => suggestion.id === id);
  if (!target) {
    return null;
  }

  const saved = await createLongTermMemory({
    key: patch?.key?.trim() || target.key,
    value: patch?.value?.trim() || target.value,
    type: patch?.type ?? target.type,
    tags: patch?.tags ?? target.tags,
    importance: target.importance,
    stability: target.stability,
    confidence: target.confidence,
    isPinned: patch?.isPinned === true,
    sourceTurnId: target.source_turn_id,
    sourceSessionId: target.source_session_id,
  });

  await withWrite((db) => {
    db.run(
      `UPDATE memory_suggestions SET status = ?, decided_at = ?, user_feedback = ? WHERE id = ?`,
      ["approved", new Date().toISOString(), patch?.userFeedback ?? null, id],
    );
  });

  return saved;
}

export async function rejectMemorySuggestion(
  id: string,
  userFeedback: string | null = null,
): Promise<boolean> {
  return withWrite((db) => {
    db.run(
      `UPDATE memory_suggestions SET status = ?, decided_at = ?, user_feedback = ? WHERE id = ?`,
      ["rejected", new Date().toISOString(), userFeedback, id],
    );
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) > 0;
  });
}

export async function dismissMemorySuggestion(id: string): Promise<boolean> {
  return rejectMemorySuggestion(id);
}

export async function getMemoryPreferencesFromDb(): Promise<MemoryPreferencesRow> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT auto_save, auto_save_goals, auto_save_constraints, auto_save_preferences, suggestion_snooze_until
     FROM memory_preferences
     WHERE id = 1
     LIMIT 1`,
  );
  if (!result.length || result[0].values.length === 0) {
    return {
      auto_save: false,
      auto_save_goals: true,
      auto_save_constraints: false,
      auto_save_preferences: false,
      suggestion_snooze_until: null,
    };
  }
  const row = result[0].values[0];
  return {
    auto_save: fromBooleanInt(row[0]),
    auto_save_goals: fromBooleanInt(row[1]),
    auto_save_constraints: fromBooleanInt(row[2]),
    auto_save_preferences: fromBooleanInt(row[3]),
    suggestion_snooze_until: row[4] == null ? null : getTextValue(row[4]),
  };
}

export async function upsertMemoryPreferencesInDb(
  patch: Partial<MemoryPreferencesRow>,
): Promise<MemoryPreferencesRow> {
  const current = await getMemoryPreferencesFromDb();
  const next: MemoryPreferencesRow = {
    auto_save: typeof patch.auto_save === "boolean" ? patch.auto_save : current.auto_save,
    auto_save_goals:
      typeof patch.auto_save_goals === "boolean" ? patch.auto_save_goals : current.auto_save_goals,
    auto_save_constraints:
      typeof patch.auto_save_constraints === "boolean"
        ? patch.auto_save_constraints
        : current.auto_save_constraints,
    auto_save_preferences:
      typeof patch.auto_save_preferences === "boolean"
        ? patch.auto_save_preferences
        : current.auto_save_preferences,
    suggestion_snooze_until:
      patch.suggestion_snooze_until !== undefined
        ? patch.suggestion_snooze_until
        : current.suggestion_snooze_until,
  };

  await withWrite((db) => {
    db.run(
      `INSERT INTO memory_preferences
       (id, auto_save, auto_save_goals, auto_save_constraints, auto_save_preferences, suggestion_snooze_until)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         auto_save = excluded.auto_save,
         auto_save_goals = excluded.auto_save_goals,
         auto_save_constraints = excluded.auto_save_constraints,
         auto_save_preferences = excluded.auto_save_preferences,
         suggestion_snooze_until = excluded.suggestion_snooze_until`,
      [
        toBooleanInt(next.auto_save),
        toBooleanInt(next.auto_save_goals),
        toBooleanInt(next.auto_save_constraints),
        toBooleanInt(next.auto_save_preferences),
        next.suggestion_snooze_until,
      ],
    );
  });

  return next;
}

export async function deleteAllMemoryData(): Promise<void> {
  await withWrite((db) => {
    db.run(`DELETE FROM long_term_memory`);
    db.run(`DELETE FROM memory_suggestions`);
    db.run(`DELETE FROM session_summaries`);
  });
}

export async function createCustomItemInDb(label: string): Promise<CustomItemRow> {
  const normalizedLabel = normalizeCustomItemLabel(label);
  if (!normalizedLabel) {
    throw new Error("Custom item label is required.");
  }

  let row: CustomItemRow = {
    id: crypto.randomUUID(),
    label: normalizedLabel,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await withWrite((db) => {
    const existing = db.exec(
      `SELECT id, label, created_at, updated_at
       FROM custom_items
       WHERE label = ?
       LIMIT 1`,
      [normalizedLabel],
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      const found = existing[0].values[0];
      row = {
        id: getTextValue(found[0]),
        label: getTextValue(found[1]),
        created_at: getTextValue(found[2]),
        updated_at: getTextValue(found[3]),
      };
      return;
    }

    db.run(
      `INSERT INTO custom_items (id, label, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [row.id, row.label, row.created_at, row.updated_at],
    );
  });

  return row;
}

export async function listCustomItemsFromDb(): Promise<CustomItemRow[]> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT id, label, created_at, updated_at
     FROM custom_items
     ORDER BY updated_at DESC, created_at DESC`,
  );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => ({
    id: getTextValue(row[0]),
    label: getTextValue(row[1]),
    created_at: getTextValue(row[2]),
    updated_at: getTextValue(row[3]),
  }));
}

export async function deleteCustomItemInDb(itemId: string): Promise<boolean> {
  return withWrite((db) => {
    db.run(`DELETE FROM custom_item_refs WHERE item_id = ?`, [itemId]);
    db.run(`DELETE FROM custom_items WHERE id = ?`, [itemId]);
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) > 0;
  });
}

export async function createCustomItemRefInDb(input: {
  itemId: string;
  imageDataUrl: string;
  embedding: number[];
}): Promise<CustomItemRefRow | null> {
  const itemId = input.itemId.trim();
  const imageDataUrl = input.imageDataUrl.trim();
  if (!itemId || !imageDataUrl) {
    return null;
  }
  const embedding = input.embedding;
  if (embedding.length === 0) {
    return null;
  }

  let created: CustomItemRefRow | null = null;
  await withWrite((db) => {
    const exists = db.exec(`SELECT id FROM custom_items WHERE id = ? LIMIT 1`, [itemId]);
    if (!exists.length || exists[0].values.length === 0) {
      created = null;
      return;
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO custom_item_refs (id, item_id, image_data_url, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, itemId, imageDataUrl, serializeEmbedding(embedding), now],
    );
    db.run(`UPDATE custom_items SET updated_at = ? WHERE id = ?`, [now, itemId]);
    created = {
      id,
      item_id: itemId,
      image_data_url: imageDataUrl,
      embedding: [...embedding],
      created_at: now,
    };
  });

  return created;
}

export async function listCustomItemRefsFromDb(itemId?: string): Promise<CustomItemRefRow[]> {
  const db = await loadDatabase();
  const result = itemId
    ? db.exec(
        `SELECT id, item_id, image_data_url, embedding_json, created_at
         FROM custom_item_refs
         WHERE item_id = ?
         ORDER BY created_at DESC`,
        [itemId],
      )
    : db.exec(
        `SELECT id, item_id, image_data_url, embedding_json, created_at
         FROM custom_item_refs
         ORDER BY created_at DESC`,
      );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => ({
    id: getTextValue(row[0]),
    item_id: getTextValue(row[1]),
    image_data_url: getTextValue(row[2]),
    embedding: parseEmbedding(getTextValue(row[3])),
    created_at: getTextValue(row[4]),
  }));
}

export async function deleteCustomItemRefInDb(itemId: string, refId: string): Promise<boolean> {
  return withWrite((db) => {
    db.run(`DELETE FROM custom_item_refs WHERE id = ? AND item_id = ?`, [refId, itemId]);
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    if (Number(changed) > 0) {
      db.run(`UPDATE custom_items SET updated_at = ? WHERE id = ?`, [
        new Date().toISOString(),
        itemId,
      ]);
      return true;
    }
    return false;
  });
}

export async function listCustomItemsWithRefsFromDb(): Promise<
  Array<CustomItemRow & { references: CustomItemRefRow[] }>
> {
  const [items, refs] = await Promise.all([listCustomItemsFromDb(), listCustomItemRefsFromDb()]);
  const refsByItem = new Map<string, CustomItemRefRow[]>();
  for (const ref of refs) {
    const list = refsByItem.get(ref.item_id) ?? [];
    list.push(ref);
    refsByItem.set(ref.item_id, list);
  }
  return items.map((item) => ({
    ...item,
    references: refsByItem.get(item.id) ?? [],
  }));
}

function mapTaskRow(raw: unknown[]): TaskRow {
  const metaRecord = parseJsonRecord(raw[18] == null ? "{}" : getTextValue(raw[18]));
  const normalizedScheduleFromMeta = normalizeTaskSchedulePolicy(metaRecord.schedule_policy, {
    type: "one_time",
    window_seconds: Number(raw[15]) || 600,
    per_repeat_timeout_seconds: raw[16] == null ? null : Number(raw[16]),
    start_date: null,
    end_date: null,
    days: null,
    occurrences_per_day: 1,
    allow_make_up: false,
  });
  const evidencePolicy = normalizeTaskEvidencePolicy(
    {
      required: fromBooleanInt(raw[10]),
      type: normalizeTaskEvidenceType(getTextValue(raw[11])),
      camera_plan: normalizeTaskCameraPlan(
        getTextValue(raw[12]) ? parseJsonArray(getTextValue(raw[12])) : [],
      ),
      max_attempts: Number(raw[13]),
      deny_user_override: fromBooleanInt(raw[14]),
    },
    { required: true, type: "manual", camera_plan: [], max_attempts: 2, deny_user_override: false },
  );
  const schedulePolicy = normalizeTaskSchedulePolicy(normalizedScheduleFromMeta, {
    type: "one_time",
    window_seconds: 600,
    per_repeat_timeout_seconds: null,
    start_date: null,
    end_date: null,
    days: null,
    occurrences_per_day: 1,
    allow_make_up: false,
  });
  const rewardPlan = normalizeTaskPlanSelection(metaRecord.reward_plan);
  const consequencePlan = normalizeTaskPlanSelection(metaRecord.consequence_plan);
  const programKind = normalizeTaskProgramKind(metaRecord.program_kind);
  const strictnessMode = normalizeTaskStrictnessMode(metaRecord.strictness_mode);
  return {
    id: getTextValue(raw[0]),
    title: getTextValue(raw[1]),
    description: getTextValue(raw[2]),
    created_at: getTextValue(raw[3]),
    updated_at: getTextValue(raw[4]),
    due_at: getTextValue(raw[5]),
    repeats_required: Math.max(1, Number(raw[6]) || 1),
    repeats_completed: Math.max(0, Number(raw[7]) || 0),
    points_awarded: Math.max(0, Number(raw[8]) || 0),
    points_possible: Math.max(0, Number(raw[9]) || 0),
    status: normalizeTaskStatus(getTextValue(raw[17])),
    evidence_policy: evidencePolicy,
    schedule_policy: schedulePolicy,
    reward_plan: rewardPlan,
    consequence_plan: consequencePlan,
    program_kind: programKind,
    strictness_mode: strictnessMode,
    session_id: raw[19] == null ? null : getTextValue(raw[19]),
    turn_id: raw[20] == null ? null : getTextValue(raw[20]),
    created_by: normalizeTaskCreatedBy(getTextValue(raw[21])),
  };
}

export async function createTaskInDb(input: {
  title: string;
  description: string;
  dueAt: string;
  repeatsRequired: number;
  pointsPossible: number;
  status?: TaskStatus;
  evidencePolicy: TaskEvidencePolicy;
  schedulePolicy: TaskSchedulePolicy;
  rewardPlan?: TaskPlanSelection | null;
  consequencePlan?: TaskPlanSelection | null;
  programKind?: TaskProgramKind;
  strictnessMode?: TaskStrictnessMode;
  sessionId?: string | null;
  turnId?: string | null;
  createdBy?: TaskCreatedBy;
}): Promise<TaskRow> {
  const nowIso = new Date().toISOString();
  const row: TaskRow = {
    id: crypto.randomUUID(),
    title: input.title.trim().slice(0, 120),
    description: input.description.trim().slice(0, 500),
    created_at: nowIso,
    updated_at: nowIso,
    due_at: input.dueAt,
    repeats_required: Math.max(1, Math.min(100, Math.floor(input.repeatsRequired))),
    repeats_completed: 0,
    points_awarded: 0,
    points_possible: Math.max(1, Math.min(1_000, Math.floor(input.pointsPossible))),
    status: normalizeTaskStatus(input.status ?? "active"),
    evidence_policy: normalizeTaskEvidencePolicy(input.evidencePolicy),
    schedule_policy: normalizeTaskSchedulePolicy(input.schedulePolicy, {
      type: "one_time",
      window_seconds: 600,
      per_repeat_timeout_seconds: null,
      start_date: null,
      end_date: null,
      days: null,
      occurrences_per_day: 1,
      allow_make_up: false,
    }),
    reward_plan: normalizeTaskPlanSelection(input.rewardPlan ?? null),
    consequence_plan: normalizeTaskPlanSelection(input.consequencePlan ?? null),
    program_kind: normalizeTaskProgramKind(input.programKind ?? "task"),
    strictness_mode: normalizeTaskStrictnessMode(input.strictnessMode ?? "standard"),
    session_id: input.sessionId ?? null,
    turn_id: input.turnId ?? null,
    created_by: normalizeTaskCreatedBy(input.createdBy ?? "raven"),
  };

  await withWrite((db) => {
    db.run(
      `INSERT INTO tasks
       (id, title, description, created_at, updated_at, due_at, repeats_required, repeats_completed, points_awarded, points_possible, status, evidence_required, evidence_type, camera_plan_json, max_attempts, deny_user_override, window_seconds, per_repeat_timeout_seconds, meta_json, session_id, turn_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.title,
        row.description,
        row.created_at,
        row.updated_at,
        row.due_at,
        row.repeats_required,
        row.repeats_completed,
        row.points_awarded,
        row.points_possible,
        row.status,
        toBooleanInt(row.evidence_policy.required),
        row.evidence_policy.type,
        JSON.stringify(row.evidence_policy.camera_plan ?? []),
        row.evidence_policy.max_attempts,
        toBooleanInt(row.evidence_policy.deny_user_override),
        row.schedule_policy.window_seconds,
        row.schedule_policy.per_repeat_timeout_seconds,
        JSON.stringify({
          schedule_policy: row.schedule_policy,
          reward_plan: row.reward_plan,
          consequence_plan: row.consequence_plan,
          program_kind: row.program_kind,
          strictness_mode: row.strictness_mode,
        }),
        row.session_id,
        row.turn_id,
        row.created_by,
      ],
    );
  });

  return row;
}

export async function listTasksFromDb(
  options: {
    status?: TaskStatus | "all";
    limit?: number;
    sessionId?: string;
  } = {},
): Promise<TaskRow[]> {
  const db = await loadDatabase();
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)));
  const status = options.status ?? "all";
  const sessionId = options.sessionId?.trim();

  const result =
    status === "all"
      ? sessionId
        ? db.exec(
            `SELECT id, title, description, created_at, updated_at, due_at, repeats_required, repeats_completed, points_awarded, points_possible, evidence_required, evidence_type, camera_plan_json, max_attempts, deny_user_override, window_seconds, per_repeat_timeout_seconds, status, meta_json, session_id, turn_id, created_by
             FROM tasks
             WHERE session_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`,
            [sessionId, limit],
          )
        : db.exec(
            `SELECT id, title, description, created_at, updated_at, due_at, repeats_required, repeats_completed, points_awarded, points_possible, evidence_required, evidence_type, camera_plan_json, max_attempts, deny_user_override, window_seconds, per_repeat_timeout_seconds, status, meta_json, session_id, turn_id, created_by
             FROM tasks
             ORDER BY updated_at DESC
             LIMIT ?`,
            [limit],
          )
      : sessionId
        ? db.exec(
            `SELECT id, title, description, created_at, updated_at, due_at, repeats_required, repeats_completed, points_awarded, points_possible, evidence_required, evidence_type, camera_plan_json, max_attempts, deny_user_override, window_seconds, per_repeat_timeout_seconds, status, meta_json, session_id, turn_id, created_by
             FROM tasks
             WHERE status = ? AND session_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`,
            [status, sessionId, limit],
          )
        : db.exec(
            `SELECT id, title, description, created_at, updated_at, due_at, repeats_required, repeats_completed, points_awarded, points_possible, evidence_required, evidence_type, camera_plan_json, max_attempts, deny_user_override, window_seconds, per_repeat_timeout_seconds, status, meta_json, session_id, turn_id, created_by
             FROM tasks
             WHERE status = ?
             ORDER BY updated_at DESC
             LIMIT ?`,
            [status, limit],
          );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => mapTaskRow(row));
}

export async function getTaskByIdFromDb(taskId: string): Promise<TaskRow | null> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT id, title, description, created_at, updated_at, due_at, repeats_required, repeats_completed, points_awarded, points_possible, evidence_required, evidence_type, camera_plan_json, max_attempts, deny_user_override, window_seconds, per_repeat_timeout_seconds, status, meta_json, session_id, turn_id, created_by
     FROM tasks
     WHERE id = ?
     LIMIT 1`,
    [taskId.trim()],
  );
  if (!result.length || result[0].values.length === 0) {
    return null;
  }
  return mapTaskRow(result[0].values[0]);
}

export async function updateTaskInDb(
  taskId: string,
  patch: Partial<{
    title: string;
    description: string;
    due_at: string;
    repeats_required: number;
    repeats_completed: number;
    points_awarded: number;
    points_possible: number;
    status: TaskStatus;
    evidence_policy: TaskEvidencePolicy;
    schedule_policy: TaskSchedulePolicy;
    reward_plan: TaskPlanSelection | null;
    consequence_plan: TaskPlanSelection | null;
    program_kind: TaskProgramKind;
    strictness_mode: TaskStrictnessMode;
    session_id: string | null;
    turn_id: string | null;
    created_by: TaskCreatedBy;
  }>,
): Promise<TaskRow | null> {
  const current = await getTaskByIdFromDb(taskId);
  if (!current) {
    return null;
  }
  const next: TaskRow = {
    ...current,
    title: typeof patch.title === "string" ? patch.title.trim().slice(0, 120) : current.title,
    description:
      typeof patch.description === "string"
        ? patch.description.trim().slice(0, 500)
        : current.description,
    due_at: typeof patch.due_at === "string" ? patch.due_at : current.due_at,
    repeats_required:
      typeof patch.repeats_required === "number" && Number.isFinite(patch.repeats_required)
        ? Math.max(1, Math.min(100, Math.floor(patch.repeats_required)))
        : current.repeats_required,
    repeats_completed:
      typeof patch.repeats_completed === "number" && Number.isFinite(patch.repeats_completed)
        ? Math.max(0, Math.min(100, Math.floor(patch.repeats_completed)))
        : current.repeats_completed,
    points_awarded:
      typeof patch.points_awarded === "number" && Number.isFinite(patch.points_awarded)
        ? Math.max(0, Math.min(1_000_000, Math.floor(patch.points_awarded)))
        : current.points_awarded,
    points_possible:
      typeof patch.points_possible === "number" && Number.isFinite(patch.points_possible)
        ? Math.max(1, Math.min(1_000, Math.floor(patch.points_possible)))
        : current.points_possible,
    status: typeof patch.status === "string" ? normalizeTaskStatus(patch.status) : current.status,
    evidence_policy: patch.evidence_policy
      ? normalizeTaskEvidencePolicy(patch.evidence_policy, current.evidence_policy)
      : current.evidence_policy,
    schedule_policy: patch.schedule_policy
      ? normalizeTaskSchedulePolicy(patch.schedule_policy, current.schedule_policy)
      : current.schedule_policy,
    reward_plan:
      patch.reward_plan !== undefined
        ? normalizeTaskPlanSelection(patch.reward_plan)
        : current.reward_plan,
    consequence_plan:
      patch.consequence_plan !== undefined
        ? normalizeTaskPlanSelection(patch.consequence_plan)
        : current.consequence_plan,
    program_kind:
      patch.program_kind !== undefined
        ? normalizeTaskProgramKind(patch.program_kind)
        : current.program_kind,
    strictness_mode:
      patch.strictness_mode !== undefined
        ? normalizeTaskStrictnessMode(patch.strictness_mode)
        : current.strictness_mode,
    session_id: patch.session_id !== undefined ? patch.session_id : current.session_id,
    turn_id: patch.turn_id !== undefined ? patch.turn_id : current.turn_id,
    created_by:
      patch.created_by !== undefined
        ? normalizeTaskCreatedBy(patch.created_by)
        : current.created_by,
    updated_at: new Date().toISOString(),
  };

  await withWrite((db) => {
    db.run(
      `UPDATE tasks
       SET title = ?, description = ?, updated_at = ?, due_at = ?, repeats_required = ?, repeats_completed = ?, points_awarded = ?, points_possible = ?, status = ?, evidence_required = ?, evidence_type = ?, camera_plan_json = ?, max_attempts = ?, deny_user_override = ?, window_seconds = ?, per_repeat_timeout_seconds = ?, meta_json = ?, session_id = ?, turn_id = ?, created_by = ?
       WHERE id = ?`,
      [
        next.title,
        next.description,
        next.updated_at,
        next.due_at,
        next.repeats_required,
        next.repeats_completed,
        next.points_awarded,
        next.points_possible,
        next.status,
        toBooleanInt(next.evidence_policy.required),
        next.evidence_policy.type,
        JSON.stringify(next.evidence_policy.camera_plan ?? []),
        next.evidence_policy.max_attempts,
        toBooleanInt(next.evidence_policy.deny_user_override),
        next.schedule_policy.window_seconds,
        next.schedule_policy.per_repeat_timeout_seconds,
        JSON.stringify({
          schedule_policy: next.schedule_policy,
          reward_plan: next.reward_plan,
          consequence_plan: next.consequence_plan,
          program_kind: next.program_kind,
          strictness_mode: next.strictness_mode,
        }),
        next.session_id,
        next.turn_id,
        next.created_by,
        next.id,
      ],
    );
  });

  return next;
}

export async function refreshExpiredTasksInDb(nowIso = new Date().toISOString()): Promise<number> {
  return withWrite((db) => {
    db.run(
      `UPDATE tasks
       SET status = 'expired', updated_at = ?
       WHERE status = 'active' AND due_at <= ?`,
      [nowIso, nowIso],
    );
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) || 0;
  });
}

export async function appendTaskEvidenceEventInDb(input: {
  taskId: string;
  occurrenceId?: string | null;
  repeatIndex: number;
  attemptIndex: number;
  evidenceType: TaskEvidenceRecordType;
  status: TaskEvidenceEventStatus;
  summary: string;
  confidence: number;
  raw?: Record<string, unknown>;
}): Promise<TaskEvidenceEventRow> {
  const row: TaskEvidenceEventRow = {
    id: crypto.randomUUID(),
    task_id: input.taskId.trim(),
    occurrence_id: input.occurrenceId ? input.occurrenceId.trim() : null,
    repeat_index: Math.max(1, Math.floor(input.repeatIndex)),
    attempt_index: Math.max(1, Math.floor(input.attemptIndex)),
    evidence_type: normalizeTaskEvidenceRecordType(input.evidenceType),
    status: normalizeTaskEvidenceEventStatus(input.status),
    summary: input.summary.trim().slice(0, 500),
    confidence: toConfidence(input.confidence),
    raw: input.raw && typeof input.raw === "object" ? input.raw : {},
    created_at: new Date().toISOString(),
  };
  await withWrite((db) => {
    db.run(
      `INSERT INTO task_evidence_events
       (id, task_id, occurrence_id, repeat_index, attempt_index, evidence_type, status, summary, confidence, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.task_id,
        row.occurrence_id,
        row.repeat_index,
        row.attempt_index,
        row.evidence_type,
        row.status,
        row.summary,
        row.confidence,
        JSON.stringify(row.raw ?? {}),
        row.created_at,
      ],
    );
  });
  return row;
}

export async function listTaskEvidenceEventsFromDb(
  options: {
    taskId?: string;
    limit?: number;
  } = {},
): Promise<TaskEvidenceEventRow[]> {
  const db = await loadDatabase();
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 300)));
  const result = options.taskId
    ? db.exec(
        `SELECT id, task_id, occurrence_id, repeat_index, attempt_index, evidence_type, status, summary, confidence, raw_json, created_at
         FROM task_evidence_events
         WHERE task_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [options.taskId.trim(), limit],
      )
    : db.exec(
        `SELECT id, task_id, occurrence_id, repeat_index, attempt_index, evidence_type, status, summary, confidence, raw_json, created_at
         FROM task_evidence_events
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit],
      );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => ({
    id: getTextValue(row[0]),
    task_id: getTextValue(row[1]),
    occurrence_id: row[2] == null ? null : getTextValue(row[2]),
    repeat_index: Number(row[3]),
    attempt_index: Number(row[4]),
    evidence_type: normalizeTaskEvidenceRecordType(getTextValue(row[5])),
    status: normalizeTaskEvidenceEventStatus(getTextValue(row[6])),
    summary: getTextValue(row[7]),
    confidence: toConfidence(Number(row[8])),
    raw: parseJsonRecord(getTextValue(row[9])),
    created_at: getTextValue(row[10]),
  }));
}

function mapTaskOccurrenceRow(raw: unknown[]): TaskOccurrenceRow {
  return {
    id: getTextValue(raw[0]),
    task_id: getTextValue(raw[1]),
    occurrence_index: Math.max(1, Number(raw[2]) || 1),
    scheduled_date: getTextValue(raw[3]),
    deadline_at: getTextValue(raw[4]),
    status: normalizeTaskOccurrenceStatus(getTextValue(raw[5])),
    review_state: normalizeTaskOccurrenceReviewState(getTextValue(raw[6])),
    reviewed_at: raw[7] == null ? null : getTextValue(raw[7]),
    completed_at: raw[8] == null ? null : getTextValue(raw[8]),
    metadata: parseJsonRecord(raw[9] == null ? "{}" : getTextValue(raw[9])),
    created_at: getTextValue(raw[10]),
    updated_at: getTextValue(raw[11]),
  };
}

export async function createTaskOccurrencesInDb(input: {
  taskId: string;
  occurrences: Array<{
    occurrence_index: number;
    scheduled_date: string;
    deadline_at: string;
    status?: TaskOccurrenceStatus;
    review_state?: TaskOccurrenceReviewState;
    reviewed_at?: string | null;
    completed_at?: string | null;
    metadata?: Record<string, unknown>;
  }>;
}): Promise<TaskOccurrenceRow[]> {
  const created: TaskOccurrenceRow[] = [];
  const nowIso = new Date().toISOString();
  await withWrite((db) => {
    for (const item of input.occurrences) {
      const row: TaskOccurrenceRow = {
        id: crypto.randomUUID(),
        task_id: input.taskId.trim(),
        occurrence_index: Math.max(1, Math.floor(item.occurrence_index)),
        scheduled_date: item.scheduled_date.trim().slice(0, 20),
        deadline_at: item.deadline_at,
        status: normalizeTaskOccurrenceStatus(item.status ?? "pending"),
        review_state: normalizeTaskOccurrenceReviewState(item.review_state ?? "not_required"),
        reviewed_at: item.reviewed_at ?? null,
        completed_at: item.completed_at ?? null,
        metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
        created_at: nowIso,
        updated_at: nowIso,
      };
      db.run(
        `INSERT INTO task_occurrences
         (id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.task_id,
          row.occurrence_index,
          row.scheduled_date,
          row.deadline_at,
          row.status,
          row.review_state,
          row.reviewed_at,
          row.completed_at,
          JSON.stringify(row.metadata ?? {}),
          row.created_at,
          row.updated_at,
        ],
      );
      created.push(row);
    }
  });
  return created;
}

export async function listTaskOccurrencesFromDb(
  options: {
    taskId?: string;
    status?: TaskOccurrenceStatus | "all";
    limit?: number;
  } = {},
): Promise<TaskOccurrenceRow[]> {
  const db = await loadDatabase();
  const limit = Math.max(1, Math.min(2000, Math.floor(options.limit ?? 1000)));
  const status = options.status ?? "all";
  const taskId = typeof options.taskId === "string" ? options.taskId.trim() : "";
  const result =
    status === "all"
      ? taskId
        ? db.exec(
            `SELECT id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at
             FROM task_occurrences
             WHERE task_id = ?
             ORDER BY occurrence_index ASC
             LIMIT ?`,
            [taskId, limit],
          )
        : db.exec(
            `SELECT id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at
             FROM task_occurrences
             ORDER BY created_at DESC
             LIMIT ?`,
            [limit],
          )
      : taskId
        ? db.exec(
            `SELECT id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at
             FROM task_occurrences
             WHERE task_id = ? AND status = ?
             ORDER BY occurrence_index ASC
             LIMIT ?`,
            [taskId, status, limit],
          )
        : db.exec(
            `SELECT id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at
             FROM task_occurrences
             WHERE status = ?
             ORDER BY created_at DESC
             LIMIT ?`,
            [status, limit],
          );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => mapTaskOccurrenceRow(row));
}

export async function getTaskOccurrenceByIdFromDb(
  occurrenceId: string,
): Promise<TaskOccurrenceRow | null> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at
     FROM task_occurrences
     WHERE id = ?
     LIMIT 1`,
    [occurrenceId.trim()],
  );
  if (!result.length || result[0].values.length === 0) {
    return null;
  }
  return mapTaskOccurrenceRow(result[0].values[0]);
}

export async function findNextPendingTaskOccurrenceInDb(
  taskId: string,
): Promise<TaskOccurrenceRow | null> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT id, task_id, occurrence_index, scheduled_date, deadline_at, status, review_state, reviewed_at, completed_at, metadata_json, created_at, updated_at
     FROM task_occurrences
     WHERE task_id = ? AND status = 'pending'
     ORDER BY deadline_at ASC, occurrence_index ASC
     LIMIT 1`,
    [taskId.trim()],
  );
  if (!result.length || result[0].values.length === 0) {
    return null;
  }
  return mapTaskOccurrenceRow(result[0].values[0]);
}

export async function updateTaskOccurrenceInDb(
  occurrenceId: string,
  patch: Partial<{
    status: TaskOccurrenceStatus;
    review_state: TaskOccurrenceReviewState;
    reviewed_at: string | null;
    completed_at: string | null;
    deadline_at: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<TaskOccurrenceRow | null> {
  const current = await getTaskOccurrenceByIdFromDb(occurrenceId);
  if (!current) {
    return null;
  }
  const next: TaskOccurrenceRow = {
    ...current,
    status:
      patch.status !== undefined ? normalizeTaskOccurrenceStatus(patch.status) : current.status,
    review_state:
      patch.review_state !== undefined
        ? normalizeTaskOccurrenceReviewState(patch.review_state)
        : current.review_state,
    reviewed_at: patch.reviewed_at !== undefined ? patch.reviewed_at : current.reviewed_at,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : current.completed_at,
    deadline_at: typeof patch.deadline_at === "string" ? patch.deadline_at : current.deadline_at,
    metadata:
      patch.metadata && typeof patch.metadata === "object" ? patch.metadata : current.metadata,
    updated_at: new Date().toISOString(),
  };
  await withWrite((db) => {
    db.run(
      `UPDATE task_occurrences
       SET status = ?, review_state = ?, reviewed_at = ?, completed_at = ?, deadline_at = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.status,
        next.review_state,
        next.reviewed_at,
        next.completed_at,
        next.deadline_at,
        JSON.stringify(next.metadata ?? {}),
        next.updated_at,
        next.id,
      ],
    );
  });
  return next;
}

export async function markMissedTaskOccurrencesInDb(
  nowIso = new Date().toISOString(),
): Promise<number> {
  return withWrite((db) => {
    db.run(
      `UPDATE task_occurrences
       SET status = 'missed', updated_at = ?
       WHERE status = 'pending' AND deadline_at <= ?`,
      [nowIso, nowIso],
    );
    const changed = db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0];
    return Number(changed) || 0;
  });
}

export async function appendTaskOutcomeEventInDb(input: {
  taskId: string;
  outcomeType: TaskOutcomeType;
  catalogId?: string | null;
  summary: string;
  params?: Record<string, unknown>;
}): Promise<TaskOutcomeEventRow> {
  const row: TaskOutcomeEventRow = {
    id: crypto.randomUUID(),
    task_id: input.taskId.trim(),
    outcome_type: normalizeTaskOutcomeType(input.outcomeType),
    catalog_id:
      typeof input.catalogId === "string" && input.catalogId.trim().length > 0
        ? input.catalogId.trim().slice(0, 64)
        : null,
    summary: input.summary.trim().slice(0, 500),
    params: input.params && typeof input.params === "object" ? input.params : {},
    created_at: new Date().toISOString(),
  };
  await withWrite((db) => {
    db.run(
      `INSERT INTO task_outcome_events
       (id, task_id, outcome_type, catalog_id, summary, params_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.task_id,
        row.outcome_type,
        row.catalog_id,
        row.summary,
        JSON.stringify(row.params ?? {}),
        row.created_at,
      ],
    );
  });
  return row;
}

export async function listTaskOutcomeEventsFromDb(
  options: {
    taskId?: string;
    limit?: number;
  } = {},
): Promise<TaskOutcomeEventRow[]> {
  const db = await loadDatabase();
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 300)));
  const result = options.taskId
    ? db.exec(
        `SELECT id, task_id, outcome_type, catalog_id, summary, params_json, created_at
         FROM task_outcome_events
         WHERE task_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [options.taskId.trim(), limit],
      )
    : db.exec(
        `SELECT id, task_id, outcome_type, catalog_id, summary, params_json, created_at
         FROM task_outcome_events
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit],
      );
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => ({
    id: getTextValue(row[0]),
    task_id: getTextValue(row[1]),
    outcome_type: normalizeTaskOutcomeType(getTextValue(row[2])),
    catalog_id: row[3] == null ? null : getTextValue(row[3]),
    summary: getTextValue(row[4]),
    params: parseJsonRecord(row[5] == null ? "{}" : getTextValue(row[5])),
    created_at: getTextValue(row[6]),
  }));
}

export async function getTaskPreferencesFromDb(): Promise<TaskPreferencesRow> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT require_reward_consequence_approval
     FROM task_preferences
     WHERE id = 1
     LIMIT 1`,
  );
  if (!result.length || result[0].values.length === 0) {
    return { require_reward_consequence_approval: true };
  }
  const row = result[0].values[0];
  return {
    require_reward_consequence_approval: fromBooleanInt(row[0]),
  };
}

export async function upsertTaskPreferencesInDb(
  patch: Partial<TaskPreferencesRow>,
): Promise<TaskPreferencesRow> {
  const current = await getTaskPreferencesFromDb();
  const next: TaskPreferencesRow = {
    require_reward_consequence_approval:
      typeof patch.require_reward_consequence_approval === "boolean"
        ? patch.require_reward_consequence_approval
        : current.require_reward_consequence_approval,
  };
  await withWrite((db) => {
    db.run(
      `INSERT INTO task_preferences (id, require_reward_consequence_approval)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET
         require_reward_consequence_approval = excluded.require_reward_consequence_approval`,
      [toBooleanInt(next.require_reward_consequence_approval)],
    );
  });
  return next;
}

export async function getProfileProgressFromDb(): Promise<ProfileProgressRow> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT total_points, current_tier, free_pass_count, streak_days, last_task_completed_at, last_completion_summary, updated_at
     FROM profile_progress
     WHERE id = 1
     LIMIT 1`,
  );
  if (!result.length || result[0].values.length === 0) {
    return {
      total_points: 0,
      current_tier: "bronze",
      free_pass_count: 0,
      streak_days: 0,
      last_task_completed_at: null,
      last_completion_summary: null,
      updated_at: new Date().toISOString(),
    };
  }
  const row = result[0].values[0];
  return {
    total_points: Math.max(0, Number(row[0]) || 0),
    current_tier: normalizeProfileProgressTier(getTextValue(row[1])),
    free_pass_count: Math.max(0, Number(row[2]) || 0),
    streak_days: Math.max(0, Number(row[3]) || 0),
    last_task_completed_at: row[4] == null ? null : getTextValue(row[4]),
    last_completion_summary: row[5] == null ? null : getTextValue(row[5]),
    updated_at: getTextValue(row[6]),
  };
}

export async function upsertProfileProgressInDb(
  patch: Partial<ProfileProgressRow>,
): Promise<ProfileProgressRow> {
  const current = await getProfileProgressFromDb();
  const next: ProfileProgressRow = {
    total_points:
      typeof patch.total_points === "number" && Number.isFinite(patch.total_points)
        ? Math.max(0, Math.floor(patch.total_points))
        : current.total_points,
    current_tier:
      patch.current_tier !== undefined
        ? normalizeProfileProgressTier(patch.current_tier)
        : current.current_tier,
    free_pass_count:
      typeof patch.free_pass_count === "number" && Number.isFinite(patch.free_pass_count)
        ? Math.max(0, Math.floor(patch.free_pass_count))
        : current.free_pass_count,
    streak_days:
      typeof patch.streak_days === "number" && Number.isFinite(patch.streak_days)
        ? Math.max(0, Math.floor(patch.streak_days))
        : current.streak_days,
    last_task_completed_at:
      patch.last_task_completed_at !== undefined
        ? patch.last_task_completed_at
        : current.last_task_completed_at,
    last_completion_summary:
      patch.last_completion_summary !== undefined
        ? patch.last_completion_summary
        : current.last_completion_summary,
    updated_at: new Date().toISOString(),
  };

  await withWrite((db) => {
    db.run(
      `INSERT INTO profile_progress
       (id, total_points, current_tier, free_pass_count, streak_days, last_task_completed_at, last_completion_summary, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         total_points = excluded.total_points,
         current_tier = excluded.current_tier,
         free_pass_count = excluded.free_pass_count,
         streak_days = excluded.streak_days,
         last_task_completed_at = excluded.last_task_completed_at,
         last_completion_summary = excluded.last_completion_summary,
         updated_at = excluded.updated_at`,
      [
        next.total_points,
        next.current_tier,
        next.free_pass_count,
        next.streak_days,
        next.last_task_completed_at,
        next.last_completion_summary,
        next.updated_at,
      ],
    );
  });

  return next;
}

export async function deleteAllTasksData(): Promise<void> {
  await withWrite((db) => {
    db.run(`DELETE FROM task_evidence_events`);
    db.run(`DELETE FROM task_occurrences`);
    db.run(`DELETE FROM task_outcome_events`);
    db.run(`DELETE FROM tasks`);
    db.run(`DELETE FROM task_preferences`);
    db.run(`DELETE FROM profile_progress`);
    db.run(
      `INSERT OR IGNORE INTO task_preferences
       (id, require_reward_consequence_approval)
       VALUES (1, 1)`,
    );
    db.run(
      `INSERT OR IGNORE INTO profile_progress
       (id, total_points, current_tier, streak_days, last_task_completed_at, last_completion_summary, updated_at)
       VALUES (1, 0, 'bronze', 0, NULL, NULL, ?)`,
      [new Date().toISOString()],
    );
    db.run(`DELETE FROM runtime_state`);
    db.run(
      `INSERT OR IGNORE INTO runtime_state
       (id, emergency_stop, emergency_stop_reason, emergency_stop_updated_at)
       VALUES (1, 0, NULL, ?)`,
      [new Date().toISOString()],
    );
  });
}

export async function getRelationshipStateFromDb(): Promise<RelationshipStateRow> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT trust_score, rapport_score, reliability_score, relationship_label, last_updated_ts
     FROM relationship_state
     WHERE id = 1
     LIMIT 1`,
  );
  if (!result.length || result[0].values.length === 0) {
    return {
      trust_score: 50,
      rapport_score: 50,
      reliability_score: 50,
      relationship_label: "building",
      last_updated_ts: Date.now(),
    };
  }

  const row = result[0].values[0];
  return {
    trust_score: Number(row[0]),
    rapport_score: Number(row[1]),
    reliability_score: Number(row[2]),
    relationship_label: getTextValue(row[3]),
    last_updated_ts: Number(row[4]),
  };
}

export async function upsertRelationshipStateInDb(input: RelationshipStateRow): Promise<void> {
  await withWrite((db) => {
    db.run(
      `INSERT INTO relationship_state
       (id, trust_score, rapport_score, reliability_score, relationship_label, last_updated_ts)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         trust_score = excluded.trust_score,
         rapport_score = excluded.rapport_score,
         reliability_score = excluded.reliability_score,
         relationship_label = excluded.relationship_label,
         last_updated_ts = excluded.last_updated_ts`,
      [
        Number(input.trust_score),
        Number(input.rapport_score),
        Number(input.reliability_score),
        input.relationship_label,
        Math.floor(input.last_updated_ts),
      ],
    );
  });
}

export async function getRuntimeStateFromDb(): Promise<RuntimeStateRow> {
  const db = await loadDatabase();
  const result = db.exec(
    `SELECT emergency_stop, emergency_stop_reason, emergency_stop_updated_at
     FROM runtime_state
     WHERE id = 1
     LIMIT 1`,
  );
  if (!result.length || result[0].values.length === 0) {
    return {
      emergency_stop: false,
      emergency_stop_reason: null,
      emergency_stop_updated_at: new Date().toISOString(),
    };
  }

  const row = result[0].values[0];
  return {
    emergency_stop: Number(row[0]) === 1,
    emergency_stop_reason: row[1] == null ? null : getTextValue(row[1]),
    emergency_stop_updated_at: getTextValue(row[2]),
  };
}

export async function upsertRuntimeStateInDb(
  input: Partial<RuntimeStateRow>,
): Promise<RuntimeStateRow> {
  const current = await getRuntimeStateFromDb();
  const next: RuntimeStateRow = {
    emergency_stop:
      typeof input.emergency_stop === "boolean" ? input.emergency_stop : current.emergency_stop,
    emergency_stop_reason:
      input.emergency_stop_reason !== undefined
        ? input.emergency_stop_reason
        : current.emergency_stop_reason,
    emergency_stop_updated_at:
      typeof input.emergency_stop_updated_at === "string" &&
      input.emergency_stop_updated_at.trim().length > 0
        ? input.emergency_stop_updated_at
        : current.emergency_stop_updated_at,
  };

  await withWrite((db) => {
    db.run(
      `INSERT INTO runtime_state
       (id, emergency_stop, emergency_stop_reason, emergency_stop_updated_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         emergency_stop = excluded.emergency_stop,
         emergency_stop_reason = excluded.emergency_stop_reason,
         emergency_stop_updated_at = excluded.emergency_stop_updated_at`,
      [
        toBooleanInt(next.emergency_stop),
        next.emergency_stop_reason,
        next.emergency_stop_updated_at,
      ],
    );
  });

  return next;
}

export async function __resetDbForTests(options: { deleteFile?: boolean } = {}): Promise<void> {
  if (databasePromise) {
    const db = await databasePromise;
    db.close();
  }
  sqlitePromise = null;
  databasePromise = null;
  writeChain = Promise.resolve();
  if (options.deleteFile && fs.existsSync(DB_FILE)) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(DB_FILE, { force: true });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";
        if (code !== "EPERM" && code !== "EBUSY") {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    if (lastError && fs.existsSync(DB_FILE)) {
      throw lastError;
    }
  }
}
