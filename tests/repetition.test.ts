import test from "node:test";
import assert from "node:assert/strict";

import {
  detectStaleResponseReuse,
  shouldPreserveAnsweredQuestionAgainstRepetitionFallback,
} from "../lib/chat/repetition.ts";

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

test("valid direct answer that already passed turn-plan check is preserved against phrase-reuse fallback", () => {
  const preserve = shouldPreserveAnsweredQuestionAgainstRepetitionFallback({
    repetitionCheck: { repeated: true, reason: "phrase_reuse" },
    turnPlanRequiredMove: "answer_user_question",
    turnPlanCheck: { ok: true, reason: "generic_question_answered" },
  });

  assert.equal(preserve, true);
});

test("exact repeated direct answer can still trigger repetition fallback", () => {
  const preserve = shouldPreserveAnsweredQuestionAgainstRepetitionFallback({
    repetitionCheck: { repeated: true, reason: "exact_match" },
    turnPlanRequiredMove: "answer_user_question",
    turnPlanCheck: { ok: true, reason: "generic_question_answered" },
  });

  assert.equal(preserve, false);
});
