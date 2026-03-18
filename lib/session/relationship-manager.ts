export type RelationshipLabel = "low trust" | "building" | "established" | "high trust";

export type RelationshipState = {
  trust_score: number;
  rapport_score: number;
  reliability_score: number;
  relationship_label: RelationshipLabel;
  last_updated_ts: number;
};

export type SessionRelationshipMetrics = {
  pass_rate: number;
  fail_rate: number;
  refusal_count: number;
  average_response_latency_ms: number | null;
  total_turns: number;
  streak_max: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampDelta(value: number, limit: number): number {
  return clamp(Math.round(value), -limit, limit);
}

export function deriveRelationshipLabel(trustScore: number): RelationshipLabel {
  if (trustScore < 35) {
    return "low trust";
  }
  if (trustScore <= 60) {
    return "building";
  }
  if (trustScore <= 80) {
    return "established";
  }
  return "high trust";
}

export function createDefaultRelationshipState(nowMs = Date.now()): RelationshipState {
  const trustScore = 50;
  return {
    trust_score: trustScore,
    rapport_score: 50,
    reliability_score: 50,
    relationship_label: deriveRelationshipLabel(trustScore),
    last_updated_ts: nowMs,
  };
}

export function normalizeRelationshipState(input: Partial<RelationshipState>, nowMs = Date.now()): RelationshipState {
  const trustScore = clamp(
    Number.isFinite(input.trust_score) ? Number(input.trust_score) : 50,
    0,
    100,
  );
  const rapportScore = clamp(
    Number.isFinite(input.rapport_score) ? Number(input.rapport_score) : 50,
    0,
    100,
  );
  const reliabilityScore = clamp(
    Number.isFinite(input.reliability_score) ? Number(input.reliability_score) : 50,
    0,
    100,
  );
  return {
    trust_score: trustScore,
    rapport_score: rapportScore,
    reliability_score: reliabilityScore,
    relationship_label: deriveRelationshipLabel(trustScore),
    last_updated_ts:
      Number.isFinite(input.last_updated_ts) && Number(input.last_updated_ts) > 0
        ? Number(input.last_updated_ts)
        : nowMs,
  };
}

export function updateRelationshipFromSession(
  current: RelationshipState,
  metrics: SessionRelationshipMetrics,
  nowMs = Date.now(),
): RelationshipState {
  const passRate = clamp(metrics.pass_rate, 0, 1);
  const failRate = clamp(metrics.fail_rate, 0, 1);
  const refusalCount = Math.max(0, Math.floor(metrics.refusal_count));
  const totalTurns = Math.max(0, Math.floor(metrics.total_turns));
  const streakMax = Math.max(0, Math.floor(metrics.streak_max));
  const avgLatency = metrics.average_response_latency_ms;

  const trustDeltaRaw =
    passRate * 2.2 +
    (streakMax >= 3 ? 0.6 : 0) -
    failRate * 2.0 -
    refusalCount * 0.75;
  const rapportDeltaRaw =
    (totalTurns >= 6 ? 1 : totalTurns >= 3 ? 0.4 : -0.8) +
    (avgLatency != null && avgLatency <= 20_000 ? 0.6 : 0) -
    (refusalCount >= 3 ? 1 : 0);
  const reliabilityDeltaRaw =
    passRate * 3.0 +
    (streakMax >= 4 ? 0.8 : 0) -
    failRate * 2.8 -
    (refusalCount >= 2 ? 1 : 0);

  const trustNext = clamp(current.trust_score + clampDelta(trustDeltaRaw, 2), 0, 100);
  const rapportNext = clamp(current.rapport_score + clampDelta(rapportDeltaRaw, 2), 0, 100);
  const reliabilityNext = clamp(
    current.reliability_score + clampDelta(reliabilityDeltaRaw, 3),
    0,
    100,
  );

  return {
    trust_score: trustNext,
    rapport_score: rapportNext,
    reliability_score: reliabilityNext,
    relationship_label: deriveRelationshipLabel(trustNext),
    last_updated_ts: nowMs,
  };
}
