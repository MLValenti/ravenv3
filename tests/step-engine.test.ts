import test from "node:test";
import assert from "node:assert/strict";

import type { CameraEvent, CheckType } from "../lib/camera/events.ts";
import {
  MILESTONE4_STEPS,
  StepEngine,
  type SessionStep,
} from "../lib/session/step-engine.ts";
import { PacingController } from "../lib/session/pacing.ts";

class MockCheckController {
  public startedChecks: CheckType[] = [];
  private handlers = new Set<(event: CameraEvent) => void>();

  start(checkType: CheckType) {
    this.startedChecks.push(checkType);
  }

  stop() {
    // no-op
  }

  onEvent(handler: (event: CameraEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: CameraEvent) {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  maxIterations = 800,
) {
  for (let i = 0; i < maxIterations; i += 1) {
    if (predicate()) {
      return;
    }
    await flushAsync();
  }
  assert.fail(message);
}

function noWaitPacing() {
  return new PacingController(
    "slow",
    {
      minGapBetweenRavenOutputsMs: 3000,
      minTimeBeforeEvaluatingCommandMs: 6000,
      afterFailureExtraDelayMs: 4000,
    },
    async () => undefined,
  );
}

test("step engine transitions on pass to completion", async () => {
  const checks = new MockCheckController();
  const engine = new StepEngine(MILESTONE4_STEPS, checks, {
    autoTickMs: null,
    pacing: noWaitPacing(),
  });

  engine.start();
  await waitFor(
    () => engine.getState() === "waiting_for_check",
    "expected step-1 to enter waiting_for_check",
  );
  assert.equal(engine.getState(), "waiting_for_check");
  assert.equal(engine.getCurrentStep()?.id, "step-1");

  checks.emit({
    type: "check.completed",
    timestamp: Date.now(),
    checkType: "presence",
    status: "passed",
  });
  await waitFor(
    () =>
      engine.getCurrentStep()?.id === "step-2" &&
      engine.getState() === "waiting_for_check",
    "expected transition to step-2",
  );
  assert.equal(engine.getCurrentStep()?.id, "step-2");

  checks.emit({
    type: "check.completed",
    timestamp: Date.now(),
    checkType: "head_turn",
    status: "passed",
  });
  await waitFor(
    () =>
      engine.getCurrentStep()?.id === "step-3" &&
      engine.getState() === "waiting_for_check",
    "expected transition to step-3",
  );
  assert.equal(engine.getCurrentStep()?.id, "step-3");

  checks.emit({
    type: "check.completed",
    timestamp: Date.now(),
    checkType: "presence",
    status: "passed",
  });
  await waitFor(() => engine.getState() === "completed", "expected session completion");
  assert.equal(engine.getState(), "completed");
});

test("step engine retries then fails", async () => {
  const checks = new MockCheckController();
  const engine = new StepEngine(MILESTONE4_STEPS, checks, {
    autoTickMs: null,
    pacing: noWaitPacing(),
  });

  engine.start();
  await waitFor(
    () => engine.getState() === "waiting_for_check",
    "expected waiting_for_check",
  );
  checks.emit({
    type: "check.completed",
    timestamp: Date.now(),
    checkType: "presence",
    status: "failed",
  });
  await waitFor(
    () =>
      engine.getState() === "waiting_for_check" &&
      engine.getCurrentStep()?.id === "step-1",
    "expected retry state waiting_for_check",
  );
  assert.equal(engine.getState(), "waiting_for_check");
  assert.equal(engine.getCurrentStep()?.id, "step-1");

  checks.emit({
    type: "check.completed",
    timestamp: Date.now(),
    checkType: "presence",
    status: "failed",
  });
  await waitFor(() => engine.getState() === "failed", "expected failed state");
  assert.equal(engine.getState(), "failed");
});

test("listen waits for input and does not advance before response", async () => {
  const checks = new MockCheckController();
  const listenStep: SessionStep = {
    id: "listen-1",
    mode: "listen",
    say: "Answer my question.",
    question: "What should happen next?",
    timeoutSeconds: 30,
    onPassSay: "Good answer.",
    onFailSay: "No answer.",
    maxRetries: 0,
  };
  const engine = new StepEngine([listenStep], checks, {
    autoTickMs: null,
    pacing: noWaitPacing(),
  });

  engine.start();
  await waitFor(
    () => engine.getState() === "waiting_for_user",
    "expected waiting_for_user state",
  );
  assert.equal(engine.getState(), "waiting_for_user");

  for (let i = 0; i < 10; i += 1) {
    engine.tick();
  }
  assert.equal(engine.getState(), "waiting_for_user");

  engine.provideUserInput("Go slower and stay direct.");
  await waitFor(() => engine.getState() === "completed", "expected completion after input");
  assert.equal(engine.getState(), "completed");
});

test("step engine stop works from running state", async () => {
  const checks = new MockCheckController();
  const engine = new StepEngine(MILESTONE4_STEPS, checks, {
    autoTickMs: null,
    pacing: noWaitPacing(),
  });

  engine.start();
  await flushAsync();
  engine.stop("manual stop");
  assert.equal(engine.getState(), "stopped");
});

test("session stops on emergency stop", async () => {
  const checks = new MockCheckController();
  const engine = new StepEngine(MILESTONE4_STEPS, checks, {
    autoTickMs: null,
    pacing: noWaitPacing(),
  });

  engine.start();
  await flushAsync();
  engine.stop("Emergency stop engaged. Session stopped.");
  assert.equal(engine.getState(), "stopped");
});

test("step engine manual continue advances current step", async () => {
  const checks = new MockCheckController();
  const engine = new StepEngine(MILESTONE4_STEPS, checks, {
    autoTickMs: null,
    pacing: noWaitPacing(),
  });

  engine.start();
  await waitFor(
    () => engine.getState() === "waiting_for_check",
    "expected waiting state before manual continue",
  );
  engine.manualContinue();
  await waitFor(
    () => engine.getCurrentStep()?.id === "step-2",
    "expected manual continue to advance to step-2",
  );
  assert.equal(engine.getCurrentStep()?.id, "step-2");
});

test("pacing delays are applied before speaking and check start", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const checks = new MockCheckController();
  const singleStep: SessionStep = {
    id: "paced-1",
    mode: "check",
    say: "Center yourself.",
    checkType: "presence",
    timeoutSeconds: 10,
    onPassSay: "Good.",
    onFailSay: "Reset.",
    maxRetries: 0,
  };
  const pacing = new PacingController("slow");
  const outputs: number[] = [];
  const engine = new StepEngine([singleStep], checks, {
    autoTickMs: null,
    pacing,
  });
  engine.onEvent((event) => {
    if (event.type === "output") {
      outputs.push(Date.now());
    }
  });

  engine.start();
  await flushAsync();
  assert.equal(outputs.length, 0);
  assert.equal(checks.startedChecks.length, 0);

  t.mock.timers.tick(2999);
  await flushAsync();
  assert.equal(outputs.length, 0);
  assert.equal(checks.startedChecks.length, 0);

  t.mock.timers.tick(1);
  await flushAsync();
  assert.equal(outputs.length, 1);
  assert.equal(checks.startedChecks.length, 0);

  t.mock.timers.tick(5999);
  await flushAsync();
  assert.equal(checks.startedChecks.length, 0);

  t.mock.timers.tick(1);
  await flushAsync();
  assert.equal(checks.startedChecks.length, 1);
});
