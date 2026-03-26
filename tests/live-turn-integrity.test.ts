import test from "node:test";
import assert from "node:assert/strict";

import { shouldPreferServerTurnContract } from "../lib/session/live-turn-integrity.ts";

test("browser shell prefers the server turn contract for you-pick in active game setup", () => {
  assert.equal(
    shouldPreferServerTurnContract({
      userText: "you pick",
      dialogueAct: "answer_activity_choice",
      hasDeterministicCandidate: true,
      interactionMode: "game",
      topicType: "game_setup",
    }),
    true,
  );
});

test("browser shell prefers the server turn contract for game-start opening turns", () => {
  assert.equal(
    shouldPreferServerTurnContract({
      userText: "let's play a game",
      dialogueAct: "propose_activity",
      hasDeterministicCandidate: true,
      interactionMode: "normal_chat",
      topicType: "general_request",
    }),
    true,
  );
});

test("browser shell prefers the server turn contract for keep-going in active game execution", () => {
  assert.equal(
    shouldPreferServerTurnContract({
      userText: "keep going",
      dialogueAct: "short_follow_up",
      hasDeterministicCandidate: true,
      interactionMode: "game",
      topicType: "game_execution",
    }),
    true,
  );
});

test("browser shell prefers the server turn contract for game clarification", () => {
  assert.equal(
    shouldPreferServerTurnContract({
      userText: "explain the game",
      dialogueAct: "user_question",
      hasDeterministicCandidate: true,
      interactionMode: "game",
      topicType: "game_execution",
    }),
    true,
  );
});

test("browser shell keeps local deterministic handling for unrelated open-chat turns", () => {
  assert.equal(
    shouldPreferServerTurnContract({
      userText: "hello",
      dialogueAct: "other",
      hasDeterministicCandidate: true,
      interactionMode: "normal_chat",
      topicType: "general_request",
    }),
    false,
  );
});
