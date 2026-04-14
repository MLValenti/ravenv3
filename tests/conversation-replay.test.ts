import test from "node:test";
import assert from "node:assert/strict";

import {
  attachStateRouteToLiveTurnDiagnostic,
  buildLiveTurnDiagnosticRecord,
  buildServerCanonicalTurnMove,
  interpretLiveRouteTurn,
} from "../lib/chat/live-turn-interpretation.ts";
import {
  buildHumanQuestionFallback,
} from "../lib/chat/open-question.ts";
import {
  chooseVoicePromptProfile,
  resolvePromptRouteMode,
} from "../lib/chat/prompt-profile.ts";
import {
  buildTurnPlan,
} from "../lib/chat/turn-plan.ts";
import {
  classifyCoreConversationMove,
  isStableCoreConversationMove,
} from "../lib/chat/core-turn-move.ts";
import {
  createConversationStateSnapshot,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
} from "../lib/chat/conversation-state.ts";
import {
  createCommitmentState,
} from "../lib/session/commitment-engine.ts";
import {
  replayConversationScenarios,
  replayConversationScenario,
  summarizeReplayResults,
} from "../lib/session/conversation-replay.ts";
import {
  BROWSER_LIVE_REPLAY_SCENARIO_IDS,
  CONVERSATION_REPLAY_SCENARIOS,
} from "../lib/session/conversation-replay-scenarios.ts";
import {
  shouldBypassModelForSceneTurn,
} from "../lib/session/deterministic-scene-routing.ts";
import {
  isAssistantSelfQuestion,
  isAssistantTrainingRequest,
  isChatSwitchRequest,
  isMutualGettingToKnowRequest,
  isProfileSummaryRequest,
} from "../lib/session/interaction-mode.ts";
import {
  applyResponseGate,
} from "../lib/session/response-gate.ts";
import {
  buildSceneScaffoldReply,
} from "../lib/session/scene-scaffolds.ts";
import {
  buildSceneFallback,
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
} from "../lib/session/scene-state.ts";
import {
  createSessionMemory,
  traceWriteUserAnswer,
  traceWriteUserQuestion,
  writeConversationMode,
} from "../lib/session/session-memory.ts";
import {
  createSessionStateContract,
  reduceAssistantEmission,
  reduceUserTurn,
} from "../lib/session/session-state-contract.ts";
import {
  buildShortClarificationReply,
} from "../lib/session/short-follow-up.ts";
import {
  buildTopicFallback,
} from "../lib/session/topic-fallback.ts";

const TARGET_FAILURE_SCENARIO_IDS = new Set([
  "profile_building_adaptive",
  "profile_building_interpretive_beat",
  "short_follow_up_no_cascade",
]);

function normalizeReplayText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function shouldDeterministicallyAnswerOpenQuestionLocal(
  userText: string,
  sceneState: ReturnType<typeof createSceneState>,
  dialogueAct: string,
): boolean {
  if (dialogueAct !== "user_question" || sceneState.task_hard_lock_active) {
    return false;
  }
  if (
    sceneState.interaction_mode === "profile_building" ||
    sceneState.active_training_thread.subject !== "none" ||
    sceneState.topic_type === "task_negotiation" ||
    sceneState.topic_type === "task_execution" ||
    sceneState.topic_type === "duration_negotiation" ||
    sceneState.topic_type === "task_terms_negotiation" ||
    sceneState.topic_type === "reward_negotiation" ||
    sceneState.topic_type === "reward_window" ||
    sceneState.topic_type === "game_setup" ||
    sceneState.topic_type === "game_execution" ||
    sceneState.topic_type === "verification_in_progress"
  ) {
    return false;
  }
  if (
    isAssistantTrainingRequest(userText) ||
    /\b(where should i put it|where does it go|where should it go|how should i use it|how would you use it|what would you do with it|what do i do with it|how do i use it|is it oral or anal|can i use it orally|can i use it anally)\b/i.test(
      userText,
    )
  ) {
    return false;
  }
  return normalizeReplayText(userText).split(/\s+/).filter(Boolean).length <= 12;
}

function buildFailureMapsForScenario(
  scenario: (typeof CONVERSATION_REPLAY_SCENARIOS)[number],
  result: Awaited<ReturnType<typeof replayConversationScenario>>,
) {
  const state = {
    contract: createSessionStateContract(`replay-localize-${scenario.id}`),
    sceneState: createSceneState(),
    sessionMemory: createSessionMemory(),
    conversationState: createConversationStateSnapshot(`replay-localize-${scenario.id}`),
    outputs: [] as string[],
  };
  const traceByTurn = new Map(result.traces.map((trace) => [trace.turnNumber, trace] as const));

  const failureMaps: Array<Record<string, unknown>> = [];

  for (const [index, turn] of scenario.turns.entries()) {
    const turnNumber = index + 1;
    const previousSceneState = state.sceneState;
    const previousAssistantText = state.outputs[state.outputs.length - 1] ?? null;
    const currentTopic =
      state.contract.workingMemory.current_topic !== "none"
        ? state.contract.workingMemory.current_topic
        : state.sceneState.agreed_goal || null;
    const interpretation = interpretLiveRouteTurn({
      lastUserMessage: turn.user,
      awaitingUser: state.contract.turnGate.awaitingUser,
      userAnswered: false,
      verificationJustCompleted: false,
      sessionPhase: "build",
      previousAssistantMessage: previousAssistantText,
      currentTopic,
    });
    const baseDiagnostic = buildLiveTurnDiagnosticRecord({
      requestId: `replay-localize-${scenario.id}`,
      turnId: `turn-${turnNumber}`,
      sessionId: `replay-localize-${scenario.id}`,
      interpretationInput: {
        lastUserMessage: turn.user,
        awaitingUser: state.contract.turnGate.awaitingUser,
        userAnswered: false,
        verificationJustCompleted: false,
        sessionPhase: "build",
        previousAssistantMessage: previousAssistantText,
        currentTopic,
      },
      interactionMode: state.sceneState.interaction_mode,
      topicType: state.sceneState.topic_type,
      topicLocked: state.sceneState.topic_locked,
      taskHardLockActive: state.sceneState.task_hard_lock_active,
      taskProgress: state.sceneState.task_progress,
      gameProgress: state.sceneState.game_progress,
      activeThreadHint: currentTopic,
    });
    const diagnosticRecord = attachStateRouteToLiveTurnDiagnostic(baseDiagnostic, {
      text: turn.user,
      awaitingUser: state.contract.turnGate.awaitingUser,
      currentTopic: state.contract.sessionTopic,
      nowMs: turnNumber * 1000,
    });
    const canonicalTurnMove = buildServerCanonicalTurnMove({
      interpretation,
      diagnosticRecord,
    });
    const reduced = reduceUserTurn(state.contract, {
      text: turn.user,
      nowMs: turnNumber * 1000,
      diagnosticRecord,
      canonicalTurnMove,
    });
    state.contract = reduced.next;

    const memoryTrace =
      reduced.intent === "user_question" ||
      reduced.intent === "user_short_follow_up" ||
      reduced.intent === "user_refusal_or_confusion"
        ? traceWriteUserQuestion(state.sessionMemory, turn.user, turnNumber * 1000, 0.9)
        : reduced.intent === "user_answer"
          ? traceWriteUserAnswer(state.sessionMemory, turn.user, turnNumber * 1000, null, 0.88)
          : { memory: state.sessionMemory, attempted: [], committed: [] };
    state.sessionMemory = memoryTrace.memory;
    state.conversationState = noteConversationUserTurn(state.conversationState, {
      text: turn.user,
      userIntent: reduced.intent,
      routeAct: reduced.route.act,
      nowMs: turnNumber * 1000,
    });
    state.sceneState = noteSceneStateUserTurn(state.sceneState, {
      text: turn.user,
      act: reduced.route.act,
      sessionTopic: reduced.route.nextTopic,
      inventory: scenario.inventory,
    });

    const summaryRouteSelected = isProfileSummaryRequest(turn.user);
    const chatSwitchRouteSelected =
      isChatSwitchRequest(turn.user) && !state.sceneState.task_hard_lock_active;
    const shortFollowUpRouteSelected = reduced.route.act === "short_follow_up";
    const relationalRouteSelected =
      (isAssistantSelfQuestion(turn.user) || isMutualGettingToKnowRequest(turn.user)) &&
      !state.sceneState.task_hard_lock_active;
    const conversationMove = classifyCoreConversationMove({
      userText: turn.user,
      previousAssistantText,
      currentTopic,
    });
    const deterministicQuestionReply =
      !relationalRouteSelected &&
      shouldDeterministicallyAnswerOpenQuestionLocal(turn.user, state.sceneState, reduced.route.act)
        ? buildHumanQuestionFallback(turn.user, "neutral", {
            previousAssistantText,
            currentTopic,
          })
        : null;
    const scaffolded = buildSceneScaffoldReply({
      act: reduced.route.act,
      userText: turn.user,
      sceneState: state.sceneState,
      sessionMemory: state.sessionMemory,
      inventory: scenario.inventory,
      recentTaskTemplates:
        state.sceneState.task_progress !== "none" ? [state.sceneState.task_template_id] : [],
    });
    const shortFollowUpReply =
      shortFollowUpRouteSelected && !scaffolded
        ? buildShortClarificationReply({
            userText: turn.user,
            interactionMode: previousSceneState.interaction_mode,
            topicType: previousSceneState.topic_type,
            lastQuestion: state.sessionMemory.last_user_question?.value ?? null,
            lastAssistantText:
              previousAssistantText ?? previousSceneState.last_profile_prompt ?? null,
            lastUserAnswer: state.sessionMemory.last_user_answer?.value ?? null,
            currentTopic,
          })
        : null;
    const fallbackCandidate =
      buildSceneFallback(state.sceneState, turn.user, state.sessionMemory, scenario.inventory) ??
      buildTopicFallback(reduced.route.act, turn.user, state.contract.workingMemory, state.sceneState);
    const deterministicCandidate = scaffolded ?? shortFollowUpReply ?? deterministicQuestionReply;
    const selectedDeterministicCandidateSource = scaffolded
      ? "buildSceneScaffoldReply"
      : shortFollowUpReply
        ? "buildShortClarificationReply"
        : deterministicQuestionReply
          ? "buildHumanQuestionFallback"
          : deterministicCandidate
            ? "unknown_deterministic_candidate"
            : fallbackCandidate ===
                buildSceneFallback(state.sceneState, turn.user, state.sessionMemory, scenario.inventory)
              ? "buildSceneFallback"
              : "buildTopicFallback";
    const forcedDeterministicConversationReply =
      summaryRouteSelected ||
      chatSwitchRouteSelected ||
      relationalRouteSelected ||
      shortFollowUpRouteSelected ||
      Boolean(deterministicQuestionReply) ||
      isStableCoreConversationMove(conversationMove);
    const bypassModel =
      forcedDeterministicConversationReply ||
      shouldBypassModelForSceneTurn({
        sceneState: state.sceneState,
        dialogueAct: reduced.route.act,
        hasDeterministicCandidate: Boolean(deterministicCandidate),
      });
    const bypassReason = summaryRouteSelected
      ? "summary_route_selected"
      : chatSwitchRouteSelected
        ? "chat_switch_route_selected"
        : relationalRouteSelected
          ? "relational_route_selected"
          : shortFollowUpRouteSelected
            ? "short_follow_up_route_selected"
            : deterministicQuestionReply
              ? "deterministic_open_question_reply"
              : isStableCoreConversationMove(conversationMove)
                ? "stable_core_conversation_move"
                : bypassModel
                  ? "scene_state_bypass"
                  : "model_path";
    const selectedCandidateText =
      !bypassModel && turn.simulatedModelReply
        ? turn.simulatedModelReply
        : deterministicCandidate ?? fallbackCandidate;
    const turnPlan = buildTurnPlan(
      state.conversationState.recent_window.map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
      {
        conversationState: state.conversationState,
      },
    );
    const responseGate = applyResponseGate({
      text: selectedCandidateText,
      userText: turn.user,
      dialogueAct: reduced.route.act,
      lastAssistantText: previousAssistantText,
      turnPlan,
      sceneState: state.sceneState,
      commitmentState: createCommitmentState(),
      sessionMemory: state.sessionMemory,
      inventory: scenario.inventory ?? [],
    });

    const actualTrace = traceByTurn.get(turnNumber);
    const failedInvariants = result.violations
      .filter((violation) => violation.turnNumber === turnNumber)
      .map((violation) => ({
        invariant: violation.invariant,
        expected: violation.expected,
        actual: violation.actual,
        likelyCodePath: violation.likelyCodePath,
      }));

    if (failedInvariants.length > 0 && actualTrace) {
      failureMaps.push({
        scenarioId: scenario.id,
        turnNumber,
        rawUserText: turn.user,
        liveTurnDiagnostic: {
          intentUsed: diagnosticRecord.intentUsed,
          liveRouteAct: diagnosticRecord.liveRouteAct,
          stateRouteAct: diagnosticRecord.stateRouteAct,
          dialogueActUsed: diagnosticRecord.dialogueActUsed,
          coreConversationMoveUsed: diagnosticRecord.coreConversationMoveUsed,
          classifierDisagreement: diagnosticRecord.classifierDisagreement,
          disagreementKinds: diagnosticRecord.disagreementKinds,
        },
        canonicalTurnMove,
        reducedRoute: {
          act: reduced.route.act,
          reason: reduced.route.reason,
          nextTopicSummary: reduced.route.nextTopic?.summary ?? null,
        },
        replayBypass: {
          forcedDeterministicConversationReply,
          bypassModel,
          bypassReason,
          selectedDeterministicCandidateSource,
        },
        finalSelection: {
          finalPathWinner: actualTrace.winningResponseFamily,
          finalOutputSource: actualTrace.finalOutputSource,
          winningResponseFamily: actualTrace.winningResponseFamily,
          responseGateForced: responseGate.forced,
          responseGateReason: responseGate.reason,
        },
        finalAssistantText: actualTrace.finalText,
        failedInvariants,
      });
    }

    if (actualTrace?.oneOutputCommitted) {
      state.contract = reduceAssistantEmission(state.contract, {
        stepId: `replay-localize-${scenario.id}-${turnNumber}`,
        content: actualTrace.finalText,
        isQuestion: actualTrace.finalText.includes("?"),
      });
      const resolvesTopic =
        state.contract.sessionTopic?.topic_type === "game_selection" &&
        /(here is the game|we are doing|i pick\b|i will choose\b)/i.test(actualTrace.finalText);
      state.sceneState = noteSceneStateAssistantTurn(state.sceneState, {
        text: actualTrace.finalText,
        commitment: actualTrace.finalText,
        topicResolved: resolvesTopic,
      });
      if (state.sessionMemory.conversation_mode?.value !== state.sceneState.interaction_mode) {
        state.sessionMemory = writeConversationMode(
          state.sessionMemory,
          state.sceneState.interaction_mode,
          turnNumber * 1000 + 1,
          0.96,
        );
      }
      state.conversationState = noteConversationAssistantTurn(state.conversationState, {
        text: actualTrace.finalText,
        ravenIntent: reduced.route.act,
        nowMs: turnNumber * 1000 + 1,
      });
      state.outputs.push(actualTrace.finalText);
    }
  }

  return failureMaps;
}

test("conversation replay scenarios run with singular trace fields", async () => {
  const results = await replayConversationScenarios(CONVERSATION_REPLAY_SCENARIOS);
  for (const result of results) {
    for (const trace of result.traces) {
      assert.ok(trace.finalOutputSource.length > 0);
      assert.ok(trace.winningResponseFamily.length > 0);
      assert.equal(typeof trace.oneOutputCommitted, "boolean");
      assert.equal(Array.isArray(trace.memoryWritesAttempted), true);
      assert.equal(Array.isArray(trace.memoryWritesCommitted), true);
    }
  }
});

test("conversation replay scenarios are currently clean against replay invariants", async () => {
  const results = await replayConversationScenarios(CONVERSATION_REPLAY_SCENARIOS);
  const failures = results.flatMap((result) =>
    result.violations.map(
      (violation) =>
        `${violation.scenarioId}:${violation.turnNumber}:${violation.invariant}:${violation.actual}`,
    ),
  );
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("conversation replay summary aggregates scenario counts and style metrics", async () => {
  const results = await replayConversationScenarios(CONVERSATION_REPLAY_SCENARIOS.slice(0, 3));
  const summary = summarizeReplayResults(results);
  assert.equal(summary.scenarioCount, 3);
  assert.ok(summary.turnCount >= 3);
  assert.ok(summary.styles.personaConsistency >= 0);
  assert.ok(summary.styles.directness >= 0);
});

test("conversation replay traces the known greeting fallback failure as blocked", async () => {
  const scenario = CONVERSATION_REPLAY_SCENARIOS.find(
    (entry) => entry.id === "greeting_open_chat_blocked_clarification",
  );
  assert.ok(scenario);
  const result = await replayConversationScenario(scenario!);
  assert.equal(result.violations.length, 0);
  assert.equal(result.traces[0]?.finalOutputSource, "scene_fallback");
  assert.match(result.traces[0]?.finalText ?? "", /enough hovering|what you actually want/i);
  assert.doesNotMatch(
    result.traces[0]?.finalText ?? "",
    /ask the exact question you want answered|keep it specific|listen carefully/i,
  );
});

test("browser-live replay scenario ids are present in the scenario catalog", () => {
  const ids = new Set(CONVERSATION_REPLAY_SCENARIOS.map((scenario) => scenario.id));
  for (const id of BROWSER_LIVE_REPLAY_SCENARIO_IDS) {
    assert.equal(ids.has(id), true, `missing browser-live replay scenario: ${id}`);
  }
});

test("conversation replay targeted failure localization emits compact failure maps", async () => {
  const scenarios = CONVERSATION_REPLAY_SCENARIOS.filter((scenario) =>
    TARGET_FAILURE_SCENARIO_IDS.has(scenario.id),
  );
  assert.equal(scenarios.length, 3);

  for (const scenario of scenarios) {
    const result = await replayConversationScenario(scenario);
    const failureMaps = buildFailureMapsForScenario(scenario, result);
    if (failureMaps.length > 0) {
      console.info(
        "raven.replay.failure_map",
        JSON.stringify({
          scenarioId: scenario.id,
          failures: failureMaps,
        }),
      );
    }
    assert.equal(
      failureMaps.length > 0,
      false,
      `unexpected failure-map status for ${scenario.id}`,
    );
  }
});

test("profile building adaptive stays inside the accepted opener family", async () => {
  const scenario = CONVERSATION_REPLAY_SCENARIOS.find(
    (entry) => entry.id === "profile_building_adaptive",
  );
  assert.ok(scenario);

  const result = await replayConversationScenario(scenario!);
  assert.equal(
    result.violations.some((violation) => violation.scenarioId === "profile_building_adaptive"),
    false,
  );
  assert.match(
    result.traces[0]?.finalText ?? "",
    /what should i call you|what do you lose track of time doing|what boundaries|people usually miss about you|understand about you/i,
  );
  assert.doesNotMatch(
    result.traces[0]?.finalText ?? "",
    /what do you actually enjoy doing when you are off the clock/i,
  );
});

test("short follow up no cascade stays tied to the concrete profile prompt", async () => {
  const scenario = CONVERSATION_REPLAY_SCENARIOS.find(
    (entry) => entry.id === "short_follow_up_no_cascade",
  );
  assert.ok(scenario);

  const result = await replayConversationScenario(scenario!);
  assert.match(
    result.traces[1]?.finalText ?? "",
    /what you actually enjoy doing when you are off the clock|what people usually miss about you|name you want me to use when i am speaking to you directly/i,
  );
  assert.match(
    result.traces[2]?.finalText ?? "",
    /what you actually enjoy doing when you are off the clock|what people usually miss about you|name you want me to use when i am speaking to you directly/i,
  );
  assert.doesNotMatch(result.traces[1]?.finalText ?? "", /^I mean the piece I just pressed on\.$/i);
  assert.doesNotMatch(result.traces[2]?.finalText ?? "", /\bpart about piece\b/i);
});

test("profile building interpretive beat preserves the grounded answer", async () => {
  const scenario = CONVERSATION_REPLAY_SCENARIOS.find(
    (entry) => entry.id === "profile_building_interpretive_beat",
  );
  assert.ok(scenario);

  const result = await replayConversationScenario(scenario!);
  assert.doesNotMatch(result.traces[1]?.finalText ?? "", /what else should i know/i);
  assert.match(
    result.traces[1]?.finalText ?? "",
    /quieter|cleaner|not filler|quiets the noise|that tells me|hobby label/i,
  );
  assert.equal(
    result.violations.some((violation) => violation.scenarioId === "profile_building_interpretive_beat"),
    false,
  );
});
