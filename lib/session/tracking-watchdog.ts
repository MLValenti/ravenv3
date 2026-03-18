export type TrackingWatchdogInput = {
  trackingEverAcquired: boolean;
  lastTrackedAtMs: number | null;
  nowMs: number;
  lostThresholdMs: number;
};

export function shouldStopForTrackingLost(input: TrackingWatchdogInput): boolean {
  if (!input.trackingEverAcquired) {
    return false;
  }

  if (input.lastTrackedAtMs === null) {
    return false;
  }

  return input.nowMs - input.lastTrackedAtMs > input.lostThresholdMs;
}
