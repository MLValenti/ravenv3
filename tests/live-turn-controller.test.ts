import test from "node:test";
import assert from "node:assert/strict";

import type { HistoryMessage } from "../lib/chat-prompt.ts";
import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";
import { buildTurnPlan } from "../lib/chat/turn-plan.ts";
import { maybeHandleSessionReplayDeterministicBypass } from "../lib/session/live-turn-controller.ts";
import { createWorkingMemory, type WorkingMemory } from "../lib/session/working-memory.ts";

type CallbackCounters = {
  append: number;
  summary: number;
  persist: number;
  logs: number;
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
  const counters: CallbackCounters = { append: 0, summary: 0, persist: 0, logs: 0 };

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
      logSessionRouteDebug: () => {
        counters.logs += 1;
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
  assert.equal(counters.persist, 1);
  assert.equal(counters.append, 1);
  assert.equal(counters.summary, 1);
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
});

