import type { DialogueRouteAct } from "../dialogue/router.ts";

export type SessionTopicType =
  | "none"
  | "game_setup"
  | "game_execution"
  | "reward_window"
  | "task_negotiation"
  | "task_execution"
  | "task_terms_negotiation"
  | "duration_negotiation"
  | "verification_in_progress"
  | "reward_negotiation"
  | "general_request";

export type SessionDirectorInput = {
  currentTopicType: SessionTopicType;
  currentTopicLocked: boolean;
  inferredTopicType: SessionTopicType;
  explicitStakeSignal: boolean;
  shouldReopenGameSetup: boolean;
  userAct: DialogueRouteAct;
  taskHardLockActive: boolean;
  taskExecutionEscalatesToTask: boolean;
  taskExecutionEscalatesToGame: boolean;
  taskExecutionEscalatesToGeneral: boolean;
  gameExecutionEscalatesToGeneral: boolean;
  rewardWindowEscalatesToTask: boolean;
  rewardWindowEscalatesToGameSetup: boolean;
};

export type SessionDirectorOutput = {
  topicType: SessionTopicType;
  topicLocked: boolean;
  reason: string;
};

function isHardLockedRail(topicType: SessionTopicType, taskHardLockActive: boolean): boolean {
  if (topicType === "task_execution") {
    return taskHardLockActive;
  }
  return topicType === "game_execution" || topicType === "reward_window";
}

export function resolveSessionTopic(input: SessionDirectorInput): SessionDirectorOutput {
  if (input.currentTopicLocked && isHardLockedRail(input.currentTopicType, input.taskHardLockActive)) {
    if (input.explicitStakeSignal) {
      return { topicType: "reward_negotiation", topicLocked: true, reason: "explicit_stake_signal" };
    }
    if (input.taskExecutionEscalatesToGeneral || input.gameExecutionEscalatesToGeneral) {
      return { topicType: "general_request", topicLocked: false, reason: "general_conversation_requested" };
    }
    if (input.taskExecutionEscalatesToTask || input.rewardWindowEscalatesToTask) {
      return { topicType: "task_negotiation", topicLocked: true, reason: "task_negotiation_requested" };
    }
    if (input.taskExecutionEscalatesToGame || input.rewardWindowEscalatesToGameSetup) {
      return { topicType: "game_setup", topicLocked: true, reason: "game_setup_requested" };
    }
    return {
      topicType: input.currentTopicType,
      topicLocked: true,
      reason: "hold_locked_rail",
    };
  }

  if (input.shouldReopenGameSetup) {
    return { topicType: "game_setup", topicLocked: true, reason: "reopen_game_setup" };
  }

  return {
    topicType: input.inferredTopicType,
    topicLocked:
      input.inferredTopicType !== "none" && input.inferredTopicType !== "general_request",
    reason: input.userAct === "user_question" ? "question_route" : "inferred_route",
  };
}
