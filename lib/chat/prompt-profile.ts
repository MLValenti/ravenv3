import {
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isChatLikeSmalltalk,
  isMutualGettingToKnowRequest,
} from "../session/interaction-mode.ts";

export type PromptRouteMode = "default" | "fresh_greeting" | "relational_direct";
export type VoicePromptProfile = "full" | "minimal_voice_chat";

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isRepairLikeTurn(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /^(what do you mean|what do you mean by that|about what|what are you talking about|what|huh|say that again|that part|what part|which part|why do you say that)\??$/.test(
    normalized,
  );
}

export function isTaskOrExecutionHeavyTurn(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /\b(task|challenge|game|rules?|prompt|minutes?|hours?|duration|camera|verify|verification|device|inventory|report back|check in|checkpoint|wear it|put it on|lock it|complete the step|first step|next step)\b/.test(
    normalized,
  );
}

export function isVoiceFirstRelationalTurn(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return (
    isChatLikeSmalltalk(normalized) ||
    isMutualGettingToKnowRequest(normalized) ||
    isAssistantSelfQuestion(normalized) ||
    isAssistantServiceQuestion(normalized) ||
    isRepairLikeTurn(normalized) ||
    /\bwhat do you want\??$/.test(normalized) ||
    /\btell me something real\b/.test(normalized) ||
    /\bwhat matters to you\b/.test(normalized)
  );
}

export function resolvePromptRouteMode(text: string): PromptRouteMode {
  if (isChatLikeSmalltalk(text)) {
    return "fresh_greeting";
  }
  if (
    isRepairLikeTurn(text) ||
    isAssistantSelfQuestion(text) ||
    isMutualGettingToKnowRequest(text) ||
    isVoiceFirstRelationalTurn(text)
  ) {
    return "relational_direct";
  }
  return "default";
}

export function chooseVoicePromptProfile(input: {
  plannerEnabled: boolean;
  sessionMode: boolean;
  promptRouteMode: PromptRouteMode;
  latestUserMessage: string;
  currentMode: string;
}): VoicePromptProfile {
  if (input.plannerEnabled) {
    return "full";
  }

  if (isTaskOrExecutionHeavyTurn(input.latestUserMessage)) {
    return "full";
  }

  if (input.promptRouteMode === "fresh_greeting" || input.promptRouteMode === "relational_direct") {
    return "minimal_voice_chat";
  }

  if (
    (input.currentMode === "normal_chat" ||
      input.currentMode === "relational_chat" ||
      input.currentMode === "question_answering") &&
    isVoiceFirstRelationalTurn(input.latestUserMessage)
  ) {
    return "minimal_voice_chat";
  }

  return "full";
}

export function shouldIncludeTaskRuntimePromptBlocks(input: {
  plannerEnabled: boolean;
  currentMode: string;
  sessionPhase?: string | null;
  latestUserMessage: string;
  promptRouteMode: PromptRouteMode;
}): boolean {
  if (input.plannerEnabled) {
    return true;
  }

  const mode = normalize(input.currentMode);
  const phase = normalize(input.sessionPhase ?? "");

  if (
    mode === "task_planning" ||
    mode === "task_execution" ||
    mode === "locked_task_execution" ||
    mode === "game"
  ) {
    return true;
  }

  if (/\b(task|challenge|game|verify|verification|device|camera)\b/.test(phase)) {
    return true;
  }

  if (isTaskOrExecutionHeavyTurn(input.latestUserMessage)) {
    return true;
  }

  return false;
}

export function shouldIncludeResponseStrategyPromptBlock(input: {
  plannerEnabled: boolean;
  currentMode: string;
  sessionPhase?: string | null;
  latestUserMessage: string;
  promptRouteMode: PromptRouteMode;
}): boolean {
  if (input.plannerEnabled) {
    return true;
  }

  if (input.promptRouteMode === "fresh_greeting") {
    return false;
  }

  if (input.promptRouteMode === "relational_direct") {
    return isRepairLikeTurn(input.latestUserMessage);
  }

  const mode = normalize(input.currentMode);
  const phase = normalize(input.sessionPhase ?? "");

  if (
    mode === "task_planning" ||
    mode === "task_execution" ||
    mode === "locked_task_execution" ||
    mode === "game" ||
    mode === "profile_building"
  ) {
    return true;
  }

  if (/\b(task|challenge|game|verify|verification)\b/.test(phase)) {
    return true;
  }

  if (isTaskOrExecutionHeavyTurn(input.latestUserMessage)) {
    return true;
  }

  return false;
}
