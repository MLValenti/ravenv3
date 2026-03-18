import test from "node:test";
import assert from "node:assert/strict";

import {
  createConversationStateSnapshot,
  formatRollingSummaryText,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
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
  assert.ok(state.open_loops.some((loop) => /wake time/i.test(loop)));
  assert.ok(
    state.rolling_summary.commitments_or_assigned_tasks.some((item) => /wake time/i.test(item)),
  );
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
