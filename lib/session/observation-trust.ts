type ObservationLike = {
  ts?: unknown;
  camera_available?: unknown;
  inference_status?: unknown;
  last_inference_ms?: unknown;
};

export type ObservationTrustResult = {
  canDescribeVisuals: boolean;
  isFresh: boolean;
  ageMs: number | null;
  reason: string;
};

const DEFAULT_MAX_AGE_MS = 3_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function evaluateObservationTrust(
  observation: unknown,
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): ObservationTrustResult {
  const record = asRecord(observation) as ObservationLike | null;
  if (!record) {
    return {
      canDescribeVisuals: false,
      isFresh: false,
      ageMs: null,
      reason: "missing observation payload",
    };
  }

  const cameraAvailable = asBoolean(record.camera_available, false);
  if (!cameraAvailable) {
    return {
      canDescribeVisuals: false,
      isFresh: false,
      ageMs: null,
      reason: "camera unavailable",
    };
  }

  const ts = asNumber(record.ts);
  const ageMs = ts === null ? null : Math.max(0, Math.floor(nowMs - ts));
  const isFresh = ageMs !== null && ageMs <= maxAgeMs;
  if (!isFresh) {
    return {
      canDescribeVisuals: false,
      isFresh: false,
      ageMs,
      reason: ageMs === null ? "missing observation timestamp" : `stale observation (${ageMs}ms old)`,
    };
  }

  const inferenceStatus = asString(record.inference_status);
  const lastInferenceMs = asNumber(record.last_inference_ms);
  if (inferenceStatus === "unavailable" || (lastInferenceMs !== null && lastInferenceMs <= 0)) {
    return {
      canDescribeVisuals: false,
      isFresh: true,
      ageMs,
      reason: "vision inference not ready",
    };
  }

  return {
    canDescribeVisuals: true,
    isFresh: true,
    ageMs,
    reason: "fresh live observation",
  };
}

export function buildObservationTrustGuardLine(
  trust: ObservationTrustResult,
): string {
  if (trust.canDescribeVisuals) {
    return "Observation trust: fresh live observation. Only describe visual facts present in the Observations block.";
  }
  return `Observation trust: ${trust.reason}. Do not claim current visual details. Ask the user to reframe or wait for a fresh camera read.`;
}

