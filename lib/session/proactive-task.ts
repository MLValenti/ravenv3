import type { DialogueRouteAct } from "@/lib/dialogue/router.ts";
import type { SceneTopicType } from "./scene-state.ts";
import type { SessionInventoryItem } from "./session-inventory.ts";

const START_CUE_PATTERN =
  /^(?:ok(?:ay)?[,.!\s]*)?(?:let'?s start|start now|start|ready|go ahead|go|what now|what next)\b/i;

const GAME_CUE_PATTERN = /\b(game|rock paper scissors|rps|number hunt|math duel|number command|riddle lock|bet|wager)\b/i;

const BLOCKED_TOPIC_TYPES = new Set<SceneTopicType>([
  "game_setup",
  "game_execution",
  "reward_window",
  "task_negotiation",
  "task_execution",
  "task_terms_negotiation",
  "duration_negotiation",
  "verification_in_progress",
  "reward_negotiation",
]);

export type ProactiveTaskDecisionInput = {
  userText: string;
  dialogueAct: DialogueRouteAct;
  topicType: SceneTopicType;
  topicLocked: boolean;
  inventory: SessionInventoryItem[];
  hasActiveTask: boolean;
  alreadyPrompted: boolean;
};

function hasAvailableInventory(items: SessionInventoryItem[]): boolean {
  return items.some((item) => item.available_this_session);
}

export function isProactiveTaskStartCue(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (GAME_CUE_PATTERN.test(normalized)) {
    return false;
  }
  return START_CUE_PATTERN.test(normalized);
}

export function shouldAssignProactiveInventoryTask(
  input: ProactiveTaskDecisionInput,
): boolean {
  if (input.alreadyPrompted) {
    return false;
  }
  if (input.hasActiveTask) {
    return false;
  }
  if (!hasAvailableInventory(input.inventory)) {
    return false;
  }
  if (input.dialogueAct !== "acknowledgement" && input.dialogueAct !== "other") {
    return false;
  }
  if (input.topicLocked && BLOCKED_TOPIC_TYPES.has(input.topicType)) {
    return false;
  }
  return isProactiveTaskStartCue(input.userText);
}
