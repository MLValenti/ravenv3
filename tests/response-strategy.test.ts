import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuityRecoveryReply,
  chooseResponseStrategy,
  shouldKeepCoherentModelReply,
} from "../lib/chat/response-strategy.ts";
import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";

test("coherent model reply is preserved when it stays on the active thread", () => {
  const state = {
    ...createConversationStateSnapshot("response-strategy"),
    active_topic: "week planning",
    open_loops: ["lock the morning block first"],
    recent_commitments_or_tasks: ["lock the morning block first"],
  };

  assert.equal(
    shouldKeepCoherentModelReply({
      text: "Back to week planning. Lock the morning block first, then we can place the evening.",
      state,
      lastUserMessage: "go back to the plan",
    }),
    true,
  );
});

test("generic off-thread model reply is not preserved on a turn-plan miss", () => {
  const state = {
    ...createConversationStateSnapshot("response-strategy-generic"),
    active_topic: "week planning",
    open_loops: ["lock the morning block first"],
  };

  assert.equal(
    shouldKeepCoherentModelReply({
      text: "Tell me what you want to explore next.",
      state,
      lastUserMessage: "what about the evening?",
    }),
    false,
  );
});

test("response strategy stays on unresolved loops before shifting modes", () => {
  const state = {
    ...createConversationStateSnapshot("response-strategy-open-loop"),
    current_mode: "question_answering" as const,
    unanswered_questions: ["why that order?"],
    open_loops: ["why that order?"],
  };

  const strategy = chooseResponseStrategy({
    turnPlan: {
      requiredMove: "continue_same_topic",
      requestedAction: "continue_active_thread",
      activeThread: "week planning",
      pendingUserRequest: "why that order?",
      pendingModification: "none",
      outputShape: "continuation_paragraph",
      hasSufficientContextToAct: true,
      latestUserMessage: "why that order?",
      previousAssistantMessage: "Errands first, then gym.",
      previousUserMessage: "plan my night",
      personaIntent: "reference_prior_emotional_beat",
      userResponseEnergy: "steady",
      relationalBeatReference: "controlled_explanation",
      reason: "default_continue",
      userKeywords: ["order"],
      previousAssistantKeywords: ["errands", "gym"],
    },
    conversationState: state,
  });

  assert.equal(strategy, "fulfill_active_request");
});

test("response strategy can shift into interpretive mode during profile-building", () => {
  const state = {
    ...createConversationStateSnapshot("response-strategy-interpret"),
    current_mode: "profile_building" as const,
  };

  const strategy = chooseResponseStrategy({
    turnPlan: {
      requiredMove: "acknowledge_user_answer",
      requestedAction: "gather_profile_only_when_needed",
      activeThread: "profile",
      pendingUserRequest: "I like golf because it shuts my head up.",
      pendingModification: "none",
      outputShape: "short_interpretation",
      hasSufficientContextToAct: true,
      latestUserMessage: "I like golf because it shuts my head up.",
      previousAssistantMessage: "What do you lose track of time doing when nobody is steering you?",
      previousUserMessage: "get to know me better",
      personaIntent: "move_from_interview_mode_into_interpretation",
      userResponseEnergy: "open",
      relationalBeatReference: "earned_honesty",
      reason: "assistant_asked_and_user_replied",
      userKeywords: ["golf"],
      previousAssistantKeywords: ["steering"],
    },
    conversationState: state,
  });

  assert.equal(strategy, "interpret_then_lead");
});

test("response strategy prioritizes revision when the user modifies the live thread", () => {
  const state = {
    ...createConversationStateSnapshot("response-strategy-revise"),
    active_topic: "bedtime routine",
    active_thread: "bedtime routine",
    pending_modification: "journaling before bed",
    pending_user_request: "what about if we add journaling before bed",
    current_output_shape: "acknowledgment_plus_modification" as const,
  };

  const strategy = chooseResponseStrategy({
    turnPlan: {
      requiredMove: "answer_user_question",
      requestedAction: "modify_existing_idea",
      activeThread: "bedtime routine",
      pendingUserRequest: "what about if we add journaling before bed",
      pendingModification: "journaling before bed",
      outputShape: "acknowledgment_plus_modification",
      hasSufficientContextToAct: true,
      latestUserMessage: "what about if we add journaling before bed",
      previousAssistantMessage: "Start by locking the lights-out time first.",
      previousUserMessage: "build me a bedtime routine",
      personaIntent: "shift_from_observation_to_guidance",
      userResponseEnergy: "steady",
      relationalBeatReference: "steady_pressure",
      reason: "latest_user_message_is_question",
      userKeywords: ["journaling", "before", "bed"],
      previousAssistantKeywords: ["lights", "time"],
    },
    conversationState: state,
  });

  assert.equal(strategy, "revise_active_thread");
});

test("continuity recovery for assistant-self preference questions stays conversational", () => {
  const state = {
    ...createConversationStateSnapshot("response-strategy-preference-recovery"),
    current_mode: "question_answering" as const,
    active_topic: "feeling",
    active_thread: "feeling",
  };

  const reply = buildContinuityRecoveryReply({
    strategy: "fulfill_active_request",
    state,
    lastUserMessage: "do you like bondage",
    toneProfile: "dominant",
  });

  assert.match(reply, /i like bondage|restraint|dynamic|ornamental/i);
  assert.doesNotMatch(reply, /fulfill the exact request already in play/i);
  assert.doesNotMatch(reply, /we are still on feeling/i);
});
