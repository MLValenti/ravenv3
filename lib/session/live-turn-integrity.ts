import type { DialogueRouteAct } from "../dialogue/router.ts";
import type { InteractionMode } from "./interaction-mode.ts";
import { scrubVisibleInternalLeakText } from "./response-gate.ts";
import type { SceneTopicType } from "./scene-state.ts";

export function chooseDeliveredAssistantText(input: {
  responseText: string;
  sceneFallback: string | null;
  responseGateForced: boolean;
  responseGateReason: string;
  dialogueAct: DialogueRouteAct;
  userText: string;
  dialogueAligned: boolean;
}): string {
  if (input.responseGateForced) {
    return input.responseText;
  }
  if (input.dialogueAligned) {
    return input.responseText;
  }
  return input.sceneFallback ?? input.responseText;
}

export function shouldRecoverSkippedAssistantRender(input: {
  appendCommitted: boolean;
  appendReason: string;
  hasRenderableText: boolean;
  sourceUserMessageId: number;
  lastAssistantUserMessageId: number;
  visibleAssistantAlreadyCommitted?: boolean;
}): boolean {
  if (input.appendCommitted) {
    return false;
  }
  if (!input.hasRenderableText) {
    return false;
  }
  if (input.visibleAssistantAlreadyCommitted) {
    return false;
  }
  if (input.sourceUserMessageId <= 0) {
    return false;
  }
  return input.lastAssistantUserMessageId < input.sourceUserMessageId;
}

export function shouldPreserveQueuedUserTurnOnSessionStart(input: {
  pendingTurnMessageId: number;
  lastHandledUserMessageId: number;
}): boolean {
  return input.pendingTurnMessageId > input.lastHandledUserMessageId;
}

export function sanitizeSessionVisibleAssistantText(text: string): {
  text: string;
  changed: boolean;
  blocked: boolean;
} {
  return scrubVisibleInternalLeakText(text);
}

function isThreadScopedContinuationCue(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "you pick" ||
    normalized === "keep going" ||
    normalized === "go on" ||
    normalized === "ok" ||
    normalized === "okay" ||
    normalized === "different game" ||
    normalized === "explain the game" ||
    normalized === "what do you mean"
  );
}

function isScopedContinuationTopic(topicType: SceneTopicType, interactionMode: InteractionMode): boolean {
  return (
    interactionMode === "game" ||
    interactionMode === "task_planning" ||
    interactionMode === "locked_task_execution" ||
    topicType === "game_setup" ||
    topicType === "game_execution" ||
    topicType === "reward_negotiation" ||
    topicType === "reward_window" ||
    topicType === "task_negotiation" ||
    topicType === "task_execution" ||
    topicType === "duration_negotiation" ||
    topicType === "task_terms_negotiation"
  );
}

export function shouldPreferServerTurnContract(input: {
  userText: string;
  dialogueAct: DialogueRouteAct;
  hasDeterministicCandidate: boolean;
  interactionMode: InteractionMode;
  topicType: SceneTopicType;
}): boolean {
  if (!input.hasDeterministicCandidate) {
    return false;
  }
  if (input.dialogueAct === "propose_activity") {
    return true;
  }
  if (!isScopedContinuationTopic(input.topicType, input.interactionMode)) {
    return false;
  }
  if (input.dialogueAct === "answer_activity_choice" || input.dialogueAct === "short_follow_up") {
    return true;
  }
  return isThreadScopedContinuationCue(input.userText);
}

export function shouldAllowVisibleAssistantCommit(input: {
  sourceUserMessageId: number;
  normalizedText: string;
  existingVisibleNormalizedText: string | null;
}): { allow: boolean; reason: string } {
  if (!input.normalizedText) {
    return { allow: false, reason: "empty_visible_text" };
  }
  if (input.sourceUserMessageId <= 0) {
    return { allow: true, reason: "no_source_user_turn" };
  }
  if (!input.existingVisibleNormalizedText) {
    return { allow: true, reason: "first_visible_commit_for_turn" };
  }
  if (input.existingVisibleNormalizedText === input.normalizedText) {
    return { allow: false, reason: "duplicate_visible_commit_same_turn" };
  }
  return { allow: false, reason: "second_visible_reply_same_turn" };
}
