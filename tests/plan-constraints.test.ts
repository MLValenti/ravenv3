import test from "node:test";
import assert from "node:assert/strict";

import { applyPlannerConstraints } from "../lib/session/plan-constraints.ts";
import type { PlannedStep } from "../lib/session/step-planner-schema.ts";

function checkStep(
  id: string,
  checkType: "presence" | "head_turn" | "hold_still",
  say: string,
): PlannedStep {
  return {
    id,
    mode: "check",
    say,
    checkType,
    timeoutSeconds: 15,
    onPassSay: "ok",
    onFailSay: "fail",
    maxRetries: 1,
  };
}

test("anti-loop override triggers on repeated plans", () => {
  const history = [
    checkStep("s1", "presence", "Stay centered."),
    checkStep("s2", "presence", "Stay centered differently."),
  ];
  const candidate = checkStep("s3", "presence", "Stay centered again.");

  const result = applyPlannerConstraints(candidate, history, 3);
  assert.equal(result.overridden, true);
  assert.equal(result.step.mode, "talk");
  assert.match(result.reason ?? "", /same checkType/i);
  assert.doesNotMatch(result.step.say, /pace|one sentence|pause and answer/i);
});
