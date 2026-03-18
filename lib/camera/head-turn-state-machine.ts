import type { HeadTurnPhase } from "./events.ts";

export type HeadTurnTransition = {
  phase: HeadTurnPhase;
  passed: boolean;
  failed: boolean;
  elapsedMs: number;
  reason: string;
  rawYaw: number | null;
  baselineYaw: number | null;
  leftSeen: boolean;
  rightSeen: boolean;
  activeThreshold: "calibrating" | "left_or_right";
};

type HeadTurnConfig = {
  turnDelta: number;
  calibrationMs: number;
  timeoutMs: number;
};

const DEFAULT_CONFIG: HeadTurnConfig = {
  turnDelta: 0.14,
  calibrationMs: 1000,
  timeoutMs: 15000,
};

export class HeadTurnStateMachine {
  private readonly config: HeadTurnConfig;
  private phase: HeadTurnPhase = "calibrating";
  private startedAt: number | null = null;
  private calibrationValues: number[] = [];
  private baselineYaw: number | null = null;
  private leftSeen = false;
  private rightSeen = false;

  constructor(config: Partial<HeadTurnConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  transition(nowMs: number, yaw: number | null): HeadTurnTransition {
    if (this.startedAt === null) {
      this.startedAt = nowMs;
    }

    const elapsedMs = nowMs - this.startedAt;
    if (this.phase !== "passed" && elapsedMs > this.config.timeoutMs) {
      this.phase = "failed_timeout";
      return {
        phase: this.phase,
        passed: false,
        failed: true,
        elapsedMs,
        reason: "timeout",
        rawYaw: yaw,
        baselineYaw: this.baselineYaw,
        leftSeen: this.leftSeen,
        rightSeen: this.rightSeen,
        activeThreshold: "left_or_right",
      };
    }

    if (this.phase === "calibrating") {
      if (yaw !== null) {
        this.calibrationValues.push(yaw);
      }

      if (elapsedMs >= this.config.calibrationMs) {
        if (this.calibrationValues.length) {
          this.baselineYaw =
            this.calibrationValues.reduce((sum, value) => sum + value, 0) / this.calibrationValues.length;
        } else {
          this.baselineYaw = 0;
        }
        this.phase = "waiting_turns";
      }

      return {
        phase: this.phase,
        passed: false,
        failed: false,
        elapsedMs,
        reason: this.phase === "calibrating" ? "calibrating_baseline" : "calibration_complete",
        rawYaw: yaw,
        baselineYaw: this.baselineYaw,
        leftSeen: this.leftSeen,
        rightSeen: this.rightSeen,
        activeThreshold: "calibrating",
      };
    }

    const baseline = this.baselineYaw ?? 0;
    if (yaw !== null) {
      if (yaw <= baseline - this.config.turnDelta) {
        this.leftSeen = true;
      }
      if (yaw >= baseline + this.config.turnDelta) {
        this.rightSeen = true;
      }
    }

    if (this.leftSeen && this.rightSeen) {
      this.phase = "passed";
      return {
        phase: this.phase,
        passed: true,
        failed: false,
        elapsedMs,
        reason: "left_and_right_detected",
        rawYaw: yaw,
        baselineYaw: this.baselineYaw,
        leftSeen: this.leftSeen,
        rightSeen: this.rightSeen,
        activeThreshold: "left_or_right",
      };
    }

    return {
      phase: this.phase,
      passed: this.phase === "passed",
      failed: this.phase === "failed_timeout",
      elapsedMs,
      reason: "in_progress",
      rawYaw: yaw,
      baselineYaw: this.baselineYaw,
      leftSeen: this.leftSeen,
      rightSeen: this.rightSeen,
      activeThreshold: "left_or_right",
    };
  }
}
