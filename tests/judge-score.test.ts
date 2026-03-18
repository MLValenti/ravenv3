import test from "node:test";
import assert from "node:assert/strict";

import { scoreJudgeChecks } from "../lib/eval/judge-score.ts";

test("judge score is high only when all critical checks pass", () => {
  const score = scoreJudgeChecks(
    {
      answered_last_message: true,
      continuity: true,
      in_character: true,
      non_repetitive: true,
    },
    0,
  );
  assert.equal(score, 100);
});

test("judge score is capped when answer check fails", () => {
  const score = scoreJudgeChecks(
    {
      answered_last_message: false,
      continuity: true,
      in_character: true,
      non_repetitive: true,
    },
    0,
  );
  assert.ok(score <= 69);
});

test("judge score is capped when continuity check fails", () => {
  const score = scoreJudgeChecks(
    {
      answered_last_message: true,
      continuity: false,
      in_character: true,
      non_repetitive: true,
    },
    0,
  );
  assert.ok(score <= 64);
});

test("judge issues reduce score", () => {
  const withoutIssues = scoreJudgeChecks(
    {
      answered_last_message: true,
      continuity: true,
      in_character: true,
      non_repetitive: true,
    },
    0,
  );
  const withIssues = scoreJudgeChecks(
    {
      answered_last_message: true,
      continuity: true,
      in_character: true,
      non_repetitive: true,
    },
    3,
  );
  assert.ok(withIssues < withoutIssues);
});

