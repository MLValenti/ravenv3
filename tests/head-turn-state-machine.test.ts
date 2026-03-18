import test from "node:test";
import assert from "node:assert/strict";

import { HeadTurnStateMachine } from "../lib/camera/head-turn-state-machine.ts";

test("head turn passes when both left and right are seen after calibration", () => {
  const machine = new HeadTurnStateMachine();

  const cal1 = machine.transition(0, 0.02);
  assert.equal(cal1.phase, "calibrating");
  assert.equal(cal1.activeThreshold, "calibrating");

  const cal2 = machine.transition(1100, 0.01);
  assert.equal(cal2.phase, "waiting_turns");
  assert.equal(cal2.passed, false);

  const step2 = machine.transition(1500, -0.2);
  assert.equal(step2.phase, "waiting_turns");
  assert.equal(step2.leftSeen, true);
  assert.equal(step2.passed, false);

  const step3 = machine.transition(1800, 0.25);
  assert.equal(step3.phase, "passed");
  assert.equal(step3.leftSeen, true);
  assert.equal(step3.rightSeen, true);
  assert.equal(step3.passed, true);
});

test("head turn fails on timeout", () => {
  const machine = new HeadTurnStateMachine();

  machine.transition(0, 0.01);
  const timeout = machine.transition(15100, 0);
  assert.equal(timeout.phase, "failed_timeout");
  assert.equal(timeout.failed, true);
});
