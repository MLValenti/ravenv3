import type { MemoryType } from "@/lib/db";

export type MemorySuggestionCandidate = {
  key: string;
  value: string;
  type: MemoryType;
  tags: string[];
  importance: number;
  stability: number;
  confidence: number;
  rationale: string;
  suggestion_kind: "new" | "update";
};

type ExtractConfig = {
  importanceThreshold: number;
  stabilityThreshold: number;
  confidenceThreshold: number;
};

const DEFAULT_CONFIG: ExtractConfig = {
  importanceThreshold: 0.55,
  stabilityThreshold: 0.55,
  confidenceThreshold: 0.6,
};

const TRANSIENT_HINTS = [
  "today",
  "tonight",
  "right now",
  "currently",
  "at the moment",
  "this morning",
  "this evening",
];

const EXPLICIT_TRIGGER_PATTERNS = [
  /\bremember\b/i,
  /\bsave this\b/i,
  /\bfrom now on\b/i,
  /\balways\b/i,
  /\bnever\b/i,
  /\bmy goal is\b/i,
  /\bi prefer\b/i,
  /\bi like\b/i,
  /\bi (?:do not|don't|dont) like\b/i,
  /\bi want to\b/i,
  /\bi want help with\b/i,
  /\bi struggle with\b/i,
  /\bcall me\b/i,
  /\bmy name is\b/i,
  /\bsafeword is\b/i,
  /\bi can only\b/i,
  /\bdo not\b/i,
];

const SECRET_PATTERNS = [
  /\bpassword\b/i,
  /\bpassphrase\b/i,
  /\bapi[-_\s]?key\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bprivate key\b/i,
];

function readThreshold(raw: string | undefined, fallback: number): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (numeric < 0) {
    return 0;
  }
  if (numeric > 1) {
    return 1;
  }
  return Number(numeric.toFixed(3));
}

function loadConfig(): ExtractConfig {
  return {
    importanceThreshold: readThreshold(
      process.env.MEMORY_IMPORTANCE_THRESHOLD,
      DEFAULT_CONFIG.importanceThreshold,
    ),
    stabilityThreshold: readThreshold(
      process.env.MEMORY_STABILITY_THRESHOLD,
      DEFAULT_CONFIG.stabilityThreshold,
    ),
    confidenceThreshold: readThreshold(
      process.env.MEMORY_CONFIDENCE_THRESHOLD,
      DEFAULT_CONFIG.confidenceThreshold,
    ),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}

function cleanValue(value: string): string {
  return value
    .replace(/^that\s+/i, "")
    .replace(/^my\s+/i, "")
    .replace(/[.?!]+$/g, "")
    .trim()
    .slice(0, 320);
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []));
}

function hasTransientHints(text: string): boolean {
  const lowered = text.toLowerCase();
  return TRANSIENT_HINTS.some((hint) => lowered.includes(hint));
}

function hasSecretHints(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function hasExplicitTrigger(text: string): boolean {
  return EXPLICIT_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

function classifyCandidate(
  key: string,
  rawValue: string,
  type: MemoryType,
  rationale: string,
  explicitTrigger: boolean,
): MemorySuggestionCandidate | null {
  const value = cleanValue(rawValue);
  if (!value) {
    return null;
  }
  if (hasSecretHints(value)) {
    return null;
  }

  let importance = 0.35;
  let stability = 0.7;
  let confidence = 0.66;

  if (explicitTrigger) {
    importance += 0.3;
  }
  if (type === "goal" || type === "constraint") {
    importance += 0.2;
  }
  if (type === "preference") {
    importance += 0.22;
  }
  if (type === "habit") {
    importance += 0.12;
  }
  if (hasTransientHints(value)) {
    stability -= 0.4;
    confidence -= 0.08;
  }
  if (value.length < 5) {
    confidence -= 0.2;
  }

  const tags = Array.from(
    new Set([...tokenize(key), ...tokenize(value), type, ...(explicitTrigger ? ["explicit"] : [])]),
  ).slice(0, 12);

  return {
    key,
    value,
    type,
    tags,
    importance: clampUnit(importance),
    stability: clampUnit(stability),
    confidence: clampUnit(confidence),
    rationale,
    suggestion_kind: "new",
  };
}

export function extractMemorySuggestions(text: string): MemorySuggestionCandidate[] {
  const normalized = text.trim();
  if (!normalized || hasSecretHints(normalized)) {
    return [];
  }
  const explicitTrigger = hasExplicitTrigger(normalized);
  const candidates: MemorySuggestionCandidate[] = [];
  const push = (key: string, value: string, type: MemoryType, rationale: string) => {
    const next = classifyCandidate(key, value, type, rationale, explicitTrigger);
    if (next) {
      candidates.push(next);
    }
  };

  const checks: Array<[RegExp, (value: string) => void]> = [
    [/\bmy goal is\s+(.+)/i, (value) => push("goal", value, "goal", "goal_statement")],
    [/\bremember(?: that)?\s+(.+)/i, (value) => push("note", value, "misc", "remember_trigger")],
    [/\bfrom now on\s+(.+)/i, (value) => push("constraint", value, "constraint", "rule_statement")],
    [/\bi can only\s+(.+)/i, (value) => push("constraint", value, "constraint", "limit_statement")],
    [/\bdo not\s+(.+)/i, (value) => push("constraint", value, "constraint", "negative_rule")],
    [
      /\bi prefer\s+(.+)/i,
      (value) => push("preference", value, "preference", "preference_statement"),
    ],
    [/\bi like\s+(.+)/i, (value) => push("likes", value, "preference", "likes_statement")],
    [/\bi enjoy\s+(.+)/i, (value) => push("likes", value, "preference", "enjoys_statement")],
    [/\bi(?:'m| am) into\s+(.+)/i, (value) => push("likes", value, "preference", "into_statement")],
    [
      /\bi (?:do not|don't|dont) like\s+(.+)/i,
      (value) => push("dislikes", value, "preference", "dislikes_statement"),
    ],
    [/\bi hate\s+(.+)/i, (value) => push("dislikes", value, "preference", "hate_statement")],
    [
      /\bi(?:'m| am) not into\s+(.+)/i,
      (value) => push("dislikes", value, "preference", "not_into_statement"),
    ],
    [/\bi want to\s+(.+)/i, (value) => push("goal", value, "goal", "goal_intent")],
    [
      /\bi want help with\s+(.+)/i,
      (value) => push("improvement_area", value, "goal", "improvement_statement"),
    ],
    [
      /\bi struggle with\s+(.+)/i,
      (value) => push("improvement_area", value, "goal", "struggle_statement"),
    ],
    [/\bi always\s+(.+)/i, (value) => push("habit", value, "habit", "habit_statement")],
    [/\bi never\s+(.+)/i, (value) => push("constraint", value, "constraint", "never_statement")],
    [/\bmy setup is\s+(.+)/i, (value) => push("setup", value, "setup", "setup_statement")],
    [/\bmy name is\s+(.+)/i, (value) => push("name", value, "preference", "name_statement")],
    [/\bcall me\s+(.+)/i, (value) => push("name", value, "preference", "name_preference")],
    [
      /\bsafeword is\s+(.+)/i,
      (value) => push("safeword", value, "constraint", "safeword_statement"),
    ],
    [
      /\bno\s+(public [^.!?]+|calls?[^.!?]*|pain[^.!?]*|humiliation[^.!?]*|noise[^.!?]*|impact[^.!?]*|photos?[^.!?]*|camera[^.!?]*)/i,
      (value) => push("constraint", value, "constraint", "no_constraint"),
    ],
  ];

  for (const [pattern, handler] of checks) {
    const match = normalized.match(pattern);
    if (!match || !match[1]) {
      continue;
    }
    handler(match[1]);
  }

  const config = loadConfig();
  const deduped = new Map<string, MemorySuggestionCandidate>();
  for (const candidate of candidates) {
    if (
      candidate.importance < config.importanceThreshold ||
      candidate.stability < config.stabilityThreshold ||
      candidate.confidence < config.confidenceThreshold
    ) {
      continue;
    }
    const fingerprint = `${candidate.key}|${candidate.value.toLowerCase()}`;
    if (!deduped.has(fingerprint)) {
      deduped.set(fingerprint, candidate);
      continue;
    }
    const existing = deduped.get(fingerprint);
    if (
      existing &&
      candidate.importance + candidate.confidence > existing.importance + existing.confidence
    ) {
      deduped.set(fingerprint, candidate);
    }
  }
  return [...deduped.values()];
}
