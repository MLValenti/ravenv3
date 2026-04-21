import test from "node:test";
import assert from "node:assert/strict";

import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import { buildSceneScaffoldReply } from "../lib/session/scene-scaffolds.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
} from "../lib/session/scene-state.ts";
import { createSessionMemory, writeUserAnswer } from "../lib/session/session-memory.ts";

test("game setup scaffold chooses a game directly when the user says you pick", () => {
  const initialRoute = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: initialRoute.act,
    sessionTopic: initialRoute.nextTopic,
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "the stakes are chastity. if i win you unlock it. if you win i wear it overnight",
    act: "other",
    sessionTopic: initialRoute.nextTopic,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Good. The stakes are chastity. If you win, you unlock it. If I win, i wear it overnight. The terms are set.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "lets play a game",
    act: initialRoute.act,
    sessionTopic: initialRoute.nextTopic,
  });

  const followRoute = classifyDialogueRoute({
    text: "you pick",
    awaitingUser: false,
    currentTopic: initialRoute.nextTopic,
    nowMs: 2_000,
  });

  const reply = buildSceneScaffoldReply({
    act: followRoute.act,
    userText: "you pick",
    sceneState: scene,
  });

  assert.equal(typeof reply, "string");
  assert.match(reply ?? "", /I pick\./i);
  assert.match(
    reply ?? "",
    /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i,
  );
  assert.match(
    reply ?? "",
    /First throw now|First guess now|First prompt: 7 \+ 4|Pick one number from 1 to 10|Riddle one:/i,
  );
  assert.match(reply ?? "", /stakes are chastity/i);
});

test("game setup wager cue routes to stake negotiation instead of repeating game start", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  const startReply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: scene,
  });
  scene = noteSceneStateAssistantTurn(scene, { text: startReply ?? "" });

  const wagerReply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets bet on the game",
    sceneState: {
      ...scene,
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
    },
  });

  assert.equal(typeof wagerReply, "string");
  assert.match(wagerReply ?? "", /set the wager now|state the stakes|if you win|if i win/i);
  assert.doesNotMatch(wagerReply ?? "", /\bi pick\b|\bwe are doing\b/i);
});

test("game setup scaffold rotates to the next curated game on the next selection", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(reply ?? "", /rock paper scissors streak/i);
  assert.match(reply ?? "", /First throw now/i);

  scene = noteSceneStateAssistantTurn(scene, {
    text: reply ?? "",
  });

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

  scene = noteSceneStateAssistantTurn(scene, {
    text: reply ?? "",
  });

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

  scene = noteSceneStateAssistantTurn(scene, {
    text: reply ?? "",
  });

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

  scene = noteSceneStateAssistantTurn(scene, {
    text: reply ?? "",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "another round",
    act: "other",
    sessionTopic: null,
  });

  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "another round",
    sceneState: scene,
  });

  assert.match(reply ?? "", /I pick\.|Here is your task|Start now\./i);
});

test("game setup scaffold starts immediately on quick choice", () => {
  const initialRoute = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: initialRoute.act,
    sessionTopic: initialRoute.nextTopic,
  });

  const reply = buildSceneScaffoldReply({
    act: "propose_activity",
    userText: "quick",
    sceneState: scene,
  });

  assert.match(reply ?? "", /I pick\./i);
  assert.match(
    reply ?? "",
    /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i,
  );
  assert.match(
    reply ?? "",
    /First throw now|First guess now|First prompt: 7 \+ 4|Pick one number from 1 to 10|Riddle one:/i,
  );
});

test("game setup scaffold redirects unsupported named games", () => {
  const initialRoute = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: initialRoute.act,
    sessionTopic: initialRoute.nextTopic,
  });

  const reply = buildSceneScaffoldReply({
    act: "propose_activity",
    userText: "lets play chess",
    sceneState: scene,
  });

  assert.match(reply ?? "", /one of my games/i);
  assert.match(reply ?? "", /Choose quick|tell me to pick/i);
  assert.doesNotMatch(reply ?? "", /\bchess\b/i);
});

test("game setup scaffold redirects unsupported quiz proposals cleanly", () => {
  const initialRoute = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: initialRoute.act,
    sessionTopic: initialRoute.nextTopic,
  });

  const reply = buildSceneScaffoldReply({
    act: "propose_activity",
    userText: "how about a simple quiz about movies or animals",
    sceneState: scene,
  });

  assert.match(reply ?? "", /one of my games/i);
  assert.match(reply ?? "", /Choose quick|tell me to pick/i);
  assert.doesNotMatch(reply ?? "", /\bquiz\b/i);
});

test("game execution scaffold keeps the selected game on rails until the round completes", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "I pick. We are doing number hunt, pet.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "ready",
    act: "acknowledgement",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ready",
    sceneState: scene,
  });

  assert.match(reply ?? "", /First guess now/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "5",
    act: "other",
    sessionTopic: null,
  });

  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "5",
    sceneState: scene,
  });

  assert.match(reply ?? "", /Second and final guess now/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "7",
    act: "other",
    sessionTopic: null,
  });

  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "7",
    sceneState: scene,
  });

  assert.match(reply ?? "", /That round is complete/i);
  assert.match(reply ?? "", /You win this round/i);
  assert.match(reply ?? "", /You earn one free pass/i);
  assert.match(reply ?? "", /cancels one future consequence task/i);
  assert.match(reply ?? "", /Bank that protection/i);
  assert.match(reply ?? "", /call for another round/i);
});

test("game execution scaffold does not advance on passive acknowledgements once the first prompt is active", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "I pick. We are doing number hunt, pet.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "ready",
    act: "acknowledgement",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ready",
    sceneState: scene,
  });
  assert.match(reply ?? "", /First guess now/i);

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

  assert.match(reply ?? "", /First guess now/i);
  assert.doesNotMatch(reply ?? "", /Second and final guess now/i);
});

test("game execution scaffold can apply a Raven win outcome when that template resolves", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "focus",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "completed",
      game_outcome: "raven_win",
      lose_condition: "you wear it overnight",
    },
    profile: {
      preferred_style: "strict control",
      intensity: "high",
    },
    progress: {
      current_tier: "gold",
      free_pass_count: 0,
      last_completion_summary: null,
    },
  });

  assert.match(reply ?? "", /That round is complete/i);
  assert.match(reply ?? "", /I win this round/i);
  assert.match(reply ?? "", /you wear it overnight/i);
  assert.match(reply ?? "", /no protection banked/i);
  assert.match(reply ?? "", /consequence is live now/i);
  assert.match(reply ?? "", /Say ready, and I will enforce it\./i);
  assert.doesNotMatch(reply ?? "", /Here is your task/i);
});

test("game execution scaffold consumes a free pass and skips the consequence task once", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "focus",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "completed",
      game_outcome: "raven_win",
      game_reward_state: "free_pass_used",
      free_pass_count: 0,
      lose_condition: "you wear it overnight",
    },
  });

  assert.match(reply ?? "", /I win this round/i);
  assert.match(reply ?? "", /Your free pass is spent/i);
  assert.match(reply ?? "", /banked protection covered this round/i);
  assert.match(reply ?? "", /cancels this consequence task/i);
  assert.doesNotMatch(reply ?? "", /Here is your task/i);
});

test("reward window scaffold can enforce a Raven win consequence on the next beat", () => {
  const reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ready",
    sceneState: {
      ...createSceneState(),
      topic_type: "reward_window",
      topic_locked: true,
      topic_state: "open",
      game_outcome: "raven_win",
      lose_condition: "you wear it overnight",
    },
    profile: {
      preferred_style: "strict control",
      intensity: "high",
    },
    progress: {
      current_tier: "gold",
      free_pass_count: 0,
      last_completion_summary: null,
    },
  });

  assert.match(reply ?? "", /Here is your task/i);
  assert.match(reply ?? "", /Start now\./i);
});

test("reward window blocks another round until Raven win consequence is enforced", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "let's play the second round",
    sceneState: {
      ...createSceneState(),
      topic_type: "reward_window",
      topic_locked: true,
      topic_state: "open",
      game_outcome: "raven_win",
      lose_condition: "you wear it overnight",
    },
  });

  assert.match(reply ?? "", /round is over/i);
  assert.match(reply ?? "", /Say ready/i);
  assert.doesNotMatch(reply ?? "", /Here is your task/i);
});

test("reward window scaffold keeps the banked free pass on rails", () => {
  const reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "save it",
    sceneState: {
      ...createSceneState(),
      topic_type: "reward_window",
      topic_locked: true,
      topic_state: "open",
      game_reward_state: "free_pass_granted",
      free_pass_count: 1,
    },
  });

  assert.match(reply ?? "", /free pass stays banked/i);
  assert.match(reply ?? "", /Use it when I win the next round/i);
});

test("reward window scaffold can push another round harder for fast strict preferences", () => {
  const reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ok",
    sceneState: {
      ...createSceneState(),
      topic_type: "reward_window",
      topic_locked: true,
      topic_state: "open",
      game_reward_state: "free_pass_granted",
      free_pass_count: 1,
    },
    profile: {
      preferred_pace: "fast and sharp",
      preferred_style: "strict control",
      intensity: "high",
    },
    progress: {
      current_tier: "gold",
      free_pass_count: 1,
      last_completion_summary: "Game result: rps_streak. Winner: user_win. Points: +2.",
    },
  });

  assert.match(reply ?? "", /Press your advantage/i);
});

test("reward window scaffold applies explicit winner terms when no free pass is active", () => {
  const claimPrompt = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what do i win?",
    sceneState: {
      ...createSceneState(),
      topic_type: "reward_window",
      topic_locked: true,
      topic_state: "open",
      game_outcome: "user_win",
      game_reward_state: "none",
      win_condition: "you tell me a truth",
    },
  });

  assert.match(claimPrompt ?? "", /you won/i);
  assert.match(claimPrompt ?? "", /as agreed: you tell me a truth/i);
  assert.match(claimPrompt ?? "", /winner terms applied/i);

  const claimAccepted = buildSceneScaffoldReply({
    act: "other",
    userText: "tell me one truth now",
    sceneState: {
      ...createSceneState(),
      topic_type: "reward_window",
      topic_locked: true,
      topic_state: "open",
      game_outcome: "user_win",
      game_reward_state: "none",
      win_condition: "you set one request and I grant it",
    },
  });

  assert.match(claimAccepted ?? "", /Claim accepted:/i);
  assert.match(claimAccepted ?? "", /Winner terms applied/i);
});

test("reward window can hand off directly into another game setup", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "another round",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      scene_type: "game",
      game_template_id: "rps_streak",
      game_rotation_index: 1,
      game_reward_state: "free_pass_granted",
      free_pass_count: 1,
    },
  });

  assert.match(reply ?? "", /I pick\./i);
  assert.match(reply ?? "", /rock paper scissors streak/i);
});

test("game setup scaffold respects the already selected learned game template", () => {
  const reply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "number_hunt",
      game_rotation_index: 0,
    },
  });

  assert.match(reply ?? "", /number hunt/i);
  assert.doesNotMatch(reply ?? "", /word chain/i);
});

test("game setup scaffold keeps an explicitly chosen game after wager negotiation", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "ok lets start best of three",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      stakes: "chastity",
      win_condition: "you get one truth",
      lose_condition: "I pick the consequence",
      game_template_id: "rps_streak",
      game_rotation_index: 2,
    },
  });

  assert.match(reply ?? "", /rock paper scissors streak/i);
  assert.match(reply ?? "", /First throw now/i);
  assert.doesNotMatch(reply ?? "", /math duel/i);
});

test("game setup scaffold corrects an early claim to go first", () => {
  const reply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "I'll play a quick game of rock paper scissors and I'll go first.",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_rotation_index: 0,
    },
  });

  assert.match(reply ?? "", /I throw first/i);
  assert.match(reply ?? "", /rock paper scissors streak/i);
  assert.match(reply ?? "", /First throw now/i);
});

test("game scaffolds answer rules questions without changing the chosen game", () => {
  const setupReply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "how do we play?",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
    },
  });

  assert.match(setupReply ?? "", /quick games are rock paper scissors streak or number hunt/i);
  assert.match(setupReply ?? "", /if you want me to pick, say so directly/i);

  const executionReply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "i still don't know how to play",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
    },
  });

  assert.match(executionReply ?? "", /stay with rock paper scissors streak/i);
  assert.match(executionReply ?? "", /Beat both throws/i);
});

test("game scaffolds answer what now and start cues with the current deterministic prompt", () => {
  const nextReply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what now?",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "ready",
    },
  });

  assert.match(nextReply ?? "", /First throw now/i);

  const startReply = buildSceneScaffoldReply({
    act: "other",
    userText: "ok lets start",
    sceneState: {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_rotation_index: 1,
    },
  });

  assert.match(startReply ?? "", /I pick\./i);
  assert.match(startReply ?? "", /rock paper scissors streak/i);
  assert.match(startReply ?? "", /First throw now/i);
});

test("game scaffold plays a coherent back and forth round", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(reply ?? "", /rock paper scissors streak/i);
  assert.match(reply ?? "", /First throw now/i);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });
  assert.equal(scene.game_progress, "round_1");

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
  assert.match(reply ?? "", /No stalling, pet\.|Keep up, pet\./i);
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
});

test("number command game emits a dynamic instruction after the user picks a number", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a number game",
    act: "propose_activity",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: scene,
  });
  assert.match(reply ?? "", /number command/i);
  assert.match(reply ?? "", /Pick one number from 1 to 10/i);

  scene = noteSceneStateAssistantTurn(scene, {
    text: reply ?? "",
  });
  assert.equal(scene.topic_type, "game_execution");
  assert.equal(scene.game_template_id, "number_command");
  assert.equal(scene.game_progress, "round_1");

  scene = noteSceneStateUserTurn(scene, {
    text: "7",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(scene.game_progress, "round_2");
  assert.equal(scene.game_number_choice, 7);

  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "7",
    sceneState: scene,
    inventory: [
      {
        id: "item-cuffs",
        label: "Leather Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  assert.match(reply ?? "", /Number 7 locked/i);
  assert.match(reply ?? "", /Leather Cuffs/i);
  assert.match(reply ?? "", /report done|report failed/i);
});

test("number command can include a device action JSON block when an intiface item is available", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets do number command",
    act: "propose_activity",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "I pick. We are doing number command, pet. Listen carefully, pet. Pick one number from 1 to 10 now.",
  });
  assert.equal(scene.topic_type, "game_execution");
  assert.equal(scene.game_progress, "round_1");

  scene = noteSceneStateUserTurn(scene, {
    text: "3",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(scene.game_progress, "round_2");

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "3",
    sceneState: scene,
    deviceControlActive: true,
    inventory: [
      {
        id: "item-gush",
        label: "Lovense Gush",
        category: "device",
        available_this_session: true,
        intiface_controlled: true,
        linked_device_id: "0",
        notes: "connected device",
      },
    ],
  });

  assert.match(reply ?? "", /Lovense Gush/i);
  assert.match(reply ?? "", /```json/i);
  assert.match(reply ?? "", /"type":"device_command"/i);
  assert.match(reply ?? "", /"device_id":"0"/i);
  assert.match(reply ?? "", /"command":"vibrate"/i);
});

test("vague task request asks a clarifying question instead of assigning immediately", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a task",
    sceneState: scene,
  });

  assert.doesNotMatch(reply ?? "", /Here is your task/i);
  assert.match(reply ?? "", /\bwhat kind of task\b/i);
  assert.match(reply ?? "", /\bposture\b/i);
});

test("detailed task request generates a task without unnecessary clarification", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a 20 minute posture task with a halfway check in",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a 20 minute posture task with a halfway check in",
    sceneState: scene,
  });

  assert.match(reply ?? "", /Here is your task/i);
  assert.doesNotMatch(reply ?? "", /\bwhat kind of task\b/i);
  assert.doesNotMatch(reply ?? "", /\bhow long should i make it\b/i);
  assert.match(reply ?? "", /\b20 minutes\b/i);
});

test("device task request asks about available items when Raven needs them", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a device task",
    sceneState: scene,
  });

  assert.match(reply ?? "", /\bwhat items are actually available\b/i);
});

test("toy task request asks about available items when no item is established", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a toy task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a toy task for 30 minutes",
    sceneState: scene,
  });

  assert.match(reply ?? "", /\bwhat items are actually available\b/i);
  assert.doesNotMatch(reply ?? "", /\bhere is your task\b/i);
});

test("toy task request ignores stale available-items state and still asks for live clarification", () => {
  const scene = {
    ...noteSceneStateUserTurn(createSceneState(), {
      text: "give me a toy task for 30 minutes",
      act: "task_request",
      sessionTopic: null,
    }),
    task_spec: {
      ...createSceneState().task_spec,
      available_items: ["old device"],
      relevant_inventory_item: "",
    },
  };

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a toy task for 30 minutes",
    sceneState: scene,
    inventory: [],
  });

  assert.match(reply ?? "", /\bwhat items are actually available\b/i);
  assert.doesNotMatch(reply ?? "", /\bhere is your task\b|\bhold still\b/i);
});

test("explicit device task request with details stays in the device domain", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a 30 minute device task with a halfway check in and i have a steel cage",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a 30 minute device task with a halfway check in and i have a steel cage",
    sceneState: scene,
  });

  assert.match(reply ?? "", /Here is your task/i);
  assert.match(reply ?? "", /\bdevice\b|\bcage\b|\bput it on now\b/i);
  assert.doesNotMatch(reply ?? "", /\bhold still for 1 hour\b/i);
});

test("no valid device candidate triggers clarification instead of substitution", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a 30 minute device task with no device",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a 30 minute device task with no device",
    sceneState: scene,
  });

  assert.match(reply ?? "", /\byou asked for a device task\b|\bdrop that constraint\b/i);
  assert.doesNotMatch(reply ?? "", /Here is your task/i);
  assert.doesNotMatch(reply ?? "", /\bhold still\b|\bposture\b/i);
});

test("posture task request asks about duration when the request is still underspecified", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a posture task",
    sceneState: scene,
  });

  assert.match(reply ?? "", /\bhow long should i make it\b/i);
});

test("inventory scaffold can issue a session directive for an available chastity cage", () => {
  const reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ok lets start with my steel cage",
    sceneState: createSceneState(),
    inventory: [
      {
        id: "item-1",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "chastity cage",
      },
    ],
  });

  assert.match(reply ?? "", /Put your Steel Cage on now/i);
  assert.match(reply ?? "", /show me it is secure/i);
});

test("inventory scaffold can issue an item-specific directive when user mentions the item", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "my leather cuffs are ready",
    sceneState: createSceneState(),
    inventory: [
      {
        id: "item-2",
        label: "Leather Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
      {
        id: "item-3",
        label: "Blindfold",
        category: "clothing",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  assert.match(reply ?? "", /Put your Leather Cuffs on now/i);
  assert.match(reply ?? "", /wrists in frame/i);
});

test("task scaffold can assign a non-device quick task shape", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a quick task",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a quick task",
    sceneState: scene,
  });

  assert.match(reply ?? "", /Here is your task/i);
  assert.match(reply ?? "", /(15 minutes|30 minutes)/i);
  assert.doesNotMatch(reply ?? "", /Put it on now/i);
});

test("task scaffold can reflect requested repeats and daily schedule", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a chastity task for 2 hours, 3 times a day for 5 days",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a chastity task for 2 hours, 3 times a day for 5 days",
    sceneState: scene,
  });

  assert.match(reply ?? "", /chastity device/i);
  assert.match(reply ?? "", /3 times per day for 5 days/i);
});

test("new non-device task request replans when no hard lock is active", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task for 45 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a posture task for 45 minutes",
    sceneState: scene,
  });

  assert.equal(scene.user_requested_task_domain, "posture");
  assert.equal(scene.can_replan_task, true);
  assert.match(reply ?? "", /posture/i);
  assert.doesNotMatch(reply ?? "", /put it on now|chastity device|keep the device on/i);
});

test("hard-locked task execution acknowledges and defers an unrelated new task request", () => {
  const scene = noteSceneStateUserTurn(
    {
      ...createSceneState(),
      interaction_mode: "locked_task_execution",
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "assigned",
      task_template_id: "steady_hold",
      current_task_domain: "device",
      locked_task_domain: "device",
      task_hard_lock_active: true,
      next_expected_user_action: "secure it now and reply done once it is set",
      reason_for_lock: "Finish the current device task first.",
    },
    {
      text: "give me a posture task for 45 minutes",
      act: "task_request",
      sessionTopic: null,
    },
  );

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a posture task for 45 minutes",
    sceneState: scene,
  });

  assert.equal(scene.user_requested_task_domain, "posture");
  assert.equal(scene.can_replan_task, false);
  assert.match(reply ?? "", /heard the request for a posture task/i);
  assert.match(reply ?? "", /finish the current device task first/i);
  assert.doesNotMatch(reply ?? "", /^Start now\. Put it on now/i);
});

test("completed prior device task does not override a later posture task request", () => {
  const scene = noteSceneStateUserTurn(
    {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_template_id: "steady_hold",
      current_task_domain: "device",
      locked_task_domain: "device",
    },
    {
      text: "give me a posture task for 30 minutes",
      act: "task_request",
      sessionTopic: null,
    },
  );

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a posture task for 30 minutes",
    sceneState: scene,
  });

  assert.equal(scene.can_replan_task, true);
  assert.match(reply ?? "", /posture/i);
  assert.doesNotMatch(reply ?? "", /chastity device|put it on now|keep the device on/i);
});

test("task execution scaffold advances through secure, check in, and completion", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "done",
    act: "acknowledgement",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "done",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Check in once halfway through|halfway check in/i);

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
  assert.match(reply ?? "", /Halfway check in accepted|Halfway is cleared/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "all done",
    act: "acknowledgement",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "all done",
    sceneState: scene,
  });
  assert.match(reply ?? "", /The task is complete|What you do now is ask for a new task/i);
});

test("task execution question reply answers completion and new-task questions directly", () => {
  const completedReply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what do i do now?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
    },
  });

  assert.match(
    completedReply ?? "",
    /That task is complete|Report it complete now|set the next task/i,
  );

  const newTaskReply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "what do you have for me this time?",
    sceneState: createSceneState(),
  });

  assert.match(
    newTaskReply ?? "",
    /The last task is finished|Here is the next one|Here is your task/i,
  );
});

test("assigned task question reply acknowledges natural secure confirmation directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "the chastity device is securely fastened. what should i do next?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "assigned",
      task_duration_minutes: 30,
    },
  });

  assert.match(reply ?? "", /Good\. It is set\./i);
  assert.match(reply ?? "", /15 minutes/i);
  assert.match(reply ?? "", /30 minutes/i);
});

test("assigned task answers what counts as done directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what counts as done here?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "assigned",
      task_duration_minutes: 120,
      task_template_id: "steady_hold",
      task_variant_index: 1,
    },
  });

  assert.match(reply ?? "", /Done for this step means/i);
  assert.match(reply ?? "", /lock the device in place and reply done|secure the task and reply done/i);
  assert.match(reply ?? "", /1 hour/i);
  assert.match(reply ?? "", /2 hours/i);
});

test("task proof and rationale follow-ups stay on the task question rail even as short follow-ups", () => {
  const baseState = {
    ...createSceneState(),
    topic_type: "task_execution" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_progress: "assigned" as const,
    task_duration_minutes: 20,
    task_template_id: "device_endurance" as const,
    task_variant_index: 0,
  };

  const rationaleReply = buildSceneScaffoldReply({
    act: "short_follow_up",
    userText: "what would that prove?",
    sceneState: baseState,
  });
  assert.match(rationaleReply ?? "", /prove|control|pressure|sloppy|performative/i);
  assert.doesNotMatch(rationaleReply ?? "", /Next on the task/i);

  const proofReply = buildSceneScaffoldReply({
    act: "short_follow_up",
    userText: "do i need proof?",
    sceneState: baseState,
  });
  assert.match(proofReply ?? "", /midpoint|final report|20 minutes/i);
  assert.doesNotMatch(proofReply ?? "", /Next on the task/i);
});

test("task mixed-item follow-up stays on the active task instead of falling to generic chat", () => {
  const reply = buildSceneScaffoldReply({
    act: "short_follow_up",
    userText: "should i wear my cage while doing it?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "assigned",
      task_duration_minutes: 20,
      task_template_id: "device_endurance",
      task_variant_index: 0,
      task_spec: {
        ...createSceneState().task_spec,
        relevant_inventory_item: "silicone dildo",
      },
    },
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
      {
        id: "cage-1",
        label: "Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "steel chastity cage",
      },
    ],
  });

  assert.match(reply ?? "", /yes|cage|main task|denial|layered/i);
  assert.doesNotMatch(reply ?? "", /Talk to me|What is on your mind|Next on the task/i);
});

test("completed task what-now duration phrasing stays on the task rail", () => {
  const reply = buildSceneScaffoldReply({
    act: "duration_request",
    userText: "the 30 minutes are up. what should i do now?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_duration_minutes: 30,
    },
  });

  assert.match(reply ?? "", /That task is complete|set the next task/i);
  assert.doesNotMatch(reply ?? "", /For this round, 30 minutes|This round runs for 30 minutes/i);
});

test("completed task question can open a fresh next task directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what's the next thing you want me to do?",
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
  });

  assert.match(reply ?? "", /Here is your task|Here is the next one/i);
  assert.match(reply ?? "", /Start now\./i);
});

test("completed task what-now question opens a fresh next task directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what do i do now?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_template_id: "steady_hold",
      task_variant_index: 0,
      task_duration_minutes: 90,
    },
  });

  assert.match(reply ?? "", /That task is complete|Report it complete now|set the next task/i);
});

test("completed task polite new-task question opens a fresh next task directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "can i have a new task, please?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_template_id: "steady_hold",
      task_variant_index: 0,
      task_duration_minutes: 30,
    },
  });

  assert.match(reply ?? "", /Here is your task|Here is the next one/i);
  assert.match(reply ?? "", /Start now\./i);
});

test("completed task next-task wording beats duration reply", () => {
  const reply = buildSceneScaffoldReply({
    act: "duration_request",
    userText: "The 30 minutes are up. What's my next task?",
    sceneState: {
      ...createSceneState(),
      topic_locked: true,
      topic_type: "task_execution",
      scene_type: "challenge",
      task_progress: "completed",
      task_duration_minutes: 30,
      task_template_id: "steady_hold",
    },
  });

  assert.match(reply ?? "", /Here is the next one|Here is your task/i);
  assert.doesNotMatch(reply ?? "", /For this round|This round runs/i);
});

test("completed task handles what-do-i-need-to-do-now phrasing directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "I've completed the 30 minutes, what do I need to do now?",
    sceneState: {
      ...createSceneState(),
      topic_locked: true,
      topic_type: "task_execution",
      scene_type: "challenge",
      task_progress: "completed",
      task_duration_minutes: 30,
      task_template_id: "steady_hold",
    },
  });

  assert.match(reply ?? "", /That task is complete|set the next task/i);
});

test("reward negotiation with complete terms can hand off cleanly into game start", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "alright, let's begin",
    sceneState: {
      ...createSceneState(),
      topic_locked: true,
      topic_type: "reward_negotiation",
      scene_type: "game",
      stakes: "the round",
      win_condition: "you tell me a truth",
      lose_condition: "i pick the consequence",
      game_template_id: "rps_streak",
    },
  });

  assert.match(reply ?? "", /rock paper scissors streak/i);
  assert.match(reply ?? "", /First throw now/i);
});

test("completed task different-task phrasing opens a fresh next task directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "can you come up with something different for me to do?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_template_id: "steady_hold",
      task_variant_index: 0,
      task_duration_minutes: 30,
    },
  });

  assert.match(reply ?? "", /Here is your task|Here is the next one/i);
  assert.match(reply ?? "", /Start now\./i);
});

test("secured task question answers halfway timing directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what happens at halfway?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 30,
    },
  });

  assert.match(reply ?? "", /At halfway, give me one clean check in/i);
  assert.match(reply ?? "", /full 30 minutes/i);
});

test("secured task answers how long until halfway directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "how long until halfway?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 120,
      task_template_id: "steady_hold",
      task_variant_index: 1,
    },
  });

  assert.match(reply ?? "", /Halfway is at 1 hour/i);
  assert.match(reply ?? "", /check in/i);
});

test("secured task answers what counts as done directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what counts as done?",
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
  });

  assert.match(reply ?? "", /Done means/i);
  assert.match(reply ?? "", /full 2 hours/i);
  assert.match(reply ?? "", /1 hour/i);
});

test("halfway checked task answers final-step question without resetting the task", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what's the final step before I can consider this task complete?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "halfway_checked",
      task_duration_minutes: 30,
      task_template_id: "steady_hold",
    },
  });

  assert.match(reply ?? "", /already cleared halfway/i);
  assert.match(reply ?? "", /full 30 minutes/i);
  assert.doesNotMatch(reply ?? "", /secure the task now/i);
});

test("halfway checked task answers what counts as done directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what counts as done now?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "halfway_checked",
      task_duration_minutes: 120,
      task_template_id: "steady_hold",
    },
  });

  assert.match(reply ?? "", /Halfway already counts/i);
  assert.match(reply ?? "", /full 2 hours/i);
});

test("completed task handles set-me-another-one wording directly", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "set me another one",
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
  });

  assert.match(reply ?? "", /Here is your task|Here is the next one/i);
  assert.match(reply ?? "", /Start now\./i);
});

test("task scaffold asks one blocker then fulfills immediately when the blocker is answered", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task",
    act: "task_request",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a posture task",
    sceneState: scene,
  });
  assert.match(reply ?? "", /how long|time window|length/i);

  scene = noteSceneStateAssistantTurn(scene, { text: reply ?? "" });
  scene = noteSceneStateUserTurn(scene, {
    text: "30 minutes",
    act: "duration_request",
    sessionTopic: null,
  });

  reply = buildSceneScaffoldReply({
    act: "duration_request",
    userText: "30 minutes",
    sceneState: scene,
  });
  assert.match(reply ?? "", /here is your task/i);
  assert.match(reply ?? "", /30 minutes/i);
  assert.doesNotMatch(reply ?? "", /how long|time window|length/i);
});

test("task scaffold gives curated options when the user asks for input into task type", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me options for a 30 minute posture task",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me options for a 30 minute posture task",
    sceneState: scene,
  });

  assert.match(reply ?? "", /1\./i);
  assert.match(reply ?? "", /pick one cleanly, or tell me to choose/i);
  assert.doesNotMatch(reply ?? "", /here is your task/i);
});

test("different kind of task is treated as constrained replacement instead of the same family again", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. Here is your task: Hold a strict upright posture for 30 minutes, check in once halfway through, and report back when it is done. Start now.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "give me a different kind of task",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a different kind of task",
    sceneState: scene,
  });

  assert.doesNotMatch(reply ?? "", /strict upright posture/i);
  assert.match(reply ?? "", /hands behind your back|kneel|shoulders back|inspection|device/i);
});

test("duration-only revision keeps the active task family instead of rerolling it", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a hands task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Fine. Here is your task: Hold your hands behind your back for 30 minutes, check in once halfway through, and report back when it is done. Start now.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "make it 20 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "make it 20 minutes",
    sceneState: scene,
  });

  assert.match(reply ?? "", /20 minutes/i);
  assert.match(reply ?? "", /hands behind your back/i);
  assert.doesNotMatch(reply ?? "", /kneel|shoulders back|inspection|hold still/i);
});

test("excluded stillness does not leak into curated task options", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me 30 minute task options but no stillness",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me 30 minute task options but no stillness",
    sceneState: scene,
  });

  assert.doesNotMatch(reply ?? "", /stillness/i);
  assert.doesNotMatch(reply ?? "", /hold still|stillness hold/i);
});

test("task scaffold emits one task payload instead of duplicating the assignment block", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "give me a posture task for 30 minutes",
    sceneState: scene,
  });

  const taskMarkers = reply?.match(/\bhere is your task\b/gi) ?? [];
  assert.equal(taskMarkers.length, 1);
  assert.doesNotMatch(reply ?? "", /Fine\.\s+Fine\./i);
});

test("active task task_request phrasing is answered as task execution guidance, not a fresh assignment", () => {
  const reply = buildSceneScaffoldReply({
    act: "task_request",
    userText: "what do i do after the 30 minutes are up?",
    sceneState: {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 30,
    },
  });

  assert.doesNotMatch(reply ?? "", /Here is your task/i);
  assert.match(
    reply ?? "",
    /keep it secured and hold steady|full time is complete|keep it on|full 30 minutes is complete/i,
  );
});

test("duration scaffold answers directly", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "how long do i wear it",
    act: "duration_request",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "duration_request",
    userText: "how long do i wear it",
    sceneState: scene,
  });

  assert.equal(reply, "You will wear it for 2 hours.");
});

test("duration request during task execution answers directly instead of repeating the task follow up", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  const reply = buildSceneScaffoldReply({
    act: "duration_request",
    userText: "how long do i wear it",
    sceneState: scene,
  });

  assert.match(reply ?? "", /First secure it properly|hold it to 1 hour|full 120 minutes/i);
});

test("stakes question scaffold answers from stored stakes state", () => {
  let scene = createSceneState();
  scene = noteSceneStateUserTurn(scene, {
    text: "the stakes are chastity. if i win you unlock it. if you win i wear it overnight",
    act: "other",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "do you remember the stakes?",
    sceneState: scene,
  });

  assert.match(reply ?? "", /The stakes are chastity/i);
  assert.match(reply ?? "", /If you win, you unlock it/i);
  assert.match(reply ?? "", /If I win, i wear it overnight/i);
});

test("stakes scaffold asks only for the missing win and lose terms", () => {
  let scene = createSceneState();
  scene = noteSceneStateUserTurn(scene, {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "other",
    userText: "the stakes are chastity",
    sceneState: scene,
  });
  assert.match(reply ?? "", /what happens if you win/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "if i win you unlock it",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if i win you unlock it",
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
  assert.match(reply ?? "", /The stakes are chastity/i);
  assert.match(reply ?? "", /The terms are set/i);
});

test("wager request scaffold locks into direct stake negotiation", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets make a bet on the game",
    act: "other",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets make a bet on the game",
    sceneState: scene,
  });

  assert.match(reply ?? "", /set the wager now/i);
  assert.match(reply ?? "", /state the stakes clearly first/i);
});

test("wager scaffold confirms Raven-chosen terms when the user delegates the bet", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "you pick the wager",
    act: "other",
    sessionTopic: null,
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "you pick the wager",
    sceneState: scene,
  });

  assert.match(reply ?? "", /The stakes are chastity/i);
  assert.match(
    reply ?? "",
    /If you win, you set one request and I grant it|If you win, you get one truth from me|If you win, you choose the next round and I follow it|If you win, you bank one free pass/i,
  );
  assert.match(reply ?? "", /If I win, you keep your Steel Cage on for 30 minutes/i);
});

test("wager scaffold answers what Raven wants if she wins without repeating stake prompt", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "what do you want if you win",
    act: "user_question",
    sessionTopic: null,
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what do you want if you win",
    sceneState: scene,
  });

  assert.match(reply ?? "", /The stakes are chastity/i);
  assert.match(reply ?? "", /If you win, you set one request and I grant it/i);
  assert.match(reply ?? "", /If I win, you keep your Steel Cage on for 30 minutes/i);
  assert.doesNotMatch(reply ?? "", /state the stakes clearly first/i);
});

test("wager scaffold resolves mixed explicit and delegated wager terms without asking for stakes again", () => {
  const scene = noteSceneStateUserTurn(createSceneState(), {
    text: "if i win i want one truth from you, if you win you can pick",
    act: "other",
    sessionTopic: null,
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if i win i want one truth from you, if you win you can pick",
    sceneState: scene,
  });

  assert.match(reply ?? "", /The stakes are chastity/i);
  assert.match(reply ?? "", /If you win, you get one truth/i);
  assert.match(reply ?? "", /If I win, you keep your Steel Cage on for 30 minutes/i);
  assert.doesNotMatch(reply ?? "", /state the stakes clearly first/i);
});

test("game then bet request does not repeat the game choice", () => {
  let scene = createSceneState();
  scene = noteSceneStateUserTurn(scene, {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: {
      topic_type: "game_selection",
      topic_state: "open",
      summary: "resolve a game choice before changing topics",
      created_at: 1_000,
    },
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: {
      topic_type: "game_selection",
      topic_state: "open",
      summary: "resolve a game choice before changing topics",
      created_at: 1_000,
    },
  });

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets bet on the game",
    sceneState: scene,
  });

  assert.doesNotMatch(reply ?? "", /I pick\. We are doing a quick word chain/i);
  assert.match(reply ?? "", /set the wager now/i);
});

test("bet request during locked game execution switches to stakes negotiation text", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "lets bet on the game",
    sceneState: scene,
  });

  assert.doesNotMatch(reply ?? "", /\bword chain\b/i);
  assert.match(reply ?? "", /set the wager now|what happens if you win/i);
});

test("start cue after a resolved game scene reopens the next game immediately", () => {
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  scene = noteSceneStateAssistantTurn(scene, {
    text: "I pick. We are doing a rock paper scissors streak, pet. Two throws. Choose rock, paper, or scissors each throw.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "paper",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Keep up, pet. Second throw now. Choose rock, paper, or scissors.",
  });
  scene = noteSceneStateUserTurn(scene, {
    text: "rock",
    act: "other",
    sessionTopic: null,
  });
  scene = noteSceneStateAssistantTurn(scene, {
    text: "Good. You kept the pace sharp. That round is complete.",
  });

  scene = noteSceneStateUserTurn(scene, {
    text: "ok lets start",
    act: "acknowledgement",
    sessionTopic: null,
  });

  const reply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ok lets start",
    sceneState: scene,
  });

  assert.match(reply ?? "", /I pick\./i);
});

test("task terms scaffold asks only for the missing reward and consequence", () => {
  let scene = createSceneState();
  scene = noteSceneStateUserTurn(scene, {
    text: "reward is an extra free day",
    act: "other",
    sessionTopic: null,
  });

  let reply = buildSceneScaffoldReply({
    act: "other",
    userText: "reward is an extra free day",
    sceneState: scene,
  });
  assert.match(reply ?? "", /consequence if the user fails/i);

  scene = noteSceneStateUserTurn(scene, {
    text: "if i fail i lose the reward",
    act: "other",
    sessionTopic: null,
  });
  reply = buildSceneScaffoldReply({
    act: "other",
    userText: "if i fail i lose the reward",
    sceneState: scene,
  });
  assert.match(reply ?? "", /Reward: an extra free day/i);
  assert.match(reply ?? "", /Consequence: i lose the reward/i);
  assert.match(reply ?? "", /task terms are set/i);
});

test("profile-building flow asks a natural profile question instead of task language", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "I want you to get to know me better",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.equal(typeof reply, "string");
  assert.match(
    reply ?? "",
    /what should i call you|what do you actually enjoy doing|what do you want me to understand/i,
  );
  assert.doesNotMatch(reply ?? "", /here is your task|start now|put it on now/i);
  assert.doesNotMatch(reply ?? "", /our sessions|this session is going right/i);
});

test("profile-building follow-up stays on user facts instead of session-control framing", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "I like to golf",
    profile: {
      name: "Mara",
    },
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.equal(typeof reply, "string");
  assert.match(
    reply ?? "",
    /pattern there|pastime|gets its hooks into you|disappear into it|boundaries|direct|pace|one thing people usually miss/i,
  );
  assert.doesNotMatch(reply ?? "", /session|task|put it on now/i);
});

test("profile-building mode stays exclusive and does not emit task instructions", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "go on",
    profile: {
      name: "Mara",
    },
    inventory: [{ id: "1", label: "cage", available: true }],
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
      current_task_domain: "device",
    },
  });

  assert.equal(typeof reply, "string");
  assert.doesNotMatch(reply ?? "", /here is your task|start now|put it on now|reply done/i);
  assert.doesNotMatch(reply ?? "", /what do you want to talk about/i);
  assert.match(
    reply ?? "",
    /what do you lose track of time doing when nobody is steering you|remember it instead of treating it like filler|boundaries|open-ended|direct|pace|detail/i,
  );
});

test("profile summary request returns a summary instead of another profile question", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "Call me Mara", 1_000, "profile_fact");
  memory = writeUserAnswer(memory, "I like golf", 2_000, "profile_fact");
  memory = writeUserAnswer(memory, "I prefer short direct answers", 3_000, "profile_fact");

  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what have you learned about me so far",
    sessionMemory: memory,
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.match(reply ?? "", /name: Mara/i);
  assert.match(reply ?? "", /interests: golf/i);
  assert.match(reply ?? "", /communication: short direct answers/i);
  assert.doesNotMatch(reply ?? "", /\?/);
  assert.doesNotMatch(reply ?? "", /here is your task|start now|put it on now/i);
});

test("chat-switch request in profile mode returns a normal-chat handoff", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "let's just chat for a minute",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.match(reply ?? "", /talk to me normally|just chat|for a minute/i);
  assert.doesNotMatch(reply ?? "", /what should i call you|what do you enjoy/i);
});

test("locked task execution explains the lock instead of forcing generic task language", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "tell me about yourself",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "locked_task_execution",
      topic_type: "task_execution",
      topic_locked: true,
      task_progress: "assigned",
      task_hard_lock_active: true,
      locked_task_domain: "device",
      reason_for_lock: "Finish the current device task first.",
      next_expected_user_action: "put it on now and reply done once it is secure",
    },
  });

  assert.equal(typeof reply, "string");
  assert.match(reply ?? "", /finish the current device task first/i);
  assert.match(reply ?? "", /put it on now and reply done once it is secure/i);
  assert.doesNotMatch(reply ?? "", /stay on this task thread and ask one direct task question/i);
});

test("mutual get-to-know request gets a natural conversational reply", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "I want to learn more about you",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.equal(typeof reply, "string");
  assert.match(
    reply ?? "",
    /what holds my attention|what keeps my attention|the part that is real|honesty|usefulness|control that actually changes something|what do you want to know about me first/i,
  );
  assert.doesNotMatch(reply ?? "", /stay with the current thread and continue/i);
  assert.doesNotMatch(reply ?? "", /put it on now|here is your task/i);
});

test("assistant-self question gets a direct conversational answer", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what's your favorite thing to talk about",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.match(reply ?? "", /patterns|pressure|ambition|desire|talk with some nerve/i);
  assert.doesNotMatch(reply ?? "", /here is your task|start now|put it on now/i);
  assert.doesNotMatch(reply ?? "", /ask the exact question|stay with the current thread/i);
});

test("assistant-self kink preference question gets a direct in-character answer", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "what kinks do you like?",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.match(reply ?? "", /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(reply ?? "", /do not have personal preferences|enforces protocols|here is your task/i);
});

test("inventory use question answers grounded insertable use instead of issuing a directive", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "where should i put it?",
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
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.match(reply ?? "", /oral use|anal use|grounded options/i);
  assert.doesNotMatch(reply ?? "", /set up your|get back in frame|confirm it is in place/i);
});

test("inventory use question stays grounded from conversational dildo context even without saved inventory", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "where should i put it?",
    sessionMemory: createSessionMemory(),
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
      last_assistant_text:
        "I like dildos and plugs when they are used with intention instead of waved around like a shortcut.",
    },
  });

  assert.match(reply ?? "", /oral use|anal use|grounded options|insertable toy/i);
  assert.doesNotMatch(reply ?? "", /set up your|get back in frame|confirm it is in place/i);
});

test("scene scaffold short follow-up uses the last assistant text for relational clarification", () => {
  const reply = buildSceneScaffoldReply({
    act: "short_follow_up",
    userText: "what do you mean?",
    sessionMemory: createSessionMemory(),
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
      last_assistant_text:
        "Yes. Being trained by me in a way that actually changes you is where it stops being an image and starts asking something real.",
    },
  });

  assert.match(reply ?? "", /being trained by me/i);
  assert.doesNotMatch(reply ?? "", /part about would|part about could|part about should/i);
});

test("tell me about yourself does not collapse into session-control language", () => {
  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "tell me about yourself",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
      topic_locked: false,
    },
  });

  assert.equal(typeof reply, "string");
  assert.match(reply ?? "", /i like clean honesty|i pay attention fast|what do you want to know first/i);
  assert.doesNotMatch(reply ?? "", /stay with the current thread and continue/i);
});

test("paused non-hard-locked task does not force task scaffold on a normal question", () => {
  const reply = buildSceneScaffoldReply({
    act: "user_question",
    userText: "how are you today?",
    sceneState: {
      ...createSceneState(),
      interaction_mode: "question_answering",
      topic_type: "general_request",
      topic_locked: false,
      task_progress: "assigned",
      task_paused: true,
      task_hard_lock_active: false,
      task_template_id: "steady_hold",
    },
  });

  assert.equal(reply, null);
});

test("adaptive profile questioning varies after a hobby disclosure", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "I like golf", 1_000, "profile_fact");

  const reply = buildSceneScaffoldReply({
    act: "other",
    userText: "I like golf",
    sessionMemory: memory,
    sceneState: {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
      profile_prompt_count: 0,
      last_profile_prompt: "",
    },
  });

  assert.match(
    reply ?? "",
    /gets its hooks into you|disappear into it|what should i know about your boundaries|harder at the edges|what kind of energy/i,
  );
  assert.doesNotMatch(reply ?? "", /what should i call you when we talk like this\?/i);
});
