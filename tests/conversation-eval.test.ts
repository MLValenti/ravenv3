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

test("conversation eval recognizes clean short-follow-up continuity without stale open loops", () => {
  const state = {
    ...createConversationStateSnapshot("conversation-eval-short-follow-up"),
    current_mode: "question_answering" as const,
    pending_user_request: "go on",
    important_entities: ["work"],
    last_satisfied_request: "work",
    last_assistant_claim: "Then pick one of those three and I will keep the thread on it",
    recent_window: [
      { role: "user" as const, content: "work" },
      { role: "assistant" as const, content: "Good. Is it workload, a person, or a decision you keep circling?" },
      { role: "user" as const, content: "what do you mean?" },
      {
        role: "assistant" as const,
        content: "I mean the exact part of work that keeps dragging your attention: the amount, the person, or the choice.",
      },
      { role: "user" as const, content: "go on" },
      {
        role: "assistant" as const,
        content: "Then pick one of those three and I will keep the thread on it.",
      },
    ],
  };

  const report = evaluateConversationTranscript({
    turns: [
      {
        user: "work",
        raven: "Good. Is it workload, a person, or a decision you keep circling?",
      },
      {
        user: "what do you mean?",
        raven: "I mean the exact part of work that keeps dragging your attention: the amount, the person, or the choice.",
      },
      {
        user: "go on",
        raven: "Then pick one of those three and I will keep the thread on it.",
      },
    ],
    state,
  });

  assert.ok(report.continuity >= 0.8);
  assert.ok(report.coherence >= 0.68);
  assert.ok(report.humanlike_flow >= 0.68);
});
