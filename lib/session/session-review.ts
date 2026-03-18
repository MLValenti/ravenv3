import type { SessionRelationshipMetrics } from "./relationship-manager.ts";
import { createSceneState, type SceneState } from "./scene-state.ts";

export type SessionResumeSnapshot = {
  sceneState: SceneState;
  deterministicTaskStartedAtMs: number | null;
  savedAt: number;
};

export type SessionReviewSnapshot = {
  reason: string;
  metrics: SessionRelationshipMetrics;
  savedAt: number;
};

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function sanitizeSessionResumeSnapshot(input: unknown): SessionResumeSnapshot | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<SessionResumeSnapshot> & {
    sceneState?: Partial<SceneState>;
  };
  const fallback = createSceneState();
  const scene = (candidate.sceneState ?? {}) as Partial<SceneState>;
  const sceneState: SceneState = {
    ...fallback,
    topic_type: normalizeString(scene.topic_type, fallback.topic_type) as SceneState["topic_type"],
    topic_locked: normalizeBoolean(scene.topic_locked, fallback.topic_locked),
    topic_state: normalizeString(scene.topic_state, fallback.topic_state) as SceneState["topic_state"],
    resume_topic_type: normalizeString(
      scene.resume_topic_type,
      fallback.resume_topic_type,
    ) as SceneState["resume_topic_type"],
    resume_topic_locked: normalizeBoolean(
      scene.resume_topic_locked,
      fallback.resume_topic_locked,
    ),
    resume_topic_state: normalizeString(
      scene.resume_topic_state,
      fallback.resume_topic_state,
    ) as SceneState["resume_topic_state"],
    scene_type: normalizeString(scene.scene_type, fallback.scene_type),
    game_template_id: normalizeString(
      scene.game_template_id,
      fallback.game_template_id,
    ) as SceneState["game_template_id"],
    game_rotation_index: normalizeNumber(
      scene.game_rotation_index,
      fallback.game_rotation_index,
    ),
    game_progress: normalizeString(
      scene.game_progress,
      fallback.game_progress,
    ) as SceneState["game_progress"],
    game_outcome: normalizeString(
      scene.game_outcome,
      fallback.game_outcome,
    ) as SceneState["game_outcome"],
    game_reward_state: normalizeString(
      scene.game_reward_state,
      fallback.game_reward_state,
    ) as SceneState["game_reward_state"],
    free_pass_count: normalizeNumber(scene.free_pass_count, fallback.free_pass_count),
    agreed_goal: normalizeString(scene.agreed_goal, fallback.agreed_goal),
    stakes: normalizeString(scene.stakes, fallback.stakes),
    win_condition: normalizeString(scene.win_condition, fallback.win_condition),
    lose_condition: normalizeString(scene.lose_condition, fallback.lose_condition),
    task_reward: normalizeString(scene.task_reward, fallback.task_reward),
    task_consequence: normalizeString(scene.task_consequence, fallback.task_consequence),
    task_progress: normalizeString(
      scene.task_progress,
      fallback.task_progress,
    ) as SceneState["task_progress"],
    task_template_id: normalizeString(
      scene.task_template_id,
      fallback.task_template_id,
    ) as SceneState["task_template_id"],
    task_variant_index: normalizeNumber(scene.task_variant_index, fallback.task_variant_index),
    task_duration_minutes: normalizeNumber(
      scene.task_duration_minutes,
      fallback.task_duration_minutes,
    ),
    current_rule: normalizeString(scene.current_rule, fallback.current_rule),
    current_subtask: normalizeString(scene.current_subtask, fallback.current_subtask),
    next_expected_user_action: normalizeString(
      scene.next_expected_user_action,
      fallback.next_expected_user_action,
    ),
    last_verified_action: normalizeString(
      scene.last_verified_action,
      fallback.last_verified_action,
    ),
    resume_current_rule: normalizeString(
      scene.resume_current_rule,
      fallback.resume_current_rule,
    ),
    resume_current_subtask: normalizeString(
      scene.resume_current_subtask,
      fallback.resume_current_subtask,
    ),
    resume_next_expected_user_action: normalizeString(
      scene.resume_next_expected_user_action,
      fallback.resume_next_expected_user_action,
    ),
  };
  return {
    sceneState,
    deterministicTaskStartedAtMs:
      candidate.deterministicTaskStartedAtMs == null
        ? null
        : normalizeNumber(candidate.deterministicTaskStartedAtMs, 0),
    savedAt: normalizeNumber(candidate.savedAt, 0),
  };
}

export function hasResumableSessionSnapshot(snapshot: SessionResumeSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  const state = snapshot.sceneState;
  return (
    state.topic_locked ||
    state.topic_type !== "none" ||
    state.game_progress !== "none" ||
    state.task_progress !== "none" ||
    snapshot.deterministicTaskStartedAtMs !== null
  );
}

export function sanitizeSessionReviewSnapshot(input: unknown): SessionReviewSnapshot | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<SessionReviewSnapshot> & {
    metrics?: Partial<SessionRelationshipMetrics>;
  };
  const metrics = candidate.metrics;
  if (!metrics) {
    return null;
  }
  return {
    reason: normalizeString(candidate.reason, "unknown"),
    savedAt: normalizeNumber(candidate.savedAt, 0),
    metrics: {
      pass_rate: normalizeNumber(metrics.pass_rate, 0),
      fail_rate: normalizeNumber(metrics.fail_rate, 0),
      refusal_count: normalizeNumber(metrics.refusal_count, 0),
      average_response_latency_ms:
        metrics.average_response_latency_ms == null
          ? null
          : normalizeNumber(metrics.average_response_latency_ms, 0),
      total_turns: normalizeNumber(metrics.total_turns, 0),
      streak_max: normalizeNumber(metrics.streak_max, 0),
    },
  };
}

export function buildSessionReviewLines(
  review: SessionReviewSnapshot | null,
): string[] {
  if (!review) {
    return [];
  }
  const { metrics } = review;
  const lines = [
    `Last session ended: ${review.reason.replace(/_/g, " ")}.`,
    `Turns: ${metrics.total_turns}. Pass rate: ${Math.round(metrics.pass_rate * 100)}%. Fail rate: ${Math.round(metrics.fail_rate * 100)}%.`,
    `Refusals: ${metrics.refusal_count}. Best streak: ${metrics.streak_max}.`,
  ];
  if (metrics.average_response_latency_ms != null) {
    lines.push(
      `Average response latency: ${Math.round(metrics.average_response_latency_ms / 1000)}s.`,
    );
  }
  return lines;
}
