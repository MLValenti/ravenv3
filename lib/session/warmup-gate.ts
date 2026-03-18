export type WarmupPhase =
  | "camera_not_running"
  | "waiting_for_inference"
  | "waiting_for_face"
  | "ready";

export type WarmupSnapshot = {
  cameraRunning: boolean;
  modelLoaded: boolean;
  lastInferenceMs: number;
  facesDetected: number;
  lastFaceSeenAtMs: number | null;
  nowMs: number;
};

export type WarmupEvaluation = {
  ready: boolean;
  phase: WarmupPhase;
  guidance?: string;
};

const FACE_RECENT_WINDOW_MS = 3000;

export function evaluateWarmup(snapshot: WarmupSnapshot): WarmupEvaluation {
  if (!snapshot.cameraRunning) {
    return {
      ready: false,
      phase: "camera_not_running",
      guidance: "Start camera first.",
    };
  }

  if (!snapshot.modelLoaded || snapshot.lastInferenceMs <= 0) {
    return {
      ready: false,
      phase: "waiting_for_inference",
      guidance: "Warming up camera...",
    };
  }

  const faceSeenRecently =
    snapshot.lastFaceSeenAtMs !== null &&
    snapshot.nowMs - snapshot.lastFaceSeenAtMs <= FACE_RECENT_WINDOW_MS;

  if (!faceSeenRecently) {
    return {
      ready: false,
      phase: "waiting_for_face",
      guidance: "Get your face in frame and improve lighting.",
    };
  }

  return {
    ready: true,
    phase: "ready",
  };
}
