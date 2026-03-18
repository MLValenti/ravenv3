import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecentTurnsContext,
  buildTurnPlan,
  buildTurnPlanFallback,
  buildTurnPlanSystemMessage,
  isTurnPlanSatisfied,
} from "../lib/chat/turn-plan.ts";
import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";

test("turn plan marks user question as answer_user_question", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "Say what you want." },
    { role: "user", content: "How long should I do this?" },
  ]);

  assert.equal(plan.requiredMove, "answer_user_question");
  assert.equal(plan.reason, "latest_user_message_is_question");
  assert.equal(plan.requestedAction, "answer_direct_question");
  assert.equal(plan.outputShape, "direct_answer");
  assert.match(buildTurnPlanSystemMessage(plan), /Required move: answer_user_question/i);
  assert.equal(plan.personaIntent, "shift_from_observation_to_guidance");
});

test("turn plan marks short acknowledgement after commitment as follow through", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I pick. We are doing number command. Pick one number now." },
    { role: "user", content: "ok" },
  ]);

  assert.equal(plan.requiredMove, "follow_through_previous_commitment");
  assert.equal(plan.requestedAction, "follow_through_commitment");
});

test("turn plan classifies ordinary agreement as agree_and_extend", () => {
  const plan = buildTurnPlan([
    {
      role: "assistant",
      content: "Fantasy lets people flirt with the shape of it. Reality makes it cost something.",
    },
    { role: "user", content: "that's a good point" },
  ]);

  assert.equal(plan.conversationMove, "agree_and_extend");
});

test("turn plan fallback for ordinary continuation does not reset the thread", () => {
  const plan = buildTurnPlan([
    {
      role: "assistant",
      content: "Fantasy lets people flirt with the shape of it. Reality makes it cost something.",
    },
    { role: "user", content: "that makes sense" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /exactly|actually means it|tells me/i);
  assert.doesNotMatch(fallback, /drop the fog|name the part that lost you|start talking/i);
  assert.doesNotMatch(fallback, /decorative|costing something|real dynamic/i);
});

test("turn plan fallback for what do you mean clarifies instead of resetting", () => {
  const plan = buildTurnPlan([
    {
      role: "assistant",
      content: "That hesitation is doing more talking than your wording is.",
    },
    { role: "user", content: "what do you mean" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /i mean hesitation|last point|what i mean/i);
  assert.doesNotMatch(fallback, /name the part that lost you|start talking/i);
});

test("turn plan satisfaction rejects repeated previous assistant line", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I pick. We are doing number command. Pick one number now." },
    { role: "user", content: "ok" },
  ]);
  const result = isTurnPlanSatisfied(
    plan,
    "I pick. We are doing number command. Pick one number now.",
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "repeated_previous_assistant");
});

test("turn plan fallback answers duration questions directly", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "How long do you want this round?" },
    { role: "user", content: "how long should it be?" },
  ]);
  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /30 minutes/i);
});

test("turn plan fallback uses game-specific follow-up and avoids generic repeat", () => {
  const plan = buildTurnPlan([
    {
      role: "assistant",
      content: "Good. We stay on your last message and continue one clear step at a time.",
    },
    { role: "user", content: "lets play a game" },
  ]);
  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.doesNotMatch(
    fallback,
    /Good\. We stay on your last message and continue one clear step at a time\./i,
  );
  assert.match(fallback, /\b(game|playing|quick|longer|pick)\b/i);
});

test("turn plan fallback uses wager-specific follow-up for bet cues", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I pick. We are doing a game." },
    { role: "user", content: "lets bet on the game" },
  ]);
  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /\b(wager|stakes|win terms)\b/i);
});

test("turn plan fallback answers expectation question without meta narration", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "State what you want." },
    { role: "user", content: "what do you want from me?" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.doesNotMatch(fallback, /answer this directly and keep us on the same thread/i);
  assert.match(
    fallback,
    /clarity|honesty|trainable|be useful|actually after/i,
  );
});

test("turn plan fallback keeps greeting turns conversational instead of using clarification rails", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I am here." },
    { role: "user", content: "hi" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /talk to me|what is on your mind|worth hearing/i);
  assert.doesNotMatch(fallback, /ask the exact question you want answered/i);
  assert.doesNotMatch(fallback, /keep it specific|meaning, the rule, or the next step/i);
});

test("turn plan can select an interpretive persona intent during profile-building", () => {
  const state = {
    ...createConversationStateSnapshot("turn-plan-profile"),
    current_mode: "profile_building" as const,
    relational_continuity: {
      ...createConversationStateSnapshot("turn-plan-profile").relational_continuity,
      current_emotional_beat: "measured_reading",
    },
  };
  const plan = buildTurnPlan(
    [
      { role: "assistant", content: "What do you lose track of time doing when nobody is steering you?" },
      { role: "user", content: "I like golf because it shuts my head up." },
    ],
    {
      conversationState: state,
    },
  );

  assert.equal(plan.requiredMove, "acknowledge_user_answer");
  assert.equal(plan.personaIntent, "move_from_interview_mode_into_interpretation");
  assert.equal(plan.requestedAction, "gather_profile_only_when_needed");
  assert.match(
    buildTurnPlanSystemMessage(plan),
    /Persona intent: move_from_interview_mode_into_interpretation/i,
  );
});

test("turn plan resolves modification request against the active thread", () => {
  const state = {
    ...createConversationStateSnapshot("turn-plan-modify"),
    active_topic: "bedtime routine",
    active_thread: "bedtime routine",
    pending_user_request: "build a bedtime routine",
    request_fulfilled: true,
  };
  const plan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. Start by locking the lights-out time first." },
      { role: "user", content: "what about if we add journaling before bed" },
    ],
    {
      conversationState: state,
    },
  );

  assert.equal(plan.requestedAction, "modify_existing_idea");
  assert.equal(plan.outputShape, "acknowledgment_plus_modification");
  assert.equal(plan.hasSufficientContextToAct, true);
  assert.match(plan.pendingModification, /journaling before bed/i);
  assert.match(buildTurnPlanSystemMessage(plan), /Requested action: modify_existing_idea/i);
});

test("turn plan keeps a bare what do you think on the prior thread", () => {
  const state = {
    ...createConversationStateSnapshot("turn-plan-opinion"),
    active_topic: "confession",
    active_thread: "confession",
    relational_continuity: {
      ...createConversationStateSnapshot("turn-plan-opinion").relational_continuity,
      current_emotional_beat: "earned_honesty",
    },
  };
  const plan = buildTurnPlan(
    [
      { role: "assistant", content: "That hesitation is doing more talking than your wording is." },
      { role: "user", content: "what do you think" },
    ],
    {
      conversationState: state,
    },
  );

  assert.equal(plan.requestedAction, "interpret_and_reflect");
  assert.equal(plan.outputShape, "short_interpretation");
  assert.equal(plan.personaIntent, "reference_prior_emotional_beat");
});

test("turn plan satisfaction rejects asking instead of modifying when context is sufficient", () => {
  const plan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. Start by locking the lights-out time first." },
      { role: "user", content: "what about if we add journaling before bed" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-modify-satisfied"),
        active_thread: "bedtime routine",
        active_topic: "bedtime routine",
      },
    },
  );

  const result = isTurnPlanSatisfied(
    plan,
    "Tell me whether you want psychology, mechanics, or pressure first?",
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "asked_instead_of_acting");
});

test("recent turns context includes last turns without system lines", () => {
  const context = buildRecentTurnsContext([
    { role: "system", content: "internal note" },
    { role: "assistant", content: "First line." },
    { role: "user", content: "Second line." },
  ]);
  assert.match(context, /^Recent turns:/i);
  assert.match(context, /Raven: First line\./i);
  assert.match(context, /User: Second line\./i);
  assert.doesNotMatch(context, /internal note/i);
});
