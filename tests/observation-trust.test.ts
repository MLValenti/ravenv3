import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObservationTrustGuardLine,
  evaluateObservationTrust,
} from "../lib/session/observation-trust.ts";

test("observation trust rejects stale payloads", () => {
  const trust = evaluateObservationTrust(
    {
      ts: 1_000,
      camera_available: true,
      inference_status: "ok",
      last_inference_ms: 12.4,
    },
    10_500,
    3_000,
  );
  assert.equal(trust.canDescribeVisuals, false);
  assert.equal(trust.isFresh, false);
  assert.match(trust.reason, /stale/i);
  assert.match(buildObservationTrustGuardLine(trust), /do not claim current visual details/i);
});

test("observation trust accepts fresh inference data", () => {
  const trust = evaluateObservationTrust(
    {
      ts: 9_500,
      camera_available: true,
      inference_status: "ok",
      last_inference_ms: 16.8,
    },
    10_000,
    3_000,
  );
  assert.equal(trust.canDescribeVisuals, true);
  assert.equal(trust.isFresh, true);
  assert.match(buildObservationTrustGuardLine(trust), /fresh live observation/i);
});

