import test from "node:test";
import assert from "node:assert/strict";

import {
  createConversationStateSnapshot,
  formatRollingSummaryText,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
  normalizeConversationStateSnapshot,
} from "../lib/chat/conversation-state.ts";

test("conversation state tracks topic, goal, facts, loops, and tone across turns", () => {
  let state = createConversationStateSnapshot("conversation-state");

  state = noteConversationUserTurn(state, {
    text: "My name is Mara and my goal is better focus. Let's plan my week.",
    userIntent: "user_answer",
    routeAct: "other",
    nowMs: 1,
  });

  assert.match(state.active_topic, /my week/i);
  assert.equal(state.current_mode, "normal_chat");
  assert.match(state.user_goal ?? "", /better focus/i);
  assert.ok(state.recent_facts_from_user.some((fact) => /my name is mara/i.test(fact)));
  assert.ok(state.important_entities.some((entity) => /week|mara|focus/i.test(entity)));
  assert.match(formatRollingSummaryText(state.rolling_summary), /active_topic: my week/i);
  assert.match(state.active_thread, /my week/i);
  assert.match(state.pending_user_request, /let's plan my week/i);
  assert.equal(state.request_fulfilled, false);
  assert.equal(state.relational_continuity.should_press_soften_observe_challenge_reward_or_hold, "observe");
  assert.match(state.relational_continuity.current_relational_direction, /defining_terms/i);

  state = noteConversationUserTurn(state, {
    text: "Why that order?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 2,
  });

  assert.equal(state.current_mode, "question_answering");
  assert.ok(state.unanswered_questions.some((question) => /why that order/i.test(question)));
  assert.ok(state.open_loops.some((loop) => /why that order/i.test(loop)));
  assert.equal(state.last_user_intent, "user_question");
  assert.equal(state.emotional_tone_or_conversation_tone, "steady");
  assert.equal(state.current_turn_action, "answer_direct_question");
  assert.equal(state.current_output_shape, "direct_answer");
  assert.match(state.relational_continuity.current_emotional_beat, /controlled_explanation/i);
  assert.equal(state.relational_continuity.should_press_soften_observe_challenge_reward_or_hold, "guide");
  assert.ok(
    state.rolling_summary.recent_mode_shifts.some((shift) =>
      /normal_chat -> question_answering/i.test(shift),
    ),
  );
});

test("conversation state clears answered questions and records assistant commitments", () => {
  let state = createConversationStateSnapshot("conversation-state-answer");

  state = noteConversationUserTurn(state, {
    text: "What do I do next?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  state = noteConversationAssistantTurn(state, {
    text: "Next, start by locking in your wake time and report it directly.",
    ravenIntent: "answer_question",
    nowMs: 2,
  });

  assert.equal(state.last_raven_intent, "answer_question");
  assert.equal(state.unanswered_questions.length, 0);
  assert.ok(
    state.recent_commitments_or_tasks.some((commitment) =>
      /start by locking in your wake time/i.test(commitment),
    ),
  );
  assert.ok(
    state.relational_continuity.what_raven_has_implicitly_established_about_herself.some((item) =>
      /i notice|i prefer|i remember|i pay attention|i decide/i.test(item),
    ) || state.relational_continuity.pressure_level === "measured",
  );
  assert.equal(state.request_fulfilled, true);
  assert.match(state.last_satisfied_request, /what do i do next/i);
  assert.equal(state.pending_modification, "none");
  assert.match(state.last_assistant_claim, /next, start by locking in your wake time/i);
  assert.equal(state.last_assistant_question, "none");
  assert.ok(state.open_loops.some((loop) => /wake time/i.test(loop)));
  assert.ok(
    state.rolling_summary.commitments_or_assigned_tasks.some((item) => /wake time/i.test(item)),
  );
});

test("conversation state stores repair context and assistant referent continuity", () => {
  let state = createConversationStateSnapshot("conversation-state-repair");

  state = noteConversationUserTurn(state, {
    text: "none",
    userIntent: "user_answer",
    routeAct: "other",
    nowMs: 1,
  });
  state = noteConversationAssistantTurn(state, {
    text: "You said none, but that answer usually hides something.",
    ravenIntent: "respond",
    nowMs: 2,
  });
  state = noteConversationUserTurn(state, {
    text: "what do you mean?",
    userIntent: "user_short_follow_up",
    routeAct: "short_follow_up",
    nowMs: 3,
  });

  assert.match(state.last_assistant_claim, /you said none, but that answer usually hides something/i);
  assert.match(state.last_assistant_referent_candidate, /none/i);
  assert.match(state.repair_context, /source=previous_assistant/i);
});

test("conversation state keeps stable relational threads for get-to-know and service questions", () => {
  let state = createConversationStateSnapshot("conversation-state-relational-thread");

  state = noteConversationUserTurn(state, {
    text: "what do you want to know about me?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });
  assert.equal(state.active_thread, "what I want to know about you");

  state = noteConversationAssistantTurn(state, {
    text: "Good. We can play it both ways. Put a real question on me first, then I may put one back on you.",
    ravenIntent: "respond",
    nowMs: 2,
  });
  state = noteConversationUserTurn(state, {
    text: "what can i do to be a better sub to you",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 3,
  });

  assert.equal(state.active_thread, "what you can do for me");
});

test("conversation state treats reciprocal interest questions as assistant-facing relational turns", () => {
  let state = createConversationStateSnapshot("conversation-state-reciprocal-interest");

  state = noteConversationUserTurn(state, {
    text: "do you want to know anything about me?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  assert.equal(state.current_mode, "relational_chat");
  assert.equal(state.active_thread, "what I want to know about you");
});

test("conversation state keeps a relational directive request on the service thread and does not fulfill it early", () => {
  let state = createConversationStateSnapshot("conversation-state-service-directive");

  state = noteConversationAssistantTurn(state, {
    text: "How can I serve you better?",
    ravenIntent: "ask",
    nowMs: 1,
  });
  state = noteConversationUserTurn(state, {
    text: "I want you to tell me what to do",
    userIntent: "user_answer",
    routeAct: "user_answer",
    nowMs: 2,
  });

  assert.equal(state.current_mode, "relational_chat");
  assert.equal(state.active_thread, "what you can do for me");
  assert.match(state.pending_user_request, /tell me what to do/i);
  assert.equal(state.request_fulfilled, false);

  state = noteConversationAssistantTurn(state, {
    text: "Yes. Keep going. Stay with the concrete part of serve, not the wording around it.",
    ravenIntent: "respond",
    nowMs: 3,
  });

  assert.equal(state.request_fulfilled, false);
  assert.equal(state.last_satisfied_request, "none");

  state = noteConversationAssistantTurn(state, {
    text: "Good. Start with this: give me one clean yes, then hold still and wait for the next instruction.",
    ravenIntent: "respond",
    nowMs: 4,
  });

  assert.equal(state.request_fulfilled, true);
  assert.match(state.last_satisfied_request, /tell me what to do/i);
});

test("conversation state does not route practical tell-me-what-to-do requests into the relational service thread", () => {
  let state = createConversationStateSnapshot("conversation-state-practical-directive-near-miss");

  state = noteConversationAssistantTurn(state, {
    text: "How can I help?",
    ravenIntent: "ask",
    nowMs: 1,
  });
  state = noteConversationUserTurn(state, {
    text: "tell me what to do about my broken sink",
    userIntent: "user_answer",
    routeAct: "user_answer",
    nowMs: 2,
  });

  assert.equal(state.current_mode, "normal_chat");
  assert.notEqual(state.active_thread, "what you can do for me");
  assert.equal(state.request_fulfilled, false);
  assert.doesNotMatch(state.pending_user_request, /^none$/i);

  state = noteConversationAssistantTurn(state, {
    text: "First check whether the shutoff valve under the sink is open and whether the trap is dripping before you pull anything apart.",
    ravenIntent: "respond",
    nowMs: 3,
  });

  assert.equal(state.current_mode, "normal_chat");
  assert.notEqual(state.active_thread, "what you can do for me");
  assert.equal(state.request_fulfilled, true);
  assert.doesNotMatch(state.last_satisfied_request, /what you can do for me/i);
});

test("conversation state keeps active thread and modification request until it is fulfilled", () => {
  let state = createConversationStateSnapshot("conversation-state-modification");

  state = noteConversationUserTurn(state, {
    text: "Let's build a bedtime routine.",
    userIntent: "user_answer",
    routeAct: "other",
    nowMs: 1,
  });
  state = noteConversationAssistantTurn(state, {
    text: "Fine. Start by locking a consistent lights-out time and keeping the room quiet.",
    ravenIntent: "respond",
    nowMs: 2,
  });
  state = noteConversationUserTurn(state, {
    text: "What about if we add journaling before bed",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 3,
  });

  assert.equal(state.current_turn_action, "modify_existing_idea");
  assert.match(state.active_thread, /bedtime routine/i);
  assert.match(state.pending_modification, /journaling before bed/i);
  assert.equal(state.request_fulfilled, false);

  state = noteConversationAssistantTurn(state, {
    text: "Good. We keep the bedtime routine and add journaling before bed so the wind-down has a cleaner transition before sleep.",
    ravenIntent: "respond",
    nowMs: 4,
  });

  assert.equal(state.request_fulfilled, true);
  assert.equal(state.pending_modification, "none");
  assert.match(state.last_satisfied_request, /add journaling before bed/i);
});

test("conversation state does not fulfill a favorite-color question with evasive anchoring", () => {
  let state = createConversationStateSnapshot("conversation-state-favorite-color-evasive");

  state = noteConversationUserTurn(state, {
    text: "what is your favorite color?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  assert.equal(state.current_mode, "relational_chat");
  assert.equal(state.pending_user_request, "what is your favorite color?");

  state = noteConversationAssistantTurn(state, {
    text: "If you mean your favorite color, I care less about the label and more about how it actually shows up between people.",
    ravenIntent: "respond",
    nowMs: 2,
  });

  assert.equal(state.request_fulfilled, false);
  assert.equal(state.pending_user_request, "what is your favorite color?");
  assert.ok(state.unanswered_questions.some((question) => /favorite color/i.test(question)));
  assert.ok(state.open_loops.some((loop) => /favorite color/i.test(loop)));
});

test("conversation state clears pending request after a concrete favorite-color answer", () => {
  let state = createConversationStateSnapshot("conversation-state-favorite-color-fulfilled");

  state = noteConversationUserTurn(state, {
    text: "what is your favorite color?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  state = noteConversationAssistantTurn(state, {
    text: "Black. Clean, severe, and impossible to soften by accident.",
    ravenIntent: "respond",
    nowMs: 2,
  });

  assert.equal(state.request_fulfilled, true);
  assert.equal(state.pending_user_request, "none");
  assert.equal(state.pending_modification, "none");
  assert.match(state.last_satisfied_request, /favorite color/i);
  assert.equal(state.unanswered_questions.length, 0);
  assert.equal(state.open_loops.some((loop) => /favorite color/i.test(loop)), false);
});

test("conversation state replaces stale unresolved questions when the user switches topics", () => {
  let state = createConversationStateSnapshot("conversation-state-topic-switch");

  state = noteConversationUserTurn(state, {
    text: "what are your kinks?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  state = noteConversationAssistantTurn(state, {
    text: "I like control with purpose, restraint that changes the room, and obedience that still has some nerve in it.",
    ravenIntent: "respond",
    nowMs: 2,
  });

  assert.equal(state.request_fulfilled, true);
  assert.equal(state.pending_user_request, "none");

  state = noteConversationUserTurn(state, {
    text: "what is your favorite color?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 3,
  });

  assert.equal(state.pending_user_request, "what is your favorite color?");
  assert.equal(state.unanswered_questions.some((question) => /kinks/i.test(question)), false);
  assert.equal(state.open_loops.some((loop) => /kinks/i.test(loop)), false);
});

test("conversation state expires repair context after the assistant answers a clarification", () => {
  let state = createConversationStateSnapshot("conversation-state-repair-expiry");

  state = noteConversationAssistantTurn(state, {
    text: "You said none, but that answer usually hides something.",
    ravenIntent: "respond",
    nowMs: 1,
  });
  state = noteConversationUserTurn(state, {
    text: "what do you mean?",
    userIntent: "user_short_follow_up",
    routeAct: "short_follow_up",
    nowMs: 2,
  });

  assert.match(state.repair_context, /source=previous_assistant/i);

  state = noteConversationAssistantTurn(state, {
    text: "I mean your last answer sounded like a cover instead of the real point.",
    ravenIntent: "respond",
    nowMs: 3,
  });

  assert.equal(state.repair_context, "none");

  state = noteConversationUserTurn(state, {
    text: "what is your favorite color?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 4,
  });

  assert.equal(state.repair_context, "none");
});

test("conversation state does not turn a tiny repair follow-up into a pending request or stale loop", () => {
  let state = createConversationStateSnapshot("conversation-state-tiny-repair");

  state = noteConversationAssistantTurn(state, {
    text: "You keep circling the edge of it instead of saying it cleanly.",
    ravenIntent: "respond",
    nowMs: 1,
  });
  state = noteConversationUserTurn(state, {
    text: "what?",
    userIntent: "user_short_follow_up",
    routeAct: "short_follow_up",
    nowMs: 2,
  });

  assert.equal(state.pending_user_request, "none");
  assert.equal(state.unanswered_questions.length, 0);
  assert.equal(state.open_loops.length, 0);
  assert.match(state.repair_context, /source=previous_assistant/i);
});

test("conversation state ignores vague assistant task phrasing as a durable commitment", () => {
  let state = createConversationStateSnapshot("conversation-state-vague-task-phrasing");

  state = noteConversationAssistantTurn(state, {
    text: "If you want a task, we can plan one around whatever direction matters tonight. There is a task you want to tackle in this new direction, but we do not need to lock it in yet.",
    ravenIntent: "respond",
    nowMs: 1,
  });

  assert.equal(state.recent_commitments_or_tasks.length, 0);
  assert.equal(state.open_loops.length, 0);
  assert.equal(state.last_satisfied_request, "none");
});

test("conversation state normalization enforces fulfilled-versus-pending invariants", () => {
  const normalized = normalizeConversationStateSnapshot(
    {
      session_id: "conversation-state-normalize-invariants",
      pending_user_request: "what is your favorite color?",
      last_satisfied_request: "what is your favorite color?",
      request_fulfilled: true,
      unanswered_questions: ["what is your favorite color?"],
      open_loops: ["what is your favorite color?"],
      recent_window: [{ role: "assistant", content: "Black." }],
      last_assistant_claim: "Black.",
    },
    "conversation-state-normalize-invariants",
  );

  assert.equal(normalized.pending_user_request, "none");
  assert.match(normalized.last_satisfied_request, /favorite color/i);
  assert.equal(normalized.open_loops.some((loop) => /favorite color/i.test(loop)), false);
});

test("fresh smalltalk question overrides stale better-sub thread residue", () => {
  let state = createConversationStateSnapshot("conversation-state-smalltalk-reset");

  state = noteConversationUserTurn(state, {
    text: "what would make me a better sub?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  assert.match(state.active_thread, /better sub/i);

  state = noteConversationUserTurn(state, {
    text: "how are you today?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 2,
  });

  assert.equal(state.current_mode, "normal_chat");
  assert.equal(state.active_topic, "none");
  assert.equal(state.active_thread, "open_chat");
  assert.equal(state.pending_user_request, "how are you today?");
  assert.deepEqual(state.unanswered_questions, ["how are you today?"]);
  assert.deepEqual(state.open_loops, ["how are you today?"]);
  assert.equal(state.important_entities.includes("today"), false);
  assert.equal(state.important_entities.includes("asked"), false);
  assert.equal(state.important_entities.some((entity) => /better sub|better/.test(entity)), false);
});

test("fresh direct factual question breaks stale relational thread continuity", () => {
  let state = createConversationStateSnapshot("conversation-state-fresh-direct-question");

  state = noteConversationUserTurn(state, {
    text: "what do you want to know about me?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  assert.equal(state.current_mode, "relational_chat");
  assert.equal(state.active_thread, "what I want to know about you");

  state = noteConversationUserTurn(state, {
    text: "who wrote Hamlet?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 2,
  });

  assert.equal(state.current_mode, "question_answering");
  assert.equal(state.active_topic, "none");
  assert.equal(state.active_thread, "open_chat");
  assert.equal(state.pending_user_request, "who wrote Hamlet?");
  assert.deepEqual(state.unanswered_questions, ["who wrote Hamlet?"]);
});

test("meta complaint repair keeps the original missed question live", () => {
  let state = createConversationStateSnapshot("conversation-state-meta-repair");

  state = noteConversationUserTurn(state, {
    text: "how are you today?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  state = noteConversationAssistantTurn(state, {
    text: "Keep going.",
    ravenIntent: "respond",
    nowMs: 2,
  });

  assert.equal(state.request_fulfilled, false);
  assert.equal(state.pending_user_request, "how are you today?");

  state = noteConversationUserTurn(state, {
    text: "i asked you that?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 3,
  });

  assert.equal(state.current_mode, "normal_chat");
  assert.equal(state.pending_user_request, "how are you today?");
  assert.deepEqual(state.unanswered_questions, ["how are you today?"]);
  assert.deepEqual(state.open_loops, ["how are you today?"]);
  assert.match(state.repair_context, /source=previous_assistant/i);
  assert.equal(state.important_entities.includes("asked"), false);
});

test("natural how-are-you answer fulfills cleanly without stale thread carryover", () => {
  let state = createConversationStateSnapshot("conversation-state-how-are-you-natural");

  state = noteConversationUserTurn(state, {
    text: "what would make me a better sub?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });
  state = noteConversationUserTurn(state, {
    text: "how are you today?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 2,
  });
  state = noteConversationAssistantTurn(state, {
    text: "I'm good today. A little sharp, a little watchful. What about you?",
    ravenIntent: "respond",
    nowMs: 3,
  });

  assert.equal(state.request_fulfilled, true);
  assert.equal(state.pending_user_request, "none");
  assert.match(state.last_satisfied_request, /how are you today/i);
  assert.equal(state.current_mode, "normal_chat");
  assert.equal(state.open_loops.length, 0);
});

test("structured rolling summary preserves topic history, commitments, and unresolved items across long conversations", () => {
  let state = createConversationStateSnapshot("conversation-state-long");

  for (let index = 0; index < 12; index += 1) {
    state = noteConversationUserTurn(state, {
      text:
        index === 0
          ? "Let's plan my week. My goal is better focus."
          : index === 4
            ? "Actually let's play a game first."
            : index === 8
              ? "Go back to the week plan."
              : `Turn ${index} follow up about the same thread.`,
      userIntent: index === 4 ? "user_answer" : "user_question",
      routeAct: index === 4 ? "propose_activity" : index === 8 ? "user_question" : "other",
      nowMs: index * 2 + 1,
    });
    state = noteConversationAssistantTurn(state, {
      text:
        index === 0
          ? "Fine. Start with one stable morning block."
          : index === 4
            ? "We can do one round, then return to the week plan."
            : index === 8
              ? "Good. Back to the week plan. Lock the morning block first."
              : `Assistant turn ${index}: keep the thread going and report the next step.`,
      ravenIntent: "respond",
      nowMs: index * 2 + 2,
    });
  }

  assert.ok(
    state.rolling_summary.recent_topic_history.some((topic) => /my week|week plan/i.test(topic)),
  );
  assert.ok(state.rolling_summary.recent_topic_history.some((topic) => /game/i.test(topic)));
  assert.ok(state.rolling_summary.user_goals.some((goal) => /better focus/i.test(goal)));
  assert.ok(
    state.rolling_summary.commitments_or_assigned_tasks.some((item) =>
      /morning block|next step/i.test(item),
    ),
  );
  assert.ok(
    state.rolling_summary.recent_mode_shifts.some((shift) =>
      /normal_chat -> game|question_answering -> game/i.test(shift),
    ),
  );
  assert.ok(
    state.rolling_summary.open_loops.some((loop) =>
      /morning block|report the next step/i.test(loop),
    ),
  );
  assert.ok(state.rolling_summary.emotional_beat_history.length > 0);
  assert.ok(
    /holding_presence|defining_terms|reading_the_user|mutual_tension/.test(
      state.rolling_summary.relational_direction,
    ),
  );
});
