import type { StepMode } from "./step-engine";

export type DynamicCheckType = string;

export type PlannerTrackingStatus = "tracked" | "lost";

export type PlannerContext = {
  recentRavenOutputs: string[];
  recentVerificationSummaries: string[];
  lastUserResponse: string | null;
  lastUserIntent: string;
  lastCheckSummary: string;
  trackingStatus: PlannerTrackingStatus;
  lastStepsSummary: string;
  memoryFacts: string[];
  memorySummary: string;
  sessionMemorySummary: string;
  sessionPhase: string;
  awaitingUser: boolean;
  moodLabel: string;
  relationshipLabel: string;
  difficultyLevel: number;
  statePromptBlock: string;
  allowedCheckTypes: string[];
  capabilityCatalogPrompt: string;
};

export type PlannedStep = {
  id: string;
  mode: StepMode;
  say: string;
  checkType?: DynamicCheckType;
  checkParams?: Record<string, unknown>;
  question?: string;
  timeoutSeconds: number;
  onPassSay: string;
  onFailSay: string;
  maxRetries: number;
};

type ValidationOptions = {
  allowedCheckTypes?: string[];
};

type ValidationResult =
  | {
      ok: true;
      step: PlannedStep;
    }
  | {
      ok: false;
      error: string;
    };

const MAX_WORDS = 180;
export const DEFAULT_ALLOWED_CHECK_TYPES: DynamicCheckType[] = [
  "presence",
  "head_turn",
  "hold_still",
];
const ALLOWED_MODES: StepMode[] = ["talk", "check", "listen"];
const ALLOWED_STEP_KEYS = new Set([
  "mode",
  "say",
  "checkType",
  "checkParams",
  "question",
  "timeoutSeconds",
  "onPassSay",
  "onFailSay",
  "maxRetries",
]);

const PLANNER_LEADING_PREFIX_PATTERNS = [
  /^(understood|noted|okay|ok)[.!:,]?\s+/i,
];

const PLANNER_META_SENTENCE_PATTERNS = [
  /^you('?re| are) asking\b/i,
  /^you('?ve| have) (answered|mentioned)\b/i,
  /^you (chose|want|said|mentioned)\b/i,
  /^so (you|we) /i,
];

function splitSentences(text: string): string[] {
  const matches = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]?/g);
  if (!matches) {
    return [];
  }
  return matches.map((item) => item.trim()).filter((item) => item.length > 0);
}

function sanitizeText(raw: unknown): string {
  const normalized = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!normalized) {
    return "";
  }

  let cleaned = normalized;
  for (const pattern of PLANNER_LEADING_PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  const filteredSentences = splitSentences(cleaned).filter(
    (sentence) => !PLANNER_META_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  cleaned = filteredSentences.join(" ").replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return "";
  }

  const words = cleaned.split(" ");
  if (words.length <= MAX_WORDS) {
    return cleaned;
  }

  return `${words.slice(0, MAX_WORDS).join(" ")}...`;
}

function normalizeTimeoutSeconds(raw: unknown, mode: StepMode): number {
  const defaultValue = mode === "listen" ? 30 : 15;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) {
    return defaultValue;
  }
  return Math.max(5, Math.min(60, Math.floor(numeric)));
}

function normalizeMaxRetries(raw: unknown): number {
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(0, Math.min(2, Math.floor(numeric)));
}

function isAllowedCheckType(raw: unknown, allowed: string[]): raw is DynamicCheckType {
  return (
    typeof raw === "string" &&
    allowed.includes(raw as DynamicCheckType)
  );
}

function isAllowedMode(raw: unknown): raw is StepMode {
  return typeof raw === "string" && ALLOWED_MODES.includes(raw as StepMode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty planner response.");
  }

  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    return JSON.parse(withoutFence);
  }

  return JSON.parse(trimmed);
}

export function summarizeLastSteps(steps: PlannedStep[]): string {
  if (!steps.length) {
    return "none";
  }
  return steps
    .slice(-6)
    .map((step, index) => {
      const check = step.mode === "check" ? `:${step.checkType ?? "none"}` : "";
      return `${index + 1}. ${step.mode}${check} - ${step.say.slice(0, 80)}`;
    })
    .join(" | ");
}

export function toPlannerPrompt(context: PlannerContext, stepIndex: number): string {
  const allowedCheckTypes =
    context.allowedCheckTypes.length > 0
      ? context.allowedCheckTypes
      : DEFAULT_ALLOWED_CHECK_TYPES;
  const lines = [
    "Return ONLY JSON. No prose. No markdown.",
    "You are planning one next session step for Raven.",
    "Rules:",
    "- vary steps, ask questions, do not repeat",
    "- keep one instruction per step",
    "- include mode listen at least every 3 steps",
    "- increase delay and simplify if user fails",
    "- always acknowledge the latest user message before new instruction",
    "- answer user questions directly before moving on",
    "- keep each text field under 180 words",
    "- use at most 2 verification checks per instruction",
    "- choose checks that match the instruction you asked the user to do",
    "- if no suitable check exists, use listen mode and ask for a verifiable alternative",
    "Allowed mode values: talk, check, listen.",
    `Allowed checkType values: ${allowedCheckTypes.join(", ")}.`,
    "JSON schema:",
    `{"mode":"talk|check|listen","say":"string","checkType":"${allowedCheckTypes.join("|")}","checkParams":{"...":"..."},"question":"string","timeoutSeconds":number,"onPassSay":"string","onFailSay":"string","maxRetries":number}`,
    "Notes:",
    "- For check mode, checkType is required.",
    "- For check mode, checkParams is optional and must match the capability parameter schema.",
    "- For listen mode, question is required and timeoutSeconds defaults to 30.",
    `Step index: ${stepIndex}`,
    "Context:",
    `trackingStatus: ${context.trackingStatus}`,
    `lastCheckSummary: ${context.lastCheckSummary || "none"}`,
    `lastUserResponse: ${context.lastUserResponse || "none"}`,
    `lastUserIntent: ${context.lastUserIntent || "none"}`,
    `sessionPhase: ${context.sessionPhase || "warmup"}`,
    `awaitingUser: ${context.awaitingUser}`,
    `moodLabel: ${context.moodLabel || "neutral"}`,
    `relationshipLabel: ${context.relationshipLabel || "building"}`,
    `difficultyLevel: ${context.difficultyLevel || 2}`,
    `lastStepsSummary: ${context.lastStepsSummary || "none"}`,
    `memorySummary: ${context.memorySummary || "none"}`,
    "State block:",
    context.statePromptBlock || "State: Mood neutral. Relationship building.",
    "Supported verification capabilities:",
    context.capabilityCatalogPrompt || "- none",
    "Session Memory:",
    context.sessionMemorySummary || "- none",
    "memoryFacts:",
    ...(context.memoryFacts.length ? context.memoryFacts : ["- none"]),
    "recentVerificationSummaries:",
    ...(context.recentVerificationSummaries.length
      ? context.recentVerificationSummaries.map((line, index) => `${index + 1}. ${line}`)
      : ["1. none"]),
    "recentRavenOutputs:",
    ...context.recentRavenOutputs
      .slice(-6)
      .map((line, index) => `${index + 1}. ${line}`),
  ];

  return lines.join("\n");
}

export function validatePlannedStep(
  value: unknown,
  stepIndex: number,
  options: ValidationOptions = {},
): ValidationResult {
  const allowedCheckTypes =
    options.allowedCheckTypes && options.allowedCheckTypes.length > 0
      ? options.allowedCheckTypes
      : DEFAULT_ALLOWED_CHECK_TYPES;
  if (!isRecord(value)) {
    return { ok: false, error: "Planner response must be a JSON object." };
  }

  const keys = Object.keys(value);
  const invalidKeys = keys.filter((key) => !ALLOWED_STEP_KEYS.has(key));
  if (invalidKeys.length > 0) {
    return {
      ok: false,
      error: `Planner response contains unsupported keys: ${invalidKeys.join(", ")}.`,
    };
  }

  if (!isAllowedMode(value.mode)) {
    return { ok: false, error: "Planner step mode must be talk, check, or listen." };
  }

  const mode = value.mode;
  const say = sanitizeText(value.say);
  const onPassSay = sanitizeText(value.onPassSay);
  const onFailSay = sanitizeText(value.onFailSay);
  const question = sanitizeText(value.question);

  if (!say || !onPassSay || !onFailSay) {
    return {
      ok: false,
      error: "Planner step must include non-empty say, onPassSay, and onFailSay.",
    };
  }

  if (mode === "check" && !isAllowedCheckType(value.checkType, allowedCheckTypes)) {
    return {
      ok: false,
      error:
        `Planner returned disallowed checkType. Allowed values: ${allowedCheckTypes.join(", ")}.`,
    };
  }

  if (mode === "listen" && !question) {
    return { ok: false, error: "Listen step must include a question field." };
  }

  const step: PlannedStep = {
    id: `dynamic-${stepIndex}`,
    mode,
    say,
    timeoutSeconds: normalizeTimeoutSeconds(value.timeoutSeconds, mode),
    onPassSay,
    onFailSay,
    maxRetries: normalizeMaxRetries(value.maxRetries),
  };

  if (mode === "check") {
    step.checkType = value.checkType as DynamicCheckType;
    if (isRecord(value.checkParams)) {
      step.checkParams = value.checkParams;
    }
  }

  if (mode === "listen") {
    step.question = question;
  }

  return { ok: true, step };
}

export function parseAndValidatePlannedStep(
  rawText: string,
  stepIndex: number,
  options: ValidationOptions = {},
): ValidationResult {
  try {
    const parsed = parseJsonFromText(rawText);
    return validatePlannedStep(parsed, stepIndex, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planner JSON parse failed.";
    return { ok: false, error: message };
  }
}

export function createSafeFallbackStep(stepIndex: number): PlannedStep {
  return {
    id: `dynamic-${stepIndex}-fallback`,
    mode: "talk",
    say: "Hold still and keep your gaze forward.",
    timeoutSeconds: 12,
    onPassSay: "Hold steady.",
    onFailSay: "Reset your position.",
    maxRetries: 0,
  };
}

export function summarizeCheckResult(
  checkType: string,
  status: "passed" | "failed" | "timeout",
  details: string,
): string {
  return `${checkType} ${status}. ${details}`.trim();
}
