import type { ConversationStateSnapshot } from "../chat/conversation-state.ts";
import type { SceneState, SceneTopicType } from "./scene-state.ts";
import { createTaskSpec } from "./task-spec.ts";

const STRUCTURED_SCENE_TOPICS = new Set<SceneTopicType>([
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

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function conversationHasLiveThread(state: ConversationStateSnapshot): boolean {
  return (
    state.active_thread !== "none" ||
    state.pending_user_request !== "none" ||
    state.active_topic !== "none"
  );
}

function looksTaskLike(text: string): boolean {
  return /\b(task|challenge|assignment|duration|minutes?|hours?|report back|check in|proof|task family)\b/i.test(
    text,
  );
}

function looksGameLike(text: string): boolean {
  return /\b(game|round|bet|wager|stakes?|rock|paper|scissors|number hunt|math duel|riddle lock)\b/i.test(
    text,
  );
}

function conversationLooksTaskLike(state: ConversationStateSnapshot): boolean {
  if (
    state.current_mode === "task_planning" ||
    state.current_mode === "task_execution" ||
    state.current_mode === "locked_task_execution"
  ) {
    return true;
  }
  const combined = normalize(
    [
      state.active_thread,
      state.pending_user_request,
      state.pending_modification,
      state.last_satisfied_request,
      state.active_topic,
      ...state.open_loops,
      ...state.recent_commitments_or_tasks,
    ].join(" "),
  );
  return looksTaskLike(combined);
}

function conversationLooksGameLike(state: ConversationStateSnapshot): boolean {
  if (state.current_mode === "game") {
    return true;
  }
  const combined = normalize(
    [
      state.active_thread,
      state.pending_user_request,
      state.pending_modification,
      state.active_topic,
      ...state.open_loops,
    ].join(" "),
  );
  return looksGameLike(combined);
}

function deriveSoftSceneTopicType(state: ConversationStateSnapshot): SceneTopicType {
  if (state.current_mode === "task_planning" && conversationLooksTaskLike(state)) {
    return "task_negotiation";
  }
  if (conversationHasLiveThread(state)) {
    return "general_request";
  }
  return "none";
}

export function isStructuredSceneTopic(topicType: SceneTopicType): boolean {
  return STRUCTURED_SCENE_TOPICS.has(topicType);
}

export function isHardStructuredScene(input: Pick<
  SceneState,
  "topic_type" | "topic_locked" | "interaction_mode" | "task_hard_lock_active" | "task_paused"
>): boolean {
  if (input.topic_type === "verification_in_progress") {
    return true;
  }
  if (input.topic_type === "task_execution") {
    return input.topic_locked && !input.task_paused;
  }
  if (input.topic_type === "task_negotiation") {
    return input.topic_locked && input.interaction_mode === "task_planning";
  }
  if (
    input.topic_type === "game_setup" ||
    input.topic_type === "game_execution" ||
    input.topic_type === "reward_window" ||
    input.topic_type === "reward_negotiation" ||
    input.topic_type === "task_terms_negotiation" ||
    input.topic_type === "duration_negotiation"
  ) {
    return input.topic_locked;
  }
  return input.task_hard_lock_active;
}

export function reconcileSceneStateWithConversation(
  sceneState: SceneState,
  conversationState: ConversationStateSnapshot,
): SceneState {
  if (isHardStructuredScene(sceneState)) {
    return sceneState;
  }

  const clearTaskResidue =
    sceneState.topic_type === "task_negotiation" && !conversationLooksTaskLike(conversationState);
  const clearGameResidue =
    sceneState.topic_type === "game_setup" && !conversationLooksGameLike(conversationState);
  const nextTopicType = clearTaskResidue || clearGameResidue
    ? deriveSoftSceneTopicType(conversationState)
    : sceneState.topic_type === "none" || sceneState.topic_type === "general_request"
      ? deriveSoftSceneTopicType(conversationState)
      : sceneState.topic_type;
  const clearedTaskSpec = clearTaskResidue
    ? createTaskSpec({
        current_task_domain: sceneState.current_task_domain,
        recent_task_families: sceneState.task_spec.recent_task_families,
        excluded_task_categories: sceneState.task_spec.excluded_task_categories,
        preferred_task_categories: sceneState.task_spec.preferred_task_categories,
        available_task_categories: sceneState.task_spec.available_task_categories,
        novelty_pressure: sceneState.task_spec.novelty_pressure,
      })
    : sceneState.task_spec;

  return {
    ...sceneState,
    interaction_mode: conversationState.current_mode,
    topic_type: nextTopicType,
    topic_locked: clearTaskResidue || clearGameResidue ? false : sceneState.topic_locked,
    topic_state:
      nextTopicType === "none"
        ? "resolved"
        : clearTaskResidue || clearGameResidue
          ? conversationState.pending_user_request !== "none"
            ? "open"
            : "resolved"
          : sceneState.topic_state,
    scene_type:
      clearTaskResidue || clearGameResidue
        ? "conversation"
        : sceneState.scene_type,
    agreed_goal:
      conversationState.active_topic !== "none"
        ? conversationState.active_topic
        : sceneState.agreed_goal,
    user_requested_task_domain: clearTaskResidue ? "none" : sceneState.user_requested_task_domain,
    can_replan_task: clearTaskResidue ? false : sceneState.can_replan_task,
    reason_for_lock: clearTaskResidue ? "" : sceneState.reason_for_lock,
    task_paused: clearTaskResidue ? false : sceneState.task_paused,
    task_spec: clearedTaskSpec,
    current_rule:
      clearTaskResidue || clearGameResidue
        ? "continue the current thread"
        : sceneState.current_rule,
    current_subtask:
      clearTaskResidue || clearGameResidue
        ? conversationState.active_thread !== "none"
          ? conversationState.active_thread
          : "none"
        : sceneState.current_subtask,
    next_expected_user_action:
      clearTaskResidue || clearGameResidue
        ? "reply to the current thread or ask one direct follow-up"
        : sceneState.next_expected_user_action,
  };
}
