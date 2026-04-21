import type { SceneState, SceneTopicType } from "./scene-state.ts";
import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  isAssistantSelfQuestion,
  isChatSwitchRequest,
  isMutualGettingToKnowRequest,
} from "./interaction-mode.ts";
import {
  isHardStructuredScene,
  isStructuredSceneTopic,
} from "./conversation-runtime.ts";

export function isDeterministicSceneTopic(topicType: SceneTopicType): boolean {
  return isStructuredSceneTopic(topicType);
}

function normalizeTurnText(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function isFreshGreetingTurn(text: string): boolean {
  return /^(hi|hello|hey|yo|good (morning|afternoon|evening))[\s!.?]*$/.test(text);
}

function isTaskScopedNegotiationQuestion(text: string): boolean {
  return /\b(task|duration|minute|minutes|hour|hours|proof|prove|verification|verify|different task|another task|new task|what kind of task|what task|do i need proof|what counts as proof|wear|use)\b/.test(
    text,
  );
}

function isGenuineTaskContinuationTurn(text: string, dialogueAct: DialogueRouteAct): boolean {
  if (dialogueAct === "task_request" || dialogueAct === "duration_request") {
    return true;
  }

  if (dialogueAct === "user_question") {
    return isTaskScopedNegotiationQuestion(text);
  }

  return /\b(yes|yeah|yep|ok|okay|sure|fine|go ahead|do it|give me a task|assign me a task|different task|another task|new task|make it \d+|make it shorter|make it longer|for \d+\s*(minutes?|hours?)|done|finished|completed|i did it|i can do that|i have that)\b/.test(
    text,
  );
}

export function explainBypassModelForSceneTurn(input: {
  sceneState: Pick<
    SceneState,
    "topic_type" | "topic_locked" | "scene_type" | "interaction_mode" | "task_hard_lock_active"
  >;
  dialogueAct: DialogueRouteAct;
  hasDeterministicCandidate: boolean;
  latestUserText?: string | null;
}): { bypass: boolean; reason: string } {
  const interactionMode = input.sceneState.interaction_mode;
  const latestUserText = normalizeTurnText(input.latestUserText);
  const staleLockedTaskNegotiation =
    input.sceneState.topic_locked &&
    interactionMode === "task_planning" &&
    input.sceneState.topic_type === "task_negotiation";

  if (
    staleLockedTaskNegotiation &&
    latestUserText &&
    (isFreshGreetingTurn(latestUserText) ||
      (input.dialogueAct === "user_question" &&
        !isGenuineTaskContinuationTurn(latestUserText, input.dialogueAct)))
  ) {
    // A stale replayed task setup must not trap a fresh greeting or direct question.
    return {
      bypass: false,
      reason: "fresh_question_or_greeting_releases_stale_task_negotiation_lock",
    };
  }

  const isExplicitDeterministicMode =
    isHardStructuredScene({
      topic_type: input.sceneState.topic_type,
      topic_locked: input.sceneState.topic_locked,
      interaction_mode: interactionMode,
      task_hard_lock_active: input.sceneState.task_hard_lock_active,
      task_paused: false,
    });
  const isHighConfidenceOpenConversationTurn =
    latestUserText.length > 0 &&
    (
      isChatSwitchRequest(latestUserText) ||
      isAssistantSelfQuestion(latestUserText) ||
      isMutualGettingToKnowRequest(latestUserText)
    );

  if (input.hasDeterministicCandidate) {
    if (isHighConfidenceOpenConversationTurn) {
      return {
        bypass: false,
        reason: "open_conversation_prefers_model",
      };
    }
    return {
      bypass: isExplicitDeterministicMode,
      reason: isExplicitDeterministicMode
        ? `deterministic_candidate_in_${interactionMode}`
        : "deterministic_candidate_but_non_deterministic_mode",
    };
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "verification_in_progress"
  ) {
    return { bypass: true, reason: "verification_in_progress_locked" };
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.task_hard_lock_active &&
    interactionMode === "locked_task_execution" &&
    input.sceneState.topic_type === "task_execution"
  ) {
    return { bypass: true, reason: "locked_task_execution_hard_lock" };
  }

  if (
    input.sceneState.topic_locked &&
    interactionMode === "game" &&
    isDeterministicSceneTopic(input.sceneState.topic_type)
  ) {
    return { bypass: true, reason: `game_mode_locked_${input.sceneState.topic_type}` };
  }

  if (
    input.sceneState.topic_locked &&
    interactionMode === "task_planning" &&
    input.sceneState.topic_type === "task_negotiation"
  ) {
    return { bypass: true, reason: "task_planning_locked_task_negotiation" };
  }

  if (
    input.sceneState.topic_locked &&
    interactionMode === "game" &&
    (input.dialogueAct === "propose_activity" || input.dialogueAct === "answer_activity_choice")
  ) {
    return { bypass: true, reason: `game_mode_dialogue_act_${input.dialogueAct}` };
  }

  return { bypass: false, reason: "no_deterministic_bypass_condition_matched" };
}

export function shouldBypassModelForSceneTurn(input: {
  sceneState: Pick<
    SceneState,
    "topic_type" | "topic_locked" | "scene_type" | "interaction_mode" | "task_hard_lock_active"
  >;
  dialogueAct: DialogueRouteAct;
  hasDeterministicCandidate: boolean;
  latestUserText?: string | null;
}): boolean {
  return explainBypassModelForSceneTurn(input).bypass;
}
