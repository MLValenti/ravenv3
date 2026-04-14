import test from "node:test";
import assert from "node:assert/strict";

import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import {
  attachStateRouteToLiveTurnDiagnostic,
  attachWinnerToLiveTurnDiagnostic,
  buildServerCanonicalTurnMove,
  buildLiveTurnDiagnosticRecord,
  interpretLiveRouteTurn,
} from "../lib/chat/live-turn-interpretation.ts";
import { classifyUserIntent } from "../lib/session/intent-router.ts";
import {
  createSessionStateContract,
  reduceUserTurn,
} from "../lib/session/session-state-contract.ts";

function buildReducerInputs(input: {
  text: string;
  awaitingUser: boolean;
  userAnswered: boolean;
  previousAssistantMessage: string | null;
  currentTopic: string | null;
  sessionTopicSummary: string;
  interactionMode?: string | null;
  topicType?: string | null;
  taskHardLockActive?: boolean | null;
}) {
  const state = createSessionStateContract("session-live-turn-reducer-test");
  state.sessionTopic = {
    topic_type: "general_request",
    topic_state: "open",
    summary: input.sessionTopicSummary,
    created_at: 5_000,
  };
  const interpretation = interpretLiveRouteTurn({
    lastUserMessage: input.text,
    awaitingUser: input.awaitingUser,
    userAnswered: input.userAnswered,
    verificationJustCompleted: false,
    sessionPhase: "chat",
    previousAssistantMessage: input.previousAssistantMessage,
    currentTopic: input.currentTopic,
  });
  const base = buildLiveTurnDiagnosticRecord({
    requestId: `request-${input.text}`,
    turnId: `turn-${input.text}`,
    sessionId: "session-live-turn-reducer-test",
    interpretationInput: {
      lastUserMessage: input.text,
      awaitingUser: input.awaitingUser,
      userAnswered: input.userAnswered,
      verificationJustCompleted: false,
      sessionPhase: "chat",
      previousAssistantMessage: input.previousAssistantMessage,
      currentTopic: input.currentTopic,
    },
    interactionMode: input.interactionMode ?? "normal_chat",
    topicType: input.topicType ?? null,
    taskHardLockActive: input.taskHardLockActive ?? null,
    activeThreadHint: input.sessionTopicSummary,
  });
  const diagnosticRecord = attachStateRouteToLiveTurnDiagnostic(base, {
    text: input.text,
    awaitingUser: input.awaitingUser,
    currentTopic: state.sessionTopic,
    nowMs: 5_001,
  });
  const canonicalTurnMove = buildServerCanonicalTurnMove({
    interpretation,
    diagnosticRecord,
  });
  return {
    state,
    diagnosticRecord,
    canonicalTurnMove,
  };
}

test("short follow-up canonical move resolves to continuation despite classifier disagreement", () => {
  const interpretation = interpretLiveRouteTurn({
    lastUserMessage: "go on",
    awaitingUser: false,
    userAnswered: false,
    verificationJustCompleted: false,
    sessionPhase: "chat",
    previousAssistantMessage: "That only matters once it gets real instead of staying abstract.",
    currentTopic: "training",
  });
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
  const canonicalMove = buildServerCanonicalTurnMove({
    interpretation,
    diagnosticRecord: record,
  });
  assert.equal(canonicalMove.primaryRouteAct, "short_follow_up");
  assert.equal(canonicalMove.continuationKind, "continue_current_thought");
  assert.equal(canonicalMove.revisionKind, "none");
  assert.equal(canonicalMove.taskContextKind, "none");
  assert.equal(canonicalMove.ambiguity, "mixed");
  assert.match(canonicalMove.sourceSummary.join(","), /live_route/);
  assert.match(canonicalMove.sourceSummary.join(","), /core_move/);
});

test("duration revision canonical move preserves duration semantics without losing revision intent", () => {
  const interpretation = interpretLiveRouteTurn({
    lastUserMessage: "make it 10 minutes",
    awaitingUser: true,
    userAnswered: true,
    verificationJustCompleted: false,
    sessionPhase: "chat",
    previousAssistantMessage: "How long should I make it run?",
    currentTopic: "frame task",
  });
  const base = buildLiveTurnDiagnosticRecord({
    requestId: "request-live-turn-diagnostic-duration-revision",
    turnId: "turn-live-turn-diagnostic-duration-revision",
    sessionId: "session-live-turn-diagnostic-duration-revision",
    interpretationInput: {
      lastUserMessage: "make it 10 minutes",
      awaitingUser: true,
      userAnswered: true,
      verificationJustCompleted: false,
      sessionPhase: "chat",
      previousAssistantMessage: "How long should I make it run?",
      currentTopic: "frame task",
    },
    interactionMode: "task_planning",
    topicType: "task_negotiation",
    taskHardLockActive: false,
    activeThreadHint: "frame task",
  });
  const record = attachStateRouteToLiveTurnDiagnostic(base, {
    text: "make it 10 minutes",
    awaitingUser: true,
    currentTopic: {
      topic_type: "general_request",
      topic_state: "open",
      summary: "frame task",
      created_at: 2_000,
    },
    nowMs: 2_001,
  });
  const canonicalMove = buildServerCanonicalTurnMove({
    interpretation,
    diagnosticRecord: record,
  });

  assert.equal(canonicalMove.primaryRouteAct, "duration_request");
  assert.equal(canonicalMove.continuationKind, "none");
  assert.equal(canonicalMove.revisionKind, "duration_only");
  assert.equal(canonicalMove.taskContextKind, "task_revision");
  assert.equal(canonicalMove.questionLike, false);
  assert.ok(canonicalMove.ambiguity === "mixed" || canonicalMove.ambiguity === "high");
});

test("question-first diagnostic can carry a server model path winner", () => {
  const interpretation = interpretLiveRouteTurn({
    lastUserMessage: "what should our session be about?",
    awaitingUser: false,
    userAnswered: false,
    verificationJustCompleted: false,
    sessionPhase: "chat",
    previousAssistantMessage: "You have my attention.",
    currentTopic: null,
  });
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
  const canonicalMove = buildServerCanonicalTurnMove({
    interpretation,
    diagnosticRecord: record,
  });

  assert.equal(record.questionLike, true);
  assert.equal(record.pathWinner, "server_model_path");
  assert.equal(record.pathReason, "model_path_after_replay_fallthrough");
  assert.equal(record.finalWinningResponseSource, "model");
  assert.equal(canonicalMove.primaryRouteAct, "user_question");
  assert.equal(canonicalMove.questionLike, true);
  assert.equal(canonicalMove.taskContextKind, "none");
});

test("profile-building invitation no longer classifies as refusal or routes as other", () => {
  assert.equal(
    classifyUserIntent("I want you to get to know me better", false),
    "user_answer",
  );
  assert.equal(classifyUserIntent("I don't understand", false), "user_refusal_or_confusion");
  assert.equal(
    classifyUserIntent("You know me better than that", false),
    "user_answer",
  );

  const route = classifyDialogueRoute({
    text: "I want you to get to know me better",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 3_000,
  });
  assert.equal(route.act, "user_answer");
  assert.match(route.reason, /profile-building invitation/i);

  const interpretation = interpretLiveRouteTurn({
    lastUserMessage: "I want you to get to know me better",
    awaitingUser: false,
    userAnswered: false,
    verificationJustCompleted: false,
    sessionPhase: "chat",
    previousAssistantMessage: "You have my attention.",
    currentTopic: null,
  });
  const base = buildLiveTurnDiagnosticRecord({
    requestId: "request-live-turn-diagnostic-profile-building-invite",
    turnId: "turn-live-turn-diagnostic-profile-building-invite",
    sessionId: "session-live-turn-diagnostic-profile-building-invite",
    interpretationInput: {
      lastUserMessage: "I want you to get to know me better",
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
  const record = attachStateRouteToLiveTurnDiagnostic(base, {
    text: "I want you to get to know me better",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 3_001,
  });
  const canonicalMove = buildServerCanonicalTurnMove({
    interpretation,
    diagnosticRecord: record,
  });

  assert.equal(record.intentUsed, "user_answer");
  assert.equal(record.liveRouteAct, "user_answer");
  assert.equal(record.stateRouteAct, "user_answer");
  assert.equal(canonicalMove.primaryRouteAct, "user_answer");
  assert.equal(record.classifierDisagreement, true);
});

test("reducer uses canonical continuation semantics for short follow-up continuity", () => {
  const { state, canonicalTurnMove } = buildReducerInputs({
    text: "go on",
    awaitingUser: false,
    userAnswered: false,
    previousAssistantMessage: "That only matters once it gets real instead of staying abstract.",
    currentTopic: "training",
    sessionTopicSummary: "training",
  });

  const reduced = reduceUserTurn(state, {
    text: "go on",
    nowMs: 5_002,
    canonicalTurnMove,
  });

  assert.equal(canonicalTurnMove.continuationKind, "continue_current_thought");
  assert.equal(reduced.route.act, "short_follow_up");
  assert.equal(reduced.route.nextTopic?.summary, "training");
  assert.match(reduced.route.reason, /canonical continuation preserved active topic/i);
  assert.equal(reduced.next.sessionTopic?.summary, "training");
});

test("reducer uses canonical revision semantics for duration-only revisions", () => {
  const { state, canonicalTurnMove } = buildReducerInputs({
    text: "make it 10 minutes",
    awaitingUser: true,
    userAnswered: true,
    previousAssistantMessage: "How long should I make it run?",
    currentTopic: "frame task",
    sessionTopicSummary: "frame task",
    interactionMode: "task_planning",
    topicType: "task_negotiation",
    taskHardLockActive: false,
  });

  const reduced = reduceUserTurn(state, {
    text: "make it 10 minutes",
    nowMs: 5_003,
    canonicalTurnMove,
  });

  assert.equal(canonicalTurnMove.revisionKind, "duration_only");
  assert.equal(reduced.route.act, "duration_request");
  assert.equal(reduced.route.nextTopic?.summary, "frame task");
  assert.match(reduced.route.reason, /canonical duration-only revision preserved active topic/i);
  assert.equal(reduced.next.workingMemory.last_user_intent, "duration_request");
});

test("reducer uses canonical task-follow-through semantics to preserve active task topic", () => {
  const { state, canonicalTurnMove } = buildReducerInputs({
    text: "what would that prove",
    awaitingUser: true,
    userAnswered: true,
    previousAssistantMessage: "Do this frame task for ten minutes, then report back.",
    currentTopic: "frame task",
    sessionTopicSummary: "frame task",
    interactionMode: "task_planning",
    topicType: "task_negotiation",
    taskHardLockActive: true,
  });

  const reduced = reduceUserTurn(state, {
    text: "what would that prove",
    nowMs: 5_004,
    canonicalTurnMove,
  });

  assert.equal(canonicalTurnMove.taskContextKind, "task_follow_through");
  assert.equal(reduced.route.act, "user_question");
  assert.equal(reduced.route.nextTopic?.summary, "frame task");
  assert.match(reduced.route.reason, /canonical task follow-through preserved active topic/i);
  assert.equal(reduced.next.workingMemory.session_topic?.summary, "frame task");
});
