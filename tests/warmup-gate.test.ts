import test from "node:test";
import assert from "node:assert/strict";

import { evaluateWarmup } from "../lib/session/warmup-gate.ts";

test("warmup gate delays session start until inference has run", () => {
  const waiting = evaluateWarmup({
    cameraRunning: true,
    modelLoaded: true,
    lastInferenceMs: 0,
    facesDetected: 0,
    lastFaceSeenAtMs: null,
    nowMs: 10_000,
  });
  assert.equal(waiting.ready, false);
  assert.equal(waiting.phase, "waiting_for_inference");

  const ready = evaluateWarmup({
    cameraRunning: true,
    modelLoaded: true,
    lastInferenceMs: 12.5,
    facesDetected: 1,
    lastFaceSeenAtMs: 9_500,
    nowMs: 10_000,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.phase, "ready");
});
