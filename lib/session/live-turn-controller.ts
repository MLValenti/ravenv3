import type { HistoryMessage, ToneProfile } from "../chat-prompt.ts";
import {
  buildCoreConversationReply,
  classifyCoreConversationMove,
  isStableCoreConversationMove,
} from "../chat/core-turn-move.ts";
import { buildHumanQuestionFallback } from "../chat/open-question.ts";
import { buildRepairDebugHeaders, resolveRepairTurn } from "../chat/repair-turn.ts";
import type { ConversationStateSnapshot } from "../chat/conversation-state.ts";
import type { TurnPlan } from "../chat/turn-plan.ts";
import type { VerificationCapabilityCatalogEntry } from "../camera/vision-capabilities.ts";
import { getProfileFromDb, getProfileProgressFromDb } from "../db.ts";
import { buildDeterministicGameStart } from "./game-script.ts";
import {
  isAssistantSelfQuestion,
  isChatLikeSmalltalk,
  isMutualGettingToKnowRequest,
} from "./interaction-mode.ts";
import { buildOpenChatGreeting } from "./mode-style.ts";
import { evaluateObservationTrust } from "./observation-trust.ts";
import { replaySceneFromMessages } from "./replay-route-state.ts";
import { applyResponseGate } from "./response-gate.ts";
import { buildSceneScaffoldReply } from "./scene-scaffolds.ts";
import { buildSceneFallback, type SceneState } from "./scene-state.ts";
import {
  ensureSessionMemory,
  getLatestSessionMemoryUserText,
} from "./session-memory.ts";
import { normalizeSessionInventory } from "./session-inventory.ts";
import { buildShortClarificationReply } from "./short-follow-up.ts";
import {
  getStartedProposalFlowGuidance,
  isProposalAcceptanceCue,
  resolveWorkingMemoryContinuityTopic,
  shouldPreferFreshWorkingMemoryContinuity,
  shouldUseStartedProposalFlowGuidance,
  type WorkingMemory,
} from "./working-memory.ts";
import { createCommitmentState } from "./commitment-engine.ts";
import { explainBypassModelForSceneTurn } from "./deterministic-scene-routing.ts";
import type {
  PersistTaskFromAssistantTextInput,
  PersistTaskFromAssistantTextResult,
} from "./task-persistence.ts";

export type SessionReplayDebugContext = {
  latestUserMessage: string;
  detectedUserAct: string;
  currentSessionMode: string;
  replayedSceneStateSummary: string;
  sceneScope: "task_scoped" | "game_scoped" | "open_conversation";
  sceneTopicLocked: boolean;
  taskHardLockActive: boolean;
  deterministicBypassTriggered: boolean;
  deterministicBypassReason: string;
  preModelCandidateSource: string;
  directQuestion: boolean;
};

type BuildChatTraceHeadersInput = {
  requestId: string;
  turnId: string;
  generationPath: string;
  modelRan: boolean;
  deterministicRail?: string | null;
  postProcessed?: boolean;
};

type PersistTaskFromAssistantText = (
  input: PersistTaskFromAssistantTextInput,
) => Promise<PersistTaskFromAssistantTextResult>;

export type SessionReplayDeterministicBypassInput = {
  sessionMode: boolean;
  plannerEnabled: boolean;
  lastUserMessage: HistoryMessage | undefined;
  messages: HistoryMessage[];
  inventory: unknown;
  deviceOptIn: boolean;
  observations: unknown;
  emergencyStopStopped: boolean;
  workingMemory: WorkingMemory;
  lastAssistantOutput: string | null;
  conversationStateSnapshot: ConversationStateSnapshot;
  toneProfile: ToneProfile;
  turnPlan: TurnPlan;
  requestId: string;
  turnId: string;
  sessionId: string;
  capabilityCatalog: VerificationCapabilityCatalogEntry[];
  allowedCheckTypes: string[];
  logSessionRouteDebug: (payload: Record<string, unknown>) => void;
  maybePersistTaskFromAssistantText: PersistTaskFromAssistantText;
  appendChatHistory: (role: "assistant", content: string, sessionId: string) => Promise<void>;
  persistSessionTurnSummary: (
    sessionId: string,
    userText: string,
    assistantText: string,
    state: ConversationStateSnapshot,
    mode: string,
  ) => Promise<void>;
  createStaticAssistantNdjsonResponse: (
    text: string,
    extraHeaders?: Record<string, string>,
  ) => Response;
  buildChatTraceHeaders: (input: BuildChatTraceHeadersInput) => Record<string, string>;
};

export type SessionReplayDeterministicBypassResult = {
  response: Response | null;
  sessionReplayDebugContext: SessionReplayDebugContext | null;
};

function previousAssistantText(messages: HistoryMessage[]): string | null {
  const copy = [...messages].reverse();
  const lastAssistant = copy.find((message) => message.role === "assistant");
  return lastAssistant?.content ?? null;
}

export function summarizeReplaySceneState(sceneState: SceneState): string {
  return [
    `mode=${sceneState.interaction_mode}`,
    `topic=${sceneState.topic_type}`,
    `locked=${sceneState.topic_locked ? "yes" : "no"}`,
    `goal=${sceneState.agreed_goal || "none"}`,
    `task=${sceneState.task_progress}`,
    `game=${sceneState.game_progress}`,
    `rule=${sceneState.current_rule || "none"}`,
  ].join(" ");
}

export function classifyReplaySceneScope(
  sceneState: Pick<SceneState, "interaction_mode" | "topic_type" | "task_hard_lock_active">,
): "task_scoped" | "game_scoped" | "open_conversation" {
  if (
    sceneState.interaction_mode === "task_planning" ||
    sceneState.interaction_mode === "locked_task_execution" ||
    sceneState.topic_type === "task_negotiation" ||
    sceneState.topic_type === "task_execution" ||
    sceneState.topic_type === "task_terms_negotiation" ||
    sceneState.topic_type === "duration_negotiation" ||
    sceneState.task_hard_lock_active
  ) {
    return "task_scoped";
  }
  if (
    sceneState.interaction_mode === "game" ||
    sceneState.topic_type === "game_setup" ||
    sceneState.topic_type === "game_execution" ||
    sceneState.topic_type === "reward_negotiation" ||
    sceneState.topic_type === "reward_window"
  ) {
    return "game_scoped";
  }
  return "open_conversation";
}

export function detectDirectQuestionTurn(text: string, act: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes("?") ||
    act === "user_question" ||
    act === "short_follow_up" ||
    /^(what|why|how|when|where|who|do|does|did|can|could|should|would|are|is)\b/.test(normalized)
  );
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
}

export function answeredDirectQuestionFirst(userText: string, finalText: string, act: string): boolean {
  if (!detectDirectQuestionTurn(userText, act)) {
    return false;
  }
  const normalizedUser = userText.trim().toLowerCase();
  const first = firstSentence(finalText).toLowerCase();
  if (!first) {
    return false;
  }
  if (act === "short_follow_up") {
    return /\b(i mean|because|when you said|i was talking about|my point was|the part)\b/.test(first);
  }
  if (/\bok do we start now\b|\bdo we start now\b/.test(normalizedUser)) {
    return /\b(yes|we start now|start now|we do|now)\b/.test(first);
  }
  if (/\bwhat should our session be about\b/.test(normalizedUser)) {
    return /\b(session|about|focus|start with|talk about|make it about)\b/.test(first);
  }
  return (
    /\b(i|we|it|yes|no|because|start|focus|about|means)\b/.test(first) &&
    !/\b(here is your task|reply done|check in once halfway through)\b/.test(first)
  );
}

export async function maybeHandleSessionReplayDeterministicBypass(
  input: SessionReplayDeterministicBypassInput,
): Promise<SessionReplayDeterministicBypassResult> {
  if (!input.sessionMode || input.plannerEnabled || !input.lastUserMessage) {
    return { response: null, sessionReplayDebugContext: null };
  }

  const profile = await getProfileFromDb();
  const progress = await getProfileProgressFromDb();
  const normalizedInventory = normalizeSessionInventory(input.inventory);
  const replayed = replaySceneFromMessages({
    messages: input.messages,
    inventory: normalizedInventory,
    deviceControlActive: input.deviceOptIn && !input.emergencyStopStopped,
    profile,
    progress,
  });
  const normalizedLastUser = input.lastUserMessage.content.trim().toLowerCase();
  const replayedSessionMemory = ensureSessionMemory(replayed.sessionMemory);
  const replayedLastUserText = getLatestSessionMemoryUserText(replayedSessionMemory);
  const replayHasActiveFlow =
    replayed.sceneState.task_hard_lock_active ||
    replayed.sceneState.interaction_mode === "game" ||
    replayed.sceneState.interaction_mode === "locked_task_execution" ||
    replayed.sceneState.topic_type === "task_execution" ||
    replayed.sceneState.topic_type === "verification_in_progress";
  const startedProposalFlowReply =
    !replayHasActiveFlow &&
    shouldUseStartedProposalFlowGuidance({
      memory: input.workingMemory,
      latestUserText: input.lastUserMessage.content,
      dialogueAct: replayed.latestAct,
    })
      ? getStartedProposalFlowGuidance(input.workingMemory)
      : null;
  if (startedProposalFlowReply) {
    // Once a pending proposal is explicitly accepted, reuse that started flow instead of drifting back into chat.
    await input.appendChatHistory("assistant", startedProposalFlowReply, input.sessionId);
    await input.persistSessionTurnSummary(
      input.sessionId,
      input.lastUserMessage.content,
      startedProposalFlowReply,
      input.conversationStateSnapshot,
      "deterministic_scene",
    );
    input.logSessionRouteDebug({
      stage: "session_final",
      latest_user_message: input.lastUserMessage.content,
      detected_user_act: replayed.latestAct,
      current_session_mode: input.conversationStateSnapshot.current_mode,
      replayed_scene_state: summarizeReplaySceneState(replayed.sceneState),
      scene_scope: classifyReplaySceneScope(replayed.sceneState),
      deterministic_bypass_triggered: true,
      deterministic_bypass_reason: isProposalAcceptanceCue(input.lastUserMessage.content)
        ? "working_memory_proposal_acceptance_starts_flow"
        : "working_memory_started_flow_guidance",
      model_called: false,
      chosen_response_source: "deterministic scene",
      direct_question: detectDirectQuestionTurn(input.lastUserMessage.content, replayed.latestAct),
      answered_direct_question_first: answeredDirectQuestionFirst(
        input.lastUserMessage.content,
        startedProposalFlowReply,
        replayed.latestAct,
      ),
      pre_model_candidate_source: "working_memory_started_flow",
      final_output_source: "workingMemoryStartedFlow",
      turn_plan_check: "pass:working_memory_started_flow",
    });
    return {
      response: input.createStaticAssistantNdjsonResponse(startedProposalFlowReply, {
        ...input.buildChatTraceHeaders({
          requestId: input.requestId,
          turnId: input.turnId,
          generationPath: "deterministic-working-memory-flow",
          modelRan: false,
          deterministicRail: "working_memory_started_flow",
          postProcessed: false,
        }),
        "x-raven-dialogue-act": replayed.latestAct,
        "x-raven-source": "working-memory-started-flow",
      }),
      sessionReplayDebugContext: null,
    };
  }
  const deterministicQuickChoiceReply =
    (replayed.latestAct === "answer_activity_choice" ||
      replayed.latestAct === "propose_activity") &&
    replayed.sceneState.scene_type === "game" &&
    replayed.sceneState.topic_type !== "game_execution" &&
    replayed.sceneState.topic_type !== "reward_negotiation" &&
    /\b(i choose quick|i chose quick|i'?ll choose quick|ill choose quick|choose quick|quick game|i pick quick)\b/.test(
      normalizedLastUser,
    )
      ? buildDeterministicGameStart(replayed.sceneState.game_template_id)
      : null;
  if (deterministicQuickChoiceReply) {
    await input.appendChatHistory("assistant", deterministicQuickChoiceReply, input.sessionId);
    await input.persistSessionTurnSummary(
      input.sessionId,
      input.lastUserMessage.content,
      deterministicQuickChoiceReply,
      input.conversationStateSnapshot,
      "deterministic_scene",
    );
    return {
      response: input.createStaticAssistantNdjsonResponse(deterministicQuickChoiceReply, {
        ...input.buildChatTraceHeaders({
          requestId: input.requestId,
          turnId: input.turnId,
          generationPath: "deterministic-game-choice",
          modelRan: false,
          deterministicRail: "game_quick_choice",
          postProcessed: false,
        }),
        "x-raven-dialogue-act": replayed.latestAct,
        "x-raven-source": "deterministic-game-choice",
      }),
      sessionReplayDebugContext: null,
    };
  }
  const effectiveSceneAct = replayed.latestAct;
  const lastAssistantOutput =
    input.lastAssistantOutput ?? previousAssistantText(input.messages);
  const workingMemoryContinuityTopic = resolveWorkingMemoryContinuityTopic(input.workingMemory);
  const preferFreshWorkingMemoryContinuity = shouldPreferFreshWorkingMemoryContinuity({
    memory: input.workingMemory,
    latestUserText: input.lastUserMessage.content,
    dialogueAct: effectiveSceneAct,
  });
  // Working memory is a fresher continuity hint for short live turns than stale replayed negotiation state.
  const currentTopic =
    workingMemoryContinuityTopic ?? replayed.sceneState.agreed_goal ?? null;
  const repairResolution = resolveRepairTurn({
    userText: input.lastUserMessage.content,
    previousAssistantText: lastAssistantOutput,
    previousUserText: replayedLastUserText,
    currentTopic,
    memoryFallbackText: replayedLastUserText,
  });
  const shortFollowUpReply =
    effectiveSceneAct === "short_follow_up"
      ? buildShortClarificationReply({
          userText: input.lastUserMessage.content,
          interactionMode: replayed.sceneState.interaction_mode,
          topicType: replayed.sceneState.topic_type,
          lastAssistantText: lastAssistantOutput,
          lastUserText: replayedLastUserText,
          lastUserAnswer: replayedSessionMemory.last_user_answer?.value ?? null,
          currentTopic,
        })
      : null;
  const relationalRouteSelected =
    (isAssistantSelfQuestion(input.lastUserMessage.content) ||
      isMutualGettingToKnowRequest(input.lastUserMessage.content)) &&
    !replayed.sceneState.task_hard_lock_active;
  const coreConversationMove = classifyCoreConversationMove({
    userText: input.lastUserMessage.content,
    previousAssistantText: lastAssistantOutput,
    currentTopic,
  });
  const deterministicCoreConversationReply = isStableCoreConversationMove(coreConversationMove)
    ? buildCoreConversationReply({
        userText: input.lastUserMessage.content,
        previousAssistantText: lastAssistantOutput,
        currentTopic,
      })
    : null;
  const deterministicGreetingReply =
    isChatLikeSmalltalk(input.lastUserMessage.content) && !replayed.sceneState.task_hard_lock_active
      ? buildOpenChatGreeting()
      : null;
  const deterministicRelationalReply = relationalRouteSelected
    ? buildHumanQuestionFallback(input.lastUserMessage.content, input.toneProfile, {
        previousAssistantText: lastAssistantOutput,
        currentTopic,
      })
    : null;
  const shouldSkipScaffoldCompetition =
    effectiveSceneAct === "short_follow_up" ||
    relationalRouteSelected;
  const scaffolded = shouldSkipScaffoldCompetition
    ? null
    : buildSceneScaffoldReply({
        act: effectiveSceneAct,
        userText: input.lastUserMessage.content,
        sceneState: replayed.sceneState,
        deviceControlActive: input.deviceOptIn && !input.emergencyStopStopped,
        profile,
        progress,
        inventory: normalizedInventory,
      });
  const deterministicWeakReply = scaffolded ? null : null;
  const sceneFallbackFromState = preferFreshWorkingMemoryContinuity
    ? null
    : buildSceneFallback(
        replayed.sceneState,
        input.lastUserMessage.content,
        replayedSessionMemory,
        normalizedInventory,
      );
  const sceneFallback =
    sceneFallbackFromState ??
    buildHumanQuestionFallback(input.lastUserMessage.content, input.toneProfile, {
      previousAssistantText: lastAssistantOutput,
      currentTopic,
    });
  const sceneFallbackSource = sceneFallbackFromState
    ? "buildSceneFallback"
    : "buildHumanQuestionFallback";
  const deterministicCandidate =
    shortFollowUpReply ??
    deterministicCoreConversationReply ??
    deterministicGreetingReply ??
    deterministicRelationalReply ??
    scaffolded ??
    deterministicWeakReply;
  const deterministicCandidateSource = shortFollowUpReply
    ? "short_follow_up"
    : deterministicCoreConversationReply
      ? "core_conversation"
      : deterministicGreetingReply
        ? "greeting"
        : deterministicRelationalReply
          ? "relational"
          : scaffolded
            ? "scene_scaffold"
            : deterministicWeakReply
              ? "deterministic_weak"
              : sceneFallbackSource;
  const bypassDecision =
    preferFreshWorkingMemoryContinuity && !replayed.sceneState.task_hard_lock_active
      ? {
          bypass: false,
          reason: "working_memory_pending_unaccepted_proposal_prefers_fresh_turn",
        }
      : explainBypassModelForSceneTurn({
          sceneState: replayed.sceneState,
          dialogueAct: effectiveSceneAct,
          hasDeterministicCandidate: Boolean(deterministicCandidate),
          latestUserText: input.lastUserMessage.content,
        });
  const bypassModel = bypassDecision.bypass;
  const directQuestion = detectDirectQuestionTurn(input.lastUserMessage.content, effectiveSceneAct);
  const sessionReplayDebugContext: SessionReplayDebugContext = {
    latestUserMessage: input.lastUserMessage.content,
    detectedUserAct: effectiveSceneAct,
    currentSessionMode: input.conversationStateSnapshot.current_mode,
    replayedSceneStateSummary: summarizeReplaySceneState(replayed.sceneState),
    sceneScope: classifyReplaySceneScope(replayed.sceneState),
    sceneTopicLocked: replayed.sceneState.topic_locked,
    taskHardLockActive: replayed.sceneState.task_hard_lock_active,
    deterministicBypassTriggered: bypassModel,
    deterministicBypassReason: bypassDecision.reason,
    preModelCandidateSource: deterministicCandidateSource,
    directQuestion,
  };
  input.logSessionRouteDebug({
    stage: "session_replay",
    latest_user_message: sessionReplayDebugContext.latestUserMessage,
    detected_user_act: sessionReplayDebugContext.detectedUserAct,
    current_session_mode: sessionReplayDebugContext.currentSessionMode,
    replayed_scene_state: sessionReplayDebugContext.replayedSceneStateSummary,
    scene_scope: sessionReplayDebugContext.sceneScope,
    deterministic_bypass_triggered: sessionReplayDebugContext.deterministicBypassTriggered,
    deterministic_bypass_reason: sessionReplayDebugContext.deterministicBypassReason,
    model_called: false,
    chosen_response_source: "pending",
    direct_question: sessionReplayDebugContext.directQuestion,
    answered_direct_question_first: false,
    pre_model_candidate_source: sessionReplayDebugContext.preModelCandidateSource,
  });

  if (!bypassModel) {
    return { response: null, sessionReplayDebugContext };
  }

  const gated = applyResponseGate({
    text: deterministicCandidate ?? sceneFallback,
    userText: input.lastUserMessage.content,
    dialogueAct: effectiveSceneAct,
    lastAssistantText: lastAssistantOutput,
    toneProfile: input.toneProfile,
    turnPlan: input.turnPlan,
    sceneState: replayed.sceneState,
    commitmentState: createCommitmentState(),
    sessionMemory: null,
    inventory: normalizedInventory,
    observationTrust: evaluateObservationTrust(input.observations),
  });
  const persisted = await input.maybePersistTaskFromAssistantText({
    text: gated.text,
    lastUserText: input.lastUserMessage.content,
    allowedCheckTypes: input.allowedCheckTypes,
    sessionMode: input.sessionMode,
    capabilityCatalog: input.capabilityCatalog,
    sessionId: input.sessionId,
    turnId: input.turnId,
  });
  const chosenResponseSource = gated.forced ? "response-gate fallback" : "deterministic scene";
  input.logSessionRouteDebug({
    stage: "session_final",
    latest_user_message: input.lastUserMessage.content,
    detected_user_act: effectiveSceneAct,
    current_session_mode: input.conversationStateSnapshot.current_mode,
    replayed_scene_state: summarizeReplaySceneState(replayed.sceneState),
    scene_scope: classifyReplaySceneScope(replayed.sceneState),
    deterministic_bypass_triggered: true,
    deterministic_bypass_reason: bypassDecision.reason,
    model_called: false,
    chosen_response_source: chosenResponseSource,
    direct_question: directQuestion,
    answered_direct_question_first: answeredDirectQuestionFirst(
      input.lastUserMessage.content,
      persisted.text,
      effectiveSceneAct,
    ),
    pre_model_candidate_source: deterministicCandidateSource,
  });
  await input.appendChatHistory("assistant", persisted.text, input.sessionId);
  await input.persistSessionTurnSummary(
    input.sessionId,
    input.lastUserMessage.content,
    persisted.text,
    input.conversationStateSnapshot,
    "deterministic_scene",
  );
  const repairDebugHeaders = buildRepairDebugHeaders(repairResolution);
  return {
    response: input.createStaticAssistantNdjsonResponse(persisted.text, {
      ...input.buildChatTraceHeaders({
        requestId: input.requestId,
        turnId: input.turnId,
        generationPath: "deterministic-scene",
        modelRan: false,
        deterministicRail: "scene_bypass",
        postProcessed: false,
      }),
      "x-raven-dialogue-act": effectiveSceneAct,
      "x-raven-source": "deterministic-scene",
      "x-raven-final-output-source": deterministicCandidate
        ? "deterministic_candidate"
        : sceneFallbackSource,
      "x-raven-task-create-source": persisted.taskCreateSource,
      "x-raven-task-create-kind": persisted.taskCreateKind,
      "x-raven-task-origin-turn-id": input.turnId,
      ...repairDebugHeaders,
      ...(persisted.createdTaskId
        ? {
            "x-raven-task-created": "1",
            "x-raven-task-id": persisted.createdTaskId,
          }
        : {}),
    }),
    sessionReplayDebugContext,
  };
}
