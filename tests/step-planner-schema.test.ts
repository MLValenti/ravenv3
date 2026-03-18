import test from "node:test";
import assert from "node:assert/strict";

import {
  createSafeFallbackStep,
  parseAndValidatePlannedStep,
  validatePlannedStep,
} from "../lib/session/step-planner-schema.ts";

test("planner schema enforcement rejects invalid json payload", () => {
  const result = parseAndValidatePlannedStep("not-json", 1);
  assert.equal(result.ok, false);
});

test("planner schema enforcement accepts valid step", () => {
  const result = validatePlannedStep(
    {
      mode: "check",
      say: "Stand centered and keep your focus on me.",
      checkType: "presence",
      timeoutSeconds: 15,
      onPassSay: "Good. Stay with me.",
      onFailSay: "Reset and get back in frame.",
      maxRetries: 1,
    },
    2,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.step.id, "dynamic-2");
    assert.equal(result.step.checkType, "presence");
  }
});

test("disallowed checkType is rejected", () => {
  const result = validatePlannedStep(
    {
      mode: "check",
      say: "Invalid check test.",
      checkType: "unknown_check",
      timeoutSeconds: 12,
      onPassSay: "ok",
      onFailSay: "fail",
      maxRetries: 0,
    },
    3,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /disallowed checkType/i);
  }
});

test("safe fallback step does not use pace questions", () => {
  const fallback = createSafeFallbackStep(9);
  assert.equal(fallback.mode, "talk");
  assert.match(fallback.say, /Hold still and keep your gaze forward/i);
  assert.doesNotMatch(fallback.say, /pace|one sentence|pause and answer/i);
});

test("planner schema sanitizer removes repetitive understood and meta wrapper", () => {
  const result = validatePlannedStep(
    {
      mode: "talk",
      say: "Understood. You chose \"you get to pick it\". Keep the stakes fixed and continue.",
      timeoutSeconds: 15,
      onPassSay: "Understood. You said yes. Keep going.",
      onFailSay: "Understood. Reset once and retry.",
      maxRetries: 1,
    },
    5,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.doesNotMatch(result.step.say, /^understood\b/i);
    assert.doesNotMatch(result.step.say, /^you chose\b/i);
    assert.match(result.step.say, /keep the stakes fixed/i);
  }
});
