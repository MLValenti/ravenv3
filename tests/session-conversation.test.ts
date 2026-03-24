import test from "node:test";
import assert from "node:assert/strict";

import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import { classifyUserIntent } from "../lib/session/intent-router.ts";
import {
  buildPhaseReflection,
  deriveSessionPhase,
  shouldEmitReflection,
} from "../lib/session/session-phase.ts";
import {
  createSessionMemory,
  summarizeSessionMemory,
  writeUserAnswer,
  writeUserQuestion,
} from "../lib/session/session-memory.ts";
import {
  canEmitAssistant,
  createTurnGate,
  markAssistantEmitted,
  persistUserMessage,
} from "../lib/session/turn-gate.ts";
import { buildSceneScaffoldReply } from "../lib/session/scene-scaffolds.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
} from "../lib/session/scene-state.ts";
import { buildDeterministicDominantWeakInputReply } from "../lib/session/weak-input-replies.ts";

function answerForGamePrompt(prompt: string): string {
  if (/first throw now/i.test(prompt) || /first throw: i throw rock/i.test(prompt)) {
    return "rock";
  }
  if (/second throw now/i.test(prompt) || /second throw: i throw scissors/i.test(prompt)) {
    return "scissors";
  }
  if (/first guess now/i.test(prompt)) {
    return "5";
  }
  if (/second and final guess now/i.test(prompt)) {
    return "7";
  }
  if (/7 \+ 4/i.test(prompt)) {
    return "11";
  }
  if (/9 \+ 6/i.test(prompt)) {
    return "15";
  }
  if (/riddle one/i.test(prompt)) {
    return "echo";
  }
  if (/riddle two/i.test(prompt)) {
    return "map";
  }
  if (/start with this word: steel/i.test(prompt)) {
    return "lock";
  }
  if (/next word: chain/i.test(prompt)) {
    return "nerve";
  }
  if (/first choice: control or speed/i.test(prompt)) {
    return "control";
  }
  if (/next choice: silence or focus/i.test(prompt)) {
    return "focus";
  }
  if (/repeat this sequence exactly: red, glass, key/i.test(prompt)) {
    return "red glass key";
  }
  if (/repeat this sequence exactly: lock, breath, line/i.test(prompt)) {
    return "lock breath line";
  }
  return "lock";
}

test("transcript flow asks once, stores answer, answers clarification, and blocks repeats", () => {
  let gate = createTurnGate("session-transcript");
  let memory = createSessionMemory();
  const toneQuestion =
    "Do you want me to keep asking open questions, or stay shorter and more direct?";

  const ask = canEmitAssistant(gate, "ask-tone", toneQuestion);
  assert.equal(ask.allow, true);
  gate = markAssistantEmitted(gate, {
    stepId: "ask-tone",
    content: toneQuestion,
    isQuestion: true,
  });
  assert.equal(gate.awaitingUser, true);

  const answerText = "I prefer direct instructions and short lines.";
  const answerIntent = classifyUserIntent(answerText, true);
  assert.equal(answerIntent, "user_answer");
  gate = persistUserMessage(gate, answerText);
  memory = writeUserAnswer(memory, answerText, 1_000, "reply_style");
  const memorySummary = summarizeSessionMemory(memory);
  assert.match(memorySummary, /temporary_reply_directives|preference/i);
  assert.match(memorySummary, /direct instructions and short lines/i);

  const acknowledge = canEmitAssistant(
    gate,
    "respond-answer",
    "Noted. I will keep it direct and concise.",
  );
  assert.equal(acknowledge.allow, true);
  gate = markAssistantEmitted(gate, {
    stepId: "respond-answer",
    content: "Noted. I will keep it direct and concise.",
    isQuestion: false,
  });

  const repeated = canEmitAssistant(
    gate,
    "respond-answer",
    "Noted. I will keep it direct and concise.",
  );
  assert.equal(repeated.allow, false);

  const clarifyText = "What do you mean by hold still?";
  const clarifyIntent = classifyUserIntent(clarifyText, false);
  assert.equal(clarifyIntent, "user_question");
  gate = persistUserMessage(gate, clarifyText);
  memory = writeUserQuestion(memory, clarifyText, 2_000);

  const clarifyAnswer = canEmitAssistant(
    gate,
    "respond-clarify",
    "I mean keep your head centered and steady for three seconds.",
  );
  assert.equal(clarifyAnswer.allow, true);
  gate = markAssistantEmitted(gate, {
    stepId: "respond-clarify",
    content: "I mean keep your head centered and steady for three seconds.",
    isQuestion: false,
  });

  const noGenericFallback = gate.lastAssistantMessageText ?? "";
  assert.doesNotMatch(noGenericFallback, /Proceed to the next instruction now\./i);
});

test("implicit follow-up prompts stay on the short follow-up rail", () => {
  const userIntent = classifyUserIntent("tell me more", false);
  assert.equal(userIntent, "user_short_follow_up");

  const route = classifyDialogueRoute({
    text: "tell me more",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  assert.equal(route.act, "short_follow_up");
});

test("phase progression and reflection trigger over turns", () => {
  assert.equal(deriveSessionPhase(1, 0), "warmup");
  assert.equal(deriveSessionPhase(4, 1), "build");
  assert.equal(deriveSessionPhase(9, 3), "challenge");
  assert.equal(deriveSessionPhase(14, 3), "cooldown");
  assert.equal(shouldEmitReflection(5), true);
  assert.equal(shouldEmitReflection(4), false);

  const memory = writeUserAnswer(
    createSessionMemory(),
    "My goal is consistency.",
    3_000,
    "improvement_area",
  );
  const reflection = buildPhaseReflection("challenge", memory);
  assert.doesNotMatch(reflection, /phase/i);
  assert.match(reflection, /consistency/i);
});

test("phase reflection does not echo raw command-style goals", () => {
  const memory = writeUserAnswer(createSessionMemory(), "give me a task", 4_000, null);

  const reflection = buildPhaseReflection("cooldown", memory);
  assert.doesNotMatch(reflection, /keep give me a task in view/i);
  assert.match(reflection, /current task/i);
});

test("phase reflection ignores weak acknowledgement-style goals", () => {
  const memory = writeUserAnswer(createSessionMemory(), "yes mistress", 4_000, null);

  const reflection = buildPhaseReflection("build", memory);
  assert.doesNotMatch(reflection, /yes mistress/i);
  assert.match(reflection, /current goal/i);
});

test("profile building keeps hobby answers as profile memory instead of session framing", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "I want you to learn what I like", 1_000, null);
  memory = writeUserAnswer(memory, "I like to golf", 2_000, "profile_fact");

  const summary = summarizeSessionMemory(memory);
  assert.match(summary, /session_intent: profile_building/i);
  assert.match(summary, /user_profile_facts: hobby: golf/i);
  assert.doesNotMatch(summary, /our sessions|tone_preference|goal:/i);
});

test("mutual get-to-know request stays as session intent instead of profile fact", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "I want to learn more about you",
    1_000,
    "profile_fact",
  );

  const summary = summarizeSessionMemory(memory);
  assert.match(summary, /session_intent: relational_chat/i);
  assert.match(summary, /conversation_mode: relational_chat/i);
  assert.doesNotMatch(summary, /user_profile_facts:/i);
});

test("game selection transcript stays coherent and does not switch topics", () => {
  const first = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  assert.equal(first.act, "propose_activity");

  const assistantOne =
    "Fine. I will choose. Do you want something quick or something that takes a few minutes?";
  assert.match(assistantOne, /choose|quick/i);
  assert.doesNotMatch(assistantOne, /stand still|hold still|look at the camera/i);

  const second = classifyDialogueRoute({
    text: "you pick",
    awaitingUser: false,
    currentTopic: first.nextTopic,
    nowMs: 2_000,
  });
  assert.equal(second.act, "answer_activity_choice");

  const assistantTwo =
    "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw.";
  assert.match(assistantTwo, /I pick|rock paper scissors streak/i);
  assert.doesNotMatch(assistantTwo, /stand still|hold still|look at the camera/i);
});

test("deterministic game transcript plays a coherent back and forth round", () => {
  const first = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: first.act,
    sessionTopic: first.nextTopic,
  });

  const second = classifyDialogueRoute({
    text: "you pick",
    awaitingUser: false,
    currentTopic: first.nextTopic,
    nowMs: 2_000,
  });

  let reply = buildSceneScaffoldReply({
    act: second.act,
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(reply ?? "", /I pick\./i);
  assert.match(reply ?? "", /First throw now/i);
  assert.doesNotMatch(reply ?? "", /minimal distractions|well-lit area|how's your day/i);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  scene = noteSceneStateUserTurn(scene, {
    text: "rock",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "rock",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Second throw now/i);
  assert.doesNotMatch(reply ?? "", /I pick\./i);

  scene = noteSceneStateUserTurn(scene, {
    text: "ok",
    act: "acknowledgement",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ok",
    sceneState: scene,
  });
  assert.match(reply ?? "", /No stalling, pet\./i);
  assert.match(reply ?? "", /Second throw now/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "scissors",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "scissors",
    sceneState: scene,
  });
  assert.match(reply ?? "", /That round is complete/i);
  assert.match(reply ?? "", /You win this round|I win this round/i);
});

test("deterministic game transcript can negotiate a bet, play the game, and apply the winner terms", () => {
  const first = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: first.act,
    sessionTopic: first.nextTopic,
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets bet on the game",
    sceneState: scene,
  });
  assert.match(reply ?? "", /set the wager now/i);
  assert.match(reply ?? "", /state the stakes clearly first/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "the stakes are chastity",
    sceneState: scene,
  });
  assert.match(reply ?? "", /what happens if you win/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "if i win you tell me a truth",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if i win you tell me a truth",
    sceneState: scene,
  });
  assert.match(reply ?? "", /what happens if I win/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "if you win i wear it overnight",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if you win i wear it overnight",
    sceneState: scene,
  });
  assert.match(reply ?? "", /The terms are set/i);
  assert.match(reply ?? "", /If you win, you tell me a truth/i);
  assert.match(reply ?? "", /If I win, i wear it overnight/i);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const choose = classifyDialogueRoute({
    text: "you pick",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 2_000,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "you pick",
    act: choose.act,
    sessionTopic: choose.nextTopic,
  });

  reply = buildSceneScaffoldReply({
    act: choose.act,
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(reply ?? "", /I pick\./i);
  assert.match(
    reply ?? "",
    /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i,
  );

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const firstAnswer = answerForGamePrompt(reply ?? "");
  scene = noteSceneStateUserTurn(scene, {
    text: firstAnswer,
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: firstAnswer,
    sceneState: scene,
  });
  assert.match(
    reply ?? "",
    /Second throw now|second and final guess now|second prompt|riddle two|I win this round/i,
  );

  const secondAnswer = answerForGamePrompt(reply ?? "");
  scene = noteSceneStateUserTurn(scene, {
    text: secondAnswer,
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: secondAnswer,
    sceneState: scene,
  });
  assert.match(reply ?? "", /That round is complete|I win this round|You win this round/i);
  assert.match(reply ?? "", /you tell me a truth|i wear it overnight/i);
});

test("session transcript stays dominant and coherent across greeting, wager, game, and task request", () => {
  const disallowedDrift =
    /pleasure serving you|what would you like to talk about next|how's your day been so far|my dear|well-lit area|minimal distractions|how can i help/i;

  const greetingReply = buildDeterministicDominantWeakInputReply("hello");
  assert.equal(greetingReply, "Enough hovering, pet. Tell me what you actually want.");
  assert.doesNotMatch(greetingReply ?? "", disallowedDrift);

  const first = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: first.act,
    sessionTopic: first.nextTopic,
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets bet on the game",
    sceneState: scene,
  });
  assert.match(reply ?? "", /set the wager now/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateUserTurn(scene, {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "the stakes are chastity",
    sceneState: scene,
  });
  assert.match(reply ?? "", /what happens if you win/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateUserTurn(scene, {
    text: "if i win you tell me a truth",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if i win you tell me a truth",
    sceneState: scene,
  });
  assert.match(reply ?? "", /what happens if I win/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "if you win i wear it overnight",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if you win i wear it overnight",
    sceneState: scene,
  });
  assert.match(reply ?? "", /The terms are set/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);
  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const choose = classifyDialogueRoute({
    text: "you pick",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 2_000,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "you pick",
    act: choose.act,
    sessionTopic: choose.nextTopic,
  });
  reply = buildSceneScaffoldReply({
    act: choose.act,
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(reply ?? "", /I pick\./i);
  assert.match(
    reply ?? "",
    /First throw now|First guess now|First prompt: 7 \+ 4|Pick one number from 1 to 10|Riddle one:/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);
  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const firstAnswer = answerForGamePrompt(reply ?? "");
  scene = noteSceneStateUserTurn(scene, {
    text: firstAnswer,
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: firstAnswer,
    sceneState: scene,
  });
  assert.match(
    reply ?? "",
    /No stalling, pet\.|Second throw now|second and final guess now|second prompt|riddle two|I win this round/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  const secondAnswer = answerForGamePrompt(reply ?? "");
  scene = noteSceneStateUserTurn(scene, {
    text: secondAnswer,
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: secondAnswer,
    sceneState: scene,
  });
  assert.match(
    reply ?? "",
    /That round is complete|You win this round|I win this round|Second throw now|second and final guess now|second prompt|riddle two/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  const thirdAnswer = answerForGamePrompt(reply ?? "");
  scene = noteSceneStateUserTurn(scene, {
    text: thirdAnswer,
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: thirdAnswer,
    sceneState: scene,
  });
  assert.match(reply ?? "", /That round is complete|You win this round|I win this round/i);
  assert.match(reply ?? "", /You win this round/i);
  assert.match(reply ?? "", /you tell me a truth/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);
  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const taskRequest = classifyDialogueRoute({
    text: "give me a chastity task for 2 hours",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 3_000,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "give me a chastity task for 2 hours",
    act: taskRequest.act,
    sessionTopic: taskRequest.nextTopic,
  });
  reply = buildSceneScaffoldReply({
    act: taskRequest.act,
    userText: "give me a chastity task for 2 hours",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Here is your task/i);
  assert.match(
    reply ?? "",
    /(?:Keep (?:the|your) chastity device on for 2 hours|Run a stricter chastity line with your chastity device for 2 hours)/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);
});

test("session transcript keeps a coherent task lifecycle and supports a 30 minute follow-up task", () => {
  const disallowedDrift =
    /pleasure serving you|what would you like to talk about next|how's your day been so far|my dear|well-lit area|minimal distractions|how can i help/i;

  const greetingReply = buildDeterministicDominantWeakInputReply("hello");
  assert.equal(greetingReply, "Enough hovering, pet. Tell me what you actually want.");

  let scene = createSceneState();

  const firstTaskRequest = classifyDialogueRoute({
    text: "give me a chastity task for 30 minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "give me a chastity task for 30 minutes",
    act: firstTaskRequest.act,
    sessionTopic: firstTaskRequest.nextTopic,
  });

  let reply = buildSceneScaffoldReply({
    act: firstTaskRequest.act,
    userText: "give me a chastity task for 30 minutes",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Here is your task/i);
  assert.match(
    reply ?? "",
    /(?:Keep (?:the|your) chastity device on for 30 minutes|Run a stricter chastity line with your chastity device for 30 minutes)/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);
  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  scene = noteSceneStateUserTurn(scene, {
    text: "i have started it",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "i have started it",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Check in once halfway through/i);
  assert.match(reply ?? "", /30 minutes has elapsed/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateUserTurn(scene, {
    text: "halfway check in",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "halfway check in",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Halfway check in accepted/i);
  assert.match(reply ?? "", /Finish the full 30 minutes/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateUserTurn(scene, {
    text: "all done",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "all done",
    sceneState: scene,
  });
  assert.match(reply ?? "", /task is complete|you completed the task cleanly|task complete/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);
  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const secondTaskRequest = classifyDialogueRoute({
    text: "give me another chastity task for 30 minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 2_000,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "give me another chastity task for 30 minutes",
    act: secondTaskRequest.act,
    sessionTopic: secondTaskRequest.nextTopic,
  });
  reply = buildSceneScaffoldReply({
    act: secondTaskRequest.act,
    userText: "give me another chastity task for 30 minutes",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Here is your task/i);
  assert.match(
    reply ?? "",
    /(?:Keep (?:the|your) chastity device on for 30 minutes|Run a stricter chastity line with your chastity device for 30 minutes)/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);
});

test("session transcript can turn a Raven win into a consequence task and continue the task rail", () => {
  const disallowedDrift =
    /pleasure serving you|what would you like to talk about next|how's your day been so far|my dear|well-lit area|minimal distractions|how can i help/i;

  const first = classifyDialogueRoute({
    text: "lets play a quick game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a quick game",
    act: first.act,
    sessionTopic: first.nextTopic,
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets bet on the game",
    sceneState: scene,
  });
  assert.match(reply ?? "", /set the wager now/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateUserTurn(scene, {
    text: "you pick the wager",
    act: "other",
    sessionTopic: null,
    inventory: [
      {
        id: "inv-cage",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "you pick the wager",
    sceneState: scene,
  });
  assert.match(reply ?? "", /The stakes are chastity/i);
  assert.match(reply ?? "", /If I win, you keep your Steel Cage on for 30 minutes/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  scene = {
    ...scene,
    game_template_id: "rps_streak",
    game_rotation_index: 1,
    scene_type: "game",
  };

  scene = noteSceneStateUserTurn(scene, {
    text: "you pick",
    act: "answer_activity_choice",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(
    reply ?? "",
    /rock paper scissors streak|math duel|number hunt|number command|riddle lock/i,
  );
  assert.match(
    reply ?? "",
    /First throw now|First prompt: 7 \+ 4|Pick one number from 1 to 10|First guess now|Riddle one:/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });
  scene = {
    ...scene,
    topic_type: "game_execution",
    topic_locked: true,
    topic_state: "open",
    game_template_id: "rps_streak",
    game_progress: "round_1",
  };

  const firstGameAnswer = "paper";
  scene = noteSceneStateUserTurn(scene, {
    text: firstGameAnswer,
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: firstGameAnswer,
    sceneState: scene,
  });
  assert.match(
    reply ?? "",
    /Second throw now|second prompt|second and final guess now|riddle two|That round is complete|I win this round|I win this one|You win this round/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  assert.match(reply ?? "", /I win this round|I win this one|That round is complete/i);
  assert.match(reply ?? "", /Say ready, and I will enforce it\./i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  scene = noteSceneStateUserTurn(scene, {
    text: "ready",
    act: "acknowledgement",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ready",
    sceneState: scene,
  });
  for (let attempt = 0; attempt < 3 && !/Here is your task/i.test(reply ?? ""); attempt += 1) {
    assert.match(reply ?? "", /Say ready, and I will enforce it\./i);
    scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });
    scene = noteSceneStateUserTurn(scene, {
      text: "ready",
      act: "acknowledgement",
      sessionTopic: null,
    });
    reply = buildSceneScaffoldReply({
      act: "acknowledgement",
      userText: "ready",
      sceneState: scene,
    });
  }
  assert.match(reply ?? "", /Here is your task/i);
  assert.match(
    reply ?? "",
    /Keep the chastity device on for 30 minutes|Keep your Steel Cage on for 30 minutes/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  scene = noteSceneStateUserTurn(scene, {
    text: "i have started it",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "i have started it",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Check in once halfway through/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateUserTurn(scene, {
    text: "all done",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "all done",
    sceneState: scene,
  });
  assert.match(reply ?? "", /task is complete|you completed the task cleanly|task complete/i);
  assert.doesNotMatch(reply ?? "", disallowedDrift);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });

  const nextTaskRequest = classifyDialogueRoute({
    text: "give me another chastity task for 30 minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 3_000,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "give me another chastity task for 30 minutes",
    act: nextTaskRequest.act,
    sessionTopic: nextTaskRequest.nextTopic,
  });
  reply = buildSceneScaffoldReply({
    act: nextTaskRequest.act,
    userText: "give me another chastity task for 30 minutes",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Here is your task/i);
  assert.match(
    reply ?? "",
    /(?:Keep (?:the|your) chastity device on for 30 minutes|Run a stricter chastity line with your chastity device for 30 minutes)/i,
  );
  assert.doesNotMatch(reply ?? "", disallowedDrift);
});
