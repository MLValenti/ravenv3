import assert from "node:assert/strict";
import test from "node:test";

import {
  beginTurnRequest,
  canCommitAnchoredAssistantTurn,
  canCommitAssistantReplay,
  canCommitAssistantTurn,
  finishTurnRequest,
  markAssistantReplay,
  markAssistantTurnCommitted,
  normalizeAssistantCommitText,
  registerStreamFinalize,
} from "../lib/session/assistant-turn-guard.ts";

test("turn request guard blocks a second active request for the same user turn", () => {
  const requests = new Map<number, string>();
  assert.deepEqual(beginTurnRequest(requests, 7, "turn-a"), {
    allow: true,
    reason: "started",
  });
  assert.deepEqual(beginTurnRequest(requests, 7, "turn-a"), {
    allow: false,
    reason: "request_already_active",
  });
  assert.deepEqual(beginTurnRequest(requests, 7, "turn-b"), {
    allow: false,
    reason: "different_request_already_active",
  });
  finishTurnRequest(requests, 7, "turn-a");
  assert.equal(requests.has(7), false);
});

test("assistant commit guard blocks exact duplicate reply commits on the same turn", () => {
  const committed = new Map<number, { requestId: string; normalizedText: string }>();
  const first = canCommitAssistantTurn(
    committed,
    { requestId: "turn-a", sourceUserMessageId: 12 },
    "Good. Next, keep it on, pet.",
  );
  assert.equal(first.allow, true);
  markAssistantTurnCommitted(committed, { requestId: "turn-a", sourceUserMessageId: 12 }, first.normalizedText);

  const second = canCommitAssistantTurn(
    committed,
    { requestId: "turn-a", sourceUserMessageId: 12 },
    "Good. Next, keep it on, pet.",
  );
  assert.equal(second.allow, false);
  assert.equal(second.reason, "duplicate_commit_same_request");
});

test("assistant commit guard blocks a deterministic fallback after a model reply already committed", () => {
  const committed = new Map<number, { requestId: string; normalizedText: string }>();
  const first = canCommitAssistantTurn(
    committed,
    { requestId: "turn-a", sourceUserMessageId: 19 },
    "Keep it on and report back at the halfway mark.",
  );
  assert.equal(first.allow, true);
  markAssistantTurnCommitted(committed, { requestId: "turn-a", sourceUserMessageId: 19 }, first.normalizedText);

  const second = canCommitAssistantTurn(
    committed,
    { requestId: "turn-b", sourceUserMessageId: 19 },
    "Start now. Put it on now and reply done once it is secure, pet.",
  );
  assert.equal(second.allow, false);
  assert.equal(second.reason, "second_authoritative_reply_same_turn");
});

test("task-style duplicate instruction replay is blocked within one user turn", () => {
  const committed = new Map<number, { requestId: string; normalizedText: string }>();
  const userTurnId = 41;

  const first = canCommitAssistantTurn(
    committed,
    { requestId: "turn-task-1", sourceUserMessageId: userTurnId },
    "Good. Next, keep it on, pet. Check in once halfway through, then report back when the full 2 hours has elapsed.",
  );
  assert.equal(first.allow, true);
  markAssistantTurnCommitted(
    committed,
    { requestId: "turn-task-1", sourceUserMessageId: userTurnId },
    first.normalizedText,
  );

  const exactReplay = canCommitAssistantTurn(
    committed,
    { requestId: "turn-task-1", sourceUserMessageId: userTurnId },
    "Good. Next, keep it on, pet. Check in once halfway through, then report back when the full 2 hours has elapsed.",
  );
  assert.equal(exactReplay.allow, false);
  assert.equal(exactReplay.reason, "duplicate_commit_same_request");

  const railReplay = canCommitAssistantTurn(
    committed,
    { requestId: "turn-task-2", sourceUserMessageId: userTurnId },
    "Good. Put your Chastity Cage on now, lock it, then get in frame and show me it is secure. Keep steady pressure on the current task.",
  );
  assert.equal(railReplay.allow, false);
  assert.equal(railReplay.reason, "second_authoritative_reply_same_turn");
});

test("same task-loop line cannot be appended three times without a new user turn", () => {
  let replay = markAssistantReplay(
    22,
    normalizeAssistantCommitText(
      "Start now. Put it on now and reply done once it is secure, pet.",
    ),
  );

  const second = canCommitAssistantReplay(
    replay,
    22,
    "Start now. Put it on now and reply done once it is secure, pet.",
  );
  assert.equal(second.allow, false);
  assert.equal(second.reason, "duplicate_without_new_user_message");

  const third = canCommitAssistantReplay(
    replay,
    22,
    "Start now. Put it on now and reply done once it is secure, pet.",
  );
  assert.equal(third.allow, false);
  assert.equal(third.reason, "duplicate_without_new_user_message");

  replay = markAssistantReplay(
    23,
    normalizeAssistantCommitText(
      "Start now. Put it on now and reply done once it is secure, pet.",
    ),
  );
  const afterNewUser = canCommitAssistantReplay(
    replay,
    24,
    "Start now. Put it on now and reply done once it is secure, pet.",
  );
  assert.equal(afterNewUser.allow, true);
});

test("stream finalize guard only allows one finalize event per request id", () => {
  const finalized = new Set<string>();
  assert.deepEqual(registerStreamFinalize(finalized, "turn-1"), {
    allow: true,
    reason: "registered",
  });
  assert.deepEqual(registerStreamFinalize(finalized, "turn-1"), {
    allow: false,
    reason: "duplicate_finalize",
  });
});

test("assistant commit normalization collapses whitespace for dedupe", () => {
  assert.equal(
    normalizeAssistantCommitText(" Good.   Next, keep it on, pet. \n"),
    "good. next, keep it on, pet.",
  );
});

test("anchored commit guard blocks an untraced fallback after the first reply on the same user turn", () => {
  const committed = new Map<number, { requestId: string; normalizedText: string }>();

  const first = canCommitAnchoredAssistantTurn(
    committed,
    55,
    "turn-short-follow-up",
    "I mean the part about aftercare. Point to the exact part you want clarified, and I will make it plain.",
  );
  assert.equal(first.allow, true);
  markAssistantTurnCommitted(
    committed,
    { requestId: "turn-short-follow-up", sourceUserMessageId: 55 },
    first.normalizedText,
  );

  const untracedFollowUp = canCommitAnchoredAssistantTurn(
    committed,
    55,
    null,
    "Enough hovering, pet. Tell me what you actually want.",
  );
  assert.equal(untracedFollowUp.allow, false);
  assert.equal(untracedFollowUp.reason, "second_authoritative_reply_same_turn");
});
