import type { CameraFrameSnapshot } from "../camera/check-runner";
import type { VisionObservation } from "../camera/observation";
import {
  evaluateCapabilityFromObservation,
  type VerificationCapabilityCatalogEntry,
} from "../camera/vision-capabilities.ts";

export type VerificationCheckType = string;

export type VerificationStatus = "pass" | "fail" | "inconclusive";

export type VerificationResult = {
  checkType: VerificationCheckType;
  status: VerificationStatus;
  confidence: number;
  summary: string;
  raw: Record<string, unknown>;
};

type Thresholds = {
  pass: number;
  fail: number;
};

const DEFAULT_THRESHOLDS: Thresholds = {
  pass: 0.7,
  fail: 0.4,
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function toStatus(confidence: number, thresholds: Thresholds): VerificationStatus {
  if (confidence >= thresholds.pass) {
    return "pass";
  }
  if (confidence <= thresholds.fail) {
    return "fail";
  }
  return "inconclusive";
}

function summarizeUserPresent(snapshot: CameraFrameSnapshot): { confidence: number; summary: string } {
  if (!snapshot.cameraReady) {
    return { confidence: 0.55, summary: "Camera is not ready for verification." };
  }
  if (!snapshot.modelLoaded) {
    return { confidence: 0.55, summary: "Vision model is not loaded yet." };
  }

  if (snapshot.facesDetected > 0) {
    const brightnessScore =
      snapshot.brightness >= 40 && snapshot.brightness <= 210 ? 0.15 : 0;
    const confidence = clampConfidence(0.72 + brightnessScore);
    return {
      confidence,
      summary: `User detected in frame (faces=${snapshot.facesDetected}, brightness=${snapshot.brightness.toFixed(1)}).`,
    };
  }

  const confidence = snapshot.lastInferenceMs > 0 ? 0.2 : 0.45;
  return {
    confidence,
    summary: "No user face detected in the captured frame.",
  };
}

export function runVerification(
  checkType: VerificationCheckType,
  snapshot: CameraFrameSnapshot,
  observation: VisionObservation | null = null,
  checkParams: Record<string, unknown> = {},
  capabilityCatalog: VerificationCapabilityCatalogEntry[] = [],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): VerificationResult {
  if (checkType === "standing_vs_sitting") {
    return {
      checkType,
      status: "inconclusive",
      confidence: 0.5,
      summary: "standing_vs_sitting is not supported by the current local vision model.",
      raw: {
        supported: false,
        cameraReady: snapshot.cameraReady,
        modelLoaded: snapshot.modelLoaded,
      },
    };
  }

  const normalizedCheckType = checkType === "user_present" ? "presence" : checkType;
  if (observation) {
    const knownCapability = capabilityCatalog.some(
      (capability) => capability.capability_id === normalizedCheckType,
    );
    if (knownCapability || normalizedCheckType !== "presence") {
      const evaluated = evaluateCapabilityFromObservation(
        normalizedCheckType,
        observation,
        checkParams,
      );
      return {
        checkType,
        status: evaluated.status,
        confidence: clampConfidence(evaluated.confidence),
        summary: evaluated.summary,
        raw: {
          ...evaluated.raw,
          checkParams,
          observation_ts: observation.ts,
        },
      };
    }
  }

  const assessed = summarizeUserPresent(snapshot);
  const confidence = clampConfidence(assessed.confidence);
  return {
    checkType,
    status: toStatus(confidence, thresholds),
    confidence,
    summary: assessed.summary,
    raw: {
      cameraReady: snapshot.cameraReady,
      modelLoaded: snapshot.modelLoaded,
      facesDetected: snapshot.facesDetected,
      brightness: snapshot.brightness,
      inferenceMs: snapshot.lastInferenceMs,
      yaw: snapshot.yaw,
      lastError: snapshot.lastError,
      capturedAt: snapshot.capturedAt,
    },
  };
}

export function shouldRetryVerification(
  result: VerificationResult,
  retriesRemaining: number,
): boolean {
  if (retriesRemaining <= 0) {
    return false;
  }
  if (result.status !== "inconclusive") {
    return false;
  }
  return result.raw.cameraReady !== false;
}

export function shouldRequestUserConfirmation(result: VerificationResult): boolean {
  return result.status === "inconclusive" && result.raw.cameraReady === false;
}
