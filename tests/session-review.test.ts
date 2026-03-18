import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionReviewLines,
  hasResumableSessionSnapshot,
  sanitizeSessionResumeSnapshot,
  sanitizeSessionReviewSnapshot,
} from "../lib/session/session-review.ts";

test("resume snapshot is resumable when task progress is active", () => {
  const snapshot = sanitizeSessionResumeSnapshot({
    savedAt: 1_000,
    deterministicTaskStartedAtMs: 500,
    sceneState: {
      topic_type: "task_execution",
      topic_locked: true,
      task_progress: "secured",
    },
  });
  assert.ok(snapshot);
  assert.equal(hasResumableSessionSnapshot(snapshot), true);
  assert.equal(snapshot.sceneState.task_progress, "secured");
});

test("review snapshot builds stable summary lines", () => {
  const review = sanitizeSessionReviewSnapshot({
    reason: "completed",
    savedAt: 2_000,
    metrics: {
      pass_rate: 0.75,
      fail_rate: 0.25,
      refusal_count: 1,
      average_response_latency_ms: 12_000,
      total_turns: 8,
      streak_max: 3,
    },
  });
  assert.ok(review);
  const lines = buildSessionReviewLines(review);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /completed/i);
  assert.match(lines[1], /75%/i);
  assert.match(lines[2], /Refusals: 1/i);
  assert.match(lines[3], /12s/i);
});
