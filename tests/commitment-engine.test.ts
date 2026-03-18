import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCommitmentDecision,
  buildCommitmentPromptBlock,
  clearVerificationCommitment,
  createCommitmentState,
  createVerificationCommitment,
} from "../lib/session/commitment-engine.ts";

test("propose activity creates a pending choose_game commitment when Raven only clarifies", () => {
  const decision = applyCommitmentDecision({
    current: createCommitmentState(),
    act: "propose_activity",
    candidateText:
      "Fine. I will choose. Do you want something quick or something that takes a few minutes?",
    userText: "lets play a game",
    nowMs: 1_000,
  });

  assert.equal(decision.text.includes("quick"), true);
  assert.equal(decision.next.type, "choose_game");
  assert.equal(decision.next.locked, true);

  const block = buildCommitmentPromptBlock(decision.next);
  assert.match(block, /Type: choose_game/i);
  assert.match(block, /Locked: yes/i);
});

test("existing choose_game commitment forces a concrete game choice on the next turn", () => {
  const setup = applyCommitmentDecision({
    current: createCommitmentState(),
    act: "propose_activity",
    candidateText:
      "Fine. I will choose. Do you want something quick or something that takes a few minutes?",
    userText: "lets play a game",
    nowMs: 1_000,
  });

  const followThrough = applyCommitmentDecision({
    current: setup.next,
    act: "answer_activity_choice",
    candidateText: "Stand still and look at the camera.",
    userText: "you pick",
    nowMs: 2_000,
  });

  assert.equal(followThrough.forced, true);
  assert.match(followThrough.text, /I pick\./i);
  assert.equal(followThrough.next.locked, false);
});

test("choose_game fallback prefers non-word game for wager language", () => {
  const setup = applyCommitmentDecision({
    current: createCommitmentState(),
    act: "propose_activity",
    candidateText:
      "Fine. I will choose. Do you want something quick or something that takes a few minutes?",
    userText: "lets play a game",
    nowMs: 1_000,
  });

  const followThrough = applyCommitmentDecision({
    current: setup.next,
    act: "answer_activity_choice",
    candidateText: "Stand still and look at the camera.",
    userText: "lets bet on the game",
    nowMs: 2_000,
  });

  assert.equal(followThrough.forced, true);
  assert.match(followThrough.text, /i pick\./i);
  assert.doesNotMatch(followThrough.text, /word chain/i);
});

test("task requests are forced to a direct task assignment when no blocker question is needed", () => {
  const decision = applyCommitmentDecision({
    current: createCommitmentState(),
    act: "task_request",
    candidateText: "Would you like something simple or challenging?",
    userText: "give me a task",
    nowMs: 3_000,
  });

  assert.equal(decision.forced, true);
  assert.match(decision.text, /Here is your task/i);
  assert.match(decision.text, /reply done once it is secure/i);
  assert.equal(decision.next.locked, false);
});

test("task requests keep a focused blocker clarification instead of forcing assignment", () => {
  const decision = applyCommitmentDecision({
    current: createCommitmentState(),
    act: "task_request",
    candidateText: "What items are actually available right now so I do not build the wrong task?",
    userText: "give me a toy task for 30 minutes",
    nowMs: 3_500,
  });

  assert.equal(decision.forced, false);
  assert.match(decision.text, /what items are actually available right now/i);
  assert.equal(decision.next.locked, false);
});

test("duration requests are forced to a direct duration answer", () => {
  const decision = applyCommitmentDecision({
    current: createCommitmentState(),
    act: "duration_request",
    candidateText: "Tell me more about what you mean first.",
    userText: "how long do i wear it",
    nowMs: 4_000,
  });

  assert.equal(decision.forced, true);
  assert.match(decision.text, /2 hours/i);
  assert.equal(decision.next.locked, false);
});

test("verification commitment resolves on a valid verification follow-up", () => {
  const decision = applyCommitmentDecision({
    current: createVerificationCommitment("finish presence before moving on", 5_000),
    act: "other",
    candidateText: "Good. I have you in frame. User detected in frame. We continue.",
    userText: "done",
    nowMs: 6_000,
  });

  assert.equal(decision.forced, false);
  assert.equal(decision.next.locked, false);
});

test("clearVerificationCommitment only clears the verification lock", () => {
  const cleared = clearVerificationCommitment(
    createVerificationCommitment("finish presence before moving on", 7_000),
  );
  assert.equal(cleared.type, "none");

  const unchanged = clearVerificationCommitment({
    type: "choose_game",
    locked: true,
    detail: "choose the game now",
    source_act: "answer_activity_choice",
    created_at: 8_000,
  });
  assert.equal(unchanged.type, "choose_game");
  assert.equal(unchanged.locked, true);
});
