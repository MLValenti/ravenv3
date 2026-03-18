import test from "node:test";
import assert from "node:assert/strict";

import { getDeterministicTaskTimerSnapshot } from "../lib/session/task-timer.ts";

test("task timer snapshot tracks halfway countdown while secured", () => {
  const snapshot = getDeterministicTaskTimerSnapshot(0, 30 * 60 * 1000, 120, "secured");
  assert.ok(snapshot);
  assert.equal(snapshot.phaseLabel, "halfway_due");
  assert.equal(snapshot.halfwayRemainingSeconds, 1800);
  assert.equal(snapshot.totalRemainingSeconds, 5400);
});

test("task timer snapshot tracks final countdown after halfway check in", () => {
  const snapshot = getDeterministicTaskTimerSnapshot(
    0,
    90 * 60 * 1000,
    120,
    "halfway_checked",
  );
  assert.ok(snapshot);
  assert.equal(snapshot.phaseLabel, "completion_due");
  assert.equal(snapshot.totalRemainingSeconds, 1800);
});

test("task timer snapshot returns null before the task is secured", () => {
  const snapshot = getDeterministicTaskTimerSnapshot(0, 1_000, 120, "assigned");
  assert.equal(snapshot, null);
});
