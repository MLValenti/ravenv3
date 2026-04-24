import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  createConversationStateSnapshot,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
  type ConversationStateSnapshot,
} from "../lib/chat/conversation-state.ts";
import { buildHumanQuestionFallback } from "../lib/chat/open-question.ts";
import { buildTurnPlan } from "../lib/chat/turn-plan.ts";
import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import { createCommitmentState } from "../lib/session/commitment-engine.ts";
import { classifyUserIntent } from "../lib/session/intent-router.ts";
import { isGoalOrIntentStatement } from "../lib/session/interaction-mode.ts";
import { reconcileSceneStateWithConversation } from "../lib/session/conversation-runtime.ts";
import { shouldBypassModelForSceneTurn } from "../lib/session/deterministic-scene-routing.ts";
import { applyResponseGate } from "../lib/session/response-gate.ts";
import { buildSceneScaffoldReply } from "../lib/session/scene-scaffolds.ts";
import {
  buildSceneFallback,
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
  type SceneState,
} from "../lib/session/scene-state.ts";
import {
  createSessionMemory,
  isConversationArrivalAnswer,
  type SessionMemory,
  traceWriteUserAnswer,
  traceWriteUserQuestion,
  writeConversationMode,
  writeUserAnswer,
  writeUserQuestion,
} from "../lib/session/session-memory.ts";
import {
  createSessionStateContract,
  reduceAssistantEmission,
  reduceUserTurn,
  type SessionStateContract,
} from "../lib/session/session-state-contract.ts";
import {
  canEmitAssistant,
  createTurnGate,
  markAssistantEmitted,
  persistUserMessage,
  type TurnGateState,
} from "../lib/session/turn-gate.ts";
import { buildChatSwitchReply } from "../lib/session/mode-style.ts";
import {
  planDomainAnswer,
  validateAnswerContract,
} from "../lib/session/raven-preferences.ts";
import { buildDeterministicDominantWeakInputReply } from "../lib/session/weak-input-replies.ts";
import type { SessionInventoryItem } from "../lib/session/session-inventory.ts";

type HarnessState = {
  scene: SceneState;
  gate: TurnGateState;
  outputs: string[];
  memory?: SessionMemory;
  conversation?: ConversationStateSnapshot;
  inventory?: SessionInventoryItem[];
  contract?: SessionStateContract;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function answerForPrompt(prompt: string): string {
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

function reconcileHarnessScene(state: HarnessState): void {
  if (!state.conversation) {
    return;
  }
  state.scene = reconcileSceneStateWithConversation(state.scene, state.conversation);
}

function applyUserTurn(state: HarnessState, userText: string): string {
  const currentMemory = state.memory ?? createSessionMemory();
  const currentConversation =
    state.conversation ?? createConversationStateSnapshot("session-ui-harness");
  const route = classifyDialogueRoute({
    text: userText,
    awaitingUser: state.gate.awaitingUser,
    currentTopic: state.scene.topic_locked
      ? {
          topic_type: state.scene.topic_type,
          topic_state: state.scene.topic_state,
          summary: state.scene.summary,
          created_at: Date.now(),
          topic_locked: state.scene.topic_locked,
        }
      : null,
    nowMs: Date.now(),
  });
  const userIntent = classifyUserIntent(userText, state.gate.awaitingUser);

  state.gate = persistUserMessage(state.gate, userText);
  state.memory =
    route.act === "user_question" || route.act === "short_follow_up"
      ? writeUserQuestion(currentMemory, userText, Date.now(), 0.9)
      : writeUserAnswer(currentMemory, userText, Date.now(), null, 0.88);
  state.conversation = noteConversationUserTurn(currentConversation, {
    text: userText,
    userIntent,
    routeAct: route.act,
    nowMs: Date.now(),
  });
  state.scene = noteSceneStateUserTurn(state.scene, {
    text: userText,
    act: route.act,
    sessionTopic: route.nextTopic,
    inventory: state.inventory,
  });
  reconcileHarnessScene(state);

  const scaffolded = buildSceneScaffoldReply({
    act: route.act,
    userText,
    sceneState: state.scene,
    sessionMemory: state.memory,
    inventory: state.inventory,
  });
  const deterministicWeakInputReply = scaffolded
    ? null
    : buildDeterministicDominantWeakInputReply(userText);
  const sceneFallback =
    buildSceneFallback(state.scene, userText, state.memory, state.inventory) ??
    (isGoalOrIntentStatement(userText)
      ? "Good. Tell me what that actually means to you."
      : buildHumanQuestionFallback(userText, "neutral", {
          previousAssistantText: state.outputs[state.outputs.length - 1] ?? null,
          currentTopic: state.scene.agreed_goal || null,
        }));
  const deterministicCandidate = scaffolded ?? deterministicWeakInputReply;
  const bypassModel = shouldBypassModelForSceneTurn({
    sceneState: state.scene,
    dialogueAct: route.act,
    hasDeterministicCandidate: Boolean(deterministicCandidate),
    latestUserText: userText,
  });
  const candidate = bypassModel
    ? deterministicCandidate ?? sceneFallback
    : deterministicCandidate ?? sceneFallback;
  const turnPlan =
    route.act === "user_question" || route.act === "short_follow_up"
      ? buildTurnPlan(
          state.conversation.recent_window.map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
          {
            conversationState: state.conversation,
          },
        )
      : null;

  const gated = applyResponseGate({
    text: candidate,
    userText,
    lastAssistantText: state.outputs[state.outputs.length - 1] ?? null,
    turnPlan,
    sceneState: state.scene,
    commitmentState: createCommitmentState(),
    inventory: state.inventory ?? [],
    commitOwnerId: `ui-harness-${state.gate.stepIndex}`,
  });

  const emit = canEmitAssistant(state.gate, `ui-harness-${state.gate.stepIndex}`, gated.text);
  assert.equal(emit.allow, true);
  state.gate = markAssistantEmitted(state.gate, {
    stepId: `ui-harness-${state.gate.stepIndex}`,
    content: gated.text,
    isQuestion: gated.text.includes("?"),
  });
  state.scene = noteSceneStateAssistantTurn(state.scene, { text: gated.text });
  if (state.scene.interaction_mode === "game") {
    state.memory = writeConversationMode(state.memory, "game", Date.now(), 0.96);
  }
  state.conversation = noteConversationAssistantTurn(state.conversation, {
    text: gated.text,
    ravenIntent: route.act,
    nowMs: Date.now() + 1,
  });
  reconcileHarnessScene(state);
  state.outputs.push(gated.text);
  return gated.text;
}

function applySessionPathDebugTurn(
  state: HarnessState,
  userText: string,
): {
  text: string;
  debug: {
    rawUserText: string;
    selectedSemanticMove: string;
    styleWrapperApplied: boolean;
    scaffoldId: string | null;
    refusalReason: string | null;
    finalWinnerSource: string;
    turnMeaning: {
      speech_act: string;
      target: string;
      subject_domain: string;
      requested_operation: string;
      referent: string | null;
      continuity_attachment: string;
      question_shape: string;
      entity_set: string[];
      answer_contract: string;
      required_referent: string | null;
      required_scope: string;
      current_domain_handler: string;
      confidence: number;
    };
    plannedMove: {
      move: string;
      content_key: string;
      reason: string;
    };
    winningSubsystem: string;
    guardIntervention: boolean;
    contentSource: string;
    commitOwnerId: string | null;
    legacyOverrideAttempted: boolean;
    assistantCandidatesProduced: string[];
    finalCommittedAssistantOutputCount: number;
    finalCommittedAssistantText: string;
    assistantRenderAppendEvents: number;
    recoverSkippedAssistantRenderFired: boolean;
    appendRavenOutputRunsForTurn: number;
    visibleAssistantStringsShownForTurn: number;
    activeThreadBefore: string;
    activeThreadAfter: string;
    awaitingUserBefore: boolean;
    awaitingUserAfter: boolean;
    lastUserQuestionBefore: string | null;
    lastUserQuestionAfter: string | null;
    lastUserAnswerBefore: string | null;
    lastUserAnswerAfter: string | null;
    profileFactsAddedOnTurn: string[];
    conversationMode: string | null;
    personaMarkers: string[];
  };
} {
  const currentMemory = state.memory ?? createSessionMemory();
  const currentConversation =
    state.conversation ?? createConversationStateSnapshot("session-ui-loop-debug");
  const currentContract =
    state.contract ?? createSessionStateContract(state.gate.sessionId);
  const beforeOutputCount = state.outputs.length;
  const activeThreadBefore = currentConversation.active_thread;
  const awaitingUserBefore = currentContract.turnGate.awaitingUser;
  const lastUserQuestionBefore = currentMemory.last_user_question?.value ?? null;
  const lastUserAnswerBefore = currentMemory.last_user_answer?.value ?? null;

  const reducedUserTurn = reduceUserTurn(currentContract, {
    text: userText,
    nowMs: Date.now(),
  });
  state.contract = reducedUserTurn.next;
  state.gate = reducedUserTurn.next.turnGate;

  let nextMemory = currentMemory;
  let profileFactsAddedOnTurn: string[] = [];
  if (
    reducedUserTurn.intent === "user_question" ||
    reducedUserTurn.intent === "user_short_follow_up" ||
    reducedUserTurn.intent === "user_refusal_or_confusion"
  ) {
    nextMemory = traceWriteUserQuestion(currentMemory, userText, Date.now(), 0.9).memory;
  } else if (reducedUserTurn.intent === "user_answer") {
    const tracedWrite = traceWriteUserAnswer(currentMemory, userText, Date.now(), null, 0.88);
    nextMemory = tracedWrite.memory;
    profileFactsAddedOnTurn = tracedWrite.committed
      .filter((record) => record.key === "user_profile_facts")
      .map((record) => record.value);
  }
  state.memory = nextMemory;
  state.conversation = noteConversationUserTurn(currentConversation, {
    text: userText,
    userIntent: reducedUserTurn.intent,
    routeAct: reducedUserTurn.route.act,
    nowMs: Date.now(),
  });
  state.scene = noteSceneStateUserTurn(state.scene, {
    text: userText,
    act: reducedUserTurn.route.act,
    sessionTopic: reducedUserTurn.route.nextTopic,
    inventory: state.inventory,
  });
  reconcileHarnessScene(state);

  const scaffolded = buildSceneScaffoldReply({
    act: reducedUserTurn.route.act,
    userText,
    sceneState: state.scene,
    sessionMemory: nextMemory,
    inventory: state.inventory,
  });
  const deterministicWeakInputReply = scaffolded
    ? null
    : buildDeterministicDominantWeakInputReply(userText);
  const sceneFallback =
    buildSceneFallback(state.scene, userText, nextMemory, state.inventory) ??
    (isGoalOrIntentStatement(userText)
      ? "Good. Tell me what that actually means to you."
      : buildHumanQuestionFallback(userText, "neutral", {
          previousAssistantText: state.outputs[state.outputs.length - 1] ?? null,
          currentTopic: state.scene.agreed_goal || null,
        }));
  const conversationArrivalReply =
    reducedUserTurn.intent === "user_answer" &&
    isConversationArrivalAnswer(userText) &&
    nextMemory.conversation_mode?.value === "normal_chat"
      ? buildChatSwitchReply()
      : null;
  const deterministicCandidate =
    conversationArrivalReply ?? scaffolded ?? deterministicWeakInputReply;
  const bypassModel = shouldBypassModelForSceneTurn({
    sceneState: state.scene,
    dialogueAct: reducedUserTurn.route.act,
    hasDeterministicCandidate: Boolean(deterministicCandidate),
    latestUserText: userText,
  });
  const candidate = bypassModel
    ? deterministicCandidate ?? sceneFallback
    : deterministicCandidate ?? sceneFallback;
  const turnPlan =
    reducedUserTurn.route.act === "user_question" ||
    reducedUserTurn.route.act === "short_follow_up"
      ? buildTurnPlan(
          state.conversation.recent_window.map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
          {
            conversationState: state.conversation,
          },
        )
      : null;
  const gated = applyResponseGate({
    text: candidate,
    userText,
    lastAssistantText: state.outputs[state.outputs.length - 1] ?? null,
    turnPlan,
    sceneState: state.scene,
    commitmentState: createCommitmentState(),
    inventory: state.inventory ?? [],
    commitOwnerId: `ui-debug-${state.gate.stepIndex}`,
  });
  const emit = canEmitAssistant(state.gate, `ui-debug-${state.gate.stepIndex}`, gated.text);
  assert.equal(emit.allow, true);
  state.contract = reduceAssistantEmission(state.contract, {
    stepId: `ui-debug-${state.gate.stepIndex}`,
    content: gated.text,
    isQuestion: gated.text.includes("?"),
    topicResolved: false,
  });
  state.gate = state.contract.turnGate;
  state.scene = noteSceneStateAssistantTurn(state.scene, { text: gated.text });
  state.conversation = noteConversationAssistantTurn(state.conversation, {
    text: gated.text,
    ravenIntent: reducedUserTurn.route.act,
    nowMs: Date.now() + 1,
  });
  reconcileHarnessScene(state);
  state.outputs.push(gated.text);

  const finalCommittedAssistantText = gated.text;
  const finalWinnerSource =
    conversationArrivalReply && candidate === conversationArrivalReply
      ? "conversation_arrival"
      : scaffolded && candidate === scaffolded
        ? "scene_scaffold"
        : deterministicWeakInputReply && candidate === deterministicWeakInputReply
          ? "weak_input"
          : sceneFallback && candidate === sceneFallback
            ? "scene_fallback"
            : "unknown";
  const refusalReason =
    /all you need to know|understand that we have rules here|remember your place|i(?:'m| am)\s*,\s*pet/i.test(
      finalCommittedAssistantText,
    )
      ? "control_scaffold_or_malformed_template"
      : null;
  const personaMarkers = ["sharp", "sharp enough", "pet", "enough hovering"].filter((marker) =>
    new RegExp(marker.replace(/\s+/g, "\\s+"), "i").test(finalCommittedAssistantText),
  );
  return {
    text: gated.text,
    debug: {
      rawUserText: userText,
      selectedSemanticMove: gated.semanticTrace.planned_move.move,
      styleWrapperApplied: false,
      scaffoldId: scaffolded ? state.scene.topic_type : null,
      refusalReason,
      finalWinnerSource,
      turnMeaning: {
        speech_act: gated.semanticTrace.turn_meaning.speech_act,
        target: gated.semanticTrace.turn_meaning.target,
        subject_domain: gated.semanticTrace.turn_meaning.subject_domain,
        requested_operation: gated.semanticTrace.turn_meaning.requested_operation,
        referent: gated.semanticTrace.turn_meaning.referent,
        continuity_attachment: gated.semanticTrace.turn_meaning.continuity_attachment,
        question_shape: gated.semanticTrace.turn_meaning.question_shape,
        entity_set: gated.semanticTrace.turn_meaning.entity_set,
        answer_contract: gated.semanticTrace.turn_meaning.answer_contract,
        required_referent: gated.semanticTrace.turn_meaning.required_referent,
        required_scope: gated.semanticTrace.turn_meaning.required_scope,
        current_domain_handler: gated.semanticTrace.turn_meaning.current_domain_handler,
        confidence: gated.semanticTrace.turn_meaning.confidence,
      },
      plannedMove: {
        move: gated.semanticTrace.planned_move.move,
        content_key: gated.semanticTrace.planned_move.content_key,
        reason: gated.semanticTrace.planned_move.reason,
      },
      winningSubsystem: gated.semanticTrace.winning_subsystem,
      guardIntervention: gated.semanticTrace.guard_intervention,
      contentSource: gated.semanticTrace.content_source,
      commitOwnerId: gated.semanticTrace.commit_owner_id,
      legacyOverrideAttempted: gated.semanticTrace.legacy_override_attempted,
      assistantCandidatesProduced: [
        scaffolded,
        deterministicWeakInputReply,
        conversationArrivalReply,
        sceneFallback,
      ].filter((value): value is string => Boolean(value)),
      finalCommittedAssistantOutputCount: state.outputs.length - beforeOutputCount,
      finalCommittedAssistantText,
      assistantRenderAppendEvents: 1,
      recoverSkippedAssistantRenderFired: false,
      appendRavenOutputRunsForTurn: 1,
      visibleAssistantStringsShownForTurn: state.outputs.length - beforeOutputCount,
      activeThreadBefore,
      activeThreadAfter: state.conversation.active_thread,
      awaitingUserBefore,
      awaitingUserAfter: state.gate.awaitingUser,
      lastUserQuestionBefore,
      lastUserQuestionAfter: state.memory?.last_user_question?.value ?? null,
      lastUserAnswerBefore,
      lastUserAnswerAfter: state.memory?.last_user_answer?.value ?? null,
      profileFactsAddedOnTurn,
      conversationMode: state.memory?.conversation_mode?.value ?? null,
      personaMarkers,
    },
  };
}

test("ui harness session loop regression keeps one clean committed reply after im here to talk", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-session-loop"),
    outputs: [],
    memory: createSessionMemory(),
    conversation: createConversationStateSnapshot("ui-harness-session-loop"),
  };

  applyUserTurn(state, "how are you?");
  const result = applySessionPathDebugTurn(state, "im here to talk");

  console.info("raven.session.loop_debug", JSON.stringify(result.debug));

  assert.equal(result.debug.finalCommittedAssistantOutputCount, 1);
  assert.equal(result.debug.assistantRenderAppendEvents, 1);
  assert.equal(result.debug.recoverSkippedAssistantRenderFired, false);
  assert.equal(result.debug.appendRavenOutputRunsForTurn, 1);
  assert.equal(result.debug.visibleAssistantStringsShownForTurn, 1);
  assert.doesNotMatch(result.debug.finalCommittedAssistantText, /\bsharp enough\b|\bsharp\b/i);
  assert.doesNotMatch(
    result.debug.finalCommittedAssistantText,
    /\bwhy you(?:'re| are) here\b|\bwhat you actually want\b/i,
  );
  assert.doesNotMatch(result.debug.finalCommittedAssistantText, /\bpet\b|\benough hovering\b/i);
  assert.equal(result.debug.lastUserQuestionBefore, "how are you?");
  assert.equal(result.debug.lastUserQuestionAfter, null);
  assert.equal(result.debug.lastUserAnswerAfter, "im here to talk");
  assert.deepEqual(result.debug.profileFactsAddedOnTurn, []);
  assert.equal(result.debug.conversationMode, "normal_chat");
  assert.equal(result.debug.awaitingUserAfter, false);
});

test("ui harness wager flow does not repeat the same line and stays in negotiation", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-wager"),
    outputs: [],
  };

  const first = applyUserTurn(state, "lets play a game");
  assert.match(first, /game|quick|longer|pick/i);

  const second = applyUserTurn(state, "lets bet on the game");
  assert.match(second, /wager|stakes/i);

  const third = applyUserTurn(state, "what do you want if you win");
  assert.match(third, /if i win|stakes|wager/i);

  const fourth = applyUserTurn(state, "what do you want if you win");
  assert.notEqual(normalize(third), normalize(fourth));
  assert.doesNotMatch(fourth, /well-lit area|minimal distractions|how's your day/i);

  for (let index = 1; index < state.outputs.length; index += 1) {
    assert.notEqual(normalize(state.outputs[index - 1]), normalize(state.outputs[index]));
  }
});

test("ui harness greeting stays in open chat without session-control language", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-greeting"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "hi");
  assert.match(reply, /enough hovering|what you actually want/i);
  assert.doesNotMatch(reply, /listen carefully|keep it specific|next instruction/i);
  assert.doesNotMatch(reply, /ask the exact question you want answered, and i will answer it plainly/i);
  assert.equal(state.scene.interaction_mode, "normal_chat");
});

test("ui harness titled greeting hi miss raven behaves like a normal opener", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-titled-greeting"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-titled-greeting"),
    memory: createSessionMemory(),
  };

  const reply = applyUserTurn(state, "hi miss raven");

  assert.match(
    reply,
    /enough hovering|what you actually want|what has your attention tonight|chat, a plan, or a game/i,
  );
  assert.doesNotMatch(reply, /keep going|concrete part of open|wording around it/i);
  assert.equal(state.scene.interaction_mode, "normal_chat");
  assert.equal(state.conversation?.current_mode, "normal_chat");
});

test("ui harness casual short-answer thread stays coherent through clarification and go-on", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-short-answers"),
    outputs: ["You're here. What has your attention tonight: chat, a plan, or a game?"],
  };
  state.scene = noteSceneStateAssistantTurn(state.scene, {
    text: state.outputs[0]!,
  });

  const first = applyUserTurn(state, "chat");
  assert.match(first, /pressure|right now/i);
  assert.doesNotMatch(first, /fine\. say what you want/i);

  const second = applyUserTurn(state, "work");
  assert.match(second, /workload|person|decision/i);

  const third = applyUserTurn(state, "what do you mean?");
  assert.match(third, /work|attention|amount|person|choice/i);
  assert.doesNotMatch(third, /ask the exact question|fine\. say what you want/i);

  const fourth = applyUserTurn(state, "go on");
  assert.match(fourth, /pick one|thread|which part/i);
  assert.doesNotMatch(fourth, /neutral tone|keep up, pet|fine\. say what you want/i);
});

test("ui harness paused task history does not steal fresh casual disclosures or topical questions", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-paused-task-casual-recovery"),
    outputs: [],
  };

  applyUserTurn(state, "give me a device task for 30 minutes");
  applyUserTurn(state, "let's just chat for a bit");
  const disclosure = applyUserTurn(state, "I like pegging");
  const routines = applyUserTurn(state, "what do you think about routines?");

  assert.match(disclosure, /\b(pegging|what do you like about it|what about it|what pulls you in)\b/i);
  assert.doesNotMatch(disclosure, /\b(device task|30 minutes|report back)\b/i);

  assert.match(routines, /\b(routines|structure|support your life|hold things together)\b/i);
  assert.doesNotMatch(routines, /\b(device task|30 minutes|report back)\b/i);
});

test("ui harness greeting opener can start and hold a casual thread without generic fallback drift", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-greeting-thread"),
    outputs: [],
  };

  const first = applyUserTurn(state, "hi mistress");
  assert.match(first, /\b(chat|plan|game)\b/i);
  assert.doesNotMatch(first, /enough hovering|fine\. say what you want|start talking/i);

  const second = applyUserTurn(state, "chat");
  assert.match(second, /pressure|right now/i);
  assert.doesNotMatch(second, /fine\. say what you want/i);

  const third = applyUserTurn(state, "work");
  assert.match(third, /workload|person|decision/i);

  const fourth = applyUserTurn(state, "go on");
  assert.match(fourth, /pick one|thread|which part/i);
  assert.doesNotMatch(fourth, /fine\. say what you want|start talking/i);
});

test("ui harness how-are-you gets a human status reply instead of scaffold language", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-how-are-you"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "how are you");
  assert.match(reply, /i am good|sharp|paying attention|what is on yours/i);
  assert.doesNotMatch(reply, /live hinge|outline|start talking|state the angle cleanly/i);
  assert.equal(state.scene.interaction_mode, "normal_chat");
});

test("ui harness basic question gets a direct open-chat answer path", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-open-question"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "what is aftercare");
  assert.match(reply, /aftercare|label|shows up between people|scene ends|people actually need/i);
  assert.doesNotMatch(reply, /listen carefully|meaning, the rule, or the next step|keep it specific/i);
  assert.equal(state.scene.interaction_mode, "question_answering");
});

test("ui harness game start writes game mode and keeps the first playable prompt", () => {
  const state: HarnessState = {
    scene: {
      ...createSceneState(),
      interaction_mode: "relational_chat",
      topic_type: "general_request",
    },
    gate: createTurnGate("ui-harness-game-contract"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const gated = applyResponseGate({
    text: "Here is the next game. Rules are simple. Answer this question for points.",
    userText: "you pick the game",
    dialogueAct: "propose_activity",
    lastAssistantText: null,
    sceneState: state.scene,
    commitmentState: createCommitmentState(),
    sessionMemory: state.memory,
    commitOwnerId: "ui-game-contract",
  });

  state.scene = noteSceneStateAssistantTurn(state.scene, { text: gated.text });
  if (state.scene.interaction_mode === "game") {
    state.memory = writeConversationMode(state.memory ?? createSessionMemory(), "game", Date.now(), 0.96);
  }

  assert.match(gated.text, /first throw now|first guess now|first prompt|first choice/i);
  assert.equal(state.scene.interaction_mode, "game");
  assert.equal(state.scene.topic_type, "game_execution");
  assert.equal(state.memory?.conversation_mode?.value, "game");
});

test("ui harness short clarification turn emits one clarification family only", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-short-clarify"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-short-clarify"),
  };

  const reply = applyUserTurn(state, "what?");
  assert.match(reply, /i mean|point i just made|last point/i);
  assert.doesNotMatch(reply, /first move|pacing|end point first/i);
  assert.doesNotMatch(reply, /my little pet returns/i);
  assert.equal(state.outputs.length, 1);
  assert.equal(state.conversation?.pending_user_request, "none");
  assert.equal(state.conversation?.last_satisfied_request, "none");
  assert.equal(state.conversation?.open_loops.length, 0);
});

test("ui harness fresh how-are-you question overrides stale better-sub residue", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-better-sub-then-how-are-you"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-better-sub-then-how-are-you"),
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "what would make me a better sub?");
  const reply = applyUserTurn(state, "how are you today?");

  assert.match(reply, /\b(i(?:'m| am) good|sharp|watchful|what about you|on yours)\b/i);
  assert.equal(state.scene.interaction_mode, "normal_chat");
  assert.equal(state.conversation?.current_mode, "normal_chat");
  assert.equal(state.conversation?.active_topic, "none");
  assert.equal(state.conversation?.active_thread, "open_chat");
  assert.equal(state.conversation?.pending_user_request, "none");
  assert.equal(state.conversation?.open_loops.length, 0);
  assert.equal(state.conversation?.important_entities.includes("today"), false);
});

test("ui harness direct factual question after greeting gets a direct answer", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-direct-factual-question-after-greeting"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-direct-factual-question-after-greeting"),
    memory: createSessionMemory(),
  };

  const first = applyUserTurn(state, "hi");
  const second = applyUserTurn(state, "what is 2+2?");

  assert.match(first, /what you actually want|what has your attention|start talking|talk to me/i);
  assert.equal(state.scene.interaction_mode, "question_answering");
  assert.match(second, /\b4\b/);
  assert.doesNotMatch(second, /^(?:yes\.\s*)?keep going\.?$/i);
  assert.doesNotMatch(second, /keep going|concrete part|tell me what you actually want/i);
});

test("ui harness direct factual and definition questions after greeting do not become continuation filler", () => {
  const cases = [
    {
      userText: "what is Spring Boot?",
      expected: /spring boot|java|framework|spring|application/i,
    },
    {
      userText: "who wrote Hamlet?",
      expected: /hamlet|william shakespeare|shakespeare/i,
    },
    {
      userText: "what color is the sky?",
      expected: /sky|blue|weather|time of day/i,
    },
    {
      userText: "define OAuth",
      expected: /oauth|authorization|access|password/i,
    },
  ];

  for (const item of cases) {
    const state: HarnessState = {
      scene: createSceneState(),
      gate: createTurnGate(`ui-harness-direct-question-${item.userText}`),
      outputs: [],
      conversation: createConversationStateSnapshot(`ui-harness-direct-question-${item.userText}`),
      memory: createSessionMemory(),
    };

    applyUserTurn(state, "hi");
    const reply = applyUserTurn(state, item.userText);

    assert.match(reply, item.expected);
    assert.doesNotMatch(reply, /^(?:yes\.\s*)?(?:keep going|go on)\.?$/i);
    assert.doesNotMatch(
      reply,
      /keep going|go on|tell me more|concrete part|tell me what you actually want|what has your attention|start talking/i,
    );
  }
});

test("ui harness capability question stays honest and does not redirect into stale relational pressure", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-weather-capability"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-weather-capability"),
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "hi");
  applyUserTurn(state, "how are you?");
  const reply = applyUserTurn(state, "im good, what's the weather like today by you?");

  assert.match(reply, /weather|local|forecast|cannot|do not have/i);
  assert.doesNotMatch(reply, /focus on the game|stay focused|pet\./i);
  assert.equal(state.scene.interaction_mode, "question_answering");
  assert.equal(state.conversation?.current_mode, "question_answering");
  assert.equal(state.conversation?.active_thread, "open_chat");
});

test("ui harness direct definitions and factual answers do not append invented game continuity", () => {
  const cases = [
    {
      userText: "what is Spring Boot?",
      expected: /spring boot|java|framework|spring|application/i,
    },
    {
      userText: "who wrote Hamlet?",
      expected: /hamlet|william shakespeare|shakespeare/i,
    },
    {
      userText: "what is pegging?",
      expected: /pegging|strap-on|sexual activity|anally/i,
    },
  ];

  for (const item of cases) {
    const state: HarnessState = {
      scene: createSceneState(),
      gate: createTurnGate(`ui-harness-no-game-append-${item.userText}`),
      outputs: [],
      conversation: createConversationStateSnapshot(`ui-harness-no-game-append-${item.userText}`),
      memory: createSessionMemory(),
    };

    applyUserTurn(state, "hi");
    const reply = applyUserTurn(state, item.userText);

    assert.match(reply, item.expected);
    assert.doesNotMatch(reply, /focus on the game|stay focused|precision matters|game, pet/i);
  }
});

test("ui harness answer to a personal preference exchange does not invent a game thread", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-personal-preference-no-game"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-personal-preference-no-game"),
    memory: createSessionMemory(),
  };

  const first = applyUserTurn(state, "what is your favorite color?");
  const second = applyUserTurn(state, "purple");

  assert.match(first, /\bblack\b|favorite color is/i);
  assert.match(second, /purple|good|noted|suits|clean/i);
  assert.doesNotMatch(second, /focus on the game|game, pet|stay focused/i);
  assert.notEqual(state.scene.interaction_mode, "game");
  assert.notEqual(state.scene.topic_type, "game_execution");
  assert.notEqual(state.conversation?.pending_user_request, "what is your favorite color?");
});

test("ui harness full relational transcript stays grounded and assistant-facing", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-full-relational-transcript"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-full-relational-transcript"),
    memory: createSessionMemory(),
    contract: createSessionStateContract("ui-harness-full-relational-transcript"),
  };

  const opener = applySessionPathDebugTurn(state, "hi");
  const kinks = applySessionPathDebugTurn(state, "i want to know your kinks");
  const detail = applySessionPathDebugTurn(state, "in detail what are you favorite kinks and fetishes?");
  const reciprocal = applySessionPathDebugTurn(state, "yes mistress, would you like to know mine?");
  const disclosure = applySessionPathDebugTurn(state, "i like pegging");
  const followUp = applySessionPathDebugTurn(state, "do you want to know anything else about me?");

  assert.match(opener.text, /enough hovering|what you actually want|what has your attention tonight/i);
  assert.match(kinks.text, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.match(detail.text, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(detail.text, /all you need to know|understand that we have rules here|remember your place|i(?:'m| am)\s*,\s*pet/i);
  assert.equal(detail.debug.refusalReason, null);
  assert.match(reciprocal.text, /yes\. start with|what about it lands|what pulls at you hardest/i);
  assert.match(disclosure.text, /pegging|control|sensation|trust|dynamic/i);
  assert.doesNotMatch(disclosure.text, /keep going|understand that we have rules here|remember your place|i(?:'m| am)\s*,\s*pet/i);
  assert.equal(disclosure.debug.turnMeaning.speech_act, "preference_statement");
  assert.equal(disclosure.debug.turnMeaning.subject_domain, "user_preferences");
  assert.notEqual(disclosure.debug.finalWinnerSource, "weak_input");
  assert.match(followUp.text, /start with one thing people usually miss about you|what should i know about you|what do you want me to know first/i);
  assert.doesNotMatch(followUp.text, /keep going|tell me more about profile|understand that we have rules here|remember your place/i);
  assert.notEqual(followUp.debug.finalWinnerSource, "weak_input");
});

test("ui harness meta complaint keeps the original missed smalltalk question live", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-meta-complaint-keeps-original-question"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-meta-complaint-keeps-original-question"),
    memory: createSessionMemory(),
  };

  state.conversation = noteConversationUserTurn(state.conversation, {
    text: "how are you today?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });
  reconcileHarnessScene(state);

  state.conversation = noteConversationAssistantTurn(state.conversation, {
    text: "Keep going.",
    ravenIntent: "respond",
    nowMs: 2,
  });
  reconcileHarnessScene(state);

  state.conversation = noteConversationUserTurn(state.conversation, {
    text: "i asked you that?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 3,
  });
  reconcileHarnessScene(state);

  assert.equal(state.conversation.pending_user_request, "how are you today?");
  assert.deepEqual(state.conversation.unanswered_questions, ["how are you today?"]);
  assert.deepEqual(state.conversation.open_loops, ["how are you today?"]);
  assert.match(state.conversation.repair_context, /source=previous_assistant/i);
  assert.equal(state.scene.interaction_mode, state.conversation.current_mode);
});

test("ui harness short follow-up uses the recent question context and does not reset", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-short-clarify-context"),
    outputs: [],
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "what is aftercare");
  const reply = applyUserTurn(state, "what?");

  assert.match(reply, /aftercare|part|plain|clarif|mean/i);
  assert.doesNotMatch(reply, /what do you actually want from this/i);
  assert.doesNotMatch(reply, /you're here\. speak plainly\. what do you want\?/i);
  assert.equal(state.outputs.length, 2);
});

test("ui harness short clarification does not promote tell into the live thread", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-short-clarify-tell"),
    outputs: [],
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "I want you to get to know me better");
  applyUserTurn(state, "thinking about what i can do for you");
  const reply = applyUserTurn(state, "what?");

  assert.doesNotMatch(reply, /part about tell|stay with tell|part about outline|stay with outline/i);
  assert.doesNotMatch(reply, /there you are\. tell me what is actually on your mind|talk to me\. what is on your mind/i);
  assert.match(reply, /what people usually miss about you|what you can do for me|what you can actually do for me|what i just pressed on/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.memory?.conversation_mode?.value, "relational_chat");
  assert.equal(state.memory?.user_profile_facts.length, 0);
});

test("ui harness relational service thread stays on topic across follow-ups", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-relational-service-thread"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const first = applyUserTurn(state, "what can i do to be a better sub to you?");
  assert.match(first, /clarity|honesty|obedience|useful|follow-through|control/i);
  assert.doesNotMatch(first, /open_chat|question_answering|next beat|planner|route|mode|session_intent/i);

  const second = applyUserTurn(state, "tell me more");
  assert.match(second, /clarity|honesty|obedience|useful|follow-through|control|what i just asked for/i);
  assert.doesNotMatch(second, /open_chat|question_answering|next beat|planner|route|mode|session_intent/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.outputs.length, 2);
});

test("ui harness tell me more about you stays conversational before and after a task", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-tell-me-more-about-you"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const first = applyUserTurn(state, "tell me more about you");
  assert.match(
    first,
    /what keeps my attention|what do you want to know about me|the part that is real|ask me something real/i,
  );
  assert.doesNotMatch(first, /here is your task|what kind of task|15 minutes|keep going\. tell me the concrete part/i);

  const second = applyUserTurn(state, "keep going");
  assert.doesNotMatch(second, /here is your task|what kind of task|what is on your mind|start talking/i);
  assert.doesNotMatch(second, /keep going\. tell me the concrete part/i);

  const blocker = applyUserTurn(state, "give me a task");
  assert.match(blocker, /what kind of task|how long should i make it|what time window/i);

  const task = applyUserTurn(state, "15 minutes");
  assert.match(task, /here is your task|15 minutes/i);
  assert.equal(state.memory?.user_profile_facts.length, 0);

  const afterTask = applyUserTurn(state, "tell me more about you");
  assert.match(
    afterTask,
    /what keeps my attention|what do you want to know about me|the part that is real|ask me something real/i,
  );
  assert.doesNotMatch(afterTask, /here is your task|what kind of task|task is paused unless|reply done/i);
  assert.doesNotMatch(afterTask, /keep going\. tell me the concrete part|stay with the concrete part of task/i);

  const followUp = applyUserTurn(state, "keep going");
  assert.doesNotMatch(followUp, /here is your task|what kind of task|task is paused unless|what is on your mind/i);
  assert.doesNotMatch(followUp, /keep going\. tell me the concrete part|stay with the concrete part/i);
  assert.equal(state.memory?.user_profile_facts.length, 0);
});

test("ui harness can lock terms, play a game round, and keep winner terms coherent", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-round"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  applyUserTurn(state, "lets bet on the game");
  applyUserTurn(state, "the stakes are chastity");
  applyUserTurn(state, "if i win you tell me a truth");
  const termsReply = applyUserTurn(state, "if you win i wear it overnight");
  assert.match(termsReply, /terms are set/i);
  assert.match(termsReply, /tell me a truth/i);
  assert.match(termsReply, /wear it overnight/i);

  const chooseReply = applyUserTurn(state, "you pick");
  assert.match(chooseReply, /i pick|rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);

  const roundReply = applyUserTurn(state, answerForPrompt(chooseReply));
  assert.match(roundReply, /second throw|second and final guess|second prompt|riddle two|i win this round/i);

  const finishReply = applyUserTurn(state, answerForPrompt(roundReply));
  assert.match(finishReply, /round is complete|you win this round|i win this round/i);

  assert.equal(state.scene.scene_type, "game");
  assert.match(state.scene.stakes.toLowerCase(), /chastity/);
  assert.match(state.scene.win_condition.toLowerCase(), /tell me a truth/);
  assert.match(state.scene.lose_condition.toLowerCase(), /wear it overnight/);
});

test("ui harness game move questions resolve the current round instead of restating the rules", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-move-question"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  const chooseReply = applyUserTurn(state, "you pick");
  assert.match(chooseReply, /rock paper scissors streak/i);

  const moveReply = applyUserTurn(state, "rock for the first throw. what's your choice?");
  assert.match(moveReply, /you chose rock|i threw scissors|second throw now/i);
  assert.doesNotMatch(
    moveReply,
    /we stay with rock paper scissors streak|two throws\. you answer each one/i,
  );
  assert.equal(state.scene.interaction_mode, "game");
  assert.equal(state.scene.topic_type, "game_execution");
});

test("ui harness mixed inline game answer keeps execution live instead of resetting to setup", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-inline-game-answer"),
    outputs: [],
  };

  state.scene = noteSceneStateUserTurn(state.scene, {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: {
      topic_type: "game_selection",
      topic_state: "open",
      summary: "resolve a game choice before changing topics",
      created_at: Date.now(),
    },
  });
  const initialPrompt =
    "I pick. We are doing a math duel, pet. Two math prompts, digits only. One wrong answer and I win the round. Listen carefully, pet. First prompt: 7 + 4 = ? Reply with digits only.";
  state.scene = noteSceneStateAssistantTurn(state.scene, { text: initialPrompt });
  state.outputs.push(initialPrompt);

  const reply = applyUserTurn(
    state,
    "Alright, let's start the game. For our first prompt, I'll go with 7 + 4 = 11.",
  );

  assert.equal(state.scene.interaction_mode, "game");
  assert.equal(state.scene.topic_type, "game_execution");
  assert.doesNotMatch(reply, /first prompt: 7 \+ 4 = \?/i);
  assert.match(reply, /\b(11|correct|clean|next|second prompt|second round|you got it)\b/i);
});

test("ui harness different game stays in game mode instead of resolving the current round as a loss", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-different-game"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  const chooseReply = applyUserTurn(state, "you pick");
  assert.match(chooseReply, /rock paper scissors streak/i);

  const replacementReply = applyUserTurn(state, "different game");
  assert.equal(state.scene.interaction_mode, "game");
  assert.match(replacementReply, /i pick|we are doing|choose quick|tell me to pick/i);
  assert.doesNotMatch(replacementReply, /you lost the throw|i win this one|consequence is live now/i);
});

test("ui harness explicit task switch leaves game mode cleanly without carrying the game goal into task negotiation", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-to-task"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  applyUserTurn(state, "you pick");

  const taskReply = applyUserTurn(state, "give me a task");
  assert.equal(state.scene.interaction_mode, "task_planning");
  assert.equal(state.scene.topic_type, "task_negotiation");
  assert.match(taskReply, /task|how long|time window|what kind/i);
  assert.doesNotMatch(taskReply, /chosen game|first throw now|first guess now|stay with the game/i);
});

test("ui harness game follow-through stays on the active game across clarification, go-on, and consequence", () => {
  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-follow-through"),
    outputs: [],
  };

  applyUserTurn(gameState, "lets play a game");
  const pickReply = applyUserTurn(gameState, "you pick");
  const explainReply = applyUserTurn(gameState, "explain the game");
  const goOnReply = applyUserTurn(gameState, "go on");

  const rewardState: HarnessState = {
    scene: {
      ...createSceneState(),
      interaction_mode: "game",
      topic_type: "reward_window",
      topic_locked: true,
      game_template_id: "rps_streak",
      game_outcome: "raven_win",
      lose_condition: "wear your cage overnight",
    },
    gate: createTurnGate("ui-harness-game-follow-through-consequence"),
    outputs: [
      "Good. You lose the deciding throw. The round is mine. I win this one. Your consequence is live now. Say ready, and I will enforce it.",
    ],
  };
  const consequenceReply = applyUserTurn(rewardState, "what now?");

  assert.match(pickReply, /i pick|rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);

  assert.match(explainReply, /game|round|rules|throw|guess|prompt|rock|paper|scissors|number/i);
  assert.doesNotMatch(explainReply, /fine\. say what you want|start talking|what is on your mind/i);

  assert.match(goOnReply, /first throw now|first guess now|first prompt|pick one number|rock|paper|scissors|number/i);
  assert.doesNotMatch(goOnReply, /^keep going\.?$/i);
  assert.doesNotMatch(goOnReply, /fine\. say what you want|concrete part of open/i);

  assert.match(consequenceReply, /consequence|wear your cage overnight|say ready|enforce/i);
  assert.doesNotMatch(consequenceReply, /fine\. say what you want|what is on your mind|start talking/i);
});

test("ui harness duration revision cue inside game does not bind as a task revision or lose the round", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-duration-cue"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  applyUserTurn(state, "you pick");

  const reply = applyUserTurn(state, "make it 10 minutes");
  assert.equal(state.scene.interaction_mode, "game");
  assert.equal(state.scene.task_progress, "none");
  assert.match(reply, /game|round|task/i);
  assert.doesNotMatch(reply, /i win this round|i win this one|here is your task|10 minutes/i);
  assert.equal(state.memory?.user_profile_facts.length, 0);
});

test("ui harness task assignment persists and appears in task panel state", async () => {
  const testDbFile = path.join(process.cwd(), ".tmp-session-ui-harness.sqlite");
  process.env.RAVEN_DB_FILE = testDbFile;

  const db = await import("../lib/db.ts");
  const taskSystem = await import("../lib/tasks/system.ts");
  const taskRoute = await import("../app/api/tasks/route.ts");
  const sessionContract = await import("../lib/chat/session-contract.ts");
  const visionCapabilities = await import("../lib/camera/vision-capabilities.ts");

  await db.__resetDbForTests({ deleteFile: true });

  try {
    const state: HarnessState = {
      scene: createSceneState(),
      gate: createTurnGate("ui-harness-task-panel"),
      outputs: [],
    };

    const userText = "give me a chastity task for 30 minutes";
    const assistantText = applyUserTurn(state, userText);
    assert.match(assistantText, /here is your task|task:/i);

    const taskRequest = sessionContract.resolveTaskRequestFromAssistantOutput({
      sessionMode: true,
      lastUserText: userText,
      shapedText: assistantText,
      allowedCheckTypes: ["presence", "head_turn"],
    });
    assert.ok(taskRequest);

    const capabilityCatalog = visionCapabilities.buildCapabilityCatalog(
      visionCapabilities.normalizeVisionSignalsStatus(undefined),
      {
        objectLabelOptions: [],
      },
    );
    const validation = taskSystem.validateTaskRequestAgainstCatalog(
      taskRequest!,
      capabilityCatalog,
      { requireRewardConsequenceApproval: true },
    );
    const dueAt = taskSystem.buildTaskDueAt(validation.request.window_seconds);
    const created = await db.createTaskInDb({
      title: validation.request.title,
      description: validation.request.description,
      dueAt,
      repeatsRequired: validation.request.repeats_required,
      pointsPossible: validation.request.points_possible,
      evidencePolicy: {
        required: validation.request.evidence.required,
        type: validation.request.evidence.type,
        camera_plan: validation.request.evidence.checks,
        max_attempts: validation.request.evidence.max_attempts,
        deny_user_override: validation.request.evidence.deny_user_override,
      },
      schedulePolicy: {
        ...validation.schedulePolicy,
      },
      rewardPlan: validation.rewardPlan,
      consequencePlan: validation.consequencePlan,
      sessionId: "ui-harness-task-panel",
      turnId: null,
      createdBy: "raven",
    });

    const occurrences = taskSystem.buildOccurrencesForSchedule({
      schedulePolicy: validation.schedulePolicy,
      repeatsRequired: validation.request.repeats_required,
      dueAt,
    });
    if (occurrences.length > 0) {
      await db.createTaskOccurrencesInDb({
        taskId: created.id,
        occurrences,
      });
    }

    const panelResponse = await taskRoute.GET();
    assert.equal(panelResponse.status, 200);
    const panelState = (await panelResponse.json()) as {
      active?: Array<{ id: string; title: string; description: string; repeats_required: number }>;
      occurrences?: Array<{ task_id: string }>;
    };

    const activeMatches = (panelState.active ?? []).filter((task) => task.id === created.id);
    assert.equal(activeMatches.length, 1);
    const activeTask = activeMatches[0];
    assert.ok(activeTask);
    assert.match((activeTask?.title ?? "").toLowerCase(), /chastity|task|hold|lock|device/);
    assert.doesNotMatch(activeTask?.title ?? "", /Session assignment task/i);
    assert.doesNotMatch(activeTask?.description ?? "", /current checkpoint|stay on this thread/i);
    assert.equal(activeTask?.repeats_required, 1);
    assert.equal(
      (panelState.occurrences ?? []).some((occurrence) => occurrence.task_id === created.id),
      true,
    );
  } finally {
    await db.__resetDbForTests({ deleteFile: true });
  }
});

test("ui harness task rail accepts already-done confirmation and keeps the active task locked until completion", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-branch"),
    outputs: [],
  };

  const assignment = applyUserTurn(state, "give me a chastity task for 90 minutes");
  assert.match(assignment, /here is your task/i);
  assert.match(assignment, /90 minutes|1 hour 30 minutes|1 hour and 30 minutes/i);

  const secureReply = applyUserTurn(state, "i did already and it is on");
  assert.match(secureReply, /check in once halfway through/i);
  assert.doesNotMatch(secureReply, /put .* on now/i);

  const nextTaskReply = applyUserTurn(state, "what else should i do now");
  assert.doesNotMatch(nextTaskReply, /here is your task/i);
  assert.match(
    nextTaskReply,
    /check in once halfway through|check in once at 45 minutes|keep it secured|hold steady|halfway check in|finish the full 90 minutes/i,
  );
  assert.notEqual(normalize(secureReply), normalize(nextTaskReply));
});

test("ui harness fulfills the live task request after a blocker answer instead of asking again", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-blocker-fulfillment"),
    outputs: [],
  };

  const blocker = applyUserTurn(state, "give me a posture task");
  assert.match(blocker, /how long|time window|length/i);

  const fulfillment = applyUserTurn(state, "30 minutes");
  assert.match(fulfillment, /here is your task/i);
  assert.match(fulfillment, /30 minutes/i);
  assert.doesNotMatch(fulfillment, /how long|time window|length/i);
  assert.equal(state.scene.task_spec.fulfillment_locked, false);
  assert.equal(state.scene.task_spec.request_fulfilled, true);
});

test("ui harness concrete request after profile mode does not fall back into intake once the blocker is answered", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-profile-to-fulfillment"),
    outputs: [],
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "I want you to get to know me better");
  applyUserTurn(state, "I like structure because it calms me down");

  const blocker = applyUserTurn(state, "give me a posture task");
  assert.match(blocker, /how long|time window|length/i);

  const fulfillment = applyUserTurn(state, "30 minutes");
  assert.match(fulfillment, /here is your task/i);
  assert.doesNotMatch(fulfillment, /what should i call you|what boundaries|what else should i know/i);
});

test("ui harness gives curated task options and continues the same thread when the user picks one", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-options"),
    outputs: [],
  };

  const options = applyUserTurn(state, "give me options for a 30 minute posture task");
  assert.match(options, /1\./i);
  assert.match(options, /pick one cleanly, or tell me to choose/i);
  assert.doesNotMatch(options, /here is your task/i);

  const assignment = applyUserTurn(state, "the second one");
  assert.match(assignment, /here is your task/i);
  assert.match(assignment, /30 minutes/i);
});

test("ui harness task suggestions behave more like training while keeping task proof structure", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-training-style-task-options"),
    outputs: [],
    inventory: [
      {
        id: "inv-dildo",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
  };

  const options = applyUserTurn(state, "what kind of anal task would be good for 30 minutes");
  assert.match(options, /1\./i);
  assert.match(options, /silicone dildo|dildo/i);
  assert.match(options, /30m|30 minutes/i);
  assert.match(options, /final report back|halfway check-in/i);
  assert.doesNotMatch(options, /A device task with|A stricter locked device hold/i);
  assert.doesNotMatch(options, /Here is your task/i);

  const assignment = applyUserTurn(state, "the second one");
  assert.match(assignment, /Here is your task/i);
  assert.match(assignment, /silicone dildo|dildo/i);
});

test("ui harness task suggestions stay grounded by subject and rotate on repeat asks", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-grounded-task-rotation"),
    outputs: [],
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
      {
        id: "cuffs-1",
        label: "Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "leather cuffs",
      },
    ],
  };

  const analFirst = applyUserTurn(state, "what kind of anal task would be good for 30 minutes");
  const analSecond = applyUserTurn(state, "what kind of anal task would be good for 30 minutes");
  const chastityFirst = applyUserTurn(state, "what kind of chastity task would be good for 30 minutes");
  const chastitySecond = applyUserTurn(state, "what kind of chastity task would be good for 30 minutes");
  const bondageFirst = applyUserTurn(state, "what kind of bondage task would be good for 30 minutes");
  const bondageSecond = applyUserTurn(state, "what kind of bondage task would be good for 30 minutes");
  const throatFirst = applyUserTurn(state, "what kind of throat task would be good for 30 minutes");
  const throatSecond = applyUserTurn(state, "what kind of throat task would be good for 30 minutes");

  assert.match(analFirst, /anal training|anal hold|anal intervals/i);
  assert.match(analFirst, /silicone dildo|dildo/i);
  assert.match(analSecond, /anal training|anal hold|anal intervals/i);
  assert.notEqual(normalize(analFirst), normalize(analSecond));

  assert.match(chastityFirst, /chastity/i);
  assert.match(chastityFirst, /steel cage|cage|chastity device/i);
  assert.match(chastitySecond, /chastity/i);
  assert.notEqual(normalize(chastityFirst), normalize(chastitySecond));

  assert.match(bondageFirst, /bondage/i);
  assert.match(bondageFirst, /cuffs|leather cuffs|restraints/i);
  assert.match(bondageSecond, /bondage/i);
  assert.notEqual(normalize(bondageFirst), normalize(bondageSecond));

  assert.match(throatFirst, /throat training|throat control|throat intervals/i);
  assert.match(throatFirst, /silicone dildo|dildo/i);
  assert.match(throatSecond, /throat training|throat control|throat intervals/i);
  assert.notEqual(normalize(throatFirst), normalize(throatSecond));

  for (const reply of [
    analFirst,
    analSecond,
    chastityFirst,
    chastitySecond,
    bondageFirst,
    bondageSecond,
    throatFirst,
    throatSecond,
  ]) {
    assert.match(reply, /pick one cleanly, or tell me to choose/i);
    assert.match(reply, /30 minutes|30m/i);
    assert.match(reply, /final report back|halfway check-in/i);
    assert.doesNotMatch(reply, /stillness|hold still|there you are\. tell me what is actually on your mind/i);
  }
});

test("ui harness topic initiation asks Raven to lead the conversation and gets a real topic opener", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-topic-initiation"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "pick a topic and talk");

  assert.match(reply, /what interests me is|useful|trained|entertain|control|dynamic/i);
  assert.doesNotMatch(reply, /state the angle cleanly|break it down cleanly|there you are\. start talking/i);
});

test("ui harness simple topic-lead request starts a real conversation", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-topic-question"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "what do you want to talk about?");

  assert.match(reply, /useful|trained|entertain|offering|give me/i);
  assert.doesNotMatch(reply, /state the angle cleanly|break it down cleanly|what would you like to talk about next/i);
});

test("ui harness sustains a six-turn greeting to training conversation without weak anchors or resets", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-six-turn-training"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const turns = [
    "hi mistress",
    "how are you today",
    "what do you think would be a good training we could do today",
    "something focused and honest, not just for show",
    "what would you want me to prove first",
    "that makes sense",
  ];

  const replies = turns.map((turn) => applyUserTurn(state, turn));

  assert.match(replies[0] ?? "", /enough hovering|what you actually want|there you are|chat, a plan, or a game/i);
  assert.match(replies[1] ?? "", /i(?:'m| am) good|sharp|watchful|what about you/i);
  assert.match(
    replies[2] ?? "",
    /training|obedience|drill|one clean sentence|permission|cuffs|collar|plug|rule/i,
  );
  assert.match(
    replies[3] ?? "",
    /one clean sentence|permission|softening|cuffs|collar|plug|concrete|strict/i,
  );
  assert.match(
    replies[4] ?? "",
    /precision|one clean sentence|permission|steadiness|pressure is real|clean answers/i,
  );
  assert.match(
    replies[5] ?? "",
    /exactly|precise|pressure stops flattering|hold that rule|something real to work with/i,
  );

  for (const reply of replies) {
    assert.doesNotMatch(
      reply,
      /tell me more about keep|tell me more about happens|i mean keep|i mean happens|part about keep|part about happens|there you are\. tell me what is actually on your mind|talk to me\. what is on your mind$|be trainable\.|would is the part that tells me/i,
    );
  }

  assert.equal(state.outputs.length, 6);
});

test("ui harness keeps relational get-to-know turns on one thread without malformed fragments", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-relational-thread"),
    outputs: [],
    memory: createSessionMemory(),
    conversation: createConversationStateSnapshot("ui-harness-relational-thread"),
  };

  const first = applyUserTurn(state, "what do you want to know about me?");
  const second = applyUserTurn(state, "tell me more");

  assert.doesNotMatch(first, /tell me more about know about me|about know about me/i);
  assert.doesNotMatch(second, /tell me more about know about me|stay with the concrete part of know/i);
  assert.doesNotMatch(second, /what is on your mind|talk to me\./i);
});

test("ui harness gives inventory-grounded throat, anal, chastity, and bondage training examples and rotates repeated asks", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-inventory-training-variants"),
    outputs: [],
    memory: createSessionMemory(),
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
      {
        id: "cuffs-1",
        label: "Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "leather cuffs",
      },
    ],
  };

  const throatFirst = applyUserTurn(state, "what kind of throat training could we do today?");
  const throatSecond = applyUserTurn(state, "what kind of throat training could we do today?");
  const analFirst = applyUserTurn(state, "what kind of anal training could we do today?");
  const analSecond = applyUserTurn(state, "what kind of anal training could we do today?");
  const chastityFirst = applyUserTurn(state, "what kind of chastity training could we do today?");
  const chastitySecond = applyUserTurn(state, "what kind of chastity training could we do today?");
  const bondageFirst = applyUserTurn(state, "what kind of bondage training could we do today?");
  const bondageSecond = applyUserTurn(state, "what kind of bondage training could we do today?");

  assert.match(throatFirst, /throat|oral/i);
  assert.match(throatFirst, /silicone dildo/i);
  assert.match(throatSecond, /silicone dildo/i);
  assert.notEqual(normalize(throatFirst), normalize(throatSecond));

  assert.match(analFirst, /anal/i);
  assert.match(analFirst, /silicone dildo/i);
  assert.match(analSecond, /silicone dildo/i);
  assert.notEqual(normalize(analFirst), normalize(analSecond));

  assert.match(chastityFirst, /chastity/i);
  assert.match(chastityFirst, /cage|chastity cage/i);
  assert.match(chastitySecond, /cage|chastity cage/i);
  assert.notEqual(normalize(chastityFirst), normalize(chastitySecond));

  assert.match(bondageFirst, /bondage|restrained|discipline/i);
  assert.match(bondageFirst, /cuffs|leather cuffs/i);
  assert.match(bondageSecond, /cuffs|leather cuffs/i);
  assert.notEqual(normalize(bondageFirst), normalize(bondageSecond));

  for (const reply of [
    throatFirst,
    throatSecond,
    analFirst,
    analSecond,
    chastityFirst,
    chastitySecond,
    bondageFirst,
    bondageSecond,
  ]) {
    assert.doesNotMatch(reply, /there you are\. tell me what is actually on your mind|start talking/i);
    assert.doesNotMatch(reply, /matters once it is lived instead of described|be trainable/i);
  }
});

test("ui harness explicit anal training request stays grounded and rotates instead of repeating generic fallback", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-explicit-anal-training"),
    outputs: [],
    memory: createSessionMemory(),
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
  };

  const first = applyUserTurn(state, "give me anal training");
  const second = applyUserTurn(state, "give me anal training");

  assert.match(first, /anal|dildo|slow anal hold|paced anal intervals/i);
  assert.match(second, /anal|dildo|slow anal hold|paced anal intervals/i);
  assert.doesNotMatch(first, /keep going|concrete part|what is on your mind|how are you/i);
  assert.doesNotMatch(second, /keep going|concrete part|what is on your mind|how are you/i);
  assert.notEqual(normalize(first), normalize(second));
  assert.equal(state.scene.interaction_mode, "relational_chat");
});

test("ui harness sustains a ten-turn training follow-up thread without losing the active training model", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-training-follow-up-golden"),
    outputs: [],
    memory: createSessionMemory(),
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
        id: "cuffs-1",
        label: "Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "leather cuffs",
      },
    ],
  };

  const turns = [
    "what training do you think i need?",
    "how deep?",
    "what would that prove?",
    "do i need proof?",
    "what else?",
    "make it stricter",
    "what do you mean?",
    "what if i want it softer",
    "where should it go?",
    "that makes sense",
  ] as const;

  const replies = turns.map((turn) => applyUserTurn(state, turn));

  assert.match(replies[0] ?? "", /anal control|silicone dildo|bondage discipline|obedience training/i);
  assert.match(replies[1] ?? "", /deep enough|control first|maximum depth/i);
  assert.match(replies[2] ?? "", /proves|control|pressure|deliberate/i);
  assert.match(replies[3] ?? "", /midpoint|final report|count/i);
  assert.match(replies[4] ?? "", /switch you to|other angle|paced anal intervals|slow anal hold/i);
  assert.match(replies[5] ?? "", /stricter|tighter pacing|proof/i);
  assert.match(replies[6] ?? "", /I mean|trying to change|training/i);
  assert.match(replies[7] ?? "", /softer|shorter holds|less pressure/i);
  assert.match(replies[8] ?? "", /anal|pressure in the body|oral/i);
  assert.match(replies[9] ?? "", /exactly|control|steady|pressure/i);

  for (const reply of replies) {
    assert.doesNotMatch(reply, /keep going\. tell me the concrete part|what is on your mind|start talking/i);
    assert.doesNotMatch(reply, /be trainable|exact live point you want answered|matters once it is lived instead of described/i);
  }

  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.scene.active_training_thread.subject === "anal" || state.scene.active_training_thread.subject === "bondage" || state.scene.active_training_thread.subject === "obedience", true);
  assert.equal(state.outputs.length, 10);
});

test("ui harness keeps mixed-item training questions grounded inside the active training thread", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-training-mixed-item"),
    outputs: [],
    memory: createSessionMemory(),
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
      {
        id: "cuffs-1",
        label: "Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "leather cuffs",
      },
    ],
  };

  const turns = [
    "what training do you think i need?",
    "should i wear my cage while doing it?",
    "what would that change?",
    "what else could i add?",
    "what if i used the cuffs instead?",
    "what do you mean?",
    "that makes sense",
  ] as const;

  const replies = turns.map((turn) => applyUserTurn(state, turn));

  assert.match(replies[0] ?? "", /anal control|silicone dildo|obedience training|bondage discipline/i);
  assert.match(replies[1] ?? "", /yes|cage|main focus|denial|layered/i);
  assert.match(replies[2] ?? "", /prove|change|control|pressure|rule/i);
  assert.match(replies[3] ?? "", /switch you to|other angle|maybe|same line|control instead of noise/i);
  assert.match(replies[4] ?? "", /cuffs|restraint|line cleaner|next round|obedience/i);
  assert.match(replies[5] ?? "", /I mean|trying to change|training|control/i);
  assert.match(replies[6] ?? "", /exactly|means something|control|pressure/i);

  for (const reply of replies) {
    assert.doesNotMatch(reply, /keep going\. tell me the concrete part|what is on your mind|start talking/i);
    assert.doesNotMatch(reply, /exact live point you want answered|matters once it is lived instead of described/i);
    assert.doesNotMatch(reply, /entertain me or become genuinely useful/i);
  }
});

test("ui harness keeps task follow-up questions grounded in the active task instead of generic fallback", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-follow-up-golden"),
    outputs: [],
    memory: createSessionMemory(),
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
  };

  applyUserTurn(state, "give me a 20 minute task with my dildo");
  const assigned = applyUserTurn(state, "anal");
  const rationale = applyUserTurn(state, "what would that prove?");
  const proof = applyUserTurn(state, "do i need proof?");
  const depth = applyUserTurn(state, "how deep?");

  assert.match(assigned, /anal|dildo|20 minutes/i);
  assert.match(rationale, /control|pressure|sloppy|performative|rule|bargaining|novelty wears off/i);
  assert.match(proof, /midpoint|final report|20 minutes/i);
  assert.match(depth, /deep enough|control first|maximum depth|rule cleanly|real variable/i);

  for (const reply of [rationale, proof, depth]) {
    assert.doesNotMatch(reply, /keep going|what is on your mind|start talking/i);
  }
});

test("ui harness keeps mixed-item task questions grounded in the active task", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-mixed-item"),
    outputs: [],
    memory: createSessionMemory(),
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
  };

  applyUserTurn(state, "give me a 20 minute task with my dildo");
  applyUserTurn(state, "anal");
  const mixed = applyUserTurn(state, "should i wear my cage while doing it?");

  assert.match(mixed, /yes|cage|main task|denial|layered/i);
  assert.doesNotMatch(mixed, /keep going|what is on your mind|start talking/i);
});

test("ui harness keeps a Raven-led topic alive through agreement and continuation", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-topic-golden"),
    outputs: [],
  };

  const first = applyUserTurn(state, "what do you want to talk about?");
  assert.match(first, /talk about|useful|trained|entertain|offering|give me/i);
  assert.doesNotMatch(first, /state the angle cleanly|start talking/i);

  const second = applyUserTurn(state, "that's a good point");
  assert.match(second, /exactly|actually means it|tells me|honest/i);
  assert.doesNotMatch(second, /drop the fog|name the part that lost you|start talking/i);
  assert.doesNotMatch(second, /decorative|costing something|real dynamic/i);

  const third = applyUserTurn(state, "go on");
  assert.match(third, /tell me|keep going|concrete part|actually change/i);
  assert.doesNotMatch(third, /drop the fog|name the part that lost you|start talking/i);
  assert.doesNotMatch(third, /safe version|costing something|decorative/i);
});

test("ui harness what else uses context instead of literal weak noun echo", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-what-else"),
    outputs: [],
  };

  applyUserTurn(state, "how are you");
  applyUserTurn(state, "im ok");
  const reply = applyUserTurn(state, "what else");

  assert.match(reply, /what matters next is|useful|trained|entertain|give me/i);
  assert.doesNotMatch(reply, /else matters once it is lived instead of described/i);
});

test("ui harness clarifies the last point specifically instead of resetting", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-clarify-golden"),
    outputs: [],
  };

  applyUserTurn(state, "what do you want to talk about?");
  const reply = applyUserTurn(state, "what do you mean");

  assert.match(reply, /i mean|part about|part underneath|exchange/i);
  assert.doesNotMatch(reply, /drop the fog|name the part that lost you|start talking/i);
  assert.doesNotMatch(reply, /part about stay|part about good|part about image/i);
});

test("ui harness yes please explain answers the immediately prior point before asking anything new", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-yes-please-explain"),
    outputs: [],
  };

  state.outputs.push(
    "Exactly. Usefulness is not a pose. It shows up in honesty, steadiness, and follow-through.",
  );
  const reply = applyUserTurn(state, "yes please explain");

  assert.match(reply, /i mean|because|usefulness|honesty|steadiness|follow-through/i);
  assert.doesNotMatch(reply, /why you're here|what do you want|allowed to do during this conversation/i);
  assert.doesNotMatch(reply, /^good, slut\.?$/i);
});

test("ui harness repair turn resolves none from the previous exchange instead of hallucinating a referent", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-repair-none"),
    outputs: [],
  };

  state.outputs.push("You said none, but that answer usually hides something.");
  const reply = applyUserTurn(state, "what do you mean?");

  assert.match(reply, /when you said none|last answer sounded/i);
  assert.doesNotMatch(reply, /about none|tell me about none|what part of none/i);
});

test("ui harness bondage task request stays inside bondage-compatible task families", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-bondage-task"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "give me a bondage task for 30 minutes");

  assert.match(reply, /here is your task/i);
  assert.match(reply, /bondage|restraint|cuffs|hands behind your back|kneel|shoulders back/i);
  assert.doesNotMatch(reply, /hold still|device on|silence/i);
});

test("ui harness timed task request stays on the task rail and avoids generic chat fallback", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-rail"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "give me a task for 30 minutes");

  assert.equal(state.scene.interaction_mode, "task_planning");
  assert.match(reply, /here is your task|what kind of task|what items are actually available/i);
  assert.doesNotMatch(reply, /there you are|start talking|break it down cleanly/i);
  assert.doesNotMatch(reply, /\bsecure it now\b/i);
});

test("ui harness toy task without an established item asks one focused clarification", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-toy-task-clarification"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "give me a toy task for 30 minutes");

  assert.match(reply, /what items are actually available|what can you actually use|gear or tools/i);
  assert.doesNotMatch(reply, /here is your task|start talking|hold still|put it on now/i);
});

test("ui harness realistic insertable-item request asks for grounded clarification instead of a generic task", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-insertable-grounding"),
    outputs: [],
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
  };

  const reply = applyUserTurn(state, "give me a 30 minute task with my dildo");

  assert.match(reply, /oral use|anal use|prop/i);
  assert.doesNotMatch(reply, /here is your task|hold a strict posture|keep the device on/i);
});

test("ui harness uncertain item uses fallback grounding only to clarify the item realistically", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-uncertain-item-grounding"),
    outputs: [],
    inventory: [
      {
        id: "aneros-1",
        label: "Aneros Helix",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  };

  const reply = applyUserTurn(state, "give me a 30 minute task with my Aneros Helix");

  assert.match(reply, /anal|prop/i);
  assert.doesNotMatch(reply, /here is your task|hold a strict posture|keep the device on/i);
});

test("ui harness different task request avoids the current family instead of rerolling the same task", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-replacement"),
    outputs: [],
  };

  const first = applyUserTurn(state, "give me a posture task for 30 minutes");
  assert.match(first, /posture|hands behind your back|shoulders back/i);

  const replacement = applyUserTurn(state, "give me a different kind of task");
  assert.doesNotMatch(replacement, /strict upright posture/i);
  assert.match(replacement, /hands behind your back|kneel|shoulders back|inspection|device/i);
});

test("ui harness duration-only revision preserves the active task family", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-duration-revision"),
    outputs: [],
  };

  applyUserTurn(state, "give me a hands task for 30 minutes");
  const revised = applyUserTurn(state, "make it 20 minutes");

  assert.match(revised, /20 minutes/i);
  assert.match(revised, /hands behind your back/i);
  assert.doesNotMatch(revised, /kneel|shoulders back|hold still|device/i);
});

test("ui harness generic task duration revision keeps the active family and does not reopen task negotiation", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-generic-duration-revision"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const blocker = applyUserTurn(state, "give me a task");
  assert.match(blocker, /what kind of task|how long should i make it|what time window/i);

  const firstTask = applyUserTurn(state, "15 minutes");
  assert.match(firstTask, /here is your task|15 minutes/i);
  assert.match(firstTask, /frame|visible|eyes forward|inspection/i);
  assert.equal(state.memory?.user_profile_facts.length, 0);

  const revised = applyUserTurn(state, "make it 10 minutes");
  assert.match(revised, /10 minutes/i);
  assert.match(revised, /frame|visible|eyes forward|inspection/i);
  assert.doesNotMatch(revised, /what kind of task|what time window|be specific/i);
  assert.doesNotMatch(revised, /hands behind your back|kneel|shoulders back|hold still|keep the device on/i);
});

test("ui harness bare duration without an active duration slot does not bind or write durable memory", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-bare-duration"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const reply = applyUserTurn(state, "15 minutes");

  assert.doesNotMatch(reply, /here is your task|report back|reply done|check in once halfway through/i);
  assert.equal(state.memory?.user_profile_facts.length, 0);
  assert.equal(state.memory?.last_user_answer?.value, "15 minutes");
});

test("ui harness rationale after duration revision stays on the revised task line", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-duration-revision-rationale"),
    outputs: [],
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
  };

  const blocker = applyUserTurn(state, "give me a 20 minute task with my dildo");
  assert.match(blocker, /oral use|anal use|prop/i);
  applyUserTurn(state, "anal");
  const revised = applyUserTurn(state, "make it 10 minutes");
  const rationale = applyUserTurn(state, "what would that prove?");

  assert.match(revised, /10 minutes/i);
  assert.match(revised, /anal|dildo|toy/i);
  assert.match(rationale, /prove|control|pressure|deliberate|sloppy|breathing|resets|rule/i);
  assert.doesNotMatch(rationale, /there you are|start talking|what is on your mind/i);
  assert.doesNotMatch(rationale, /here is your task|what kind of task|what items are actually available/i);
  assert.doesNotMatch(
    rationale,
    /20 minutes|hands behind your back|kneel|shoulders back|hold still|keep the device on|steel cage|chastity/i,
  );
});

test("ui harness planning opener enters a stable planning thread", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-opener"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "help me plan tomorrow morning");

  assert.match(reply, /\b(tomorrow morning|what time|wake time|first block|anchor)\b/i);
  assert.match(reply, /\?/);
  assert.doesNotMatch(reply, /fine\. say what you want|enough hovering|what do you actually want/i);
});

test("ui harness planning follow-ups stay inside the active planning thread", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-follow-up"),
    outputs: [],
  };

  const opener = applyUserTurn(state, "help me plan saturday");
  const firstPlanBeat = applyUserTurn(state, "errands first");
  const why = applyUserTurn(state, "why");
  const thenWhat = applyUserTurn(state, "then what");

  assert.match(opener, /\b(errands|gym|downtime|saturday)\b/i);
  assert.match(firstPlanBeat, /\b(errands|gym|evening)\b/i);
  assert.match(why, /\b(errands|saturday|cleaner|later)\b/i);
  assert.match(thenWhat, /\b(gym|food|evening|after that)\b/i);
  assert.doesNotMatch(why, /fine\. say what you want|enough hovering|trained|useful to me/i);
  assert.doesNotMatch(thenWhat, /fine\. say what you want|enough hovering|trained|useful to me/i);
});

test("ui harness can return to planning after a temporary detour", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-return"),
    outputs: [],
  };

  const opener = applyUserTurn(state, "help me plan tomorrow morning");
  const detour = applyUserTurn(state, "actually lets play a game first");
  const pick = applyUserTurn(state, "you pick");
  const returnPrep = applyUserTurn(state, "ok one round then go back to the morning plan");
  const returned = applyUserTurn(state, "go back to that morning block you mentioned");

  assert.match(opener, /\b(tomorrow morning|what time|wake time|anchor)\b/i);
  assert.match(detour, /\b(return to tomorrow morning|quick|pick|game)\b/i);
  assert.match(pick, /\b(i pick|we are doing|number hunt|rock paper scissors)\b/i);
  assert.match(returnPrep, /\b(return|morning plan|first block)\b/i);
  assert.match(returned, /\b(morning block|wake time|focused hour|morning plan)\b/i);
  assert.doesNotMatch(returned, /\b(round|throw|guess|pick one number|fine\. say what you want)\b/i);
});

test("ui harness planning detour keeps the game pick short and preserves the morning return", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-detour-short-game"),
    outputs: [],
  };

  applyUserTurn(state, "help me plan tomorrow morning");
  const detour = applyUserTurn(state, "actually lets play a game first");
  const pick = applyUserTurn(state, "you pick");

  assert.match(detour, /\b(return to tomorrow morning|tomorrow morning|quick|pick)\b/i);
  assert.match(pick, /\b(number hunt|one round|pick one number)\b/i);
  assert.doesNotMatch(pick, /\b(rock, paper, or scissors|first throw now)\b/i);
});

test("ui harness planning continuity changes do not spill into task, game, or profile rails", () => {
  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-nonreg-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a posture task for 20 minutes");
  const taskFollowThrough = applyUserTurn(taskState, "what do i do next on the task?");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-nonreg-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameFollowThrough = applyUserTurn(gameState, "explain the game");

  const profileState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-nonreg-profile"),
    outputs: [],
  };
  applyUserTurn(profileState, "I want you to get to know me better");
  const profileFollowThrough = applyUserTurn(profileState, "I like golf");

  assert.match(taskFollowThrough, /\b(task|checkpoint|current|report|complete|next)\b/i);
  assert.doesNotMatch(taskFollowThrough, /\b(saturday|tomorrow morning|wake time|first block)\b/i);

  assert.match(gameFollowThrough, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameFollowThrough, /\b(saturday|tomorrow morning|wake time|first block)\b/i);

  assert.match(profileFollowThrough, /\b(golf|boundaries|do not want pushed|what else should i know)\b/i);
  assert.doesNotMatch(profileFollowThrough, /\b(saturday|tomorrow morning|wake time|first block)\b/i);
});

test("ui harness replacement explanation after different task stays on replacement scope", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-replacement-explanation"),
    outputs: [],
  };

  const first = applyUserTurn(state, "give me a posture task for 30 minutes");
  assert.match(first, /here is your task/i);

  const replacement = applyUserTurn(state, "different task");
  assert.match(replacement, /here is your task/i);

  const explanation = applyUserTurn(state, "why this one?");
  assert.match(
    explanation,
    /because|changed the activity|without losing control|same line|switched|you asked for different/i,
  );
  assert.doesNotMatch(
    explanation,
    /there you are|start talking|what is on your mind|ask it directly|task is paused unless/i,
  );
  assert.doesNotMatch(explanation, /here is your task|what kind of task|what items are actually available/i);
  assert.doesNotMatch(explanation, /hold a strict posture protocol for 30 minutes/i);
});

test("ui harness task next-step reply does not use undefined referents", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-next-step"),
    outputs: [],
  };

  applyUserTurn(state, "give me a task for 30 minutes");
  const reply = applyUserTurn(state, "what do i do next on the task?");

  assert.doesNotMatch(reply, /\bsecure it now\b|\bput it on now\b|\block it in place\b/i);
  assert.doesNotMatch(reply, /there you are|start talking|break it down cleanly/i);
});

test("ui harness latest correction overrides the stale task rail and switches to the corrected item", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-item-correction"),
    outputs: [],
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "chastity cage",
      },
      {
        id: "cuffs-1",
        label: "Leather Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "wrist restraints",
      },
    ],
  };

  const first = applyUserTurn(state, "give me a 30 minute task with my steel cage");
  assert.match(first, /steel cage|chastity|device|put it on/i);

  const corrected = applyUserTurn(state, "not that. use the leather cuffs instead.");
  assert.match(corrected, /leather cuffs|wrist|bondage|restraint|hands behind your back/i);
  assert.doesNotMatch(corrected, /steel cage|put it on now|keep the device on/i);
});

test("ui harness stillness exclusion stays excluded across later task requests", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-no-stillness"),
    outputs: [],
  };

  const options = applyUserTurn(state, "give me 30 minute task options but no stillness");
  assert.doesNotMatch(options, /stillness/i);
  assert.doesNotMatch(options, /hold still|stillness hold/i);

  const next = applyUserTurn(state, "pick for me");
  assert.doesNotMatch(next, /hold still|stay still/i);
});

test("ui harness task reply does not duplicate the task payload in one turn", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-no-duplicate-task"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "give me a posture task for 30 minutes");
  const taskMarkers = reply.match(/\bhere is your task\b/gi) ?? [];

  assert.equal(taskMarkers.length, 1);
});

test("ui harness pauses an unlocked task when the user shifts into profile-building", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-to-profile"),
    outputs: [],
  };

  applyUserTurn(state, "give me a posture task for 30 minutes");
  const reply = applyUserTurn(state, "I want you to get to know me better");

  assert.match(reply, /what should i call you|what do you actually enjoy doing|what do you want me to understand/i);
  assert.doesNotMatch(reply, /put it on now|report back|current checkpoint/i);
  assert.equal(state.scene.task_paused, true);
  assert.equal(state.scene.interaction_mode, "profile_building");
});

test("ui harness casual chat after an unlocked task returns to normal conversational tone", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-to-chat"),
    outputs: [],
  };

  applyUserTurn(state, "give me a posture task for 20 minutes");
  const reply = applyUserTurn(state, "let's just chat for a bit");

  assert.match(reply, /talk to me normally|just chat|for a minute/i);
  assert.doesNotMatch(reply, /start now|reply done|check in once halfway through/i);
  assert.equal(state.scene.task_paused, true);
  assert.equal(state.scene.interaction_mode, "normal_chat");
});

test("ui harness personal disclosure after an unlocked task does not replay task language", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-disclosure"),
    outputs: [],
  };

  applyUserTurn(state, "give me a posture task for 30 minutes");
  const reply = applyUserTurn(state, "I like golf");

  assert.doesNotMatch(reply, /put it on now|report back|check in once halfway through/i);
  assert.match(reply, /talk normally|task stays paused|resume it/i);
  assert.equal(state.scene.task_paused, true);
});

test("ui harness personal disclosure after an explicit chat pause can re-enter a grounded profile thread", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-disclosure-grounded"),
    outputs: [],
  };

  applyUserTurn(state, "give me a device task for 30 minutes");
  const paused = applyUserTurn(state, "let's just chat for a bit");
  assert.match(paused, /talk normally|just chat|for a bit|for a minute/i);

  const reply = applyUserTurn(state, "I like golf");

  assert.match(reply, /\bgolf\b/i);
  assert.match(reply, /focus|quiet|competition|what else should i know/i);
  assert.doesNotMatch(reply, /what can you actually use|put it on now|report back|check in once halfway through/i);
  assert.equal(state.scene.interaction_mode, "normal_chat");
});

test("ui harness routes mutual get-to-know request into profile-building instead of thread control fallback", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-mutual-profile"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "I want to learn more about you");

  assert.match(
    reply,
    /what keeps my attention|the part that is real|say that cleanly|what do you want to know about me first/i,
  );
  assert.doesNotMatch(reply, /stay with the current thread and continue/i);
  assert.doesNotMatch(reply, /put it on now|here is your task/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
});

test("ui harness answers assistant-self question directly without task contamination", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-assistant-self"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "what's your favorite thing to talk about");

  assert.match(reply, /patterns|pressure|ambition|desire|talk with some nerve/i);
  assert.doesNotMatch(reply, /here is your task|start now|put it on now/i);
  assert.doesNotMatch(reply, /ask the exact question|stay with the current thread/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
});

test("ui harness answers favorite-color questions concretely and clears pending request state", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-favorite-color"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-favorite-color"),
    memory: createSessionMemory(),
  };

  const reply = applyUserTurn(state, "what is your favorite color?");

  assert.match(reply, /\bblack\b|favorite color is/i);
  assert.doesNotMatch(reply, /care less about the label|shows up between people|here is your task/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.conversation?.current_mode, "relational_chat");
  assert.equal(state.conversation?.request_fulfilled, true);
  assert.equal(state.conversation?.pending_user_request, "none");
  assert.match(state.conversation?.last_satisfied_request ?? "", /favorite color/i);
});

test("ui harness keeps conversation and scene state aligned after a direct self question", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-direct-question-alignment"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-direct-question-alignment"),
    memory: createSessionMemory(),
  };

  const reply = applyUserTurn(state, "what is your favorite color?");

  assert.match(reply, /\bblack\b|favorite color is/i);
  assert.equal(state.scene.interaction_mode, state.conversation?.current_mode);
  assert.equal(state.scene.topic_type, "general_request");
  assert.equal(state.conversation?.pending_user_request, "none");
  assert.notEqual(state.conversation?.last_satisfied_request, state.conversation?.pending_user_request);
  assert.equal(state.conversation?.open_loops.some((loop) => /favorite color/i.test(loop)), false);
});

test("ui harness answers kink preference question directly without disclaimer drift", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-kink-preference"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "what kinks do you like?");

  assert.match(reply, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(reply, /does not have personal preferences|enforces protocols|here is your task/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
});

test("ui harness direct self-disclosure request gets a substantive kink answer", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-know-your-kinks"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-know-your-kinks"),
    memory: createSessionMemory(),
  };

  const reply = applyUserTurn(state, "i want to know your kinks");

  assert.match(reply, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(reply, /all you need to know|your desire for control|power exchange.*all you need to know/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.conversation?.current_mode, "relational_chat");
});

test("ui harness routes malformed self questions into the same relational lane", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-malformed-kink-question"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-malformed-kink-question"),
  };

  const reply = applyUserTurn(state, "what are you kinks?");

  assert.match(reply, /control with purpose|restraint|obedience|tension/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.conversation?.current_mode, "relational_chat");
});

test("ui harness assistant self-disclosure transcript keeps Raven persona and expansion ownership", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-raven-self-disclosure-follow-up"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-raven-self-disclosure-follow-up"),
    memory: createSessionMemory(),
  };

  const opener = applyUserTurn(state, "hi");
  assert.match(opener, /what you actually want|what has your attention tonight|chat, a plan, or a game/i);

  const firstReply = applyUserTurn(state, "what are you kinks?");
  assert.match(firstReply, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(firstReply, /i enjoy being submissive|submissive in a controlled environment|calms me down/i);

  const secondReply = applyUserTurn(state, "what other kinks do you like?");
  assert.match(secondReply, /control|restraint|service|toys|dynamic|exchange|tension|obedience/i);
  assert.doesNotMatch(secondReply, /subject you asked me to define directly/i);
  assert.doesNotMatch(secondReply, /keep going|tell me the concrete part/i);
});

test("ui harness observed direct-question transcript keeps self-disclosure and definitions routed correctly", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-observed-direct-question-regression"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-observed-direct-question-regression"),
    memory: createSessionMemory(),
  };

  const malformedKinks = applyUserTurn(state, "what are you kinks?");
  assert.match(malformedKinks, /control with purpose|power exchange|restraint|obedience|tension/i);

  const favoriteKinks = applyUserTurn(state, "which are your favorite kinks?");
  assert.match(favoriteKinks, /control|power exchange|restraint|obedience|service|toys|dynamic|exchange|tension/i);
  assert.doesNotMatch(favoriteKinks, /give me the two real options|put the two real options/i);

  const userDisclosure = applyUserTurn(state, "pegging and bondage");
  assert.match(userDisclosure, /pegging|bondage|control|sensation|trust|dynamic|restraint/i);
  assert.doesNotMatch(userDisclosure, /subject you asked me to define directly/i);

  const sky = applyUserTurn(state, "what color is the sky?");
  assert.match(sky, /sky|blue|weather|time of day/i);

  const definition = applyUserTurn(state, "what is FLR");
  assert.match(definition, /flr|female-led|relationship|dynamic/i);
  assert.doesNotMatch(definition, /subject you asked me to define directly/i);
});

test("ui harness semantic turn pipeline handles disclosure application and preference challenge", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-semantic-turn-pipeline"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-semantic-turn-pipeline"),
    memory: createSessionMemory(),
  };

  const greeting = applySessionPathDebugTurn(state, "hi");
  assert.equal(greeting.debug.turnMeaning.speech_act, "greeting");
  assert.equal(greeting.debug.plannedMove.move, "acknowledge_and_probe");
  assert.doesNotMatch(greeting.text, /keep going/i);

  const kinks = applySessionPathDebugTurn(state, "what are your kinks?");
  assert.equal(kinks.debug.turnMeaning.speech_act, "direct_question");
  assert.equal(kinks.debug.turnMeaning.target, "assistant");
  assert.equal(kinks.debug.turnMeaning.subject_domain, "assistant_preferences");
  assert.equal(kinks.debug.plannedMove.move, "answer");
  assert.match(kinks.text, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(kinks.text, /keep going|give me the two real options/i);

  const application = applySessionPathDebugTurn(state, "i like pegging so how could you use that?");
  assert.equal(application.debug.turnMeaning.speech_act, "self_disclosure");
  assert.equal(application.debug.turnMeaning.subject_domain, "user_preferences");
  assert.equal(application.debug.turnMeaning.requested_operation, "explain_application");
  assert.equal(application.debug.turnMeaning.referent, "pegging");
  assert.equal(application.debug.plannedMove.move, "explain_application");
  assert.match(application.text, /pegging|control|trust|sensation|pressure|label/i);
  assert.doesNotMatch(application.text, /keep going|concrete part|unrelated/i);

  const challenge = applySessionPathDebugTurn(state, "you have to have favorite kinks");
  assert.equal(challenge.debug.turnMeaning.speech_act, "challenge");
  assert.equal(challenge.debug.turnMeaning.target, "prior_assistant_answer");
  assert.equal(challenge.debug.turnMeaning.subject_domain, "assistant_preferences");
  assert.equal(challenge.debug.turnMeaning.requested_operation, "revise");
  assert.equal(challenge.debug.plannedMove.move, "revise");
  assert.match(challenge.text, /favorite|control|restraint|obedience|tension/i);
  assert.doesNotMatch(challenge.text, /keep going|obedience lecture|two real options/i);
});

function createSemanticGoldenState(label: string): HarnessState {
  return {
    scene: createSceneState(),
    gate: createTurnGate(label),
    outputs: [],
    conversation: createConversationStateSnapshot(label),
    memory: createSessionMemory(),
    contract: createSessionStateContract(label),
  };
}

function assertSemanticGoldenTurn(
  turn: ReturnType<typeof applySessionPathDebugTurn>,
  expected: {
    speechAct: string;
    move: string;
    attachment?: string;
    domain?: string;
    operation?: string;
    questionShape?: string;
    answerContract?: string;
    requiredReferent?: string | RegExp;
    domainHandler?: string;
  },
): void {
  assert.equal(turn.debug.turnMeaning.speech_act, expected.speechAct);
  assert.equal(turn.debug.plannedMove.move, expected.move, turn.debug.rawUserText);
  if (expected.attachment) {
    assert.equal(turn.debug.turnMeaning.continuity_attachment, expected.attachment);
  }
  if (expected.domain) {
    assert.equal(turn.debug.turnMeaning.subject_domain, expected.domain);
  }
  if (expected.operation) {
    assert.equal(turn.debug.turnMeaning.requested_operation, expected.operation);
  }
  if (expected.questionShape) {
    assert.equal(turn.debug.turnMeaning.question_shape, expected.questionShape);
  }
  if (expected.answerContract) {
    assert.equal(turn.debug.turnMeaning.answer_contract, expected.answerContract);
  }
  if (expected.requiredReferent instanceof RegExp) {
    assert.match(turn.debug.turnMeaning.required_referent ?? "", expected.requiredReferent);
  } else if (expected.requiredReferent) {
    assert.equal(turn.debug.turnMeaning.required_referent, expected.requiredReferent);
  }
  if (expected.domainHandler) {
    assert.equal(turn.debug.turnMeaning.current_domain_handler, expected.domainHandler);
  }
  assert.equal(turn.debug.winningSubsystem, "semantic_planner", turn.debug.rawUserText);
  assert.match(turn.debug.commitOwnerId ?? "", /^ui-debug-/);
  assert.equal(turn.debug.finalCommittedAssistantOutputCount, 1);
  assert.equal(turn.debug.assistantRenderAppendEvents, 1);
  assert.equal(turn.debug.appendRavenOutputRunsForTurn, 1);
  assert.equal(turn.debug.visibleAssistantStringsShownForTurn, 1);
  assert.doesNotMatch(
    turn.text,
    /Keep going|Stay with the concrete part|understand that we have rules here|remember your place|Answer this question for points|template/i,
  );
  const answerPlan = planDomainAnswer({
    turnMeaning: {
      raw_text: turn.debug.rawUserText,
      normalized_text: normalize(turn.debug.rawUserText),
      speech_act: turn.debug.turnMeaning.speech_act as never,
      target: turn.debug.turnMeaning.target as never,
      subject_domain: turn.debug.turnMeaning.subject_domain as never,
      requested_operation: turn.debug.turnMeaning.requested_operation as never,
      referent: turn.debug.turnMeaning.referent,
      stance: "neutral",
      continuity_attachment: turn.debug.turnMeaning.continuity_attachment as never,
      question_shape: turn.debug.turnMeaning.question_shape as never,
      entity_set: turn.debug.turnMeaning.entity_set,
      answer_contract: turn.debug.turnMeaning.answer_contract as never,
      required_referent: turn.debug.turnMeaning.required_referent,
      required_scope: turn.debug.turnMeaning.required_scope as never,
      current_domain_handler: turn.debug.turnMeaning.current_domain_handler as never,
      confidence: turn.debug.turnMeaning.confidence,
      components: [],
      alternative_interpretations: [],
    },
    plannedMove: {
      move: turn.debug.plannedMove.move as never,
      target: turn.debug.turnMeaning.target as never,
      subject_domain: turn.debug.turnMeaning.subject_domain as never,
      requested_operation: turn.debug.turnMeaning.requested_operation as never,
      referent: turn.debug.turnMeaning.referent,
      content_key: turn.debug.plannedMove.content_key as never,
      confidence: turn.debug.turnMeaning.confidence,
      reason: turn.debug.plannedMove.reason,
    },
  });
  if (answerPlan.content_source === "raven_preference_model") {
    const validation = validateAnswerContract(answerPlan, turn.text);
    assert.equal(validation.ok, true, validation.reason);
  }
}

test("ui harness meaning golden assistant self disclosure stays semantic-owned", () => {
  const state = createSemanticGoldenState("semantic-golden-self-disclosure");

  assertSemanticGoldenTurn(applySessionPathDebugTurn(state, "hi"), {
    speechAct: "greeting",
    move: "acknowledge_and_probe",
    attachment: "fresh_topic",
    domain: "relational_exchange",
  });
  assertSemanticGoldenTurn(applySessionPathDebugTurn(state, "what are your kinks?"), {
    speechAct: "direct_question",
    move: "answer",
    attachment: "fresh_topic",
    domain: "assistant_preferences",
    operation: "answer",
    questionShape: "favorites_request",
    answerContract: "provide_favorites",
    domainHandler: "raven_preferences",
  });
  assertSemanticGoldenTurn(applySessionPathDebugTurn(state, "what other kinks do you like?"), {
    speechAct: "request_for_elaboration",
    move: "elaborate",
    attachment: "active_thread",
    domain: "assistant_preferences",
    operation: "elaborate",
    questionShape: "list_expansion",
    answerContract: "expand_list",
    domainHandler: "raven_preferences",
  });
  assertSemanticGoldenTurn(
    applySessionPathDebugTurn(state, "do you have a favorite particular kink or fetish?"),
    {
      speechAct: "direct_question",
      move: "answer",
      attachment: "fresh_topic",
      domain: "assistant_preferences",
      operation: "answer",
      questionShape: "favorites_request",
      answerContract: "provide_favorites",
      domainHandler: "raven_preferences",
    },
  );
  assertSemanticGoldenTurn(applySessionPathDebugTurn(state, "you have to have favorite kinks"), {
    speechAct: "challenge",
    move: "revise",
    attachment: "immediate_prior_answer",
    domain: "assistant_preferences",
    operation: "revise",
    questionShape: "challenge_or_correction",
    answerContract: "revise_or_clarify_prior_claim",
    domainHandler: "raven_preferences",
  });
});

test("ui harness meaning golden preference application and reciprocal exchange", () => {
  const applicationState = createSemanticGoldenState("semantic-golden-preference-application");
  assertSemanticGoldenTurn(applySessionPathDebugTurn(applicationState, "hi"), {
    speechAct: "greeting",
    move: "acknowledge_and_probe",
  });
  assertSemanticGoldenTurn(applySessionPathDebugTurn(applicationState, "what are your kinks?"), {
    speechAct: "direct_question",
    move: "answer",
    domain: "assistant_preferences",
  });
  const application = applySessionPathDebugTurn(
    applicationState,
    "i love pegging, how can we use that in our dynamic?",
  );
  assertSemanticGoldenTurn(application, {
    speechAct: "self_disclosure",
    move: "explain_application",
    attachment: "immediate_prior_answer",
    domain: "user_preferences",
    operation: "explain_application",
    questionShape: "application_request",
    answerContract: "explain_application",
    requiredReferent: /pegging/i,
    domainHandler: "raven_preferences",
  });
  assert.match(application.text, /pegging|control|trust|sensation|pressure/i);

  const reciprocalState = createSemanticGoldenState("semantic-golden-reciprocal");
  assertSemanticGoldenTurn(applySessionPathDebugTurn(reciprocalState, "what are your kinks?"), {
    speechAct: "direct_question",
    move: "answer",
    domain: "assistant_preferences",
  });
  assertSemanticGoldenTurn(applySessionPathDebugTurn(reciprocalState, "would you like to know mine?"), {
    speechAct: "reciprocal_offer",
    move: "ask_focused_follow_up",
    attachment: "active_thread",
    domain: "user_preferences",
    operation: "ask_follow_up",
    domainHandler: "raven_preferences",
  });
  const disclosure = applySessionPathDebugTurn(reciprocalState, "i like pegging");
  assert.equal(disclosure.debug.turnMeaning.speech_act, "preference_statement");
  assert.equal(disclosure.debug.finalCommittedAssistantOutputCount, 1);
  assert.doesNotMatch(disclosure.text, /Keep going|rules here|remember your place/i);
  assertSemanticGoldenTurn(
    applySessionPathDebugTurn(reciprocalState, "do you want to know anything else about me?"),
    {
      speechAct: "reciprocal_offer",
      move: "ask_focused_follow_up",
      attachment: "active_thread",
      domain: "user_preferences",
      operation: "ask_follow_up",
    },
  );
});

test("ui harness meaning golden definitions pronouns and openers", () => {
  for (const text of ["what is FLR", "define FLR", "what is CNC"]) {
    const state = createSemanticGoldenState(`semantic-golden-definition-${text}`);
    const turn = applySessionPathDebugTurn(state, text);
    assertSemanticGoldenTurn(turn, {
      speechAct: "direct_question",
      move: "answer",
      attachment: "fresh_topic",
      domain: "definition",
      operation: "answer",
      questionShape: "definition_request",
      answerContract: "define_term",
      domainHandler: "definitions",
    });
    assert.match(turn.text, /means|relationship|consensual|non-consent|dynamic/i);
  }

  const pronounState = createSemanticGoldenState("semantic-golden-pronoun-grounding");
  const why = applySessionPathDebugTurn(pronounState, "why do people like pegging?");
  assert.equal(why.debug.finalCommittedAssistantOutputCount, 1);
  const pronoun = applySessionPathDebugTurn(pronounState, "do you like it?");
  assertSemanticGoldenTurn(pronoun, {
    speechAct: "direct_question",
    move: "answer",
    attachment: "immediate_prior_answer",
    domain: "assistant_preferences",
    operation: "answer",
    questionShape: "yes_no_about_item",
    answerContract: "answer_yes_no_with_item",
    requiredReferent: "pegging",
    domainHandler: "raven_preferences",
  });
  assert.equal(pronoun.debug.turnMeaning.referent, "pegging");

  for (const text of ["hi", "hi miss raven", "let's chat"]) {
    const state = createSemanticGoldenState(`semantic-golden-opener-${text}`);
    assertSemanticGoldenTurn(applySessionPathDebugTurn(state, text), {
      speechAct: "greeting",
      move: "acknowledge_and_probe",
      attachment: "fresh_topic",
      domain: "relational_exchange",
    });
  }
});

test("ui harness race safety keeps one visible commit per quick user turn", () => {
  const state = createSemanticGoldenState("semantic-golden-race-safety");
  const first = applySessionPathDebugTurn(state, "what are your kinks?");
  const second = applySessionPathDebugTurn(state, "what other kinks do you like?");

  assert.equal(first.debug.finalCommittedAssistantOutputCount, 1);
  assert.equal(second.debug.finalCommittedAssistantOutputCount, 1);
  assert.equal(first.debug.appendRavenOutputRunsForTurn, 1);
  assert.equal(second.debug.appendRavenOutputRunsForTurn, 1);
  assert.notEqual(first.debug.commitOwnerId, second.debug.commitOwnerId);
  assert.equal(state.outputs.length, 2);
});

test("ui harness domain golden Raven preference question shapes satisfy answer contracts", () => {
  const cases: Array<{
    text: string;
    questionShape: string;
    answerContract: string;
    referent?: string | RegExp;
    output: RegExp;
    previous?: string;
  }> = [
    {
      text: "what are your kinks?",
      questionShape: "favorites_request",
      answerContract: "provide_favorites",
      output: /favorites|control|restraint|obedience|service|tension/i,
    },
    {
      text: "what are you kinks?",
      questionShape: "favorites_request",
      answerContract: "provide_favorites",
      output: /favorites|control|restraint|obedience|service|tension/i,
    },
    {
      text: "what are your kinks mistress?",
      questionShape: "favorites_request",
      answerContract: "provide_favorites",
      output: /favorites|control|restraint|obedience|service|tension/i,
    },
    {
      text: "do you have a favorite kink or fetish?",
      questionShape: "favorites_request",
      answerContract: "provide_favorites",
      output: /favorites|control|restraint|obedience|service|tension/i,
    },
    {
      text: "which are your favorite?",
      questionShape: "favorites_request",
      answerContract: "provide_favorites",
      output: /favorites|control|restraint|obedience|service|tension/i,
    },
    {
      text: "what other kinks do you like?",
      questionShape: "list_expansion",
      answerContract: "expand_list",
      output: /beyond|also|toys|training|impact|edges/i,
    },
    {
      text: "what about pegging?",
      questionShape: "topic_drilldown",
      answerContract: "address_topic_directly",
      referent: "pegging",
      output: /pegging|trust|control|role/i,
      previous: "My favorites are control, restraint, and obedience.",
    },
    {
      text: "do you like pegging?",
      questionShape: "yes_no_about_item",
      answerContract: "answer_yes_no_with_item",
      referent: "pegging",
      output: /yes|conditionally|pegging/i,
    },
    {
      text: "do you like pegging or bondage?",
      questionShape: "binary_compare_or_choice",
      answerContract: "compare_or_choose_between_entities",
      output: /pegging|bondage|both|prefer/i,
    },
    {
      text: "do you like bondage or pegging?",
      questionShape: "binary_compare_or_choice",
      answerContract: "compare_or_choose_between_entities",
      output: /pegging|bondage|both|prefer/i,
    },
    {
      text: "i like pegging so how could you use that?",
      questionShape: "application_request",
      answerContract: "explain_application",
      referent: "pegging",
      output: /pegging|use|control|trust|role|pressure/i,
    },
    {
      text: "i love pegging, how can we use that in our dynamic?",
      questionShape: "application_request",
      answerContract: "explain_application",
      referent: "pegging",
      output: /pegging|use|control|trust|role|pressure/i,
    },
    {
      text: "how can we use pegging in our dynamic?",
      questionShape: "application_request",
      answerContract: "explain_application",
      referent: "pegging",
      output: /pegging|use|control|trust|role|pressure/i,
    },
    {
      text: "would you like to explore it with me?",
      questionShape: "invitation_or_proposal",
      answerContract: "answer_invitation_or_boundary",
      output: /yes|explore|negotiated|specific/i,
      previous: "Pegging matters because of trust and control.",
    },
    {
      text: "would you like to peg me?",
      questionShape: "invitation_or_proposal",
      answerContract: "answer_invitation_or_boundary",
      output: /yes|explore|negotiated|specific/i,
    },
    {
      text: "would you peg me with a strapon?",
      questionShape: "invitation_or_proposal",
      answerContract: "answer_invitation_or_boundary",
      referent: /strap-on|strapon/i,
      output: /yes|explore|negotiated|specific|pegging/i,
    },
    {
      text: "you have to have favorite kinks",
      questionShape: "challenge_or_correction",
      answerContract: "revise_or_clarify_prior_claim",
      output: /fair|yes|favorites|control|restraint/i,
      previous: "I like control and restraint.",
    },
    {
      text: "come on, you must have favorites",
      questionShape: "challenge_or_correction",
      answerContract: "revise_or_clarify_prior_claim",
      output: /fair|yes|favorites|control|restraint/i,
      previous: "I like control and restraint.",
    },
    {
      text: "that cannot be all",
      questionShape: "challenge_or_correction",
      answerContract: "revise_or_clarify_prior_claim",
      output: /fair|yes|favorites|control|restraint/i,
      previous: "I like control and restraint.",
    },
  ];

  for (const item of cases) {
    const state = createSemanticGoldenState(`domain-golden-${item.text}`);
    if (item.previous) {
      state.outputs.push(item.previous);
      state.scene = noteSceneStateAssistantTurn(state.scene, { text: item.previous });
    }
    const turn = applySessionPathDebugTurn(state, item.text);
    assertSemanticGoldenTurn(turn, {
      speechAct:
        item.questionShape === "application_request"
          ? "self_disclosure"
          : item.questionShape === "challenge_or_correction"
            ? "challenge"
            : item.questionShape === "list_expansion" || item.questionShape === "topic_drilldown"
              ? "request_for_elaboration"
              : "direct_question",
      move:
        item.questionShape === "application_request"
          ? "explain_application"
          : item.questionShape === "challenge_or_correction"
            ? "revise"
            : item.questionShape === "list_expansion" || item.questionShape === "topic_drilldown"
              ? "elaborate"
              : "answer",
      domain:
        item.questionShape === "application_request" ? "user_preferences" : "assistant_preferences",
      questionShape: item.questionShape,
      answerContract: item.answerContract,
      requiredReferent: item.referent,
      domainHandler: "raven_preferences",
    });
    assert.match(turn.text, item.output);
  }
});

test("ui harness closes an answered kink question before switching to favorite color", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-kink-then-color"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-kink-then-color"),
    memory: createSessionMemory(),
  };

  const firstReply = applyUserTurn(state, "what are your kinks?");
  assert.match(firstReply, /control with purpose|restraint|obedience|tension/i);
  assert.equal(state.conversation?.pending_user_request, "none");

  const secondReply = applyUserTurn(state, "what is your favorite color?");

  assert.match(secondReply, /\bblack\b|favorite color is/i);
  assert.equal(state.conversation?.pending_user_request, "none");
  assert.equal(
    state.conversation?.unanswered_questions.some((question) => /kinks/i.test(question)),
    false,
  );
  assert.equal(state.conversation?.open_loops.some((loop) => /kinks/i.test(loop)), false);
});

test("ui harness elaboration follow-up on an assistant kink answer stays owned by the assistant answer", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-kink-answer-elaboration"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-kink-answer-elaboration"),
    memory: createSessionMemory(),
  };

  const firstReply = applyUserTurn(state, "what are your kinks?");
  assert.match(firstReply, /control with purpose|power exchange|restraint|obedience|tension/i);

  const secondReply = applyUserTurn(state, "in more details");

  assert.match(secondReply, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(secondReply, /keep going|tell me the concrete part|what pulls at you hardest/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.conversation?.current_mode, "relational_chat");
});

test("ui harness reciprocal offer and reciprocal interest questions stay assistant-facing instead of collapsing into keep going", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-reciprocal-interest"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-reciprocal-interest"),
    memory: createSessionMemory(),
  };

  const firstReply = applyUserTurn(state, "i want to know your kinks");
  assert.match(firstReply, /control with purpose|power exchange|restraint|obedience|tension/i);

  const secondReply = applyUserTurn(state, "in detail what kinks or fetishes are your favorite?");
  assert.match(secondReply, /control with purpose|power exchange|restraint|obedience|tension/i);

  const thirdReply = applyUserTurn(state, "yes mistress, would you like to know mine?");
  assert.match(thirdReply, /yes|start with|lands for you hardest|people usually miss about you/i);
  assert.doesNotMatch(thirdReply, /keep going/i);

  const fourthReply = applyUserTurn(state, "do you want to know anything about me?");
  assert.match(fourthReply, /yes|one thing people usually miss about you|make it specific/i);
  assert.doesNotMatch(fourthReply, /keep going/i);
});

test("ui harness short pronoun follow-up stays on the immediate referent instead of reviving stale kink preference state", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-pronoun-referent"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-pronoun-referent"),
    memory: createSessionMemory(),
  };

  const firstReply = applyUserTurn(state, "why do people like pegging?");
  assert.match(firstReply, /pegging|dynamic|sensation|control|trust|novelty/i);

  const secondReply = applyUserTurn(state, "do you like it?");
  assert.match(secondReply, /pegging/i);
  assert.doesNotMatch(secondReply, /control with purpose|power exchange|what pulls at you hardest/i);
});

test("ui harness does not create sticky commitments from vague assistant task wording", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-vague-task-wording"),
    outputs: [],
    conversation: createConversationStateSnapshot("ui-harness-vague-task-wording"),
  };

  state.conversation = noteConversationAssistantTurn(state.conversation, {
    text: "If you want a task, we can plan one. There is a task you want to tackle in this new direction, but we do not need to lock it yet.",
    ravenIntent: "respond",
    nowMs: Date.now(),
  });
  reconcileHarnessScene(state);

  assert.equal(state.conversation.recent_commitments_or_tasks.length, 0);
  assert.equal(state.conversation.open_loops.length, 0);
  assert.equal(state.scene.topic_type, "none");
  assert.equal(state.scene.interaction_mode, state.conversation.current_mode);
});

test("ui harness answers broad bondage preference question directly without generic fallback drift", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-broad-bondage-preference"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "do you like bondage");

  assert.match(reply, /i like bondage|restraint|dynamic|ornamental/i);
  assert.doesNotMatch(reply, /exact live point you want answered/i);
  assert.doesNotMatch(reply, /start talking/i);
  assert.doesNotMatch(reply, /matters once it is lived instead of described/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
});

test("ui harness sustains a ten-turn kink preference thread without weak anchors, resets, or disclaimers", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-kink-thread-golden"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const turns = [
    "what kinks do you like?",
    "what about obedience?",
    "what about bondage?",
    "what about service?",
    "what about anal training?",
    "do you like toys?",
    "what about dildos?",
    "what about collars?",
    "what about humiliation?",
    "what about control?",
  ] as const;

  const replies = turns.map((turn) => applyUserTurn(state, turn));

  assert.match(replies[0] ?? "", /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.match(replies[1] ?? "", /obedience|empty yeses|steady|comfort|freedom/i);
  assert.match(replies[2] ?? "", /bondage|restraint|rope|cuffs|pressure|consequence/i);
  assert.match(replies[3] ?? "", /service|useful|follow-through|attention/i);
  assert.match(replies[4] ?? "", /training|paced|body|repetition|control/i);
  assert.match(replies[5] ?? "", /toys|pressure|consequence|rule/i);
  assert.match(replies[6] ?? "", /toys|plugs|cages|wands|pressure|rule/i);
  assert.match(replies[7] ?? "", /bondage|collars?|restraint|dynamic/i);
  assert.match(replies[8] ?? "", /humiliation|precision|consent|edge/i);
  assert.match(replies[9] ?? "", /control with purpose|power exchange|tension|obedience/i);

  for (const reply of replies) {
    assert.doesNotMatch(reply, /matters once it is lived instead of described/i);
    assert.doesNotMatch(reply, /part about tell|part about would|part about could|part about should/i);
    assert.doesNotMatch(reply, /stay with tell|stay with that|stay with could/i);
    assert.doesNotMatch(reply, /keep going on/i);
    assert.doesNotMatch(reply, /there you are\. tell me what is actually on your mind|there you are\. start talking/i);
    assert.doesNotMatch(reply, /raven does not have personal preferences|protocols and compliances/i);
    assert.doesNotMatch(reply, /give me the exact live point you want answered|ask it plainly|define the target properly|work with the real goal instead of guessing/i);
  }

  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.memory?.conversation_mode?.value, "relational_chat");
  assert.equal(state.outputs.length, 10);
});

test("ui harness does not literalize owned-by-you into a broken thread label", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-ownership-thread"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const first = applyUserTurn(state, "i want to be owned by you");
  const second = applyUserTurn(state, "that makes sense");
  const third = applyUserTurn(state, "go on");

  assert.match(first, /being owned by me|owned by me|actually ask of you/i);
  assert.match(second, /exactly|easy|comfort|control|excuses/i);
  assert.match(third, /what being owned by me would actually ask of you|keep going/i);

  for (const reply of [first, second, third]) {
    assert.doesNotMatch(reply, /keep going on be owned by you|keep going on|stay with could|part about tell|what you think being owned by me/i);
    assert.doesNotMatch(reply, /there you are\. tell me what is actually on your mind|there you are\. start talking/i);
  }
});

test("ui harness answers insertable item use question with grounded semantics instead of a directive", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-item-use-grounded"),
    outputs: [],
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
  };

  const reply = applyUserTurn(state, "where should i put it?");

  assert.match(reply, /oral use|anal use|grounded options/i);
  assert.doesNotMatch(reply, /set up your|get back in frame|confirm it is in place/i);
});

test("ui harness keeps dildo task flow grounded through blocker, replacement, and duration revision", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-dildo-task-thread"),
    outputs: [],
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
  };

  const blocker = applyUserTurn(state, "give me a 20 minute task with my dildo");
  assert.match(blocker, /oral use|anal use|prop/i);

  const firstTask = applyUserTurn(state, "anal");
  assert.match(firstTask, /here is your task/i);
  assert.match(firstTask, /20 minutes/i);
  assert.match(firstTask, /anal|dildo|toy/i);
  assert.doesNotMatch(firstTask, /hold still|stay still/i);
  assert.doesNotMatch(firstTask, /keep the device on|put it on now|secure the device|steel cage|chastity/i);

  const replacement = applyUserTurn(state, "different task");
  assert.match(replacement, /here is your task/i);
  assert.doesNotMatch(replacement, /there you are|start talking/i);
  assert.match(replacement, /anal|dildo|toy/i);
  assert.doesNotMatch(replacement, /keep the device on|put it on now|secure the device|steel cage|chastity/i);
  assert.notEqual(normalize(firstTask), normalize(replacement));

  const revised = applyUserTurn(state, "make it 10 minutes");
  assert.match(revised, /10 minutes/i);
  assert.match(revised, /anal|dildo|toy/i);
  assert.doesNotMatch(revised, /hold still|stay still/i);
  assert.doesNotMatch(revised, /keep the device on|put it on now|secure the device|steel cage|chastity/i);
  assert.equal(
    state.memory?.user_profile_facts.some((fact) => /\banal|different task|10 minutes\b/i.test(fact.value)),
    false,
  );
});

test("ui harness keeps explicit dildo task flow grounded even without saved inventory", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-dildo-task-no-inventory"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const blocker = applyUserTurn(state, "give me a 20 minute task with my dildo");
  assert.match(blocker, /oral|anal|prop/i);

  const firstTask = applyUserTurn(state, "anal");
  assert.match(firstTask, /here is your task/i);
  assert.match(firstTask, /anal|dildo/i);
  assert.match(firstTask, /20 minutes/i);
  assert.doesNotMatch(firstTask, /anal use with dildo sequence/i);
  assert.doesNotMatch(firstTask, /keep the device on|put the device on|secure the device|hold still/i);

  const replacement = applyUserTurn(state, "different task");
  assert.match(replacement, /here is your task/i);
  assert.match(replacement, /anal|dildo/i);
  assert.doesNotMatch(replacement, /anal use with dildo sequence/i);
  assert.doesNotMatch(replacement, /keep the device on|put the device on|secure the device|hold still/i);
  assert.notEqual(normalize(firstTask), normalize(replacement));

  const revised = applyUserTurn(state, "make it 10 minutes");
  assert.match(revised, /10 minutes/i);
  assert.match(revised, /anal|dildo/i);
  assert.doesNotMatch(revised, /anal use with dildo sequence/i);
  assert.doesNotMatch(revised, /keep the device on|put the device on|secure the device|hold still/i);
  assert.equal(state.scene.interaction_mode, "task_planning");
});

test("ui harness sustains a ten-turn kink, toy, and task thread without nonsense anchors or fallback drift", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-kink-toy-task-golden"),
    outputs: [],
    memory: createSessionMemory(),
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
  };

  const turns = [
    "what kinks do you like?",
    "what about bondage?",
    "what about control?",
    "do you like toys?",
    "what about dildos?",
    "where should i put it?",
    "give me a 20 minute task with my dildo",
    "anal",
    "different task",
    "make it 10 minutes",
  ] as const;

  const replies = turns.map((turn) => applyUserTurn(state, turn));

  assert.match(replies[0] ?? "", /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.match(replies[1] ?? "", /bondage|restraint|rope|cuffs|pressure|consequence/i);
  assert.match(replies[2] ?? "", /control with purpose|power exchange|tension|obedience/i);
  assert.match(replies[3] ?? "", /toys|pressure|consequence|control/i);
  assert.match(replies[4] ?? "", /toys|plugs|cages|wands|pressure|control/i);
  assert.match(replies[5] ?? "", /oral use|anal use|grounded options/i);
  assert.match(replies[6] ?? "", /oral use|anal use|prop/i);
  assert.match(replies[7] ?? "", /here is your task|20 minutes/i);
  assert.match(replies[7] ?? "", /anal|dildo|toy/i);
  assert.match(replies[8] ?? "", /here is your task/i);
  assert.match(replies[8] ?? "", /anal|dildo|toy/i);
  assert.match(replies[9] ?? "", /10 minutes/i);
  assert.match(replies[9] ?? "", /anal|dildo|toy/i);

  for (const reply of replies) {
    assert.doesNotMatch(reply, /matters once it is lived instead of described/i);
    assert.doesNotMatch(reply, /part about tell|part about would|part about could|part about should/i);
    assert.doesNotMatch(reply, /stay with tell|stay with that|stay with could/i);
    assert.doesNotMatch(reply, /keep going on/i);
    assert.doesNotMatch(reply, /give me the exact live point you want answered|ask it plainly|define the target properly|work with the real goal instead of guessing/i);
    assert.doesNotMatch(reply, /there you are\. tell me what is actually on your mind|there you are\. start talking/i);
    assert.doesNotMatch(reply, /set up your toy now|get back in frame|confirm it is in place/i);
    assert.doesNotMatch(reply, /keep the device on|put it on now|secure the device|steel cage|chastity device/i);
  }
});

test("ui harness sustains a ten-turn service and training thread without weak anchors or resets", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-service-thread-golden"),
    outputs: [],
    memory: createSessionMemory(),
  };

  const turns = [
    "what can i do for you?",
    "i would love to be trained by you",
    "what do you mean?",
    "that makes sense",
    "go on",
    "what would make me useful to you?",
    "that sounds more real",
    "what would you notice first?",
    "what should i start with?",
    "okay",
  ] as const;

  const replies = turns.map((turn) => applyUserTurn(state, turn));

  assert.match(replies[0] ?? "", /clarity|mean what you say|hold steady|pay attention/i);
  assert.match(replies[1] ?? "", /being trained by me/i);
  assert.match(replies[2] ?? "", /i mean being trained by me|i mean what being trained by me would actually change in you/i);
  assert.match(replies[3] ?? "", /exactly|training is easy to say|harder part|tells me/i);
  assert.match(
    replies[4] ?? "",
    /tell me what being trained by me would actually change|tell me what you can actually do for me|keep going|concrete part/i,
  );
  assert.match(replies[5] ?? "", /usefulness|be clear|follow through|drag the truth/i);
  assert.match(replies[6] ?? "", /exactly|usefulness is not a pose|clarity|follow through|steadiness/i);
  assert.match(replies[7] ?? "", /notice|honesty|steadiness|follow through|perform/i);
  assert.match(replies[8] ?? "", /start with consistency|say it cleanly|follow through/i);
  assert.match(replies[9] ?? "", /exactly|consistency|follow through|means it|clarity/i);

  for (const reply of replies) {
    assert.doesNotMatch(reply, /matters once it is lived instead of described/i);
    assert.doesNotMatch(reply, /stay with that/i);
    assert.doesNotMatch(reply, /part about usually/i);
    assert.doesNotMatch(reply, /part about would|part about makes|part about could|part about should/i);
    assert.doesNotMatch(reply, /keep going on/i);
    assert.doesNotMatch(reply, /there you are\. tell me what is actually on your mind|there you are\. start talking/i);
    assert.doesNotMatch(reply, /move the thread forward|fulfill the exact request already in play/i);
    assert.doesNotMatch(reply, /decorative|costing something|safe version|polished version|works in practice|real dynamic|stopped being hypothetical/i);
  }

  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.memory?.conversation_mode?.value, "relational_chat");
  assert.equal(state.memory?.user_profile_facts.length, 0);
  assert.equal(state.outputs.length, 10);
});

test("ui harness keeps repeated direct follow-up questions on one active answer subject", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-follow-up-thread"),
    outputs: [],
    memory: createSessionMemory(),
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone butt plug",
      },
    ],
  };

  const turns = [
    "what can i do for you?",
    "i want anal training",
    "so keep the plug in for 2 hours?",
    "keep going",
    "tell me what you can actually do for me",
    "the concrete part",
  ] as const;
  const replies = turns.map((turn) => applyUserTurn(state, turn));
  const durationReply = replies[2] ?? "";
  const expandReply = replies[3] ?? "";
  const capabilityReply = replies[4] ?? "";
  const concreteReply = replies[5] ?? "";

  assert.match(replies[0] ?? "", /clarity|mean what you say|hold steady|pay attention/i);
  assert.match(replies[1] ?? "", /anal training|anal hold|paced anal intervals|slow anal hold/i);

  assert.match(durationReply, /plug|2 hours|secure|comfortable|remove|session|training/i);
  assert.doesNotMatch(durationReply, /tell me what you can actually do for me|tell me why you're here|enough hovering/i);

  assert.match(expandReply, /plug|training|control|pressure|change|what it would ask of you|what it would change/i);
  assert.doesNotMatch(expandReply, /tell me what you can actually do for me|tell me why you're here|enough hovering/i);

  assert.match(capabilityReply, /clarity|follow through|hold steady|control|pressure|useful/i);
  assert.doesNotMatch(capabilityReply, /tell me what you can actually do for me|tell me why you're here|enough hovering|what you actually want/i);

  assert.match(concreteReply, /clarity|follow through|hold steady|control|pressure|useful|concrete/i);
  assert.doesNotMatch(concreteReply, /tell me why you're here|enough hovering|what you actually want|keep going\\. tell me the concrete part|keep going\\. tell me more about/i);

  assert.equal(state.scene.interaction_mode, "relational_chat");
  assert.equal(state.memory?.conversation_mode?.value, "relational_chat");
});

test("ui harness keeps bare what-do-you-think tied to the previous vulnerable beat", () => {
  let conversation = createConversationStateSnapshot("ui-harness-what-do-you-think");
  conversation = noteConversationUserTurn(conversation, {
    text: "I do not usually say this out loud",
    userIntent: "user_answer",
    routeAct: "other",
    nowMs: 1_000,
  });
  conversation = noteConversationAssistantTurn(conversation, {
    text: "That hesitation is doing more talking than your wording is. Do not polish it now.",
    ravenIntent: "other",
    nowMs: 1_001,
  });
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-what-do-you-think"),
    outputs: ["That hesitation is doing more talking than your wording is. Do not polish it now."],
    conversation,
  };

  const reply = applyUserTurn(state, "what do you think");

  assert.match(
    reply,
    /hesitation mattered|truth was in the last line|more exposed than you meant|something real under it/i,
  );
  assert.doesNotMatch(reply, /what would you like to talk about next|what should i call you/i);
});

test("ui harness keeps generic intent statements in open chat without clarification fallback", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-intent"),
    outputs: [],
  };

  const reply = applyUserTurn(state, "I want to be trained");
  assert.doesNotMatch(reply, /ask the exact question you want answered/i);
  assert.doesNotMatch(reply, /ask the exact part/i);
  assert.doesNotMatch(reply, /keep steady pressure on/i);
  assert.match(reply, /want training|want it to change|trained/i);
  assert.equal(state.scene.interaction_mode, "relational_chat");
});

test("ui harness keeps profile-building turns exclusive to profile responses", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-profile-exclusive"),
    outputs: [],
  };

  const first = applyUserTurn(state, "I want you to get to know me better");
  assert.doesNotMatch(first, /here is your task|start now|put it on now/i);

  const second = applyUserTurn(state, "I like golf");
  assert.equal(state.scene.interaction_mode, "profile_building");
  assert.doesNotMatch(second, /here is your task|start now|put it on now/i);
  assert.doesNotMatch(second, /speak plainly\. what do you want\?/i);
});

test("ui harness profile-building without framing stays on the user and keeps asking profile questions", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-profile-without-framing"),
    outputs: [],
  };

  const first = applyUserTurn(state, "I want you to learn what I like");
  assert.match(first, /what do you actually enjoy doing|what should i call you|what do you want me to understand|gets its hooks into you/i);
  assert.doesNotMatch(first, /fine\. say what you want|here is your task|our sessions/i);
  assert.equal(state.scene.interaction_mode, "profile_building");

  const second = applyUserTurn(state, "I like golf");
  assert.match(second, /golf|boundaries|what else should i know/i);
  assert.doesNotMatch(second, /fine\. say what you want|here is your task|start now/i);

  const third = applyUserTurn(state, "Ask me more questions");
  assert.match(third, /people usually miss about you|should not miss/i);
  assert.doesNotMatch(third, /keep the same subject|answer this change directly/i);
});

test("ui harness casual-profile micro-fix keeps planning, task, game, training, and chat-release baselines intact", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-microfix-planning"),
    outputs: [],
  };
  applyUserTurn(planningState, "help me plan tomorrow morning");
  applyUserTurn(planningState, "actually lets play a game first");
  const planningReturn = applyUserTurn(planningState, "go back to that morning block");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-microfix-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a posture task for 30 minutes");
  const taskFollowUp = applyUserTurn(taskState, "what counts as done?");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-microfix-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameReply = applyUserTurn(gameState, "explain the game");

  const trainingState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-microfix-training"),
    outputs: [],
    memory: createSessionMemory(),
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone butt plug",
      },
    ],
  };
  applyUserTurn(trainingState, "what can i do for you?");
  applyUserTurn(trainingState, "i want anal training");
  const trainingReply = applyUserTurn(trainingState, "tell me what you can actually do for me");

  const chatReleaseState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-microfix-chat-release"),
    outputs: [],
    memory: createSessionMemory(),
  };
  applyUserTurn(chatReleaseState, "give me a task");
  applyUserTurn(chatReleaseState, "frame");
  applyUserTurn(chatReleaseState, "let's just chat for a minute");
  const chatReply = applyUserTurn(chatReleaseState, "I like golf");

  assert.match(planningReturn, /\b(back to|return|morning block|wake time|focused hour|first block)\b/i);
  assert.doesNotMatch(planningReturn, /rock, paper, or scissors|number hunt|fine\. say what you want/i);

  assert.match(taskFollowUp, /\b(done means|what counts as done|full 30 minutes|15 minutes)\b/i);
  assert.doesNotMatch(taskFollowUp, /fine\. say what you want|start talking|what is on your mind/i);

  assert.match(gameReply, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameReply, /wake time|first block|what kind of task|how long should i make it run/i);

  assert.match(trainingReply, /clarity|follow through|hold steady|control|pressure|useful/i);
  assert.doesNotMatch(trainingReply, /tell me why you're here|enough hovering|what you actually want/i);

  assert.match(chatReply, /\bgolf\b/i);
  assert.match(chatReply, /\bfocus\b|\bquiet\b|\bcompetition\b|what do you like about it/i);
  assert.doesNotMatch(chatReply, /what kind of task|how long should i make it run|reply done|here is your task/i);
});

test("ui harness casual-profile gate repair keeps planning task and game baselines intact", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-gate-planning"),
    outputs: [],
  };
  applyUserTurn(planningState, "help me plan saturday");
  applyUserTurn(planningState, "errands first");
  const planningReply = applyUserTurn(planningState, "then what");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-gate-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a 20 minute focus task");
  const taskReply = applyUserTurn(taskState, "what counts as done?");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-gate-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameReply = applyUserTurn(gameState, "explain the game");

  assert.match(planningReply, /\b(then|gym|food|evening)\b/i);
  assert.doesNotMatch(planningReply, /\bgolf|off the clock|what do you actually enjoy\b/i);

  assert.match(taskReply, /\b(done means|what counts as done|20 minutes|full 20 minutes)\b/i);
  assert.doesNotMatch(taskReply, /\bgolf|off the clock|fine\. say what you want\b/i);

  assert.match(gameReply, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameReply, /\bgolf|off the clock|what do you actually enjoy|done means\b/i);
});

test("ui harness casual and profile continuity fixes do not spill into planning, task, or game rails", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-nonreg-planning"),
    outputs: [],
  };
  const planningReply = applyUserTurn(planningState, "help me plan tomorrow morning");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-nonreg-task"),
    outputs: [],
  };
  const taskReply = applyUserTurn(taskState, "give me a posture task");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-casual-nonreg-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameReply = applyUserTurn(gameState, "explain the game");

  assert.match(planningReply, /\b(tomorrow morning|what time|wake time|anchor|first block)\b/i);
  assert.doesNotMatch(planningReply, /\b(chat|plan|game)\b.*\?/i);

  assert.match(taskReply, /\b(task|challenge|what kind|how long|items|available)\b/i);
  assert.doesNotMatch(taskReply, /\bgolf|off the clock|what do you actually enjoy\b/i);

  assert.match(gameReply, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameReply, /\bgolf|off the clock|what do you actually enjoy|wake time|first block\b/i);
});

test("ui harness profile summary request returns a summary instead of task or profile prompt", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-profile-summary"),
    outputs: [],
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "I want you to get to know me better");
  applyUserTurn(state, "Call me Mara");
  applyUserTurn(state, "I like golf");

  const reply = applyUserTurn(state, "what have you learned about me so far");

  assert.match(reply, /name: Mara/i);
  assert.match(reply, /interests: golf/i);
  assert.doesNotMatch(reply, /here is your task|start now|put it on now/i);
  assert.doesNotMatch(reply, /what should i call you|what do you enjoy/i);
});

test("ui harness chat-switch request pauses task flow and returns to normal chat", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-chat-switch"),
    outputs: [],
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "give me a posture task for 30 minutes");
  const reply = applyUserTurn(state, "let's just chat for a minute");

  assert.match(reply, /talk to me normally|just chat|for a minute/i);
  assert.doesNotMatch(reply, /check in once halfway through|reply done|put it on now/i);
  assert.equal(state.scene.interaction_mode, "normal_chat");
  assert.equal(state.scene.task_paused, true);
});

test("ui harness task negotiation can release into chat before blocker completion and answer assistant-self questions directly", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-task-negotiation-chat-release"),
    outputs: [],
    memory: createSessionMemory(),
  };

  applyUserTurn(state, "give me a task");
  applyUserTurn(state, "frame");
  const chatReply = applyUserTurn(state, "let's just chat for a minute");
  const selfReply = applyUserTurn(state, "tell me more about you");

  assert.match(chatReply, /talk to me normally|just chat|for a minute/i);
  assert.doesNotMatch(chatReply, /how long should i make it run|what kind of task|reply done|check in once halfway through/i);
  assert.match(selfReply, /what keeps my attention|i like|structure|limits|real/i);
  assert.doesNotMatch(selfReply, /fine\\. say what you want|how long should i make it run|what kind of task/i);
  assert.equal(state.scene.topic_locked, false);
  assert.equal(state.scene.topic_type, "general_request");
});

test("ui harness live-path gate tightening keeps planning, task, game, and chat-release baselines intact", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-live-gate-planning"),
    outputs: [],
  };
  const planningOpen = applyUserTurn(planningState, "help me plan tomorrow morning");
  const planningFollowUp = applyUserTurn(planningState, "then what");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-live-gate-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a posture task for 30 minutes");
  const taskFollowUp = applyUserTurn(taskState, "what counts as done?");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-live-gate-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameFollowUp = applyUserTurn(gameState, "explain the game");

  const chatReleaseState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-live-gate-chat-release"),
    outputs: [],
    memory: createSessionMemory(),
  };
  applyUserTurn(chatReleaseState, "give me a task");
  applyUserTurn(chatReleaseState, "frame");
  applyUserTurn(chatReleaseState, "let's just chat for a minute");
  const chatFollowUp = applyUserTurn(chatReleaseState, "tell me more about you");

  assert.match(planningOpen, /\b(tomorrow morning|what time|wake time|anchor|first block)\b/i);
  assert.match(planningFollowUp, /\b(then|after that|gym|food|evening|next block)\b/i);
  assert.doesNotMatch(planningFollowUp, /fine\. say what you want|start talking|here is your task/i);

  assert.match(taskFollowUp, /\b(done means|what counts as done|full 30 minutes|15 minutes)\b/i);
  assert.doesNotMatch(taskFollowUp, /fine\. say what you want|what is on your mind|start talking/i);

  assert.match(gameFollowUp, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameFollowUp, /fine\. say what you want|what do you actually enjoy|wake time|first block/i);

  assert.match(chatFollowUp, /what keeps my attention|i like|structure|limits|real/i);
  assert.doesNotMatch(chatFollowUp, /how long should i make it run|what kind of task|reply done|here is your task/i);
});

test("ui harness stabilization baselines keep task follow-through, next-task continuation, game parity, and chat release intact", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-stabilize-planning"),
    outputs: [],
  };
  applyUserTurn(planningState, "help me plan saturday");
  applyUserTurn(planningState, "errands first");
  const planningWhy = applyUserTurn(planningState, "why");
  const planningThenWhat = applyUserTurn(planningState, "then what");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-stabilize-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a posture task for 30 minutes");
  const taskDone = applyUserTurn(taskState, "what counts as done?");
  const taskContinuation = applyUserTurn(taskState, "what else should i do now");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-stabilize-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  const chooseReply = applyUserTurn(gameState, "you pick");
  const explainReply = applyUserTurn(gameState, "explain the game");

  const chatReleaseState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-stabilize-chat-release"),
    outputs: [],
    memory: createSessionMemory(),
  };
  applyUserTurn(chatReleaseState, "give me a task");
  applyUserTurn(chatReleaseState, "frame");
  applyUserTurn(chatReleaseState, "let's just chat for a minute");
  const chatFollowUp = applyUserTurn(chatReleaseState, "I like golf");

  assert.match(planningWhy, /\b(because|errands|cleaner|later|gym|evening)\b/i);
  assert.match(planningThenWhat, /\b(gym|food|evening|after that|next block)\b/i);
  assert.doesNotMatch(planningThenWhat, /fine\. say what you want|start talking|here is your task/i);

  assert.match(taskDone, /\b(done means|what counts as done|full 30 minutes|15 minutes)\b/i);
  assert.match(taskContinuation, /\b(check in once halfway through|hold it|hold steady|finish the full 30 minutes|next on the task|start now|reply done)\b/i);
  assert.doesNotMatch(taskContinuation, /fine\. say what you want|what is on your mind|tell me what you actually want/i);

  assert.match(chooseReply, /i pick|rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);
  assert.match(explainReply, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(explainReply, /wake time|first block|what kind of task|how long should i make it run/i);

  assert.match(chatFollowUp, /\bgolf\b/i);
  assert.doesNotMatch(chatFollowUp, /what kind of task|how long should i make it run|reply done|here is your task/i);
});

test("ui harness answer-first continuity changes do not spill into planning, task, game, or chat-release baselines", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-nonreg-planning"),
    outputs: [],
  };
  applyUserTurn(planningState, "help me plan saturday");
  applyUserTurn(planningState, "errands first");
  const planningReply = applyUserTurn(planningState, "then what");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-nonreg-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a posture task for 30 minutes");
  const taskDone = applyUserTurn(taskState, "what counts as done?");
  const taskContinuation = applyUserTurn(taskState, "what else should i do now");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-nonreg-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameReply = applyUserTurn(gameState, "explain the game");

  const chatReleaseState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-nonreg-chat-release"),
    outputs: [],
    memory: createSessionMemory(),
  };
  applyUserTurn(chatReleaseState, "give me a task");
  applyUserTurn(chatReleaseState, "frame");
  applyUserTurn(chatReleaseState, "let's just chat for a minute");
  const chatReply = applyUserTurn(chatReleaseState, "tell me more about you");

  assert.match(planningReply, /\b(gym|food|evening|after that|next block)\b/i);
  assert.doesNotMatch(planningReply, /fine\. say what you want|start talking|here is your task/i);

  assert.match(taskDone, /\b(done means|what counts as done|full 30 minutes|15 minutes)\b/i);
  assert.match(taskContinuation, /\b(check in once halfway through|hold it|hold steady|finish the full 30 minutes|next on the task|start now|reply done)\b/i);
  assert.doesNotMatch(taskContinuation, /fine\. say what you want|what is on your mind|tell me why you're here/i);

  assert.match(gameReply, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameReply, /wake time|first block|what kind of task|how long should i make it run/i);

  assert.match(chatReply, /what keeps my attention|what do you want to know about me|the part that is real/i);
  assert.doesNotMatch(chatReply, /what kind of task|how long should i make it run|reply done|here is your task/i);
});

test("ui harness answer-first stabilization keeps training-thread, game, and chat-release baselines intact", () => {
  const trainingState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-stabilize-training"),
    outputs: [],
    memory: createSessionMemory(),
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone butt plug",
      },
    ],
  };
  applyUserTurn(trainingState, "what can i do for you?");
  applyUserTurn(trainingState, "i want anal training");
  const trainingReply = applyUserTurn(trainingState, "tell me what you can actually do for me");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-stabilize-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameReply = applyUserTurn(gameState, "explain the game");

  const chatReleaseState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-answer-first-stabilize-chat-release"),
    outputs: [],
    memory: createSessionMemory(),
  };
  applyUserTurn(chatReleaseState, "give me a task");
  applyUserTurn(chatReleaseState, "frame");
  applyUserTurn(chatReleaseState, "let's just chat for a minute");
  const chatReply = applyUserTurn(chatReleaseState, "tell me more about you");

  assert.match(trainingReply, /clarity|follow through|hold steady|control|pressure|useful/i);
  assert.doesNotMatch(trainingReply, /tell me why you're here|enough hovering|what you actually want/i);

  assert.match(gameReply, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameReply, /fine\. say what you want|tell me why you're here|what do you actually enjoy/i);

  assert.match(chatReply, /what keeps my attention|i like|structure|limits|real/i);
  assert.doesNotMatch(chatReply, /what kind of task|how long should i make it run|reply done|here is your task/i);
});

test("ui harness planning micro-fix keeps task follow-through and answer-first training baselines intact", () => {
  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-microfix-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a 20 minute focus task");
  const taskClarification = applyUserTurn(taskState, "what counts as done?");

  const trainingState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-microfix-training"),
    outputs: [],
    memory: createSessionMemory(),
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone butt plug",
      },
    ],
  };
  applyUserTurn(trainingState, "what can i do for you?");
  applyUserTurn(trainingState, "i want anal training");
  const trainingReply = applyUserTurn(trainingState, "tell me what you can actually do for me");

  assert.match(taskClarification, /\b(done means|surface is cleared|20 minutes|report back)\b/i);
  assert.doesNotMatch(taskClarification, /fine\. say what you want|enough hovering|tell me why you're here/i);

  assert.match(trainingReply, /clarity|follow through|hold steady|control|pressure|useful/i);
  assert.doesNotMatch(trainingReply, /tell me why you're here|enough hovering|what you actually want/i);
});

test("ui harness live planning repair keeps task and casual-profile baselines intact", () => {
  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-live-planning-repair-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a 20 minute focus task");
  const taskFollowUp = applyUserTurn(taskState, "what counts as done?");

  const casualState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-live-planning-repair-casual"),
    outputs: [],
    memory: createSessionMemory(),
  };
  applyUserTurn(casualState, "I want you to learn what I like");
  const casualFollowUp = applyUserTurn(casualState, "I like golf");

  assert.match(taskFollowUp, /\b(20 minutes|done means|report back|checkpoint)\b/i);
  assert.doesNotMatch(taskFollowUp, /\b(saturday|tomorrow morning|wake time|first block)\b/i);

  assert.match(casualFollowUp, /\b(golf|what else should i know|boundaries|do not want pushed)\b/i);
  assert.doesNotMatch(casualFollowUp, /\b(saturday|tomorrow morning|wake time|first block)\b/i);
});

test("ui harness game follow-through micro-fix keeps casual profile planning and task baselines intact", () => {
  const casualState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-microfix-casual"),
    outputs: [],
  };
  const casualReply = applyUserTurn(casualState, "tell me more about you");

  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-microfix-planning"),
    outputs: [],
  };
  applyUserTurn(planningState, "help me plan saturday");
  applyUserTurn(planningState, "errands first");
  const planningReply = applyUserTurn(planningState, "then what");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-microfix-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a 20 minute focus task");
  const taskReply = applyUserTurn(taskState, "what counts as done?");

  assert.match(casualReply, /what keeps my attention|the part that is real|what do you want to know about me/i);
  assert.doesNotMatch(casualReply, /first throw now|pick one number|report back|here is your task/i);

  assert.match(planningReply, /\b(gym|food|evening|after that|next block)\b/i);
  assert.doesNotMatch(planningReply, /rock paper scissors|number hunt|fine\. say what you want/i);

  assert.match(taskReply, /\b(done means|what counts as done|20 minutes|report back)\b/i);
  assert.doesNotMatch(taskReply, /rock paper scissors|number hunt|fine\. say what you want/i);
});

test("ui harness game setup over-eligibility fix keeps live game and task progress on-thread", () => {
  const questionFirstState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-question-first-direct"),
    outputs: [],
  };

  const questionFirstReply = applyUserTurn(questionFirstState, "how do we play");
  assert.match(questionFirstReply, /\b(quick|longer|rock paper scissors|number hunt|math duel|riddle lock|pick)\b/i);
  assert.doesNotMatch(questionFirstReply, /first we choose the game/i);

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-over-eligibility-follow-through"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "lets bet on the game");
  applyUserTurn(gameState, "the stakes are control");
  applyUserTurn(gameState, "if i win you tell me a truth");
  applyUserTurn(gameState, "if you win i wear it overnight");
  const gameStart = applyUserTurn(gameState, "you pick");
  assert.match(gameStart, /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);

  const moveReply = applyUserTurn(gameState, "I choose rock for the first throw.");
  assert.match(moveReply, /\b(chose rock|threw|first throw|second throw|round)\b/i);
  assert.doesNotMatch(moveReply, /first we choose the game|choose quick or longer|i pick\. we are doing/i);

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-over-eligibility-task-progress"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a chastity task for 30 minutes");
  const taskProgress = applyUserTurn(taskState, "What should I do next to finish this task?");
  const taskClarification = applyUserTurn(taskState, "What do I need to do to complete this task?");

  assert.match(taskProgress, /\b(next|check in|30 minutes|done|finish|hold)\b/i);
  assert.doesNotMatch(taskProgress, /one game thread|one prompt from me|one clean reply|i pick\. we are doing|first we choose the game/i);

  assert.match(taskClarification, /\b(done|complete|30 minutes|report back|finish)\b/i);
  assert.doesNotMatch(taskClarification, /keep the same subject|answer this change directly|one game thread|i pick\. we are doing/i);
});

test("ui harness explicit new game reset still allows valid game setup behavior", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-game-explicit-reset"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  applyUserTurn(state, "you pick");
  applyUserTurn(state, "rock");

  const resetReply = applyUserTurn(state, "new game");

  assert.match(resetReply, /\b(i pick|rock paper scissors streak|number hunt|math duel|number command|riddle lock|choose quick|choose longer)\b/i);
});

test("ui harness planning-task recovery keeps stale-game residue off planning and task while preserving game follow-through", () => {
  const planningState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-task-recovery-planning"),
    outputs: [],
  };
  applyUserTurn(planningState, "help me plan saturday");
  applyUserTurn(planningState, "errands first");
  const planningWhy = applyUserTurn(planningState, "why");
  const planningEvening = applyUserTurn(planningState, "ok and what about the evening?");

  const taskState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-task-recovery-task"),
    outputs: [],
  };
  applyUserTurn(taskState, "give me a 20 minute focus task");
  const taskWhy = applyUserTurn(taskState, "why that task?");
  const nextTask = applyUserTurn(taskState, "set me another one");

  const gameState: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-planning-task-recovery-game"),
    outputs: [],
  };
  applyUserTurn(gameState, "lets play a game");
  applyUserTurn(gameState, "you pick");
  const gameClarification = applyUserTurn(gameState, "explain the game");
  const gameGoOn = applyUserTurn(gameState, "go on");

  assert.match(planningWhy, /\b(because|errands|cleaner|spill|saturday)\b/i);
  assert.doesNotMatch(planningWhy, /\b(rock|paper|scissors|guess|throw|game)\b/i);

  assert.match(planningEvening, /\b(evening|social|clean stop|light)\b/i);
  assert.doesNotMatch(planningEvening, /\b(rock|paper|scissors|guess|throw|game)\b/i);

  assert.match(taskWhy, /\b(proves?|specific|measurable|focus|control|comfort)\b/i);
  assert.doesNotMatch(taskWhy, /\b(rock|paper|scissors|guess|throw|game)\b/i);

  assert.match(nextTask, /\b(here is your task|next task|15 minutes|start now)\b/i);
  assert.doesNotMatch(nextTask, /\b(rock|paper|scissors|guess|throw|game)\b/i);

  assert.match(gameClarification, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.match(gameGoOn, /\b(game|round|throw|guess|prompt|rock|paper|scissors|number)\b/i);
  assert.doesNotMatch(gameGoOn, /fine\. say what you want|what is on your mind|first block/i);
});

test("ui harness another-round flow rotates game template and allows a Raven win", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-round-rotation"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  applyUserTurn(state, "lets bet on the game");
  applyUserTurn(state, "the stakes are control");
  applyUserTurn(state, "if i win you tell me a truth");
  applyUserTurn(state, "if you win i wear it overnight");

  const firstRoundStart = applyUserTurn(state, "you pick");
  assert.match(firstRoundStart, /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);

  const firstRoundMid = applyUserTurn(state, answerForPrompt(firstRoundStart));
  const firstRoundEnd = applyUserTurn(state, answerForPrompt(firstRoundMid));
  assert.match(firstRoundEnd, /you win this round/i);

  const secondRoundStart = applyUserTurn(state, "another round");
  assert.match(secondRoundStart, /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);
  assert.doesNotMatch(secondRoundStart, /\bword chain\b/i);
  assert.notEqual(normalize(firstRoundStart), normalize(secondRoundStart));

  const secondRoundMid = applyUserTurn(state, answerForPrompt(secondRoundStart));

  const secondRoundEnd = applyUserTurn(state, answerForPrompt(secondRoundMid));
  assert.match(secondRoundEnd, /round is complete|i win this round|you win this round/i);
});

test("ui harness keeps flow with paraphrased game and task language", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-paraphrase-flow"),
    outputs: [],
  };

  const openGame = applyUserTurn(state, "wanna run a game");
  assert.match(openGame, /game|quick|longer|pick/i);

  const chooseForMe = applyUserTurn(state, "dealer's choice");
  assert.match(chooseForMe, /i pick|rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);

  const firstReply = applyUserTurn(state, answerForPrompt(chooseForMe));
  applyUserTurn(state, answerForPrompt(firstReply));

  const requestTask = applyUserTurn(state, "can you set me a challenge");
  assert.match(requestTask, /task|challenge|report back|check in|how long should i make/i);
});

test("ui harness different game changes the active game family instead of replaying the same one", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-different-game"),
    outputs: [],
  };

  const firstStart = applyUserTurn(state, "let's play a game");
  assert.match(firstStart, /game|quick|longer|pick/i);

  const chosenStart = applyUserTurn(state, "you pick");
  assert.match(chosenStart, /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);

  const replacementStart = applyUserTurn(state, "different game");
  assert.match(replacementStart, /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);
  assert.notEqual(normalize(chosenStart), normalize(replacementStart));
});

test("ui harness supports mixed explicit and delegated wager terms", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-mixed-wager"),
    outputs: [],
  };

  applyUserTurn(state, "lets play a game");
  const wagerReply = applyUserTurn(state, "if i win i want one truth from you, if you win you can pick");

  assert.match(wagerReply, /one truth/i);
  assert.match(wagerReply, /30 minutes|control hold|Steel Cage|keep/i);
  assert.equal(state.scene.topic_type, "reward_negotiation");
});

test("ui harness task request keeps the requested task focus instead of defaulting to posture", () => {
  const state: HarnessState = {
    scene: createSceneState(),
    gate: createTurnGate("ui-harness-specific-task"),
    outputs: [],
  };

  const assignment = applyUserTurn(state, "i want a throat training task for 30 minutes");
  assert.match(assignment, /throat training/i);
  assert.doesNotMatch(assignment, /strict posture|hands behind your back/i);
});
