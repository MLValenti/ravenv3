import type { DialogueRouteAct } from "../dialogue/router.ts";
import { scrubVisibleInternalLeakText } from "./response-gate.ts";

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
