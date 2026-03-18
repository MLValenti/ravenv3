import test from "node:test";
import assert from "node:assert/strict";

import { detectStaleResponseReuse } from "../lib/chat/repetition.ts";

test("repetition detector catches exact and opening reuse", () => {
  assert.deepEqual(
    detectStaleResponseReuse("Stay focused and report back.", ["Stay focused and report back."]),
    { repeated: true, reason: "exact_match" },
  );

  const openingReuse = detectStaleResponseReuse("Stay focused and keep the pace steady.", [
    "Stay focused and keep your posture steady.",
  ]);
  assert.equal(openingReuse.repeated, true);
  assert.equal(openingReuse.reason, "opening_match");
});

test("repetition detector catches stale phrase reuse without exact duplicates", () => {
  const repetition = detectStaleResponseReuse(
    "Answer the question before you pivot, and keep the current thread steady now.",
    ["Start cleanly, then answer the question before you pivot and keep the current thread steady."],
  );

  assert.equal(repetition.repeated, true);
  assert.equal(repetition.reason, "phrase_reuse");
});
