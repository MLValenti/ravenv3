import test from "node:test";
import assert from "node:assert/strict";

import { MultiFrameConfirmation } from "../lib/camera/multi-frame-confirmation.ts";

test("multi-frame confirmation passes when threshold met", () => {
  const confirmation = new MultiFrameConfirmation(5, 3);

  confirmation.push(true);
  confirmation.push(false);
  confirmation.push(true);
  const result = confirmation.push(true);

  assert.equal(result.passed, true);
  assert.equal(result.passCount, 3);
  assert.equal(result.windowSize, 5);
  assert.equal(result.requiredPasses, 3);
});

test("multi-frame confirmation drops older frames when window slides", () => {
  const confirmation = new MultiFrameConfirmation(3, 3);

  confirmation.push(true);
  confirmation.push(true);
  confirmation.push(true);
  const afterSlide = confirmation.push(false);

  assert.equal(afterSlide.passCount, 2);
  assert.equal(afterSlide.passed, false);
});
