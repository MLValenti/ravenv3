import test from "node:test";
import assert from "node:assert/strict";

import {
  attachStateRouteToLiveTurnDiagnostic,
  attachWinnerToLiveTurnDiagnostic,
  buildLiveTurnDiagnosticRecord,
} from "../lib/chat/live-turn-interpretation.ts";

test("short follow-up diagnostic captures classifier disagreement", () => {
  const base = buildLiveTurnDiagnosticRecord({
    requestId: "request-live-turn-diagnostic-short-follow-up",
    turnId: "turn-live-turn-diagnostic-short-follow-up",
    sessionId: "session-live-turn-diagnostic-short-follow-up",
    interpretationInput: {
      lastUserMessage: "go on",
      awaitingUser: false,
      userAnswered: false,
      verificationJustCompleted: false,
      sessionPhase: "chat",
      previousAssistantMessage: "That only matters once it gets real instead of staying abstract.",
      currentTopic: "training",
    },
    interactionMode: "normal_chat",
    activeThreadHint: "training",
  });

  const record = attachStateRouteToLiveTurnDiagnostic(base, {
    text: "go on",
    awaitingUser: false,
    currentTopic: {
      topic_type: "general_request",
      topic_state: "open",
      summary: "training",
      created_at: 1_000,
    },
    nowMs: 1_001,
  });

  assert.equal(record.liveRouteAct, "short_follow_up");
  assert.equal(record.stateRouteAct, "short_follow_up");
  assert.equal(record.classifierDisagreement, true);
  assert.match(record.disagreementKinds.join(","), /core_move_vs_route/);
  assert.equal(record.questionLike, true);
});

test("question-first diagnostic can carry a server model path winner", () => {
  const base = buildLiveTurnDiagnosticRecord({
    requestId: "request-live-turn-diagnostic-question-first",
    turnId: "turn-live-turn-diagnostic-question-first",
    sessionId: "session-live-turn-diagnostic-question-first",
    interpretationInput: {
      lastUserMessage: "what should our session be about?",
      awaitingUser: false,
      userAnswered: false,
      verificationJustCompleted: false,
      sessionPhase: "chat",
      previousAssistantMessage: "You have my attention.",
      currentTopic: null,
    },
    interactionMode: "normal_chat",
    activeThreadHint: "open_chat",
  });

  const record = attachWinnerToLiveTurnDiagnostic(base, {
    pathWinner: "server_model_path",
    pathReason: "model_path_after_replay_fallthrough",
    finalWinningResponseSource: "model",
  });

  assert.equal(record.questionLike, true);
  assert.equal(record.pathWinner, "server_model_path");
  assert.equal(record.pathReason, "model_path_after_replay_fallthrough");
  assert.equal(record.finalWinningResponseSource, "model");
});
