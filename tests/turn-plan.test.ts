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
  assert.match(fallback, /i mean hesitation|i mean that hesitation|last point|what i mean/i);
  assert.doesNotMatch(fallback, /name the part that lost you|start talking/i);
});

test("turn plan treats yes please explain as answering the previous assistant point", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Exactly. Usefulness is not a pose. It shows up in honesty, steadiness, and follow-through.",
      },
      { role: "user", content: "yes please explain" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-clarify-yes-explain"),
        current_mode: "relational_chat",
      },
    },
  );

  assert.equal(plan.requiredMove, "answer_user_question");
  assert.equal(plan.requestedAction, "answer_direct_question");
  assert.equal(plan.reason, "clarify_previous_assistant_point");
});

test("turn plan rejects pseudo-profile opener acknowledgements and requires a real profile question", () => {
  const plan = buildTurnPlan(
    [{ role: "user", content: "I want you to learn what I like" }],
    {
      conversationState: createConversationStateSnapshot("turn-plan-profile-opener"),
    },
  );

  assert.equal(plan.requestedAction, "gather_profile_only_when_needed");

  const rejected = isTurnPlanSatisfied(
    plan,
    "Noted, pet. To make this conversation helpful, I must learn about your preferences directly from you.",
  );
  assert.equal(rejected.ok, false);

  const accepted = isTurnPlanSatisfied(
    plan,
    "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
  );
  assert.equal(accepted.ok, true);
});

test("turn plan rejects bare profile-answer acknowledgement and requires a grounded follow-up question", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
      },
      { role: "user", content: "I like golf" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-profile-answer"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    },
  );

  assert.equal(plan.requestedAction, "gather_profile_only_when_needed");

  const rejected = isTurnPlanSatisfied(
    plan,
    "Noted, pet. Now we're getting somewhere. Golf is one of your interests.",
  );
  assert.equal(rejected.ok, false);

  const accepted = isTurnPlanSatisfied(
    plan,
    "Golf. Good. What else should I know about your boundaries or the things you do not want pushed?",
  );
  assert.equal(accepted.ok, true);
});

test("turn plan clarification satisfaction rejects asking a new question before explaining", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Exactly. Usefulness is not a pose. It shows up in honesty, steadiness, and follow-through.",
      },
      { role: "user", content: "yes please explain" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-clarify-question-first"),
        current_mode: "relational_chat",
      },
    },
  );

  const result = isTurnPlanSatisfied(plan, "Good. Now tell me why you're here.");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "clarification_reset");
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

test("turn plan fallback starts a planning opener with a concrete planning anchor", () => {
  const plan = buildTurnPlan([{ role: "user", content: "help me plan tomorrow morning" }]);

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(tomorrow morning|what time|wake time|anchor|first block)\b/i);
  assert.match(fallback, /\?/);
  assert.doesNotMatch(fallback, /fine\. say what you want|enough hovering|tell me about tomorrow morning/i);
});

test("turn plan fallback keeps short planning follow-ups on the active plan", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
      },
      { role: "user", content: "then what" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-follow-up"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(gym|food|evening|after that)\b/i);
  assert.doesNotMatch(fallback, /fine\. say what you want|enough hovering|trained|useful to me/i);
});

test("turn plan fallback keeps a paraphrased saturday planning clarification on saturday", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Alright, let's tackle your errands first thing in the morning. What do you need to get done? Remember, I'm here to guide and help you achieve those tasks efficiently.",
      },
      { role: "user", content: "why" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-paraphrased-why"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(because|errands|saturday|cleaner|later)\b/i);
  assert.doesNotMatch(fallback, /\b(morning block|wake time|focused hour)\b/i);
  assert.doesNotMatch(fallback, /what do you need to get done|fine\. say what you want/i);
});

test("turn plan fallback keeps a paraphrased saturday planning continuation on saturday", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Alright, let's tackle your errands first thing in the morning. What do you need to get done? Remember, I'm here to guide and help you achieve those tasks efficiently.",
      },
      { role: "user", content: "then what" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-paraphrased-then-what"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(gym|food|evening|after that|next block)\b/i);
  assert.doesNotMatch(fallback, /\b(morning block|wake time|focused hour)\b/i);
  assert.doesNotMatch(fallback, /what do you need to get done|fine\. say what you want/i);
});

test("turn plan rejects generic errands-first planning drift and requires the concrete next-plan beat", () => {
  const plan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. Do you want errands first, gym first, or downtime first?" },
      { role: "user", content: "errands first" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-errands-concrete"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const rejected = isTurnPlanSatisfied(
    plan,
    "Alright, let's start with running errands. What tasks need to be done this weekend?",
  );
  assert.equal(rejected.ok, false);

  const accepted = isTurnPlanSatisfied(
    plan,
    "Good. Errands first while the day is clean, then gym, then the evening stays open.",
  );
  assert.equal(accepted.ok, true);
});

test("turn plan rejects generic evening planning drift and requires a concrete evening beat", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
      },
      { role: "user", content: "ok and what about the evening?" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-evening-concrete"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const rejected = isTurnPlanSatisfied(
    plan,
    "We can stay on evening. Tell me what it actually changes between people.",
  );
  assert.equal(rejected.ok, false);

  const accepted = isTurnPlanSatisfied(
    plan,
    "Keep the evening light. One social thing at most, then a clean stop.",
  );
  assert.equal(accepted.ok, true);
});

test("turn plan fallback can return to the prior planning thread after a short detour", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Good. After this round, we return to the morning plan and lock the first block cleanly.",
      },
      { role: "user", content: "go back to that morning block you mentioned" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-return"),
        active_thread: "game",
        active_topic: "game",
        current_mode: "game",
      },
    },
  );

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(morning block|wake time|focused hour|morning plan)\b/i);
  assert.doesNotMatch(fallback, /\b(round|throw|guess|pick one number|say what you want)\b/i);
});

test("turn plan fallback bridges a planning detour into one game round without losing the plan", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Start with the anchor. What time does tomorrow morning begin?",
      },
      { role: "user", content: "actually lets play a game first" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-game-detour"),
        active_thread: "tomorrow morning",
        active_topic: "tomorrow morning",
        current_mode: "normal_chat",
      },
    },
  );

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(quick|pick|game)\b/i);
  assert.match(fallback, /\b(return to tomorrow morning|tomorrow morning)\b/i);
  assert.match(fallback, /\?/);
  assert.doesNotMatch(fallback, /fine\. say what you want|i heard your answer and i am continuing from it now/i);
});

test("turn plan fallback uses wager-specific follow-up for bet cues", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I pick. We are doing a game." },
    { role: "user", content: "lets bet on the game" },
  ]);
  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /\b(wager|stakes|win terms)\b/i);
});

test("turn plan rejects a rules recap when the user asked for Raven's move in the current game round", () => {
  const plan = buildTurnPlan([
    {
      role: "assistant",
      content:
        "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
    },
    { role: "user", content: "rock for the first throw. what's your choice?" },
  ]);

  const bad = isTurnPlanSatisfied(
    plan,
    "Listen carefully, pet. We stay with rock paper scissors streak. Two throws. You answer each one with rock, paper, or scissors. Beat both throws to win.",
  );
  const good = isTurnPlanSatisfied(
    plan,
    "Good. You chose rock. I threw scissors. Rock beats scissors. Clean. You take the first throw. Keep up, pet. Second throw now. Choose rock, paper, or scissors.",
  );

  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "missing_game_answer");
  assert.equal(good.ok, true);
  assert.equal(good.reason, "game_answered");
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

test("turn plan accepts coherent mutual get-to-know answers without forcing fallback", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "Fine. Ask properly." },
    { role: "user", content: "what do you want to know about me?" },
  ]);

  const result = isTurnPlanSatisfied(plan, "Tell me where your submission started. Be specific.");

  assert.equal(result.ok, true);
  assert.equal(result.reason, "relational_question_answered");
});

test("turn plan treats implicit assistant-self questions as direct answers, not modifications", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I am here." },
    { role: "user", content: "tell me more about you" },
  ]);

  assert.equal(plan.requiredMove, "answer_user_question");
  assert.equal(plan.requestedAction, "answer_direct_question");

  const result = isTurnPlanSatisfied(
    plan,
    "What keeps my attention is the part that is real. Say that cleanly, and I will stay with it.",
  );

  assert.equal(result.ok, true);
  assert.equal(result.reason, "relational_question_answered");
});

test("turn plan treats imperative service follow-up on an active subject as a direct answer request", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "If you want training, tell me what you want it to change in you once it stops being decorative.",
      },
      { role: "user", content: "tell me what you can actually do for me" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-service-follow-up-answer-first"),
        current_mode: "relational_chat",
        active_thread: "what being trained by me would actually change for you",
        active_topic: "what being trained by me would actually change for you",
      },
    },
  );

  assert.equal(plan.requiredMove, "answer_user_question");
  assert.equal(plan.requestedAction, "answer_direct_question");
});

test("turn plan keeps profile follow-up requests inside profile-building instead of treating them as modifications", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Golf. Good. What else should I know about your boundaries or the things you do not want pushed?",
      },
      { role: "user", content: "Ask me more questions" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-profile-follow-up"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    },
  );

  assert.equal(plan.requestedAction, "gather_profile_only_when_needed");
  const fallback = buildTurnPlanFallback(plan, "neutral");
  assert.match(fallback, /people usually miss about you|what should i call you|what do you actually enjoy/i);
  assert.doesNotMatch(fallback, /keep the same subject|answer this change directly/i);
});

test("turn plan lets concrete requests leave profile-building instead of forcing another profile question", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Golf. Good. What else should I know about your boundaries or the things you do not want pushed?",
      },
      { role: "user", content: "use that and give me a calm nighttime routine" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-profile-exit"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    },
  );

  assert.notEqual(plan.requestedAction, "gather_profile_only_when_needed");
  assert.equal(plan.requestedAction, "modify_existing_idea");
});

test("turn plan does not let stale profile mode steal a planning opener", () => {
  const plan = buildTurnPlan([{ role: "user", content: "help me plan tomorrow morning" }], {
    conversationState: {
      ...createConversationStateSnapshot("turn-plan-profile-mode-planning-opener"),
      current_mode: "profile_building",
      active_thread: "profile",
      active_topic: "profile",
    },
  });

  assert.notEqual(plan.requestedAction, "gather_profile_only_when_needed");
  assert.equal(plan.requestedAction, "continue_active_thread");
});

test("turn plan does not let stale profile mode steal task continuation", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "That task is complete. Ask for the next task if you want one.",
      },
      { role: "user", content: "set me another one" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-profile-mode-task-continuation"),
        current_mode: "profile_building",
        active_thread: "task",
        active_topic: "task",
      },
    },
  );

  assert.notEqual(plan.requestedAction, "gather_profile_only_when_needed");
  assert.equal(plan.requestedAction, "continue_active_thread");
});

test("turn plan fallback keeps an explicit chat choice inside the opener thread", () => {
  const plan = buildTurnPlan([
    {
      role: "assistant",
      content: "You're here. What has your attention tonight: chat, a plan, or a game?",
    },
    { role: "user", content: "chat" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "neutral");
  assert.match(fallback, /pressure|right now|chat/i);
  assert.doesNotMatch(fallback, /fine\. say what you want/i);
});

test("turn plan fallback keeps greeting turns conversational instead of using clarification rails", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I am here." },
    { role: "user", content: "hi" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /enough hovering|what you actually want|worth hearing/i);
  assert.doesNotMatch(fallback, /ask the exact question you want answered/i);
  assert.doesNotMatch(fallback, /keep it specific|meaning, the rule, or the next step/i);
});

test("turn plan fallback opens a greeting into a concrete casual choice thread", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I am here." },
    { role: "user", content: "hi mistress" },
  ]);

  const fallback = buildTurnPlanFallback(plan, "dominant");

  assert.match(fallback, /\b(chat|plan|game)\b/i);
  assert.match(fallback, /\?/);
  assert.doesNotMatch(fallback, /enough hovering|fine\. say what you want|start talking/i);
});

test("turn plan rejects a bare greeting reply on a fresh open-chat greeting turn", () => {
  const plan = buildTurnPlan([
    { role: "assistant", content: "I am here." },
    { role: "user", content: "hi mistress" },
  ]);

  const result = isTurnPlanSatisfied(plan, "Hello, pet.");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "greeting_not_opened");
});

test("turn plan fallback grounds profile answers in the user's stated preference", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
      },
      { role: "user", content: "I like golf" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-profile-answer"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    },
  );

  const fallback = buildTurnPlanFallback(plan, "dominant");
  assert.match(fallback, /golf/i);
  assert.match(fallback, /what else should i know|what do not want pushed/i);
});

test("turn plan rejects generic planning intake reopen after a planning choice answer", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Do you want errands first, gym first, or downtime first?",
      },
      { role: "user", content: "errands first" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-planning-choice-answer"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const bad = isTurnPlanSatisfied(
    plan,
    "Alright, let's plan out your errands for Saturday. What do you need to get done?",
  );
  const good = isTurnPlanSatisfied(
    plan,
    "Good. Errands first while the day is clean, then gym, then the evening stays open.",
  );

  assert.equal(bad.ok, false);
  assert.match(bad.reason, /planning_(?:answer|thread)_missed/);
  assert.equal(good.ok, true);
  assert.match(good.reason, /planning_(?:answer|thread)_(?:continued|kept)/);
});

test("turn plan rejects generic acknowledgement when a pressure-answer follow-up is available", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. What has the most pressure on you right now?",
      },
      { role: "user", content: "work" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-pressure-answer"),
        active_thread: "open_chat",
        active_topic: "open_chat",
        current_mode: "normal_chat",
      },
    },
  );

  const bad = isTurnPlanSatisfied(
    plan,
    "Noted, pet. You completed a step, so I move you to the next instruction now. Let's focus on work first.",
  );
  const good = isTurnPlanSatisfied(
    plan,
    "Good. Is it workload, a person, or a decision you keep circling?",
  );

  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "answer_thread_not_grounded");
  assert.equal(good.ok, true);
  assert.equal(good.reason, "answer_thread_grounded");
});

test("turn plan rejects generic acknowledgement when a casual disclosure follow-up is available", () => {
  const plan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Then talk to me normally for a minute. What is actually on your mind?",
      },
      { role: "user", content: "I like golf" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-disclosure-answer"),
        active_thread: "open_chat",
        active_topic: "open_chat",
        current_mode: "normal_chat",
      },
    },
  );

  const bad = isTurnPlanSatisfied(
    plan,
    "Yes. Keep going. Stay with the concrete part of open, not the wording around it.",
  );
  const good = isTurnPlanSatisfied(
    plan,
    "Golf. Good. What do you like about it most: the focus, the quiet, or the competition?",
  );

  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "answer_thread_not_grounded");
  assert.equal(good.ok, true);
  assert.equal(good.reason, "answer_thread_grounded");
});

test("turn plan fallback summary does not surface internal thread labels", () => {
  const fallback = buildTurnPlanFallback(
    {
      latestUserMessage: "go on",
      previousAssistantMessage: "Keep talking.",
      previousUserMessage: "hi",
      currentMode: "normal_chat",
      requiredMove: "continue_same_topic",
      conversationMove: "raven_leads_next_beat",
      requestedAction: "summarize_current_thread",
      activeThread: "open_chat",
      pendingUserRequest: "pending modification",
      pendingModification: "none",
      outputShape: "continuation_paragraph",
      hasSufficientContextToAct: true,
      personaIntent: "lead_next_beat",
      userResponseEnergy: "steady",
      relationalBeatReference: "steady_pressure",
      reason: "default_continue",
      userKeywords: [],
      previousAssistantKeywords: [],
    },
    "dominant",
  );

  assert.doesNotMatch(
    fallback,
    /open_chat|relational_chat|normal_chat|current_mode|active_thread|pending modification/i,
  );
  assert.match(fallback, /stay with|already in motion|part still open/i);
});

test("turn plan fallback blocker question does not surface raw internal labels", () => {
  const fallback = buildTurnPlanFallback(
    {
      latestUserMessage: "what now",
      previousAssistantMessage: "Keep going.",
      previousUserMessage: "hi",
      currentMode: "normal_chat",
      requiredMove: "answer_user_question",
      conversationMove: "continue_current_thought",
      requestedAction: "clarify_missing_blocker",
      activeThread: "active_thread",
      pendingUserRequest: "none",
      pendingModification: "none",
      outputShape: "single_question",
      hasSufficientContextToAct: false,
      personaIntent: "lead_next_beat",
      userResponseEnergy: "steady",
      relationalBeatReference: "steady_pressure",
      reason: "latest_user_message_is_question",
      userKeywords: ["what"],
      previousAssistantKeywords: ["keep"],
    },
    "dominant",
  );

  assert.doesNotMatch(
    fallback,
    /open_chat|relational_chat|normal_chat|current_mode|active_thread|pending modification/i,
  );
  assert.match(fallback, /one variable/i);
});

test("turn plan does not treat good evening as a missing-blocker turn", () => {
  const plan = buildTurnPlan([{ role: "user", content: "good evening" }]);

  assert.equal(plan.requestedAction, "continue_active_thread");
  assert.equal(plan.hasSufficientContextToAct, true);
});

test("turn plan accepts hi as a fresh open-conversation greeting", () => {
  const plan = buildTurnPlan(
    [{ role: "user", content: "hi" }],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-greeting-hi"),
        current_mode: "normal_chat",
      },
    },
  );

  const result = isTurnPlanSatisfied(plan, "Hello, pet. Come closer.");

  assert.equal(result.ok, true);
  assert.equal(result.reason, "greeting_opened");
});

test("turn plan accepts hello as a fresh open-conversation greeting", () => {
  const plan = buildTurnPlan(
    [{ role: "user", content: "hello" }],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-greeting-hello"),
        current_mode: "normal_chat",
      },
    },
  );

  const result = isTurnPlanSatisfied(plan, "Hello. I am listening.");

  assert.equal(result.ok, true);
  assert.equal(result.reason, "greeting_opened");
});

test("turn plan still holds direct questions to the stronger answer standard", () => {
  const plan = buildTurnPlan([{ role: "user", content: "what should our session be about?" }]);

  const result = isTurnPlanSatisfied(plan, "Hello, pet. Come closer.");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_question_alignment");
});

test("turn plan still enforces continuity during active game scenes", () => {
  const plan = buildTurnPlan(
    [
      { role: "assistant", content: "I pick. We are doing number command. Pick one number now." },
      { role: "user", content: "hi" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("turn-plan-greeting-game"),
        current_mode: "game",
        active_thread: "number command",
        active_topic: "number command",
      },
    },
  );

  const result = isTurnPlanSatisfied(plan, "Hello, pet. Come closer.");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "active_thread_missed");
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
