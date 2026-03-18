import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionStateContract,
  projectTurnGateUi,
  reduceAssistantEmission,
  reduceUserTurn,
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

