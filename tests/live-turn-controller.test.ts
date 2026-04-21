import test from "node:test";
import assert from "node:assert/strict";

import type { HistoryMessage } from "../lib/chat-prompt.ts";
import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";
import { buildTurnPlan } from "../lib/chat/turn-plan.ts";
import {
  buildLiveTurnDiagnosticRecord,
  buildServerCanonicalTurnMove,
  interpretLiveRouteTurn,
} from "../lib/chat/live-turn-interpretation.ts";
import { maybeHandleSessionReplayDeterministicBypass } from "../lib/session/live-turn-controller.ts";
import { createWorkingMemory, type WorkingMemory } from "../lib/session/working-memory.ts";

type CallbackCounters = {
  append: number;
  summary: number;
  persist: number;
  logs: number;
  payloads: Record<string, unknown>[];
};

function createControllerInput(input: {
  messages: HistoryMessage[];
  workingMemory?: WorkingMemory;
  sessionMode?: boolean;
  plannerEnabled?: boolean;
}) {
  const sessionId = "session-live-turn-controller-test";
  const conversationStateSnapshot = createConversationStateSnapshot(sessionId);
  const turnPlan = buildTurnPlan(input.messages, {
    conversationState: conversationStateSnapshot,
  });
  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
  const previousAssistantMessage =
    [...input.messages].reverse().find((message) => message.role === "assistant")?.content ?? null;
  const counters: CallbackCounters = { append: 0, summary: 0, persist: 0, logs: 0, payloads: [] };
  const diagnosticRecord = buildLiveTurnDiagnosticRecord({
    requestId: "request-live-turn-controller-test",
    turnId: "turn-live-turn-controller-test",
    sessionId,
    interpretationInput: {
      lastUserMessage: lastUserMessage?.content ?? "",
      awaitingUser: false,
      userAnswered: false,
      verificationJustCompleted: false,
      sessionPhase: "chat",
      previousAssistantMessage,
      currentTopic: conversationStateSnapshot.active_thread,
    },
    interactionMode: conversationStateSnapshot.current_mode,
    activeThreadHint: conversationStateSnapshot.active_thread,
  });
  const canonicalTurnMove = buildServerCanonicalTurnMove({
    interpretation: interpretLiveRouteTurn({
      lastUserMessage: lastUserMessage?.content ?? "",
      awaitingUser: false,
      userAnswered: false,
      verificationJustCompleted: false,
      sessionPhase: "chat",
      previousAssistantMessage,
      currentTopic: conversationStateSnapshot.active_thread,
    }),
    diagnosticRecord,
  });

  return {
    counters,
    input: {
      sessionMode: input.sessionMode ?? true,
      plannerEnabled: input.plannerEnabled ?? false,
      lastUserMessage,
      messages: input.messages,
      inventory: [],
      deviceOptIn: false,
      observations: null,
      emergencyStopStopped: false,
      workingMemory: input.workingMemory ?? createWorkingMemory(),
      lastAssistantOutput: null,
      conversationStateSnapshot,
      toneProfile: "neutral" as const,
      turnPlan,
      requestId: "request-live-turn-controller-test",
      turnId: "turn-live-turn-controller-test",
      sessionId,
      capabilityCatalog: [],
      allowedCheckTypes: [],
      diagnosticRecord,
      canonicalTurnMove,
      logSessionRouteDebug: (payload: Record<string, unknown>) => {
        counters.logs += 1;
        counters.payloads.push(payload);
      },
      maybePersistTaskFromAssistantText: async ({ text }: { text: string }) => {
        counters.persist += 1;
        return {
          text,
          createdTaskId: null,
          taskCreateSource: "none" as const,
          taskCreateKind: "none" as const,
        };
      },
      appendChatHistory: async () => {
        counters.append += 1;
      },
      persistSessionTurnSummary: async () => {
        counters.summary += 1;
      },
      createStaticAssistantNdjsonResponse: (
        text: string,
        extraHeaders?: Record<string, string>,
      ) => new Response(text, { status: 200, headers: extraHeaders }),
      buildChatTraceHeaders: () => ({ "x-test-trace": "1" }),
    },
  };
}

test("live turn controller returns debug context and no response when fresh working-memory continuity keeps model path", async () => {
  const { counters, input } = createControllerInput({
    messages: [
      {
        role: "assistant",
        content: "What I want to talk about is where your focus breaks first under pressure.",
      },
      { role: "user", content: "hi" },
    ],
    workingMemory: {
      ...createWorkingMemory(),
      pending_proposal_kind: "session_flow",
      session_started: false,
      last_assistant_action: "propose_session_flow",
    },
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);

  assert.equal(result.response, null);
  assert.equal(
    result.sessionReplayDebugContext?.deterministicBypassReason,
    "working_memory_pending_unaccepted_proposal_prefers_fresh_turn",
  );
  assert.equal(counters.persist, 0);
  assert.equal(counters.append, 0);
  assert.equal(counters.summary, 0);
});

test("live turn controller returns deterministic bypass response and triggers side-effect boundaries for task revision turns", async () => {
  const { counters, input } = createControllerInput({
    messages: [
      {
        role: "assistant",
        content:
          "Here is your task: Hold posture for 20 minutes. Check in once halfway through.",
      },
      { role: "user", content: "make it 10 minutes" },
    ],
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);

  assert.ok(result.response);
  assert.equal(result.response?.headers.get("x-raven-source"), "deterministic-scene");
  assert.equal(result.diagnosticRecord?.pathWinner, "server_replay_bypass");
  assert.equal(result.diagnosticRecord?.finalWinningResponseSource, "deterministic scene");
  assert.equal(counters.persist, 1);
  assert.equal(counters.append, 1);
  assert.equal(counters.summary, 1);
  const finalTracePayload = [...counters.payloads]
    .reverse()
    .find((payload) => payload.stage === "session_final");
  assert.ok(finalTracePayload);
  assert.equal(
    (finalTracePayload?.canonical_turn_move as { primaryRouteAct?: string } | undefined)
      ?.primaryRouteAct,
    "duration_request",
  );
  assert.equal(
    (finalTracePayload?.canonical_turn_move as { revisionKind?: string } | undefined)
      ?.revisionKind,
    "duration_only",
  );
});

test("live turn controller returns early deterministic started-flow response without task persistence", async () => {
  const { counters, input } = createControllerInput({
    messages: [
      { role: "assistant", content: "We can start with one specific pressure point." },
      { role: "user", content: "yes" },
    ],
    workingMemory: {
      ...createWorkingMemory(),
      session_started: true,
      last_assistant_action: "propose_session_flow",
      last_assistant_commitment: "Start with one concrete point where your pace broke.",
      pending_proposal_summary: "Start with one concrete point where your pace broke.",
    },
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);

  assert.ok(result.response);
  assert.equal(result.response?.headers.get("x-raven-source"), "working-memory-started-flow");
  assert.equal(counters.persist, 0);
  assert.equal(counters.append, 1);
  assert.equal(counters.summary, 1);
  const finalTracePayload = [...counters.payloads]
    .reverse()
    .find((payload) => payload.stage === "session_final");
  assert.ok(finalTracePayload);
  assert.equal(
    (finalTracePayload?.canonical_turn_move as { continuationKind?: string } | undefined)
      ?.continuationKind,
    "continue_current_thought",
  );
});

test("live turn controller prefers the scene scaffold over generic continuity when a game setup turn says you pick", async () => {
  const { counters, input } = createControllerInput({
    messages: [
      { role: "user", content: "let's play a game" },
      {
        role: "assistant",
        content:
          "Good. You want a game. Listen carefully, pet. We are staying with the game, and you will not drift. Choose quick, or choose something that runs for a few minutes. Decide cleanly.",
      },
      { role: "user", content: "you pick" },
    ],
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);
  const text = await result.response?.text();

  assert.ok(result.response);
  assert.equal(result.response?.headers.get("x-raven-source"), "deterministic-scene");
  assert.match(text ?? "", /i pick|rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);
  assert.doesNotMatch(text ?? "", /complete the chosen game/i);
  assert.equal(counters.persist, 1);
  assert.equal(counters.append, 1);
  assert.equal(counters.summary, 1);
});

test("live turn controller keeps a game short follow-up on the active round prompt", async () => {
  const { input } = createControllerInput({
    messages: [
      { role: "user", content: "let's play a game" },
      {
        role: "assistant",
        content:
          "Good. You want a game. Listen carefully, pet. We are staying with the game, and you will not drift. Choose quick, or choose something that runs for a few minutes. Decide cleanly.",
      },
      { role: "user", content: "you pick" },
      {
        role: "assistant",
        content:
          "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
      },
      { role: "user", content: "keep going" },
    ],
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);
  const text = await result.response?.text();

  assert.ok(result.response);
  assert.match(text ?? "", /first throw now|choose rock, paper, or scissors|stay with the current move/i);
  assert.doesNotMatch(text ?? "", /concrete part of complete|wording around it/i);
});

test("live turn controller keeps duration-only cues inside the active game rail", async () => {
  const { input } = createControllerInput({
    messages: [
      { role: "user", content: "let's play a game" },
      {
        role: "assistant",
        content:
          "Good. You want a game. Listen carefully, pet. We are staying with the game, and you will not drift. Choose quick, or choose something that runs for a few minutes. Decide cleanly.",
      },
      { role: "user", content: "you pick" },
      {
        role: "assistant",
        content:
          "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
      },
      { role: "user", content: "make it 10 minutes" },
    ],
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);
  const text = await result.response?.text();

  assert.ok(result.response);
  assert.match(text ?? "", /not this game|want a task|stay with the current move/i);
  assert.doesNotMatch(text ?? "", /keep the same subject|answer this change directly|10 minutes/i);
});

test("live turn controller bypasses the model for an explicit chat-switch during task negotiation", async () => {
  const { input } = createControllerInput({
    messages: [
      { role: "user", content: "give me a task" },
      {
        role: "assistant",
        content: "What kind of task do you want this to be: device, frame, posture, stillness?",
      },
      { role: "user", content: "frame" },
      {
        role: "assistant",
        content: "How long should I make it run?",
      },
      { role: "user", content: "let's just chat for a minute" },
    ],
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);
  const text = await result.response?.text();

  assert.equal(result.response, null);
  assert.equal(
    result.sessionReplayDebugContext?.deterministicBypassReason,
    "open_conversation_prefers_model",
  );
  assert.equal(text, undefined);
});

test("live turn controller bypasses the model for an assistant-self question after task negotiation releases", async () => {
  const { input } = createControllerInput({
    messages: [
      { role: "user", content: "give me a task" },
      {
        role: "assistant",
        content: "What kind of task do you want this to be: device, frame, posture, stillness?",
      },
      { role: "user", content: "frame" },
      {
        role: "assistant",
        content: "How long should I make it run?",
      },
      { role: "user", content: "let's just chat for a minute" },
      {
        role: "assistant",
        content: "Fine. Then talk to me normally for a minute.",
      },
      { role: "user", content: "tell me more about you" },
    ],
  });

  const result = await maybeHandleSessionReplayDeterministicBypass(input);
  const text = await result.response?.text();

  assert.equal(result.response, null);
  assert.equal(
    result.sessionReplayDebugContext?.deterministicBypassReason,
    "open_conversation_prefers_model",
  );
  assert.equal(text, undefined);
});
