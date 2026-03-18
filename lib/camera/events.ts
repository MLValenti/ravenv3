import type { VisionObservation } from "./observation.ts";

export type CheckType = "presence" | "head_turn" | "hold_still";

export type CheckStatus = "idle" | "running" | "passed" | "failed";

export type PresenceResult = {
  type: "presence";
  passed: boolean;
  reasons: string[];
  brightness: number;
  faceDetected: boolean;
  passCount: number;
  windowSize: number;
  requiredPasses: number;
};

export type HeadTurnPhase =
  | "calibrating"
  | "waiting_turns"
  | "passed"
  | "failed_timeout";

export type HeadTurnResult = {
  type: "head_turn";
  passed: boolean;
  phase: HeadTurnPhase;
  reasons: string[];
  yaw: number | null;
  rawYaw: number | null;
  baselineYaw: number | null;
  leftSeen: boolean;
  rightSeen: boolean;
  activeThreshold: "calibrating" | "left_or_right";
  elapsedMs: number;
};

export type HoldStillResult = {
  type: "hold_still";
  passed: boolean;
  reasons: string[];
  faceDetected: boolean;
  brightness: number;
  yaw: number | null;
  baselineYaw: number | null;
  yawDelta: number | null;
  passCount: number;
  windowSize: number;
  requiredPasses: number;
};

export type CameraDiagnostics = {
  modelLoaded: boolean;
  lastInferenceMs: number;
  facesDetected: number;
  videoWidth: number;
  videoHeight: number;
  taskModelUrl: string;
  wasmBaseUrl: string;
  selfTestStatus: "not_run" | "pass" | "fail";
  lastError: string | null;
};

export type CameraEvent =
  | { type: "camera.started"; timestamp: number }
  | { type: "camera.stopped"; timestamp: number }
  | { type: "camera.error"; timestamp: number; message: string }
  | { type: "vision.error"; timestamp: number; message: string }
  | { type: "diagnostics.update"; timestamp: number; diagnostics: CameraDiagnostics }
  | { type: "check.started"; timestamp: number; checkType: CheckType }
  | { type: "check.stopped"; timestamp: number; checkType: CheckType }
  | {
      type: "check.update";
      timestamp: number;
      checkType: CheckType;
      result: PresenceResult | HeadTurnResult | HoldStillResult;
    }
  | { type: "observation.update"; timestamp: number; observation: VisionObservation }
  | { type: "check.completed"; timestamp: number; checkType: CheckType; status: "passed" | "failed" };

type Handler<TEvent> = (event: TEvent) => void;

export class TypedEventBus<TEvent extends { type: string }> {
  private handlers = new Set<Handler<TEvent>>();

  on(handler: Handler<TEvent>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: TEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

export function createCameraEventBus() {
  return new TypedEventBus<CameraEvent>();
}
