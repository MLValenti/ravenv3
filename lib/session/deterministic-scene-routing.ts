import type { SceneState, SceneTopicType } from "./scene-state.ts";
import type { DialogueRouteAct } from "../dialogue/router.ts";

const DETERMINISTIC_TOPIC_TYPES = new Set<SceneTopicType>([
  "game_setup",
  "game_execution",
  "reward_window",
  "reward_negotiation",
  "task_negotiation",
  "task_execution",
  "task_terms_negotiation",
  "duration_negotiation",
  "verification_in_progress",
]);

export function isDeterministicSceneTopic(topicType: SceneTopicType): boolean {
  return DETERMINISTIC_TOPIC_TYPES.has(topicType);
}

export function shouldBypassModelForSceneTurn(input: {
  sceneState: Pick<
    SceneState,
    "topic_type" | "topic_locked" | "scene_type" | "interaction_mode" | "task_hard_lock_active"
  >;
  dialogueAct: DialogueRouteAct;
  hasDeterministicCandidate: boolean;
}): boolean {
  const interactionMode = input.sceneState.interaction_mode;
  const isExplicitDeterministicMode =
    interactionMode === "task_planning" ||
    interactionMode === "locked_task_execution" ||
    interactionMode === "game" ||
    interactionMode === "profile_building" ||
    interactionMode === "relational_chat";

  if (input.hasDeterministicCandidate) {
    return isExplicitDeterministicMode;
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "verification_in_progress"
  ) {
    return true;
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.task_hard_lock_active &&
    interactionMode === "locked_task_execution" &&
    input.sceneState.topic_type === "task_execution"
  ) {
    return true;
  }

  if (
    input.sceneState.topic_locked &&
    interactionMode === "game" &&
    isDeterministicSceneTopic(input.sceneState.topic_type)
  ) {
    return true;
  }

  if (
    input.sceneState.topic_locked &&
    interactionMode === "task_planning" &&
    input.sceneState.topic_type === "task_negotiation"
  ) {
    return true;
  }

  if (
    input.sceneState.topic_locked &&
    interactionMode === "game" &&
    (input.dialogueAct === "propose_activity" || input.dialogueAct === "answer_activity_choice")
  ) {
    return true;
  }

  return false;
}
