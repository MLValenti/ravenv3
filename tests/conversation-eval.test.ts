import test from "node:test";
import assert from "node:assert/strict";

import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";
import { evaluateConversationTranscript } from "../lib/chat/conversation-eval.ts";

test("conversation eval scores continuity higher when state and replies stay grounded", () => {
  const state = {
    ...createConversationStateSnapshot("conversation-eval"),
    active_topic: "morning plan",
    user_goal: "better focus",
    recent_facts_from_user: ["i prefer short direct answers"],
    open_loops: ["wake time"],
  };

  const report = evaluateConversationTranscript({
    turns: [
      {
        user: "I need help planning my morning.",
        raven: "Fine. Start with one anchor: wake time or first task?",
      },
      {
        user: "Wake time.",
        raven: "Good. What time do you want locked in?",
      },
      {
        user: "Why that order?",
        raven: "Because the first hour sets the rest of the morning plan.",
      },
    ],
    state,
  });

  assert.ok(report.continuity >= 0.8);
  assert.ok(report.coherence >= 0.7);
  assert.ok(report.humanlike_flow >= 0.6);
  assert.ok(report.repetition_rate <= 0.1);
});
