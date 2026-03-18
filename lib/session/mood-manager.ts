export type MoodLabel = "frustrated" | "strict" | "neutral" | "warm";

export type MoodEventType =
  | "verification_pass"
  | "verification_fail"
  | "verification_inconclusive"
  | "user_ack"
  | "user_refusal"
  | "user_answered"
  | "user_question"
  | "idle_timeout"
  | "session_start"
  | "session_end";

export type MoodState = {
  mood_score: number;
  compliance_streak: number;
  miss_streak: number;
  last_update_ts: number;
  last_event: MoodEventType;
  last_event_delta: number;
};

export type MoodSnapshot = MoodState & {
  mood_label: MoodLabel;
  decay_adjusted_score: number;
};

export type MoodConfig = {
  baseline: number;
  deltas: Record<MoodEventType, number>;
};

export const DEFAULT_MOOD_CONFIG: MoodConfig = {
  baseline: 60,
  deltas: {
    verification_pass: 5,
    verification_fail: -8,
    verification_inconclusive: -2,
    user_ack: 0,
    user_refusal: -10,
    user_answered: 2,
    user_question: 1,
    idle_timeout: -3,
    session_start: 0,
    session_end: 0,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function deriveMoodLabel(score: number): MoodLabel {
  if (score <= 25) {
    return "frustrated";
  }
  if (score <= 50) {
    return "strict";
  }
  if (score <= 75) {
    return "neutral";
  }
  return "warm";
}

function applyLazyDecay(score: number, lastUpdateTs: number, nowMs: number, baseline: number): number {
  if (!Number.isFinite(nowMs) || nowMs <= lastUpdateTs) {
    return score;
  }
  const elapsedMinutes = Math.floor((nowMs - lastUpdateTs) / 60_000);
  if (elapsedMinutes <= 0) {
    return score;
  }

  if (score === baseline) {
    return score;
  }

  const direction = score < baseline ? 1 : -1;
  const delta = Math.min(Math.abs(baseline - score), elapsedMinutes);
  return score + direction * delta;
}

export function createInitialMoodState(nowMs = Date.now()): MoodState {
  return {
    mood_score: 60,
    compliance_streak: 0,
    miss_streak: 0,
    last_update_ts: nowMs,
    last_event: "session_start",
    last_event_delta: 0,
  };
}

export function readMoodSnapshot(
  state: MoodState,
  nowMs = Date.now(),
  config: MoodConfig = DEFAULT_MOOD_CONFIG,
): MoodSnapshot {
  const decayAdjustedScore = clamp(
    applyLazyDecay(state.mood_score, state.last_update_ts, nowMs, config.baseline),
    0,
    100,
  );
  return {
    ...state,
    mood_label: deriveMoodLabel(decayAdjustedScore),
    decay_adjusted_score: decayAdjustedScore,
  };
}

export function resetMoodForNewSession(
  previous: MoodState | null,
  nowMs = Date.now(),
  config: MoodConfig = DEFAULT_MOOD_CONFIG,
): MoodState {
  if (!previous) {
    return createInitialMoodState(nowMs);
  }

  const snapshot = readMoodSnapshot(previous, nowMs, config);
  const partialResetScore = Math.round((snapshot.decay_adjusted_score + config.baseline) / 2);
  return {
    mood_score: clamp(partialResetScore, 0, 100),
    compliance_streak: 0,
    miss_streak: 0,
    last_update_ts: nowMs,
    last_event: "session_start",
    last_event_delta: 0,
  };
}

function isMissEvent(event: MoodEventType): boolean {
  return event === "verification_fail" || event === "user_refusal";
}

function isPassEvent(event: MoodEventType): boolean {
  return event === "verification_pass";
}

export function applyMoodEvent(
  state: MoodState,
  event: MoodEventType,
  nowMs = Date.now(),
  config: MoodConfig = DEFAULT_MOOD_CONFIG,
): MoodState {
  const snapshot = readMoodSnapshot(state, nowMs, config);
  let nextScore = snapshot.decay_adjusted_score;
  let complianceStreak = snapshot.compliance_streak;
  let missStreak = snapshot.miss_streak;
  let delta = config.deltas[event] ?? 0;

  if (isPassEvent(event)) {
    complianceStreak += 1;
    missStreak = 0;
    if (complianceStreak % 3 === 0) {
      delta += 5;
    }
  } else if (isMissEvent(event)) {
    missStreak += 1;
    complianceStreak = 0;
    if (missStreak % 2 === 0) {
      delta -= 5;
    }
  } else {
    missStreak = 0;
  }

  nextScore = clamp(nextScore + delta, 0, 100);
  return {
    mood_score: nextScore,
    compliance_streak: complianceStreak,
    miss_streak: missStreak,
    last_update_ts: nowMs,
    last_event: event,
    last_event_delta: delta,
  };
}
