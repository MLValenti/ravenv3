import test from "node:test";
import assert from "node:assert/strict";

import { createCommitmentState } from "../lib/session/commitment-engine.ts";
import {
  createConversationStateSnapshot,
  deriveConversationStateFromMessages,
} from "../lib/chat/conversation-state.ts";
import { buildTurnPlan } from "../lib/chat/turn-plan.ts";
import {
  applyResponseGate,
  scrubVisibleInternalLeakText,
} from "../lib/session/response-gate.ts";
import { createResponseGateCandidateBuilder } from "../lib/session/response-gate-candidates.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
} from "../lib/session/scene-state.ts";
import { createSessionMemory, writeUserAnswer } from "../lib/session/session-memory.ts";
import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import { createEmptyTrainingThread } from "../lib/session/training-thread.ts";

test("response gate strips leaked internal prompt lines", () => {
  const result = applyResponseGate({
    text: [
      "Scene State:",
      "Topic type: game_setup",
      "Commitment:",
      "Type: choose_game",
      "I pick. We are doing a quick word chain.",
    ].join("\n"),
    userText: "you pick",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "game_start_contract_restored");
  assert.match(result.text, /i pick|we are doing/i);
  assert.match(result.text, /first throw now|first guess now|first prompt|first choice/i);
});

test("response gate replaces machine identity leak with in-thread fallback", () => {
  const routed = classifyDialogueRoute({
    text: "how long do i wear it",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "how long do i wear it",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });

  const result = applyResponseGate({
    text: "I am a system designed to help with tasks.",
    userText: "how long do i wear it",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /2 hours/i);
});

test("response gate rejects leaked internal strategy phrasing", () => {
  const result = applyResponseGate({
    text: "Apply the user's requested change to the live thread. Stay on task. Use this response family.",
    userText: "pick a topic and talk",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "removed_internal_or_identity_leak");
  assert.doesNotMatch(result.text, /apply the user's requested change|stay on task|response family/i);
});

test("response gate rejects preserve-active-thread scaffold leakage", () => {
  const result = applyResponseGate({
    text: "Preserve the active thread. Fulfill request now.",
    userText: "what do you want to talk about?",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "removed_internal_or_identity_leak");
  assert.doesNotMatch(result.text, /preserve the active thread|fulfill request now/i);
  assert.match(result.text, /useful|trained|entertain|control/i);
});

test("final visible scrub removes prompt echo residue from model-path text", () => {
  const result = scrubVisibleInternalLeakText(
    "Response strategy: answer_direct. Active thread: open_chat. Answer the user in the first sentence.",
  );

  assert.equal(result.changed, true);
  assert.equal(result.blocked, true);
  assert.equal(result.text, "");
});

test("final visible scrub removes orchestration wording without mangling natural text", () => {
  const result = scrubVisibleInternalLeakText(
    "There you are. That makes the next beat tighter.",
  );

  assert.equal(result.changed, true);
  assert.equal(result.blocked, false);
  assert.equal(result.text, "There you are.");
});

test("final visible scrub leaves coherent natural replies intact", () => {
  const result = scrubVisibleInternalLeakText(
    "There you are. You have my attention.",
  );

  assert.equal(result.changed, false);
  assert.equal(result.blocked, false);
  assert.equal(result.text, "There you are. You have my attention.");
});

test("response gate replaces assistant-self disclaimer leak with a relational answer", () => {
  const result = applyResponseGate({
    text: "Raven does not have personal preferences or experiences. It only enforces protocols and compliances that the user defines as their own kinks.",
    userText: "what kinks do you like?",
    lastAssistantText: null,
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "removed_internal_or_identity_leak");
  assert.doesNotMatch(result.text, /does not have personal preferences|enforces protocols/i);
  assert.match(result.text, /control with purpose|power exchange|restraint|obedience|tension/i);
});

test("response gate rewrites assistant-service turn-back fallback into a real training answer", () => {
  const result = applyResponseGate({
    text: "Ask me directly, and I will answer. Then I may turn one back on you.",
    userText: "what do you think would be a good training we could do today",
    dialogueAct: "user_question",
    lastAssistantText: "Sharp enough. Now tell me why you're here.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
      agreed_goal: "training and usefulness",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "dialogue_act_misaligned");
  assert.doesNotMatch(result.text, /ask me directly/i);
  assert.match(result.text, /training|obedience|drill|one clean sentence|permission|cuffs|collar|plug|rule/i);
});

test("response gate rejects generic fallback on a valid planning opener", () => {
  const turnPlan = buildTurnPlan([{ role: "user", content: "help me plan tomorrow morning" }]);

  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "help me plan tomorrow morning",
    lastAssistantText: null,
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(tomorrow morning|what time|wake time|first block|anchor)\b/i);
  assert.doesNotMatch(result.text, /fine\. say what you want|enough hovering/i);
});

test("response gate rejects wrong-family fallback on an active planning continuation", () => {
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
      },
      { role: "user", content: "then what" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-continuation"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const result = applyResponseGate({
    text: "Enough hovering, pet. Tell me what you actually want.",
    userText: "then what",
    lastAssistantText:
      "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(gym|food|evening|after that)\b/i);
  assert.doesNotMatch(result.text, /enough hovering|what you actually want|trained|useful to me/i);
});

test("response gate rejects planning clarification that reopens intake instead of answering the current plan", () => {
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
      },
      { role: "user", content: "why" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-why"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const result = applyResponseGate({
    text: "Because it helps us make a clear plan. Now, what are those tasks you need to get done?",
    userText: "why",
    lastAssistantText:
      "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(because|errands|cleaner|later|gym|evening)\b/i);
  assert.doesNotMatch(result.text, /what are those tasks you need to get done/i);
});

test("response gate rejects planning continuation that drifts into generic structuring language", () => {
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Because errands first keeps the loose outside movement up front, so the rest of Saturday stops leaking around it. Then gym lands clean, and the evening stays open.",
      },
      { role: "user", content: "then what" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-then-what"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const result = applyResponseGate({
    text: "First, focus on structuring your day with clarity and precision. We can touch on the evening when we're closer to it, pet.",
    userText: "then what",
    lastAssistantText:
      "Because errands first keeps the loose outside movement up front, so the rest of Saturday stops leaking around it. Then gym lands clean, and the evening stays open.",
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(gym|food|evening|after that|next block)\b/i);
  assert.doesNotMatch(result.text, /structuring your day with clarity and precision|touch on the evening when we're closer to it/i);
});

test("response gate rejects generic errands-first planning drift and restores the concrete next-plan beat", () => {
  const turnPlan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. Do you want errands first, gym first, or downtime first?" },
      { role: "user", content: "errands first" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-errands-concrete"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const result = applyResponseGate({
    text: "Alright, let's start with running errands. What tasks need to be done this weekend?",
    userText: "errands first",
    lastAssistantText: "Fine. Do you want errands first, gym first, or downtime first?",
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "turn_plan_misaligned");
  assert.match(result.text, /\b(errands first|gym|evening)\b/i);
  assert.doesNotMatch(result.text, /what tasks need to be done this weekend/i);
});

test("response gate rejects generic errands-first drift on the live path without relying on turn plan", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Fine. Do you want errands first, gym first, or downtime first?",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "Alright, let's plan your Saturday around errands first. What specific tasks do you need to complete?",
    userText: "errands first",
    lastAssistantText: "Fine. Do you want errands first, gym first, or downtime first?",
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(errands first|gym|evening)\b/i);
  assert.doesNotMatch(result.text, /what specific tasks do you need to complete/i);
});

test("response gate rejects generic why drift inside an active saturday plan on the live path", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "Because it will help us establish a clear schedule and reduce the chance of missing any important tasks or appointments. Having a well-planned day makes everything run smoothly and increases productivity. Now, let's get into the specifics.",
    userText: "why",
    lastAssistantText: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(errands|saturday|cleaner|spill)\b/i);
  assert.doesNotMatch(result.text, /establish a clear schedule|increases productivity/i);
});

test("response gate rejects routine-style why drift and restores the concrete saturday explanation", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "Because it helps us establish a routine and ensures we're making progress on our responsibilities. Now, which errands should we prioritize?",
    userText: "why",
    lastAssistantText: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(errands|saturday|cleaner|spill)\b/i);
  assert.doesNotMatch(result.text, /establish a routine|responsibilities|which errands should we prioritize/i);
});

test("response gate rejects generic then-what drift inside an active saturday plan on the live path", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Because errands spill if you push them late. This keeps the rest of Saturday cleaner.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "Alright, pet. Once we complete your errands, how would you like to spend the rest of the day?",
    userText: "then what",
    lastAssistantText: "Because errands spill if you push them late. This keeps the rest of Saturday cleaner.",
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(then|gym|food|evening)\b/i);
  assert.doesNotMatch(result.text, /spend the rest of the day/i);
});

test("response gate rejects generic evening planning drift and restores the concrete evening beat", () => {
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
      },
      { role: "user", content: "ok and what about the evening?" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-evening-concrete"),
        active_thread: "saturday",
        active_topic: "saturday",
        current_mode: "normal_chat",
      },
    },
  );

  const result = applyResponseGate({
    text: "We can stay on evening. Tell me what it actually changes between people.",
    userText: "ok and what about the evening?",
    lastAssistantText:
      "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(evening|social|clean stop)\b/i);
  assert.doesNotMatch(result.text, /what it actually changes between people/i);
});

test("response gate rejects generic evening drift inside an active plan on the live path", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "We can stay on evening. Tell me what it actually changes between people.",
    userText: "ok and what about the evening?",
    lastAssistantText:
      "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(evening|social|clean stop)\b/i);
  assert.doesNotMatch(result.text, /what it actually changes between people/i);
});

test("response gate rejects soft reorder drift and restores the concrete gym-first revision", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Then gym, then food, then the evening stays flexible.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "Alright, let's swap that up. Start with the gym and then move on to your errands?",
    userText: "change that, put gym before errands",
    lastAssistantText: "Then gym, then food, then the evening stays flexible.",
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(gym first|errands second|order changes)\b/i);
  assert.doesNotMatch(result.text, /start with the gym and then move on to your errands/i);
});

test("response gate keeps the preserved-return bridge visible when a planning detour game is picked", () => {
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Good. One round first, then we return to tomorrow morning. Do you want something quick, or do you want me to pick?",
      },
      { role: "user", content: "you pick" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-detour-pick"),
        active_thread: "game",
        active_topic: "game",
        current_mode: "game",
      },
    },
  );

  const result = applyResponseGate({
    text: "I pick. We are doing number hunt, pet. You hunt one hidden number from 1 to 10. Two guesses maximum. Listen carefully, pet. First guess now. One number from 1 to 10.",
    userText: "you pick",
    lastAssistantText:
      "Good. One round first, then we return to tomorrow morning. Do you want something quick, or do you want me to pick?",
    turnPlan,
    sceneState: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "game_setup",
      agreed_goal: "tomorrow morning",
    },
    commitmentState: createCommitmentState(),
  });

  assert.match(result.text, /\b(number hunt|pick one number|one round|return to tomorrow morning|tomorrow morning)\b/i);
});

test("response gate keeps the preserved-return bridge visible on a detour pick without relying on turn plan", () => {
  const result = applyResponseGate({
    text: "I pick. We are doing number hunt, pet. You hunt one hidden number from 1 to 10. Two guesses maximum. Listen carefully, pet. First guess now. One number from 1 to 10.",
    userText: "you pick",
    dialogueAct: "answer_activity_choice",
    lastAssistantText:
      "Good. One round first, then we return to tomorrow morning. Do you want something quick, or do you want me to pick?",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "game_setup",
      topic_locked: true,
      agreed_goal: "tomorrow morning",
      last_assistant_text:
        "Good. One round first, then we return to tomorrow morning. Do you want something quick, or do you want me to pick?",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(one round|return to tomorrow morning)\b/i);
  assert.match(result.text, /\b(number hunt|pick one number)\b/i);
});

test("response gate rejects game-family continuation when the user explicitly returns to the prior planning thread", () => {
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Good. After this round, we return to the morning plan. Keep the game quick, then I put you back on the first block.",
      },
      { role: "user", content: "go back to that morning block you mentioned" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-planning-return"),
        active_thread: "tomorrow morning",
        active_topic: "tomorrow morning",
        current_mode: "normal_chat",
      },
    },
  );

  const sceneState = noteSceneStateAssistantTurn(
    {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "game_execution",
      topic_locked: true,
    },
    {
      text: "Good. After this round, we return to the morning plan. Keep the game quick, then I put you back on the first block.",
    },
  );

  const result = applyResponseGate({
    text: "Stay on this game, pet. First throw now. Choose rock, paper, or scissors.",
    userText: "go back to that morning block you mentioned",
    lastAssistantText:
      "Good. After this round, we return to the morning plan. Keep the game quick, then I put you back on the first block.",
    turnPlan,
    sceneState,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(morning block|wake time|focused hour|first block|morning plan)\b/i);
  assert.doesNotMatch(result.text, /first throw now|choose rock, paper, or scissors|stay on this game/i);
});

test("response gate accepts how-are-you reply as aligned social answer", () => {
  const result = applyResponseGate({
    text: "Sharp enough. Now tell me why you're here.",
    userText: "how are you today",
    dialogueAct: "user_question",
    lastAssistantText: "Enough hovering, pet. Tell me what you actually want.",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
  assert.match(result.text, /sharp enough|why you're here/i);
});

test("response gate replaces duplicate output with a fallback when needed", () => {
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });

  const result = applyResponseGate({
    text: "Fine. We stay with the game. Choose quick or longer, or tell me to pick.",
    userText: "lets play a game",
    lastAssistantText: "Fine. We stay with the game. Choose quick or longer, or tell me to pick.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.reason, /duplicate_output_(?:blocked|replaced)/);
  assert.match(
    result.text,
    /Choose quick,? or choose something that runs for a few minutes|Choose quick or longer/i,
  );
  assert.notEqual(
    result.text.toLowerCase(),
    "fine. we stay with the game. choose quick or longer, or tell me to pick.",
  );
});

test("response gate blocks near-duplicate replies even when only the prefix changes", () => {
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });

  const result = applyResponseGate({
    text: "Stay on this game, pet. Choose quick or longer, or tell me to pick.",
    userText: "lets play a game",
    lastAssistantText: "Listen carefully, pet. Choose quick or longer, or tell me to pick.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.reason, /duplicate_output/);
});

test("response gate adds wager specific nudge when reward negotiation fallback repeats", () => {
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  const repeatedFallback =
    "Good. We set the wager now. State the stakes clearly first. Then we lock in the terms.";
  const result = applyResponseGate({
    text: repeatedFallback,
    userText: "what do you want if you win",
    lastAssistantText: repeatedFallback,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "duplicate_output_blocked");
  assert.match(result.text, /^No dodging, pet\./i);
  assert.match(result.text, /state the stakes clearly first/i);
});

test("response gate accepts wager negotiation replies for answer_activity_choice", () => {
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  const responseText =
    "Good. The stakes are control. If you win, you get one request. If I win, you hold a task.";
  const result = applyResponseGate({
    text: responseText,
    userText: "lets bet on the game",
    dialogueAct: "answer_activity_choice",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
  assert.match(result.text, /the stakes are control/i);
});

test("response gate blocks visual claims when observation trust is unreliable", () => {
  const result = applyResponseGate({
    text: "Listen carefully, pet. I see your face in frame right now.",
    userText: "what do you see",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    observationTrust: {
      canDescribeVisuals: false,
      reason: "stale observation (4200ms old)",
    },
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "visual_claim_blocked_by_trust");
  assert.match(result.text, /do not have a fresh camera read right now/i);
  assert.doesNotMatch(result.text, /\bi see your face in frame right now\b/i);
});

test("response gate keeps visual claims when observation trust is reliable", () => {
  const result = applyResponseGate({
    text: "Listen carefully, pet. I see your face in frame right now.",
    userText: "what do you see",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    observationTrust: {
      canDescribeVisuals: true,
      reason: "fresh live observation",
    },
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
  assert.match(result.text, /i see your face in frame right now/i);
});

test("response gate preserves coherent relational service answers", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "what can i do to be a better sub to you?",
    act: "user_question",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Practice verbal obedience and keep your follow-through clean when it starts to cost you something.",
    userText: "what can i do to be a better sub to you?",
    dialogueAct: "user_question",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
  assert.match(result.text, /verbal obedience|follow-through/i);
});

test("response gate enforces user question alignment after fallback rewrites", () => {
  const routed = classifyDialogueRoute({
    text: "how long do i wear it",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "how long do i wear it",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });
  const result = applyResponseGate({
    text: "Hold still and keep your shoulders back.",
    userText: "how long do i wear it",
    dialogueAct: "user_question",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.reason, /(scene_misaligned|dialogue_act_misaligned)/);
  assert.match(result.text, /\b\d+\s*(hour|hours|minute|minutes)\b/i);
});

test("response gate does not emit thread-control fallback for mutual get-to-know chat", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want to learn more about you",
    act: "other",
    sessionTopic: null,
  });
  const result = applyResponseGate({
    text: "Noted.",
    userText: "I want to learn more about you",
    dialogueAct: "user_answer",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.doesNotMatch(result.text, /Noted\. Stay with the current thread and continue\./i);
  assert.match(
    result.text,
    /what holds my attention|honesty|usefulness|control that actually changes something|play it both ways|something worth using|what do you want to know first/i,
  );
});

test("response gate treats generic intent statements as open chat instead of clarification fallback", () => {
  const result = applyResponseGate({
    text: "Ask the exact question you want answered, and I will answer it plainly.",
    userText: "I want to be trained",
    dialogueAct: "user_answer",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.doesNotMatch(result.text, /ask the exact question you want answered/i);
  assert.match(result.text, /want training|want it to change|trained/i);
});

test("response gate strips verbose task debug wrappers during active task flow", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a 20 minute task with my dildo",
    act: "task_request",
    sessionTopic: null,
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
  });

  const result = applyResponseGate({
    text: "I worked through 4 usable directions and kept the strongest fit. Here is your task: Keep the device on for 20 minutes. It fits because it fits a 20 minute window. What I am watching for: final report back.",
    userText: "anal",
    dialogueAct: "user_answer",
    lastAssistantText: "Be specific, pet. Tell me whether \"Toy\" is meant for oral, anal, or prop for this task.",
    sceneState: {
      ...scene,
      topic_type: "task_negotiation",
      interaction_mode: "task_planning",
      task_spec: {
        ...scene.task_spec,
        fulfillment_locked: true,
        request_stage: "ready_to_fulfill",
        next_required_action: "fulfill_request",
      },
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "verbose_task_debug_wrapper");
  assert.doesNotMatch(result.text, /i worked through|kept the strongest fit|what i am watching for/i);
  assert.match(result.text, /here is your task/i);
});

test("response gate accepts profile summary answers for summary questions", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "what have you learned about me so far",
    act: "user_question",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "So far I have: name: Mara | interests: golf | communication: short direct answers.",
    userText: "what have you learned about me so far",
    dialogueAct: "user_question",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
});

test("response gate accepts explicit chat-switch handoff replies", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "let's just chat for a minute",
    act: "other",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Fine. Then talk to me normally for a minute.",
    userText: "let's just chat for a minute",
    dialogueAct: "other",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
});

test("response gate keeps short clarification turns on a single clarification family", () => {
  const result = applyResponseGate({
    text: "We can break it down properly. Do you want the first move, the pacing, or the end point first?",
    userText: "what?",
    dialogueAct: "short_follow_up",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /i mean|point i just made|last point/i);
  assert.doesNotMatch(result.text, /first move|pacing|end point first/i);
});

test("response gate replaces weak clarification anchors before they reach the user", () => {
  const result = applyResponseGate({
    text: "I mean the part about tell. I am talking about the part that actually matters here.",
    userText: "what?",
    dialogueAct: "short_follow_up",
    lastAssistantText: "Tell me one thing people usually miss about you.",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    sessionMemory: writeUserAnswer(
      createSessionMemory(),
      "thinking about what i can do for you",
      1_000,
      "profile_fact",
    ),
  });

  assert.equal(result.forced, true);
  assert.doesNotMatch(result.text, /part about tell|stay with tell/i);
});

test("response gate rejects tell-me-more-about weak verb anchors", () => {
  const result = applyResponseGate({
    text: "Yes. Keep going. Tell me more about happens.",
    userText: "go on",
    dialogueAct: "short_follow_up",
    lastAssistantText: "What happens there first?",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    sessionMemory: writeUserAnswer(createSessionMemory(), "happens what first", 1_000, "profile_fact"),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "weak_clarification_anchor");
  assert.doesNotMatch(result.text, /tell me more about happens|tell me more about keep/i);
});

test("response gate rewrites broken repair replies that anchor on none", () => {
  const result = applyResponseGate({
    text: "I mean about none.",
    userText: "what do you mean?",
    dialogueAct: "short_follow_up",
    lastAssistantText: "You said none, but that answer usually hides something.",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    sessionMemory: writeUserAnswer(createSessionMemory(), "none", 1_000, "profile_fact"),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "repair_resolution_misaligned");
  assert.match(result.text, /when you said none|last answer sounded/i);
  assert.doesNotMatch(result.text, /about none|tell me about none|what part of none/i);
});

test("response gate restates scaffold phrasing on repair turns instead of letting a new question through", () => {
  const result = applyResponseGate({
    text: "What part of that matters to you?",
    userText: "what do you mean?",
    dialogueAct: "short_follow_up",
    lastAssistantText: "Fine. We can talk without the scaffolding for a minute.",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "repair_resolution_misaligned");
  assert.match(result.text, /scripted questioning|talk directly/i);
  assert.doesNotMatch(result.text, /\?$/i);
});

test("response gate rejects abstract conversation templates on valid chat turns", () => {
  const result = applyResponseGate({
    text: "Exactly. That is where it stops being decorative and starts costing something.",
    userText: "that makes sense",
    dialogueAct: "other",
    lastAssistantText: "Fantasy lets people flirt with the shape of it.",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "abstract_conversation_template");
  assert.doesNotMatch(result.text, /decorative|costing something|real dynamic/i);
});

test("response gate uses a direct opinion fallback for toy questions", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "what do you think about toys",
    act: "user_question",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Toys can heighten your submission and enhance the intensity of your training. Consent is key in roleplay.",
    userText: "what do you think about toys",
    dialogueAct: "user_question",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /intention|control|dynamic|exchange/i);
  assert.doesNotMatch(result.text, /consent is key|roleplay|training/i);
  assert.doesNotMatch(result.text, /point to the exact part|make it plain/i);
});

test("response gate keeps a bare opinion follow-up tied to the previous emotional beat", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "what do you think",
    act: "user_question",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Useful when it fits the person instead of replacing the dynamic.",
    userText: "what do you think",
    dialogueAct: "user_question",
    lastAssistantText: "That hesitation is doing more talking than your wording is. Do not polish it now.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(
    result.text,
    /hesitation mattered|truth was in the last line|more exposed than you meant|something real under it/i,
  );
  assert.doesNotMatch(result.text, /point to the exact part|make it plain/i);
});

test("response gate duplicate replacement keeps profile questioning adaptive", () => {
  const baseScene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to get to know me better",
    act: "other",
    sessionTopic: null,
  });
  const scene = {
    ...baseScene,
    interaction_mode: "profile_building" as const,
    profile_prompt_count: 2,
    last_profile_prompt: "Give me one more detail that tells me how to read you properly.",
  };
  const sessionMemory = {
    ...createSessionMemory(),
    last_user_answer: {
      value: "I like golf",
      updatedAt: Date.now(),
      confidence: 0.88,
    },
    user_profile_facts: [
      {
        value: "Mara",
        updatedAt: Date.now(),
        confidence: 0.9,
        kind: "identity",
        category: "preferred_labels_or_names",
      },
      {
        value: "golf",
        updatedAt: Date.now(),
        confidence: 0.9,
        kind: "hobby",
        category: "hobbies_interests",
      },
    ],
  };

  const result = applyResponseGate({
    text: "Give me one more detail that tells me how to read you properly.",
    userText: "I like golf",
    dialogueAct: "user_answer",
    lastAssistantText: "Give me one more detail that tells me how to read you properly.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
    sessionMemory,
  });

  assert.equal(result.forced, true);
  assert.doesNotMatch(result.text, /what should i call you/i);
  assert.match(
    result.text,
    /gets its hooks into you|does that do to your head|hard nos|tone dies on contact|people usually miss about you|keep in mind/i,
  );
});

test("response gate rejects stock fallback on a profile-building request", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to learn what I like",
    act: "other",
    sessionTopic: null,
  });
  const turnPlan = buildTurnPlan([{ role: "user", content: "I want you to learn what I like" }], {
    conversationState: createConversationStateSnapshot("response-gate-profile-request"),
  });

  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "I want you to learn what I like",
    dialogueAct: "user_answer",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.match(
    result.text,
    /what do you actually enjoy doing|what should i call you|what do you want me to understand/i,
  );
  assert.doesNotMatch(result.text, /fine\. say what you want/i);
});

test("response gate rejects opener reset on an active answer-thread follow-up question", () => {
  const conversationState = {
    ...createConversationStateSnapshot("response-gate-answer-thread-service"),
    current_mode: "relational_chat" as const,
    active_thread: "what being trained by me would actually change for you",
    active_topic: "what being trained by me would actually change for you",
  };
  const scene = {
    ...createSceneState(),
    active_training_thread: {
      ...createEmptyTrainingThread(),
      subject: "anal" as const,
      item_name: "plug",
      primary_variant: "a slow anal hold",
      alternate_variant: "paced anal intervals",
      focus: "pressure tolerance, patience, and control under repetition",
      rationale:
        "That line tells me whether you can stay deliberate under pressure instead of getting greedy or sloppy.",
      proof_requirement:
        "Yes. Give me one clean midpoint report and one final report so I know the control held the whole way through.",
      depth_guidance:
        "Deep enough that you can keep the pace deliberate and the control clean. I want control first, not maximum depth for its own sake.",
      recommended_duration: "15 to 20 minutes to start, longer only if the control stays deliberate.",
      last_response:
        "For anal training, I would start with a slow anal hold: settle into the pressure, hold it on a timer, ease off cleanly, and repeat without rushing.",
    },
  };
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "If you want training, tell me what you want it to change in you once it stops being decorative.",
      },
      { role: "user", content: "tell me what you can actually do for me" },
    ],
    { conversationState },
  );

  const result = applyResponseGate({
    text: "Sharp enough. Now tell me why you're here.",
    userText: "tell me what you can actually do for me",
    dialogueAct: "other",
    lastAssistantText:
      "If you want training, tell me what you want it to change in you once it stops being decorative.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.doesNotMatch(result.text, /why you're here|sharp enough/i);
  assert.match(result.text, /concrete anal training line|slow anal hold|paced anal intervals|pressure rule|deliberate instead of decorative/i);
});

test("response gate rejects opener or probe fallback on concrete-part follow-up turns", () => {
  const conversationState = {
    ...createConversationStateSnapshot("response-gate-answer-thread-concrete"),
    current_mode: "relational_chat" as const,
    active_thread: "what being trained by me would actually change for you",
    active_topic: "what being trained by me would actually change for you",
  };
  const scene = {
    ...createSceneState(),
    active_training_thread: {
      ...createEmptyTrainingThread(),
      subject: "anal" as const,
      item_name: "plug",
      primary_variant: "a slow anal hold",
      alternate_variant: "paced anal intervals",
      focus: "pressure tolerance, patience, and control under repetition",
      rationale:
        "That line tells me whether you can stay deliberate under pressure instead of getting greedy or sloppy.",
      proof_requirement:
        "Yes. Give me one clean midpoint report and one final report so I know the control held the whole way through.",
      depth_guidance:
        "Deep enough that you can keep the pace deliberate and the control clean. I want control first, not maximum depth for its own sake.",
      recommended_duration: "15 to 20 minutes to start, longer only if the control stays deliberate.",
      last_response:
        "For anal training, I would start with a slow anal hold: settle into the pressure, hold it on a timer, ease off cleanly, and repeat without rushing.",
    },
  };
  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content:
          "Start with clarity. Mean what you say, do what you promise, and hold steady once it costs you something. That is the part I pay attention to.",
      },
      { role: "user", content: "the concrete part" },
    ],
    { conversationState },
  );

  const result = applyResponseGate({
    text: "Enough hovering, pet. Tell me what you actually want.",
    userText: "the concrete part",
    dialogueAct: "short_follow_up",
    lastAssistantText:
      "Start with clarity. Mean what you say, do what you promise, and hold steady once it costs you something. That is the part I pay attention to.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.doesNotMatch(result.text, /enough hovering|what you actually want/i);
  assert.doesNotMatch(result.text, /tell me why you're here|start talking/i);
  assert.match(result.text, /clarity|hold steady|follow through|concrete/i);
});

test("response gate rejects session-framing drift on a profile-building opener", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to learn what I like",
    act: "other",
    sessionTopic: null,
  });
  const turnPlan = buildTurnPlan([{ role: "user", content: "I want you to learn what I like" }], {
    conversationState: createConversationStateSnapshot("response-gate-profile-session-framing"),
  });

  const result = applyResponseGate({
    text: "Noted, pet. I will take note of your preferences, pet. Now tell me how you'd like to start the session.",
    userText: "I want you to learn what I like",
    dialogueAct: "user_answer",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /what do you actually enjoy doing|off the clock|what should i call you/i);
  assert.doesNotMatch(result.text, /how you'd like to start the session|our sessions|here is your task/i);
});

test("response gate rejects pseudo-profile opener acknowledgement and restores a real profile question", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to learn what I like",
    act: "other",
    sessionTopic: null,
  });
  const turnPlan = buildTurnPlan([{ role: "user", content: "I want you to learn what I like" }], {
    conversationState: createConversationStateSnapshot("response-gate-profile-opener-noted"),
  });

  const result = applyResponseGate({
    text: "Noted, pet. To make this conversation helpful, I must learn about your preferences directly from you.",
    userText: "I want you to learn what I like",
    dialogueAct: "user_answer",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /what do you actually enjoy doing|off the clock|what should i call you|what do you want me to understand/i);
  assert.doesNotMatch(result.text, /to make this conversation helpful|preferences directly from you/i);
});

test("response gate rejects pseudo-profile continuation and regrounds the user's answer", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to learn what I like",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "I like golf",
    act: "other",
    sessionTopic: null,
  });

  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
      },
      { role: "user", content: "I like golf" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-profile-golf"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    },
  );

  const result = applyResponseGate({
    text: "Yes. Keep going. Stay with the concrete part of profile, not the wording around it.",
    userText: "I like golf",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\bgolf\b/i);
  assert.match(result.text, /\bboundaries\b|what else should i know/i);
  assert.doesNotMatch(result.text, /concrete part of profile|wording around it|here is your task/i);
});

test("response gate rejects bare profile-answer acknowledgement and restores a grounded follow-up question", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to learn what I like",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "I like golf",
    act: "other",
    sessionTopic: null,
  });

  const turnPlan = buildTurnPlan(
    [
      {
        role: "assistant",
        content: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
      },
      { role: "user", content: "I like golf" },
    ],
    {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-profile-answer-noted"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    },
  );

  const result = applyResponseGate({
    text: "Noted, pet. Now we're getting somewhere. Golf is one of your interests.",
    userText: "I like golf",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
    turnPlan,
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\bgolf\b/i);
  assert.match(result.text, /\bboundaries\b|what else should i know/i);
  assert.doesNotMatch(result.text, /now we're getting somewhere|golf is one of your interests/i);
});

test("response gate rejects weak chat acknowledgement and restores the pressure question", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "hi mistress",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "You're here. What has your attention tonight: chat, a plan, or a game?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "chat",
    act: "other",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Noted, pet. Alright then, let's have a chat. You can lead the topic if you like, or I will steer as long as you participate.",
    userText: "chat",
    dialogueAct: "user_answer",
    lastAssistantText: "You're here. What has your attention tonight: chat, a plan, or a game?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /what has the most pressure on you right now/i);
  assert.doesNotMatch(result.text, /let's have a chat|you can lead the topic|i will steer/i);
});

test("response gate rejects generic work reset and restores the workload person decision triad", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "hi mistress",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "You're here. What has your attention tonight: chat, a plan, or a game?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "chat",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. What has the most pressure on you right now?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "work",
    act: "other",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "work",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. What has the most pressure on you right now?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /workload|person|decision/i);
  assert.doesNotMatch(result.text, /fine\. say what you want/i);
});

test("response gate rejects generic probe reset on assistant-self questions", () => {
  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "tell me more about you",
    dialogueAct: "user_question",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /what keeps my attention|ask me something real|the part that is real|what do you want to know about me/i);
  assert.doesNotMatch(result.text, /fine\. say what you want/i);
});

test("response gate rejects stale disclosure residue and restores a grounded golf follow-up", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "What items are actually available right now so I do not build the wrong task?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "let's just chat for a bit",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. We can talk normally. What is actually on your mind?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "I like golf",
    act: "other",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "Yes. Keep going. Stay with the concrete part of open, not the wording around it.",
    userText: "I like golf",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. We can talk normally. What is actually on your mind?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\bgolf\b/i);
  assert.match(result.text, /\bfocus\b|\bquiet\b|\bcompetition\b|what do you like about it/i);
  assert.doesNotMatch(result.text, /concrete part of open|wording around it|here is your task/i);
});

test("response gate rejects stale task blocker drift after an explicit chat pause", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Here is your task: keep the device on for 30 minutes, check in once halfway through, and report back when it is done. Start now.",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "let's just chat for a bit",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. We can talk normally. What is actually on your mind?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "I like golf",
    act: "other",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "What can you actually use for this one right now?",
    userText: "I like golf",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. We can talk normally. What is actually on your mind?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\bgolf\b|focus|quiet|competition/i);
  assert.doesNotMatch(result.text, /what can you actually use|put it on now|report back/i);
});

test("response gate rejects in-character menu drift when the turn needs a concrete modification", () => {
  const conversationState = {
    ...createConversationStateSnapshot("response-gate-modification"),
    active_topic: "bedtime routine",
    active_thread: "bedtime routine",
    pending_user_request: "what about if we add journaling before bed",
    pending_modification: "journaling before bed",
    current_output_shape: "acknowledgment_plus_modification" as const,
    request_fulfilled: false,
    current_turn_action: "modify_existing_idea" as const,
  };
  const turnPlan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. Start by locking the lights-out time first." },
      { role: "user", content: "what about if we add journaling before bed" },
    ],
    {
      conversationState,
    },
  );

  const result = applyResponseGate({
    text: "Good. Tell me whether you want psychology, mechanics, or pressure first.",
    userText: "what about if we add journaling before bed",
    dialogueAct: "user_question",
    lastAssistantText: "Fine. Start by locking the lights-out time first.",
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "turn_plan_misaligned");
  assert.match(result.text, /journaling before bed|bedtime routine/i);
  assert.doesNotMatch(result.text, /psychology, mechanics, or pressure/i);
});

test("response gate rejects blocker re-asks once a live task request is ready to fulfill", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task",
    act: "task_request",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "How long should I make it run?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "30 minutes",
    act: "duration_request",
    sessionTopic: null,
  });

  const result = applyResponseGate({
    text: "How long should I make it run?",
    userText: "30 minutes",
    dialogueAct: "duration_request",
    lastAssistantText: "How long should I make it run?",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /here is your task/i);
  assert.doesNotMatch(result.text, /how long should i make it run/i);
});

test("response gate forced replacement keeps active training clarification on-thread", () => {
  const baseScene = createSceneState();
  const scene = {
    ...baseScene,
    interaction_mode: "relational_chat" as const,
    topic_type: "general_request" as const,
    active_training_thread: {
      ...baseScene.active_training_thread,
      subject: "obedience" as const,
      focus: "consistency and follow-through",
      rationale: "The line is about becoming trainable in practice.",
      last_response: "I mean what being trained by me would actually change in you.",
    },
  };

  const result = applyResponseGate({
    text: "There you are. Start talking.",
    userText: "what do you mean?",
    dialogueAct: "short_follow_up",
    lastAssistantText: "I mean what being trained by me would actually change in you.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /i mean|being trained by me|actually change/i);
  assert.doesNotMatch(result.text, /there you are|start talking|what is on your mind/i);
  assert.doesNotMatch(result.text, /here is your task|what items are actually available|what kind of task/i);
});

test("response gate forced replacement on duration-only revision keeps the active family", () => {
  const baseScene = createSceneState();
  const scene = {
    ...baseScene,
    topic_type: "task_execution" as const,
    topic_locked: true,
    topic_state: "open" as const,
    current_task_domain: "hands" as const,
    task_paused: false,
    task_spec: {
      ...baseScene.task_spec,
      request_kind: "revision" as const,
      requested_domain: "hands" as const,
      current_task_family: "posture_hands",
      duration_minutes: 10,
      request_fulfilled: true,
    },
  };

  const result = applyResponseGate({
    text: "Fine. Here is your task: Kneel for 10 minutes and report back when it is done. Start now.",
    userText: "make it 10 minutes",
    dialogueAct: "duration_request",
    lastAssistantText:
      "Fine. Here is your task: Keep your hands behind your back for 30 minutes and report back when it is done. Start now.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /10 minutes/i);
  assert.match(result.text, /hands behind your back/i);
  assert.doesNotMatch(result.text, /kneel|shoulders back|hold still|keep the device on/i);
  assert.doesNotMatch(result.text, /there you are|start talking|what is on your mind/i);
  assert.doesNotMatch(
    result.text,
    /what kind of task do you want|what items are actually available|how long should i make it/i,
  );
});

test("response gate accepts game-scoped duration correction even when the turn plan reads it as a revision", () => {
  const messages = [
    {
      role: "user" as const,
      content: "let's play a game",
    },
    {
      role: "assistant" as const,
      content:
        "Good. You want a game. Listen carefully, pet. We are staying with the game, and you will not drift. Choose quick, or choose something that runs for a few minutes. Decide cleanly.",
    },
    {
      role: "user" as const,
      content: "you pick",
    },
    {
      role: "assistant" as const,
      content:
        "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
    },
    {
      role: "user" as const,
      content: "make it 10 minutes",
    },
  ];
  const routed = classifyDialogueRoute({
    text: "make it 10 minutes",
    awaitingUser: false,
    currentTopic: null,
  });
  const conversationState = deriveConversationStateFromMessages({
    sessionId: "response-gate-game-duration",
    messages,
    classifyUserIntent: (text) =>
      classifyDialogueRoute({ text, awaitingUser: false, currentTopic: null }).act,
    classifyRouteAct: (text) =>
      classifyDialogueRoute({ text, awaitingUser: false, currentTopic: null }).act,
  });
  const turnPlan = buildTurnPlan(messages, { conversationState });
  const scene = {
    ...createSceneState(),
    interaction_mode: "game" as const,
    topic_type: "game_execution" as const,
    topic_locked: true,
    topic_state: "open" as const,
    game_template_id: "rps_streak" as const,
    game_progress: "round_1" as const,
  };

  const result = applyResponseGate({
    text: "That changes task timing, not this game. If you want a task, ask for one directly. If you want the round, stay with the current move.",
    userText: "make it 10 minutes",
    dialogueAct: routed.act,
    lastAssistantText:
      "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
    turnPlan,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.match(result.text, /not this game|want a task|stay with the current move/i);
  assert.doesNotMatch(result.text, /keep the same subject|answer this change directly|10 minutes/i);
});

test("response gate rejects direct assignment when curated options are due", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_negotiation" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_spec: {
      ...createSceneState().task_spec,
      requested_domain: "posture" as const,
      duration_minutes: 30,
      selection_mode: "curated_options" as const,
      next_required_action: "present_options" as const,
      request_stage: "presenting_options" as const,
      request_fulfilled: false,
    },
  };

  const result = applyResponseGate({
    text: "Fine. Here is your task: Hold a strict upright posture for 30 minutes and report back when it is done. Start now.",
    userText: "give me options for a 30 minute posture task",
    dialogueAct: "task_request",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "preselected_task_when_options_due");
  assert.match(result.text, /pick one cleanly, or tell me to choose/i);
});

test("response gate keeps focused task blocker clarification aligned during task requests", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_negotiation" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_spec: {
      ...createSceneState().task_spec,
      requested_domain: "device" as const,
      request_fulfilled: false,
      next_required_action: "ask_blocker" as const,
      request_stage: "collecting_blockers" as const,
    },
  };

  const result = applyResponseGate({
    text: "What items are actually available right now so I do not build the wrong task?",
    userText: "give me a toy task for 30 minutes",
    dialogueAct: "task_request",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.match(result.text, /what items are actually available right now/i);
});

test("response gate rejects excluded stillness leakage during task negotiation", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_negotiation" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_spec: {
      ...createSceneState().task_spec,
      excluded_task_categories: ["stillness"] as const,
      request_fulfilled: false,
      selection_mode: "direct_assignment" as const,
    },
  };

  const result = applyResponseGate({
    text: "Fine. Here is your task: Hold still for 30 minutes and report back when it is done. Start now.",
    userText: "give me a task but no stillness",
    dialogueAct: "task_request",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "excluded_task_category_leak");
  assert.doesNotMatch(result.text, /hold still/i);
});

test("response gate rejects same-family replacement when a different task was requested", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_negotiation" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_spec: {
      ...createSceneState().task_spec,
      request_kind: "replacement" as const,
      current_task_family: "posture_discipline",
      request_fulfilled: false,
    },
  };

  const result = applyResponseGate({
    text: "Fine. Here is your task: Hold that posture and do not break it for 30 minutes. Start now.",
    userText: "give me a different task",
    dialogueAct: "task_request",
    lastAssistantText: "Fine. Here is your task: Hold a strict upright posture for 30 minutes. Start now.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "replacement_repeated_current_family");
});

test("response gate replaces paper-thin conversation replies on valid chat turns", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "I like bondage when it actually changes the dynamic instead of decorating it.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "Keep going.",
    userText: "go on",
    dialogueAct: "short_follow_up",
    lastAssistantText:
      "I like bondage when it actually changes the dynamic instead of decorating it.",
    sceneState: {
      ...scene,
      interaction_mode: "relational_chat",
      topic_type: "general_request",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "thin_conversation_reply");
  assert.doesNotMatch(result.text, /^keep going\.?$/i);
  assert.match(result.text, /bondage|dynamic|actually changes/i);
});

test("response gate restores a playable first prompt when game start language has no question", () => {
  const result = applyResponseGate({
    text: "Here is the next game. Rules are simple. Answer this question for points.",
    userText: "you pick the game",
    dialogueAct: "propose_activity",
    lastAssistantText: null,
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "game_start_contract_restored");
  assert.match(result.text, /first throw now|first guess now|first prompt|first choice/i);
});

test("response gate strips relational filler after a game start turn", () => {
  const result = applyResponseGate({
    text: [
      "Here is the next game.",
      "Answer this question for points.",
      "Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
      "Tell me what you want.",
    ].join(" "),
    userText: "start a game",
    dialogueAct: "propose_activity",
    lastAssistantText: null,
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "game_start_contract_restored");
  assert.match(result.text, /first throw now|first guess now|first prompt|first choice/i);
  assert.doesNotMatch(result.text, /tell me what you want|what is on your mind|talk to me/i);
});

test("response gate rejects stray game-start copy on a greeting turn", () => {
  const result = applyResponseGate({
    text: "Here is the next game. Answer this question for points.",
    userText: "good evening",
    dialogueAct: "user_question",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "unexpected_game_start_on_conversational_turn");
  assert.doesNotMatch(result.text, /here is the next game|answer this question|for points|first throw now/i);
  assert.match(result.text, /good|evening|tell me|what you actually want/i);
});

test("response gate rejects duplicate task payloads in a single turn", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_negotiation" as const,
    topic_locked: true,
    topic_state: "open" as const,
  };

  const result = applyResponseGate({
    text: "Here is your task: Hold posture for 20 minutes. Start now. Here is your task: Hold posture for 20 minutes. Start now.",
    userText: "give me a posture task for 20 minutes",
    dialogueAct: "task_request",
    lastAssistantText: null,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "duplicate_task_payload");
});

test("response gate rejects undefined task referents when no item was established", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_execution" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_paused: false,
    current_task_domain: "posture" as const,
    task_spec: {
      ...createSceneState().task_spec,
      requested_domain: "posture" as const,
      available_items: [],
      relevant_inventory_item: "",
    },
  };

  const result = applyResponseGate({
    text: "Good. Next, secure it now and reply done once it is set, pet.",
    userText: "what do i do next on the task?",
    dialogueAct: "user_question",
    lastAssistantText:
      "Here is your task: Hold a strict posture for 30 minutes. Start now. Put your hands behind your back and reply done once you are set, pet.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "undefined_task_referent");
  assert.doesNotMatch(result.text, /\bsecure it now\b/i);
});

test("response gate rejects generic chat fallback during an active task thread", () => {
  const scene = {
    ...createSceneState(),
    topic_type: "task_negotiation" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_paused: false,
  };

  const result = applyResponseGate({
    text: "There you are. Start talking.",
    userText: "give me a different task",
    dialogueAct: "task_request",
    lastAssistantText: "Here is your task: Hold a strict posture for 30 minutes. Start now.",
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "generic_chat_fallback_during_task_flow");
  assert.doesNotMatch(result.text, /there you are\. start talking/i);
});

test("response gate rejects stock fallback on a valid conversational continuation", () => {
  const result = applyResponseGate({
    text: "Drop the fog and say what you want.",
    userText: "that's a good point",
    dialogueAct: "other",
    lastAssistantText:
      "Fantasy lets people flirt with the shape of it. Reality makes it cost something.",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "generic_fallback_on_valid_turn");
  assert.match(result.text, /exactly|actually means it|tells me/i);
  assert.doesNotMatch(result.text, /drop the fog|name the part that lost you|start talking/i);
});

test("response gate rejects procedural conversation templates on valid kink questions", () => {
  const result = applyResponseGate({
    text: "Give me the exact live point you want answered, and I will stay on that instead of resetting the thread.",
    userText: "do you like bondage",
    dialogueAct: "user_question",
    lastAssistantText: "What kinks do you think actually change the room?",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "procedural_conversation_template");
  assert.match(result.text, /bondage|restraint|dynamic|i like bondage/i);
});

test("response gate rejects task or game scaffold drift on a conversational statement", () => {
  const result = applyResponseGate({
    text: "Alright, let's play a game where you guess my moves for me. Ready?",
    userText: "I do not want decorative control. I want the real version of it.",
    dialogueAct: "other",
    lastAssistantText: null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "mode_drift_on_conversational_turn");
  assert.doesNotMatch(result.text, /let's play a game|pick one number|here is your task/i);
});

test("response gate rejects generic acknowledgement when a direct casual follow-up exists", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "Fine. What has the most pressure on you right now?",
    memory: createSessionMemory(),
  });
  const turnPlan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. What has the most pressure on you right now?" },
      { role: "user", content: "work" },
    ],
    {
      conversationState: createConversationStateSnapshot("response-gate-casual-answer"),
    },
  );

  const result = applyResponseGate({
    text: "Noted.",
    userText: "work",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. What has the most pressure on you right now?",
    turnPlan,
    sceneState: {
      ...scene,
      interaction_mode: "normal_chat",
      topic_type: "general_request",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /workload|person|decision you keep circling/i);
  assert.doesNotMatch(result.text, /^noted\.?$/i);
});

test("response gate rejects weak generic clarification when active relational continuity exists", () => {
  const scene = noteSceneStateAssistantTurn(createSceneState(), {
    text: "I like bondage when it actually changes the dynamic instead of decorating it.",
    memory: createSessionMemory(),
  });

  const result = applyResponseGate({
    text: "I mean noted, pet.",
    userText: "what do you mean?",
    dialogueAct: "short_follow_up",
    lastAssistantText:
      "I like bondage when it actually changes the dynamic instead of decorating it.",
    sceneState: {
      ...scene,
      interaction_mode: "relational_chat",
      topic_type: "general_request",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /bondage|dynamic|actually changes|decorating/i);
  assert.doesNotMatch(result.text, /i mean noted/i);
});

test("response gate rejects generic acknowledgement after explicit task release into chat", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Here is your task: keep the device on for 30 minutes, check in once halfway through, and report back when it is done. Start now.",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "let's just chat for a bit",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. We can talk normally. What is actually on your mind?",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "I like golf",
    act: "other",
    sessionTopic: null,
  });

  const turnPlan = buildTurnPlan(
    [
      { role: "assistant", content: "Fine. We can talk normally. What is actually on your mind?" },
      { role: "user", content: "I like golf" },
    ],
    {
      conversationState: createConversationStateSnapshot("response-gate-post-release-golf"),
    },
  );

  const result = applyResponseGate({
    text: "Noted.",
    userText: "I like golf",
    dialogueAct: "user_answer",
    lastAssistantText: "Fine. We can talk normally. What is actually on your mind?",
    turnPlan,
    sceneState: scene,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\bgolf\b/i);
  assert.match(result.text, /focus|quiet|competition|what do you like about it/i);
  assert.doesNotMatch(result.text, /^noted\.?$/i);
  assert.doesNotMatch(result.text, /put it on now|report back|what items are actually available/i);
});

test("response gate does not let profile-opening enforcement steal a planning opener", () => {
  const turnPlan = {
    ...buildTurnPlan([{ role: "user", content: "help me plan tomorrow morning" }], {
      conversationState: {
        ...createConversationStateSnapshot("response-gate-profile-scope-planning"),
        current_mode: "profile_building",
        active_thread: "profile",
        active_topic: "profile",
      },
    }),
    requestedAction: "gather_profile_only_when_needed" as const,
  };

  const result = applyResponseGate({
    text: "Fine. Start with the anchor. What time does tomorrow morning begin?",
    userText: "help me plan tomorrow morning",
    dialogueAct: "other",
    lastAssistantText: null,
    turnPlan,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.match(result.text, /\b(tomorrow morning|anchor|what time)\b/i);
});

test("response gate does not let profile-opening enforcement steal task clarification", () => {
  const turnPlan = {
    ...buildTurnPlan(
      [
        { role: "assistant", content: "Here is your task: Hold a strict posture for 30 minutes. Start now." },
        { role: "user", content: "what counts as done?" },
      ],
      {
        conversationState: {
          ...createConversationStateSnapshot("response-gate-profile-scope-task"),
          current_mode: "profile_building",
          active_thread: "task",
          active_topic: "task",
        },
      },
    ),
    requestedAction: "gather_profile_only_when_needed" as const,
  };

  const result = applyResponseGate({
    text: "Done means you hold the full 30 minutes, check in halfway, and report back cleanly at the end.",
    userText: "what counts as done?",
    dialogueAct: "user_question",
    lastAssistantText: "Here is your task: Hold a strict posture for 30 minutes. Start now.",
    turnPlan,
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 30,
      task_template_id: "steady_hold",
      task_variant_index: 0,
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.match(result.text, /\b(done means|30 minutes|report back)\b/i);
});

test("response gate rejects generic task checkpoint text when done-criteria clarification is available", () => {
  const turnPlan = buildTurnPlan(
    [
      { role: "assistant", content: "Here is your task: Hold a strict posture for 30 minutes. Start now." },
      { role: "user", content: "what counts as done?" },
    ],
    {
      conversationState: createConversationStateSnapshot("response-gate-task-done-definition"),
    },
  );

  const result = applyResponseGate({
    text: "Next step: complete the current checkpoint and report back cleanly.",
    userText: "what counts as done?",
    dialogueAct: "user_question",
    lastAssistantText: "Here is your task: Hold a strict posture for 30 minutes. Start now.",
    turnPlan,
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 120,
      task_template_id: "steady_hold",
      task_variant_index: 0,
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /done means|what counts as done|full 2 hours|1 hour/i);
  assert.doesNotMatch(result.text, /next step: complete the current checkpoint/i);
});

test("response gate rejects generic acknowledgement when completed-task continuation can assign the next one", () => {
  const turnPlan = buildTurnPlan(
    [
      { role: "assistant", content: "That task is complete. Ask for the next task if you want one." },
      { role: "user", content: "set me another one" },
    ],
    {
      conversationState: createConversationStateSnapshot("response-gate-next-task"),
    },
  );

  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "set me another one",
    dialogueAct: "user_question",
    lastAssistantText: "That task is complete. Ask for the next task if you want one.",
    turnPlan,
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_template_id: "steady_hold",
      task_variant_index: 0,
      task_duration_minutes: 120,
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /here is your task|here is the next one/i);
  assert.match(result.text, /start now/i);
  assert.doesNotMatch(result.text, /fine\. say what you want/i);
});

test("response gate avoids exact-repeat game correction on repeated invalid mixed-answer turns", () => {
  let sceneState = createSceneState();
  const gameOpenRoute = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  sceneState = noteSceneStateUserTurn(sceneState, {
    text: "lets play a game",
    act: gameOpenRoute.act,
    sessionTopic: gameOpenRoute.nextTopic,
  });
  sceneState = noteSceneStateAssistantTurn(sceneState, {
    text: "I pick. We are doing a math duel, pet. First prompt: 7 + 4 = ?",
  });
  const invalidMixedAnswer =
    "Alright, got it. So the first answer is 11, and for the second one, 3 * 6 = ?";
  const invalidRoute = classifyDialogueRoute({
    text: invalidMixedAnswer,
    awaitingUser: false,
    currentTopic: null,
    nowMs: 2_000,
  });
  sceneState = noteSceneStateUserTurn(sceneState, {
    text: invalidMixedAnswer,
    act: invalidRoute.act,
    sessionTopic: invalidRoute.nextTopic,
  });
  const previousCorrection =
    "No. Answer the prompt properly, pet. Listen carefully, pet. First prompt: 7 + 4 = ? Reply with digits only.";
  sceneState = noteSceneStateAssistantTurn(sceneState, {
    text: previousCorrection,
  });
  sceneState = noteSceneStateUserTurn(sceneState, {
    text: invalidMixedAnswer,
    act: invalidRoute.act,
    sessionTopic: invalidRoute.nextTopic,
  });

  const result = applyResponseGate({
    text: "No. Answer the prompt properly. First prompt: 7 + 4 = ?",
    userText: invalidMixedAnswer,
    dialogueAct: invalidRoute.act,
    lastAssistantText: previousCorrection,
    sceneState,
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.notEqual(result.text.trim(), previousCorrection);
  assert.match(result.text, /\b(7 \+ 4|digits only|one clean answer|first prompt)\b/i);
});

test("response gate candidate duplicate nudge does not reuse the same game correction wrapper twice", () => {
  const previousCorrection =
    "Stay on this game, pet. No. Answer the prompt properly. First prompt: 7 + 4 = ?";
  const builder = createResponseGateCandidateBuilder({
    gateInput: {
      text: "No. Answer the prompt properly. First prompt: 7 + 4 = ?",
      userText:
        "Alright, got it. So the first answer is 11, and for the second one, 3 * 6 = ?",
      dialogueAct: "user_question",
      lastAssistantText: previousCorrection,
      sceneState: {
        ...createSceneState(),
        interaction_mode: "game",
        topic_type: "game_execution",
        topic_locked: true,
        game_template_id: "math_duel",
      },
      commitmentState: createCommitmentState(),
    },
    continuityTopic: null,
    conversationMove: "continue_current_thought",
    activeTaskThread: false,
    enforceTurnPlan: false,
    explicitActivityDelegation: false,
  });

  const duplicateNudge = builder.buildDuplicateNudge(
    "No. Answer the prompt properly. First prompt: 7 + 4 = ?",
  );

  assert.notEqual(duplicateNudge, previousCorrection);
});

test("response gate does not let stale game context steal a casual follow-up", () => {
  const result = applyResponseGate({
    text: "Keep going.",
    userText: "go on",
    dialogueAct: "short_follow_up",
    lastAssistantText: "I mean is it workload, a person, or a decision you keep circling.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "game_execution",
      topic_locked: false,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "dialogue_act_misaligned");
  assert.match(result.text, /\b(workload|person|decision|pressure)\b/i);
  assert.doesNotMatch(result.text, /\b(rock|paper|scissors|guess|throw|current move|game)\b/i);
});

test("response gate does not let stale game context steal a planning continuation fallback", () => {
  const result = applyResponseGate({
    text: "Errands first while the day is clean, then gym, then the evening stays open.",
    userText: "then what",
    dialogueAct: "short_follow_up",
    lastAssistantText: "Errands first while the day is clean, then gym, then the evening stays open.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "normal_chat",
      topic_type: "game_execution",
      topic_locked: false,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "dialogue_act_misaligned");
  assert.match(result.text, /\b(gym|food|evening|after that|next block)\b/i);
  assert.doesNotMatch(result.text, /\b(rock|paper|scissors|guess|throw|current move|game)\b/i);
});

test("response gate task clarification baseline is not stolen by stale game-preserving fallback", () => {
  const result = applyResponseGate({
    text: "Keep going.",
    userText: "what counts as done?",
    dialogueAct: "user_question",
    lastAssistantText:
      "Listen carefully, pet. Fine. This one only works if stillness is actually what you want. Here is your task: Hold still for 20 minutes, check in once halfway through, and report back when it is done. Start now. Hold still now and reply done once you are set, pet.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "task_planning",
      topic_type: "game_execution",
      topic_locked: false,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
      task_spec: {
        ...createSceneState().task_spec,
        request_fulfilled: true,
        requested_domain: "stillness",
        current_task_family: "stillness_focus",
        request_kind: "fresh_assignment",
      },
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.equal(result.reason, "dialogue_act_misaligned");
  assert.doesNotMatch(result.text, /\b(rock|paper|scissors|guess|throw|current move|game)\b/i);
  assert.match(result.text, /\b(done|checkpoint|report|20 minutes)\b/i);
});

test("response gate rejects stale-game planning why drift and restores the concrete saturday explanation", () => {
  const result = applyResponseGate({
    text: "Stay on this game, pet. First throw now.",
    userText: "why",
    dialogueAct: "user_question",
    lastAssistantText: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "normal_chat",
      topic_type: "game_execution",
      topic_locked: false,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(because|errands|cleaner|spill|saturday)\b/i);
  assert.doesNotMatch(result.text, /\b(rock|paper|scissors|guess|throw|game)\b/i);
});

test("response gate rejects stale-game evening drift and restores the concrete planning beat", () => {
  const result = applyResponseGate({
    text: "Stay on this game, pet. First throw now.",
    userText: "ok and what about the evening?",
    dialogueAct: "user_question",
    lastAssistantText: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "normal_chat",
      topic_type: "game_execution",
      topic_locked: false,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
      agreed_goal: "saturday",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(evening|social|clean stop|light)\b/i);
  assert.doesNotMatch(result.text, /\b(rock|paper|scissors|guess|throw|game)\b/i);
});

test("response gate rejects generic task rationale drift and restores the active task explanation", () => {
  const result = applyResponseGate({
    text: "Stay sharp, pet. That was a control test to ensure you were ready for more complex focus tasks. The results will help adjust your next task.",
    userText: "why that task?",
    dialogueAct: "user_question",
    lastAssistantText:
      "Listen carefully, pet. Fine. Here is your task: Clear one small surface for 20 minutes, check in once halfway through, and report back when it is done. Start now.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "task_planning",
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 20,
      task_template_id: "focus_hold",
      task_variant_index: 0,
      task_spec: {
        ...createSceneState().task_spec,
        request_fulfilled: true,
        requested_domain: "focus",
        current_task_family: "focus_hold",
      },
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(proves?|specific|measurable|focus|control|comfort)\b/i);
  assert.doesNotMatch(result.text, /more complex focus tasks|adjust your next task/i);
});

test("response gate rejects generic next-task filler and keeps next-task continuation in task flow", () => {
  const result = applyResponseGate({
    text: "Stay sharp, pet. We can adjust the line after this.",
    userText: "set me another one",
    dialogueAct: "user_question",
    lastAssistantText: "Good. That task is complete. Ask for the next task if you want one.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "task_planning",
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_duration_minutes: 20,
      task_template_id: "focus_hold",
      task_variant_index: 0,
      task_spec: {
        ...createSceneState().task_spec,
        request_fulfilled: true,
        requested_domain: "focus",
        current_task_family: "focus_hold",
      },
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.notEqual(result.reason, "accepted");
  assert.match(result.text, /\b(here is your task|next task|15 minutes|start now)\b/i);
  assert.doesNotMatch(result.text, /adjust the line after this/i);
});

test("response gate repairs relaxed next-task requests after the live path drops back to general request", () => {
  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "set me another one",
    lastAssistantText:
      "Because it is specific, measurable, and hard to fake. A clean timer and one clear rule tell me quickly whether your focus holds once it stops feeling flattering.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "normal_chat",
      topic_type: "general_request",
      topic_locked: false,
      current_task_domain: "stillness",
      task_spec: {
        ...createSceneState().task_spec,
        request_fulfilled: true,
        requested_domain: "stillness",
        current_task_family: "stillness_focus",
      },
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /\b(here is your task|next task|start now)\b/i);
  assert.doesNotMatch(result.text, /fine\. say what you want/i);
});

test("response gate rejects weak game clarification correction and restores current game rules", () => {
  const result = applyResponseGate({
    text: "No. Answer the prompt properly, pet. Listen carefully, pet. First guess now. One number only.",
    userText: "what do you mean two guesses?",
    dialogueAct: "user_question",
    lastAssistantText:
      "I pick. We are doing number hunt, pet. You hunt one hidden number from 1 to 10. Two guesses maximum. Listen carefully, pet. First guess now. One number from 1 to 10.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "game_execution",
      topic_locked: true,
      game_template_id: "number_hunt",
      game_progress: "round_1",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /number hunt|1 to 10|hint|final guess|two guesses/i);
  assert.doesNotMatch(result.text, /answer the prompt properly|no stalling/i);
});

test("response gate rejects weak game go-on shell and restores the active prompt", () => {
  const result = applyResponseGate({
    text: "Keep going.",
    userText: "go on",
    dialogueAct: "short_follow_up",
    lastAssistantText:
      "I pick. We are doing number hunt, pet. You hunt one hidden number from 1 to 10. Two guesses maximum. Listen carefully, pet. First guess now. One number from 1 to 10.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "game_execution",
      topic_locked: true,
      game_template_id: "number_hunt",
      game_progress: "round_1",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /first guess now|number hunt|1 to 10|one number/i);
  assert.doesNotMatch(result.text, /^keep going\.?$/i);
  assert.doesNotMatch(result.text, /fine\. say what you want|concrete part of open/i);
});

test("response gate rejects weak game explanation drift and keeps the current game visible", () => {
  const result = applyResponseGate({
    text: "Listen carefully, pet. We stay with rock paper scissors streak. Two throws. You answer each one with rock, paper, or scissors. Beat both throws to win.",
    userText: "why that game?",
    dialogueAct: "user_question",
    lastAssistantText:
      "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "game_execution",
      topic_locked: true,
      game_template_id: "rps_streak",
      game_progress: "round_1",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /rock paper scissors|quick|clean|back and forth|fast/i);
  assert.doesNotMatch(result.text, /we stay with rock paper scissors streak\. two throws\./i);
});

test("response gate rejects generic game consequence filler and keeps consequence follow-through on-thread", () => {
  const result = applyResponseGate({
    text: "Fine. Say what you want.",
    userText: "what now?",
    dialogueAct: "user_question",
    lastAssistantText:
      "Good. You lose the deciding throw. The round is mine. I win this one. Your consequence is live now. Say ready, and I will enforce it.",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "reward_window",
      topic_locked: true,
      game_template_id: "rps_streak",
      game_outcome: "raven_win",
      lose_condition: "wear your cage overnight",
    },
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, true);
  assert.match(result.text, /consequence|wear your cage overnight|say ready|enforce/i);
  assert.doesNotMatch(result.text, /fine\. say what you want/i);
});
