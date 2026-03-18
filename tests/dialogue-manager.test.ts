import test from "node:test";
import assert from "node:assert/strict";

import { selectDialogueAct } from "../lib/session/dialogue-manager.ts";

test("dialogue manager answers user questions first", () => {
  const decision = selectDialogueAct({
    hasNewUserMessage: true,
    awaitingUser: false,
    userIntent: "user_question",
    pendingVerification: false,
    clarificationUsedForMessage: false,
    shouldAskQuestion: false,
  });
  assert.equal(decision.act, "answer_user_question");
});

test("dialogue manager routes short clarification follow-ups through clarify_once", () => {
  const decision = selectDialogueAct({
    hasNewUserMessage: true,
    awaitingUser: false,
    userIntent: "user_short_follow_up",
    pendingVerification: false,
    clarificationUsedForMessage: false,
    shouldAskQuestion: false,
  });
  assert.equal(decision.act, "clarify_once");
});

test("dialogue manager clarifies confusion once", () => {
  const first = selectDialogueAct({
    hasNewUserMessage: true,
    awaitingUser: false,
    userIntent: "user_refusal_or_confusion",
    pendingVerification: false,
    clarificationUsedForMessage: false,
    shouldAskQuestion: false,
  });
  assert.equal(first.act, "clarify_once");

  const second = selectDialogueAct({
    hasNewUserMessage: true,
    awaitingUser: false,
    userIntent: "user_refusal_or_confusion",
    pendingVerification: false,
    clarificationUsedForMessage: true,
    shouldAskQuestion: false,
  });
  assert.equal(second.act, "acknowledge_and_reflect");
});

test("dialogue manager chooses verification when pending and user responded", () => {
  const decision = selectDialogueAct({
    hasNewUserMessage: true,
    awaitingUser: false,
    userIntent: "user_ack",
    pendingVerification: true,
    clarificationUsedForMessage: false,
    shouldAskQuestion: false,
  });
  assert.equal(decision.act, "verify_action");
});
