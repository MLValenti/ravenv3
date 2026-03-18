import test from "node:test";
import assert from "node:assert/strict";

import { shouldStopForTrackingLost } from "../lib/session/tracking-watchdog.ts";

test("StepEngine does not stop session for tracking lost until trackingEverAcquired becomes true", () => {
  const beforeAcquired = shouldStopForTrackingLost({
    trackingEverAcquired: false,
    lastTrackedAtMs: null,
    nowMs: 30_000,
    lostThresholdMs: 10_000,
  });
  assert.equal(beforeAcquired, false);

  const afterAcquiredWithinThreshold = shouldStopForTrackingLost({
    trackingEverAcquired: true,
    lastTrackedAtMs: 25_000,
    nowMs: 30_000,
    lostThresholdMs: 10_000,
  });
  assert.equal(afterAcquiredWithinThreshold, false);

  const afterAcquiredLost = shouldStopForTrackingLost({
    trackingEverAcquired: true,
    lastTrackedAtMs: 10_000,
    nowMs: 30_001,
    lostThresholdMs: 10_000,
  });
  assert.equal(afterAcquiredLost, true);
});
