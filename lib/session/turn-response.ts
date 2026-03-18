import { buildPhaseReflection, shouldEmitReflection, type SessionPhase } from "./session-phase.ts";
import type { SessionMemory } from "./session-memory.ts";
import type { InteractionMode } from "./interaction-mode.ts";
import { applyModeStylePolish } from "./mode-style.ts";
import {
  buildShortClarificationReply,
  detectShortFollowUpKind,
} from "./short-follow-up.ts";

export type TurnResponseFamily =
  | "model"
  | "deterministic_scene"
  | "deterministic_task"
  | "deterministic_observation"
  | "scene_fallback"
  | "response_gate_fallback";

export type FinalizeTurnResponseInput = {
  text: string;
  userText: string;
  nextTurnId: number;
  phase: SessionPhase;
  memory: SessionMemory;
  interactionMode: InteractionMode;
  selectedFamily: TurnResponseFamily;
  availableFamilies: TurnResponseFamily[];
  responseGateForced: boolean;
  responseMode?: "default" | "short_follow_up";
};

export type FinalizeTurnResponseResult = {
  text: string;
  finalOutputSource: TurnResponseFamily;
  multipleGeneratorsFired: boolean;
  reflectionAppended: boolean;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function applyModeStylePolicy(text: string, interactionMode: InteractionMode): string {
  if (
    interactionMode === "task_execution" ||
    interactionMode === "locked_task_execution" ||
    interactionMode === "task_planning" ||
    interactionMode === "game"
  ) {
    return text;
  }

  return applyModeStylePolish(
    text
      .replace(/^(listen carefully, pet\.?|keep it specific\.?|stay with the current thread and continue\.?|answer directly, pet\.?|no drifting, pet\.?)\s*/i, "")
      .replace(/\b(i will answer directly|i am answering your question directly)\b[. ]*/gi, "")
      .replace(/\b(ask the exact question you want answered|ask the exact part you want clarified)\b[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bask me something real\b[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bkeep steady pressure on the current task\b[. ]*/gi, ""),
    interactionMode,
  );
}

function enforceSingleQuestionTurn(text: string, interactionMode: InteractionMode): string {
  if (interactionMode !== "profile_building" && interactionMode !== "relational_chat") {
    return text;
  }
  const segments = text.split(/(?<=[.!?])\s+/);
  let questionSeen = false;
  const kept = segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .flatMap((segment) => {
      if (!segment.includes("?")) {
        return [segment];
      }
      if (questionSeen) {
        return [];
      }
      questionSeen = true;
      const firstQuestion = segment.match(/.*?\?/);
      return [firstQuestion?.[0]?.trim() ?? segment];
    });
  return normalize(kept.join(" "));
}

function enforceShortClarificationTurn(
  text: string,
  userText: string,
  interactionMode: InteractionMode,
): string {
  const normalized = normalize(text);
  if (!normalized) {
    return buildShortClarificationReply({ userText, interactionMode });
  }
  if (
    /\b(first move|pacing|end point first|my little pet returns|what do you want\?|ask me something real)\b/i.test(
      normalized,
    )
  ) {
    return buildShortClarificationReply({ userText, interactionMode });
  }
  const segments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return normalized;
  }
  const kind = detectShortFollowUpKind(userText);
  if (kind === "go_on") {
    const continuation =
      segments.find((segment) => /\b(keep going|tell me|because)\b/i.test(segment)) ??
      segments.find((segment) => /\b(concrete part|what would|what people usually|what you could actually)\b/i.test(segment));
    return normalize(continuation ?? normalized);
  }
  const preferred =
    segments.find((segment) =>
      /\b(i mean|because|clarif|plain|part|unpacked|expanded|sharpened|current step|current move)\b/i.test(
        segment,
      ),
    ) ?? segments[0];
  return normalize(preferred);
}

function shouldAppendReflection(input: FinalizeTurnResponseInput): boolean {
  if (input.responseGateForced) {
    return false;
  }
  if (!shouldEmitReflection(input.nextTurnId)) {
    return false;
  }
  return (
    input.interactionMode === "task_execution" ||
    input.interactionMode === "locked_task_execution" ||
    input.interactionMode === "game"
  );
}

export function finalizeTurnResponse(
  input: FinalizeTurnResponseInput,
): FinalizeTurnResponseResult {
  let baseText = enforceSingleQuestionTurn(
    applyModeStylePolicy(normalize(input.text), input.interactionMode),
    input.interactionMode,
  );
  if (input.responseMode === "short_follow_up") {
    baseText = enforceShortClarificationTurn(baseText, input.userText, input.interactionMode);
  }
  if (!baseText) {
    return {
      text: "",
      finalOutputSource: input.responseGateForced ? "response_gate_fallback" : input.selectedFamily,
      multipleGeneratorsFired: input.availableFamilies.length > 1,
      reflectionAppended: false,
    };
  }

  const finalOutputSource = input.responseGateForced ? "response_gate_fallback" : input.selectedFamily;
  if (!shouldAppendReflection(input)) {
    return {
      text: baseText,
      finalOutputSource,
      multipleGeneratorsFired: input.availableFamilies.length > 1,
      reflectionAppended: false,
    };
  }

  const reflection = normalize(buildPhaseReflection(input.phase, input.memory));
  if (!reflection) {
    return {
      text: baseText,
      finalOutputSource,
      multipleGeneratorsFired: input.availableFamilies.length > 1,
      reflectionAppended: false,
    };
  }

  return {
    text: normalize(`${baseText} ${reflection}`),
    finalOutputSource,
    multipleGeneratorsFired: input.availableFamilies.length > 1,
    reflectionAppended: true,
  };
}
