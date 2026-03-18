import type { CreateTaskRequest } from "./system.ts";

const TASK_REQUEST_PATTERNS = [
  /\bgive me (a|one)?\s*task\b/i,
  /\bassign (me )?(a|one)?\s*task\b/i,
  /\bi need (a|one)?\s*task\b/i,
  /\bset (me )?(a|one)?\s*task\b/i,
  /\btask\b/i,
];

const TASK_ASSIGNMENT_PATTERNS = [
  /\bhere is your task\b/i,
  /\byour task\b/i,
  /\btask:\b/i,
  /\bstart now\b/i,
  /\bcheck in\b/i,
  /\breport back\b/i,
  /\bcomplete\b.*\b(minutes?|hours?)\b/i,
];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractDurationSeconds(text: string): number {
  const normalized = text.toLowerCase();
  const match = normalized.match(/(\d{1,3})\s*(hours?|hrs?|hr|minutes?|mins?|min|m)\b/);
  if (!match) {
    return 30 * 60;
  }
  const amount = clampInt(Number(match[1]), 1, 480);
  const unit = match[2];
  if (/h|hour/.test(unit)) {
    return clampInt(amount * 3600, 5 * 60, 8 * 3600);
  }
  return clampInt(amount * 60, 5 * 60, 8 * 3600);
}

function extractRepeats(text: string): number {
  const normalized = text.toLowerCase();
  const match = normalized.match(/(\d{1,2})\s*(times|repeats|occurrences|rounds)\b/);
  if (!match) {
    return 1;
  }
  return clampInt(Number(match[1]), 1, 24);
}

function inferTaskLabel(userText: string): string {
  const normalized = userText.toLowerCase();
  if (/\bchastity\b/.test(normalized)) {
    return "Chastity hold";
  }
  if (/\bposture|stand|kneel|still|hold\b/.test(normalized)) {
    return "Discipline hold";
  }
  if (/\bdevice|toy|intiface|vibrate|rotate|linear\b/.test(normalized)) {
    return "Device control hold";
  }
  return "Session assignment";
}

function inferCheckCapability(allowedCheckTypes: string[]): string | null {
  const preferred = ["user_present", "presence", "face_present", "head_turned_left_right", "hold_still"];
  const normalized = new Set(allowedCheckTypes.map((item) => item.toLowerCase()));
  for (const candidate of preferred) {
    if (normalized.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function isTaskRequestMessage(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  return TASK_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function looksLikeTaskAssignmentText(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  return TASK_ASSIGNMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function looksLikeFinalTaskAssignmentText(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  if (!/\bhere is your task\b/i.test(normalized)) {
    return false;
  }
  if (
    /\b(next step|current checkpoint|stay on this thread|continue cleanly|follow the current checkpoint)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(start now|reply done|report back|check in|show me)\b/i.test(normalized);
}

export function buildFallbackCreateTaskRequest(input: {
  userText: string;
  assistantText: string;
  allowedCheckTypes: string[];
}): CreateTaskRequest {
  const durationSeconds = extractDurationSeconds(`${input.userText} ${input.assistantText}`);
  const repeats = extractRepeats(`${input.userText} ${input.assistantText}`);
  const title = `${inferTaskLabel(input.userText)} task`;
  const normalizedAssistant = normalizeWhitespace(input.assistantText);
  const description = normalizedAssistant || "Follow the assigned task and report completion.";
  const hasCameraLanguage = /\b(camera|show me|on cam|in frame|verify)\b/i.test(
    `${input.userText} ${input.assistantText}`,
  );
  const checkCapability = inferCheckCapability(input.allowedCheckTypes);
  const useCameraEvidence = hasCameraLanguage && Boolean(checkCapability);

  return {
    type: "create_task",
    title: title.slice(0, 120),
    description: description.slice(0, 500),
    window_seconds: clampInt(durationSeconds * Math.max(1, repeats), 5 * 60, 24 * 3600),
    repeats_required: repeats,
    points_possible: clampInt(8 + repeats * 4, 8, 80),
    schedule: {
      type: "one_time",
    },
    evidence: {
      required: true,
      type: useCameraEvidence ? "mixed" : "manual",
      checks:
        useCameraEvidence && checkCapability
          ? [
              {
                capability: checkCapability,
                required_duration_ms: clampInt(Math.floor(durationSeconds * 1000 * 0.2), 1500, 20_000),
                confidence_threshold: 0.7,
              },
            ]
          : [],
      max_attempts: 2,
      deny_user_override: useCameraEvidence,
    },
    reward_plan: {
      catalog_id: "reward_positive_message",
      params: { template_id: "approval_firm" },
    },
    consequence_plan: {
      catalog_id: "penalty_points",
      params: { penalty_points: 5 },
    },
    per_repeat_timeout_seconds: durationSeconds,
    program_kind: "task",
    strictness_mode: "standard",
  };
}
