import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionStateContract,
  projectTurnGateUi,
  reduceBeginAssistantRequest,
  reduceAssistantEmission,
  reduceFinishAssistantRequest,
  reduceRegisterAssistantFinalize,
  reduceUserTurn,
  reduceVisibleAssistantCommit,
  selectActiveAssistantRequestId,
  selectHasVisibleAssistantCommit,
} from "../lib/session/session-state-contract.ts";

test("session state contract reduces user turn atomically", () => {
  const state = createSessionStateContract("contract-user-turn");
  const reduced = reduceUserTurn(state, {
    text: "lets play a game",
    nowMs: 1_000,
  });

  assert.equal(reduced.awaitingBeforePersist, false);
  assert.equal(reduced.intent, "user_answer");
  assert.equal(reduced.route.act, "propose_activity");
  assert.equal(reduced.next.turnGate.lastUserMessageId, 1);
  assert.equal(reduced.next.workingMemory.last_user_request, "lets play a game");
  assert.equal(reduced.next.sessionTopic?.topic_type, "game_selection");
});

test("session state contract clears awaiting_user only after persisted user turn", () => {
  let state = createSessionStateContract("contract-awaiting-user");
  state = reduceAssistantEmission(state, {
    stepId: "ask-1",
    content: "Tell me your pace in one line.",
    isQuestion: true,
  });
  assert.equal(state.turnGate.awaitingUser, true);

  const reduced = reduceUserTurn(state, {
    text: "steady and direct",
    nowMs: 2_000,
  });
  assert.equal(reduced.awaitingBeforePersist, true);
  assert.equal(reduced.next.turnGate.awaitingUser, false);
  assert.equal(reduced.intent, "user_answer");
});

test("session state contract assistant emission increments turn ids and updates working memory commitment", () => {
  let state = createSessionStateContract("contract-assistant-turn");
  state = reduceUserTurn(state, {
    text: "give me a task",
    nowMs: 1_000,
  }).next;

  state = reduceAssistantEmission(state, {
    stepId: "task-1",
    content: "Here is your task: Hold still for 30 minutes and report back.",
    isQuestion: false,
  });

  const ui = projectTurnGateUi(state.turnGate);
  assert.equal(ui.lastAssistantTurnId, 1);
  assert.equal(ui.awaitingUser, false);
  assert.equal(ui.lastUserMessageId, 1);
  assert.match(state.workingMemory.last_assistant_commitment, /hold still for 30 minutes/i);
});

test("session state contract keeps assistant request ownership in one runtime state", () => {
  let state = createSessionStateContract("contract-request-runtime");
  state = reduceUserTurn(state, {
    text: "how are you today?",
    nowMs: 1_000,
  }).next;

  const started = reduceBeginAssistantRequest(state, {
    kind: "turn",
    sourceUserMessageId: 1,
    requestId: "req-1",
  });
  assert.equal(started.decision.allow, true);
  state = started.next;
  assert.equal(selectActiveAssistantRequestId(state, "turn", 1), "req-1");

  state = reduceFinishAssistantRequest(state, {
    kind: "turn",
    sourceUserMessageId: 1,
    requestId: "req-1",
  });
  assert.equal(selectActiveAssistantRequestId(state, "turn", 1), null);
});

test("session state contract blocks duplicate visible assistant commits on the same turn", () => {
  let state = createSessionStateContract("contract-visible-commit");
  state = reduceUserTurn(state, {
    text: "how are you today?",
    nowMs: 1_000,
  }).next;

  const first = reduceVisibleAssistantCommit(state, {
    anchorUserMessageId: 1,
    requestId: "req-1",
    renderedText: "I'm good. Sharp, a little watchful. What about you?",
    turnIdEstimate: 1,
    committedAtMs: 1_001,
    generationPath: "model",
  });
  assert.equal(first.decision.allow, true);
  state = first.next;
  assert.equal(selectHasVisibleAssistantCommit(state, 1), true);

  const second = reduceVisibleAssistantCommit(state, {
    anchorUserMessageId: 1,
    requestId: "req-2",
    renderedText: "Enough hovering, pet. Tell me what you actually want.",
    turnIdEstimate: 1,
    committedAtMs: 1_002,
    generationPath: "fallback",
  });
  assert.equal(second.decision.allow, false);
  assert.equal(second.decision.reason, "second_visible_reply_same_turn");
});

test("session state contract blocks an older visible reply after a newer turn already committed", () => {
  let state = createSessionStateContract("contract-stale-visible-commit");
  state = reduceUserTurn(state, {
    text: "first question",
    nowMs: 1_000,
  }).next;
  state = reduceUserTurn(state, {
    text: "second question",
    nowMs: 1_100,
  }).next;

  const newer = reduceVisibleAssistantCommit(state, {
    anchorUserMessageId: 2,
    requestId: "req-2",
    renderedText: "Here is the newer answer.",
    turnIdEstimate: 2,
    committedAtMs: 1_101,
    generationPath: "model",
  });
  assert.equal(newer.decision.allow, true);
  state = newer.next;

  const stale = reduceVisibleAssistantCommit(state, {
    anchorUserMessageId: 1,
    requestId: "req-1",
    renderedText: "Here is the stale older answer.",
    turnIdEstimate: 1,
    committedAtMs: 1_102,
    generationPath: "model",
  });
  assert.equal(stale.decision.allow, false);
  assert.equal(stale.decision.reason, "older_than_last_committed_visible_turn");
});

test("session state contract finalize registration is idempotent per request", () => {
  let state = createSessionStateContract("contract-finalize");

  const first = reduceRegisterAssistantFinalize(state, "req-1");
  assert.equal(first.decision.allow, true);
  state = first.next;

  const second = reduceRegisterAssistantFinalize(state, "req-1");
  assert.equal(second.decision.allow, false);
  assert.equal(second.decision.reason, "duplicate_finalize");
});
