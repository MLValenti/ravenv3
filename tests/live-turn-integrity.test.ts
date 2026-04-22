import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeSessionVisibleAssistantText,
  shouldAcceptAssistantTurnOwnership,
  shouldPreferServerTurnContract,
} from "../lib/session/live-turn-integrity.ts";

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

test("assistant turn ownership accepts the latest in-flight request for the latest user turn", () => {
  assert.deepEqual(
    shouldAcceptAssistantTurnOwnership({
      sourceUserMessageId: 7,
      requestId: "turn-7",
      latestUserMessageId: 7,
      activeTurnRequestId: "turn-7",
      pendingTurnRequestId: "turn-7",
    }),
    {
      allow: true,
      reason: "owned_by_latest_turn",
    },
  );
});

test("assistant turn ownership rejects stale responses after a newer user turn arrives", () => {
  assert.deepEqual(
    shouldAcceptAssistantTurnOwnership({
      sourceUserMessageId: 7,
      requestId: "turn-7",
      latestUserMessageId: 8,
      activeTurnRequestId: "turn-7",
      pendingTurnRequestId: "turn-8",
    }),
    {
      allow: false,
      reason: "superseded_by_newer_user_turn",
    },
  );
});

test("visible assistant text sanitizer removes scaffold and planner leakage", () => {
  const sanitized = sanitizeSessionVisibleAssistantText(
    "Turn plan:\nRequired move: answer_user_question\nAnswer the user in the first sentence.\nI mean hesitation under pressure.",
  );

  assert.equal(sanitized.blocked, false);
  assert.equal(sanitized.changed, true);
  assert.equal(sanitized.text, "I mean hesitation under pressure.");
});
