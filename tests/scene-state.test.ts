import test from "node:test";
import assert from "node:assert/strict";

import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import {
  type SceneState,
  buildLeverageSummary,
  buildSceneFallback,
  buildSceneStatePromptBlock,
  createSceneState,
  isResponseAlignedWithSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
  noteSceneVerificationResult,
} from "../lib/session/scene-state.ts";
import {
  createSessionMemory,
  writeUserAnswer,
} from "../lib/session/session-memory.ts";

test("scene state moves game setup into a locked game execution flow until the round is confirmed", () => {
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });

  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.topic_locked, true);
  assert.equal(
    isResponseAlignedWithSceneState(state, "Stand still and look at the camera."),
    false,
  );
  assert.equal(
    isResponseAlignedWithSceneState(
      state,
      "Fine. I will choose. Do you want something quick or something that takes a few minutes?",
    ),
    true,
  );

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing number hunt, pet. Listen carefully, pet. First guess now. One number from 1 to 10.",
  });

  assert.equal(state.topic_type, "game_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.topic_state, "open");
  assert.equal(state.game_template_id, "number_hunt");
  assert.equal(state.game_rotation_index, 1);
  assert.equal(state.game_progress, "round_1");

  state = noteSceneStateUserTurn(state, {
    text: "ready",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "round_1");
  assert.match(state.current_rule, /number hunt/i);

  state = noteSceneStateUserTurn(state, {
    text: "5",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "round_2");

  state = noteSceneStateUserTurn(state, {
    text: "7",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "completed");
  assert.equal(state.game_outcome, "user_win");
  assert.equal(state.game_reward_state, "free_pass_granted");
  assert.equal(state.free_pass_count, 1);
  assert.equal(state.topic_locked, true);

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. You kept the pace sharp. That round is complete.",
  });

  assert.equal(state.topic_type, "reward_window");
  assert.equal(state.topic_locked, true);
  assert.equal(state.topic_state, "open");
  assert.equal(state.game_outcome, "user_win");
  assert.equal(state.free_pass_count, 1);

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. The free pass stays banked. Use it when I win the next round.",
  });

  assert.equal(state.topic_locked, false);
  assert.equal(state.topic_state, "resolved");
});

test("scene state tracks requested task domain and lock reason for incompatible replans", () => {
  const state = noteSceneStateUserTurn(
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
      reason_for_lock: "Finish the current device task first.",
    },
    {
      text: "give me a posture task for 45 minutes",
      act: "task_request",
      sessionTopic: null,
    },
  );

  assert.equal(state.current_task_domain, "device");
  assert.equal(state.locked_task_domain, "device");
  assert.equal(state.user_requested_task_domain, "posture");
  assert.equal(state.can_replan_task, false);
  assert.match(state.reason_for_lock, /finish the current device task first/i);
});

test("scene state answers duration requests directly and exposes a prompt block", () => {
  const routed = classifyDialogueRoute({
    text: "how long do i have to wear it, hours or minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 2_000,
  });

  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "how long do i have to wear it, hours or minutes",
    act: routed.act,
    sessionTopic: routed.nextTopic,
  });

  assert.equal(state.topic_type, "duration_negotiation");
  assert.equal(
    isResponseAlignedWithSceneState(
      state,
      "What would you like to discuss next?",
    ),
    false,
  );
  assert.equal(
    buildSceneFallback(state, "how long do i have to wear it"),
    "You will wear it for 2 hours.",
  );

  const block = buildSceneStatePromptBlock(state);
  assert.match(block, /Topic locked: yes/i);
  assert.match(block, /Topic type: duration_negotiation/i);
  assert.match(block, /Leverage: no protection/i);
});

test("scene state captures stakes and win or lose conditions", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "the stakes are chastity. if i win you remove it. if you win i wear it overnight",
    act: "other",
    sessionTopic: null,
  });

  const block = buildSceneStatePromptBlock(state);
  assert.match(block, /Stakes: chastity/i);
  assert.match(block, /Win condition: you remove it/i);
  assert.match(block, /Lose condition: i wear it overnight/i);
});

test("scene state locks reward negotiation while a stake term is missing", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.topic_locked, true);
  assert.match(state.current_rule, /win condition/i);

  state = noteSceneStateUserTurn(state, {
    text: "if i win you unlock it",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.topic_locked, true);
  assert.match(state.current_rule, /Raven win condition/i);

  state = noteSceneStateUserTurn(state, {
    text: "if you win i wear it overnight",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.topic_locked, true);

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. The stakes are chastity. If you win, you unlock it. If I win, i wear it overnight. The terms are locked in.",
  });

  assert.equal(state.topic_locked, false);
  assert.equal(state.topic_state, "resolved");
});

test("scene state treats bet requests as stake negotiation", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets make a bet on the game",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.topic_locked, true);
  assert.match(state.current_rule, /state the stakes/i);
});

test("explicit bet request can interrupt a locked game execution rail", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing number hunt, pet. You hunt one hidden number from 1 to 10.",
  });

  assert.equal(state.topic_type, "game_execution");
  assert.equal(state.topic_locked, true);

  state = noteSceneStateUserTurn(state, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.topic_locked, true);
});

test("reward negotiation can auto-fill wager terms when Raven is told to choose", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });

  state = noteSceneStateUserTurn(state, {
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

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.stakes, "chastity");
  assert.match(state.win_condition, /you set one request and I grant it|you get one truth from me|you choose the next round and I follow it|you bank one free pass/i);
  assert.equal(state.lose_condition, "you keep your Steel Cage on for 30 minutes");
});

test("reward negotiation can auto-fill wager terms when user asks what Raven wants on win", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
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

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.stakes, "chastity");
  assert.equal(state.win_condition, "you set one request and I grant it");
  assert.equal(state.lose_condition, "you keep your Steel Cage on for 30 minutes");
});

test("reward negotiation can auto-fill wager terms from care-to-make-a-wager question", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "care to make a wager on the game?",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.stakes, "control");
  assert.equal(state.win_condition, "you set one request and I grant it");
  assert.match(state.lose_condition, /30 minute control hold/i);
});

test("reward negotiation can combine explicit user win terms with delegated Raven win terms", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "if i win i want one truth from you. if you win you can pick",
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

  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.stakes, "chastity");
  assert.equal(state.win_condition, "you get one truth");
  assert.equal(state.lose_condition, "you keep your Steel Cage on for 30 minutes");
});

test("explicit user win condition does not auto-grant a free pass on game completion", () => {
  let state = {
    ...createSceneState(),
    topic_type: "game_execution" as const,
    topic_locked: true,
    topic_state: "open" as const,
    game_template_id: "rps_streak" as const,
    game_progress: "round_2" as const,
    free_pass_count: 0,
    win_condition: "you tell me a truth",
    lose_condition: "i wear it overnight",
  };

  state = noteSceneStateUserTurn(state, {
    text: "scissors",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "completed");
  assert.equal(state.game_outcome, "user_win");
  assert.equal(state.game_reward_state, "none");
  assert.equal(state.free_pass_count, 0);
});

test("task planning can unlock to general conversation on unrelated user question", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });
  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.interaction_mode, "task_planning");
  assert.equal(state.task_hard_lock_active, false);

  state = noteSceneStateUserTurn(state, {
    text: "how are you today?",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "general_request");
  assert.equal(state.topic_locked, false);
  assert.equal(state.interaction_mode, "question_answering");
  assert.equal(state.task_paused, true);
});

test("profile-building request stays in conversational profile mode instead of task mode", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to get to know me better",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "profile_building");
  assert.equal(state.topic_type, "general_request");
  assert.equal(state.topic_locked, false);
  assert.equal(state.task_progress, "none");
});

test("mutual get-to-know request routes into profile-building mode", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "I want to learn more about you",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "relational_chat");
  assert.equal(state.topic_type, "general_request");
  assert.equal(state.topic_locked, false);
});

test("profile-building fallback rotates instead of repeating the same question", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to get to know me better",
    act: "other",
    sessionTopic: null,
  });

  const first = buildSceneFallback(state, "tell me more");
  assert.equal(first, "What should I call you when I am speaking to you directly?");

  state = noteSceneStateAssistantTurn(state, { text: first ?? "" });
  const second = buildSceneFallback(state, "go on");

  assert.notEqual(second, first);
  assert.doesNotMatch(second ?? "", /what should i call you when we talk like this\?/i);
});

test("scene state starts from a neutral task domain instead of a device-biased default", () => {
  const state = createSceneState();

  assert.equal(state.current_task_domain, "general");
  assert.equal(state.task_spec.current_task_domain, "general");
  assert.equal(state.interaction_mode, "normal_chat");
});

test("task negotiation stays live after a blocker answer and locks the next turn to fulfillment", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "How long should I make it run?",
  });

  state = noteSceneStateUserTurn(state, {
    text: "30 minutes",
    act: "duration_request",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_negotiation");
  assert.equal(state.topic_locked, true);
  assert.equal(state.user_requested_task_domain, "posture");
  assert.equal(state.task_spec.last_resolved_blocker, "duration_minutes");
  assert.equal(state.task_spec.request_stage, "ready_to_fulfill");
  assert.equal(state.task_spec.fulfillment_locked, true);
  assert.equal(state.next_expected_user_action, "wait for Raven to deliver the task");
});

test("normal question keeps normal conversation mode until explicit task intent exists", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "what do you think about routines?",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "question_answering");
  assert.equal(state.topic_type, "general_request");
  assert.equal(state.topic_locked, false);
  assert.equal(state.task_progress, "none");
});

test("old unfinished non-hard-locked task does not hijack a later normal chat request", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Fine. Here is your task: Hold a strict posture for 30 minutes, check in once halfway through, and report back when it is done. Start now. Set your posture now and reply done once you are set.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "let's just chat for a bit",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "normal_chat");
  assert.equal(state.topic_type, "general_request");
  assert.equal(state.topic_locked, false);
  assert.equal(state.task_paused, true);
});

test("profile summary request pauses an unlocked task and stays out of task execution", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Fine. Here is your task: Keep the device on for 45 minutes, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "what have you learned about me so far",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "profile_building");
  assert.equal(state.topic_type, "general_request");
  assert.equal(state.task_paused, true);
  assert.equal(state.topic_locked, false);
});

test("chat-switch request pauses an unlocked task and switches to normal chat", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Fine. Here is your task: Hold a strict posture for 20 minutes, check in once halfway through, and report back when it is done. Start now. Set your posture now and reply done once you are set.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "let's just chat for a minute",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "normal_chat");
  assert.equal(state.topic_type, "general_request");
  assert.equal(state.task_paused, true);
  assert.equal(state.topic_locked, false);
});

test("scene fallback answers profile summary request instead of asking another profile question", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "Call me Mara", 1_000, "profile_fact");
  memory = writeUserAnswer(memory, "I like golf", 2_000, "profile_fact");

  const reply = buildSceneFallback(
    {
      ...createSceneState(),
      interaction_mode: "profile_building",
      topic_type: "general_request",
      topic_locked: false,
    },
    "what have you learned about me so far",
    memory,
  );

  assert.match(reply ?? "", /name: Mara/i);
  assert.match(reply ?? "", /interests: golf/i);
  assert.doesNotMatch(reply ?? "", /\?/);
});

test("service-oriented follow-up preserves relational mode instead of flipping to question answering", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "I want you to get to know me better",
    act: "other",
    sessionTopic: null,
  });

  state = noteSceneStateUserTurn(state, {
    text: "thinking about what i can do for you",
    act: "other",
    sessionTopic: null,
  });

  state = noteSceneStateUserTurn(state, {
    text: "what?",
    act: "short_follow_up",
    sessionTopic: null,
  });

  assert.equal(state.interaction_mode, "relational_chat");
  assert.equal(state.topic_type, "none");
});

test("old unfinished non-hard-locked task pauses on a personal disclosure", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Fine. Here is your task: Keep the device on for 45 minutes, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "I like golf",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "general_request");
  assert.equal(state.topic_locked, false);
  assert.equal(state.task_paused, true);
  assert.equal(state.interaction_mode, "normal_chat");
});

test("non-hard-locked task can resume only when the user explicitly returns to task planning", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Fine. Here is your task: Keep the device on for 45 minutes, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "why are you asking that?",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "general_request");
  assert.equal(state.task_paused, true);

  state = noteSceneStateUserTurn(state, {
    text: "okay, what do I do next on the task?",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.interaction_mode, "task_planning");
  assert.equal(state.task_paused, false);
});

test("task execution does not reopen a game on generic start phrasing", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: hold a strict posture for 90 minutes, check in once halfway through, and report back when it is done. Start now. Set your posture now and reply done once you are set.",
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);

  state = noteSceneStateUserTurn(state, {
    text: "alright, i will start the timer now",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
});

test("assistant checkpoint text does not open task execution", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Listen carefully, pet. Next step: complete the current checkpoint and report back cleanly.",
  });

  assert.notEqual(state.topic_type, "task_execution");
  assert.equal(state.task_progress, "none");
});

test("assistant task assignment updates scene state to the assigned task domain", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a device task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Fine. Here is your task: Keep the device on for 30 minutes, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure, pet.",
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.task_template_id, "steady_hold");
  assert.equal(state.current_task_domain, "device");
  assert.equal(state.locked_task_domain, "device");
});

test("reward window with winner terms resolves after terms are applied", () => {
  let state = {
    ...createSceneState(),
    topic_type: "reward_window" as const,
    topic_locked: true,
    topic_state: "open" as const,
    game_outcome: "user_win" as const,
    game_reward_state: "none" as const,
    win_condition: "you tell me a truth",
  };

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. You won. As agreed: you tell me a truth. Truth: I read hesitation fast. Winner terms applied.",
  });

  assert.equal(state.topic_type, "reward_window");
  assert.equal(state.topic_locked, false);
  assert.equal(state.topic_state, "resolved");
});

test("start cue reopens game setup from a resolved game scene", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing number hunt, pet. You hunt one hidden number from 1 to 10.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "5",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneStateAssistantTurn(state, {
    text: "Too low. Second and final guess now. One number only.",
  });
  state = noteSceneStateUserTurn(state, {
    text: "7",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneStateAssistantTurn(state, {
    text: "Good. You kept the pace sharp. That round is complete.",
  });

  assert.equal(state.topic_type, "reward_window");
  assert.equal(state.topic_locked, true);
  assert.equal(state.scene_type, "game");

  state = noteSceneStateUserTurn(state, {
    text: "ok lets start",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.topic_locked, true);
});

test("scene state can pick a learned-biased game template when opening game setup", () => {
  const state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
    profile: {
      preferred_pace: "slow and steady",
      likes: "memory recall",
    },
    progress: {
      current_tier: "bronze",
      free_pass_count: 0,
      last_completion_summary: null,
    },
  });

  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.game_template_id, "number_hunt");
});

test("scene state lets the user switch to a different named game while still in setup", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.game_template_id, "rps_streak");

  state = noteSceneStateUserTurn(state, {
    text: "switch to math duel",
    act: "propose_activity",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.game_template_id, "math_duel");
});

test("scene state locks task terms negotiation while task reward or consequence is missing", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "reward is an extra free day",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_terms_negotiation");
  assert.equal(state.topic_locked, true);
  assert.match(state.current_rule, /task consequence/i);

  state = noteSceneStateUserTurn(state, {
    text: "if i fail i lose the reward",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_terms_negotiation");
  assert.equal(state.topic_locked, true);

  state = noteSceneStateAssistantTurn(state, {
    text: "Reward: an extra free day. Consequence: i lose the reward. The task terms are locked in.",
  });

  assert.equal(state.topic_locked, false);
  assert.equal(state.topic_state, "resolved");
});

test("scene state moves task assignment into a locked execution flow until completion is confirmed", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "assigned");
  assert.match(state.next_expected_user_action, /reply done|secure the task|lock it in place/i);

  state = noteSceneStateUserTurn(state, {
    text: "done",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.task_progress, "secured");
  assert.match(state.current_rule, /halfway check in/i);

  state = noteSceneStateUserTurn(state, {
    text: "halfway check in",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.task_progress, "halfway_checked");
  assert.match(state.next_expected_user_action, /has elapsed/i);

  state = noteSceneStateUserTurn(state, {
    text: "all done",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.task_progress, "completed");
  assert.equal(state.topic_locked, true);

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. You held it and reported cleanly. The task is complete.",
  });

  assert.equal(state.topic_locked, false);
  assert.equal(state.topic_state, "resolved");
});

test("scene state reopens task execution as assigned when a new task is issued after completion", () => {
  const state = noteSceneStateAssistantTurn(
    {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "completed",
      task_duration_minutes: 30,
    },
    {
      text: "Good. The last task is finished. Here is the next one. Listen carefully, pet. Here is your task: Keep the device on for 3 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure, pet.",
    },
  );

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "assigned");
  assert.equal(state.task_duration_minutes, 180);
});

test("assistant task follow-up does not reset an active secured task back to assigned", () => {
  const state = noteSceneStateAssistantTurn(
    {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 30,
      task_template_id: "steady_hold",
    },
    {
      text: "Good. Next, keep it on, pet. Check in once halfway through, then report back when the full 30 minutes has elapsed.",
    },
  );

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.task_progress, "secured");
});

test("hard-locked task execution keeps the current rail on paraphrased next-task request", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });
  state = {
    ...state,
    interaction_mode: "locked_task_execution",
    task_hard_lock_active: true,
    can_replan_task: false,
    reason_for_lock: "Finish the current device task first.",
  };
  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);

  state = noteSceneStateUserTurn(state, {
    text: "i did already and it is on",
    act: "acknowledgement",
    sessionTopic: null,
  });
  assert.equal(state.task_progress, "secured");

  state = noteSceneStateUserTurn(state, {
    text: "give me something else to do",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "secured");
});

test("scene state keeps a hard-locked running task rail when a different task is requested", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });
  state = {
    ...state,
    interaction_mode: "locked_task_execution",
    task_hard_lock_active: true,
    can_replan_task: false,
    reason_for_lock: "Finish the current device task first.",
  };

  state = noteSceneStateUserTurn(state, {
    text: "give me a 30 minute task instead",
    act: "task_request",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "assigned");
  assert.equal(state.can_replan_task, false);
  assert.match(state.reason_for_lock, /finish the current device task first/i);
});

test("scene state reopens unlocked task negotiation for a bare different-task request", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a posture task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Here is your task: Hold a strict posture protocol for 30 minutes. Check in once halfway through, and report back when it is done. Start now. Begin the posture drill and reply done once you are set, pet.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "different task",
    act: "task_request",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_negotiation");
  assert.equal(state.task_spec.request_kind, "replacement");
  assert.equal(state.current_task_domain, "posture");
});

test("scene state preserves the active task family during a duration-only revision", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a hands task for 30 minutes",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Here is your task: Work through a hands drill for 30 minutes. Check in once halfway through, and report back when it is done. Start now. Begin the hands drill and reply done once you are set, pet.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "make it 20 minutes",
    act: "duration_request",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_negotiation");
  assert.equal(state.task_spec.request_kind, "revision");
  assert.equal(state.current_task_domain, "hands");
  assert.equal(state.locked_task_domain, "hands");
});

test("scene state keeps a hard lock when a running task gets a what-else cue", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "what else should i do now",
    act: "user_question",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "assigned");
});

test("scene state does not interrupt an active task rail for a task-shaped progress question", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 30 minutes, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "what do i do after the 30 minutes are up?",
    act: "task_request",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
});

test("scene fallback gives next-step guidance during task execution questions", () => {
  const replyAssigned = buildSceneFallback(
    {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "assigned",
      task_duration_minutes: 120,
    },
    "what should i do next?",
  );
  assert.match(replyAssigned ?? "", /next on the task/i);
  assert.match(replyAssigned ?? "", /start now|reply done/i);

  const replySecured = buildSceneFallback(
    {
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      task_progress: "secured",
      task_duration_minutes: 120,
    },
    "what now?",
  );
  assert.match(replySecured ?? "", /check in once halfway/i);
});

test("scene state can enter task execution from a direct inventory assignment line", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "you tell me what you want",
    act: "other",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Put your Chastity Cage on now, lock it, then get in frame and show me it is secure.",
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "assigned");
});

test("scene state moves into verification lock when verification summary is appended", () => {
  const state = noteSceneVerificationResult(
    createSceneState(),
    "presence:pass confidence=0.92 summary=face centered and steady",
  );

  assert.equal(state.topic_type, "verification_in_progress");
  assert.equal(state.topic_locked, true);
  assert.equal(
    isResponseAlignedWithSceneState(state, "Hold steady while I verify the camera check."),
    true,
  );
  assert.match(state.last_verified_action, /presence:pass/i);
});

test("scene state restores a running task execution after verification without unlocking it", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. Here is your task: keep the device on for 2 hours, check in once halfway through, and report back when it is done. Start now. Put it on now and reply done once it is secure.",
  });

  state = noteSceneVerificationResult(state, "presence:pass confidence=0.92 summary=face centered and steady");

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. I have you in frame. Stay in frame and keep your face forward. Good. Keep it on. Check in once halfway through, then report back when the 2 hours are complete.",
    topicResolved: true,
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.topic_state, "open");
});

test("scene state converts a Raven game win into a locked task execution flow", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing a rock paper scissors streak, pet.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "paper",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "failed");
  assert.equal(state.game_outcome, "raven_win");

  state = noteSceneStateAssistantTurn(state, {
    text:
      "Good. You answered cleanly. That round is complete. I win this round. you wear it overnight. Good. Here is your task: Hold a strict upright posture for 90 minutes, check in once halfway through, and report back when it is done. Start now. Set your posture now and reply done once you are set.",
  });

  assert.equal(state.topic_type, "task_execution");
  assert.equal(state.topic_locked, true);
  assert.equal(state.task_progress, "assigned");
});

test("scene state moves a Raven win without task text into reward window first", () => {
  const state = noteSceneStateAssistantTurn(
    {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "completed",
      game_outcome: "raven_win",
      lose_condition: "you wear it overnight",
    },
    {
      text: "I threw scissors. You threw paper. That round is complete. I win this round. Remember your place. you wear it overnight. You have no protection banked. Your consequence is live now. Say ready, and I will enforce it.",
    },
  );

  assert.equal(state.topic_type, "reward_window");
  assert.equal(state.topic_locked, true);
  assert.equal(state.topic_state, "open");
  assert.equal(state.game_outcome, "raven_win");
});

test("scene state treats 'I win this one' as a Raven win and opens reward window", () => {
  const state = noteSceneStateAssistantTurn(
    {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "failed",
      game_outcome: "raven_win",
      lose_condition: "you keep the cage on for 30 minutes",
    },
    {
      text: "I threw scissors. You threw paper. You lost the throw and the round. I win this one. The loss stands. Say ready, and I will enforce it.",
    },
  );

  assert.equal(state.topic_type, "reward_window");
  assert.equal(state.topic_locked, true);
  assert.equal(state.topic_state, "open");
  assert.equal(state.game_outcome, "raven_win");
});

test("scene state consumes a free pass on a Raven game win and skips consequence task selection", () => {
  let state = {
    ...createSceneState(),
    free_pass_count: 1,
  };
  state = noteSceneStateUserTurn(state, {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing a rock paper scissors streak, pet.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "paper",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "failed");
  assert.equal(state.game_outcome, "raven_win");
  assert.equal(state.game_reward_state, "free_pass_used");
  assert.equal(state.free_pass_count, 0);

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. You answered cleanly. That round is complete. I win this round. you wear it overnight. Your free pass is spent. No consequence task this round.",
  });

  assert.equal(state.topic_type, "game_execution");
  assert.equal(state.topic_locked, false);
  assert.equal(state.topic_state, "resolved");
});

test("leverage summary reflects the current deterministic pressure state", () => {
  assert.equal(buildLeverageSummary(createSceneState()), "no protection");
  assert.equal(
    buildLeverageSummary({ ...createSceneState(), free_pass_count: 2 }),
    "free pass banked (2)",
  );
  assert.equal(
    buildLeverageSummary({
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      game_outcome: "raven_win",
    }),
    "consequence task armed",
  );
  assert.equal(
    buildLeverageSummary({
      ...createSceneState(),
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      game_reward_state: "free_pass_used",
    }),
    "free pass spent this round",
  );
});

test("reward window can reopen game setup for another round and does not resolve on immediate spend request", () => {
  let state: SceneState = {
    ...createSceneState(),
    topic_type: "reward_window" as const,
    topic_locked: true,
    topic_state: "open" as const,
    scene_type: "game",
    game_rotation_index: 1,
    game_reward_state: "free_pass_granted" as const,
    free_pass_count: 1,
  };

  state = noteSceneStateUserTurn(state, {
    text: "another round",
    act: "other",
    sessionTopic: null,
  });

  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.topic_locked, true);
  assert.equal(state.game_template_id, "number_hunt");

  let spendState: SceneState = {
    ...createSceneState(),
    topic_type: "reward_window" as const,
    topic_locked: true,
    topic_state: "open" as const,
    game_reward_state: "free_pass_granted" as const,
    free_pass_count: 1,
  };

  spendState = noteSceneStateAssistantTurn(spendState, {
    text: "No. That protection only cancels the next consequence task when I win. It stays banked until then.",
  });

  assert.equal(spendState.topic_type, "reward_window");
  assert.equal(spendState.topic_locked, true);
  assert.equal(spendState.topic_state, "open");
});

test("scene fallback keeps rule questions on the selected game", () => {
  const reply = buildSceneFallback(
    {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "number_hunt",
      game_progress: "round_1",
    },
    "how do we play?",
  );

  assert.match(reply ?? "", /stay with number hunt/i);
  assert.match(reply ?? "", /one final guess/i);
});

test("scene fallback keeps what now and start cues on the deterministic game rail", () => {
  const nextReply = buildSceneFallback(
    {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "ready",
    },
    "what now?",
  );

  assert.match(nextReply ?? "", /First throw now/i);

  const startReply = buildSceneFallback(
    {
      ...createSceneState(),
      topic_type: "game_setup",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "rps_streak",
    },
    "ok lets start",
  );

  assert.match(startReply ?? "", /I pick\./i);
  assert.match(startReply ?? "", /rock paper scissors streak/i);
  assert.match(startReply ?? "", /First throw now/i);
});

test("scene state accepts a game answer even when the user phrases it as a question", () => {
  const state = noteSceneStateUserTurn(
    {
      ...createSceneState(),
      topic_type: "game_execution",
      topic_locked: true,
      topic_state: "open",
      game_template_id: "math_duel",
      game_progress: "round_1",
    },
    {
      text: "So 7 + 4 = 11. Is that correct?",
      act: "user_question",
      sessionTopic: null,
    },
  );

  assert.equal(state.topic_type, "game_execution");
  assert.equal(state.game_progress, "round_2");
});

test("scene state keeps the same game progress when the user only gives a passive acknowledgement", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing a rock paper scissors streak, pet. Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "ready",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "round_1");

  state = noteSceneStateUserTurn(state, {
    text: "ok",
    act: "acknowledgement",
    sessionTopic: null,
  });

  assert.equal(state.game_progress, "round_1");
});

test("scene state preserves an explicit game choice through wager negotiation and start cues", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play rock paper scissors",
    act: "propose_activity",
    sessionTopic: null,
  });

  assert.equal(state.game_template_id, "rps_streak");
  assert.equal(state.topic_type, "game_setup");

  state = noteSceneStateUserTurn(state, {
    text: "lets bet on the game",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(state.topic_type, "reward_negotiation");
  assert.equal(state.game_template_id, "rps_streak");

  state = noteSceneStateUserTurn(state, {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(state.game_template_id, "rps_streak");

  state = noteSceneStateUserTurn(state, {
    text: "if i win you tell me a truth and if you win you can pick",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(state.game_template_id, "rps_streak");

  state = noteSceneStateAssistantTurn(state, {
    text: "Good. The stakes are chastity. If you win, you tell me a truth. If I win, I pick the consequence. The terms are set. You will stick to them.",
  });

  state = noteSceneStateUserTurn(state, {
    text: "ok lets start best of three",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(state.topic_type, "game_setup");
  assert.equal(state.game_template_id, "rps_streak");
});

test("scene state tracks number command choice and resolves on done or failed", () => {
  let state = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a number game",
    act: "propose_activity",
    sessionTopic: null,
  });

  state = noteSceneStateAssistantTurn(state, {
    text: "I pick. We are doing number command, pet. Listen carefully, pet. Pick one number from 1 to 10 now.",
  });
  assert.equal(state.topic_type, "game_execution");
  assert.equal(state.game_template_id, "number_command");
  assert.equal(state.game_progress, "round_1");

  state = noteSceneStateUserTurn(state, {
    text: "9",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(state.game_progress, "round_2");
  assert.equal(state.game_number_choice, 9);

  const completed = noteSceneStateUserTurn(state, {
    text: "done",
    act: "acknowledgement",
    sessionTopic: null,
  });
  assert.equal(completed.game_progress, "completed");
  assert.equal(completed.game_outcome, "user_win");

  const failed = noteSceneStateUserTurn(state, {
    text: "failed",
    act: "other",
    sessionTopic: null,
  });
  assert.equal(failed.game_progress, "failed");
  assert.equal(failed.game_outcome, "raven_win");
});
