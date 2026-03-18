export type Pace = "slow" | "normal" | "fast";

export type PacingConfig = {
  minGapBetweenRavenOutputsMs: number;
  minTimeBeforeEvaluatingCommandMs: number;
  afterFailureExtraDelayMs: number;
};

export const DEFAULT_PACING_CONFIG: PacingConfig = {
  minGapBetweenRavenOutputsMs: 3000,
  minTimeBeforeEvaluatingCommandMs: 6000,
  afterFailureExtraDelayMs: 4000,
};

export type WaitFn = (ms: number) => Promise<void>;

const PACE_SCALE: Record<Pace, number> = {
  slow: 1,
  normal: 0.7,
  fast: 0.45,
};

function nowMs() {
  return Date.now();
}

export function createWaitFn(): WaitFn {
  return (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, Math.max(0, ms));
    });
}

export class PacingController {
  private readonly waitFn: WaitFn;
  private readonly scale: number;
  private readonly config: PacingConfig;
  private lastOutputAt = 0;
  private lastFailureAt = 0;

  constructor(
    pace: Pace = "slow",
    config: PacingConfig = DEFAULT_PACING_CONFIG,
    waitFn: WaitFn = createWaitFn(),
  ) {
    this.waitFn = waitFn;
    this.scale = PACE_SCALE[pace];
    this.config = config;
  }

  private scaled(ms: number): number {
    return Math.round(ms * this.scale);
  }

  private async waitUntil(targetMs: number) {
    const remaining = targetMs - nowMs();
    if (remaining > 0) {
      await this.waitFn(remaining);
    }
  }

  async beforeSpeak() {
    await this.waitUntil(this.lastOutputAt + this.scaled(this.config.minGapBetweenRavenOutputsMs));
  }

  markSpoke() {
    this.lastOutputAt = nowMs();
  }

  async beforeCheckStart() {
    await this.waitUntil(
      this.lastOutputAt + this.scaled(this.config.minTimeBeforeEvaluatingCommandMs),
    );
  }

  markFailure() {
    this.lastFailureAt = nowMs();
  }

  async beforeNextPlanning() {
    const gapTarget =
      this.lastOutputAt + this.scaled(this.config.minGapBetweenRavenOutputsMs);
    const failureTarget =
      this.lastFailureAt > 0
        ? this.lastFailureAt + this.scaled(this.config.afterFailureExtraDelayMs)
        : 0;
    const target = Math.max(gapTarget, failureTarget);
    await this.waitUntil(target);
  }
}
