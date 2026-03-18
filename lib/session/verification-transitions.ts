import {
  buildSceneFallback,
  type SceneState,
  type SceneTopicType,
} from "./scene-state.ts";
import type { VerificationStatus } from "./verification.ts";

type VerificationTransitionInput = {
  checkType?: string | null;
  status?: VerificationStatus | "confirmed";
};

function resolveContinuationTopic(state: SceneState): SceneTopicType {
  if (state.resume_topic_type !== "none") {
    return state.resume_topic_type;
  }
  return state.topic_type;
}

function buildResumeSceneState(state: SceneState): SceneState {
  const topicType = resolveContinuationTopic(state);
  if (topicType === state.topic_type && state.topic_type !== "verification_in_progress") {
    return state;
  }
  return {
    ...state,
    topic_type: topicType,
    topic_locked: state.resume_topic_type !== "none" ? state.resume_topic_locked : state.topic_locked,
    topic_state: state.resume_topic_type !== "none" ? state.resume_topic_state : state.topic_state,
    current_rule: state.resume_topic_type !== "none" ? state.resume_current_rule : state.current_rule,
    current_subtask:
      state.resume_topic_type !== "none" ? state.resume_current_subtask : state.current_subtask,
    next_expected_user_action:
      state.resume_topic_type !== "none"
        ? state.resume_next_expected_user_action
        : state.next_expected_user_action,
  };
}

function normalizeCheckType(checkType: string): string {
  const normalized = checkType.trim().toLowerCase();
  if (normalized === "user_present") {
    return "presence";
  }
  return normalized;
}

function classifyCheckFamily(checkType: string): "presence" | "head_turn" | "hold" | "object" | "clothing" | "framing" | "generic" {
  const normalized = normalizeCheckType(checkType);
  if (normalized.includes("presence")) {
    return "presence";
  }
  if (normalized.includes("head_turn")) {
    return "head_turn";
  }
  if (
    normalized.includes("hold_still") ||
    normalized.includes("eye_contact_hold") ||
    normalized.includes("timed_hold") ||
    normalized.includes("motion_zone")
  ) {
    return "hold";
  }
  if (normalized.includes("object_")) {
    return "object";
  }
  if (normalized.includes("clothing_")) {
    return "clothing";
  }
  if (
    normalized.includes("centered_in_frame") ||
    normalized.includes("single_person_only") ||
    normalized.includes("body_in_frame") ||
    normalized.includes("camera_quality") ||
    normalized.includes("scene_safety")
  ) {
    return "framing";
  }
  return "generic";
}

function buildCheckDirective(input: VerificationTransitionInput): string {
  if (!input.checkType) {
    return "";
  }
  const family = classifyCheckFamily(input.checkType);
  const status = input.status ?? "pass";
  if (status === "fail") {
    if (family === "presence") {
      return "Get back into frame before anything else.";
    }
    if (family === "head_turn") {
      return "Reset to center and do the turn cleanly.";
    }
    if (family === "object") {
      return "Show the target clearly before you try again.";
    }
    if (family === "framing") {
      return "Fix the frame before you move on.";
    }
    return "Reset cleanly before you continue.";
  }
  if (status === "inconclusive") {
    if (family === "presence") {
      return "Fix the frame first and keep your face visible.";
    }
    if (family === "head_turn") {
      return "Reset to center and keep your movement clean.";
    }
    if (family === "object") {
      return "Keep the target steady if I need another read.";
    }
    if (family === "framing") {
      return "Keep the frame centered and steady.";
    }
    return "Stay ready in case I need another read.";
  }
  if (family === "presence") {
    return "Stay in frame and keep your face forward.";
  }
  if (family === "head_turn") {
    return "Face forward now and hold center.";
  }
  if (family === "hold") {
    return "Release the hold, then stay ready for the next order.";
  }
  if (family === "object") {
    return "Keep the target steady until I move you forward.";
  }
  if (family === "clothing") {
    return "Hold still so the change stays clear.";
  }
  if (family === "framing") {
    return "Keep the frame clean and centered.";
  }
  return "Stay ready for the next order.";
}

function buildTopicDirective(state: SceneState): string {
  const topic = resolveContinuationTopic(state);
  if (topic === "game_setup") {
    return "Stay with the game and keep the pace sharp.";
  }
  if (topic === "game_execution") {
    return "Stay with the game and answer cleanly.";
  }
  if (topic === "task_negotiation") {
    return "Now stay with the task and finish it cleanly.";
  }
  if (topic === "task_execution") {
    return "Stay with the task and follow the next check in.";
  }
  if (topic === "task_terms_negotiation") {
    return "Now finish setting the task reward and consequence.";
  }
  if (topic === "reward_negotiation") {
    return "Now finish locking the stakes before you move on.";
  }
  if (topic === "duration_negotiation") {
    return "The duration stands. Follow it.";
  }
  if (topic === "general_request") {
    return "Stay with the current thread.";
  }
  return "Stay with the current thread.";
}

function isRewardNegotiationComplete(state: SceneState): boolean {
  return Boolean(state.stakes && state.win_condition && state.lose_condition);
}

function isTaskTermsComplete(state: SceneState): boolean {
  return Boolean(state.task_reward && state.task_consequence);
}

function joinParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(" ");
}

function buildAutoAdvanceDirective(resumedState: SceneState): string | null {
  if (resumedState.topic_type === "game_setup") {
    return buildSceneFallback(resumedState, "you pick");
  }

  if (resumedState.topic_type === "game_execution") {
    return buildSceneFallback(resumedState, "");
  }

  if (resumedState.topic_type === "task_negotiation") {
    return buildSceneFallback(resumedState, "");
  }

  if (resumedState.topic_type === "task_execution") {
    return buildSceneFallback(resumedState, "");
  }

  if (resumedState.topic_type === "task_terms_negotiation") {
    return joinParts([
      buildSceneFallback(resumedState, "") ?? "",
      isTaskTermsComplete(resumedState) ? "Now ask for the task or wait for my assignment." : "",
    ]);
  }

  if (resumedState.topic_type === "reward_negotiation") {
    const nextLine = isRewardNegotiationComplete(resumedState)
      ? resumedState.scene_type === "game"
        ? "The terms are locked. We play now."
        : resumedState.scene_type === "challenge"
          ? "The terms are locked. Now take the task."
          : "The terms are locked. Continue."
      : "";
    return joinParts([
      buildSceneFallback(resumedState, "") ?? "",
      nextLine,
    ]);
  }

  if (resumedState.topic_type === "duration_negotiation") {
    return "The duration stands. Start now and follow it.";
  }

  return buildSceneFallback(resumedState, "");
}

function buildResolvedSceneDirective(
  state: SceneState,
  input: VerificationTransitionInput,
): string {
  if (input.status !== "pass" && input.status !== "confirmed") {
    return buildTopicDirective(state);
  }
  const resumedState = buildResumeSceneState(state);
  const autoAdvance = buildAutoAdvanceDirective(resumedState);
  if (autoAdvance) {
    return autoAdvance;
  }
  return buildTopicDirective(state);
}

export function buildVerificationContinuation(
  state: SceneState,
  input: VerificationTransitionInput = {},
): string {
  const parts = [buildCheckDirective(input), buildResolvedSceneDirective(state, input)].filter(
    (part) => part.length > 0,
  );
  return parts.join(" ");
}
