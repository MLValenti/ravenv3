import { getSessionMemoryFocus, type SessionMemory } from "./session-memory.ts";

export type SessionPhase = "warmup" | "build" | "challenge" | "cooldown";

export function deriveSessionPhase(turnCount: number, complianceScore: number): SessionPhase {
  if (turnCount >= 14) {
    return "cooldown";
  }
  if (turnCount >= 8 && complianceScore >= 3) {
    return "challenge";
  }
  if (turnCount >= 3) {
    return "build";
  }
  return "warmup";
}

export function shouldEmitReflection(turnCount: number): boolean {
  return turnCount > 0 && turnCount % 5 === 0;
}

function summarizeShort(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 60) {
    return normalized;
  }
  return `${normalized.slice(0, 60)}...`;
}

function isWeakReflectionValue(value: string | null): boolean {
  if (!value) {
    return true;
  }
  return /^(yes|yeah|yep|ok|okay|sure|fine|ready|done|hi|hello|hey)(?:\s+(mistress|raven|maam|ma'am))?$/i.test(
    value,
  );
}

export function buildPhaseReflection(phase: SessionPhase, memory: SessionMemory): string {
  const rawGoal = summarizeShort(getSessionMemoryFocus(memory));
  const requestedTask = memory.session_intent?.value === "task_request";
  const goal =
    requestedTask
      ? "the current task"
      : rawGoal && !isWeakReflectionValue(rawGoal) && /^(give|assign|make|set)\s+me\b/i.test(rawGoal)
      ? "the current task"
      : rawGoal && !isWeakReflectionValue(rawGoal)
        ? rawGoal
        : "the current goal";
  const tone = summarizeShort(
    memory.user_profile_facts.find((fact) => fact.kind === "preference")?.value,
  );

  if (phase === "warmup") {
    return tone
      ? `Keep your focus on ${goal} and stay ${tone}.`
      : `Keep your focus on ${goal} and stay steady.`;
  }
  if (phase === "build") {
    return `Keep steady pressure on ${goal}.`;
  }
  if (phase === "challenge") {
    return tone
      ? `Stay sharp on ${goal} and keep your tone ${tone}.`
      : `Stay sharp on ${goal} and keep your focus tight.`;
  }
  return `Lock in your progress and keep ${goal} in view.`;
}
