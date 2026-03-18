import type {
  ProfileProgressRow,
  ProfileProgressTier,
  TaskCameraCheck,
  TaskEvidencePolicy,
  TaskEvidenceEventRow,
  TaskEvidenceRecordType,
  TaskEvidenceType,
  TaskOccurrenceRow,
  TaskPlanSelection,
  TaskProgramKind,
  TaskRow,
  TaskSchedulePolicy,
  TaskScheduleType,
  TaskStrictnessMode,
} from "../db.ts";
import type { EvidenceAnalysisResult } from "../vision/evidence-provider.ts";
import { normalizeEvidenceAnalysisResult } from "../vision/evidence-provider.ts";
import {
  evaluateCapabilityFromObservation,
  type VerificationCapabilityCatalogEntry,
} from "../camera/vision-capabilities.ts";
import type { VisionObservation } from "../camera/observation.ts";

export type RewardConsequencePlanRequest = {
  catalog_id: string;
  params?: Record<string, unknown>;
};

export type CreateTaskRequestType =
  | "create_task"
  | "create_rule"
  | "create_habit"
  | "create_challenge";

export type CreateTaskRequest = {
  type: CreateTaskRequestType;
  title: string;
  description: string;
  window_seconds: number;
  repeats_required: number;
  points_possible: number;
  schedule: {
    type: TaskScheduleType;
    days?: number;
    occurrences_per_day?: number;
    start_date?: string;
    end_date?: string;
    allow_make_up?: boolean;
  };
  evidence: {
    required: boolean;
    type: TaskEvidenceType;
    checks: Array<{
      capability: string;
      required_duration_ms?: number;
      confidence_threshold?: number;
      params?: Record<string, unknown>;
    }>;
    max_attempts: number;
    deny_user_override: boolean;
  };
  reward_plan?: RewardConsequencePlanRequest;
  consequence_plan?: RewardConsequencePlanRequest;
  per_repeat_timeout_seconds?: number;
  program_kind?: TaskProgramKind;
  strictness_mode?: TaskStrictnessMode;
};

export type TaskValidationResult = {
  request: CreateTaskRequest;
  notes: string[];
  downgraded: boolean;
  schedulePolicy: TaskSchedulePolicy;
  rewardPlan: TaskPlanSelection;
  consequencePlan: TaskPlanSelection;
};

export type TaskEvidenceEvaluation = {
  status: "pass" | "fail" | "inconclusive";
  confidence: number;
  summary: string;
  details: Array<{
    capability: string;
    status: "pass" | "fail" | "inconclusive";
    confidence: number;
    summary: string;
  }>;
};

export type TaskCatalogItemType = "reward" | "consequence";

export type TaskCatalogItem = {
  id: string;
  type: TaskCatalogItemType;
  description: string;
  schema: Record<string, { type: "number" | "string" | "boolean"; min?: number; max?: number; enum?: string[] }>;
  default_params: Record<string, unknown>;
  max_severity: number;
};

export type TaskReviewQueueItem = {
  task_id: string;
  occurrence_id: string;
  title: string;
  program_kind: TaskProgramKind;
  strictness_mode: TaskStrictnessMode;
  scheduled_date: string;
  deadline_at: string;
  evidence_type: TaskEvidenceType;
  attempts_used: number;
  max_attempts: number;
  review_state: "awaiting_submission" | "submitted_for_review" | "needs_retry";
  last_status: string | null;
  last_summary: string | null;
  preview_image_data_url: string | null;
  analysis_status: EvidenceAnalysisResult["status"] | null;
  analysis_mode: "baseline_assisted" | "baseline_free" | null;
  analysis_summary: string | null;
  analysis_confidence: number | null;
  analysis_provider_id: string | null;
  analysis_signals: EvidenceAnalysisResult["signals"];
  baseline_source: "none" | "manual" | "carried_forward";
  baseline_set_at: string | null;
};

export type TaskReviewQueueBuckets = {
  awaitingSubmission: TaskReviewQueueItem[];
  pendingReview: TaskReviewQueueItem[];
  needsRetry: TaskReviewQueueItem[];
};

function taskUsesOccurrenceReview(task: Pick<TaskRow, "program_kind" | "evidence_policy">): boolean {
  if (task.program_kind === "task") {
    return false;
  }
  return task.evidence_policy.type !== "camera";
}

export function shouldTaskRouteEvidenceToReview(input: {
  task: Pick<TaskRow, "program_kind" | "evidence_policy">;
  evidenceType: TaskEvidenceRecordType;
  status: TaskEvidenceEventRow["status"];
}): boolean {
  if (!taskUsesOccurrenceReview(input.task)) {
    return false;
  }
  if (input.evidenceType !== "manual") {
    return false;
  }
  return input.status === "pass_manual";
}

const TIER_THRESHOLDS: Array<{ tier: ProfileProgressTier; minPoints: number }> = [
  { tier: "bronze", minPoints: 0 },
  { tier: "silver", minPoints: 50 },
  { tier: "gold", minPoints: 150 },
  { tier: "platinum", minPoints: 300 },
];

const TIER_REWARDS: Record<ProfileProgressTier, string[]> = {
  bronze: ["Badge: Bronze Discipline", "Mode: Basic scripted and dynamic sessions"],
  silver: ["Badge: Silver Consistency", "Unlock: medium challenge presets"],
  gold: ["Badge: Gold Reliability", "Unlock: advanced challenge presets"],
  platinum: [
    "Badge: Platinum Commitment",
    "Unlock: premium progression tracks",
    "Privilege: shorter recovery sessions",
  ],
};

export const TASK_REWARD_CATALOG: TaskCatalogItem[] = [
  {
    id: "reward_points_bonus",
    type: "reward",
    description: "Grant a points bonus when a task completes.",
    schema: {
      bonus_points: { type: "number", min: 0, max: 50 },
    },
    default_params: { bonus_points: 5 },
    max_severity: 5,
  },
  {
    id: "reward_unlock_mode",
    type: "reward",
    description: "Unlock an app progression mode.",
    schema: {
      mode: { type: "string", enum: ["challenge_plus", "dynamic_plus"] },
    },
    default_params: { mode: "challenge_plus" },
    max_severity: 4,
  },
  {
    id: "reward_badge",
    type: "reward",
    description: "Award a themed badge tied to discipline and completion.",
    schema: {
      badge: { type: "string", enum: ["obedience_bronze", "consistency_silver", "discipline_gold"] },
    },
    default_params: { badge: "obedience_bronze" },
    max_severity: 3,
  },
  {
    id: "reward_positive_message",
    type: "reward",
    description: "Apply an app controlled positive dominant message template.",
    schema: {
      template_id: { type: "string", enum: ["approval_brief", "approval_warm", "approval_firm"] },
    },
    default_params: { template_id: "approval_firm" },
    max_severity: 2,
  },
  {
    id: "reward_reduce_next_difficulty",
    type: "reward",
    description: "Reduce next task difficulty slightly.",
    schema: {
      by: { type: "number", min: 0, max: 1 },
    },
    default_params: { by: 1 },
    max_severity: 2,
  },
];

export const TASK_CONSEQUENCE_CATALOG: TaskCatalogItem[] = [
  {
    id: "penalty_points",
    type: "consequence",
    description: "Apply a points penalty on task failure.",
    schema: {
      penalty_points: { type: "number", min: 0, max: 30 },
    },
    default_params: { penalty_points: 5 },
    max_severity: 5,
  },
  {
    id: "lock_feature_temp",
    type: "consequence",
    description: "Temporarily lock an app feature for a short duration.",
    schema: {
      feature: { type: "string", enum: ["advanced_challenges", "bonus_tracks"] },
      duration_hours: { type: "number", min: 1, max: 48 },
    },
    default_params: { feature: "advanced_challenges", duration_hours: 12 },
    max_severity: 4,
  },
  {
    id: "increase_next_difficulty",
    type: "consequence",
    description: "Increase next task difficulty slightly.",
    schema: {
      by: { type: "number", min: 0, max: 1 },
    },
    default_params: { by: 1 },
    max_severity: 3,
  },
  {
    id: "extra_occurrence_next_day",
    type: "consequence",
    description: "Require extra occurrence count on the next day.",
    schema: {
      count: { type: "number", min: 1, max: 3 },
    },
    default_params: { count: 1 },
    max_severity: 3,
  },
  {
    id: "reset_streak",
    type: "consequence",
    description: "Reset current task streak state.",
    schema: {},
    default_params: {},
    max_severity: 2,
  },
];

const DEFAULT_REWARD_ID = "reward_positive_message";
const DEFAULT_CONSEQUENCE_ID = "penalty_points";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampUnit(value: number, fallback = 0.7): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function normalizeProgramKind(value: unknown): TaskProgramKind | undefined {
  if (
    value === "task" ||
    value === "habit" ||
    value === "rule" ||
    value === "challenge"
  ) {
    return value;
  }
  return undefined;
}

function normalizeStrictnessMode(value: unknown): TaskStrictnessMode | undefined {
  if (value === "standard" || value === "soft" || value === "hard") {
    return value;
  }
  return undefined;
}

function inferProgramKind(
  request: CreateTaskRequest,
  schedulePolicy: TaskSchedulePolicy,
): TaskProgramKind {
  if (request.type === "create_rule") {
    return "rule";
  }
  if (request.type === "create_habit") {
    return "habit";
  }
  if (request.type === "create_challenge") {
    return "challenge";
  }
  const explicit = normalizeProgramKind(request.program_kind);
  if (explicit) {
    return explicit;
  }
  if (
    schedulePolicy.type === "daily" &&
    Math.max(1, schedulePolicy.days ?? 1) >= 7
  ) {
    return "challenge";
  }
  if (schedulePolicy.type === "daily") {
    return "habit";
  }
  if (!request.evidence.required && request.points_possible <= 1) {
    return "rule";
  }
  return "task";
}

function inferCreateTaskActionType(
  request: CreateTaskRequest,
  schedulePolicy: TaskSchedulePolicy,
): CreateTaskRequestType {
  if (
    request.type === "create_rule" ||
    request.type === "create_habit" ||
    request.type === "create_challenge"
  ) {
    return request.type;
  }

  const explicit = normalizeProgramKind(request.program_kind);
  if (explicit === "rule") {
    return "create_rule";
  }
  if (explicit === "habit") {
    return "create_habit";
  }
  if (explicit === "challenge") {
    return "create_challenge";
  }

  const content = `${request.title} ${request.description}`.toLowerCase();
  const looksLikeRule = /\b(rule|protocol|standing rule|standing order|always|never|ongoing)\b/.test(
    content,
  );
  const looksLikeChallenge =
    /\b(challenge|program|streak|bootcamp|block)\b/.test(content) ||
    /\b\d+\s*(day|days|week|weeks)\b/.test(content);
  const looksLikeHabit = /\b(daily|habit|routine|recurring|every day|each day|practice)\b/.test(
    content,
  );

  if (looksLikeChallenge) {
    return "create_challenge";
  }
  if (looksLikeRule) {
    return "create_rule";
  }
  if (looksLikeHabit) {
    return "create_habit";
  }

  const inferredKind = inferProgramKind(request, schedulePolicy);
  if (inferredKind === "rule") {
    return "create_rule";
  }
  if (inferredKind === "habit") {
    return "create_habit";
  }
  if (inferredKind === "challenge") {
    return "create_challenge";
  }
  return "create_task";
}

function inferStrictnessMode(
  request: CreateTaskRequest,
  schedulePolicy: TaskSchedulePolicy,
): TaskStrictnessMode {
  const explicit = normalizeStrictnessMode(request.strictness_mode);
  if (explicit) {
    return explicit;
  }
  if (request.evidence.type === "camera" && request.evidence.deny_user_override) {
    return "hard";
  }
  if (schedulePolicy.type === "daily" && schedulePolicy.allow_make_up) {
    return "soft";
  }
  return "standard";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeYmd(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function getLocalDateParts(now = new Date()): { year: number; month: number; day: number } {
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

function localYmdFromParts(parts: { year: number; month: number; day: number }): string {
  const date = new Date(parts.year, parts.month, parts.day);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdLocalStart(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function toLocalEndOfDayIso(ymd: string): string {
  const start = parseYmdLocalStart(ymd);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function shiftYmd(ymd: string, days: number): string {
  const start = parseYmdLocalStart(ymd);
  start.setDate(start.getDate() + days);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function inclusiveDayDiff(startYmd: string, endYmd: string): number {
  const [startYear, startMonth, startDay] = startYmd.split("-").map((part) => Number(part));
  const [endYear, endMonth, endDay] = endYmd.split("-").map((part) => Number(part));
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay, 0, 0, 0, 0);
  const diffMs = endUtc - startUtc;
  return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
}

function extractJsonCodeBlockCandidates(text: string): string[] {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  return matches
    .map((match) => (typeof match[1] === "string" ? match[1].trim() : ""))
    .filter((candidate) => candidate.startsWith("{") && candidate.endsWith("}"));
}

function extractBalancedJsonCandidates(text: string): string[] {
  const results: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") {
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const ch = text[end];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, end + 1).trim();
          if (candidate.startsWith("{") && candidate.endsWith("}")) {
            results.push(candidate);
          }
          break;
        }
      }
    }
  }
  return results;
}

function normalizeChecks(value: unknown): TaskCameraCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const checks: TaskCameraCheck[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const capability = typeof row.capability === "string" ? row.capability.trim() : "";
    if (!capability) {
      continue;
    }
    const check: TaskCameraCheck = { capability };
    if (
      typeof row.required_duration_ms === "number" &&
      Number.isFinite(row.required_duration_ms)
    ) {
      check.required_duration_ms = clampInt(row.required_duration_ms, 200, 60_000);
    }
    if (
      typeof row.confidence_threshold === "number" &&
      Number.isFinite(row.confidence_threshold)
    ) {
      check.confidence_threshold = clampUnit(row.confidence_threshold, 0.7);
    }
    if (row.params && typeof row.params === "object" && !Array.isArray(row.params)) {
      check.params = row.params as Record<string, unknown>;
    }
    checks.push(check);
    if (checks.length >= 6) {
      break;
    }
  }
  return checks;
}

function normalizeSchedule(input: unknown): CreateTaskRequest["schedule"] {
  const row = asRecord(input);
  const typeRaw = typeof row?.type === "string" ? row.type : "one_time";
  const type: TaskScheduleType = typeRaw === "daily" ? "daily" : "one_time";
  if (type === "one_time") {
    return { type: "one_time" };
  }
  const nowParts = getLocalDateParts();
  const defaultStart = localYmdFromParts(nowParts);
  const days = clampInt(Number(row?.days), 1, 365);
  const occurrencesPerDay = clampInt(Number(row?.occurrences_per_day), 1, 24);
  const startDate =
    typeof row?.start_date === "string" ? normalizeYmd(row.start_date) : null;
  const endDate =
    typeof row?.end_date === "string" ? normalizeYmd(row.end_date) : null;
  return {
    type: "daily",
    days,
    occurrences_per_day: occurrencesPerDay,
    start_date: startDate ?? defaultStart,
    end_date: endDate ?? shiftYmd(startDate ?? defaultStart, days - 1),
    allow_make_up: row?.allow_make_up === true,
  };
}

function normalizePlanRequest(input: unknown): RewardConsequencePlanRequest | undefined {
  const row = asRecord(input);
  if (!row) {
    return undefined;
  }
  const catalogId = typeof row.catalog_id === "string" ? row.catalog_id.trim() : "";
  if (!catalogId) {
    return undefined;
  }
  return {
    catalog_id: catalogId,
    params:
      row.params && typeof row.params === "object" && !Array.isArray(row.params)
        ? (row.params as Record<string, unknown>)
        : {},
  };
}

export function parseCreateTaskRequest(input: unknown): CreateTaskRequest | null {
  const row = asRecord(input);
  const rawType = typeof row?.type === "string" ? row.type : "";
  if (
    !row ||
    (rawType !== "create_task" &&
      rawType !== "create_rule" &&
      rawType !== "create_habit" &&
      rawType !== "create_challenge")
  ) {
    return null;
  }
  const evidence = asRecord(row.evidence);
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 120) : "";
  const description =
    typeof row.description === "string" ? row.description.trim().slice(0, 500) : "";
  if (!title || !description) {
    return null;
  }
  const schedule = normalizeSchedule(row.schedule);
  const evidenceTypeRaw = typeof evidence?.type === "string" ? evidence.type : "manual";
  const evidenceType: TaskEvidenceType =
    evidenceTypeRaw === "camera" || evidenceTypeRaw === "mixed" ? evidenceTypeRaw : "manual";
  const legacyRepeats = clampInt(Number(row.repeats_required), 1, 365);
  const legacyWindow = clampInt(Number(row.window_seconds), 30, 2_592_000);

  return {
    type: rawType,
    title,
    description,
    window_seconds: legacyWindow,
    repeats_required: legacyRepeats,
    points_possible: clampInt(Number(row.points_possible), 1, 500),
    schedule,
    evidence: {
      required: evidence?.required !== false,
      type: evidenceType,
      checks: normalizeChecks(evidence?.checks),
      max_attempts: clampInt(Number(evidence?.max_attempts), 1, 10),
      deny_user_override:
        typeof evidence?.deny_user_override === "boolean"
          ? evidence.deny_user_override
          : evidenceType === "camera",
    },
    reward_plan: normalizePlanRequest(row.reward_plan),
    consequence_plan: normalizePlanRequest(row.consequence_plan),
    per_repeat_timeout_seconds:
      typeof row.per_repeat_timeout_seconds === "number" &&
      Number.isFinite(row.per_repeat_timeout_seconds)
        ? clampInt(row.per_repeat_timeout_seconds, 5, 3_600)
        : undefined,
    program_kind: normalizeProgramKind(row.program_kind),
    strictness_mode: normalizeStrictnessMode(row.strictness_mode),
  };
}

export function parseCreateTaskRequestFromText(text: string): CreateTaskRequest | null {
  const candidates = [
    ...extractJsonCodeBlockCandidates(text),
    ...extractBalancedJsonCandidates(text),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const request = parseCreateTaskRequest(parsed);
      if (request) {
        return request;
      }
    } catch {
      // ignore malformed json candidates
    }
  }
  return null;
}

export function stripCreateTaskJsonBlock(text: string): string {
  const withoutFence = text.replace(/```json\s*[\s\S]*?```/gi, "").trim();
  const cleaned = withoutFence
    .split("\n")
    .filter((line) => line.trim().toLowerCase() !== "json")
    .join("\n")
    .trim();
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function getCatalogItem(
  type: TaskCatalogItemType,
  id: string,
): TaskCatalogItem | null {
  const catalog = type === "reward" ? TASK_REWARD_CATALOG : TASK_CONSEQUENCE_CATALOG;
  return catalog.find((item) => item.id === id) ?? null;
}

function normalizeCatalogParams(
  item: TaskCatalogItem,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(item.schema)) {
    const raw = params[key];
    if (definition.type === "number") {
      const numeric = Number(raw);
      const fallback = Number(item.default_params[key] ?? 0);
      const min = Number.isFinite(definition.min) ? Number(definition.min) : fallback;
      const max = Number.isFinite(definition.max) ? Number(definition.max) : fallback;
      const normalized = Number.isFinite(numeric) ? numeric : fallback;
      next[key] = Math.max(min, Math.min(max, Number(normalized.toFixed(3))));
      continue;
    }
    if (definition.type === "boolean") {
      next[key] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : String(item.default_params[key] ?? "");
    if (definition.enum && definition.enum.length > 0) {
      next[key] = definition.enum.includes(text)
        ? text
        : String(item.default_params[key] ?? definition.enum[0]);
    } else {
      next[key] = text.slice(0, 80);
    }
  }
  return next;
}

export function toTaskPlanSelection(
  type: TaskCatalogItemType,
  request: RewardConsequencePlanRequest | undefined,
  options?: { requireApproval?: boolean },
): TaskPlanSelection {
  const fallbackId = type === "reward" ? DEFAULT_REWARD_ID : DEFAULT_CONSEQUENCE_ID;
  const defaultItem = getCatalogItem(type, fallbackId);
  const requestedItem =
    request && typeof request.catalog_id === "string"
      ? getCatalogItem(type, request.catalog_id)
      : null;
  const item = requestedItem ?? defaultItem;
  if (!item) {
    return {
      catalog_id: fallbackId,
      params: {},
      approval_status: options?.requireApproval ? "pending" : "auto_approved",
      updated_at: new Date().toISOString(),
    };
  }
  const normalizedParams = normalizeCatalogParams(item, request?.params ?? {});
  return {
    catalog_id: item.id,
    params: normalizedParams,
    approval_status: options?.requireApproval ? "pending" : "auto_approved",
    updated_at: new Date().toISOString(),
  };
}

export function normalizeTaskSchedulePolicy(
  request: CreateTaskRequest,
): TaskSchedulePolicy {
  const schedule = request.schedule;
  if (schedule.type !== "daily") {
    return {
      type: "one_time",
      window_seconds: clampInt(request.window_seconds, 30, 2_592_000),
      per_repeat_timeout_seconds:
        typeof request.per_repeat_timeout_seconds === "number"
          ? clampInt(request.per_repeat_timeout_seconds, 5, 3_600)
          : null,
      start_date: null,
      end_date: null,
      days: null,
      occurrences_per_day: 1,
      allow_make_up: false,
    };
  }
  const startDate = normalizeYmd(schedule.start_date ?? "") ?? localYmdFromParts(getLocalDateParts());
  const days = clampInt(Number(schedule.days), 1, 365);
  const occurrencesPerDay = clampInt(Number(schedule.occurrences_per_day), 1, 24);
  const endDateRaw = normalizeYmd(schedule.end_date ?? "") ?? shiftYmd(startDate, days - 1);
  const normalizedDays = inclusiveDayDiff(startDate, endDateRaw);
  return {
    type: "daily",
    window_seconds: normalizedDays * 86_400,
    per_repeat_timeout_seconds:
      typeof request.per_repeat_timeout_seconds === "number"
        ? clampInt(request.per_repeat_timeout_seconds, 5, 3_600)
        : null,
    start_date: startDate,
    end_date: endDateRaw,
    days: normalizedDays,
    occurrences_per_day: occurrencesPerDay,
    allow_make_up: schedule.allow_make_up === true,
  };
}

export function buildOccurrencesForSchedule(input: {
  schedulePolicy: TaskSchedulePolicy;
  repeatsRequired: number;
  dueAt: string;
}): Array<{
  occurrence_index: number;
  scheduled_date: string;
  deadline_at: string;
}> {
  const rows: Array<{
    occurrence_index: number;
    scheduled_date: string;
    deadline_at: string;
  }> = [];
  if (input.schedulePolicy.type !== "daily") {
    const dueDate = new Date(input.dueAt);
    const ymd = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(
      dueDate.getDate(),
    ).padStart(2, "0")}`;
    for (let index = 1; index <= input.repeatsRequired; index += 1) {
      rows.push({
        occurrence_index: index,
        scheduled_date: ymd,
        deadline_at: input.dueAt,
      });
    }
    return rows;
  }

  const start = input.schedulePolicy.start_date ?? localYmdFromParts(getLocalDateParts());
  const days = Math.max(1, input.schedulePolicy.days ?? 1);
  const perDay = Math.max(1, input.schedulePolicy.occurrences_per_day);
  let occurrenceIndex = 1;
  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const ymd = shiftYmd(start, dayIndex);
    const deadline = toLocalEndOfDayIso(ymd);
    for (let slot = 0; slot < perDay; slot += 1) {
      rows.push({
        occurrence_index: occurrenceIndex,
        scheduled_date: ymd,
        deadline_at: deadline,
      });
      occurrenceIndex += 1;
    }
  }
  return rows;
}

export function deriveTier(totalPoints: number): ProfileProgressTier {
  let current: ProfileProgressTier = "bronze";
  for (const row of TIER_THRESHOLDS) {
    if (totalPoints >= row.minPoints) {
      current = row.tier;
    }
  }
  return current;
}

export function getTierRewards(tier: ProfileProgressTier): string[] {
  return [...(TIER_REWARDS[tier] ?? TIER_REWARDS.bronze)];
}

export function summarizeTaskPlan(plan: TaskPlanSelection | null): string {
  if (!plan) {
    return "none";
  }
  const params = Object.entries(plan.params ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  return `${plan.catalog_id}${params ? ` (${params})` : ""}`;
}

export function buildTaskCatalogPromptBlock(): string {
  const lines: string[] = ["Reward catalog ids:"];
  for (const item of TASK_REWARD_CATALOG) {
    lines.push(`- ${item.id}: ${item.description}`);
  }
  lines.push("Consequence catalog ids:");
  for (const item of TASK_CONSEQUENCE_CATALOG) {
    lines.push(`- ${item.id}: ${item.description}`);
  }
  lines.push("Rule: Raven must only use catalog ids listed above.");
  return lines.join("\n");
}

export function buildTaskActionSchemaPromptBlock(): string {
  return [
    "Task actions:",
    '- Use exactly one JSON object inside a ```json code block when creating a compliance item.',
    '- Allowed types: create_task, create_rule, create_habit, create_challenge.',
    "- Use create_task for one-time or short standalone assignments.",
    "- Use create_rule for an ongoing protocol or standing rule.",
    "- Use create_habit for recurring compliance that should repeat over time.",
    "- Use create_challenge for a multi-day structured block with repeated occurrences.",
    "- Choose create_rule when the user wants an ongoing protocol, standing order, or permanent rule.",
    "- Choose create_habit when the user wants daily, recurring, or routine repetition.",
    "- Choose create_challenge when the user wants a multi-day block, streak, challenge, or program.",
    "- Do not default to create_task when rule, habit, or challenge fits better.",
    '- Shared schema: {"type":"create_task|create_rule|create_habit|create_challenge","title":"...","description":"...","schedule":{"type":"one_time|daily","days":3,"occurrences_per_day":3,"allow_make_up":false},"window_seconds":600,"repeats_required":3,"points_possible":10,"program_kind":"task|rule|habit|challenge","strictness_mode":"standard|soft|hard","evidence":{"required":true,"type":"camera|manual|mixed","checks":[{"capability":"presence","required_duration_ms":1500,"confidence_threshold":0.75}],"max_attempts":2,"deny_user_override":true},"reward_plan":{"catalog_id":"reward_points_bonus","params":{"bonus_points":5}},"consequence_plan":{"catalog_id":"penalty_points","params":{"penalty_points":5}}}',
    "- Keep normal conversation outside JSON.",
    "- Use only supported capability ids and only known reward and consequence catalog ids.",
    "- The app controls points, tiers, rewards, consequences, and review state.",
  ].join("\n");
}

export function buildTaskRewardPolicyBlock(freePassCount: number): string {
  const safeFreePassCount = Math.max(0, Math.floor(freePassCount));
  return [
    "Task reward policy:",
    `Free passes available: ${safeFreePassCount}`,
    "- Free passes are app controlled.",
    "- A banked free pass cancels the next Raven win consequence task once.",
    "- If no free pass is available, the normal consequence task can apply.",
    "- Raven may mention a free pass only when Task context shows one.",
    "- Raven must not invent any extra free pass effect.",
  ].join("\n");
}

export function buildProgressSummaryLines(progress: ProfileProgressRow): string[] {
  const lines = [
    `${progress.current_tier} tier, ${progress.total_points} point${
      progress.total_points === 1 ? "" : "s"
    }, ${progress.free_pass_count} free pass${progress.free_pass_count === 1 ? "" : "es"}.`,
  ];

  const summary = (progress.last_completion_summary ?? "").trim();
  if (!summary) {
    return lines;
  }

  const gameMatch = summary.match(/Game result:\s*([^.]+)\.\s*Winner:\s*([^.]+)\./i);
  if (gameMatch) {
    lines.push(`Latest game: ${gameMatch[1]?.trim() ?? "unknown"} (${gameMatch[2]?.trim() ?? "unknown"}).`);
  }

  const rewardMatch = summary.match(/Reward:\s*([^.]+)\./i);
  if (rewardMatch?.[1]) {
    lines.push(`Latest reward state: ${rewardMatch[1].trim()}.`);
  }

  const stakesMatch = summary.match(/Stakes applied:\s*([^.]+)\.?/i);
  if (stakesMatch?.[1] && stakesMatch[1].trim().toLowerCase() !== "none") {
    lines.push(`Latest stakes effect: ${stakesMatch[1].trim()}.`);
  }

  if (lines.length === 1) {
    lines.push(summary.length > 140 ? `${summary.slice(0, 140)}...` : summary);
  }

  return lines;
}

export function buildTaskReviewQueue(input: {
  activeTasks: TaskRow[];
  occurrences: TaskOccurrenceRow[];
  events: TaskEvidenceEventRow[];
}): TaskReviewQueueItem[] {
  const queue: TaskReviewQueueItem[] = [];
  for (const task of input.activeTasks) {
    const pendingOccurrence = input.occurrences
      .filter((occurrence) => occurrence.task_id === task.id && occurrence.status === "pending")
      .sort((left, right) => {
        if (left.deadline_at !== right.deadline_at) {
          return left.deadline_at.localeCompare(right.deadline_at);
        }
        return left.occurrence_index - right.occurrence_index;
      })[0];
    if (!pendingOccurrence) {
      continue;
    }
    const attempts = input.events
      .filter((event) => event.occurrence_id === pendingOccurrence.id)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
    const lastAttempt = attempts[attempts.length - 1] ?? null;
    const latestSubmittedEvidence = [...attempts]
      .reverse()
      .find(
        (event) =>
          event.status === "inconclusive" &&
          (event.evidence_type === "manual" || event.evidence_type === "file_upload"),
      );
    const latestAnalysis = normalizeEvidenceAnalysisResult(
      latestSubmittedEvidence?.raw?.evidence_analysis,
    );
    const analysisMode =
      latestAnalysis?.metadata?.baseline_used === "yes"
        ? "baseline_assisted"
        : latestAnalysis
          ? "baseline_free"
          : null;
    const usesReview = taskUsesOccurrenceReview(task);
    let reviewState: TaskReviewQueueItem["review_state"];
    if (pendingOccurrence.review_state === "pending_review") {
      reviewState = "submitted_for_review";
    } else if (pendingOccurrence.review_state === "rejected") {
      reviewState = "needs_retry";
    } else if (lastAttempt) {
      reviewState = "needs_retry";
    } else {
      reviewState = "awaiting_submission";
    }
    queue.push({
      task_id: task.id,
      occurrence_id: pendingOccurrence.id,
      title: task.title,
      program_kind: task.program_kind,
      strictness_mode: task.strictness_mode,
      scheduled_date: pendingOccurrence.scheduled_date,
      deadline_at: pendingOccurrence.deadline_at,
      evidence_type: task.evidence_policy.type,
      attempts_used: attempts.length,
      max_attempts: task.evidence_policy.max_attempts,
      review_state: reviewState,
      last_status: lastAttempt?.status ?? null,
      last_summary: lastAttempt?.summary ?? null,
      preview_image_data_url:
        latestSubmittedEvidence &&
        latestSubmittedEvidence.evidence_type === "file_upload" &&
        typeof latestSubmittedEvidence.raw?.image_data_url === "string"
          ? String(latestSubmittedEvidence.raw.image_data_url)
          : null,
      analysis_status: latestAnalysis?.status ?? null,
      analysis_mode: analysisMode,
      analysis_summary: latestAnalysis?.summary ?? null,
      analysis_confidence: latestAnalysis ? latestAnalysis.confidence : null,
      analysis_provider_id: latestAnalysis?.provider_id ?? null,
      analysis_signals: latestAnalysis?.signals ?? [],
      baseline_source:
        typeof pendingOccurrence.metadata?.evidence_baseline_source_occurrence_id === "string"
          ? "carried_forward"
          : typeof pendingOccurrence.metadata?.evidence_baseline_image_data_url === "string"
            ? "manual"
            : "none",
      baseline_set_at:
        typeof pendingOccurrence.metadata?.evidence_baseline_set_at === "string"
          ? String(pendingOccurrence.metadata.evidence_baseline_set_at)
          : null,
    });
    if (pendingOccurrence.review_state === "pending_review") {
      queue[queue.length - 1]!.last_status = "submitted_for_review";
    }
    if (usesReview && !lastAttempt) {
      queue[queue.length - 1]!.last_summary = "Awaiting reviewed evidence submission.";
    }
    if (!queue[queue.length - 1]!.last_summary && latestAnalysis?.summary) {
      queue[queue.length - 1]!.last_summary = latestAnalysis.summary;
    }
  }
  return queue.sort((left, right) => {
    const priority = (item: TaskReviewQueueItem) => {
      if (item.review_state === "submitted_for_review") {
        return 0;
      }
      if (item.review_state === "needs_retry") {
        return 1;
      }
      return 2;
    };
    const leftPriority = priority(left);
    const rightPriority = priority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    if (left.deadline_at !== right.deadline_at) {
      return left.deadline_at.localeCompare(right.deadline_at);
    }
    return left.title.localeCompare(right.title);
  });
}

export function partitionTaskReviewQueue(items: TaskReviewQueueItem[]): TaskReviewQueueBuckets {
  const buckets: TaskReviewQueueBuckets = {
    awaitingSubmission: [],
    pendingReview: [],
    needsRetry: [],
  };

  for (const item of items) {
    if (item.review_state === "submitted_for_review") {
      buckets.pendingReview.push(item);
      continue;
    }
    if (item.review_state === "needs_retry") {
      buckets.needsRetry.push(item);
      continue;
    }
    buckets.awaitingSubmission.push(item);
  }

  return buckets;
}

export function buildTaskContextBlock(input: {
  activeTasks: TaskRow[];
  progress: ProfileProgressRow;
  todayOccurrences?: Array<{ task_id: string; pending: number; completed: number; missed: number }>;
  reviewQueue?: TaskReviewQueueItem[];
}): string {
  const lines = [
    "Task context:",
    `Points: ${input.progress.total_points}`,
    `Tier: ${input.progress.current_tier}`,
    `Free passes: ${input.progress.free_pass_count}`,
    "Active tasks:",
  ];
  if (input.activeTasks.length === 0) {
    lines.push("- none");
  } else {
    for (const task of input.activeTasks.slice(0, 4)) {
      const remaining = Math.max(0, task.repeats_required - task.repeats_completed);
      lines.push(
        `- ${task.title}: kind=${task.program_kind}, strictness=${task.strictness_mode}, due ${task.due_at}, repeats_remaining=${remaining}, schedule=${task.schedule_policy.type}, evidence=${task.evidence_policy.type}, reward=${summarizeTaskPlan(task.reward_plan)}, consequence=${summarizeTaskPlan(task.consequence_plan)}`,
      );
    }
  }
  if (Array.isArray(input.todayOccurrences) && input.todayOccurrences.length > 0) {
    lines.push("Today occurrences:");
    for (const row of input.todayOccurrences.slice(0, 8)) {
      lines.push(
        `- task ${row.task_id}: pending=${row.pending}, completed=${row.completed}, missed=${row.missed}`,
      );
    }
  }
  if (input.progress.last_completion_summary) {
    lines.push(`Last completion: ${input.progress.last_completion_summary}`);
  }
  if (Array.isArray(input.reviewQueue) && input.reviewQueue.length > 0) {
    lines.push("Review queue:");
    for (const item of input.reviewQueue.slice(0, 6)) {
      lines.push(
        `- ${item.title}: ${item.review_state}, kind=${item.program_kind}, strictness=${item.strictness_mode}, evidence=${item.evidence_type}, attempts=${item.attempts_used}/${item.max_attempts}${item.analysis_status ? `, auto=${item.analysis_status}` : ""}${item.analysis_mode ? `, analysis=${item.analysis_mode}` : ""}${item.baseline_source !== "none" ? `, baseline=${item.baseline_source}` : ""}`,
      );
    }
  }
  lines.push("Rule: Raven must not invent rewards or consequences. Use only catalog ids.");
  return lines.join("\n");
}

export function validateTaskRequestAgainstCatalog(
  request: CreateTaskRequest,
  catalog: VerificationCapabilityCatalogEntry[],
  options?: { requireRewardConsequenceApproval?: boolean },
): TaskValidationResult {
  const notes: string[] = [];
  let downgraded = false;
  const allowed = new Set(catalog.map((entry) => entry.capability_id));
  const normalizedChecks: TaskCameraCheck[] = [];
  for (const check of request.evidence.checks) {
    if (!allowed.has(check.capability)) {
      notes.push(`Removed unsupported capability: ${check.capability}`);
      continue;
    }
    normalizedChecks.push({
      capability: check.capability,
      required_duration_ms: clampInt(check.required_duration_ms ?? 1000, 200, 60_000),
      confidence_threshold: clampUnit(check.confidence_threshold ?? 0.7, 0.7),
      params: check.params ?? {},
    });
  }

  const schedulePolicy = normalizeTaskSchedulePolicy(request);
  const normalizedType = inferCreateTaskActionType(request, schedulePolicy);
  if (normalizedType !== request.type) {
    notes.push(`Normalized task action type to ${normalizedType}.`);
  }
  const repeatsRequired =
    schedulePolicy.type === "daily"
      ? Math.max(
          1,
          (schedulePolicy.days ?? 1) * Math.max(1, schedulePolicy.occurrences_per_day),
        )
      : clampInt(request.repeats_required, 1, 365);
  const windowSeconds =
    schedulePolicy.type === "daily"
      ? Math.max(86_400, (schedulePolicy.days ?? 1) * 86_400)
      : clampInt(request.window_seconds, 30, 2_592_000);

  const next: CreateTaskRequest = {
    ...request,
    type: normalizedType,
    title: request.title.slice(0, 120),
    description: request.description.slice(0, 500),
    window_seconds: windowSeconds,
    repeats_required: repeatsRequired,
    points_possible: clampInt(request.points_possible, 1, 500),
    evidence: {
      ...request.evidence,
      checks: normalizedChecks,
      max_attempts: clampInt(request.evidence.max_attempts, 1, 10),
    },
    per_repeat_timeout_seconds:
      typeof request.per_repeat_timeout_seconds === "number"
        ? clampInt(request.per_repeat_timeout_seconds, 5, 3_600)
        : undefined,
    program_kind: inferProgramKind({ ...request, type: normalizedType }, schedulePolicy),
    strictness_mode: inferStrictnessMode(request, schedulePolicy),
    schedule:
      schedulePolicy.type === "daily"
        ? {
            type: "daily",
            days: schedulePolicy.days ?? 1,
            occurrences_per_day: schedulePolicy.occurrences_per_day,
            start_date: schedulePolicy.start_date ?? undefined,
            end_date: schedulePolicy.end_date ?? undefined,
            allow_make_up: schedulePolicy.allow_make_up,
          }
        : { type: "one_time" },
  };

  if (
    (next.evidence.type === "camera" || next.evidence.type === "mixed") &&
    normalizedChecks.length === 0
  ) {
    downgraded = true;
    next.evidence.type = "manual";
    next.evidence.deny_user_override = false;
    notes.push(
      "Downgraded evidence type to manual because no supported camera checks are available.",
    );
  }

  if (next.evidence.type === "camera") {
    next.evidence.deny_user_override = true;
  }

  const requireApproval = options?.requireRewardConsequenceApproval !== false;
  const rewardPlan = toTaskPlanSelection("reward", next.reward_plan, {
    requireApproval,
  });
  const consequencePlan = toTaskPlanSelection("consequence", next.consequence_plan, {
    requireApproval,
  });
  if (!next.reward_plan || rewardPlan.catalog_id !== next.reward_plan.catalog_id) {
    notes.push("Reward plan was replaced with a safe catalog default.");
  }
  if (
    !next.consequence_plan ||
    consequencePlan.catalog_id !== next.consequence_plan.catalog_id
  ) {
    notes.push("Consequence plan was replaced with a safe catalog default.");
  }

  return {
    request: next,
    notes,
    downgraded,
    schedulePolicy,
    rewardPlan,
    consequencePlan,
  };
}

export function evaluateTaskCameraEvidence(
  task: TaskRow,
  observation: VisionObservation | null,
): TaskEvidenceEvaluation {
  const checks = task.evidence_policy.camera_plan ?? [];
  if (checks.length === 0) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "No camera checks are configured for this task.",
      details: [],
    };
  }
  const details: TaskEvidenceEvaluation["details"] = [];
  let allPass = true;
  let anyInconclusive = false;
  let minConfidence = 1;
  for (const check of checks) {
    const result = evaluateCapabilityFromObservation(
      check.capability,
      observation,
      check.params ?? {},
    );
    const threshold = clampUnit(check.confidence_threshold ?? 0.7, 0.7);
    const passedByThreshold = result.status === "pass" && result.confidence >= threshold;
    const status: "pass" | "fail" | "inconclusive" = passedByThreshold
      ? "pass"
      : result.status === "inconclusive"
        ? "inconclusive"
        : "fail";
    details.push({
      capability: check.capability,
      status,
      confidence: clampUnit(result.confidence, 0),
      summary: result.summary,
    });
    minConfidence = Math.min(minConfidence, clampUnit(result.confidence, 0));
    if (status === "inconclusive") {
      anyInconclusive = true;
      allPass = false;
    } else if (status === "fail") {
      allPass = false;
    }
  }

  if (allPass) {
    return {
      status: "pass",
      confidence: minConfidence,
      summary: "Task evidence checks passed.",
      details,
    };
  }
  if (anyInconclusive) {
    return {
      status: "inconclusive",
      confidence: minConfidence,
      summary: "Task evidence is inconclusive. Camera visibility may be insufficient.",
      details,
    };
  }
  return {
    status: "fail",
    confidence: minConfidence,
    summary: "Task evidence checks failed.",
    details,
  };
}

export function buildTaskDueAt(windowSeconds: number, nowMs = Date.now()): string {
  const ms = clampInt(windowSeconds, 30, 2_592_000) * 1000;
  return new Date(nowMs + ms).toISOString();
}
