import test from "node:test";
import assert from "node:assert/strict";

import { createCommitmentState } from "../lib/session/commitment-engine.ts";
import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";
import { buildTurnPlan } from "../lib/chat/turn-plan.ts";
import { applyResponseGate } from "../lib/session/response-gate.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
} from "../lib/session/scene-state.ts";
import { createSessionMemory, writeUserAnswer } from "../lib/session/session-memory.ts";
import { classifyDialogueRoute } from "../lib/dialogue/router.ts";

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

  assert.equal(result.forced, false);
  assert.equal(result.text, "I pick. We are doing a quick word chain.");
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
    lastAssistantText: "I am good. Sharp, awake, and paying attention. What is on yours?",
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

test("response gate accepts how-are-you reply as aligned social answer", () => {
  const result = applyResponseGate({
    text: "I am good. Sharp, awake, and paying attention. What is on yours?",
    userText: "how are you today",
    dialogueAct: "user_question",
    lastAssistantText: "Talk to me. What is on your mind?",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
  });

  assert.equal(result.forced, false);
  assert.equal(result.reason, "accepted");
  assert.match(result.text, /i am good|sharp|paying attention/i);
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
  assert.equal(result.reason, "duplicate_output_blocked");
  assert.match(result.text, /Choose quick or longer/i);
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
  assert.equal(result.reason, "weak_clarification_anchor");
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
  assert.match(result.text, /gets its hooks into you|does that do to your head|hard nos|tone dies on contact/i);
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
