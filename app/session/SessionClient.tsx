"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useEmergencyStop } from "@/components/emergency-stop-provider";
import {
  classifyDialogueRoute,
  isTopicUnresolved,
  type DialogueRouteAct,
  type SessionTopic,
} from "@/lib/dialogue/router";
import type { CheckRunner } from "@/lib/camera/check-runner";
import type { CameraDiagnostics, CameraEvent } from "@/lib/camera/events";
import type { VisionObservation } from "@/lib/camera/observation";
import {
  buildCapabilityCatalog,
  buildCapabilityCatalogPrompt,
  getVisionSignalsStatus,
  type PlannerCheckValidationReport,
  type VerificationCapabilityCatalogEntry,
  type VisionSignalsStatus,
} from "@/lib/camera/vision-capabilities";
import { type ConsentState, loadConsentFromStorage } from "@/lib/consent";
import {
  buildHumanQuestionFallback,
  isTopicInitiationRequest,
} from "@/lib/chat/open-question";
import {
  buildCoreConversationReply,
  classifyCoreConversationMove,
  isStableCoreConversationMove,
  type CoreConversationMove,
} from "@/lib/chat/core-turn-move";
import { buildClientChatMessages } from "@/lib/chat/request-messages";
import { buildTurnPlan } from "@/lib/chat/turn-plan";
import {
  buildConversationStateBlock,
  createConversationStateSnapshot,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
  normalizeConversationStateSnapshot,
  type ConversationStateSnapshot,
} from "@/lib/chat/conversation-state";
import { questionSatisfiedMeaningfully } from "@/lib/chat/question-satisfaction";
import { applyPlannerConstraints } from "@/lib/session/plan-constraints";
import { PacingController, type Pace } from "@/lib/session/pacing";
import { shouldStopForTrackingLost } from "@/lib/session/tracking-watchdog";
import { evaluateWarmup, type WarmupPhase } from "@/lib/session/warmup-gate";
import { evaluateObservationTrust } from "@/lib/session/observation-trust";
import { publishRuntimeEvent } from "@/lib/runtime-event-bus";
import { DEFAULT_SETTINGS, type SettingsState, loadSettingsFromStorage } from "@/lib/settings";
import { speakRavenText } from "@/lib/speech";
import { guardDeviceCommandCapabilities } from "@/lib/devices/capability-guard";
import {
  buildProgressSummaryLines,
  evaluateTaskCameraEvidence,
  buildTaskRewardPolicyBlock,
  getTierRewards,
  partitionTaskReviewQueue,
  type TaskCatalogItem,
  type TaskReviewQueueItem,
} from "@/lib/tasks/system";
import { ensureDefaultEvidenceProvidersRegistered } from "@/lib/vision/providers";
import type {
  ProfileProgressRow,
  TaskEvidenceEventStatus,
  TaskEvidenceEventRow,
  TaskOccurrenceRow,
  TaskOutcomeEventRow,
  TaskPreferencesRow,
  TaskRow,
} from "@/lib/db";
import {
  MILESTONE4_STEPS,
  StepEngine,
  type SessionState,
  type SessionStep,
  type StepEngineEvent,
} from "@/lib/session/step-engine";
import {
  extractStableFactsFromResponse,
  updateMemorySummary,
} from "@/lib/session/memory-extractor";
import { planNextStep } from "@/lib/session/step-planner";
import {
  summarizeCheckResult,
  summarizeLastSteps,
  type PlannedStep,
  type PlannerTrackingStatus,
} from "@/lib/session/step-planner-schema";
import {
  applyMoodEvent,
  createInitialMoodState,
  readMoodSnapshot,
  resetMoodForNewSession,
  type MoodEventType,
  type MoodSnapshot,
  type MoodState,
} from "@/lib/session/mood-manager";
import {
  createDefaultRelationshipState,
  normalizeRelationshipState,
  type RelationshipState,
  type SessionRelationshipMetrics,
} from "@/lib/session/relationship-manager";
import {
  buildSessionStatePromptBlock,
  deriveTonePolicy,
  stepDifficultyLevel,
  type DifficultyLevel,
  type TonePolicy,
} from "@/lib/session/state-policy";
import {
  formatDeviceActionForDisplay,
  parseDeviceActionRequest,
  stripActionJsonBlock,
} from "@/lib/session/action-request";
import type { DeviceActionRequest } from "@/lib/session/action-request";
import {
  buildVerificationSummary,
  selectDialogueAct,
  type DialogueAct,
} from "@/lib/session/dialogue-manager";
import {
  buildSessionReviewLines,
  hasResumableSessionSnapshot,
  sanitizeSessionResumeSnapshot,
  sanitizeSessionReviewSnapshot,
  type SessionResumeSnapshot,
  type SessionReviewSnapshot,
} from "@/lib/session/session-review";
import { classifyUserIntent, type UserIntent } from "@/lib/session/intent-router";
import { buildShortClarificationReply } from "@/lib/session/short-follow-up";
import { inspectGameStartContract } from "@/lib/session/game-start-contract";
import {
  chooseDeliveredAssistantText,
  sanitizeSessionVisibleAssistantText,
  shouldAllowVisibleAssistantCommit,
  shouldPreferServerTurnContract,
  shouldPreserveQueuedUserTurnOnSessionStart,
  shouldRecoverSkippedAssistantRender,
} from "@/lib/session/live-turn-integrity";
import {
  chooseNextAskSlot,
  createSessionMemory,
  getSessionMemoryFocus,
  isConversationArrivalAnswer,
  listMissingAskSlots,
  summarizeSessionMemory,
  traceWriteUserAnswer,
  traceWriteUserQuestion,
  type SessionMemory,
  type SessionMemorySlotKey,
  writeConversationMode,
  writeVerifiedResult,
} from "@/lib/session/session-memory";
import {
  buildWorkingMemoryBlock,
  createWorkingMemory,
  noteWorkingMemoryAssistantTurn,
  type WorkingMemory,
} from "@/lib/session/working-memory";
import {
  buildDeterministicVisualObservationReply,
  isVisualStatusQuestion,
} from "@/lib/session/visual-observation-reply";
import {
  getSessionInventoryDisplayName,
  loadSessionInventoryFromStorage,
  needsInventoryClarification,
  saveSessionInventoryToStorage,
  type SessionInventoryItem,
} from "@/lib/session/session-inventory";
import { shouldAssignProactiveInventoryTask } from "@/lib/session/proactive-task";
import {
  buildDeterministicTaskCreatePayload,
  buildDeterministicTaskPlanFromRequest,
  deriveLearnedPenaltyPoints,
  deriveLearnedRewardTemplate,
  deriveLearnedTaskStrictness,
  findDeterministicTaskTemplateByDuration,
  isTaskAssignmentText,
  resolveDeterministicTaskTemplateById,
  selectDeterministicTaskTemplate,
  type DeterministicTaskPlan,
} from "@/lib/session/task-script";
import { getDeterministicTaskTimerSnapshot } from "@/lib/session/task-timer";
import {
  buildDeterministicTaskAttemptSpec,
  buildTaskBoardSummary,
  classifyTaskUserCommand,
  findNextPendingOccurrence,
} from "@/lib/session/task-bridge";
import {
  applyCommitmentDecision,
  buildCommitmentPromptBlock,
  clearVerificationCommitment,
  createCommitmentState,
  createVerificationCommitment,
  isResponseAlignedWithCommitment,
  type CommitmentState,
} from "@/lib/session/commitment-engine";
import {
  buildLeverageSummary,
  buildSceneFallback,
  buildSceneStatePromptBlock,
  createSceneState,
  isResponseAlignedWithSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
  noteSceneVerificationResult,
  type SceneState,
} from "@/lib/session/scene-state";
import { reconcileSceneStateWithConversation } from "@/lib/session/conversation-runtime";
import { shouldBypassModelForSceneTurn } from "@/lib/session/deterministic-scene-routing";
import { applyResponseGate } from "@/lib/session/response-gate";
import {
  buildRelationalChatReply,
  buildSceneScaffoldReply,
  isInventoryUseQuestion,
} from "@/lib/session/scene-scaffolds";
import { buildTopicFallback } from "@/lib/session/topic-fallback";
import {
  isChatSwitchRequest,
  isProfileSummaryRequest,
  isMutualGettingToKnowRequest,
  isAssistantServiceQuestion,
  isAssistantSelfQuestion,
  isRelationalOfferStatement,
} from "@/lib/session/interaction-mode";
import { isCoherentRelationalQuestionAnswer } from "@/lib/chat/relational-answer-alignment";
import { buildChatSwitchReply, buildOpenChatGreeting } from "@/lib/session/mode-style";
import {
  buildVerificationManualConfirmationPrompt,
  buildVerificationManualConfirmationReply,
  buildVerificationOutcomeReply,
} from "@/lib/session/verification-scaffolds";
import { buildVerificationContinuation } from "@/lib/session/verification-transitions";
import {
  buildPhaseReflection,
  deriveSessionPhase,
  shouldEmitReflection,
  type SessionPhase,
} from "@/lib/session/session-phase";
import {
  finalizeTurnResponse,
  type TurnResponseFamily,
} from "@/lib/session/turn-response";
import {
  canEmitAssistant,
  createTurnGate,
  incrementStepRepeatCount,
  shouldHoldForNoNewUserAfterAssistant,
  type TurnGateState,
} from "@/lib/session/turn-gate";
import {
  beginTurnRequest,
  canCommitAssistantReplay,
  canCommitAnchoredAssistantTurn,
  canCommitAssistantTurn,
  finishTurnRequest,
  markAssistantReplay,
  markAssistantTurnCommitted,
  normalizeAssistantCommitText,
  registerStreamFinalize,
} from "@/lib/session/assistant-turn-guard";
import {
  createSessionStateContract,
  projectTurnGateUi,
  reduceAssistantEmission,
  reduceUserTurn,
  type SessionStateContract,
} from "@/lib/session/session-state-contract";
import {
  runVerification,
  shouldRequestUserConfirmation,
  shouldRetryVerification,
  type VerificationCheckType,
  type VerificationResult,
} from "@/lib/session/verification";
import { normalizeProfileInput, type ProfileState } from "@/lib/profile";
import type { DeviceConnectionStatus, DeviceInfo } from "@/lib/devices/types";
import type { CameraPanelHandle } from "./CameraPanel";

const CameraPanel = dynamic(() => import("./CameraPanel"), {
  ssr: false,
  loading: () => (
    <div className="camera-preview-wrap">
      <video className="camera-preview camera-preview-mirrored" muted playsInline />
      <canvas className="camera-overlay camera-preview-mirrored" />
    </div>
  ),
});

ensureDefaultEvidenceProvidersRegistered();

type FeedItem = {
  timestamp: number;
  label: string;
  detail: string;
};

type MemoryApiPreferences = {
  auto_save: boolean;
  auto_save_goals: boolean;
  auto_save_constraints: boolean;
  auto_save_preferences: boolean;
  suggestion_snooze_until: string | null;
};

type MemoryApiSuggestion = {
  id: string;
  key: string;
  value: string;
  type: string;
  confidence: number;
};

type MemoryApiResponse = {
  preferences?: MemoryApiPreferences;
  suggestions?: MemoryApiSuggestion[];
};

type MemoryDebugState = {
  extractedCandidates: Array<{
    key: string;
    value: string;
    type: string;
    importance: number;
    stability: number;
    confidence: number;
    rationale: string;
  }>;
  pendingSuggestions: Array<{ id: string; key: string; value: string; status: string }>;
  retrievedMemories: Array<{ id: string; key: string; value: string; type: string }>;
  injectedMemoryBlock: string;
};

type ImmersionDebugState = {
  timestamp: number;
  dialogueAct: string;
  sessionPhase: string;
  selectedPlaybooks: string[];
  criticReasons: string[];
  shapeReason: string;
  noopReason: string | null;
};

type PromptDebugState = {
  sessionId: string;
  timestamp: number;
  stateSnapshot: string;
  responseStrategy: string;
  promptSizeEstimate: number;
  includedTurns: Array<{ role: string; content: string; reason: string }>;
  excludedTurns: Array<{ role: string; content: string; reason: string }>;
  includedContext: string[];
  assembledPromptPreview: string[];
};

type TasksApiResponse = {
  active?: TaskRow[];
  history?: TaskRow[];
  events?: TaskEvidenceEventRow[];
  occurrences?: TaskOccurrenceRow[];
  outcomes?: TaskOutcomeEventRow[];
  preferences?: TaskPreferencesRow;
  catalogs?: {
    rewards?: TaskCatalogItem[];
    consequences?: TaskCatalogItem[];
  };
  today?: Array<{ task_id: string; pending: number; completed: number; missed: number }>;
  progress?: ProfileProgressRow;
  rewards?: string[];
  review_queue?: TaskReviewQueueItem[];
  error?: string;
  task?: TaskRow;
  created?: TaskRow;
  validation?: {
    notes?: string[];
  };
  pointsAwarded?: number;
  tierUp?: boolean;
  reviewSubmitted?: boolean;
  baselineSet?: boolean;
  baselinePromoted?: boolean;
  baselineCleared?: boolean;
};

type SessionMode = "scripted" | "dynamic";

type DynamicOutcome = "passed" | "failed" | "timeout" | "stopped";

type DynamicRuntime = {
  warming: boolean;
  active: boolean;
  stepCount: number;
  plannerAbort: AbortController | null;
  loopId: number;
};

type AssistantReplySource =
  | "model"
  | "deterministic_scene"
  | "deterministic_task"
  | "deterministic_observation"
  | "verification"
  | "ask"
  | "planner"
  | "scripted";

type AssistantTraceMeta = {
  requestId: string;
  sessionId: string;
  sourceUserMessageId: number;
  stepId: string;
  source: AssistantReplySource;
  modelRan: boolean;
  deterministicRail: string | null;
  postProcessed: boolean;
  startedAtMs: number;
  turnIdEstimate: number;
  generationPath: string | null;
  serverRequestId: string | null;
  serverTurnId: string | null;
  finalOutputSource: TurnResponseFamily;
  outputGeneratorCount: number;
  rawGameStartDetected?: boolean;
  rawGameStartQuestionPresent?: boolean;
  finalGameStartQuestionPresent?: boolean;
};

type SessionTurnDebugEntry = {
  turnId: string;
  sourceUserMessageId: number;
  userText: string;
  ravenOutputText: string;
  assistantRenderAppendEvents: number;
  recoverSkippedAssistantRenderFired: boolean;
  appendRavenOutputRunsForTurn: number;
  visibleAssistantStringsShownForTurn: number;
  createdAt: number;
  conversationMode: string | null;
};

function mapAssistantReplySourceToTurnResponseFamily(
  source: AssistantReplySource,
): TurnResponseFamily {
  switch (source) {
    case "deterministic_scene":
    case "deterministic_task":
    case "deterministic_observation":
    case "model":
      return source;
    case "verification":
    case "ask":
    case "planner":
    case "scripted":
      return "deterministic_scene";
  }
}

type PreparedConversationNode = {
  node: ConversationNode;
  trace: Omit<AssistantTraceMeta, "sessionId" | "sourceUserMessageId" | "stepId" | "startedAtMs" | "turnIdEstimate" | "requestId">;
};

type ConversationNode =
  | {
      id: string;
      type: "instruct_step";
      text: string;
      check_required: boolean;
      check_type: VerificationCheckType | null;
      check_params: Record<string, unknown>;
      retry_policy: "none" | "single_retry";
      timeoutSeconds: number;
      maxRetries: number;
      phase: SessionPhase;
    }
  | {
      id: string;
      type: "ask_step";
      question: string;
      slotKey: SessionMemorySlotKey;
      timeoutSeconds: number;
      maxRetries: number;
      phase: SessionPhase;
    }
  | {
      id: string;
      type: "respond_step";
      text: string;
      phase: SessionPhase;
      sourceIntent: UserIntent;
    }
  | {
      id: string;
      type: "verify_step";
      check_type: VerificationCheckType;
      retry_policy: "none" | "single_retry";
      previous_instruction: string;
      phase: SessionPhase;
    }
  | {
      id: string;
      type: "reflect_step";
      text: string;
      verify_summary: string | null;
      phase: SessionPhase;
    };

type PlannerConversationNode = Extract<ConversationNode, { type: "instruct_step" | "ask_step" }>;

type PendingUserTurn = {
  messageId: number;
  requestId: string;
  acceptedAtMs: number;
  text: string;
  intent: UserIntent;
  dialogueAct: DialogueRouteAct;
  routeReason: string;
};

type DialogueHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type PendingVerification = {
  stepId: string;
  checkType: VerificationCheckType;
  checkParams: Record<string, unknown>;
  instructionText: string;
  retriesRemaining: number;
  awaitingConfirmation: boolean;
};

type SessionMetricsAccumulator = {
  verificationPasses: number;
  verificationFails: number;
  verificationInconclusive: number;
  refusalCount: number;
  totalTurns: number;
  streakCurrent: number;
  streakMax: number;
  responseLatencyTotalMs: number;
  responseLatencySamples: number;
  startedAtMs: number;
  active: boolean;
};

type PlannerDecision = "emit_text" | "noop" | "await_user" | "advance_step";

type PlannerDebug = {
  stepIndex: number;
  stepId: string;
  decision: PlannerDecision;
  reason: string;
  dialogueAct?: DialogueAct;
  userIntent?: UserIntent | "none";
  turnId?: number;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultUnitLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal?: boolean;
};

type SpeechRecognitionResultLike = {
  results: ArrayLike<SpeechRecognitionResultUnitLike>;
  resultIndex?: number;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const TRACKING_LOST_STOP_MS = 300_000;
const SESSION_CHAT_NOOP_SENTINEL = "__RAVEN_CHAT_NOOP__";
const SESSION_DEBUG_STORAGE_KEY = "raven.session.debug";
const VISION_DEBUG_STORAGE_KEY = "raven.session.vision.debug";
const CONVERSATION_STATE_STORAGE_KEY = "raven.session.conversation-state.current";
const SESSION_RESUME_STORAGE_KEY = "raven.session.resume";
const SESSION_REVIEW_STORAGE_KEY = "raven.session.review";
const MAX_ASSISTANT_WORDS = 180;
const DIALOGUE_HISTORY_MAX_MESSAGES = 14;
const DIALOGUE_HISTORY_PROMPT_MESSAGES = 8;
const DEFAULT_VOICE_AUTO_SEND = true;
const DEFAULT_VOICE_MIN_CHARS = 2;
const STT_MAX_RESTARTS = 6;
const STT_BASE_RESTART_MS = 500;
const STT_DUPLICATE_WINDOW_MS = 10_000;
const DEVICE_OPT_IN_STORAGE_KEY = "raven.device.opt_in";
const SESSION_TEST_HOOK_STORAGE_KEY = "raven.session.testHooks";
const DEVICE_REQUEST_TIMEOUT_MS = 7_000;
const DEFAULT_MEMORY_API_PREFERENCES: MemoryApiPreferences = {
  auto_save: false,
  auto_save_goals: true,
  auto_save_constraints: false,
  auto_save_preferences: false,
  suggestion_snooze_until: null,
};
const DEFAULT_PROFILE_PROGRESS: ProfileProgressRow = {
  total_points: 0,
  current_tier: "bronze",
  free_pass_count: 0,
  streak_days: 0,
  last_task_completed_at: null,
  last_completion_summary: null,
  updated_at: "",
};

const TOPIC_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "about",
  "what",
  "when",
  "where",
  "which",
  "while",
  "they",
  "them",
  "their",
  "just",
  "will",
  "would",
  "could",
  "should",
  "please",
  "next",
  "step",
]);

const EMPTY_DIAGNOSTICS: CameraDiagnostics = {
  modelLoaded: false,
  lastInferenceMs: 0,
  facesDetected: 0,
  videoWidth: 0,
  videoHeight: 0,
  taskModelUrl: "/models/face_landmarker.task",
  wasmBaseUrl: "/vendor/tasks-vision",
  selfTestStatus: "not_run",
  lastError: null,
};

const EMPTY_VISION_SIGNALS_STATUS: VisionSignalsStatus = getVisionSignalsStatus([]);

const EMPTY_DEVICE_STATUS: DeviceConnectionStatus = {
  connected: false,
  scanning: false,
  url: DEFAULT_SETTINGS.intifaceWsUrl,
  last_error: null,
  device_count: 0,
};

function now() {
  return Date.now();
}

function secondsUntil(dueAtIso: string): number {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((dueAtMs - now()) / 1000));
}

function formatDurationSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDeterministicTaskProgress(progress: string): string {
  if (progress === "assigned") {
    return "Assigned";
  }
  if (progress === "secured") {
    return "Secured";
  }
  if (progress === "halfway_checked") {
    return "Halfway checked";
  }
  if (progress === "completed") {
    return "Completed";
  }
  return "Idle";
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function readNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createSessionMetricsAccumulator(nowMs = now()): SessionMetricsAccumulator {
  return {
    verificationPasses: 0,
    verificationFails: 0,
    verificationInconclusive: 0,
    refusalCount: 0,
    totalTurns: 0,
    streakCurrent: 0,
    streakMax: 0,
    responseLatencyTotalMs: 0,
    responseLatencySamples: 0,
    startedAtMs: nowMs,
    active: false,
  };
}

function toSessionRelationshipMetrics(
  metrics: SessionMetricsAccumulator,
): SessionRelationshipMetrics {
  const denominator = metrics.verificationPasses + metrics.verificationFails;
  const passRate = denominator > 0 ? metrics.verificationPasses / denominator : 0;
  const failRate = denominator > 0 ? metrics.verificationFails / denominator : 0;
  return {
    pass_rate: Number(passRate.toFixed(3)),
    fail_rate: Number(failRate.toFixed(3)),
    refusal_count: metrics.refusalCount,
    average_response_latency_ms:
      metrics.responseLatencySamples > 0
        ? Math.round(metrics.responseLatencyTotalMs / metrics.responseLatencySamples)
        : null,
    total_turns: metrics.totalTurns,
    streak_max: metrics.streakMax,
  };
}

function summarizeTonePolicy(policy: TonePolicy, difficultyLevel: DifficultyLevel): string {
  return `style=${policy.response_style} strictness=${policy.strictness} empathy=${policy.empathy} questions=${policy.question_frequency} difficulty=${difficultyLevel}`;
}

function normalizeLearningText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function textHasCue(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function deriveAdaptiveSessionPace(
  basePace: Pace,
  profile: ProfileState,
  progress: Pick<ProfileProgressRow, "current_tier" | "free_pass_count">,
): Pace {
  const preferredPace = normalizeLearningText(profile.preferred_pace);
  const preferredStyle = normalizeLearningText(profile.preferred_style);
  if (textHasCue(preferredPace, [/\b(quick|fast|brisk|short)\b/i])) {
    return "fast";
  }
  if (textHasCue(preferredPace, [/\b(slow|steady|calm|measured)\b/i])) {
    return "slow";
  }
  if (
    textHasCue(preferredStyle, [/\b(strict|hard|intense)\b/i]) &&
    (progress.current_tier === "gold" || progress.current_tier === "platinum")
  ) {
    return "normal";
  }
  if (progress.free_pass_count > 0 && basePace === "fast") {
    return "normal";
  }
  return basePace;
}

function applyLearnedTonePolicy(
  basePolicy: TonePolicy,
  profile: ProfileState,
  progress: Pick<
    ProfileProgressRow,
    "current_tier" | "free_pass_count" | "last_completion_summary"
  >,
): TonePolicy {
  const preferredPace = normalizeLearningText(profile.preferred_pace);
  const preferredStyle = normalizeLearningText(profile.preferred_style);
  const intensity = normalizeLearningText(profile.intensity);
  const lastCompletionSummary = normalizeLearningText(progress.last_completion_summary ?? "");

  const nextPolicy: TonePolicy = {
    ...basePolicy,
    do_bullets: [...basePolicy.do_bullets] as TonePolicy["do_bullets"],
    avoid_bullets: [...basePolicy.avoid_bullets] as TonePolicy["avoid_bullets"],
  };

  if (textHasCue(preferredPace, [/\b(quick|fast|brisk|short)\b/i])) {
    nextPolicy.question_frequency = "low";
    nextPolicy.pacing_line = "Keep brisk pacing with short turns and decisive follow through.";
    nextPolicy.avoid_bullets[1] = "Do not stall with extra questions or repeated setup.";
  } else if (textHasCue(preferredPace, [/\b(slow|steady|calm|measured)\b/i])) {
    nextPolicy.question_frequency = "medium";
    nextPolicy.pacing_line =
      "Keep a slower measured cadence and let each step settle before moving on.";
    nextPolicy.do_bullets[1] = "Use one clear follow up question only when it improves compliance.";
  }

  if (
    textHasCue(intensity, [/\b(high|hard|strict|intense)\b/i]) ||
    textHasCue(preferredStyle, [/\b(strict|firm|commanding|dominant)\b/i]) ||
    progress.current_tier === "gold" ||
    progress.current_tier === "platinum"
  ) {
    nextPolicy.strictness = "high";
    nextPolicy.question_frequency = "low";
    nextPolicy.tone_line = "Sharper and more controlling, with direct follow through.";
  }

  if (progress.free_pass_count > 0) {
    nextPolicy.tone_line = `${nextPolicy.tone_line} The user has one layer of protection banked, so keep the pressure controlled.`;
  }

  if (lastCompletionSummary.includes("winner: user_win")) {
    nextPolicy.do_bullets[0] = "Acknowledge the recent win, then tighten the next instruction.";
  } else if (lastCompletionSummary.includes("winner: raven_win")) {
    nextPolicy.do_bullets[0] = "Press the advantage from the last win and stay in control.";
  }

  return nextPolicy;
}

function normalizeTranscript(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashTranscript(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}

function createRequestId(prefix = "turn"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function isSessionActive(state: SessionState) {
  return (
    state === "running" ||
    state === "waiting_for_check" ||
    state === "waiting_for_user" ||
    state === "paused"
  );
}

function trimToSize(lines: string[], max: number) {
  return lines.slice(-max);
}

function normalizeDialogueContent(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function pushDialogueHistoryMessage(
  history: DialogueHistoryMessage[],
  role: "user" | "assistant",
  content: string,
  maxMessages = DIALOGUE_HISTORY_MAX_MESSAGES,
): DialogueHistoryMessage[] {
  const normalized = normalizeDialogueContent(content);
  if (!normalized) {
    return history;
  }

  const last = history[history.length - 1];
  if (
    last &&
    last.role === role &&
    normalizeDialogueContent(last.content).toLowerCase() === normalized.toLowerCase()
  ) {
    return history;
  }

  return [...history, { role, content: normalized }].slice(-maxMessages);
}

function isShortAcknowledgement(text: string): boolean {
  return /^(ok|okay|yes|no|done|both|sure|sounds good|that works|ready|got it)[.!]?$/i.test(
    text.trim(),
  );
}

function deriveTopicAnchor(
  userText: string,
  intent: UserIntent,
  currentAnchor: string | null,
): string | null {
  const normalized = normalizeDialogueContent(userText);
  if (!normalized) {
    return currentAnchor;
  }
  if (intent === "user_ack" || isShortAcknowledgement(normalized)) {
    return currentAnchor;
  }
  return normalized.slice(0, 180);
}

function stripLeadingSessionPrefix(text: string): string {
  return text.replace(/^(understood|noted|okay|ok)[.!:,]?\s+/i, "").trim();
}

function stabilizeTopicContinuity(
  text: string,
  _topicAnchor: string | null,
  fallback: string,
): string {
  const normalized = stripLeadingSessionPrefix(normalizeDialogueContent(text));
  if (!normalized) {
    return fallback;
  }
  return normalized;
}

function parseHeaderList(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.toLowerCase() !== "none");
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEVICE_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function toFeedFromCamera(event: CameraEvent): FeedItem {
  switch (event.type) {
    case "camera.started":
      return { timestamp: event.timestamp, label: event.type, detail: "camera running" };
    case "camera.stopped":
      return { timestamp: event.timestamp, label: event.type, detail: "camera stopped" };
    case "camera.error":
    case "vision.error":
      return { timestamp: event.timestamp, label: event.type, detail: event.message };
    case "check.started":
    case "check.stopped":
      return { timestamp: event.timestamp, label: event.type, detail: event.checkType };
    case "check.completed":
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `${event.checkType}:${event.status}`,
      };
    case "check.update":
      if (event.result.type === "presence") {
        return {
          timestamp: event.timestamp,
          label: event.type,
          detail: `presence pass=${event.result.passed} brightness=${event.result.brightness.toFixed(1)}`,
        };
      }
      if (event.result.type === "hold_still") {
        return {
          timestamp: event.timestamp,
          label: event.type,
          detail: `hold_still pass=${event.result.passed} yaw=${event.result.yaw?.toFixed(2) ?? "n/a"}`,
        };
      }
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `head_turn pass=${event.result.passed} yaw=${event.result.rawYaw?.toFixed(2) ?? "n/a"}`,
      };
    case "diagnostics.update":
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `faces=${event.diagnostics.facesDetected} infer=${event.diagnostics.lastInferenceMs.toFixed(1)}ms`,
      };
    case "observation.update":
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `${event.observation.scene_summary} | motion=${event.observation.motion_state}`,
      };
  }
}

function toFeedFromEngine(event: StepEngineEvent): FeedItem {
  switch (event.type) {
    case "output":
      return { timestamp: event.timestamp, label: "raven.output", detail: event.text };
    case "state.changed":
      return {
        timestamp: event.timestamp,
        label: "session.state",
        detail: event.message ? `${event.state} (${event.message})` : event.state,
      };
    case "step.started":
      return {
        timestamp: event.timestamp,
        label: "session.step.started",
        detail: `${event.step.id}:${event.step.mode} timeout=${event.remainingSeconds}s`,
      };
    case "step.tick":
      return {
        timestamp: event.timestamp,
        label: "session.step.tick",
        detail: `${event.step.id} remaining=${event.remainingSeconds}s`,
      };
    case "user.input.received":
      return { timestamp: event.timestamp, label: event.type, detail: event.text };
    case "session.completed":
      return { timestamp: event.timestamp, label: event.type, detail: "done" };
    case "session.failed":
      return { timestamp: event.timestamp, label: event.type, detail: event.reason };
    case "session.stopped":
      return { timestamp: event.timestamp, label: event.type, detail: event.reason };
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function plannerStepToNode(
  step: PlannedStep,
  phase: SessionPhase,
  slotKey: SessionMemorySlotKey = "profile_fact",
  topicAnchor: string | null = null,
): PlannerConversationNode {
  const anchorValue =
    topicAnchor && topicAnchor.trim().length > 0 ? topicAnchor.trim() : "the current focus";
  const talkFallback = `Keep the same focus: ${anchorValue}. Continue with one clear step.`;
  const listenFallback = `Keep the same focus: ${anchorValue}. Answer in one short line so we continue.`;

  if (step.mode === "listen") {
    return {
      id: step.id,
      type: "ask_step",
      question: stabilizeTopicContinuity(
        step.question?.trim() || step.say.trim(),
        topicAnchor,
        listenFallback,
      ),
      slotKey,
      timeoutSeconds: step.timeoutSeconds,
      maxRetries: step.maxRetries,
      phase,
    };
  }

  return {
    id: step.id,
    type: "instruct_step",
    text: stabilizeTopicContinuity(step.say.trim(), topicAnchor, talkFallback),
    check_required: step.mode === "check",
    check_type: step.mode === "check" ? (step.checkType ?? "presence") : null,
    check_params: step.mode === "check" ? (step.checkParams ?? {}) : {},
    retry_policy: step.mode === "check" ? "single_retry" : "none",
    timeoutSeconds: step.timeoutSeconds,
    maxRetries: step.maxRetries,
    phase,
  };
}

function nodePromptText(node: ConversationNode): string {
  if (node.type === "ask_step") {
    return node.question;
  }
  if (node.type === "verify_step") {
    return `Verify ${node.check_type}: ${node.previous_instruction}`;
  }
  return node.text;
}

function nodeToSessionStep(node: ConversationNode): SessionStep {
  if (node.type === "ask_step") {
    return {
      id: node.id,
      mode: "listen",
      say: node.question,
      question: node.question,
      timeoutSeconds: node.timeoutSeconds,
      onPassSay: "",
      onFailSay: "",
      maxRetries: node.maxRetries,
    };
  }

  if (node.type === "verify_step") {
    return {
      id: node.id,
      mode: "talk",
      say: "",
      timeoutSeconds: 5,
      onPassSay: "",
      onFailSay: "",
      maxRetries: 0,
    };
  }

  return {
    id: node.id,
    mode: "talk",
    say: node.text,
    timeoutSeconds: 12,
    onPassSay: "",
    onFailSay: "",
    maxRetries: 0,
  };
}

function truncateWords(text: string, maxWords = MAX_ASSISTANT_WORDS): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  const words = normalized.split(" ");
  if (words.length <= maxWords) {
    return normalized;
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function isQuestionText(text: string): boolean {
  return text.includes("?");
}

function withReflectionText(
  text: string,
  nextTurnId: number,
  phase: SessionPhase,
  memory: SessionMemory,
): string {
  const normalized = truncateWords(text);
  if (!normalized) {
    return "";
  }
  if (!shouldEmitReflection(nextTurnId)) {
    return normalized;
  }
  const reflection = buildPhaseReflection(phase, memory);
  return truncateWords(`${normalized} ${reflection}`);
}

function fallbackRespondText(intent: UserIntent, userText: string, memorySummary: string): string {
  const compactMemory = memorySummary.replace(/\s+/g, " ").trim();
  if (intent === "user_question") {
    return buildHumanQuestionFallback(userText, "neutral");
  }
  if (intent === "user_short_follow_up") {
    return buildShortClarificationReply({
      userText,
      interactionMode: "question_answering",
    });
  }
  if (intent === "user_refusal_or_confusion") {
    return "Then point to the unclear part, and I will make it plain.";
  }
  if (intent === "user_answer") {
    return `Good. I will use ${userText.trim()} and keep the thread clean.`;
  }
  if (intent === "user_smalltalk") {
    return "You're here. Speak plainly. What do you want?";
  }
  return compactMemory === "- none"
    ? "Then say it cleanly. I can work with something real."
    : `Good. Current context: ${compactMemory}.`;
}

function inferVerificationCheckType(text: string): VerificationCheckType {
  const normalized = text.toLowerCase();
  if (/\b(left|right|turn your head|head turn)\b/.test(normalized)) {
    return "head_turn";
  }
  if (/\b(hold still|stay still)\b/.test(normalized)) {
    return "hold_still";
  }
  if (/\b(open your mouth|mouth open)\b/.test(normalized)) {
    return "mouth_open";
  }
  if (/\b(smile)\b/.test(normalized)) {
    return "smile_detected";
  }
  if (/\b(move|motion)\b/.test(normalized)) {
    return "motion_state";
  }
  return "presence";
}

function shouldRequireVerification(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(stand|sit|look|face|frame|center|posture|step)\b/.test(normalized);
}

function buildSlotQuestion(slotKey: SessionMemorySlotKey): string {
  if (slotKey === "profile_fact") {
    return "What should I know about you first?";
  }
  if (slotKey === "reply_style") {
    return "Do you want me to keep asking open questions, or stay shorter and more direct?";
  }
  if (slotKey === "constraints") {
    return "What limit or boundary should I keep in mind while we continue?";
  }
  return "What is the main thing you want to improve or get better at right now?";
}

function buildLearningPromptBlock(
  memory: SessionMemory,
  nextAskSlot: SessionMemorySlotKey | null,
): string {
  const missing = listMissingAskSlots(memory);
  const primary = nextAskSlot ?? missing[0] ?? null;
  if (!primary) {
    return [
      "User learning:",
      "Known enough context is already saved.",
      "Ask a follow-up question only if it clearly advances the current topic.",
    ].join("\n");
  }

  const slotLabel =
    primary === "profile_fact"
      ? "user facts and interests"
      : primary === "reply_style"
        ? "temporary reply directive"
        : primary === "constraints"
          ? "limits or boundaries"
          : "improvement area";

  return [
    "User learning:",
    `Missing stable context: ${missing.join(", ")}.`,
    `Highest priority gap: ${slotLabel}.`,
    "If the user did not ask a direct question and the topic is still open, spend your single follow-up question learning that gap.",
    "Prefer concrete questions about the user, their interests, their boundaries, or what would help the current exchange. Do not ask generic filler.",
  ].join("\n");
}

function shouldAskSessionQuestion(input: {
  nextAskSlot: SessionMemorySlotKey | null;
  activeAskSlot: SessionMemorySlotKey | null;
  pendingVerification: boolean;
  userIntent: UserIntent;
  lastAssistantTurnId: number;
  sceneState: SceneState;
}): boolean {
  if (!input.nextAskSlot || input.activeAskSlot || input.pendingVerification) {
    return false;
  }

  if (
    input.sceneState.interaction_mode === "profile_building" ||
    input.nextAskSlot === "profile_fact" ||
    input.nextAskSlot === "reply_style"
  ) {
    return false;
  }

  if (input.userIntent === "user_question" || input.userIntent === "user_refusal_or_confusion") {
    return false;
  }
  if (input.userIntent === "user_short_follow_up") {
    return false;
  }

  if (
    input.sceneState.topic_locked &&
    (input.sceneState.topic_type === "game_execution" ||
      input.sceneState.topic_type === "reward_negotiation" ||
      input.sceneState.topic_type === "reward_window" ||
      input.sceneState.topic_type === "task_execution")
  ) {
    return false;
  }

  if (input.lastAssistantTurnId === 0) {
    return input.userIntent === "user_answer";
  }

  if (input.userIntent === "user_smalltalk" || input.userIntent === "user_ack") {
    return false;
  }

  return input.lastAssistantTurnId % 4 === 0;
}

function deriveCommitment(
  act: DialogueRouteAct,
  responseText: string,
  workingMemory: WorkingMemory,
): { text: string; topicResolved: boolean } {
  if (act === "propose_activity") {
    return {
      text: "resolve the game choice before changing topics",
      topicResolved: false,
    };
  }
  if (act === "answer_activity_choice") {
    return {
      text: "run the chosen game and keep the same activity thread",
      topicResolved: true,
    };
  }
  if (act === "task_request") {
    return {
      text: "the task has been assigned and explained",
      topicResolved: true,
    };
  }
  if (act === "duration_request") {
    return {
      text: "the duration question has been answered directly",
      topicResolved: true,
    };
  }
  if (act === "user_question" || act === "short_follow_up" || act === "confusion") {
    return {
      text: "finish the direct answer, then continue the same topic",
      topicResolved: false,
    };
  }
  const normalized = normalizeDialogueContent(responseText);
  return {
    text: normalized.slice(0, 180) || workingMemory.last_assistant_commitment,
    topicResolved: false,
  };
}

function extractDialogueKeywords(text: string): Set<string> {
  return new Set(
    normalizeDialogueContent(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !TOPIC_STOP_WORDS.has(token)),
  );
}

function hasDialogueKeywordOverlap(userText: string, responseText: string): boolean {
  const userKeywords = extractDialogueKeywords(userText);
  if (userKeywords.size === 0) {
    return false;
  }
  const responseKeywords = extractDialogueKeywords(responseText);
  for (const keyword of userKeywords) {
    if (responseKeywords.has(keyword)) {
      return true;
    }
  }
  return false;
}

function isQuestionResponseAligned(userText: string, responseText: string): boolean {
  const userNormalized = normalizeDialogueContent(userText).toLowerCase();
  const responseNormalized = normalizeDialogueContent(responseText).toLowerCase();
  if (!responseNormalized) {
    return false;
  }

  if (isCoherentRelationalQuestionAnswer(userText, responseText)) {
    return true;
  }

  if (
    /\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/.test(
      userNormalized,
    )
  ) {
    return /\b(prove|control|pressure|sloppy|performative|deliberate|depth|breathing|resets|trained)\b/.test(
      responseNormalized,
    );
  }

  if (
    /\b(do i need proof|what proof|how do i prove it|what counts as proof|do you want proof|do i have to prove it)\b/.test(
      userNormalized,
    )
  ) {
    return /\b(midpoint|final report|minutes?|proof|count|check-?ins?)\b/.test(responseNormalized);
  }

  if (/\b(how deep|what depth|how far|how far in)\b/.test(userNormalized)) {
    return /\b(deep enough|control first|maximum depth|depth for show|breathing|steadiness)\b/.test(
      responseNormalized,
    );
  }

  if (
    /\b(where should i put it|where does it go|where should it go|how should i use it|how would you use it|what would you do with it|what do i do with it|how do i use it|is it oral or anal|can i use it orally|can i use it anally)\b/.test(
      userNormalized,
    )
  ) {
    return /\b(oral use|anal use|grounded options|wear it|wrists|neck|eyes|face|external|pressure in the body|control around how you take it)\b/.test(
      responseNormalized,
    );
  }

  if (
    /\b((should|can|could|would)\s+i\s+(wear|use|keep on|add|combine|pair)|what if i (wear|use|add|combine)|can i keep|can i add|should i add|would it help if i wore)\b/.test(
      userNormalized,
    ) &&
    /\b(with|while|during|along with|on top of|at the same time|doing it|that|instead)\b/.test(
      userNormalized,
    )
  ) {
    return /\b(yes|maybe|keep .* on|main (focus|task|line)|adds? denial|adds? accountability|add .* on the next|layered|same rule|control instead of noise)\b/.test(
      responseNormalized,
    );
  }

  if (/\bhow long\b/.test(userNormalized)) {
    return /\b\d+\s*(hour|hours|minute|minutes)\b/.test(responseNormalized);
  }

  if (/\b(stakes?|bet|wager|if i win|if you win|on the line)\b/.test(userNormalized)) {
    return /\b(stakes?|bet|wager|if i win|if you win|terms?)\b/.test(responseNormalized);
  }

  if (/\b(game|rules?|play|rock paper scissors|rps|number hunt)\b/.test(userNormalized)) {
    return /\b(game|rules?|play|rock paper scissors|rps|number hunt|first throw|first guess|second and final guess)\b/.test(
      responseNormalized,
    );
  }

  if (isMutualGettingToKnowRequest(userText)) {
    return (
      /\b(both ways|what do you want to know|question on me first|give me something real back|tell me something real back)\b/i.test(
        responseNormalized,
      ) || hasDialogueKeywordOverlap(userText, responseText)
    );
  }

  if (isAssistantServiceQuestion(userText)) {
    return questionSatisfiedMeaningfully(userText, responseText);
  }

  if (isAssistantSelfQuestion(userText)) {
    return questionSatisfiedMeaningfully(userText, responseText);
  }

  return (
    hasDialogueKeywordOverlap(userText, responseText) ||
    /\b(i mean|the answer|it means|because|here is|this is|you asked)\b/.test(responseNormalized)
  );
}

function isTaskRequestResponseAligned(text: string): boolean {
  const normalized = normalizeDialogueContent(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/\b(task|challenge|hour|hours|minute|minutes|repeat|check in|report back)\b/.test(normalized)) {
    return true;
  }
  if (
    /\b(oral|anal|prop)\b/.test(normalized) &&
    /\b(tell me whether|which one|be specific|what body area|what role)\b/.test(normalized)
  ) {
    return true;
  }
  return /\b(what items are actually available|what can you actually use|gear or tools|what kind of task do you want|pick the lane|how long should i make it|what time window do you want)\b/.test(
    normalized,
  );
}

function isBareToyTaskRequest(text: string): boolean {
  const normalized = normalizeDialogueContent(text).toLowerCase();
  if (!/\b(toy|device)\b/.test(normalized)) {
    return false;
  }
  if (!/\b(task|assignment|drill|challenge)\b/.test(normalized)) {
    return false;
  }
  return !/\b(cage|chastity|plug|dildo|cuffs|collar|vibrator|vibe|wand|aneros|strap|restraint|blindfold|hood|mask|leash)\b/.test(
    normalized,
  );
}

function isTaskOrGameDialogueAct(act: DialogueRouteAct): boolean {
  return (
    act === "task_request" ||
    act === "duration_request" ||
    act === "propose_activity" ||
    act === "answer_activity_choice"
  );
}

function shouldStabilizeCoreConversationMove(
  move: CoreConversationMove,
  sceneState: SceneState,
  dialogueAct: DialogueRouteAct,
): boolean {
  if (sceneState.task_hard_lock_active || isTaskOrGameDialogueAct(dialogueAct)) {
    return false;
  }
  if (
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
  return isStableCoreConversationMove(move) || move === "concrete_request";
}

function shouldDeterministicallyAnswerOpenQuestion(
  userText: string,
  sceneState: SceneState,
  dialogueAct: DialogueRouteAct,
): boolean {
  if (dialogueAct !== "user_question" || sceneState.task_hard_lock_active) {
    return false;
  }
  if (
    sceneState.interaction_mode === "profile_building" ||
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
  if (isVisualStatusQuestion(userText)) {
    return false;
  }
  if (
    /\b(where should i put it|where does it go|where should it go|how should i use it|how would you use it|what would you do with it|what do i do with it|how do i use it|is it oral or anal|can i use it orally|can i use it anally)\b/i.test(
      userText,
    )
  ) {
    return false;
  }
  const wordCount = normalizeDialogueContent(userText).split(/\s+/).filter(Boolean).length;
  return wordCount <= 12;
}

function isAlignedWithDialogueAct(act: DialogueRouteAct, text: string, userText = ""): boolean {
  const normalized = normalizeDialogueContent(text).toLowerCase();
  const normalizedUserText = normalizeDialogueContent(userText).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (act === "task_request") {
    return isTaskRequestResponseAligned(text);
  }
  if (act === "duration_request") {
    return /\b\d+\s*(hour|hours|minute|minutes)\b/.test(normalized);
  }
  if (act === "answer_activity_choice") {
    if (/\b(stakes?|bet|wager|if i win|if you win|on the line)\b/.test(normalizedUserText)) {
      return /\b(stakes?|bet|wager|if i win|if you win|terms?|set the wager|on the line)\b/.test(
        normalized,
      );
    }
    return /\bi pick\b|\bwe are doing\b|\bgame\b/.test(normalized);
  }
  if (act === "propose_activity") {
    return /\b(game|play|quick|longer|choose|pick)\b/.test(normalized);
  }
  if (act === "user_question") {
    return isQuestionResponseAligned(userText, text);
  }
  if (act === "short_follow_up") {
    if (
      /\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/i.test(
        normalizedUserText,
      )
    ) {
      return /\b(prove|control|pressure|sloppy|performative|deliberate|depth|breathing|resets|trained)\b/i.test(
        normalized,
      );
    }
    if (
      /\b(do i need proof|what proof|how do i prove it|what counts as proof|do you want proof|do i have to prove it)\b/i.test(
        normalizedUserText,
      )
    ) {
      return /\b(midpoint|final report|minutes?|proof|count|check-?ins?)\b/i.test(normalized);
    }
    if (/\b(how deep|what depth|how far|how far in)\b/i.test(normalizedUserText)) {
      return /\b(deep enough|control first|maximum depth|depth for show|breathing|steadiness)\b/i.test(
        normalized,
      );
    }
    if (
      /\b(what else|different one|another one|other angle|something else)\b/i.test(
        normalizedUserText,
      )
    ) {
      return /\b(switch you to|other angle|intervals|hold|protocol|discipline)\b/i.test(
        normalized,
      );
    }
    if (/\b(make it stricter|stricter|harder|more intense|more pressure)\b/i.test(normalizedUserText)) {
      return /\b(stricter|tighter pacing|proof|check-?ins?)\b/i.test(normalized);
    }
    if (/\b(make it softer|softer|gentler|less intense|easier)\b/i.test(normalizedUserText)) {
      return /\b(softer|shorter holds|less pressure|without losing the point)\b/i.test(normalized);
    }
    if (/\b(what do you mean|clarify|how so|why that)\b/i.test(normalizedUserText)) {
      return /\b(i mean|trying to change|training|control|pressure|patience)\b/i.test(normalized);
    }
    if (
      /\b(where should it go|where does it go|how should i use it|oral or anal|which one|which hole)\b/i.test(
        normalizedUserText,
      )
    ) {
      return /\b(oral|anal|grounded options|pressure in the body|control around how you take it)\b/i.test(
        normalized,
      );
    }
    if (
      /\b((should|can|could|would)\s+i\s+(wear|use|keep on|add|combine|pair)|what if i (wear|use|add|combine)|can i keep|can i add|should i add|would it help if i wore)\b/i.test(
        normalizedUserText,
      ) &&
      /\b(with|while|during|along with|on top of|at the same time|doing it|that|instead)\b/i.test(
        normalizedUserText,
      )
    ) {
      return /\b(yes|maybe|keep .* on|main (focus|task|line)|adds? denial|adds? accountability|add .* on the next|layered|same rule|control instead of noise)\b/i.test(
        normalized,
      );
    }
    return /\b(i mean|because|clarif|plain|part|unpacked|expanded|sharpened|current step|current move)\b/i.test(
      normalized,
    );
  }
  if (act === "confusion") {
    return /\b(i mean|to clarify|plainly|simple|this means)\b/.test(normalized);
  }
  if (act === "user_answer") {
    return (
      hasDialogueKeywordOverlap(userText, text) ||
      /\b(noted|i will use that|understood)\b/.test(normalized)
    );
  }
  return true;
}

function summarizeUpdate(event: CameraEvent): string | null {
  if (event.type !== "check.update") {
    return null;
  }

  if (event.result.type === "presence") {
    return `face=${event.result.faceDetected} brightness=${event.result.brightness.toFixed(1)} passCount=${event.result.passCount}/${event.result.requiredPasses}`;
  }
  if (event.result.type === "hold_still") {
    return `yaw=${event.result.yaw?.toFixed(3) ?? "n/a"} baseline=${event.result.baselineYaw?.toFixed(3) ?? "n/a"} delta=${event.result.yawDelta?.toFixed(3) ?? "n/a"}`;
  }
  return `yaw=${event.result.rawYaw?.toFixed(3) ?? "n/a"} baseline=${event.result.baselineYaw?.toFixed(3) ?? "n/a"} leftSeen=${event.result.leftSeen} rightSeen=${event.result.rightSeen}`;
}

export default function SessionPage() {
  const turnGateRef = useRef(createTurnGate());
  const sessionMemoryRef = useRef<SessionMemory>(createSessionMemory());
  const workingMemoryRef = useRef<WorkingMemory>(createWorkingMemory());
  const commitmentRef = useRef<CommitmentState>(createCommitmentState());
  const sceneStateRef = useRef<SceneState>(createSceneState());
  const phaseRef = useRef<SessionPhase>("warmup");
  const complianceScoreRef = useRef(0);
  const lastHandledUserMessageIdRef = useRef(0);
  const pendingUserTurnRef = useRef<PendingUserTurn | null>(null);
  const activeAskSlotRef = useRef<SessionMemorySlotKey | null>(null);
  const cameraPanelRef = useRef<CameraPanelHandle | null>(null);
  const runnerRef = useRef<CheckRunner | null>(null);
  const engineRef = useRef<StepEngine | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const setMicModeRef = useRef<(enabled: boolean) => void>(() => {});
  const sttAvailableRef = useRef(false);
  const micEnabledRef = useRef(false);
  const sttRestartTimerRef = useRef<number | null>(null);
  const sttRestartAttemptsRef = useRef(0);
  const sttManualStopRef = useRef(false);
  const lastSentTranscriptRef = useRef<{ hash: number; ts: number; text: string } | null>(null);
  const awaitingUserRef = useRef(false);
  const verifyingStateRef = useRef<"idle" | "running" | "retrying">("idle");
  const cameraRunningRef = useRef(false);
  const diagnosticsRef = useRef<CameraDiagnostics>(EMPTY_DIAGNOSTICS);
  const latestObservationRef = useRef<VisionObservation | null>(null);
  const visionSignalsStatusRef = useRef<VisionSignalsStatus>(EMPTY_VISION_SIGNALS_STATUS);
  const capabilityCatalogRef = useRef<VerificationCapabilityCatalogEntry[]>([]);
  const recentRavenOutputsRef = useRef<string[]>([]);
  const recentDialogueRef = useRef<DialogueHistoryMessage[]>([]);
  const lastUserResponseRef = useRef<string | null>(null);
  const topicAnchorRef = useRef<string | null>(null);
  const sessionTopicRef = useRef<SessionTopic | null>(null);
  const lastCheckMetricsRef = useRef("No check metrics yet.");
  const lastCheckSummaryRef = useRef("No check completed yet.");
  const recentVerifySummariesRef = useRef<string[]>([]);
  const pendingVerificationRef = useRef<PendingVerification | null>(null);
  const activeAssistantTraceRef = useRef<AssistantTraceMeta | null>(null);
  const inFlightTurnRequestRef = useRef<Map<number, string>>(new Map());
  const inFlightModelRequestRef = useRef<Map<number, string>>(new Map());
  const committedAssistantTurnRef = useRef<Map<number, { requestId: string; normalizedText: string }>>(
    new Map(),
  );
  const visibleAssistantTurnRef = useRef<Map<number, string>>(new Map());
  const lastAssistantReplayRef = useRef<{ anchorUserMessageId: number; normalizedText: string } | null>(
    null,
  );
  const finalizedRequestIdsRef = useRef<Set<string>>(new Set());
  const lastDeviceExecutionSummaryRef = useRef<string | null>(null);
  const clarifiedMessageIdRef = useRef<number | null>(null);
  const awaitingUserSinceRef = useRef<number | null>(null);
  const sessionMetricsRef = useRef<SessionMetricsAccumulator>(createSessionMetricsAccumulator());
  const moodRef = useRef<MoodState>(createInitialMoodState(now()));
  const relationshipRef = useRef<RelationshipState>(createDefaultRelationshipState(now()));
  const difficultyLevelRef = useRef<DifficultyLevel>(2);
  const tonePolicyRef = useRef<TonePolicy>(
    deriveTonePolicy(
      readMoodSnapshot(moodRef.current, now()).mood_label,
      relationshipRef.current.relationship_label,
    ),
  );
  const finalizeSessionTrackingRef = useRef<(reason: string) => Promise<void>>(
    async () => undefined,
  );
  const lastTrackedAtRef = useRef<number | null>(null);
  const lastFaceSeenAtRef = useRef<number | null>(null);
  const trackingEverAcquiredRef = useRef(false);
  const trackingStatusRef = useRef<PlannerTrackingStatus>("lost");
  const deviceOptInRef = useRef(false);
  const sessionTestHooksEnabledRef = useRef(false);
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const dynamicRuntimeRef = useRef<DynamicRuntime>({
    warming: false,
    active: false,
    stepCount: 0,
    plannerAbort: null,
    loopId: 0,
  });
  const lastStepsRef = useRef<PlannedStep[]>([]);
  const profileMemoryRef = useRef<ProfileState>({});
  const pacingRef = useRef<PacingController>(new PacingController(settings.pace));
  const disposedRef = useRef(false);
  const { stopped, loading: stopLoading } = useEmergencyStop();

  const [mode, setMode] = useState<SessionMode>("dynamic");
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [currentStepId, setCurrentStepId] = useState<string>("none");
  const [countdown, setCountdown] = useState<number>(0);
  const [ravenLines, setRavenLines] = useState<string[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [sessionTurnLog, setSessionTurnLog] = useState<SessionTurnDebugEntry[]>([]);
  const [dynamicStepCount, setDynamicStepCount] = useState(0);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("warmup");
  const [sessionMemorySummary, setSessionMemorySummary] = useState("- none");
  const [lastUserIntent, setLastUserIntent] = useState<UserIntent>("user_ack");
  const [lastDialogueAct, setLastDialogueAct] = useState<DialogueAct>("noop");
  const lastDialogueActRef = useRef<DialogueAct>("noop");
  const [moodSnapshot, setMoodSnapshot] = useState<MoodSnapshot>(() =>
    readMoodSnapshot(moodRef.current, now()),
  );
  const [relationshipState, setRelationshipState] = useState<RelationshipState>(
    () => relationshipRef.current,
  );
  const [difficultyLevel, setDifficultyLevel] = useState<DifficultyLevel>(2);
  const [tonePolicyText, setTonePolicyText] = useState<string>(() =>
    summarizeTonePolicy(tonePolicyRef.current, 2),
  );
  const [lastSessionMetrics, setLastSessionMetrics] = useState<SessionRelationshipMetrics | null>(
    null,
  );
  const [savedSessionSnapshot, setSavedSessionSnapshot] = useState<SessionResumeSnapshot | null>(
    null,
  );
  const [sessionReviewSnapshot, setSessionReviewSnapshot] = useState<SessionReviewSnapshot | null>(
    null,
  );
  const [verifyingState, setVerifyingState] = useState<"idle" | "running" | "retrying">("idle");
  const [verifySummary, setVerifySummary] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<PlannerTrackingStatus>("lost");
  const [trackingEverAcquired, setTrackingEverAcquired] = useState(false);
  const [warmingUp, setWarmingUp] = useState(false);
  const [warmupPhase, setWarmupPhase] = useState<WarmupPhase>("waiting_for_inference");
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics>(EMPTY_DIAGNOSTICS);
  const [latestObservation, setLatestObservation] = useState<VisionObservation | null>(null);
  const [visionSignalsStatus, setVisionSignalsStatus] = useState<VisionSignalsStatus>(
    EMPTY_VISION_SIGNALS_STATUS,
  );
  const [capabilityCatalog, setCapabilityCatalog] = useState<VerificationCapabilityCatalogEntry[]>(
    [],
  );
  const [lastPlanValidation, setLastPlanValidation] = useState<PlannerCheckValidationReport | null>(
    null,
  );
  const [lastPlanRaw, setLastPlanRaw] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState("");
  const [lastUserResponse, setLastUserResponse] = useState<string | null>(null);
  const [userReplied, setUserReplied] = useState(false);
  const [awaitingUser, setAwaitingUser] = useState(false);
  const [lastUserMessageId, setLastUserMessageId] = useState(0);
  const [lastEmittedTurnId, setLastEmittedTurnId] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [showTurnLog, setShowTurnLog] = useState(false);
  const [visionDebugMode, setVisionDebugMode] = useState(false);
  const [objectOverlay, setObjectOverlay] = useState(false);
  const [sttAvailable, setSttAvailable] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [sttListening, setSttListening] = useState(false);
  const [sessionInventory, setSessionInventory] = useState<SessionInventoryItem[]>([]);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceOptIn, setDeviceOptIn] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskActive, setTaskActive] = useState<TaskRow[]>([]);
  const [taskHistory, setTaskHistory] = useState<TaskRow[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEvidenceEventRow[]>([]);
  const [taskOccurrences, setTaskOccurrences] = useState<TaskOccurrenceRow[]>([]);
  const [taskReviewQueue, setTaskReviewQueue] = useState<TaskReviewQueueItem[]>([]);
  const deterministicTaskIdRef = useRef<string | null>(null);
  const deterministicTaskStartedAtMsRef = useRef<number | null>(null);
  const [deterministicTaskStartedAtMs, setDeterministicTaskStartedAtMs] = useState<number | null>(
    null,
  );
  const [taskTimerNowMs, setTaskTimerNowMs] = useState(() => now());
  const [taskTodayRows, setTaskTodayRows] = useState<
    Array<{ task_id: string; pending: number; completed: number; missed: number }>
  >([]);
  const [taskProgress, setTaskProgress] = useState<ProfileProgressRow>(DEFAULT_PROFILE_PROGRESS);
  const [taskRewards, setTaskRewards] = useState<string[]>(getTierRewards("bronze"));
  const [lastAdaptiveTaskSummary, setLastAdaptiveTaskSummary] = useState<
    DeterministicTaskPlan["adaptiveSummary"] | null
  >(null);
  const [memoryAutoSave, setMemoryAutoSave] = useState(true);
  const [memoryPendingCount, setMemoryPendingCount] = useState(0);
  const [memoryPreferences, setMemoryPreferences] = useState<MemoryApiPreferences>(
    DEFAULT_MEMORY_API_PREFERENCES,
  );
  const [memoryDebugState, setMemoryDebugState] = useState<MemoryDebugState | null>(null);
  const [memoryDebugError, setMemoryDebugError] = useState<string | null>(null);
  const [immersionDebugState, setImmersionDebugState] = useState<ImmersionDebugState | null>(null);
  const [promptDebugState, setPromptDebugState] = useState<PromptDebugState | null>(null);
  const [conversationDebugState, setConversationDebugState] = useState<ConversationStateSnapshot>(
    createConversationStateSnapshot(),
  );
  const [deviceStatus, setDeviceStatus] = useState<DeviceConnectionStatus>(EMPTY_DEVICE_STATUS);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [lastDeviceExecutionSummary, setLastDeviceExecutionSummary] = useState<string | null>(null);
  const sessionInventoryStorageReadyRef = useRef(false);
  const proactiveInventoryTaskIssuedRef = useRef(false);
  const conversationStateRef = useRef<ConversationStateSnapshot>(createConversationStateSnapshot());

  const consentReady = consent !== null;
  const statusSummary = useMemo(() => `${dynamicStepCount} steps`, [dynamicStepCount]);
  const progressSummaryLines = useMemo(
    () => buildProgressSummaryLines(taskProgress),
    [taskProgress],
  );
  const inventoryAvailableCount = useMemo(
    () => sessionInventory.filter((item) => item.available_this_session).length,
    [sessionInventory],
  );
  const inventoryIntifaceCount = useMemo(
    () =>
      sessionInventory.filter(
        (item) =>
          item.available_this_session &&
          item.intiface_controlled &&
          typeof item.linked_device_id === "string" &&
          item.linked_device_id.length > 0,
      ).length,
    [sessionInventory],
  );
  const inventoryClarificationCount = useMemo(
    () => sessionInventory.filter((item) => needsInventoryClarification(item)).length,
    [sessionInventory],
  );
  const taskReviewBuckets = useMemo(
    () => partitionTaskReviewQueue(taskReviewQueue),
    [taskReviewQueue],
  );
  const taskBoardSummary = useMemo(
    () =>
      buildTaskBoardSummary({
        taskActive,
        taskOccurrences,
        taskReviewBuckets,
        taskTodayRows,
      }),
    [taskActive, taskOccurrences, taskReviewBuckets, taskTodayRows],
  );
  const sessionReviewLines = useMemo(
    () => buildSessionReviewLines(sessionReviewSnapshot),
    [sessionReviewSnapshot],
  );
  const deterministicTaskTimer = getDeterministicTaskTimerSnapshot(
    deterministicTaskStartedAtMs,
    taskTimerNowMs,
    sceneStateRef.current.task_duration_minutes,
    sceneStateRef.current.task_progress,
  );
  const deterministicTaskProgressLabel = formatDeterministicTaskProgress(
    sceneStateRef.current.task_progress,
  );
  const deterministicTaskBoundId = deterministicTaskIdRef.current;
  const deterministicTaskBound = deterministicTaskBoundId
    ? taskActive.find((task) => task.id === deterministicTaskBoundId)
    : null;
  const voiceAutoSend = readBooleanEnv(
    process.env.NEXT_PUBLIC_VOICE_AUTO_SEND ?? process.env.VOICE_AUTO_SEND,
    DEFAULT_VOICE_AUTO_SEND,
  );
  const voiceMinChars = Math.max(
    1,
    Math.floor(
      readNumberEnv(
        process.env.NEXT_PUBLIC_VOICE_MIN_CHARS ?? process.env.VOICE_MIN_CHARS,
        DEFAULT_VOICE_MIN_CHARS,
      ),
    ),
  );

  function currentContractState(): SessionStateContract {
    return {
      turnGate: turnGateRef.current,
      workingMemory: workingMemoryRef.current,
      sessionTopic: sessionTopicRef.current,
    };
  }

  function applyContractState(next: SessionStateContract) {
    turnGateRef.current = next.turnGate;
    workingMemoryRef.current = next.workingMemory;
    sessionTopicRef.current = next.sessionTopic;
    const projected = projectTurnGateUi(next.turnGate);
    setAwaitingUser(projected.awaitingUser);
    setLastUserMessageId(projected.lastUserMessageId);
    setLastEmittedTurnId(projected.lastAssistantTurnId);
  }

  function syncConversationState(next: ConversationStateSnapshot) {
    conversationStateRef.current = next;
    setConversationDebugState(next);
  }

  useEffect(() => {
    lastDialogueActRef.current = lastDialogueAct;
  }, [lastDialogueAct]);

  function syncAdaptivePacing(
    nextProfile = profileMemoryRef.current,
    nextProgress: Pick<ProfileProgressRow, "current_tier" | "free_pass_count"> = {
      current_tier: taskProgress.current_tier,
      free_pass_count: taskProgress.free_pass_count,
    },
  ) {
    pacingRef.current = new PacingController(
      deriveAdaptiveSessionPace(settings.pace, nextProfile, nextProgress),
    );
  }

  function persistSessionResumeSnapshot(
    nextSceneState = sceneStateRef.current,
    nextStartedAtMs = deterministicTaskStartedAtMsRef.current,
  ) {
    if (typeof window === "undefined") {
      return;
    }
    const snapshot: SessionResumeSnapshot = {
      sceneState: nextSceneState,
      deterministicTaskStartedAtMs: nextStartedAtMs,
      savedAt: now(),
    };
    if (!hasResumableSessionSnapshot(snapshot)) {
      window.localStorage.removeItem(SESSION_RESUME_STORAGE_KEY);
      setSavedSessionSnapshot(null);
      return;
    }
    window.localStorage.setItem(SESSION_RESUME_STORAGE_KEY, JSON.stringify(snapshot));
    setSavedSessionSnapshot(snapshot);
  }

  function syncSceneState(nextState: SceneState) {
    sceneStateRef.current = nextState;
    persistSessionResumeSnapshot(nextState, deterministicTaskStartedAtMsRef.current);
  }

  function reconcileSceneWithConversation(nextConversationState: ConversationStateSnapshot) {
    syncSceneState(
      reconcileSceneStateWithConversation(sceneStateRef.current, nextConversationState),
    );
  }

  function syncDeterministicTaskStartedAt(nextStartedAtMs: number | null) {
    deterministicTaskStartedAtMsRef.current = nextStartedAtMs;
    setDeterministicTaskStartedAtMs(nextStartedAtMs);
    persistSessionResumeSnapshot(sceneStateRef.current, nextStartedAtMs);
  }

  function clearSavedSessionRuntime() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_RESUME_STORAGE_KEY);
    }
    setSavedSessionSnapshot(null);
  }

  function resumeSavedSessionRuntime() {
    if (!savedSessionSnapshot) {
      return;
    }
    sceneStateRef.current = savedSessionSnapshot.sceneState;
    deterministicTaskStartedAtMsRef.current = savedSessionSnapshot.deterministicTaskStartedAtMs;
    setDeterministicTaskStartedAtMs(savedSessionSnapshot.deterministicTaskStartedAtMs);
    setMessage("Resumed the last session state.");
    persistSessionResumeSnapshot(
      savedSessionSnapshot.sceneState,
      savedSessionSnapshot.deterministicTaskStartedAtMs,
    );
  }

  useEffect(() => {
    if (deterministicTaskStartedAtMs === null) {
      return;
    }
    setTaskTimerNowMs(now());
    const interval = window.setInterval(() => {
      setTaskTimerNowMs(now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [deterministicTaskStartedAtMs]);

  function syncSessionMemory(nextMemory: SessionMemory, reason?: string) {
    sessionMemoryRef.current = nextMemory;
    setSessionMemorySummary(summarizeSessionMemory(nextMemory));
    if (debugMode && reason) {
      pushFeed({
        timestamp: now(),
        label: "session.memory.write",
        detail: reason,
      });
    }
  }

  function refreshMoodAndPolicy(nowMs = now()) {
    const snapshot = readMoodSnapshot(moodRef.current, nowMs);
    setMoodSnapshot(snapshot);
    const policy = applyLearnedTonePolicy(
      deriveTonePolicy(snapshot.mood_label, relationshipRef.current.relationship_label),
      profileMemoryRef.current,
      {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      },
    );
    tonePolicyRef.current = policy;
    syncAdaptivePacing();
    setTonePolicyText(summarizeTonePolicy(policy, difficultyLevelRef.current));
    return { snapshot, policy };
  }

  function adjustDifficultyOnce(nowMs = now()) {
    const { snapshot, policy } = refreshMoodAndPolicy(nowMs);
    const nextDifficulty = stepDifficultyLevel(
      difficultyLevelRef.current,
      policy.target_difficulty,
    );
    difficultyLevelRef.current = nextDifficulty;
    setDifficultyLevel(nextDifficulty);
    setTonePolicyText(summarizeTonePolicy(policy, nextDifficulty));
    return { snapshot, policy, difficulty: nextDifficulty };
  }

  function applySessionEvent(event: MoodEventType, detail: string) {
    const nowMs = now();
    moodRef.current = applyMoodEvent(moodRef.current, event, nowMs);
    const snapshot = readMoodSnapshot(moodRef.current, nowMs);
    setMoodSnapshot(snapshot);
    const policy = applyLearnedTonePolicy(
      deriveTonePolicy(snapshot.mood_label, relationshipRef.current.relationship_label),
      profileMemoryRef.current,
      {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      },
    );
    tonePolicyRef.current = policy;
    syncAdaptivePacing();
    setTonePolicyText(summarizeTonePolicy(policy, difficultyLevelRef.current));
    pushFeed({
      timestamp: nowMs,
      label: "session.mood.event",
      detail: `${event} delta=${snapshot.last_event_delta} score=${Math.round(
        snapshot.decay_adjusted_score,
      )} ${detail}`,
    });
  }

  function refreshVisionCatalogFromRunner(runner: CheckRunner | null) {
    if (!runner) {
      visionSignalsStatusRef.current = EMPTY_VISION_SIGNALS_STATUS;
      capabilityCatalogRef.current = [];
      setVisionSignalsStatus(EMPTY_VISION_SIGNALS_STATUS);
      setCapabilityCatalog([]);
      return;
    }
    const status = runner.getVisionSignalsStatus();
    const runtimeLabels = latestObservation
      ? [
          ...new Set(
            [
              ...latestObservation.objects.map((item) => item.label.toLowerCase()),
              ...latestObservation.custom_objects.map((item) => item.label.toLowerCase()),
              ...latestObservation.objects_stable.map((item) => item.label.toLowerCase()),
            ].filter((label) => label.length > 0),
          ),
        ]
      : [];
    const catalog = buildCapabilityCatalog(status, { objectLabelOptions: runtimeLabels });
    visionSignalsStatusRef.current = status;
    capabilityCatalogRef.current = catalog;
    setVisionSignalsStatus(status);
    setCapabilityCatalog(catalog);
  }

  function buildStatePromptBlockNow() {
    const nowMs = now();
    const snapshot = readMoodSnapshot(moodRef.current, nowMs);
    const policy = applyLearnedTonePolicy(
      deriveTonePolicy(snapshot.mood_label, relationshipRef.current.relationship_label),
      profileMemoryRef.current,
      {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      },
    );
    tonePolicyRef.current = policy;
    return buildSessionStatePromptBlock({
      mood: snapshot,
      relationship: relationshipRef.current,
      policy,
      difficultyLevel: difficultyLevelRef.current,
    });
  }

  function beginSessionTracking() {
    sessionMetricsRef.current = createSessionMetricsAccumulator(now());
    sessionMetricsRef.current.active = true;
    awaitingUserSinceRef.current = null;
    moodRef.current = resetMoodForNewSession(moodRef.current, now());
    setMoodSnapshot(readMoodSnapshot(moodRef.current, now()));
    setDifficultyLevel(2);
    difficultyLevelRef.current = 2;
    applySessionEvent("session_start", "session initialized");
  }

  async function finalizeSessionTracking(reason: string) {
    const metricsState = sessionMetricsRef.current;
    if (!metricsState.active) {
      return;
    }
    metricsState.active = false;
    applySessionEvent("session_end", reason);
    const metrics = toSessionRelationshipMetrics(metricsState);
    setLastSessionMetrics(metrics);
    const reviewSnapshot: SessionReviewSnapshot = {
      reason,
      metrics,
      savedAt: now(),
    };
    setSessionReviewSnapshot(reviewSnapshot);
    clearSavedSessionRuntime();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_REVIEW_STORAGE_KEY, JSON.stringify(reviewSnapshot));
    }
    const response = await fetch("/api/relationship", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metrics }),
    }).catch(() => null);
    if (!response?.ok) {
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { relationship?: unknown };
    const normalized = normalizeRelationshipState(
      body.relationship as Partial<RelationshipState>,
      now(),
    );
    relationshipRef.current = normalized;
    setRelationshipState(normalized);
    refreshMoodAndPolicy(now());
  }
  finalizeSessionTrackingRef.current = finalizeSessionTracking;

  function applyComplianceSignal(intent: UserIntent) {
    if (intent === "user_answer" || intent === "user_ack") {
      complianceScoreRef.current = Math.min(complianceScoreRef.current + 1, 8);
      return;
    }
    if (intent === "user_refusal_or_confusion") {
      complianceScoreRef.current = Math.max(complianceScoreRef.current - 1, -8);
    }
  }

  function syncSessionPhase(gate: TurnGateState): SessionPhase {
    const nextPhase = deriveSessionPhase(gate.lastAssistantTurnId, complianceScoreRef.current);
    phaseRef.current = nextPhase;
    setSessionPhase(nextPhase);
    return nextPhase;
  }

  function pushFeed(entry: FeedItem) {
    setFeed((current) => [entry, ...current].slice(0, 50));
  }

  function pushTurnTrace(label: string, detail: Record<string, unknown>) {
    pushFeed({
      timestamp: now(),
      label,
      detail: JSON.stringify(detail),
    });
  }

  function updateSessionTurnLog(
    sourceUserMessageId: number,
    updater: (entry: SessionTurnDebugEntry | null) => SessionTurnDebugEntry | null,
  ) {
    if (sourceUserMessageId <= 0) {
      return;
    }
    setSessionTurnLog((current) => {
      const index = current.findIndex((entry) => entry.sourceUserMessageId === sourceUserMessageId);
      const previous = index >= 0 ? current[index] ?? null : null;
      const next = updater(previous);
      if (!next) {
        return current;
      }
      if (index < 0) {
        return [next, ...current].slice(0, 30);
      }
      const updated = [...current];
      updated[index] = next;
      return updated;
    });
  }

  function describeSceneTransition(previous: SceneState, next: SceneState): string | null {
    const fields: string[] = [];
    if (previous.topic_type !== next.topic_type) {
      fields.push(`topic:${previous.topic_type}->${next.topic_type}`);
    }
    if (previous.topic_locked !== next.topic_locked) {
      fields.push(`locked:${String(previous.topic_locked)}->${String(next.topic_locked)}`);
    }
    if (previous.game_template_id !== next.game_template_id) {
      fields.push(`game:${previous.game_template_id}->${next.game_template_id}`);
    }
    if (previous.game_progress !== next.game_progress) {
      fields.push(`game_progress:${previous.game_progress}->${next.game_progress}`);
    }
    if (previous.game_outcome !== next.game_outcome) {
      fields.push(`game_outcome:${previous.game_outcome}->${next.game_outcome}`);
    }
    if (previous.task_template_id !== next.task_template_id) {
      fields.push(`task:${previous.task_template_id}->${next.task_template_id}`);
    }
    if (previous.task_progress !== next.task_progress) {
      fields.push(`task_progress:${previous.task_progress}->${next.task_progress}`);
    }
    if (fields.length === 0) {
      return null;
    }
    return fields.join(" | ");
  }

  function normalizeMemoryApiPreferences(value: unknown): MemoryApiPreferences {
    if (!value || typeof value !== "object") {
      return DEFAULT_MEMORY_API_PREFERENCES;
    }
    const row = value as Partial<MemoryApiPreferences>;
    return {
      auto_save: row.auto_save === true,
      auto_save_goals: row.auto_save_goals !== false,
      auto_save_constraints: row.auto_save_constraints === true,
      auto_save_preferences: row.auto_save_preferences === true,
      suggestion_snooze_until:
        typeof row.suggestion_snooze_until === "string" ? row.suggestion_snooze_until : null,
    };
  }

  async function refreshMemorySummary() {
    const response = await fetch("/api/memory", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      return;
    }
    const body = (await response.json().catch(() => ({}))) as MemoryApiResponse;
    const nextPreferences = normalizeMemoryApiPreferences(body.preferences);
    setMemoryPreferences(nextPreferences);
    setMemoryAutoSave(nextPreferences.auto_save);
    setMemoryPendingCount(Array.isArray(body.suggestions) ? body.suggestions.length : 0);
  }

  async function setMemoryAutoSavePreference(enabled: boolean) {
    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "set_preferences",
        auto_save: enabled,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      return;
    }
    const body = (await response.json().catch(() => ({}))) as MemoryApiResponse;
    const nextPreferences = normalizeMemoryApiPreferences(body.preferences);
    setMemoryPreferences(nextPreferences);
    setMemoryAutoSave(nextPreferences.auto_save);
    setMemoryPendingCount(Array.isArray(body.suggestions) ? body.suggestions.length : 0);
  }

  async function refreshMemoryDebug() {
    const sessionId = turnGateRef.current.sessionId;
    const response = await fetch(`/api/memory/debug?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response) {
      setMemoryDebugError("Failed to load memory debug info.");
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      setMemoryDebugError(
        typeof body?.error === "string" ? body.error : "Failed to load memory debug info.",
      );
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { debug?: unknown };
    const debug = body.debug;
    if (!debug || typeof debug !== "object") {
      setMemoryDebugState(null);
      setMemoryDebugError(null);
      return;
    }
    const parsed = debug as MemoryDebugState;
    setMemoryDebugState(parsed);
    setMemoryDebugError(null);
  }

  async function refreshPromptDebug() {
    const sessionId = turnGateRef.current.sessionId;
    const response = await fetch(`/api/chat/debug?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) {
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { debug?: unknown };
    if (!body.debug || typeof body.debug !== "object") {
      return;
    }
    setPromptDebugState(body.debug as PromptDebugState);
  }

  function applyTasksPayload(payload: TasksApiResponse) {
    const nextProgress =
      payload.progress && typeof payload.progress === "object"
        ? payload.progress
        : DEFAULT_PROFILE_PROGRESS;
    setTaskActive(Array.isArray(payload.active) ? payload.active : []);
    setTaskHistory(Array.isArray(payload.history) ? payload.history : []);
    setTaskEvents(Array.isArray(payload.events) ? payload.events : []);
    setTaskOccurrences(Array.isArray(payload.occurrences) ? payload.occurrences : []);
    setTaskReviewQueue(Array.isArray(payload.review_queue) ? payload.review_queue : []);
    setTaskTodayRows(Array.isArray(payload.today) ? payload.today : []);
    setTaskProgress(nextProgress);
    setTaskRewards(
      Array.isArray(payload.rewards) && payload.rewards.length > 0
        ? payload.rewards
        : getTierRewards(payload.progress?.current_tier ?? DEFAULT_PROFILE_PROGRESS.current_tier),
    );
    syncSceneState({
      ...sceneStateRef.current,
      free_pass_count: nextProgress.free_pass_count,
    });
    syncAdaptivePacing(profileMemoryRef.current, {
      current_tier: nextProgress.current_tier,
      free_pass_count: nextProgress.free_pass_count,
    });
  }

  const refreshTasks = useCallback(async () => {
    const response = await fetch("/api/tasks", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      return null;
    }
    const body = (await response.json().catch(() => ({}))) as TasksApiResponse;
    applyTasksPayload(body);
    return body;
  }, []);

  const runTaskAction = useCallback(
    async (payload: Record<string, unknown>) => {
      setTaskBusy(true);
      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => null);
        if (!response) {
          return null;
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as TasksApiResponse;
          if (body?.error) {
            setMessage(body.error);
          }
          return null;
        }
        const body = (await response.json().catch(() => ({}))) as TasksApiResponse;
        applyTasksPayload(body);
        const nextValidationNotes = Array.isArray(body.validation?.notes)
          ? body.validation.notes.filter((note): note is string => typeof note === "string")
          : [];
        if (debugMode && nextValidationNotes.length > 0) {
          setMessage(`Task validation: ${nextValidationNotes.join(" | ")}`);
        }
        return body;
      } finally {
        setTaskBusy(false);
      }
    },
    [debugMode],
  );

  const submitTaskManualEvidence = useCallback(
    async (
      taskId: string,
      occurrenceId: string,
      summary: string,
      raw?: Record<string, unknown>,
    ) => {
      const result = await runTaskAction({
        action: "submit_manual_evidence",
        taskId,
        occurrenceId,
        summary,
        confidence: 0.55,
        raw: raw ?? {},
      });
      if (!result) {
        return null;
      }
      if (result.reviewSubmitted) {
        setMessage("Manual evidence submitted and queued for review.");
      } else if (result.pointsAwarded && result.pointsAwarded > 0) {
        setMessage(`Task completed. +${result.pointsAwarded} points.`);
      } else {
        setMessage("Manual evidence accepted.");
      }
      if (result.tierUp) {
        setMessage(`Tier up: ${result.progress?.current_tier ?? "updated"}.`);
      }
      return result;
    },
    [runTaskAction],
  );

  useEffect(() => {
    const boundTaskId = deterministicTaskIdRef.current;
    if (!boundTaskId) {
      setLastAdaptiveTaskSummary(null);
      return;
    }
    const stillActive = taskActive.some(
      (task) => task.id === boundTaskId && task.status === "active",
    );
    if (!stillActive) {
      deterministicTaskIdRef.current = null;
      setLastAdaptiveTaskSummary(null);
    }
  }, [taskActive]);

  const ensureDeterministicTaskBound = useCallback(async () => {
    const sessionId = turnGateRef.current.sessionId;
    const boundTaskId = deterministicTaskIdRef.current;
    if (boundTaskId) {
      const boundTask = taskActive.find(
        (task) => task.id === boundTaskId && task.status === "active",
      );
      if (boundTask) {
        return boundTask;
      }
      return null;
    }
    const existingActive = taskActive.find(
      (task) => task.status === "active" && task.session_id === sessionId,
    );
    if (existingActive) {
      deterministicTaskIdRef.current = existingActive.id;
      return existingActive;
    }

    const learnedStrictness = deriveLearnedTaskStrictness(profileMemoryRef.current, {
      current_tier: taskProgress.current_tier,
      free_pass_count: taskProgress.free_pass_count,
      last_completion_summary: taskProgress.last_completion_summary,
    });
    const learnedRewardTemplate = deriveLearnedRewardTemplate(profileMemoryRef.current, {
      current_tier: taskProgress.current_tier,
      free_pass_count: taskProgress.free_pass_count,
      last_completion_summary: taskProgress.last_completion_summary,
    });
    const learnedPenaltyPoints = deriveLearnedPenaltyPoints(profileMemoryRef.current, {
      current_tier: taskProgress.current_tier,
      free_pass_count: taskProgress.free_pass_count,
      last_completion_summary: taskProgress.last_completion_summary,
    });
    const boundPlan = buildDeterministicTaskPlanFromRequest({
      userText: lastUserResponseRef.current ?? "",
      sceneType: sceneStateRef.current.scene_type,
      hasStakes: Boolean(sceneStateRef.current.stakes),
      hasTaskTerms: Boolean(
        sceneStateRef.current.task_reward || sceneStateRef.current.task_consequence,
      ),
      allowSilenceHold: deviceOptInRef.current && deviceStatus.connected,
      profile: profileMemoryRef.current,
      inventory: sessionInventory,
      progress: {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      },
      templateId: sceneStateRef.current.task_template_id,
      variantIndex: sceneStateRef.current.task_variant_index,
      strictnessMode: learnedStrictness,
      rewardTemplateId: learnedRewardTemplate,
      penaltyPoints: learnedPenaltyPoints,
    });

    const created = await runTaskAction({
      action: "create",
      task: boundPlan.createPayload,
      sessionId,
      turnId: String(turnGateRef.current.lastAssistantTurnId + 1),
      createdBy: "raven",
    });
    const createdTask = created?.created ?? null;
    if (createdTask) {
      deterministicTaskIdRef.current = createdTask.id;
      pushFeed({
        timestamp: now(),
        label: "task.create",
        detail: JSON.stringify({
          source: "deterministic_task_binding",
          kind: "final",
          task_id: createdTask.id,
          turn_id: turnGateRef.current.lastAssistantTurnId + 1,
        }),
      });
    }
    return createdTask;
  }, [runTaskAction, taskActive]);

  const prepareDeterministicTaskAssignment = useCallback(
    async (userText: string, options: { leadInLine?: string } = {}) => {
      const progress = {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      };
      const learnedStrictness = deriveLearnedTaskStrictness(profileMemoryRef.current, progress);
      const learnedRewardTemplate = deriveLearnedRewardTemplate(profileMemoryRef.current, progress);
      const learnedPenaltyPoints = deriveLearnedPenaltyPoints(profileMemoryRef.current, progress);
      const shouldReuseCurrentTaskTemplate =
        !sceneStateRef.current.can_replan_task ||
        sceneStateRef.current.user_requested_task_domain === "none" ||
        sceneStateRef.current.user_requested_task_domain ===
          sceneStateRef.current.current_task_domain;
      const plan = buildDeterministicTaskPlanFromRequest({
        userText,
        sceneType: sceneStateRef.current.scene_type,
        hasStakes: Boolean(sceneStateRef.current.stakes),
        hasTaskTerms: Boolean(
          sceneStateRef.current.task_reward || sceneStateRef.current.task_consequence,
        ),
        allowSilenceHold: deviceOptInRef.current && deviceStatus.connected,
        profile: profileMemoryRef.current,
        inventory: sessionInventory,
        progress,
        templateId: shouldReuseCurrentTaskTemplate
          ? sceneStateRef.current.task_template_id
          : undefined,
        variantIndex: sceneStateRef.current.task_variant_index,
        strictnessMode: learnedStrictness,
        rewardTemplateId: learnedRewardTemplate,
        penaltyPoints: learnedPenaltyPoints,
        rewardLine: sceneStateRef.current.task_reward
          ? `Reward: ${sceneStateRef.current.task_reward}.`
          : "",
        consequenceLine: sceneStateRef.current.task_consequence
          ? `Consequence: ${sceneStateRef.current.task_consequence}.`
          : "",
        stakesLine: sceneStateRef.current.stakes
          ? [
              `The stakes are ${sceneStateRef.current.stakes}.`,
              sceneStateRef.current.win_condition
                ? `If you win, ${sceneStateRef.current.win_condition}.`
                : "",
              sceneStateRef.current.lose_condition
                ? `If I win, ${sceneStateRef.current.lose_condition}.`
                : "",
            ]
              .filter((line) => line.length > 0)
              .join(" ")
          : "",
        leadInLine: options.leadInLine,
      });
      syncSceneState({
        ...sceneStateRef.current,
        task_template_id: plan.template.id,
        task_variant_index: plan.variantIndex,
        task_duration_minutes: plan.durationMinutes,
      });
      if (plan.needsInventoryClarification && plan.inventoryClarificationQuestion) {
        setLastAdaptiveTaskSummary(plan.adaptiveSummary);
        return plan.inventoryClarificationQuestion;
      }
      const created = await runTaskAction({
        action: "create",
        task: plan.createPayload,
        sessionId: turnGateRef.current.sessionId,
        turnId: String(turnGateRef.current.lastAssistantTurnId + 1),
        createdBy: "raven",
      });
      if (created?.created?.id) {
        deterministicTaskIdRef.current = created.created.id;
        setLastAdaptiveTaskSummary(plan.adaptiveSummary);
        syncDeterministicTaskStartedAt(null);
        pushFeed({
          timestamp: now(),
          label: "task.create",
          detail: JSON.stringify({
            source: "deterministic_task_assignment",
            kind: "final",
            task_id: created.created.id,
            turn_id: turnGateRef.current.lastAssistantTurnId + 1,
          }),
        });
      } else {
        setLastAdaptiveTaskSummary(null);
        setMessage("Failed to create the task.");
      }
      return plan.assignmentText;
    },
    [runTaskAction, taskProgress],
  );

  const syncDeterministicTaskProgress = useCallback(
    async (previous: SceneState, next: SceneState) => {
      if (next.topic_type !== "task_execution") {
        return false;
      }

      const task = await ensureDeterministicTaskBound();
      if (!task) {
        return true;
      }

      const taskId = deterministicTaskIdRef.current ?? task.id;

      if (previous.task_progress === next.task_progress) {
        return true;
      }

      let pendingOccurrence = findNextPendingOccurrence(taskId, taskOccurrences);
      if (!pendingOccurrence) {
        const refreshed = await refreshTasks();
        const refreshedOccurrences = Array.isArray(refreshed?.occurrences)
          ? refreshed.occurrences
          : [];
        pendingOccurrence = findNextPendingOccurrence(taskId, refreshedOccurrences);
      }

      if (!pendingOccurrence) {
        pushFeed({
          timestamp: now(),
          label: "tasks.sync.pending_missing",
          detail: `task_id=${taskId} progress=${next.task_progress}`,
        });
        setMessage("Task sync is waiting for a pending occurrence. Refreshing tasks.");
        return false;
      }

      const attemptSpec = buildDeterministicTaskAttemptSpec(next.task_progress);
      if (!attemptSpec) {
        return true;
      }
      if (
        (attemptSpec.rawProgress === "secured" || attemptSpec.rawProgress === "halfway_checked") &&
        deterministicTaskStartedAtMsRef.current === null
      ) {
        syncDeterministicTaskStartedAt(now());
      }

      if (attemptSpec.rawProgress === "completed") {
        syncDeterministicTaskStartedAt(null);
      }

      const result = await runTaskAction({
        action: "record_attempt",
        taskId,
        occurrenceId: pendingOccurrence.id,
        status: attemptSpec.status,
        evidenceType: attemptSpec.evidenceType,
        summary: attemptSpec.summary,
        confidence: attemptSpec.confidence,
        raw: { deterministic_progress: attemptSpec.rawProgress },
      });
      if (!result) {
        setMessage(`Task update failed while applying ${attemptSpec.rawProgress}.`);
        return false;
      }
      if (attemptSpec.rawProgress === "completed") {
        if (result.task?.status && result.task.status !== "active") {
          deterministicTaskIdRef.current = null;
          syncDeterministicTaskStartedAt(null);
        }
        if (result.pointsAwarded && result.pointsAwarded > 0) {
          setMessage(`Task completed. +${result.pointsAwarded} points.`);
        } else {
          setMessage(attemptSpec.successMessage);
        }
      } else {
        setMessage(attemptSpec.successMessage);
      }
      return true;
    },
    [ensureDeterministicTaskBound, refreshTasks, runTaskAction, taskOccurrences],
  );

  const syncDeterministicGameResult = useCallback(
    async (previous: SceneState, next: SceneState) => {
      if (
        previous.game_outcome === next.game_outcome ||
        next.game_outcome === "none" ||
        next.game_progress !== "completed"
      ) {
        return false;
      }

      const appliedTerm =
        next.game_outcome === "user_win" ? next.win_condition : next.lose_condition;
      const result = await runTaskAction({
        action: "record_game_result",
        winner: next.game_outcome,
        templateId: next.game_template_id,
        stakesApplied: appliedTerm,
      });
      if (!result) {
        return true;
      }
      if (result.pointsAwarded && result.pointsAwarded > 0) {
        if (next.game_reward_state === "free_pass_granted") {
          setMessage(
            `Game won. +${result.pointsAwarded} points. Free pass banked (${next.free_pass_count}).`,
          );
        } else {
          setMessage(`Game won. +${result.pointsAwarded} points.`);
        }
      } else if (next.game_outcome === "raven_win" && next.game_reward_state === "free_pass_used") {
        setMessage(`Free pass used. Remaining free passes: ${next.free_pass_count}.`);
      } else if (next.game_outcome === "raven_win") {
        setMessage("Raven took the round.");
      }
      if (result.tierUp) {
        setMessage(`Tier up: ${result.progress?.current_tier ?? "updated"}.`);
      }
      return true;
    },
    [runTaskAction],
  );

  async function maybeHandleTaskEvidenceOnUserMessage(text: string) {
    const normalizedText = text.trim().toLowerCase();
    const command = classifyTaskUserCommand(text);
    if (command === "show_tasks") {
      await refreshTasks();
      setMessage('Tasks refreshed. Open "/tasks" for full task management.');
      return;
    }

    if (command === "switch_task_evidence_manual") {
      const task = taskActive.find((item) => item.status === "active");
      if (!task) {
        setMessage("No active task to switch.");
        return;
      }
      const switched = await runTaskAction({
        action: "switch_evidence",
        taskId: task.id,
        evidenceType: "manual",
        confirm: true,
      });
      if (switched?.task) {
        setMessage(`Task evidence switched to manual for "${switched.task.title}".`);
      }
      return;
    }

    if (command !== "done_like") {
      return;
    }

    const task = taskActive.find((item) => item.status === "active");
    if (!task) {
      return;
    }

    const pendingOccurrence = taskOccurrences
      .filter((occurrence) => occurrence.task_id === task.id && occurrence.status === "pending")
      .sort((left, right) => left.occurrence_index - right.occurrence_index)[0];
    if (!pendingOccurrence) {
      return;
    }
    const currentOccurrenceEvents = taskEvents.filter(
      (event) => event.occurrence_id === pendingOccurrence.id,
    );
    const alreadyPassed = currentOccurrenceEvents.some(
      (event) => event.status === "pass" || event.status === "pass_manual",
    );
    if (alreadyPassed) {
      return;
    }

    const evidenceType = task.evidence_policy.type;
    if (evidenceType === "manual" || task.evidence_policy.required === false) {
      await submitTaskManualEvidence(
        task.id,
        pendingOccurrence.id,
        `Manual confirmation accepted for occurrence ${pendingOccurrence.occurrence_index}.`,
        { source: "user_message", text },
      );
      return;
    }

    const observation = latestObservationRef.current;
    const cameraUnavailable = !observation?.camera_available;
    if (cameraUnavailable && evidenceType === "camera") {
      setMessage(
        `Task "${task.title}" requires camera evidence. Use "switch task evidence manual" to change evidence mode.`,
      );
      await runTaskAction({
        action: "record_attempt",
        taskId: task.id,
        occurrenceId: pendingOccurrence.id,
        status: "blocked",
        evidenceType: "camera",
        summary: "Camera unavailable for required camera-only evidence.",
        confidence: 0,
        raw: { camera_available: false, reason: "camera_only_requires_visual_proof" },
      });
      return;
    }

    if (cameraUnavailable && evidenceType === "mixed") {
      if (normalizedText.includes("confirm manual evidence")) {
        await submitTaskManualEvidence(
          task.id,
          pendingOccurrence.id,
          "Manual evidence accepted due to unavailable camera.",
          { fallback: "mixed_manual_confirmation", camera_available: false },
        );
      } else {
        setMessage(
          `Camera is unavailable for "${task.title}". Reply "confirm manual evidence" to count this repeat.`,
        );
      }
      return;
    }

    const evaluated = evaluateTaskCameraEvidence(task, observation);
    const mappedStatus: TaskEvidenceEventStatus =
      evaluated.status === "pass" ? "pass" : evaluated.status === "fail" ? "fail" : "inconclusive";

    if (mappedStatus !== "pass" && task.evidence_policy.deny_user_override) {
      setMessage(
        `Task evidence did not pass yet. ${evaluated.summary} User override is disabled for this task.`,
      );
    }

    const result = await runTaskAction({
      action: "record_attempt",
      taskId: task.id,
      occurrenceId: pendingOccurrence.id,
      status: mappedStatus,
      evidenceType: "camera",
      summary: evaluated.summary,
      confidence: evaluated.confidence,
      raw: { details: evaluated.details },
    });
    if (result?.pointsAwarded && result.pointsAwarded > 0) {
      setMessage(`Task completed. +${result.pointsAwarded} points.`);
    } else if (mappedStatus === "pass") {
      setMessage(
        `Task occurrence verified. Progress ${result?.task?.repeats_completed ?? task.repeats_completed + 1}/${task.repeats_required}.`,
      );
    } else if (mappedStatus === "fail" || mappedStatus === "inconclusive") {
      setMessage(evaluated.summary);
    }
    if (result?.tierUp) {
      setMessage(`Tier up: ${result.progress?.current_tier ?? "updated"}.`);
    }
  }

  function sleepMs(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function logPlannerDebug(details: PlannerDebug) {
    if (!debugMode) {
      return;
    }
    const gate = turnGateRef.current;
    const payload = {
      session_id: gate.sessionId,
      turn_id: details.turnId ?? gate.lastAssistantTurnId,
      step_index: details.stepIndex,
      step_id: details.stepId,
      decision: details.decision,
      dialogue_act: details.dialogueAct ?? "none",
      detected_intent: details.userIntent ?? "none",
      awaiting_user: gate.awaitingUser,
      last_user_message_id: gate.lastUserMessageId,
      last_stored_message_role: gate.lastStoredMessageRole,
      last_assistant_step_id: gate.lastAssistantStepId,
      last_assistant_turn_id: gate.lastAssistantTurnId,
      step_repeat_count: gate.stepRepeatCount[details.stepId] ?? 0,
      reason: details.reason,
    };
    pushFeed({
      timestamp: now(),
      label: "session.plan.debug",
      detail: JSON.stringify(payload),
    });
    console.info("session.plan.debug", payload);
  }

  const refreshDeviceStatus = useCallback(async () => {
    const response = await fetchWithTimeout("/api/devices/status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as DeviceConnectionStatus | null;
    if (!response.ok || !body) {
      throw new Error("Failed to read device status.");
    }
    setDeviceStatus(body);
    return body;
  }, []);

  const refreshDeviceList = useCallback(async () => {
    const response = await fetchWithTimeout("/api/devices/list", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as {
      devices?: DeviceInfo[];
      status?: DeviceConnectionStatus;
    } | null;
    if (!response.ok || !body) {
      throw new Error("Failed to read device list.");
    }
    setDevices(Array.isArray(body.devices) ? body.devices : []);
    if (body.status) {
      setDeviceStatus(body.status);
    }
    return body;
  }, []);

  const refreshDevicesPanel = useCallback(async () => {
    await Promise.all([refreshDeviceStatus(), refreshDeviceList()]);
  }, [refreshDeviceList, refreshDeviceStatus]);

  const connectDevices = useCallback(async () => {
    setDeviceBusy(true);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/devices/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: settings.intifaceWsUrl }),
      });
      const body = (await response.json().catch(() => null)) as {
        devices?: DeviceInfo[];
        last_error?: string | null;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.error ??
            body?.last_error ??
            "Failed to connect to Intiface at ws://localhost:12345.",
        );
      }
      await refreshDevicesPanel();
      pushFeed({
        timestamp: now(),
        label: "devices.connected",
        detail: `connected=${String(true)} devices=${String(body?.devices?.length ?? 0)}`,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Device connect failed.");
    } finally {
      setDeviceBusy(false);
    }
  }, [refreshDevicesPanel, settings.intifaceWsUrl]);

  const disconnectDevices = useCallback(async () => {
    setDeviceBusy(true);
    setMessage(null);
    try {
      await fetchWithTimeout("/api/devices/disconnect", { method: "POST" });
      await refreshDevicesPanel();
      pushFeed({
        timestamp: now(),
        label: "devices.disconnected",
        detail: "disconnected",
      });
    } catch {
      setMessage("Device disconnect failed.");
    } finally {
      setDeviceBusy(false);
    }
  }, [refreshDevicesPanel]);

  const stopAllDevices = useCallback(async () => {
    setDeviceBusy(true);
    try {
      await fetchWithTimeout("/api/devices/stop", { method: "POST" });
      await refreshDevicesPanel();
      pushFeed({
        timestamp: now(),
        label: "devices.stop_all",
        detail: "stop command sent",
      });
    } catch {
      setMessage("Failed to stop all devices.");
    } finally {
      setDeviceBusy(false);
    }
  }, [refreshDevicesPanel]);

  const testDeviceVibrate = useCallback(
    async (deviceId: string) => {
      setDeviceBusy(true);
      setMessage(null);
      try {
        const response = await fetchWithTimeout("/api/devices/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "device_command",
            device_id: deviceId,
            command: "vibrate",
            params: { intensity: 0.3, duration_ms: 1000 },
            opt_in: deviceOptInRef.current,
          }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(body?.error ?? "Test vibrate failed.");
        }
        pushFeed({
          timestamp: now(),
          label: "devices.test",
          detail: `vibrate:${deviceId}:success`,
        });
        const summary = `Executed: vibrate device ${deviceId} intensity 0.3 duration 1000ms status success`;
        setLastDeviceExecutionSummary(summary);
        lastDeviceExecutionSummaryRef.current = summary;
        await refreshDevicesPanel();
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Test vibrate failed.";
        setMessage(messageText);
        pushFeed({
          timestamp: now(),
          label: "devices.test",
          detail: `vibrate:${deviceId}:failed:${messageText}`,
        });
      } finally {
        setDeviceBusy(false);
      }
    },
    [refreshDevicesPanel],
  );

  const appendSystemAssistantNote = useCallback((text: string) => {
    setRavenLines((current) => trimToSize([...current, text], 20));
    publishRuntimeEvent({
      type: "raven.output",
      timestamp: now(),
      source: "session",
      text,
    });
  }, []);

  const dispatchDeviceAction = useCallback(
    async (action: DeviceActionRequest) => {
      if (!deviceOptInRef.current) {
        const summary = "Device execution is disabled because opt-in is off.";
        setLastDeviceExecutionSummary(summary);
        lastDeviceExecutionSummaryRef.current = summary;
        pushFeed({
          timestamp: now(),
          label: "devices.action.blocked",
          detail: JSON.stringify({
            parsed_action: true,
            action,
            gate: { opt_in: false, emergency_stop: stopped, connected: deviceStatus.connected },
            reason: "opt_in_disabled",
          }),
        });
        if (debugMode) {
          console.debug("device.action.blocked", {
            action,
            gate: { opt_in: false, emergency_stop: stopped, connected: deviceStatus.connected },
            reason: "opt_in_disabled",
          });
        }
        appendSystemAssistantNote(summary);
        return;
      }

      if (stopped) {
        const summary = "Device execution is blocked because Emergency Stop is on.";
        setLastDeviceExecutionSummary(summary);
        lastDeviceExecutionSummaryRef.current = summary;
        pushFeed({
          timestamp: now(),
          label: "devices.action.blocked",
          detail: JSON.stringify({
            parsed_action: true,
            action,
            gate: { opt_in: true, emergency_stop: true, connected: deviceStatus.connected },
            reason: "emergency_stop_active",
          }),
        });
        if (debugMode) {
          console.debug("device.action.blocked", {
            action,
            gate: { opt_in: true, emergency_stop: true, connected: deviceStatus.connected },
            reason: "emergency_stop_active",
          });
        }
        appendSystemAssistantNote(summary);
        return;
      }

      if (!deviceStatus.connected) {
        const summary = "Device execution is blocked because Intiface is not connected.";
        setLastDeviceExecutionSummary(summary);
        lastDeviceExecutionSummaryRef.current = summary;
        pushFeed({
          timestamp: now(),
          label: "devices.action.blocked",
          detail: JSON.stringify({
            parsed_action: true,
            action,
            gate: { opt_in: true, emergency_stop: false, connected: false },
            reason: "not_connected",
          }),
        });
        if (debugMode) {
          console.debug("device.action.blocked", {
            action,
            gate: { opt_in: true, emergency_stop: false, connected: false },
            reason: "not_connected",
          });
        }
        appendSystemAssistantNote(summary);
        return;
      }

      let latestDevices = devices;
      try {
        const listResponse = await fetchWithTimeout("/api/devices/list", { cache: "no-store" });
        const listBody = (await listResponse.json().catch(() => null)) as {
          devices?: DeviceInfo[];
        } | null;
        if (listResponse.ok && Array.isArray(listBody?.devices)) {
          latestDevices = listBody.devices;
          setDevices(listBody.devices);
        }
      } catch {
        // Fall back to current cached device list.
      }

      const hasCapabilitySnapshot = latestDevices.length > 0;
      let requestToSend = action;
      if (hasCapabilitySnapshot) {
        const guard = guardDeviceCommandCapabilities(action, latestDevices);
        if (!guard.ok) {
          const summary = `Device execution blocked: ${guard.reason}`;
          setLastDeviceExecutionSummary(summary);
          lastDeviceExecutionSummaryRef.current = summary;
          pushFeed({
            timestamp: now(),
            label: "devices.action.blocked",
            detail: JSON.stringify({
              parsed_action: true,
              action,
              gate: { opt_in: true, emergency_stop: false, connected: true },
              reason: "unsupported_command",
              message: guard.reason,
            }),
          });
          if (debugMode) {
            console.debug("device.action.blocked", {
              action,
              gate: { opt_in: true, emergency_stop: false, connected: true },
              reason: "unsupported_command",
              message: guard.reason,
            });
          }
          appendSystemAssistantNote(summary);
          return;
        }
        requestToSend = guard.request;
      } else {
        pushFeed({
          timestamp: now(),
          label: "devices.action.guard_bypass",
          detail: "device list unavailable; sending command to server for validation",
        });
      }

      const response = await fetchWithTimeout("/api/devices/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...requestToSend,
          opt_in: true,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        device_id?: string;
        command?: string;
      } | null;
      if (!response.ok) {
        const summary = `Executed: ${requestToSend.command} device ${
          requestToSend.device_id ?? "unknown"
        } status failed (${body?.error ?? "device command failed"})`;
        setLastDeviceExecutionSummary(summary);
        lastDeviceExecutionSummaryRef.current = summary;
        pushFeed({
          timestamp: now(),
          label: "devices.action.error",
          detail: JSON.stringify({
            parsed_action: true,
            action,
            gate: { opt_in: true, emergency_stop: false, connected: true },
            result: summary,
          }),
        });
        if (debugMode) {
          console.debug("device.action.error", {
            action,
            gate: { opt_in: true, emergency_stop: false, connected: true },
            result: summary,
          });
        }
        return;
      }

      const summary = `Executed: ${body?.command ?? requestToSend.command} device ${
        body?.device_id ?? requestToSend.device_id ?? "unknown"
      } status success${
        requestToSend.params?.duration_ms
          ? ` duration ${Math.round(Number(requestToSend.params.duration_ms))}ms`
          : ""
      }`;
      setLastDeviceExecutionSummary(summary);
      lastDeviceExecutionSummaryRef.current = summary;
      pushFeed({
        timestamp: now(),
        label: "devices.action.executed",
        detail: JSON.stringify({
          parsed_action: true,
          action,
          gate: { opt_in: true, emergency_stop: false, connected: true },
          result: summary,
        }),
      });
      if (debugMode) {
        console.debug("device.action.executed", {
          action,
          gate: { opt_in: true, emergency_stop: false, connected: true },
          result: summary,
        });
      }
      await refreshDevicesPanel().catch(() => undefined);
    },
    [
      appendSystemAssistantNote,
      debugMode,
      deviceStatus.connected,
      devices,
      refreshDevicesPanel,
      stopped,
    ],
  );

  function appendCommittedAssistantOutput(input: {
    text: string;
    speechText: string;
    displayText: string;
    actionParsed: ReturnType<typeof parseDeviceActionRequest>;
    traceMeta: AssistantTraceMeta | null;
    anchorUserMessageId: number;
    alreadyCommittedNormalizedText?: string | null;
  }): boolean {
    const {
      text,
      speechText,
      displayText,
      actionParsed,
      traceMeta,
      anchorUserMessageId,
      alreadyCommittedNormalizedText,
    } = input;
    if (alreadyCommittedNormalizedText && anchorUserMessageId > 0) {
      markAssistantTurnCommitted(
        committedAssistantTurnRef.current,
        {
          requestId: traceMeta?.requestId?.trim() || `anchored-${anchorUserMessageId}`,
          sourceUserMessageId: anchorUserMessageId,
        },
        alreadyCommittedNormalizedText,
      );
    }
    if (speechText || displayText) {
      lastAssistantReplayRef.current = markAssistantReplay(
        anchorUserMessageId,
        normalizeAssistantCommitText(speechText || displayText),
      );
      if (anchorUserMessageId > 0) {
        visibleAssistantTurnRef.current.set(
          anchorUserMessageId,
          normalizeAssistantCommitText(speechText || displayText),
        );
      }
    }
    if (displayText) {
      setRavenLines((current) => trimToSize([...current, displayText], 20));
      recentRavenOutputsRef.current = trimToSize(
        [...recentRavenOutputsRef.current, speechText || displayText],
        6,
      );
    }
    if (speechText) {
      const nextConversationState = noteConversationAssistantTurn(conversationStateRef.current, {
        text: speechText,
        ravenIntent: lastDialogueActRef.current ?? "respond",
        nowMs: now(),
      });
      syncConversationState(nextConversationState);
      const previousSceneState = sceneStateRef.current;
      const resolvesTopic =
        sessionTopicRef.current?.topic_type === "game_selection" &&
        /(here is the game|we are doing|i pick\b|i will choose\b)/i.test(speechText);
      workingMemoryRef.current = noteWorkingMemoryAssistantTurn(workingMemoryRef.current, {
        commitment: speechText,
        topicResolved: resolvesTopic,
      });
      syncSceneState(
        noteSceneStateAssistantTurn(sceneStateRef.current, {
          text: speechText,
          commitment: speechText,
          topicResolved: resolvesTopic,
        }),
      );
      reconcileSceneWithConversation(nextConversationState);
      const assistantConversationMode = sceneStateRef.current.interaction_mode;
      if (sessionMemoryRef.current.conversation_mode?.value !== assistantConversationMode) {
        syncSessionMemory(
          writeConversationMode(sessionMemoryRef.current, assistantConversationMode, now(), 0.96),
          `assistant commit -> conversation_mode=${assistantConversationMode}`,
        );
      }
      const sceneTransition = describeSceneTransition(previousSceneState, sceneStateRef.current);
      if (sceneTransition) {
        pushFeed({
          timestamp: now(),
          label: "session.scene.raven",
          detail: sceneTransition,
        });
      }
      if (
        previousSceneState.topic_type !== "task_execution" &&
        sceneStateRef.current.topic_type === "task_execution"
      ) {
        void ensureDeterministicTaskBound();
      }
      sessionTopicRef.current = workingMemoryRef.current.session_topic;
      if (resolvesTopic) {
        topicAnchorRef.current = null;
      }
    }
    if (actionParsed.ok) {
      pushFeed({
        timestamp: now(),
        label: "session.action.request",
        detail: JSON.stringify({
          parsed_action: true,
          action: actionParsed.request,
          gate: {
            opt_in: deviceOptInRef.current,
            emergency_stop: stopped,
            connected: deviceStatus.connected,
          },
        }),
      });
      if (debugMode) {
        console.debug("device.action.parsed", actionParsed.request);
      }
      void dispatchDeviceAction(actionParsed.request);
    } else if (debugMode) {
      pushFeed({
        timestamp: now(),
        label: "session.action.parse",
        detail: JSON.stringify({ parsed_action: false, reason: actionParsed.error }),
      });
    }
    if (speechText) {
      recentDialogueRef.current = pushDialogueHistoryMessage(
        recentDialogueRef.current,
        "assistant",
        speechText,
      );
      publishRuntimeEvent({
        type: "raven.output",
        timestamp: now(),
        source: "session",
        text: speechText,
      });
    }
    if (sessionMetricsRef.current.active) {
      sessionMetricsRef.current.totalTurns += 1;
      if (isQuestionText(speechText)) {
        awaitingUserSinceRef.current = now();
      }
    }
    adjustDifficultyOnce(now());
    void refreshTasks().catch(() => undefined);
    if (speechText) {
      speakRavenText(speechText);
    }
    return Boolean(displayText || speechText || text.trim());
  }

  function prepareSessionVisibleOutput(
    text: string,
    traceMeta?: AssistantTraceMeta | null,
  ): {
    actionParsed: ReturnType<typeof parseDeviceActionRequest>;
    speechText: string;
    displayText: string;
    hasRenderableText: boolean;
  } {
    const maybeAction = parseDeviceActionRequest(text);
    const strippedText = stripActionJsonBlock(text);
    const rawSpeechText = strippedText || (maybeAction.ok ? "" : text.trim());
    const scrubbedSpeech = rawSpeechText
      ? sanitizeSessionVisibleAssistantText(rawSpeechText)
      : { text: "", changed: false, blocked: false };
    if (scrubbedSpeech.changed) {
      pushTurnTrace("turn.output.scrubbed", {
        request_id: traceMeta?.requestId ?? "none",
        session_id: traceMeta?.sessionId ?? turnGateRef.current.sessionId,
        user_message_id: traceMeta?.sourceUserMessageId ?? turnGateRef.current.lastUserMessageId,
        final_output_source: traceMeta?.finalOutputSource ?? "unknown",
        blocked: scrubbedSpeech.blocked,
        before_text: rawSpeechText.slice(0, 240),
        after_text: scrubbedSpeech.text.slice(0, 240),
        at_ms: now(),
      });
    }
    const actionDisplayText = maybeAction.ok
      ? formatDeviceActionForDisplay(maybeAction.request)
      : "";
    // Mirror the server route's final internal-leak scrub right before the session client
    // commits user-visible text, so local fallback paths cannot surface runtime labels.
    const speechText = scrubbedSpeech.text;
    const displayText = [speechText, actionDisplayText]
      .filter((item) => item.length > 0)
      .join("\n");
    return {
      actionParsed: maybeAction,
      speechText,
      displayText,
      hasRenderableText: Boolean(displayText || speechText),
    };
  }

  function appendRavenOutput(
    text: string,
    traceMeta?: AssistantTraceMeta | null,
  ): {
    committed: boolean;
    reason: string;
    hasRenderableText: boolean;
    renderedText: string;
  } {
    const effectiveTrace = traceMeta ?? activeAssistantTraceRef.current;
    const renderable = prepareSessionVisibleOutput(text, effectiveTrace);
    const commitText = renderable.speechText || renderable.displayText;
    const anchorUserMessageId =
      effectiveTrace && effectiveTrace.sourceUserMessageId > 0
        ? effectiveTrace.sourceUserMessageId
        : turnGateRef.current.lastUserMessageId;
    const hasRenderableText = renderable.hasRenderableText;
    updateSessionTurnLog(anchorUserMessageId, (entry) =>
      entry
        ? {
            ...entry,
            appendRavenOutputRunsForTurn: entry.appendRavenOutputRunsForTurn + 1,
          }
        : null,
    );
    const visibleDecision = shouldAllowVisibleAssistantCommit({
      sourceUserMessageId: anchorUserMessageId,
      normalizedText: normalizeAssistantCommitText(commitText),
      existingVisibleNormalizedText: visibleAssistantTurnRef.current.get(anchorUserMessageId) ?? null,
    });
    if (commitText && !visibleDecision.allow) {
      pushTurnTrace("turn.append.blocked", {
        request_id: effectiveTrace?.requestId ?? "none",
        session_id: effectiveTrace?.sessionId ?? turnGateRef.current.sessionId,
        user_message_id: anchorUserMessageId,
        step_id: effectiveTrace?.stepId ?? "none",
        reason: visibleDecision.reason,
        source: effectiveTrace?.source ?? "scripted",
        generation_path: effectiveTrace?.generationPath ?? "local",
        committed_text: commitText,
        at_ms: now(),
      });
      return {
        committed: false,
        reason: `visible_blocked:${visibleDecision.reason}`,
        hasRenderableText,
        renderedText: renderable.speechText || renderable.displayText,
      };
    }
    if (commitText) {
      const replayDecision = canCommitAssistantReplay(
        lastAssistantReplayRef.current,
        anchorUserMessageId,
        commitText,
      );
      if (!replayDecision.allow) {
        pushTurnTrace("turn.append.blocked", {
          request_id: effectiveTrace?.requestId ?? "none",
          session_id: effectiveTrace?.sessionId ?? turnGateRef.current.sessionId,
          user_message_id: anchorUserMessageId,
          step_id: effectiveTrace?.stepId ?? "none",
          reason: replayDecision.reason,
          source: effectiveTrace?.source ?? "scripted",
          generation_path: effectiveTrace?.generationPath ?? "local",
          committed_text: commitText,
          at_ms: now(),
        });
        return {
          committed: false,
          reason: `replay_blocked:${replayDecision.reason}`,
          hasRenderableText,
          renderedText: renderable.speechText || renderable.displayText,
        };
      }
    }
    let committedNormalizedText: string | null = null;
    if (commitText && anchorUserMessageId > 0) {
      const commitDecision =
        effectiveTrace && effectiveTrace.sourceUserMessageId > 0
          ? canCommitAssistantTurn(
              committedAssistantTurnRef.current,
              {
                requestId: effectiveTrace.requestId,
                sourceUserMessageId: effectiveTrace.sourceUserMessageId,
              },
              commitText,
            )
          : canCommitAnchoredAssistantTurn(
              committedAssistantTurnRef.current,
              anchorUserMessageId,
              effectiveTrace?.requestId ?? null,
              commitText,
            );
      if (!commitDecision.allow) {
        pushTurnTrace("turn.append.blocked", {
          request_id: effectiveTrace?.requestId ?? "none",
          session_id: effectiveTrace?.sessionId ?? turnGateRef.current.sessionId,
          user_message_id: anchorUserMessageId,
          step_id: effectiveTrace?.stepId ?? "none",
          reason: commitDecision.reason,
          source: effectiveTrace?.source ?? "scripted",
          model_ran: effectiveTrace?.modelRan ?? false,
          deterministic_rail: effectiveTrace?.deterministicRail ?? "none",
          generation_path: effectiveTrace?.generationPath ?? "unknown",
          at_ms: now(),
        });
        return {
          committed: false,
          reason: `commit_blocked:${commitDecision.reason}`,
          hasRenderableText,
          renderedText: renderable.speechText || renderable.displayText,
        };
      }
      committedNormalizedText = commitDecision.normalizedText;
      pushTurnTrace("turn.append.committed", {
        request_id: effectiveTrace?.requestId ?? `anchored-${anchorUserMessageId}`,
        session_id: effectiveTrace?.sessionId ?? turnGateRef.current.sessionId,
        user_message_id: anchorUserMessageId,
        step_id: effectiveTrace?.stepId ?? "none",
        source: effectiveTrace?.source ?? "scripted",
        model_ran: effectiveTrace?.modelRan ?? false,
        deterministic_rail: effectiveTrace?.deterministicRail ?? "none",
        generation_path: effectiveTrace?.generationPath ?? "unknown",
        final_output_source: effectiveTrace?.finalOutputSource ?? "unknown",
        output_generator_count: effectiveTrace?.outputGeneratorCount ?? 1,
        post_processed: effectiveTrace?.postProcessed ?? false,
        turn_id_estimate: effectiveTrace?.turnIdEstimate ?? turnGateRef.current.lastAssistantTurnId + 1,
        server_request_id: effectiveTrace?.serverRequestId ?? "none",
        server_turn_id: effectiveTrace?.serverTurnId ?? "none",
        committed_text: commitText,
        at_ms: now(),
      });
    }
    const committed = appendCommittedAssistantOutput({
        text: renderable.speechText || renderable.displayText,
        speechText: renderable.speechText,
        displayText: renderable.displayText,
        actionParsed: renderable.actionParsed,
        traceMeta: effectiveTrace,
        anchorUserMessageId,
        alreadyCommittedNormalizedText: committedNormalizedText,
      });
    if (committed) {
      updateSessionTurnLog(anchorUserMessageId, (entry) =>
        entry
          ? {
              ...entry,
              ravenOutputText: renderable.displayText || renderable.speechText,
              assistantRenderAppendEvents: entry.assistantRenderAppendEvents + 1,
              visibleAssistantStringsShownForTurn: entry.visibleAssistantStringsShownForTurn + 1,
              conversationMode:
                sessionMemoryRef.current.conversation_mode?.value ??
                sceneStateRef.current.interaction_mode,
            }
          : null,
      );
    }
    return {
      committed,
      reason: "committed",
      hasRenderableText,
      renderedText: renderable.displayText || renderable.speechText,
    };
  }

  function recoverSkippedAssistantRender(
    text: string,
    traceMeta: AssistantTraceMeta | null,
    reason: string,
  ): boolean {
    const renderable = prepareSessionVisibleOutput(text, traceMeta);
    const anchorUserMessageId =
      traceMeta && traceMeta.sourceUserMessageId > 0
        ? traceMeta.sourceUserMessageId
        : turnGateRef.current.lastUserMessageId;
    updateSessionTurnLog(anchorUserMessageId, (entry) =>
      entry
        ? {
            ...entry,
            recoverSkippedAssistantRenderFired: true,
          }
        : null,
    );
    const visibleDecision = shouldAllowVisibleAssistantCommit({
      sourceUserMessageId: anchorUserMessageId,
      normalizedText: normalizeAssistantCommitText(
        renderable.speechText || renderable.displayText,
      ),
      existingVisibleNormalizedText: visibleAssistantTurnRef.current.get(anchorUserMessageId) ?? null,
    });
    if (!visibleDecision.allow) {
      pushTurnTrace("turn.append.recovery_blocked", {
        request_id: traceMeta?.requestId ?? "none",
        session_id: traceMeta?.sessionId ?? turnGateRef.current.sessionId,
        user_message_id: anchorUserMessageId,
        step_id: traceMeta?.stepId ?? "none",
        reason: visibleDecision.reason,
        at_ms: now(),
      });
      return false;
    }
    const normalizedText = normalizeAssistantCommitText(
      renderable.speechText || renderable.displayText,
    );
    pushTurnTrace("turn.append.recovered", {
      request_id: traceMeta?.requestId ?? "none",
      session_id: traceMeta?.sessionId ?? turnGateRef.current.sessionId,
      user_message_id: anchorUserMessageId,
      step_id: traceMeta?.stepId ?? "none",
      reason,
      generation_path: traceMeta?.generationPath ?? "unknown",
      final_output_source: traceMeta?.finalOutputSource ?? "unknown",
      rendered_text: renderable.speechText || renderable.displayText,
      at_ms: now(),
    });
    const recovered = appendCommittedAssistantOutput({
      text: renderable.speechText || renderable.displayText,
      speechText: renderable.speechText,
      displayText: renderable.displayText,
      actionParsed: renderable.actionParsed,
      traceMeta,
      anchorUserMessageId,
      alreadyCommittedNormalizedText: normalizedText || null,
    });
    if (recovered) {
      updateSessionTurnLog(anchorUserMessageId, (entry) =>
        entry
          ? {
              ...entry,
              ravenOutputText: renderable.displayText || renderable.speechText,
              assistantRenderAppendEvents: entry.assistantRenderAppendEvents + 1,
              visibleAssistantStringsShownForTurn: entry.visibleAssistantStringsShownForTurn + 1,
              conversationMode:
                sessionMemoryRef.current.conversation_mode?.value ??
                sceneStateRef.current.interaction_mode,
            }
          : null,
      );
    }
    return recovered;
  }

  function handleEngineEvent(event: StepEngineEvent): boolean {
    pushFeed(toFeedFromEngine(event));

    if (event.type === "state.changed") {
      setSessionState(event.state);
      if (event.message) {
        setMessage(event.message);
      }
      return false;
    }

    if (event.type === "step.started") {
      setCurrentStepId(event.step.id);
      setCountdown(event.remainingSeconds);
      if (event.step.mode === "listen") {
        setUserReplied(false);
      }
      return false;
    }

    if (event.type === "step.tick") {
      setCurrentStepId(event.step.id);
      setCountdown(event.remainingSeconds);
      return false;
    }

    if (event.type === "output") {
      const appendResult = appendRavenOutput(event.text);
      const sourceUserMessageId =
        activeAssistantTraceRef.current?.sourceUserMessageId ?? turnGateRef.current.lastUserMessageId;
      const recovered =
        !appendResult.committed &&
        shouldRecoverSkippedAssistantRender({
        appendCommitted: appendResult.committed,
        appendReason: appendResult.reason,
        hasRenderableText: appendResult.hasRenderableText,
        sourceUserMessageId,
        lastAssistantUserMessageId: turnGateRef.current.lastAssistantUserMessageId,
        visibleAssistantAlreadyCommitted:
          (visibleAssistantTurnRef.current.get(sourceUserMessageId) ?? null) !== null,
      })
          ? recoverSkippedAssistantRender(
              event.text,
              activeAssistantTraceRef.current,
              appendResult.reason,
            )
          : false;
      pushTurnTrace("turn.engine.render.result", {
        request_id: activeAssistantTraceRef.current?.requestId ?? "none",
        session_id: activeAssistantTraceRef.current?.sessionId ?? turnGateRef.current.sessionId,
        user_message_id: sourceUserMessageId,
        committed: appendResult.committed,
        recovered,
        reason: appendResult.reason,
        rendered_text: appendResult.renderedText,
        at_ms: now(),
      });
      if (!appendResult.committed && !recovered) {
        pushTurnTrace("turn.engine.render.skipped", {
          request_id: activeAssistantTraceRef.current?.requestId ?? "none",
          session_id: activeAssistantTraceRef.current?.sessionId ?? turnGateRef.current.sessionId,
          user_message_id: sourceUserMessageId,
          reason: appendResult.reason,
          at_ms: now(),
        });
      }
      return appendResult.committed || recovered;
    }

    if (event.type === "user.input.received") {
      setUserReplied(true);
      if (awaitingUserSinceRef.current !== null && sessionMetricsRef.current.active) {
        const latencyMs = Math.max(0, now() - awaitingUserSinceRef.current);
        sessionMetricsRef.current.responseLatencyTotalMs += latencyMs;
        sessionMetricsRef.current.responseLatencySamples += 1;
        awaitingUserSinceRef.current = null;
      }
      return false;
    }

    if (event.type === "session.completed") {
      void finalizeSessionTracking("completed");
      return false;
    }

    if (event.type === "session.failed") {
      void finalizeSessionTracking(`failed:${event.reason}`);
      return false;
    }

    if (event.type === "session.stopped") {
      void finalizeSessionTracking(`stopped:${event.reason}`);
    }
    return false;
  }

  function disposeEngine() {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
  }

  const stopDynamicSession = useCallback((reason: string) => {
    const runtime = dynamicRuntimeRef.current;
    runtime.warming = false;
    runtime.active = false;
    runtime.plannerAbort?.abort();
    runtime.plannerAbort = null;
    setWarmingUp(false);
    setPlannerBusy(false);
    setAwaitingUser(false);
    setMessage(reason);

    if (engineRef.current && isSessionActive(engineRef.current.getState())) {
      engineRef.current.stop(reason);
    } else {
      setSessionState("stopped");
      pushFeed({ timestamp: now(), label: "session.stopped", detail: reason });
      void finalizeSessionTrackingRef.current(`stopped:${reason}`);
    }
  }, []);

  async function waitForDynamicWarmup(): Promise<boolean> {
    const runtime = dynamicRuntimeRef.current;
    if (process.env.NODE_ENV !== "production" && sessionTestHooksEnabledRef.current) {
      runtime.warming = false;
      setWarmingUp(false);
      setWarmupPhase("ready");
      setMessage("Test hook bypassed camera warmup.");
      pushFeed({
        timestamp: now(),
        label: "session.warmup.ready",
        detail: "Test hook bypassed camera warmup.",
      });
      return true;
    }
    setWarmingUp(true);
    setWarmupPhase("waiting_for_inference");
    setMessage("Warming up camera...");
    pushFeed({
      timestamp: now(),
      label: "session.warmup.started",
      detail: "Checking camera readiness.",
    });

    let lastPhase: WarmupPhase | null = null;
    while (!disposedRef.current && runtime.warming) {
      const evaluation = evaluateWarmup({
        cameraRunning: cameraRunningRef.current,
        modelLoaded: diagnosticsRef.current.modelLoaded,
        lastInferenceMs: diagnosticsRef.current.lastInferenceMs,
        facesDetected: diagnosticsRef.current.facesDetected,
        lastFaceSeenAtMs: lastFaceSeenAtRef.current,
        nowMs: now(),
      });

      setWarmupPhase(evaluation.phase);
      if (evaluation.phase !== lastPhase) {
        lastPhase = evaluation.phase;
        if (evaluation.phase === "waiting_for_inference") {
          pushFeed({
            timestamp: now(),
            label: "session.warmup.waiting_for_inference",
            detail: "Waiting for first vision inference.",
          });
        } else if (evaluation.phase === "waiting_for_face") {
          pushFeed({
            timestamp: now(),
            label: "session.warmup.waiting_for_face",
            detail: "Face not detected recently.",
          });
        }
      }

      if (evaluation.ready) {
        runtime.warming = false;
        setWarmingUp(false);
        setMessage(null);
        setWarmupPhase("ready");
        pushFeed({
          timestamp: now(),
          label: "session.warmup.ready",
          detail: "Camera warmup complete.",
        });
        return true;
      }

      if (evaluation.guidance) {
        setMessage(evaluation.guidance);
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }

    setWarmingUp(false);
    return false;
  }

  async function persistMemoryFromResponse(responseText: string) {
    const extracted = extractStableFactsFromResponse(responseText);
    if (Object.keys(extracted).length === 0) {
      return;
    }
    const current = profileMemoryRef.current;
    const nextSummary = updateMemorySummary(current.memory_summary, extracted);
    const payload = normalizeProfileInput({
      ...extracted,
      ...(nextSummary ? { memory_summary: nextSummary } : {}),
    });

    if (!Object.keys(payload).length) {
      return;
    }

    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!response?.ok) {
      return;
    }

    const body = (await response.json().catch(() => ({}))) as { profile?: unknown };
    const normalized = normalizeProfileInput(body.profile);
    profileMemoryRef.current = normalized;
    syncAdaptivePacing(normalized);
    refreshMoodAndPolicy(now());
  }

  async function acceptUserResponse(raw: string) {
    const text = raw.trim();
    if (!text) {
      return;
    }

    const previousSceneState = sceneStateRef.current;
    const reducedUserTurn = reduceUserTurn(currentContractState(), {
      text,
      nowMs: now(),
    });
    applyContractState(reducedUserTurn.next);
    const intent = reducedUserTurn.intent;
    const routed = reducedUserTurn.route;
    const awaitingBeforePersist = reducedUserTurn.awaitingBeforePersist;
    syncSceneState(
      noteSceneStateUserTurn(sceneStateRef.current, {
        text,
        act: routed.act,
        sessionTopic: routed.nextTopic,
        deviceControlActive: deviceOptInRef.current && deviceStatus.connected,
        inventory: sessionInventory,
        profile: profileMemoryRef.current,
        progress: {
          current_tier: taskProgress.current_tier,
          free_pass_count: taskProgress.free_pass_count,
          last_completion_summary: taskProgress.last_completion_summary,
        },
      }),
    );
    const nextSceneState = sceneStateRef.current;
    const sceneTransition = describeSceneTransition(previousSceneState, nextSceneState);
    if (sceneTransition) {
      pushFeed({
        timestamp: now(),
        label: "session.scene.user",
        detail: sceneTransition,
      });
    }
    recentDialogueRef.current = pushDialogueHistoryMessage(recentDialogueRef.current, "user", text);
    topicAnchorRef.current = deriveTopicAnchor(text, intent, topicAnchorRef.current);
    applyComplianceSignal(intent);
    syncSessionPhase(reducedUserTurn.next.turnGate);
    setLastUserIntent(intent);
    lastUserResponseRef.current = text;
    setLastUserResponse(text);
    setUserReplied(true);
    const requestId = createRequestId("turn");
    lastAssistantReplayRef.current = null;
    committedAssistantTurnRef.current.delete(reducedUserTurn.next.turnGate.lastUserMessageId);
    visibleAssistantTurnRef.current.delete(reducedUserTurn.next.turnGate.lastUserMessageId);
    inFlightTurnRequestRef.current.delete(reducedUserTurn.next.turnGate.lastUserMessageId);
    inFlightModelRequestRef.current.delete(reducedUserTurn.next.turnGate.lastUserMessageId);
    pendingUserTurnRef.current = {
      messageId: reducedUserTurn.next.turnGate.lastUserMessageId,
      requestId,
      acceptedAtMs: now(),
      text,
      intent,
      dialogueAct: routed.act,
      routeReason: routed.reason,
    };
    updateSessionTurnLog(reducedUserTurn.next.turnGate.lastUserMessageId, (entry) => ({
      turnId: entry?.turnId ?? requestId,
      sourceUserMessageId: reducedUserTurn.next.turnGate.lastUserMessageId,
      userText: text,
      ravenOutputText: entry?.ravenOutputText ?? "",
      assistantRenderAppendEvents: entry?.assistantRenderAppendEvents ?? 0,
      recoverSkippedAssistantRenderFired: entry?.recoverSkippedAssistantRenderFired ?? false,
      appendRavenOutputRunsForTurn: entry?.appendRavenOutputRunsForTurn ?? 0,
      visibleAssistantStringsShownForTurn: entry?.visibleAssistantStringsShownForTurn ?? 0,
      createdAt: entry?.createdAt ?? now(),
      conversationMode:
        sessionMemoryRef.current.conversation_mode?.value ??
        sceneStateRef.current.interaction_mode,
    }));
    pushTurnTrace("turn.accepted", {
      request_id: requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: reducedUserTurn.next.turnGate.lastUserMessageId,
      route_act: routed.act,
      user_intent: intent,
      at_ms: now(),
    });
    const nextConversationState = noteConversationUserTurn(conversationStateRef.current, {
      text,
      userIntent: intent,
      routeAct: routed.act,
      nowMs: now(),
    });
    syncConversationState(nextConversationState);
    reconcileSceneWithConversation(nextConversationState);
    if (debugMode) {
      console.debug("dialogue.router", {
        session_id: turnGateRef.current.sessionId,
        act: routed.act,
        reason: routed.reason,
        topic: routed.nextTopic,
      });
    }
    if (sessionMetricsRef.current.active) {
      sessionMetricsRef.current.totalTurns += 1;
      if (awaitingUserSinceRef.current !== null) {
        const latencyMs = Math.max(0, now() - awaitingUserSinceRef.current);
        sessionMetricsRef.current.responseLatencyTotalMs += latencyMs;
        sessionMetricsRef.current.responseLatencySamples += 1;
        awaitingUserSinceRef.current = null;
      }
      if (intent === "user_refusal_or_confusion") {
        sessionMetricsRef.current.refusalCount += 1;
      }
    }
    if (intent === "user_refusal_or_confusion") {
      applySessionEvent("user_refusal", "user refusal or confusion");
    } else if (intent === "user_answer") {
      applySessionEvent("user_answered", "user answered");
    } else if (intent === "user_question" || intent === "user_short_follow_up") {
      applySessionEvent("user_question", "user asked a question");
    } else if (intent === "user_ack") {
      applySessionEvent("user_ack", "user acknowledged");
    }
    pushFeed({ timestamp: now(), label: "user.response", detail: text });
    await syncDeterministicGameResult(previousSceneState, nextSceneState);
    const handledDeterministicTask = await syncDeterministicTaskProgress(
      previousSceneState,
      nextSceneState,
    );
    if (!handledDeterministicTask) {
      await maybeHandleTaskEvidenceOnUserMessage(text);
    }
    const engineState = engineRef.current?.getState();
    engineRef.current?.provideUserInput(text);
    if (engineState === "waiting_for_user") {
      void persistMemoryFromResponse(text);
    }
    const shouldRunStandaloneTurn =
      !dynamicRuntimeRef.current.active &&
      !dynamicRuntimeRef.current.warming &&
      !isSessionActive(sessionState);
    if (sessionTestHooksEnabledRef.current) {
      window.setTimeout(() => {
        void runTestHookPendingTurn();
      }, 0);
    } else if (shouldRunStandaloneTurn) {
      window.setTimeout(() => {
        void runStandalonePendingTurn();
      }, 0);
    }
  }

  async function readStreamedAssistantText(
    response: Response,
    requestId: string,
    sourceUserMessageId: number,
  ): Promise<string> {
    const finalizeGuard = registerStreamFinalize(finalizedRequestIdsRef.current, requestId);
    if (!finalizeGuard.allow) {
      pushTurnTrace("turn.stream.duplicate_finalize_blocked", {
        request_id: requestId,
        session_id: turnGateRef.current.sessionId,
        user_message_id: sourceUserMessageId,
        reason: finalizeGuard.reason,
        at_ms: now(),
      });
      return SESSION_CHAT_NOOP_SENTINEL;
    }
    if (!response.body) {
      pushTurnTrace("turn.model.response_payload", {
        request_id: requestId,
        session_id: turnGateRef.current.sessionId,
        user_message_id: sourceUserMessageId,
        content_type: response.headers.get("content-type") ?? "unknown",
        raw_body: "",
        parsed_text: "",
        parse_status: "missing_body",
        at_ms: now(),
      });
      return "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let rawPayload = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      rawPayload += chunk;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as { response?: unknown };
          if (typeof parsed.response === "string") {
            fullText += parsed.response;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    if (buffer.trim()) {
      rawPayload += buffer;
      try {
        const parsed = JSON.parse(buffer) as { response?: unknown };
        if (typeof parsed.response === "string") {
          fullText += parsed.response;
        }
      } catch {
        // ignore malformed tail chunk
      }
    }

    pushTurnTrace("turn.model.response_payload", {
      request_id: requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: sourceUserMessageId,
      content_type: response.headers.get("content-type") ?? "unknown",
      raw_body: rawPayload.slice(0, 600),
      parsed_text: fullText.trim().slice(0, 400),
      parse_status: fullText.trim() ? "parsed" : "empty_after_parse",
      at_ms: now(),
    });

    return fullText.trim();
  }

  async function generateSessionRespondText(
    userText: string,
    intent: UserIntent,
    dialogueAct: DialogueRouteAct,
    requestId: string,
    sourceUserMessageId: number,
  ): Promise<PreparedConversationNode | null> {
    if (!consent || !settings.ollamaBaseUrl || !settings.ollamaModel) {
      return null;
    }
    const modelRequestGuard = beginTurnRequest(
      inFlightModelRequestRef.current,
      sourceUserMessageId,
      requestId,
    );
    if (!modelRequestGuard.allow) {
      pushTurnTrace("turn.model.blocked", {
        request_id: requestId,
        session_id: turnGateRef.current.sessionId,
        user_message_id: sourceUserMessageId,
        reason: modelRequestGuard.reason,
        at_ms: now(),
      });
      return {
        node: {
          id: `respond-noop-${sourceUserMessageId}`,
          type: "respond_step",
          text: SESSION_CHAT_NOOP_SENTINEL,
          phase: phaseRef.current,
          sourceIntent: intent,
        },
        trace: {
          source: "model",
          modelRan: false,
          deterministicRail: null,
          postProcessed: false,
          generationPath: "blocked",
          serverRequestId: null,
          serverTurnId: null,
          finalOutputSource: "model",
          outputGeneratorCount: 1,
        },
      };
    }

    const phase = phaseRef.current;
    const verifySummary = recentVerifySummariesRef.current.slice(-2).join(" | ") || "none";
    const topicAnchor =
      topicAnchorRef.current ??
      (workingMemoryRef.current.current_topic !== "none"
        ? workingMemoryRef.current.current_topic
        : null) ??
      getSessionMemoryFocus(sessionMemoryRef.current) ??
      sceneStateRef.current.agreed_goal ??
      lastUserResponseRef.current ??
      "none";
    const chatMessages = buildClientChatMessages(
      recentDialogueRef.current,
      userText,
      DIALOGUE_HISTORY_PROMPT_MESSAGES,
    );

    pushTurnTrace("turn.model.request_start", {
      request_id: requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: sourceUserMessageId,
      dialogue_act: dialogueAct,
      user_intent: intent,
      at_ms: now(),
    });
    pushTurnTrace("turn.model.request_payload", {
      request_id: requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: sourceUserMessageId,
      user_text: userText,
      prompt_messages: chatMessages.length,
      awaiting_user: awaitingUser,
      session_phase: phase,
      memory_text: userText,
      working_memory_topic: workingMemoryRef.current.current_topic,
      working_memory_unresolved_question: workingMemoryRef.current.current_unresolved_question,
      working_memory_pending_proposal: workingMemoryRef.current.pending_proposal_kind,
      at_ms: now(),
    });

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        turnId: String(sourceUserMessageId),
        baseUrl: settings.ollamaBaseUrl,
        model: settings.ollamaModel,
        personaPackId: settings.personaPackId,
        toneProfile: settings.toneProfile,
        llmTemperature: settings.llmTemperature,
        llmTopP: settings.llmTopP,
        llmTopK: settings.llmTopK,
        llmRepeatPenalty: settings.llmRepeatPenalty,
        llmStop: settings.llmStopSequences,
        consent,
        sessionMode: true,
        deviceOptIn: deviceOptInRef.current,
        deviceExecutionSummary: lastDeviceExecutionSummaryRef.current,
        inventory: sessionInventory,
        sessionId: turnGateRef.current.sessionId,
        memoryAutoSave,
        memoryText: userText,
        conversationState: conversationStateRef.current,
        workingMemory: workingMemoryRef.current,
        awaitingUser,
        userAnswered: intent === "user_answer",
        verificationJustCompleted:
          verifySummary !== "none" &&
          (verifySummary.toLowerCase().includes("status=pass") ||
            verifySummary.toLowerCase().includes("status=fail") ||
            verifySummary.toLowerCase().includes("status=inconclusive")),
        sessionPhase: phase,
        lastAssistantOutput:
          recentRavenOutputsRef.current[recentRavenOutputsRef.current.length - 1] ?? null,
        moodLabel: readMoodSnapshot(moodRef.current, now()).mood_label,
        relationshipLabel: relationshipRef.current.relationship_label,
        observations: latestObservationRef.current,
        visionSignalsStatus: visionSignalsStatusRef.current,
        verificationSummary: verifySummary,
        messages: chatMessages,
      }),
    }).catch(() => null);

    if (!response?.ok) {
      finishTurnRequest(inFlightModelRequestRef.current, sourceUserMessageId, requestId);
      return null;
    }
    const generationPath = response.headers.get("x-raven-generation-path")?.trim() || "model";
    const modelRan = response.headers.get("x-raven-model-ran") !== "0";
    const deterministicRailHeader = response.headers.get("x-raven-deterministic-rail")?.trim() || null;
    const serverRequestId = response.headers.get("x-raven-request-id")?.trim() || null;
    const serverTurnId = response.headers.get("x-raven-turn-id")?.trim() || null;
    const rawGameStartDetected = response.headers.get("x-raven-game-start-detected") === "1";
    const rawGameStartQuestionPresent =
      response.headers.get("x-raven-game-start-raw-question-present") === "1";
    const finalGameStartQuestionPresent =
      response.headers.get("x-raven-game-start-final-question-present") === "1";
    const promptProfile = response.headers.get("x-raven-prompt-profile")?.trim() || "unknown";
    const promptRoute = response.headers.get("x-raven-prompt-route")?.trim() || "unknown";
    pushTurnTrace("turn.model.response", {
      request_id: requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: sourceUserMessageId,
      generation_path: generationPath,
      model_ran: modelRan,
      deterministic_rail: deterministicRailHeader ?? "none",
      server_request_id: serverRequestId ?? "none",
      server_turn_id: serverTurnId ?? "none",
      game_start_detected: rawGameStartDetected,
      raw_game_start_question_present: rawGameStartQuestionPresent,
      final_game_start_question_present: finalGameStartQuestionPresent,
      prompt_profile: promptProfile,
      prompt_route: promptRoute,
      at_ms: now(),
    });
    const responseDialogueAct = response.headers.get("x-raven-dialogue-act")?.trim() || dialogueAct;
    const responseSessionPhase = response.headers.get("x-raven-session-phase")?.trim() || phase;
    const selectedPlaybooks = parseHeaderList(response.headers.get("x-raven-playbooks"));
    const criticReasons = parseHeaderList(response.headers.get("x-raven-critic-reasons"));
    const shapeReason = response.headers.get("x-raven-shape-reason")?.trim() || "none";
    const noopReason = response.headers.get("x-raven-noop-reason")?.trim() || null;
    const repairTurnDetected = response.headers.get("x-raven-repair-turn") === "1";
    const repairSource = response.headers.get("x-raven-repair-source")?.trim() || "none";
    const repairReferent = response.headers.get("x-raven-repair-referent")?.trim() || "none";
    const repairConfidence = response.headers.get("x-raven-repair-confidence")?.trim() || "none";
    const repairFallbackRestatement =
      response.headers.get("x-raven-repair-fallback-restatement") === "1";
    const immersionDebug: ImmersionDebugState = {
      timestamp: now(),
      dialogueAct: responseDialogueAct,
      sessionPhase: responseSessionPhase,
      selectedPlaybooks,
      criticReasons,
      shapeReason,
      noopReason,
    };
    setImmersionDebugState(immersionDebug);
    if (debugMode && (shapeReason !== "none" || noopReason || criticReasons.length > 0)) {
      pushFeed({
        timestamp: immersionDebug.timestamp,
        label: "immersion.meta",
        detail: [
          `act=${immersionDebug.dialogueAct}`,
          `phase=${immersionDebug.sessionPhase}`,
          `shape=${immersionDebug.shapeReason}`,
          `noop=${immersionDebug.noopReason ?? "none"}`,
          `critic=${immersionDebug.criticReasons.join("|") || "none"}`,
          `playbooks=${immersionDebug.selectedPlaybooks.join("|") || "none"}`,
        ].join(" "),
      });
    }
    if (debugMode && repairTurnDetected) {
      pushFeed({
        timestamp: now(),
        label: "repair.meta",
        detail: [
          `source=${repairSource}`,
          `referent=${repairReferent}`,
          `confidence=${repairConfidence}`,
          `fallback=${repairFallbackRestatement ? "1" : "0"}`,
        ].join(" "),
      });
    }
    const taskCreated = response.headers.get("x-raven-task-created") === "1";
    if (taskCreated) {
      void refreshTasks().catch(() => undefined);
    }
    void refreshMemorySummary().catch(() => undefined);
    if (debugMode) {
      void refreshPromptDebug().catch(() => undefined);
    }
    if (response.headers.get("x-raven-noop") === "1") {
      finishTurnRequest(inFlightModelRequestRef.current, sourceUserMessageId, requestId);
      return {
        node: {
          id: `respond-noop-${sourceUserMessageId}`,
          type: "respond_step",
          text: SESSION_CHAT_NOOP_SENTINEL,
          phase,
          sourceIntent: intent,
        },
        trace: {
          source: generationPath.startsWith("deterministic") ? "deterministic_scene" : "model",
          modelRan,
          deterministicRail: deterministicRailHeader,
          postProcessed: false,
          generationPath,
          serverRequestId,
          serverTurnId,
          finalOutputSource: generationPath.startsWith("deterministic")
            ? "deterministic_scene"
            : "model",
          outputGeneratorCount: 1,
          rawGameStartDetected,
          rawGameStartQuestionPresent,
          finalGameStartQuestionPresent,
        },
      };
    }

    const text = await readStreamedAssistantText(response, requestId, sourceUserMessageId);
    finishTurnRequest(inFlightModelRequestRef.current, sourceUserMessageId, requestId);
    if (text === SESSION_CHAT_NOOP_SENTINEL) {
      return {
        node: {
          id: `respond-noop-${sourceUserMessageId}`,
          type: "respond_step",
          text,
          phase,
          sourceIntent: intent,
        },
        trace: {
          source: generationPath.startsWith("deterministic") ? "deterministic_scene" : "model",
          modelRan,
          deterministicRail: deterministicRailHeader,
          postProcessed: false,
          generationPath,
          serverRequestId,
          serverTurnId,
          finalOutputSource: generationPath.startsWith("deterministic")
            ? "deterministic_scene"
            : "model",
          outputGeneratorCount: 1,
          rawGameStartDetected,
          rawGameStartQuestionPresent,
          finalGameStartQuestionPresent,
        },
      };
    }
    if (!text) {
      pushTurnTrace("turn.model.response_dropped", {
        request_id: requestId,
        session_id: turnGateRef.current.sessionId,
        user_message_id: sourceUserMessageId,
        reason: "empty_text_after_parse",
        generation_path: generationPath,
        at_ms: now(),
      });
      return null;
    }
    const continuityFallback = buildTopicFallback(
      dialogueAct,
      userText,
      workingMemoryRef.current,
      sceneStateRef.current,
    );
    const stabilized = stabilizeTopicContinuity(text, topicAnchor, continuityFallback);
    return {
      node: {
        id: `respond-model-${sourceUserMessageId}`,
        type: "respond_step",
        text: truncateWords(stabilized),
        phase,
        sourceIntent: intent,
      },
      trace: {
        source: generationPath.startsWith("deterministic") ? "deterministic_scene" : "model",
        modelRan,
        deterministicRail: deterministicRailHeader,
        postProcessed: shapeReason !== "none" || criticReasons.length > 0,
        generationPath,
        serverRequestId,
        serverTurnId,
        finalOutputSource: generationPath.startsWith("deterministic")
          ? "deterministic_scene"
          : "model",
        outputGeneratorCount: 1,
        rawGameStartDetected,
        rawGameStartQuestionPresent,
        finalGameStartQuestionPresent,
      },
    };
  }

  async function buildRespondNodeForPendingTurn(
    pendingTurn: PendingUserTurn,
    stepIndex: number,
  ): Promise<PreparedConversationNode | null> {
    const timestamp = now();
    const previousMemory = sessionMemoryRef.current;
    let nextMemory = previousMemory;
    let memoryWritesAttempted: ReturnType<typeof traceWriteUserAnswer>["attempted"] = [];
    let memoryWritesCommitted: ReturnType<typeof traceWriteUserAnswer>["committed"] = [];
    const nextWorkingMemory = workingMemoryRef.current;
    const summaryRequest = isProfileSummaryRequest(pendingTurn.text);
    const chatSwitchRequest = isChatSwitchRequest(pendingTurn.text);
    const continuityTopic =
      workingMemoryRef.current.current_topic !== "none"
        ? workingMemoryRef.current.current_topic
        : conversationStateRef.current.last_conversation_topic !== "none"
          ? conversationStateRef.current.last_conversation_topic
          : conversationStateRef.current.active_thread !== "none"
            ? conversationStateRef.current.active_thread
            : sceneStateRef.current.agreed_goal || null;
    const relationalRouteSelected =
      (isAssistantSelfQuestion(pendingTurn.text) || isMutualGettingToKnowRequest(pendingTurn.text)) &&
      !sceneStateRef.current.task_hard_lock_active;
    const relationalOfferSelected =
      isRelationalOfferStatement(pendingTurn.text) &&
      !sceneStateRef.current.task_hard_lock_active;

    if (
      pendingTurn.intent === "user_question" ||
      pendingTurn.intent === "user_short_follow_up" ||
      pendingTurn.intent === "user_refusal_or_confusion"
    ) {
      const tracedWrite = traceWriteUserQuestion(nextMemory, pendingTurn.text, timestamp, 0.9);
      nextMemory = tracedWrite.memory;
      memoryWritesAttempted = tracedWrite.attempted;
      memoryWritesCommitted = tracedWrite.committed;
    }
    if (pendingTurn.intent === "user_answer") {
      const tracedWrite = traceWriteUserAnswer(
        nextMemory,
        pendingTurn.text,
        timestamp,
        activeAskSlotRef.current,
        0.88,
      );
      nextMemory = tracedWrite.memory;
      memoryWritesAttempted = tracedWrite.attempted;
      memoryWritesCommitted = tracedWrite.committed;
      activeAskSlotRef.current = null;
      void persistMemoryFromResponse(pendingTurn.text);
    }

    syncSessionMemory(nextMemory, `intent=${pendingTurn.intent} text=${pendingTurn.text}`);
    workingMemoryRef.current = nextWorkingMemory;

    const phase = syncSessionPhase(turnGateRef.current);
    const shortFollowUpReply =
      pendingTurn.dialogueAct === "short_follow_up"
        ? buildShortClarificationReply({
            userText: pendingTurn.text,
            interactionMode: sceneStateRef.current.interaction_mode,
            topicType: sceneStateRef.current.topic_type,
            lastQuestion: previousMemory.last_user_question?.value ?? null,
            lastUserText:
              previousMemory.last_user_answer?.value ??
              previousMemory.last_user_question?.value ??
              null,
            lastAssistantText:
              recentRavenOutputsRef.current[recentRavenOutputsRef.current.length - 1] ??
              sceneStateRef.current.last_profile_prompt ??
              null,
            lastUserAnswer: previousMemory.last_user_answer?.value ?? null,
            currentTopic: continuityTopic,
          })
        : null;
    const lastAssistantText =
      recentRavenOutputsRef.current[recentRavenOutputsRef.current.length - 1] ??
      sceneStateRef.current.last_profile_prompt ??
      null;
    const coreConversationMove = classifyCoreConversationMove({
      userText: pendingTurn.text,
      previousAssistantText: lastAssistantText,
      currentTopic:
        continuityTopic,
    });
    const deterministicCoreConversationReply =
      shouldStabilizeCoreConversationMove(
        coreConversationMove,
        sceneStateRef.current,
        pendingTurn.dialogueAct,
      )
        ? buildCoreConversationReply({
            userText: pendingTurn.text,
            previousAssistantText: lastAssistantText,
            currentTopic:
              workingMemoryRef.current.current_topic !== "none"
                ? workingMemoryRef.current.current_topic
                : null,
          })
        : null;
    const deterministicGreetingReply =
      pendingTurn.intent === "user_smalltalk" && !sceneStateRef.current.task_hard_lock_active
        ? buildOpenChatGreeting()
        : null;
    const deterministicRelationalReply =
      (relationalRouteSelected || relationalOfferSelected) && !sceneStateRef.current.task_hard_lock_active
        ? pendingTurn.intent === "user_question"
          ? buildHumanQuestionFallback(pendingTurn.text, "neutral", {
              previousAssistantText: lastAssistantText,
              currentTopic: continuityTopic,
              inventory: sessionInventory,
            })
          : buildRelationalChatReply(
              pendingTurn.text,
              sessionInventory,
              lastAssistantText,
            )
        : null;
    const deterministicQuestionReply =
      deterministicRelationalReply ||
          !shouldDeterministicallyAnswerOpenQuestion(
        pendingTurn.text,
        sceneStateRef.current,
        pendingTurn.dialogueAct,
      )
        ? null
        : buildHumanQuestionFallback(pendingTurn.text, "neutral", {
            previousAssistantText: lastAssistantText,
            currentTopic: continuityTopic,
            inventory: sessionInventory,
          });

    const bareToyTaskClarificationReply =
      pendingTurn.dialogueAct === "task_request" && isBareToyTaskRequest(pendingTurn.text)
        ? "What items are actually available right now so I do not build the wrong task?"
        : null;
    let deterministicTaskReply: string | null = null;
    let deterministicObservationReply: string | null = null;
    if (pendingTurn.dialogueAct === "user_question" && isVisualStatusQuestion(pendingTurn.text)) {
      deterministicObservationReply = buildDeterministicVisualObservationReply(
        pendingTurn.text,
        latestObservationRef.current,
        now(),
      );
    }
    if (
      !summaryRequest &&
      !chatSwitchRequest &&
      sceneStateRef.current.interaction_mode !== "profile_building" &&
      shouldAssignProactiveInventoryTask({
        userText: pendingTurn.text,
        dialogueAct: pendingTurn.dialogueAct,
        topicType: sceneStateRef.current.topic_type,
        topicLocked: sceneStateRef.current.topic_locked,
        inventory: sessionInventory,
        hasActiveTask: taskActive.some(
          (task) => task.status === "active" && task.session_id === turnGateRef.current.sessionId,
        ),
        alreadyPrompted: proactiveInventoryTaskIssuedRef.current,
      })
    ) {
      deterministicTaskReply = await prepareDeterministicTaskAssignment(
        `Assign a concrete task now using one available inventory item. Context: ${pendingTurn.text}`,
      );
      proactiveInventoryTaskIssuedRef.current = true;
    }
    const scaffolded = buildSceneScaffoldReply({
      act: pendingTurn.dialogueAct,
      userText: pendingTurn.text,
      sceneState: sceneStateRef.current,
      deviceControlActive: deviceOptInRef.current && deviceStatus.connected,
      profile: profileMemoryRef.current,
      inventory: sessionInventory,
      taskHistory,
      sessionMemory: nextMemory,
      recentTaskTemplates:
        sceneStateRef.current.task_progress !== "none"
          ? [sceneStateRef.current.task_template_id]
          : [],
      progress: {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      },
    });
    const sceneFallback =
      buildSceneFallback(sceneStateRef.current, pendingTurn.text, nextMemory, sessionInventory) ??
      buildTopicFallback(
        pendingTurn.dialogueAct,
        pendingTurn.text,
        workingMemoryRef.current,
        sceneStateRef.current,
      );
    const conversationArrivalReply =
      pendingTurn.intent === "user_answer" &&
      isConversationArrivalAnswer(pendingTurn.text) &&
      nextMemory.conversation_mode?.value === "normal_chat"
        ? buildChatSwitchReply()
        : null;
    const deterministicCandidate =
      conversationArrivalReply ??
      scaffolded ??
      shortFollowUpReply ??
      deterministicCoreConversationReply ??
      deterministicGreetingReply ??
      deterministicRelationalReply ??
      bareToyTaskClarificationReply ??
      deterministicObservationReply ??
      deterministicTaskReply ??
      deterministicQuestionReply;
    const availableFamilies: TurnResponseFamily[] = [];
    if (conversationArrivalReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (scaffolded) {
      availableFamilies.push("deterministic_scene");
    }
    if (shortFollowUpReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (deterministicCoreConversationReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (deterministicGreetingReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (deterministicRelationalReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (deterministicQuestionReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (bareToyTaskClarificationReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (deterministicObservationReply) {
      availableFamilies.push("deterministic_observation");
    }
    if (deterministicTaskReply) {
      availableFamilies.push("deterministic_task");
    }
    const summaryRouteSelected = summaryRequest && Boolean(scaffolded ?? sceneFallback);
    const chatSwitchRouteSelected =
      chatSwitchRequest &&
      !sceneStateRef.current.task_hard_lock_active &&
      Boolean(scaffolded ?? sceneFallback);
    const shortFollowUpRouteSelected =
      pendingTurn.dialogueAct === "short_follow_up" &&
      Boolean(shortFollowUpReply ?? scaffolded ?? sceneFallback);
    const forceDeterministicConversationReply =
      Boolean(deterministicObservationReply) ||
      Boolean(deterministicTaskReply);
    const preferServerTurnContract = shouldPreferServerTurnContract({
      userText: pendingTurn.text,
      dialogueAct: pendingTurn.dialogueAct,
      hasDeterministicCandidate: Boolean(deterministicCandidate),
      interactionMode: sceneStateRef.current.interaction_mode,
      topicType: sceneStateRef.current.topic_type,
    });
    const bypassModel =
      !preferServerTurnContract &&
      (forceDeterministicConversationReply ||
        shouldBypassModelForSceneTurn({
          sceneState: sceneStateRef.current,
          dialogueAct: pendingTurn.dialogueAct,
          hasDeterministicCandidate: Boolean(deterministicCandidate),
          latestUserText: pendingTurn.text,
        }));
    const generated = bypassModel
      ? null
      : await generateSessionRespondText(
          pendingTurn.text,
          pendingTurn.intent,
          pendingTurn.dialogueAct,
          pendingTurn.requestId,
          pendingTurn.messageId,
        );
    const responseText = bypassModel
      ? (deterministicCandidate ?? sceneFallback)
      : generated?.node.type === "respond_step"
        ? generated.node.text
        : null;
    if (generated?.node.type === "respond_step") {
      availableFamilies.push(mapAssistantReplySourceToTurnResponseFamily(generated.trace.source));
    }
    if (!deterministicCandidate && !generated?.node) {
      availableFamilies.push("scene_fallback");
    }
    if (responseText === SESSION_CHAT_NOOP_SENTINEL) {
      return null;
    }
    if (preferServerTurnContract && generated?.node.type === "respond_step") {
      return {
        node: generated.node,
        trace: {
          ...generated.trace,
          finalOutputSource: generated.trace.finalOutputSource,
          outputGeneratorCount: 1,
        },
      };
    }
    const turnPlan =
      pendingTurn.dialogueAct === "user_question" || pendingTurn.dialogueAct === "short_follow_up"
        ? buildTurnPlan(
            conversationStateRef.current.recent_window.map((entry) => ({
              role: entry.role,
              content: entry.content,
            })),
            {
              conversationState: conversationStateRef.current,
            },
          )
        : null;
    const replyText = responseText ?? sceneFallback;
    const alignedResponseText =
      !bypassModel ||
      (isAlignedWithDialogueAct(pendingTurn.dialogueAct, replyText, pendingTurn.text) &&
        isResponseAlignedWithSceneState(sceneStateRef.current, replyText))
        ? replyText
        : sceneFallback;
    const commitmentAct: DialogueRouteAct =
      sceneStateRef.current.topic_type === "game_execution" &&
      pendingTurn.dialogueAct === "answer_activity_choice"
        ? "acknowledgement"
        : pendingTurn.dialogueAct;
    const commitmentDecision = applyCommitmentDecision({
      current: commitmentRef.current,
      act: commitmentAct,
      candidateText: alignedResponseText,
      userText: pendingTurn.text,
      nowMs: now(),
    });
    const responseGate = applyResponseGate({
      text: commitmentDecision.text,
      userText: pendingTurn.text,
      dialogueAct: pendingTurn.dialogueAct,
      lastAssistantText:
        recentRavenOutputsRef.current[recentRavenOutputsRef.current.length - 1] ?? null,
      toneProfile: settings.toneProfile,
      turnPlan,
      sceneState: sceneStateRef.current,
      commitmentState: commitmentDecision.next.locked
        ? commitmentDecision.next
        : commitmentRef.current,
      sessionMemory: nextMemory,
      inventory: sessionInventory,
      observationTrust: evaluateObservationTrust(latestObservationRef.current, now()),
    });
    const rawGameStartInspection = inspectGameStartContract(
      replyText,
      sceneStateRef.current.game_template_id,
    );
    const gatedGameStartInspection = inspectGameStartContract(
      responseGate.text,
      sceneStateRef.current.game_template_id,
    );
    const dialogueAlignedText = chooseDeliveredAssistantText({
      responseText: responseGate.text,
      sceneFallback,
      responseGateForced: responseGate.forced,
      responseGateReason: responseGate.reason,
      dialogueAct: pendingTurn.dialogueAct,
      userText: pendingTurn.text,
      dialogueAligned: isAlignedWithDialogueAct(
        pendingTurn.dialogueAct,
        responseGate.text,
        pendingTurn.text,
      ),
    });
    const projectedConversationState = noteConversationAssistantTurn(conversationStateRef.current, {
      text: dialogueAlignedText,
      ravenIntent: pendingTurn.dialogueAct,
      nowMs: timestamp,
    });
    const projectedSceneState = reconcileSceneStateWithConversation(
      noteSceneStateAssistantTurn(sceneStateRef.current, {
        text: dialogueAlignedText,
        commitment: dialogueAlignedText,
      }),
      projectedConversationState,
    );
    const projectedConversationMode = projectedSceneState.interaction_mode;
    if (nextMemory.conversation_mode?.value !== projectedConversationMode) {
      nextMemory = writeConversationMode(nextMemory, projectedConversationMode, timestamp, 0.96);
      memoryWritesAttempted = [
        ...memoryWritesAttempted,
        { key: "conversation_mode", value: projectedConversationMode },
      ];
      memoryWritesCommitted = [
        ...memoryWritesCommitted,
        { key: "conversation_mode", value: projectedConversationMode },
      ];
      syncSessionMemory(
        nextMemory,
        `assistant commit -> conversation_mode=${projectedConversationMode}`,
      );
    }
    const nextCommitmentState =
      commitmentDecision.next.locked &&
      isResponseAlignedWithCommitment(commitmentDecision.next, dialogueAlignedText)
        ? createCommitmentState()
        : commitmentDecision.next;
    commitmentRef.current = nextCommitmentState;
    const nextTurnId = turnGateRef.current.lastAssistantTurnId + 1;
    const selectedFamily: TurnResponseFamily = bypassModel
      ? deterministicObservationReply
        ? "deterministic_observation"
        : deterministicTaskReply
          ? "deterministic_task"
          : bareToyTaskClarificationReply
            ? "deterministic_scene"
            : deterministicQuestionReply
              ? "deterministic_scene"
              : deterministicCandidate
                ? "deterministic_scene"
                : "scene_fallback"
      : mapAssistantReplySourceToTurnResponseFamily(generated?.trace.source ?? "model");
    const uniqueAvailableFamilies =
      availableFamilies.length > 0
        ? (Array.from(new Set(availableFamilies)) as TurnResponseFamily[])
        : [selectedFamily];
    const profileQuestionRouteSelected =
      !summaryRouteSelected &&
      !chatSwitchRouteSelected &&
      !shortFollowUpRouteSelected &&
      sceneStateRef.current.interaction_mode === "profile_building" &&
      selectedFamily !== "model" &&
      /\?/.test(alignedResponseText);
    const finalized = finalizeTurnResponse({
      text: dialogueAlignedText,
      userText: pendingTurn.text,
      nextTurnId,
      phase,
      memory: nextMemory,
      interactionMode: projectedSceneState.interaction_mode,
      selectedFamily,
      availableFamilies: uniqueAvailableFamilies,
      responseGateForced: responseGate.forced,
      responseMode: shortFollowUpRouteSelected ? "short_follow_up" : "default",
    });
    const finalGameStartInspection = inspectGameStartContract(
      finalized.text,
      projectedSceneState.game_template_id,
    );
    pushTurnTrace("turn.response.selected", {
      request_id: pendingTurn.requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: pendingTurn.messageId,
      detected_intent: pendingTurn.intent,
      dialogue_act: pendingTurn.dialogueAct,
      active_thread: conversationStateRef.current.active_thread,
      active_topic: conversationStateRef.current.active_topic,
      continuity_context_present:
        conversationStateRef.current.active_thread !== "none" ||
        conversationStateRef.current.last_conversation_topic !== "none",
      conversation_mode: nextMemory.conversation_mode?.value ?? "none",
      interaction_mode: projectedSceneState.interaction_mode,
      topic_type: projectedSceneState.topic_type,
      game_progress: projectedSceneState.game_progress,
      task_progress: projectedSceneState.task_progress,
      memory_writes_attempted: memoryWritesAttempted,
      memory_writes_committed: memoryWritesCommitted,
      fallback_chosen: responseGate.forced,
      fallback_reason: responseGate.reason,
      task_paused: sceneStateRef.current.task_paused,
      lock_active:
        sceneStateRef.current.task_hard_lock_active &&
        sceneStateRef.current.topic_type === "task_execution" &&
        sceneStateRef.current.task_progress !== "completed",
      summary_route_selected: summaryRouteSelected,
      profile_question_route_selected: profileQuestionRouteSelected,
      chat_switch_route_selected: chatSwitchRouteSelected,
      short_follow_up_route_selected: shortFollowUpRouteSelected,
      task_or_persona_path: selectedFamily,
      final_output_source: finalized.finalOutputSource,
      output_generator_families: uniqueAvailableFamilies,
      more_than_one_output_generator_fired: finalized.multipleGeneratorsFired,
      reflection_appended: finalized.reflectionAppended,
      game_start_detected: finalGameStartInspection.detected,
      raw_game_start_detected:
        rawGameStartInspection.detected || Boolean(generated?.trace.rawGameStartDetected),
      raw_game_start_question_present:
        generated?.trace.rawGameStartQuestionPresent ?? rawGameStartInspection.hasPlayablePrompt,
      gated_game_start_question_present: gatedGameStartInspection.hasPlayablePrompt,
      final_game_start_question_present:
        generated?.trace.finalGameStartQuestionPresent ?? finalGameStartInspection.hasPlayablePrompt,
      final_mode_written: nextMemory.conversation_mode?.value ?? "none",
      forbidden_internal_string_blocked: responseGate.reason === "removed_internal_or_identity_leak",
      post_processing_modified_output:
        truncateWords(dialogueAlignedText) !== truncateWords(finalized.text),
      at_ms: now(),
    });
    const text = truncateWords(finalized.text);
    const commitment = deriveCommitment(commitmentAct, text, workingMemoryRef.current);
    workingMemoryRef.current = noteWorkingMemoryAssistantTurn(workingMemoryRef.current, {
      commitment: commitment.text,
      topicResolved: commitment.topicResolved,
    });
    sessionTopicRef.current = workingMemoryRef.current.session_topic;
    if (commitment.topicResolved) {
      topicAnchorRef.current = null;
    }

    return {
      node: {
        id: `respond-${pendingTurn.messageId}-${stepIndex}`,
        type: "respond_step",
        text,
        phase,
        sourceIntent: pendingTurn.intent,
      },
      trace: bypassModel
        ? {
            source: deterministicObservationReply
              ? "deterministic_observation"
              : deterministicTaskReply
                ? "deterministic_task"
                : "deterministic_scene",
            modelRan: false,
            deterministicRail: deterministicObservationReply
              ? "visual_observation"
              : deterministicTaskReply
                ? "task_assignment"
                : deterministicQuestionReply
                  ? "open_question_fallback"
                : scaffolded
                  ? "scene_scaffold"
                  : "scene_fallback",
            postProcessed: false,
            generationPath: deterministicObservationReply
              ? "deterministic-observation"
              : deterministicTaskReply
                ? "deterministic-task"
                : deterministicQuestionReply
                  ? "deterministic-open-question"
                : "deterministic-scene",
            serverRequestId: null,
            serverTurnId: null,
            finalOutputSource: finalized.finalOutputSource,
            outputGeneratorCount: availableFamilies.length > 0 ? availableFamilies.length : 1,
          }
        : (generated?.trace ?? {
            source: "model",
            modelRan: true,
            deterministicRail: null,
            postProcessed: false,
            generationPath: "model",
            serverRequestId: null,
            serverTurnId: null,
            finalOutputSource: finalized.finalOutputSource,
            outputGeneratorCount: availableFamilies.length > 0 ? availableFamilies.length : 1,
          }),
    };
  }

  function buildIdleRecoveryReply(pendingTurn: PendingUserTurn): {
    text: string | null;
    source: TurnResponseFamily;
    deterministicRail: string;
  } {
    const lastAssistantText =
      recentRavenOutputsRef.current[recentRavenOutputsRef.current.length - 1] ??
      sceneStateRef.current.last_profile_prompt ??
      null;
    const currentTopic =
      workingMemoryRef.current.current_topic !== "none"
        ? workingMemoryRef.current.current_topic
        : sceneStateRef.current.agreed_goal || null;
    const relationalRouteSelected =
      (isAssistantSelfQuestion(pendingTurn.text) || isMutualGettingToKnowRequest(pendingTurn.text)) &&
      !sceneStateRef.current.task_hard_lock_active;
    const relationalOfferSelected =
      isRelationalOfferStatement(pendingTurn.text) &&
      !sceneStateRef.current.task_hard_lock_active;

    if (relationalRouteSelected || relationalOfferSelected) {
      return {
        text:
          pendingTurn.intent === "user_question"
            ? buildHumanQuestionFallback(pendingTurn.text, "neutral", {
                previousAssistantText: lastAssistantText,
                currentTopic,
                inventory: sessionInventory,
              })
            : buildRelationalChatReply(
                pendingTurn.text,
                sessionInventory,
                lastAssistantText,
              ),
        source: "deterministic_scene",
        deterministicRail: "idle_relational_recovery",
      };
    }

    const scaffolded = buildSceneScaffoldReply({
      act: pendingTurn.dialogueAct,
      userText: pendingTurn.text,
      sceneState: sceneStateRef.current,
      deviceControlActive: deviceOptInRef.current && deviceStatus.connected,
      profile: profileMemoryRef.current,
      inventory: sessionInventory,
      taskHistory,
      sessionMemory: sessionMemoryRef.current,
      recentTaskTemplates:
        sceneStateRef.current.task_progress !== "none"
          ? [sceneStateRef.current.task_template_id]
          : [],
      progress: {
        current_tier: taskProgress.current_tier,
        free_pass_count: taskProgress.free_pass_count,
        last_completion_summary: taskProgress.last_completion_summary,
      },
    });
    if (scaffolded) {
      return {
        text: scaffolded,
        source: "deterministic_scene",
        deterministicRail: "idle_scaffold_recovery",
      };
    }

    const coreMove = classifyCoreConversationMove({
      userText: pendingTurn.text,
      previousAssistantText: lastAssistantText,
      currentTopic,
    });
    const coreReply =
      shouldStabilizeCoreConversationMove(
        coreMove,
        sceneStateRef.current,
        pendingTurn.dialogueAct,
      )
        ? buildCoreConversationReply({
            userText: pendingTurn.text,
            previousAssistantText: lastAssistantText,
            currentTopic,
          })
        : null;
    if (coreReply) {
      return {
        text: coreReply,
        source: "deterministic_scene",
        deterministicRail: "idle_core_recovery",
      };
    }

    const questionReply = shouldDeterministicallyAnswerOpenQuestion(
      pendingTurn.text,
      sceneStateRef.current,
      pendingTurn.dialogueAct,
    )
      ? buildHumanQuestionFallback(pendingTurn.text, "neutral", {
          previousAssistantText: lastAssistantText,
          currentTopic,
          inventory: sessionInventory,
        })
      : null;
    if (questionReply) {
      return {
        text: questionReply,
        source: "deterministic_scene",
        deterministicRail: "idle_question_recovery",
      };
    }

    return {
      text:
        buildSceneFallback(
          sceneStateRef.current,
          pendingTurn.text,
          sessionMemoryRef.current,
          sessionInventory,
        ) ??
        buildTopicFallback(
          pendingTurn.dialogueAct,
          pendingTurn.text,
          workingMemoryRef.current,
          sceneStateRef.current,
        ),
      source: "scene_fallback",
      deterministicRail: "idle_scene_fallback_recovery",
    };
  }

  function forceIdlePendingTurnRecovery(pendingTurn: PendingUserTurn, reason: string): boolean {
    const recovery = buildIdleRecoveryReply(pendingTurn);
    if (!recovery.text) {
      return false;
    }
    finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
    activeAssistantTraceRef.current = {
      requestId: pendingTurn.requestId,
      sessionId: turnGateRef.current.sessionId,
      sourceUserMessageId: pendingTurn.messageId,
      stepId: `idle-recovery-${pendingTurn.messageId}`,
      source:
        recovery.source === "model" ||
        recovery.source === "deterministic_task" ||
        recovery.source === "deterministic_observation"
          ? recovery.source
          : "deterministic_scene",
      modelRan: false,
      deterministicRail: recovery.deterministicRail,
      postProcessed: false,
      startedAtMs: pendingTurn.acceptedAtMs,
      turnIdEstimate: turnGateRef.current.lastAssistantTurnId + 1,
      generationPath: "idle-recovery",
      serverRequestId: null,
      serverTurnId: null,
      finalOutputSource: recovery.source,
      outputGeneratorCount: 1,
    };
    pushTurnTrace("turn.idle_processing.recovered", {
      request_id: pendingTurn.requestId,
      user_message_id: pendingTurn.messageId,
      reason,
      deterministic_rail: recovery.deterministicRail,
      at_ms: now(),
    });
    appendRavenOutput(recovery.text);
    activeAssistantTraceRef.current = null;
    const updatedContract = reduceAssistantEmission(currentContractState(), {
      stepId: `idle-recovery-${pendingTurn.messageId}`,
      content: recovery.text,
      isQuestion: isQuestionText(recovery.text),
      topicResolved: false,
    });
    applyContractState(updatedContract);
    setDynamicStepCount(updatedContract.turnGate.stepIndex - 1);
    syncSessionPhase(updatedContract.turnGate);
    lastHandledUserMessageIdRef.current = pendingTurn.messageId;
    pendingUserTurnRef.current = null;
    return true;
  }

  function summarizeVerificationMemory(result: VerificationResult): string {
    return buildVerificationSummary(result);
  }

  function appendVerificationSummary(summary: string) {
    recentVerifySummariesRef.current = trimToSize(
      [...recentVerifySummariesRef.current, summary],
      6,
    );
    syncSceneState(noteSceneVerificationResult(sceneStateRef.current, summary));
    setVerifySummary(summary);
  }

  async function executeVerification(
    checkType: VerificationCheckType,
    checkParams: Record<string, unknown> = {},
  ): Promise<VerificationResult> {
    const runner = runnerRef.current;
    if (!runner) {
      return {
        checkType,
        status: "inconclusive",
        confidence: 0.2,
        summary: "Camera runner is unavailable.",
        raw: { cameraReady: false, checkParams },
      };
    }
    const snapshot = runner.captureFrameSnapshot();
    return runVerification(
      checkType,
      snapshot,
      runner.getLatestObservation(),
      checkParams,
      capabilityCatalogRef.current,
    );
  }

  async function buildVerificationNodeForPendingTurn(
    pendingTurn: PendingUserTurn,
    stepIndex: number,
  ): Promise<ConversationNode> {
    const pending = pendingVerificationRef.current;
    if (!pending) {
      return {
        id: `reflect-${pendingTurn.messageId}-${stepIndex}`,
        type: "reflect_step",
        text: "Continue with steady pacing and clear focus.",
        verify_summary: null,
        phase: phaseRef.current,
      };
    }

    if (pending.awaitingConfirmation) {
      const confirmationSummary = "Camera unavailable. User confirmed completion once.";
      const memory = writeVerifiedResult(
        sessionMemoryRef.current,
        confirmationSummary,
        now(),
        0.45,
      );
      syncSessionMemory(memory, "last_verified_result_summary from user confirmation");
      appendVerificationSummary(confirmationSummary);
      pendingVerificationRef.current = null;
      commitmentRef.current = clearVerificationCommitment(commitmentRef.current);
      setVerifyingState("idle");
      const confirmationReply = buildVerificationManualConfirmationReply();
      const continuation = buildVerificationContinuation(sceneStateRef.current, {
        checkType: pending.checkType,
        status: "confirmed",
      });
      return {
        id: `verify-confirm-${pendingTurn.messageId}-${stepIndex}`,
        type: "reflect_step",
        text: `${confirmationReply.text} ${continuation}`.trim(),
        verify_summary: confirmationSummary,
        phase: phaseRef.current,
      };
    }

    setVerifyingState("running");
    setMessage("Verifying with camera...");
    let verification = await executeVerification(pending.checkType, pending.checkParams);

    const requestConfirmation = shouldRequestUserConfirmation(verification);
    if (shouldRetryVerification(verification, pending.retriesRemaining)) {
      setVerifyingState("retrying");
      pushFeed({
        timestamp: now(),
        label: "session.verify.retry",
        detail: `retrying ${pending.checkType} after inconclusive result`,
      });
      pendingVerificationRef.current = {
        ...pending,
        retriesRemaining: pending.retriesRemaining - 1,
      };
      await sleepMs(450);
      verification = await executeVerification(pending.checkType, pending.checkParams);
    }

    setVerifyingState("idle");
    setMessage(null);
    const verifySummaryLine = summarizeVerificationMemory(verification);
    appendVerificationSummary(verifySummaryLine);
    pushFeed({
      timestamp: now(),
      label: "session.verify.result",
      detail: verifySummaryLine,
    });

    const updatedMemory = writeVerifiedResult(
      sessionMemoryRef.current,
      verifySummaryLine,
      now(),
      verification.confidence,
    );
    syncSessionMemory(updatedMemory, `last_verified_result_summary -> ${verifySummaryLine}`);

    if (verification.status === "pass") {
      if (sessionMetricsRef.current.active) {
        sessionMetricsRef.current.verificationPasses += 1;
        sessionMetricsRef.current.streakCurrent += 1;
        sessionMetricsRef.current.streakMax = Math.max(
          sessionMetricsRef.current.streakMax,
          sessionMetricsRef.current.streakCurrent,
        );
      }
      applySessionEvent("verification_pass", verification.summary);
      pendingVerificationRef.current = null;
      commitmentRef.current = clearVerificationCommitment(commitmentRef.current);
      const scaffoldReply = buildVerificationOutcomeReply(verification, pending.instructionText);
      const continuation = buildVerificationContinuation(sceneStateRef.current, {
        checkType: verification.checkType,
        status: verification.status,
      });
      return {
        id: `verify-pass-${pendingTurn.messageId}-${stepIndex}`,
        type: "reflect_step",
        text:
          scaffoldReply.kind === "reflect"
            ? `${scaffoldReply.text} ${continuation}`.trim()
            : `Good. I verified it. ${continuation}`.trim(),
        verify_summary: verifySummaryLine,
        phase: phaseRef.current,
      };
    }

    if (verification.status === "fail") {
      if (sessionMetricsRef.current.active) {
        sessionMetricsRef.current.verificationFails += 1;
        sessionMetricsRef.current.streakCurrent = 0;
      }
      applySessionEvent("verification_fail", verification.summary);
      pendingVerificationRef.current = {
        ...pending,
        retriesRemaining: 0,
      };
      const scaffoldReply = buildVerificationOutcomeReply(verification, pending.instructionText);
      return {
        id: `verify-fail-${pendingTurn.messageId}-${stepIndex}`,
        type: "ask_step",
        question:
          scaffoldReply.kind === "ask"
            ? scaffoldReply.text
            : `No. I did not verify that cleanly. ${verification.summary} Reset once and reply done.`,
        slotKey: scaffoldReply.kind === "ask" ? scaffoldReply.slotKey : "improvement_area",
        timeoutSeconds: 30,
        maxRetries: 0,
        phase: phaseRef.current,
      };
    }

    if (sessionMetricsRef.current.active) {
      sessionMetricsRef.current.verificationInconclusive += 1;
      sessionMetricsRef.current.streakCurrent = 0;
    }
    applySessionEvent("verification_inconclusive", verification.summary);
    if (requestConfirmation || shouldRequestUserConfirmation(verification)) {
      pendingVerificationRef.current = {
        ...pending,
        awaitingConfirmation: true,
        retriesRemaining: 0,
      };
      const confirmationPrompt = buildVerificationManualConfirmationPrompt();
      return {
        id: `verify-confirm-needed-${pendingTurn.messageId}-${stepIndex}`,
        type: "ask_step",
        question: confirmationPrompt.text,
        slotKey: confirmationPrompt.slotKey,
        timeoutSeconds: 30,
        maxRetries: 0,
        phase: phaseRef.current,
      };
    }

    pendingVerificationRef.current = null;
    commitmentRef.current = clearVerificationCommitment(commitmentRef.current);
    const scaffoldReply = buildVerificationOutcomeReply(verification, pending.instructionText);
    const continuation = buildVerificationContinuation(sceneStateRef.current, {
      checkType: verification.checkType,
      status: verification.status,
    });
    return {
      id: `verify-inconclusive-${pendingTurn.messageId}-${stepIndex}`,
      type: "reflect_step",
      text:
        scaffoldReply.kind === "reflect"
          ? `${scaffoldReply.text} ${continuation}`.trim()
          : `I did not get a clean read. ${verification.summary} ${continuation}`.trim(),
      verify_summary: verifySummaryLine,
      phase: phaseRef.current,
    };
  }

  async function processPendingUserTurnLocally(options?: {
    allowRecovery?: boolean;
    processingSource?: "test_hook" | "standalone";
  }) {
    const allowRecovery = options?.allowRecovery === true;
    const processingSource = options?.processingSource ?? "standalone";
    if (dynamicRuntimeRef.current.active || dynamicRuntimeRef.current.warming) {
      return;
    }

    const pendingTurn = pendingUserTurnRef.current;
    if (!pendingTurn) {
      return;
    }
    const turnRequestGuard = beginTurnRequest(
      inFlightTurnRequestRef.current,
      pendingTurn.messageId,
      pendingTurn.requestId,
    );
    if (!turnRequestGuard.allow) {
      if (
        allowRecovery &&
        turnRequestGuard.reason === "request_already_active" &&
        now() - pendingTurn.acceptedAtMs >= 1000
      ) {
        forceIdlePendingTurnRecovery(pendingTurn, "stalled_request_recovered");
      }
      return;
    }
    pushTurnTrace("turn.local_processing_started", {
      request_id: pendingTurn.requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: pendingTurn.messageId,
      source: processingSource,
      step_index: turnGateRef.current.stepIndex,
      at_ms: now(),
    });

    const stepIndex = turnGateRef.current.stepIndex;
    const prepared = await buildRespondNodeForPendingTurn(pendingTurn, stepIndex);
    if (!prepared) {
      lastHandledUserMessageIdRef.current = pendingTurn.messageId;
      pendingUserTurnRef.current = null;
      finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
      return;
    }
    const selectedNode = prepared.node;

    const promptText = nodePromptText(selectedNode);
    const emitDecision = canEmitAssistant(turnGateRef.current, selectedNode.id, promptText);
    if (!emitDecision.allow) {
      finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
      return;
    }

    setCurrentStepId(selectedNode.id);
    activeAssistantTraceRef.current = {
      requestId: pendingTurn.requestId,
      sessionId: turnGateRef.current.sessionId,
      sourceUserMessageId: pendingTurn.messageId,
      stepId: selectedNode.id,
      source: prepared.trace.source,
      modelRan: prepared.trace.modelRan,
      deterministicRail: prepared.trace.deterministicRail,
      postProcessed: prepared.trace.postProcessed,
      startedAtMs: pendingTurn.acceptedAtMs,
      turnIdEstimate: turnGateRef.current.lastAssistantTurnId + 1,
      generationPath: prepared.trace.generationPath,
      serverRequestId: prepared.trace.serverRequestId,
      serverTurnId: prepared.trace.serverTurnId,
      finalOutputSource: prepared.trace.finalOutputSource,
      outputGeneratorCount: prepared.trace.outputGeneratorCount,
    };
    pushTurnTrace("turn.render.attempt", {
      request_id: pendingTurn.requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: pendingTurn.messageId,
      selected_text: promptText,
      selected_node_type: selectedNode.type,
      final_output_source: prepared.trace.finalOutputSource,
      at_ms: now(),
    });
    const appendResult = appendRavenOutput(promptText);
    let recoveredRender = false;
    if (
      !appendResult.committed &&
      shouldRecoverSkippedAssistantRender({
        appendCommitted: appendResult.committed,
        appendReason: appendResult.reason,
        hasRenderableText: appendResult.hasRenderableText,
        sourceUserMessageId: pendingTurn.messageId,
        lastAssistantUserMessageId: turnGateRef.current.lastAssistantUserMessageId,
        visibleAssistantAlreadyCommitted:
          (visibleAssistantTurnRef.current.get(pendingTurn.messageId) ?? null) !== null,
      })
    ) {
      recoveredRender = recoverSkippedAssistantRender(
        promptText,
        activeAssistantTraceRef.current,
        appendResult.reason,
      );
    }
    pushTurnTrace("turn.render.result", {
      request_id: pendingTurn.requestId,
      session_id: turnGateRef.current.sessionId,
      user_message_id: pendingTurn.messageId,
      committed: appendResult.committed,
      recovered: recoveredRender,
      reason: appendResult.reason,
      rendered_text: appendResult.renderedText,
      at_ms: now(),
    });
    if (!appendResult.committed && !recoveredRender) {
      pushTurnTrace("turn.render.skipped", {
        request_id: pendingTurn.requestId,
        session_id: turnGateRef.current.sessionId,
        user_message_id: pendingTurn.messageId,
        reason: appendResult.reason,
        at_ms: now(),
      });
      activeAssistantTraceRef.current = null;
      setMessage("Raven generated a reply, but rendering was skipped. Check the trace for details.");
      lastHandledUserMessageIdRef.current = pendingTurn.messageId;
      pendingUserTurnRef.current = null;
      finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
      return;
    }
    activeAssistantTraceRef.current = null;

    if (
      sceneStateRef.current.topic_type === "game_setup" &&
      /\bi pick\b|\bwe are doing\b|\bhere is the game\b|\bgame is\b/i.test(promptText)
    ) {
      syncSceneState(
        reconcileSceneStateWithConversation(
          noteSceneStateAssistantTurn(sceneStateRef.current, {
            text: promptText,
            commitment: promptText,
            topicResolved: true,
          }),
          conversationStateRef.current,
        ),
      );
    } else if (
      sceneStateRef.current.topic_type === "task_negotiation" &&
      isTaskAssignmentText(promptText)
    ) {
      syncSceneState(
        reconcileSceneStateWithConversation(
          noteSceneStateAssistantTurn(sceneStateRef.current, {
            text: promptText,
            commitment: promptText,
            topicResolved: true,
          }),
          conversationStateRef.current,
        ),
      );
    }

    const updatedContract = reduceAssistantEmission(currentContractState(), {
      stepId: selectedNode.id,
      content: promptText,
      isQuestion: selectedNode.type === "ask_step" || isQuestionText(promptText),
      topicResolved: false,
    });
    applyContractState(updatedContract);
    if (selectedNode.type === "ask_step") {
      activeAskSlotRef.current = selectedNode.slotKey;
    }
    setDynamicStepCount(updatedContract.turnGate.stepIndex - 1);
    syncSessionPhase(updatedContract.turnGate);
    lastHandledUserMessageIdRef.current = pendingTurn.messageId;
    pendingUserTurnRef.current = null;
    finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
  }

  async function runStandalonePendingTurn() {
    if (dynamicRuntimeRef.current.active || dynamicRuntimeRef.current.warming) {
      return;
    }
    if (isSessionActive(sessionState)) {
      return;
    }
    await processPendingUserTurnLocally({
      allowRecovery: false,
      processingSource: "standalone",
    });
  }

  async function runTestHookPendingTurn() {
    if (!sessionTestHooksEnabledRef.current) {
      return;
    }
    await processPendingUserTurnLocally({
      allowRecovery: true,
      processingSource: "test_hook",
    });
  }

  async function runDynamicStep(
    step: SessionStep,
    onFirstOutput: (text: string) => void,
  ): Promise<DynamicOutcome> {
    return await new Promise<DynamicOutcome>((resolve) => {
      const runner = runnerRef.current;
      if (!runner) {
        resolve("stopped");
        return;
      }

      const engine = new StepEngine(
        [step],
        {
          start: (checkType) => runner.start(checkType),
          stop: () => runner.stop(),
          onEvent: (handler) => runner.events().on(handler),
        },
        { autoTickMs: 1000, pacing: pacingRef.current },
      );
      disposeEngine();
      engineRef.current = engine;
      let outputHandled = false;

      const unsubscribe = engine.onEvent((event) => {
        if (event.type === "output" && !outputHandled) {
          outputHandled = true;
          const rendered = handleEngineEvent(event);
          if (rendered) {
            onFirstOutput(event.text);
          }
        } else if (event.type !== "output") {
          handleEngineEvent(event);
        }
        if (event.type === "session.completed") {
          unsubscribe();
          disposeEngine();
          resolve("passed");
          return;
        }

        if (event.type === "session.failed") {
          unsubscribe();
          disposeEngine();
          if (/timeout/i.test(event.reason)) {
            resolve("timeout");
          } else {
            resolve("failed");
          }
          return;
        }

        if (event.type === "session.stopped") {
          unsubscribe();
          disposeEngine();
          resolve("stopped");
        }
      });

      engine.start();
    });
  }

  async function startDynamicSession() {
    setMessage(null);
    const runtime = dynamicRuntimeRef.current;
    if (runtime.active || runtime.warming) {
      pushTurnTrace("session.loop.start_blocked", {
        session_id: turnGateRef.current.sessionId,
        active: runtime.active,
        warming: runtime.warming,
        at_ms: now(),
      });
      setMessage("Dynamic session is already running.");
      return;
    }
    if (stopped) {
      setMessage("Cannot start session while Emergency Stop is engaged.");
      return;
    }
    if (!consentReady || !consent) {
      setMessage("Complete Consent before starting a session.");
      return;
    }
    if (!cameraRunning) {
      setMessage("Camera is not running. Start camera first.");
      return;
    }

    disposeEngine();
    beginSessionTracking();
    runtime.warming = true;
    runtime.active = false;
    runtime.stepCount = 0;
    runtime.plannerAbort = null;
    runtime.loopId += 1;
    const loopId = runtime.loopId;
    const preservedPendingTurn = pendingUserTurnRef.current;
    const preserveQueuedUserTurn = shouldPreserveQueuedUserTurnOnSessionStart({
      pendingTurnMessageId: preservedPendingTurn?.messageId ?? 0,
      lastHandledUserMessageId: lastHandledUserMessageIdRef.current,
    });
    const preservedContract = currentContractState();
    const preservedConversationState = conversationStateRef.current;
    const preservedSessionMemory = sessionMemoryRef.current;
    const preservedRecentDialogue = recentDialogueRef.current;
    const preservedTopicAnchor = topicAnchorRef.current;
    pushTurnTrace("session.loop.start_context", {
      session_id: turnGateRef.current.sessionId,
      preserve_queued_user_turn: preserveQueuedUserTurn,
      pending_turn_message_id: preservedPendingTurn?.messageId ?? 0,
      last_handled_user_message_id: lastHandledUserMessageIdRef.current,
      at_ms: now(),
    });
    applyContractState(
      preserveQueuedUserTurn
        ? preservedContract
        : createSessionStateContract(turnGateRef.current.sessionId),
    );
    syncConversationState(
      preserveQueuedUserTurn
        ? preservedConversationState
        : createConversationStateSnapshot(turnGateRef.current.sessionId),
    );
    setPromptDebugState(null);
    sessionMemoryRef.current = preserveQueuedUserTurn ? preservedSessionMemory : createSessionMemory();
    commitmentRef.current = createCommitmentState();
    syncSceneState({
      ...createSceneState(),
      free_pass_count: taskProgress.free_pass_count,
    });
    deterministicTaskIdRef.current = null;
    proactiveInventoryTaskIssuedRef.current = false;
    syncDeterministicTaskStartedAt(null);
    phaseRef.current = "warmup";
    complianceScoreRef.current = 0;
    lastHandledUserMessageIdRef.current = 0;
    pendingUserTurnRef.current = preserveQueuedUserTurn ? preservedPendingTurn : null;
    pendingVerificationRef.current = null;
    clarifiedMessageIdRef.current = null;
    activeAskSlotRef.current = null;
    recentVerifySummariesRef.current = [];
    lastAssistantReplayRef.current = null;
    visibleAssistantTurnRef.current.clear();
    recentDialogueRef.current = preserveQueuedUserTurn ? preservedRecentDialogue : [];
    topicAnchorRef.current = preserveQueuedUserTurn ? preservedTopicAnchor : null;
    setDynamicStepCount(0);
    setSessionMemorySummary(
      preserveQueuedUserTurn ? summarizeSessionMemory(sessionMemoryRef.current) : "- none",
    );
    setSessionPhase("warmup");
    setLastUserIntent("user_ack");
    setLastDialogueAct("noop");
    setVerifyingState("idle");
    setVerifySummary(null);
    setLastPlanRaw(null);
    setLastPlanValidation(null);
    setSessionState("idle");
    setCurrentStepId("dynamic-1");
    trackingEverAcquiredRef.current = false;
    setTrackingEverAcquired(false);
    lastTrackedAtRef.current = null;
    lastStepsRef.current = [];

    const warmupReady = await waitForDynamicWarmup();
    if (!warmupReady) {
      runtime.active = false;
      runtime.warming = false;
      void finalizeSessionTracking("stopped:warmup_not_ready");
      return;
    }

    runtime.warming = false;
    runtime.active = true;
    setSessionState("running");

    while (runtime.active && !disposedRef.current && dynamicRuntimeRef.current.loopId === loopId) {
      if (stopped) {
        stopDynamicSession("Emergency stop engaged. Session stopped.");
        return;
      }

      if (turnGateRef.current.awaitingUser) {
        setAwaitingUser(true);
        setMessage("Waiting for your response before the next step.");
        logPlannerDebug({
          stepIndex: turnGateRef.current.stepIndex,
          stepId: turnGateRef.current.lastAssistantStepId ?? "none",
          decision: "await_user",
          reason: "awaiting_user_flag_is_true",
        });
        await sleepMs(250);
        continue;
      }

      if (turnGateRef.current.lastUserMessageId === 0) {
        setMessage("Send one user message to start dynamic responses.");
        logPlannerDebug({
          stepIndex: turnGateRef.current.stepIndex,
          stepId: "none",
          decision: "await_user",
          reason: "initial_user_message_required",
        });
        await sleepMs(250);
        continue;
      }

      const pendingTurn = pendingUserTurnRef.current as PendingUserTurn | null;
      const pendingTurnMessageId = pendingTurn?.messageId ?? 0;
      if (pendingTurnMessageId > lastHandledUserMessageIdRef.current) {
        if (!pendingTurn) {
          await sleepMs(100);
          continue;
        }
        await pacingRef.current.beforeNextPlanning();
        if (!runtime.active || disposedRef.current) {
          return;
        }

        const stepIndex = turnGateRef.current.stepIndex;
        const hasNewUserMessage =
          turnGateRef.current.lastUserMessageId > turnGateRef.current.lastAssistantUserMessageId;
        const nextAskSlot = chooseNextAskSlot(sessionMemoryRef.current);
        const shouldAskQuestionNow = shouldAskSessionQuestion({
          nextAskSlot,
          activeAskSlot: activeAskSlotRef.current,
          pendingVerification: pendingVerificationRef.current !== null,
          userIntent: pendingTurn.intent,
          lastAssistantTurnId: turnGateRef.current.lastAssistantTurnId,
          sceneState: sceneStateRef.current,
        });
        const dialogueDecision = selectDialogueAct({
          hasNewUserMessage,
          awaitingUser: turnGateRef.current.awaitingUser,
          userIntent: pendingTurn.intent,
          pendingVerification: pendingVerificationRef.current !== null,
          clarificationUsedForMessage: clarifiedMessageIdRef.current === pendingTurn.messageId,
          shouldAskQuestion: shouldAskQuestionNow,
        });
        setLastDialogueAct(dialogueDecision.act);

        const turnRequestGuard = beginTurnRequest(
          inFlightTurnRequestRef.current,
          pendingTurn.messageId,
          pendingTurn.requestId,
        );
        if (!turnRequestGuard.allow) {
          pushTurnTrace("turn.processing_blocked", {
            request_id: pendingTurn.requestId,
            session_id: turnGateRef.current.sessionId,
            user_message_id: pendingTurn.messageId,
            reason: turnRequestGuard.reason,
            at_ms: now(),
          });
          await sleepMs(100);
          continue;
        }
        pushTurnTrace("turn.processing_started", {
          request_id: pendingTurn.requestId,
          session_id: turnGateRef.current.sessionId,
          user_message_id: pendingTurn.messageId,
          step_index: stepIndex,
          at_ms: now(),
        });

        let selectedNode: ConversationNode | null = null;
        let selectedTrace: AssistantTraceMeta | null = null;
        if (dialogueDecision.act === "verify_action" && pendingVerificationRef.current) {
          selectedNode = await buildVerificationNodeForPendingTurn(pendingTurn, stepIndex);
          selectedTrace = {
            requestId: pendingTurn.requestId,
            sessionId: turnGateRef.current.sessionId,
            sourceUserMessageId: pendingTurn.messageId,
            stepId: selectedNode?.id ?? `verify-${pendingTurn.messageId}-${stepIndex}`,
            source: "verification",
            modelRan: false,
            deterministicRail: "verification",
            postProcessed: false,
            startedAtMs: pendingTurn.acceptedAtMs,
            turnIdEstimate: turnGateRef.current.lastAssistantTurnId + 1,
            generationPath: "verification",
            serverRequestId: null,
            serverTurnId: null,
            finalOutputSource: "deterministic_scene",
            outputGeneratorCount: 1,
          };
        } else if (dialogueDecision.act === "ask_one_question" && nextAskSlot) {
          activeAskSlotRef.current = nextAskSlot;
          selectedNode = {
            id: `ask-slot-${pendingTurn.messageId}-${stepIndex}`,
            type: "ask_step",
            question: buildSlotQuestion(nextAskSlot),
            slotKey: nextAskSlot,
            timeoutSeconds: 30,
            maxRetries: 0,
            phase: phaseRef.current,
          };
          selectedTrace = {
            requestId: pendingTurn.requestId,
            sessionId: turnGateRef.current.sessionId,
            sourceUserMessageId: pendingTurn.messageId,
            stepId: selectedNode.id,
            source: "ask",
            modelRan: false,
            deterministicRail: "ask_slot",
            postProcessed: false,
            startedAtMs: pendingTurn.acceptedAtMs,
            turnIdEstimate: turnGateRef.current.lastAssistantTurnId + 1,
            generationPath: "ask",
            serverRequestId: null,
            serverTurnId: null,
            finalOutputSource: "deterministic_scene",
            outputGeneratorCount: 1,
          };
        } else if (
          dialogueDecision.act === "answer_user_question" ||
          dialogueDecision.act === "clarify_once" ||
          dialogueDecision.act === "acknowledge_and_reflect" ||
          dialogueDecision.act === "give_instruction"
        ) {
          if (dialogueDecision.act === "clarify_once") {
            clarifiedMessageIdRef.current = pendingTurn.messageId;
          }
          const prepared = await buildRespondNodeForPendingTurn(pendingTurn, stepIndex);
          selectedNode = prepared?.node ?? null;
          selectedTrace = prepared
            ? {
                requestId: pendingTurn.requestId,
                sessionId: turnGateRef.current.sessionId,
                sourceUserMessageId: pendingTurn.messageId,
                stepId: prepared.node.id,
                source: prepared.trace.source,
                modelRan: prepared.trace.modelRan,
                deterministicRail: prepared.trace.deterministicRail,
                postProcessed: prepared.trace.postProcessed,
                startedAtMs: pendingTurn.acceptedAtMs,
                turnIdEstimate: turnGateRef.current.lastAssistantTurnId + 1,
                generationPath: prepared.trace.generationPath,
                serverRequestId: prepared.trace.serverRequestId,
                serverTurnId: prepared.trace.serverTurnId,
                finalOutputSource: prepared.trace.finalOutputSource,
                outputGeneratorCount: prepared.trace.outputGeneratorCount,
              }
            : null;
        }

        if (!selectedNode) {
          finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
          if (
            dialogueDecision.act === "answer_user_question" ||
            dialogueDecision.act === "clarify_once" ||
            dialogueDecision.act === "acknowledge_and_reflect" ||
            dialogueDecision.act === "give_instruction"
          ) {
            lastHandledUserMessageIdRef.current = pendingTurn.messageId;
            pendingUserTurnRef.current = null;
          }
          logPlannerDebug({
            stepIndex,
            stepId: `turn-${pendingTurn.messageId}`,
            decision: "noop",
            reason: dialogueDecision.reason,
            dialogueAct: dialogueDecision.act,
            userIntent: pendingTurn.intent,
            turnId: turnGateRef.current.lastAssistantTurnId,
          });
          await sleepMs(250);
          continue;
        }

        const promptText = nodePromptText(selectedNode);
        if (
          commitmentRef.current.type === "complete_verification" &&
          !isResponseAlignedWithCommitment(commitmentRef.current, promptText)
        ) {
          logPlannerDebug({
            stepIndex,
            stepId: selectedNode.id,
            decision: "noop",
            reason: "verification_commitment_blocked_non_verification_turn",
            dialogueAct: dialogueDecision.act,
            userIntent: pendingTurn.intent,
            turnId: turnGateRef.current.lastAssistantTurnId,
          });
          setMessage("Finish the camera check before the next reply.");
          await sleepMs(250);
          continue;
        }
        const emitDecision = canEmitAssistant(turnGateRef.current, selectedNode.id, promptText);
        if (!emitDecision.allow) {
          logPlannerDebug({
            stepIndex,
            stepId: selectedNode.id,
            decision: "noop",
            reason: `no_op:${emitDecision.reason}`,
            dialogueAct: dialogueDecision.act,
            userIntent: pendingTurn.intent,
            turnId: turnGateRef.current.lastAssistantTurnId,
          });
          await sleepMs(250);
          continue;
        }

        setCurrentStepId(selectedNode.id);
        let emitted = false;
        activeAssistantTraceRef.current = selectedTrace;
        try {
          await runDynamicStep(nodeToSessionStep(selectedNode), (text) => {
            emitted = true;
            const nodeIsQuestion = selectedNode.type === "ask_step";
            const updatedContract = reduceAssistantEmission(currentContractState(), {
              stepId: selectedNode.id,
              content: text,
              isQuestion: nodeIsQuestion || isQuestionText(text),
              topicResolved: false,
            });
            applyContractState(updatedContract);
            if (selectedNode.type === "ask_step") {
              activeAskSlotRef.current = selectedNode.slotKey;
            }
            runtime.stepCount = updatedContract.turnGate.stepIndex - 1;
            setDynamicStepCount(runtime.stepCount);
            syncSessionPhase(updatedContract.turnGate);
            logPlannerDebug({
              stepIndex: updatedContract.turnGate.stepIndex - 1,
              stepId: selectedNode.id,
              decision: "emit_text",
              reason: dialogueDecision.reason,
              dialogueAct: dialogueDecision.act,
              userIntent: pendingTurn.intent,
              turnId: updatedContract.turnGate.lastAssistantTurnId,
            });
          });
        } finally {
          activeAssistantTraceRef.current = null;
          finishTurnRequest(inFlightTurnRequestRef.current, pendingTurn.messageId, pendingTurn.requestId);
        }
        if (!runtime.active || disposedRef.current) {
          return;
        }

        if (emitted) {
          lastHandledUserMessageIdRef.current = pendingTurn.messageId;
          pendingUserTurnRef.current = null;
          const completedStep: PlannedStep = {
            id: selectedNode.id,
            mode: "talk",
            say:
              selectedNode.type === "ask_step"
                ? selectedNode.question
                : selectedNode.type === "verify_step"
                  ? `verify:${selectedNode.check_type}`
                  : selectedNode.text,
            timeoutSeconds: 12,
            onPassSay: "ok",
            onFailSay: "retry",
            maxRetries: 0,
          };
          lastStepsRef.current = [...lastStepsRef.current, completedStep].slice(-6);
          continue;
        }

        logPlannerDebug({
          stepIndex,
          stepId: selectedNode.id,
          decision: "noop",
          reason: "no_output_emitted",
          dialogueAct: dialogueDecision.act,
          userIntent: pendingTurn.intent,
          turnId: turnGateRef.current.lastAssistantTurnId,
        });
        await sleepMs(250);
        continue;
      }

      if (shouldHoldForNoNewUserAfterAssistant(turnGateRef.current)) {
        if (debugMode) {
          console.warn("session.plan.warn no new user message after assistant response");
        }
        setMessage("Waiting for a new user message before generating another response.");
        logPlannerDebug({
          stepIndex: turnGateRef.current.stepIndex,
          stepId: turnGateRef.current.lastAssistantStepId ?? "none",
          decision: "await_user",
          reason: "last_message_is_assistant_without_new_user_message",
        });
        await sleepMs(250);
        continue;
      }

      await pacingRef.current.beforeNextPlanning();
      if (!runtime.active || disposedRef.current) {
        return;
      }

      const stepIndex = turnGateRef.current.stepIndex;
      setCurrentStepId(`dynamic-${stepIndex}`);
      setPlannerBusy(true);
      const abort = new AbortController();
      runtime.plannerAbort = abort;
      const sessionMemorySummaryText = summarizeSessionMemory(sessionMemoryRef.current);
      const plannerPhase = syncSessionPhase(turnGateRef.current);
      const statePromptBlock = buildStatePromptBlockNow();
      const moodSnapshotNow = readMoodSnapshot(moodRef.current, now());
      const sessionMemoryFacts =
        sessionMemorySummaryText === "- none"
          ? []
          : sessionMemorySummaryText.split("\n").map((line) => line.trim());

      let planned: Awaited<ReturnType<typeof planNextStep>> | null = null;
      let plannerRequestError: string | null = null;
      try {
        planned = await planNextStep({
          settings,
          consent,
          stepIndex,
          observation: latestObservationRef.current,
          visionSignalsStatus: visionSignalsStatusRef.current,
          deviceOptIn: deviceOptInRef.current,
          deviceExecutionSummary: lastDeviceExecutionSummaryRef.current,
          memoryAutoSave,
          sessionId: turnGateRef.current.sessionId,
          context: {
            recentRavenOutputs: recentRavenOutputsRef.current.slice(-6),
            recentVerificationSummaries: recentVerifySummariesRef.current.slice(-4),
            lastUserResponse: lastUserResponseRef.current,
            lastCheckSummary: lastCheckSummaryRef.current,
            trackingStatus: trackingStatusRef.current,
            lastStepsSummary: summarizeLastSteps(lastStepsRef.current),
            memoryFacts: [
              ...sessionMemoryFacts,
              ...Object.entries(profileMemoryRef.current).map(
                ([key, value]) => `- ${key}: ${value}`,
              ),
            ],
            memorySummary: profileMemoryRef.current.memory_summary ?? "none",
            sessionMemorySummary: sessionMemorySummaryText,
            sessionPhase: plannerPhase,
            lastUserIntent,
            awaitingUser: turnGateRef.current.awaitingUser,
            moodLabel: moodSnapshotNow.mood_label,
            relationshipLabel: relationshipRef.current.relationship_label,
            difficultyLevel: difficultyLevelRef.current,
            statePromptBlock,
            allowedCheckTypes: capabilityCatalogRef.current.map(
              (capability) => capability.capability_id,
            ),
            capabilityCatalogPrompt: buildCapabilityCatalogPrompt(capabilityCatalogRef.current),
          },
          signal: abort.signal,
        });
      } catch (error) {
        plannerRequestError = error instanceof Error ? error.message : "Planner request failed.";
      }

      runtime.plannerAbort = null;
      setPlannerBusy(false);
      if (!runtime.active || disposedRef.current) {
        return;
      }

      if (!planned) {
        setLastPlanRaw(null);
        setLastPlanValidation(null);
        setMessage(plannerRequestError ?? "Planner request failed.");
        logPlannerDebug({
          stepIndex,
          stepId: `dynamic-${stepIndex}`,
          decision: "noop",
          reason: plannerRequestError ?? "planner_request_failed",
        });
        await sleepMs(250);
        continue;
      }

      setLastPlanRaw(planned.raw ?? null);
      setLastPlanValidation(planned.validation ?? null);

      if (planned.fallback) {
        setMessage(planned.reason ?? "Planner returned fallback. No output emitted.");
        logPlannerDebug({
          stepIndex,
          stepId: planned.step.id,
          decision: "noop",
          reason: planned.reason ?? "planner_returned_fallback_step",
        });
        await sleepMs(250);
        continue;
      }

      if (planned.reason) {
        setMessage(planned.reason);
      }

      const decisionReason =
        planned.reason ?? (planned.fallback ? "planner_fallback" : "planner_ok");
      const constrained = applyPlannerConstraints(planned.step, lastStepsRef.current, stepIndex);
      if (constrained.overridden) {
        pushFeed({
          timestamp: now(),
          label: "session.plan.overridden",
          detail: constrained.reason ?? "Planner step overridden by safety constraints.",
        });
      }

      const nextPlanned = constrained.step;
      const currentPhase = syncSessionPhase(turnGateRef.current);
      const currentTopicAnchor =
        topicAnchorRef.current ??
        getSessionMemoryFocus(sessionMemoryRef.current) ??
        lastUserResponseRef.current ??
        null;
      const askSlot =
        nextPlanned.mode === "listen"
          ? (chooseNextAskSlot(sessionMemoryRef.current) ?? "profile_fact")
          : null;
      const node = plannerStepToNode(
        nextPlanned,
        currentPhase,
        askSlot ?? "profile_fact",
        currentTopicAnchor,
      );
      const plannerDialogueAct: DialogueAct =
        node.type === "ask_step" ? "ask_one_question" : "give_instruction";
      setLastDialogueAct(plannerDialogueAct);
      const nextTurnId = turnGateRef.current.lastAssistantTurnId + 1;
      const nodeWithReflection =
        node.type === "ask_step"
          ? {
              ...node,
              question: withReflectionText(
                node.question,
                nextTurnId,
                node.phase,
                sessionMemoryRef.current,
              ),
            }
          : {
              ...node,
              text: withReflectionText(node.text, nextTurnId, node.phase, sessionMemoryRef.current),
            };
      const gateBeforeDecision = turnGateRef.current;
      const hasNewUserMessage =
        gateBeforeDecision.lastUserMessageId > gateBeforeDecision.lastAssistantUserMessageId;
      if (!hasNewUserMessage && gateBeforeDecision.lastAssistantStepId === nodeWithReflection.id) {
        const repeated = incrementStepRepeatCount(turnGateRef.current, nodeWithReflection.id);
        turnGateRef.current = repeated;
        const repeats = repeated.stepRepeatCount[nodeWithReflection.id] ?? 0;
        if (repeats > 1) {
          logPlannerDebug({
            stepIndex,
            stepId: nodeWithReflection.id,
            decision: "advance_step",
            reason: "step_repeat_counter_exceeded_without_new_user_message",
          });
          setMessage("Repeated step blocked until a new user message is saved.");
          await sleepMs(250);
          continue;
        }
      }

      const promptText = nodePromptText(nodeWithReflection);
      if (
        commitmentRef.current.type === "complete_verification" &&
        !isResponseAlignedWithCommitment(commitmentRef.current, promptText)
      ) {
        logPlannerDebug({
          stepIndex,
          stepId: nodeWithReflection.id,
          decision: "noop",
          reason: "verification_commitment_blocked_planner_output",
          dialogueAct: plannerDialogueAct,
          userIntent: "none",
          turnId: turnGateRef.current.lastAssistantTurnId,
        });
        setMessage("Finish the camera check before the next step.");
        await sleepMs(250);
        continue;
      }
      const emitDecision = canEmitAssistant(turnGateRef.current, nodeWithReflection.id, promptText);
      if (!emitDecision.allow) {
        if (debugMode) {
          console.warn("session.plan.warn assistant output blocked", {
            session_id: turnGateRef.current.sessionId,
            step_id: nodeWithReflection.id,
            reason: emitDecision.reason,
          });
        }
        logPlannerDebug({
          stepIndex,
          stepId: nodeWithReflection.id,
          decision: "noop",
          reason: `no_op:${emitDecision.reason}`,
          dialogueAct: plannerDialogueAct,
          userIntent: "none",
          turnId: turnGateRef.current.lastAssistantTurnId,
        });
        setMessage("Planner step blocked until a new user response is saved.");
        await sleepMs(250);
        continue;
      }

      let emitted = false;
      activeAssistantTraceRef.current = {
        requestId: createRequestId("planner"),
        sessionId: turnGateRef.current.sessionId,
        sourceUserMessageId: 0,
        stepId: nodeWithReflection.id,
        source: "planner",
        modelRan: plannerDialogueAct !== "ask_one_question",
        deterministicRail: plannerDialogueAct === "ask_one_question" ? "planner_question" : "planner_step",
        postProcessed: false,
        startedAtMs: now(),
        turnIdEstimate: turnGateRef.current.lastAssistantTurnId + 1,
        generationPath: "planner",
        serverRequestId: null,
        serverTurnId: null,
        finalOutputSource: "deterministic_scene",
        outputGeneratorCount: 1,
      };
      const outcome = await runDynamicStep(nodeToSessionStep(nodeWithReflection), (text) => {
        emitted = true;
        const isQuestion = nodeWithReflection.type === "ask_step" || isQuestionText(text);
        const updatedContract = reduceAssistantEmission(currentContractState(), {
          stepId: nodeWithReflection.id,
          content: text,
          isQuestion,
          topicResolved: false,
        });
        applyContractState(updatedContract);
        if (nodeWithReflection.type === "instruct_step") {
          const checkType =
            nodeWithReflection.check_type ?? inferVerificationCheckType(nodeWithReflection.text);
          const checkRequired =
            nodeWithReflection.check_required || shouldRequireVerification(nodeWithReflection.text);
          if (checkRequired) {
            pendingVerificationRef.current = {
              stepId: nodeWithReflection.id,
              checkType,
              checkParams: nodeWithReflection.check_params ?? {},
              instructionText: nodeWithReflection.text,
              retriesRemaining: nodeWithReflection.retry_policy === "single_retry" ? 1 : 0,
              awaitingConfirmation: false,
            };
            commitmentRef.current = createVerificationCommitment(
              `finish ${checkType} before moving on`,
            );
          } else if (
            pendingVerificationRef.current &&
            pendingVerificationRef.current.stepId === nodeWithReflection.id
          ) {
            pendingVerificationRef.current = null;
            commitmentRef.current = clearVerificationCommitment(commitmentRef.current);
          }
        }
        activeAskSlotRef.current =
          nodeWithReflection.type === "ask_step" ? nodeWithReflection.slotKey : null;
        runtime.stepCount = updatedContract.turnGate.stepIndex - 1;
        setDynamicStepCount(runtime.stepCount);
        syncSessionPhase(updatedContract.turnGate);
        logPlannerDebug({
          stepIndex: updatedContract.turnGate.stepIndex - 1,
          stepId: nodeWithReflection.id,
          decision: "emit_text",
          reason:
            nodeWithReflection.type === "ask_step"
              ? `ask:${decisionReason}`
              : `emit:${decisionReason}`,
          dialogueAct: plannerDialogueAct,
          userIntent: "none",
          turnId: updatedContract.turnGate.lastAssistantTurnId,
        });
      }).finally(() => {
        activeAssistantTraceRef.current = null;
      });
      if (!runtime.active || disposedRef.current) {
        return;
      }

      if (!emitted) {
        logPlannerDebug({
          stepIndex,
          stepId: nodeWithReflection.id,
          decision: "noop",
          reason: "no_output_emitted",
          dialogueAct: plannerDialogueAct,
          userIntent: "none",
          turnId: turnGateRef.current.lastAssistantTurnId,
        });
      }

      if (outcome === "timeout" && nextPlanned.mode === "check" && nextPlanned.checkType) {
        lastCheckSummaryRef.current = summarizeCheckResult(
          nextPlanned.checkType,
          "timeout",
          lastCheckMetricsRef.current,
        );
      }

      if (outcome === "timeout" && nextPlanned.mode === "listen") {
        applySessionEvent("idle_timeout", "listen step timed out");
      }

      if (nextPlanned.mode === "check") {
        if (outcome === "passed") {
          complianceScoreRef.current = Math.min(complianceScoreRef.current + 1, 8);
        } else if (outcome === "failed" || outcome === "timeout") {
          complianceScoreRef.current = Math.max(complianceScoreRef.current - 1, -8);
        }
        syncSessionPhase(turnGateRef.current);
      }

      if (emitted) {
        lastStepsRef.current = [...lastStepsRef.current, nextPlanned].slice(-6);
      }

      if (outcome === "stopped") {
        runtime.active = false;
        return;
      }
    }
  }

  function startScriptedSession() {
    setMessage(null);
    if (stopped) {
      setMessage("Cannot start session while Emergency Stop is engaged.");
      return;
    }
    if (!consentReady) {
      setMessage("Complete Consent before starting a session.");
      return;
    }
    if (!cameraRunning) {
      setMessage("Camera is not running. Start camera first.");
      return;
    }

    dynamicRuntimeRef.current.active = false;
    dynamicRuntimeRef.current.warming = false;
    dynamicRuntimeRef.current.plannerAbort?.abort();
    dynamicRuntimeRef.current.plannerAbort = null;
    setPlannerBusy(false);
    setAwaitingUser(false);
    beginSessionTracking();
    disposeEngine();
    proactiveInventoryTaskIssuedRef.current = false;

    const runner = runnerRef.current;
    if (!runner) {
      void finalizeSessionTracking("stopped:runner_unavailable");
      return;
    }
    const engine = new StepEngine(
      MILESTONE4_STEPS,
      {
        start: (checkType) => runner.start(checkType),
        stop: () => runner.stop(),
        onEvent: (handler) => runner.events().on(handler),
      },
      { autoTickMs: 1000, pacing: pacingRef.current },
    );
    engineRef.current = engine;
    engine.onEvent((event) => {
      handleEngineEvent(event);
    });
    engine.start();
  }

  function startSession() {
    if (mode === "dynamic") {
      void startDynamicSession();
      return;
    }
    startScriptedSession();
  }

  function stopSession() {
    if (
      mode === "dynamic" &&
      (dynamicRuntimeRef.current.active || dynamicRuntimeRef.current.warming)
    ) {
      stopDynamicSession("Session stopped by user.");
      return;
    }
    engineRef.current?.stop("Session stopped by user.");
  }

  function pauseSession() {
    engineRef.current?.pause();
  }

  function manualContinue() {
    engineRef.current?.manualContinue();
  }

  async function startCamera() {
    setMessage(null);
    const running = (await cameraPanelRef.current?.startCamera()) === true;
    if (!running) {
      setMessage("Camera is still warming. Click Enable Camera if permission is blocked.");
    }
  }

  function clearSttRestartTimer() {
    if (sttRestartTimerRef.current !== null) {
      window.clearTimeout(sttRestartTimerRef.current);
      sttRestartTimerRef.current = null;
    }
  }

  function isDuplicateVoiceTranscript(text: string): boolean {
    const normalized = normalizeTranscript(text);
    if (!normalized) {
      return true;
    }
    const hash = hashTranscript(normalized);
    const last = lastSentTranscriptRef.current;
    if (!last) {
      return false;
    }
    return last.hash === hash && now() - last.ts <= STT_DUPLICATE_WINDOW_MS;
  }

  function markVoiceTranscriptSent(text: string) {
    const normalized = normalizeTranscript(text);
    lastSentTranscriptRef.current = {
      hash: hashTranscript(normalized),
      ts: now(),
      text: normalized,
    };
  }

  function canAutoSendVoiceTranscript(): { allow: boolean; reason: string | null } {
    if (!voiceAutoSend) {
      return { allow: false, reason: null };
    }
    const pending = pendingVerificationRef.current;
    if (verifyingStateRef.current !== "idle" && !(pending && pending.awaitingConfirmation)) {
      return {
        allow: false,
        reason: "Voice captured. Auto send is paused while camera verification is running.",
      };
    }
    if (pending && !pending.awaitingConfirmation) {
      return {
        allow: false,
        reason: "Voice captured. Auto send is paused until verification completes.",
      };
    }
    return { allow: true, reason: null };
  }

  function handleFinalTranscript(raw: string) {
    const transcript = raw.trim();
    if (!transcript) {
      return;
    }
    setUserDraft(transcript);
    if (transcript.length < voiceMinChars) {
      return;
    }
    if (isDuplicateVoiceTranscript(transcript)) {
      return;
    }

    if (!voiceAutoSend) {
      setMessage("Transcript ready. Press Save Response to send.");
      return;
    }

    const autoSendCheck = canAutoSendVoiceTranscript();
    if (!autoSendCheck.allow) {
      if (autoSendCheck.reason) {
        setMessage(autoSendCheck.reason);
      }
      return;
    }

    if (voiceAutoSend) {
      void acceptUserResponse(transcript);
      setUserDraft("");
      markVoiceTranscriptSent(transcript);
      setMessage(null);
      return;
    }
  }

  function stopMicRecognition(notice?: string) {
    micEnabledRef.current = false;
    sttManualStopRef.current = true;
    clearSttRestartTimer();
    sttRestartAttemptsRef.current = 0;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // ignore stop errors when recognition is already closed
      }
    }
    setSttListening(false);
    setMicEnabled(false);
    if (notice) {
      setMessage(notice);
    }
  }

  function scheduleMicRestart(reason: string) {
    if (!micEnabledRef.current) {
      return;
    }
    clearSttRestartTimer();
    sttRestartAttemptsRef.current += 1;
    if (sttRestartAttemptsRef.current > STT_MAX_RESTARTS) {
      stopMicRecognition("Microphone stopped after repeated speech recognition errors.");
      return;
    }
    const delay = Math.min(
      STT_BASE_RESTART_MS * Math.pow(2, sttRestartAttemptsRef.current - 1),
      8000,
    );
    pushFeed({
      timestamp: now(),
      label: "mic.restart.scheduled",
      detail: `${reason} retry=${sttRestartAttemptsRef.current} delay=${delay}ms`,
    });
    sttRestartTimerRef.current = window.setTimeout(() => {
      sttRestartTimerRef.current = null;
      if (micEnabledRef.current) {
        startMicRecognition();
      }
    }, delay);
  }

  function startMicRecognition() {
    if (!micEnabledRef.current) {
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      stopMicRecognition("Speech recognition is unavailable in this browser.");
      return;
    }

    const recognition = new Ctor();
    let restartScheduled = false;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const startIndex = event.resultIndex ?? 0;
      for (let i = startIndex; i < event.results.length; i += 1) {
        const item = event.results[i];
        const transcript = item?.[0]?.transcript ?? "";
        if (!transcript.trim()) {
          continue;
        }
        if (item?.isFinal === false) {
          continue;
        }
        handleFinalTranscript(transcript);
      }
      sttRestartAttemptsRef.current = 0;
    };
    recognition.onerror = (event) => {
      const errorCode = event.error ?? "unknown";
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        restartScheduled = true;
        stopMicRecognition("Microphone permission denied. Mic remains off.");
        return;
      }

      setSttListening(false);
      recognitionRef.current = null;
      if (!restartScheduled) {
        restartScheduled = true;
        scheduleMicRestart(`error:${errorCode}`);
      }
    };
    recognition.onend = () => {
      setSttListening(false);
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      if (!micEnabledRef.current || sttManualStopRef.current) {
        return;
      }
      if (!restartScheduled) {
        restartScheduled = true;
        scheduleMicRestart("ended");
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setSttListening(true);
      setMessage(null);
    } catch (error) {
      recognitionRef.current = null;
      setSttListening(false);
      scheduleMicRestart(error instanceof Error ? error.message : "start_failed");
    }
  }

  function setMicMode(enabled: boolean) {
    if (enabled) {
      if (!sttAvailableRef.current) {
        setMessage("Speech recognition is unavailable in this browser.");
        return;
      }
      micEnabledRef.current = true;
      sttManualStopRef.current = false;
      sttRestartAttemptsRef.current = 0;
      clearSttRestartTimer();
      setMicEnabled(true);
      startMicRecognition();
      return;
    }
    stopMicRecognition();
  }

  function toggleMicMode() {
    setMicMode(!micEnabledRef.current);
  }

  function reloadSavedSessionInventory() {
    if (typeof window === "undefined") {
      return;
    }
    setSessionInventory(loadSessionInventoryFromStorage(window.localStorage));
    setMessage("Session inventory reloaded.");
  }

  function submitUserInput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = userDraft.trim();
    if (!text) {
      return;
    }
    void acceptUserResponse(text);
    setUserDraft("");
  }

  function simulateStateEvent(event: MoodEventType) {
    if (event === "session_start") {
      beginSessionTracking();
      return;
    }
    if (event === "session_end") {
      void finalizeSessionTracking("debug.simulated");
      return;
    }

    if (sessionMetricsRef.current.active) {
      if (event === "verification_pass") {
        sessionMetricsRef.current.verificationPasses += 1;
        sessionMetricsRef.current.streakCurrent += 1;
        sessionMetricsRef.current.streakMax = Math.max(
          sessionMetricsRef.current.streakMax,
          sessionMetricsRef.current.streakCurrent,
        );
      } else if (event === "verification_fail") {
        sessionMetricsRef.current.verificationFails += 1;
        sessionMetricsRef.current.streakCurrent = 0;
      } else if (event === "verification_inconclusive") {
        sessionMetricsRef.current.verificationInconclusive += 1;
        sessionMetricsRef.current.streakCurrent = 0;
      } else if (event === "user_refusal") {
        sessionMetricsRef.current.refusalCount += 1;
      } else if (event === "user_answered" || event === "user_ack" || event === "user_question") {
        sessionMetricsRef.current.totalTurns += 1;
      }
    }
    applySessionEvent(event, "debug.simulated");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettings(loadSettingsFromStorage(window.localStorage));
      setConsent(loadConsentFromStorage(window.localStorage));
      void refreshMemorySummary().catch(() => undefined);
      setSttAvailable(getSpeechRecognitionCtor() !== null);
      setDebugMode(window.localStorage.getItem(SESSION_DEBUG_STORAGE_KEY) === "1");
      setVisionDebugMode(window.localStorage.getItem(VISION_DEBUG_STORAGE_KEY) === "1");
      const optInEnabled = window.localStorage.getItem(DEVICE_OPT_IN_STORAGE_KEY) === "1";
      deviceOptInRef.current = optInEnabled;
      setDeviceOptIn(optInEnabled);
      sessionTestHooksEnabledRef.current =
        process.env.NODE_ENV !== "production" &&
        window.localStorage.getItem(SESSION_TEST_HOOK_STORAGE_KEY) === "1";
      let parsedResume: unknown = null;
      let parsedReview: unknown = null;
      try {
        parsedResume = JSON.parse(
          window.localStorage.getItem(SESSION_RESUME_STORAGE_KEY) ?? "null",
        );
      } catch {
        parsedResume = null;
      }
      try {
        parsedReview = JSON.parse(
          window.localStorage.getItem(SESSION_REVIEW_STORAGE_KEY) ?? "null",
        );
      } catch {
        parsedReview = null;
      }
      const savedResume = sanitizeSessionResumeSnapshot(parsedResume);
      setSavedSessionSnapshot(hasResumableSessionSnapshot(savedResume) ? savedResume : null);
      const savedReview = sanitizeSessionReviewSnapshot(parsedReview);
      setSessionReviewSnapshot(savedReview);
      if (savedReview) {
        setLastSessionMetrics(savedReview.metrics);
      }
      let parsedConversationState: unknown = null;
      try {
        parsedConversationState = JSON.parse(
          window.localStorage.getItem(CONVERSATION_STATE_STORAGE_KEY) ?? "null",
        );
      } catch {
        parsedConversationState = null;
      }
      if (parsedConversationState) {
        const restoredConversationState =
          normalizeConversationStateSnapshot(parsedConversationState);
        turnGateRef.current = {
          ...turnGateRef.current,
          sessionId: restoredConversationState.session_id || turnGateRef.current.sessionId,
        };
        syncConversationState(restoredConversationState);
      } else {
        syncConversationState(createConversationStateSnapshot(turnGateRef.current.sessionId));
      }
      void refreshDevicesPanel().catch(() => undefined);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshDevicesPanel]);

  useEffect(() => {
    if (!debugMode) {
      return;
    }
    void refreshMemoryDebug().catch(() => undefined);
    void refreshPromptDebug().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshMemoryDebug().catch(() => undefined);
      void refreshPromptDebug().catch(() => undefined);
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [debugMode]);

  useEffect(() => {
    window.localStorage.setItem(SESSION_DEBUG_STORAGE_KEY, debugMode ? "1" : "0");
  }, [debugMode]);

  useEffect(() => {
    window.localStorage.setItem(VISION_DEBUG_STORAGE_KEY, visionDebugMode ? "1" : "0");
  }, [visionDebugMode]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const loadedSessionInventory = loadSessionInventoryFromStorage(window.localStorage);
    setSessionInventory(loadedSessionInventory);
    sessionInventoryStorageReadyRef.current = true;
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      CONVERSATION_STATE_STORAGE_KEY,
      JSON.stringify(conversationDebugState),
    );
  }, [conversationDebugState]);

  useEffect(() => {
    if (!sessionInventoryStorageReadyRef.current) {
      return;
    }
    saveSessionInventoryToStorage(window.localStorage, sessionInventory);
  }, [sessionInventory]);

  useEffect(() => {
    deviceOptInRef.current = deviceOptIn;
    window.localStorage.setItem(DEVICE_OPT_IN_STORAGE_KEY, deviceOptIn ? "1" : "0");
  }, [deviceOptIn]);

  useEffect(() => {
    if (!devicePanelOpen) {
      return;
    }

    void refreshDevicesPanel().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshDevicesPanel().catch(() => undefined);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [devicePanelOpen, refreshDevicesPanel]);

  useEffect(() => {
    void refreshTasks().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshTasks().catch(() => undefined);
    }, 9000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshMemorySummary().catch(() => undefined);
    }, 7000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    awaitingUserRef.current = awaitingUser;
  }, [awaitingUser]);

  useEffect(() => {
    sttAvailableRef.current = sttAvailable;
  }, [sttAvailable]);

  useEffect(() => {
    setMicModeRef.current = setMicMode;
  });

  useEffect(() => {
    verifyingStateRef.current = verifyingState;
  }, [verifyingState]);

  useEffect(() => {
    runnerRef.current?.setObjectOverlayEnabled(objectOverlay);
  }, [objectOverlay]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? "";
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable === true;
      if (event.key === "Escape") {
        if (micEnabledRef.current) {
          event.preventDefault();
          setMicModeRef.current(false);
        }
        return;
      }
      if (isTyping) {
        return;
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setMicModeRef.current(!micEnabledRef.current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    void fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile?: unknown }>)
      .then((body) => {
        const normalized = normalizeProfileInput(body.profile);
        profileMemoryRef.current = normalized;
        syncAdaptivePacing(normalized);
        refreshMoodAndPolicy(now());
      })
      .catch(() => {
        // keep empty profile memory fallback
      });
  }, []);

  useEffect(() => {
    syncAdaptivePacing();
  }, [settings.pace]);

  useEffect(() => {
    void fetch("/api/relationship")
      .then((response) => response.json() as Promise<{ relationship?: unknown }>)
      .then((body) => {
        const normalized = normalizeRelationshipState(
          body.relationship as Partial<RelationshipState>,
          now(),
        );
        relationshipRef.current = normalized;
        setRelationshipState(normalized);
        refreshMoodAndPolicy(now());
      })
      .catch(() => {
        // keep default relationship fallback
      });
  }, []);

  function handleCameraEvent(event: CameraEvent) {
    publishRuntimeEvent({ type: "camera.event", timestamp: now(), event });
    pushFeed(toFeedFromCamera(event));

    if (event.type === "camera.started") {
      cameraRunningRef.current = true;
      setCameraRunning(true);
    }
    if (event.type === "camera.stopped") {
      cameraRunningRef.current = false;
      setCameraRunning(false);
      latestObservationRef.current = null;
      setLatestObservation(null);
    }

    const metrics = summarizeUpdate(event);
    if (metrics) {
      lastCheckMetricsRef.current = metrics;
    }

    if (event.type === "check.completed") {
      lastCheckSummaryRef.current = summarizeCheckResult(
        event.checkType,
        event.status,
        lastCheckMetricsRef.current,
      );
      if (!sessionMetricsRef.current.active) {
        return;
      }
      if (event.status === "passed") {
        if (sessionMetricsRef.current.active) {
          sessionMetricsRef.current.verificationPasses += 1;
          sessionMetricsRef.current.streakCurrent += 1;
          sessionMetricsRef.current.streakMax = Math.max(
            sessionMetricsRef.current.streakMax,
            sessionMetricsRef.current.streakCurrent,
          );
        }
        applySessionEvent("verification_pass", `${event.checkType}:passed`);
      } else if (event.status === "failed") {
        if (sessionMetricsRef.current.active) {
          sessionMetricsRef.current.verificationFails += 1;
          sessionMetricsRef.current.streakCurrent = 0;
        }
        applySessionEvent("verification_fail", `${event.checkType}:failed`);
      } else {
        if (sessionMetricsRef.current.active) {
          sessionMetricsRef.current.verificationInconclusive += 1;
          sessionMetricsRef.current.streakCurrent = 0;
        }
        applySessionEvent("verification_inconclusive", `${event.checkType}:timeout`);
      }
    }

    if (event.type === "diagnostics.update") {
      diagnosticsRef.current = event.diagnostics;
      setDiagnostics(event.diagnostics);
      if (event.diagnostics.facesDetected > 0) {
        const trackedAt = now();
        lastFaceSeenAtRef.current = trackedAt;
        lastTrackedAtRef.current = trackedAt;
        trackingEverAcquiredRef.current = true;
        setTrackingEverAcquired(true);
        trackingStatusRef.current = "tracked";
        setTrackingStatus("tracked");
      } else {
        trackingStatusRef.current = "lost";
        setTrackingStatus("lost");
      }
    }

    if (event.type === "observation.update") {
      latestObservationRef.current = event.observation;
      setLatestObservation(event.observation);
    }

    if (
      event.type === "camera.started" ||
      event.type === "camera.stopped" ||
      event.type === "diagnostics.update" ||
      event.type === "observation.update" ||
      event.type === "vision.error"
    ) {
      refreshVisionCatalogFromRunner(runnerRef.current);
    }
  }

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      micEnabledRef.current = false;
      sttManualStopRef.current = true;
      clearSttRestartTimer();
      sttRestartAttemptsRef.current = 0;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      disposeEngine();
      runnerRef.current?.stopCamera();
      runnerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (stopLoading || !stopped) {
      return;
    }

    const timer = window.setTimeout(() => {
      void stopAllDevices();
      if (micEnabledRef.current) {
        setMicModeRef.current(false);
      }
      if (dynamicRuntimeRef.current.active || dynamicRuntimeRef.current.warming) {
        stopDynamicSession("Emergency stop engaged. Session stopped.");
        return;
      }

      if (engineRef.current && isSessionActive(engineRef.current.getState())) {
        engineRef.current.stop("Emergency stop engaged. Session stopped.");
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [stopped, stopAllDevices, stopLoading, stopDynamicSession]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!dynamicRuntimeRef.current.active) {
        return;
      }

      if (!trackingEverAcquiredRef.current) {
        setMessage("Waiting to acquire tracking. Keep your face in frame.");
        return;
      }

      const lost = shouldStopForTrackingLost({
        trackingEverAcquired: trackingEverAcquiredRef.current,
        lastTrackedAtMs: lastTrackedAtRef.current,
        nowMs: now(),
        lostThresholdMs: TRACKING_LOST_STOP_MS,
      });
      if (lost) {
        stopDynamicSession("Tracking lost for more than 5 minutes. Session stopped.");
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [stopDynamicSession]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!sessionTestHooksEnabledRef.current) {
        return;
      }
      const pendingTurn = pendingUserTurnRef.current;
      if (!pendingTurn) {
        return;
      }
      if (dynamicRuntimeRef.current.active || dynamicRuntimeRef.current.warming) {
        return;
      }
      if (pendingTurn.messageId <= lastHandledUserMessageIdRef.current) {
        return;
      }
      if (now() - pendingTurn.acceptedAtMs >= 1500) {
        const activeRequestId = inFlightTurnRequestRef.current.get(pendingTurn.messageId);
        if (activeRequestId === pendingTurn.requestId) {
          if (forceIdlePendingTurnRecovery(pendingTurn, "watchdog_timeout_recovered")) {
            return;
          }
        }
      }
      void runTestHookPendingTurn();
    }, 150);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="panel">
      <h1>Autopilot Session</h1>
      <p className="muted">
        Scripted mode runs the fixed 3-step flow. Dynamic mode alternates talk, checks, and
        listening with pacing.
      </p>

      <div className="card">
        <label className="field">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(event) => {
              const nextMode = event.target.value === "dynamic" ? "dynamic" : "scripted";
              if (isSessionActive(sessionState) || dynamicRuntimeRef.current.active) {
                stopSession();
              }
              setMode(nextMode);
            }}
          >
            <option value="scripted">Scripted</option>
            <option value="dynamic">Dynamic</option>
          </select>
        </label>
      </div>

      <div className="camera-layout">
        <div className="camera-preview-panel">
          <CameraPanel
            ref={cameraPanelRef}
            onRunnerChange={(runner) => {
              runnerRef.current = runner;
              runner?.setObservationFps(2);
              runner?.setFaceCueFps(5);
              runner?.setObjectFps(2);
              runner?.setObjectOverlayEnabled(objectOverlay);
              const running = runner?.currentState().cameraRunning === true;
              cameraRunningRef.current = running;
              setCameraRunning(running);
              refreshVisionCatalogFromRunner(runner);
            }}
            onCameraEvent={handleCameraEvent}
          />
          <div className="camera-controls">
            <button className="button" type="button" onClick={startSession}>
              Start Session
            </button>
            <button className="button button-secondary" type="button" onClick={pauseSession}>
              Pause
            </button>
            <button className="button button-secondary" type="button" onClick={stopSession}>
              Stop
            </button>
            <button className="button" type="button" onClick={manualContinue}>
              Manual Continue
            </button>
          </div>
          <div className="camera-controls">
            <button className="button" type="button" onClick={() => void startCamera()}>
              {cameraRunning ? "Camera Ready" : "Start Camera"}
            </button>
            {!cameraRunning ? <Link href="/camera">Open Camera Page</Link> : null}
            {!consentReady ? <Link href="/consent">Complete Consent</Link> : null}
          </div>
        </div>

        <div className="card">
          <h2>Current Step</h2>
          <p>Mode: {mode}</p>
          <p>Name: {currentStepId}</p>
          <p>Status: {sessionState}</p>
          <p>
            Waiting State:{" "}
            {sessionState === "waiting_for_user"
              ? "waiting_for_user"
              : sessionState === "waiting_for_check"
                ? "waiting_for_check"
                : "n/a"}
          </p>
          <p>Countdown: {countdown}s</p>
          <p>Tracking: {trackingStatus}</p>
          <p>Tracking ever acquired: {trackingEverAcquired ? "yes" : "no"}</p>
          <p>Session phase: {sessionPhase}</p>
          <p>Mood: {moodSnapshot.mood_label}</p>
          <p>Relationship: {relationshipState.relationship_label}</p>
          <p>Tone policy: {tonePolicyText}</p>
          <p>Last user intent: {lastUserIntent}</p>
          <p>Dialogue act: {lastDialogueAct}</p>
          <p>Scene topic: {sceneStateRef.current.topic_type}</p>
          <p>Scene locked: {sceneStateRef.current.topic_locked ? "yes" : "no"}</p>
          <p>Leverage: {buildLeverageSummary(sceneStateRef.current)}</p>
          <p>Progress summary: {progressSummaryLines[0] ?? "no progress yet."}</p>
          <p>Deterministic task state: {deterministicTaskProgressLabel}</p>
          {progressSummaryLines[1] ? <p>Latest outcome: {progressSummaryLines[1]}</p> : null}
          {deterministicTaskTimer ? (
            <>
              <p>
                Task timer: {formatDurationSeconds(deterministicTaskTimer.totalRemainingSeconds)}
              </p>
              {deterministicTaskTimer.phaseLabel === "halfway_due" ||
              deterministicTaskTimer.phaseLabel === "halfway_overdue" ? (
                <p>
                  Halfway due in:{" "}
                  {formatDurationSeconds(deterministicTaskTimer.halfwayRemainingSeconds)}
                </p>
              ) : null}
              {deterministicTaskTimer.phaseLabel === "completion_due" ||
              deterministicTaskTimer.phaseLabel === "completion_due_now" ? (
                <p>
                  Full completion due in:{" "}
                  {formatDurationSeconds(deterministicTaskTimer.totalRemainingSeconds)}
                </p>
              ) : null}
            </>
          ) : null}
          <p>Stakes: {sceneStateRef.current.stakes || "none"}</p>
          <p>Win condition: {sceneStateRef.current.win_condition || "none"}</p>
          <p>Lose condition: {sceneStateRef.current.lose_condition || "none"}</p>
          <p>Commitment: {commitmentRef.current.type}</p>
          <p>Commitment locked: {commitmentRef.current.locked ? "yes" : "no"}</p>
          <p>Commitment detail: {commitmentRef.current.detail}</p>
          <p>Dynamic progress: {statusSummary}</p>
          <p>awaiting_user: {awaitingUser ? "true" : "false"}</p>
          <p>last_user_message_id: {lastUserMessageId}</p>
          <p>last_assistant_turn_id: {lastEmittedTurnId}</p>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(event) => setDebugMode(event.target.checked)}
            />
            <span>Session debug mode</span>
          </label>
          {debugMode ? (
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={showTurnLog}
                onChange={(event) => setShowTurnLog(event.target.checked)}
              />
              <span>Show turn log</span>
            </label>
          ) : null}
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={visionDebugMode}
              onChange={(event) => setVisionDebugMode(event.target.checked)}
            />
            <span>Vision debug panel</span>
          </label>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={objectOverlay}
              onChange={(event) => setObjectOverlay(event.target.checked)}
            />
            <span>Object boxes overlay</span>
          </label>
          <p>Planner: {plannerBusy ? "planning..." : "idle"}</p>
          <p>Verifying: {verifyingState}</p>
          {verifySummary ? <p>Verify summary: {verifySummary}</p> : null}
          <p>Warmup: {warmingUp ? `Warming up camera... (${warmupPhase})` : "idle"}</p>
          {warmingUp ? (
            <p>
              facesDetected={diagnostics.facesDetected} | lastInferenceMs=
              {diagnostics.lastInferenceMs.toFixed(1)}
            </p>
          ) : null}
          <p>User replied: {userReplied ? "yes" : "no"}</p>
          <p>Memory pending: {memoryPendingCount}</p>
          <p>Memory auto save: {memoryAutoSave ? "on" : "off"}</p>
          {memoryPreferences.suggestion_snooze_until ? (
            <p className="muted">
              Suggestions snoozed until{" "}
              {new Date(memoryPreferences.suggestion_snooze_until).toLocaleString()}
            </p>
          ) : null}
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={memoryAutoSave}
              onChange={(event) => {
                const next = event.target.checked;
                setMemoryAutoSave(next);
                void setMemoryAutoSavePreference(next);
              }}
            />
            <span>Auto approve memory suggestions</span>
          </label>
          <div className="camera-controls">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void refreshMemorySummary().catch(() => undefined)}
            >
              Refresh Memory Panel
            </button>
            <Link href="/profile">Open Memory Panel</Link>
          </div>
          {message ? <p className="error-text">{message}</p> : null}
        </div>

        <div className="card">
          <h2>Session Review</h2>
          {sessionReviewLines.length === 0 ? (
            <p className="muted">No completed session review yet.</p>
          ) : (
            <>
              {sessionReviewSnapshot?.savedAt ? (
                <p className="muted">
                  Saved {new Date(sessionReviewSnapshot.savedAt).toLocaleString()}
                </p>
              ) : null}
              {sessionReviewLines.map((line, index) => (
                <p key={`session-review-${index}`}>{line}</p>
              ))}
            </>
          )}
          <h3>Resume</h3>
          {savedSessionSnapshot ? (
            <>
              <p className="muted">
                Saved {new Date(savedSessionSnapshot.savedAt).toLocaleString()}
              </p>
              <p>
                topic={savedSessionSnapshot.sceneState.topic_type} locked=
                {savedSessionSnapshot.sceneState.topic_locked ? "yes" : "no"}
              </p>
              <p>
                task_progress={savedSessionSnapshot.sceneState.task_progress} game_progress=
                {savedSessionSnapshot.sceneState.game_progress}
              </p>
              <div className="camera-controls">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={resumeSavedSessionRuntime}
                >
                  Resume Saved State
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={clearSavedSessionRuntime}
                >
                  Clear Saved State
                </button>
              </div>
            </>
          ) : (
            <p className="muted">No resumable session state saved.</p>
          )}
        </div>

        <div className="card">
          <h2>Session Inventory</h2>
          <p className="muted">
            Saved locally and reused across sessions. Manage the full list on the inventory page.
          </p>
          <div className="status-strip">
            <div className="status-pill">
              <strong>{sessionInventory.length}</strong>
              <span>Items listed</span>
            </div>
            <div className="status-pill">
              <strong>{inventoryAvailableCount}</strong>
              <span>Available this session</span>
            </div>
            <div className="status-pill">
              <strong>{inventoryIntifaceCount}</strong>
              <span>Intiface-ready</span>
            </div>
            <div className="status-pill">
              <strong>{inventoryClarificationCount}</strong>
              <span>Needs detail</span>
            </div>
          </div>
          <div className="camera-controls">
            <Link className="button button-secondary" href="/inventory">
              Manage Inventory
            </Link>
            <button
              className="button button-secondary"
              type="button"
              onClick={reloadSavedSessionInventory}
            >
              Reload Saved Items
            </button>
          </div>
          {sessionInventory.length === 0 ? (
            <p className="muted">No saved items yet. Add them on the inventory page.</p>
          ) : (
            <div className="compact-grid">
              {sessionInventory.slice(0, 4).map((item) => (
                <div key={item.id} className="task-card">
                  <div className="status-strip">
                    <div className="status-pill">
                      <strong>{getSessionInventoryDisplayName(item)}</strong>
                      <span>{item.category}</span>
                    </div>
                    <div className="status-pill">
                      <strong>{item.available_this_session ? "Available" : "Unavailable"}</strong>
                      <span>
                        {item.intiface_controlled ? "Intiface capable" : "Manual use only"}
                      </span>
                    </div>
                    <div className="status-pill">
                      <strong>
                        {needsInventoryClarification(item) ? "Needs detail" : "Clear enough"}
                      </strong>
                      <span>
                        {needsInventoryClarification(item)
                          ? "Raven will ask first"
                          : "Raven can use it directly"}
                      </span>
                    </div>
                  </div>
                  {item.notes ? <p className="muted">{item.notes}</p> : null}
                </div>
              ))}
            </div>
          )}
          {sessionInventory.length > 4 ? (
            <p className="muted">
              Showing 4 of {sessionInventory.length} saved items. Open the inventory page for the
              full list.
            </p>
          ) : null}
        </div>

        <div className="card">
          <h2>Devices</h2>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={devicePanelOpen}
              onChange={(event) => setDevicePanelOpen(event.target.checked)}
            />
            <span>Show devices panel</span>
          </label>
          {devicePanelOpen ? (
            <>
              <p>Connected: {deviceStatus.connected ? "yes" : "no"}</p>
              <p>Scanning: {deviceStatus.scanning ? "yes" : "no"}</p>
              <p>Device count: {deviceStatus.device_count}</p>
              <p>URL: {deviceStatus.url}</p>
              {deviceStatus.last_error ? (
                <p className="error-text">Last error: {deviceStatus.last_error}</p>
              ) : null}
              <div className="camera-controls">
                <button
                  className="button"
                  type="button"
                  disabled={deviceBusy}
                  onClick={() =>
                    void (deviceStatus.connected ? disconnectDevices() : connectDevices())
                  }
                >
                  {deviceStatus.connected ? "Disconnect" : "Connect"}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={deviceBusy}
                  onClick={() => void refreshDevicesPanel()}
                >
                  Refresh
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={deviceBusy || !deviceStatus.connected}
                  onClick={() => void stopAllDevices()}
                >
                  Stop All
                </button>
              </div>
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={deviceOptIn}
                  onChange={(event) => setDeviceOptIn(event.target.checked)}
                />
                <span>Allow Raven device action execution</span>
              </label>
              <p className="muted">
                Commands execute only when opt-in is enabled and Emergency Stop is off.
              </p>
              {devices.length === 0 ? (
                <p className="muted">No devices discovered yet.</p>
              ) : (
                <div className="debug-console">
                  {devices.map((device) => (
                    <div key={device.device_id} className="debug-line">
                      <p>
                        {device.name} ({device.device_id}) | vibrate=
                        {device.capabilities.vibrate ? "yes" : "no"} rotate=
                        {device.capabilities.rotate ? "yes" : "no"} linear=
                        {device.capabilities.linear ? "yes" : "no"}
                      </p>
                      {device.capabilities.vibrate ? (
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={deviceBusy}
                          onClick={() => void testDeviceVibrate(device.device_id)}
                        >
                          Test vibrate 1s
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {lastDeviceExecutionSummary ? (
                <p className="muted">Last execution: {lastDeviceExecutionSummary}</p>
              ) : null}
            </>
          ) : (
            <p className="muted">Hidden. Enable to connect and inspect Intiface devices.</p>
          )}
        </div>

        <div className="card">
          <h2>Tasks and Progress</h2>
          <p className="muted">
            Keep live interaction here. Use dedicated pages for homework management and evidence
            review.
          </p>
          <div className="camera-controls">
            <Link className="button button-secondary" href="/tasks">
              Open Tasks Page
            </Link>
            <Link className="button button-secondary" href="/review">
              Open Review Page
            </Link>
          </div>
          <div className="status-strip">
            <div className="status-pill">
              <strong>{taskBoardSummary.active}</strong>
              <span>Active</span>
            </div>
            <div className="status-pill">
              <strong>{taskBoardSummary.pendingReview}</strong>
              <span>Pending review</span>
            </div>
            <div className="status-pill">
              <strong>{taskBoardSummary.awaitingSubmission}</strong>
              <span>Awaiting proof</span>
            </div>
            <div className="status-pill">
              <strong>{taskBoardSummary.retryNeeded}</strong>
              <span>Retry needed</span>
            </div>
            <div className="status-pill">
              <strong>{deterministicTaskProgressLabel}</strong>
              <span>Deterministic state</span>
            </div>
            <div className="status-pill">
              <strong>{deterministicTaskBound?.title ?? "None"}</strong>
              <span>Bound task</span>
            </div>
          </div>
          {deterministicTaskTimer ? (
            <p className="muted">
              Active timer: {formatDurationSeconds(deterministicTaskTimer.totalRemainingSeconds)}
            </p>
          ) : null}
          <div className="camera-controls">
            <button
              className="button button-secondary"
              type="button"
              disabled={taskBusy}
              onClick={() => void refreshTasks().catch(() => undefined)}
            >
              Refresh Tasks
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={taskBusy}
              onClick={() => void maybeHandleTaskEvidenceOnUserMessage("done")}
            >
              Count Current Repeat
            </button>
          </div>
          <p className="muted">
            Full creation, edits, and history moved to Tasks and Review pages.
          </p>
        </div>

        <div className="card">
          <h2>Evidence Review</h2>
          <p className="muted">
            Review queue lives on its own page. Keep this inline view disabled unless you need it
            during a live run.
          </p>
          <div className="camera-controls">
            <Link className="button button-secondary" href="/review">
              Open Review Page
            </Link>
          </div>
          <div className="status-strip">
            <div className="status-pill">
              <strong>{taskReviewBuckets.pendingReview.length}</strong>
              <span>Pending review</span>
            </div>
            <div className="status-pill">
              <strong>{taskReviewBuckets.needsRetry.length}</strong>
              <span>Retry needed</span>
            </div>
            <div className="status-pill">
              <strong>{taskReviewBuckets.awaitingSubmission.length}</strong>
              <span>Awaiting proof</span>
            </div>
          </div>
          <p className="muted">
            Review details and approvals moved out of session. Use the Review page to process queue
            items.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>User Response</h2>
        <form className="chat-form" onSubmit={submitUserInput}>
          <input
            value={userDraft}
            onChange={(event) => setUserDraft(event.target.value)}
            placeholder="Type a response for dynamic planning..."
          />
          <p className="muted">
            Mic: {micEnabled ? (sttListening ? "Listening" : "Enabled (reconnecting)") : "Mic off"}
          </p>
          <div className="camera-controls">
            <button className="button" type="submit">
              Save Response
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={toggleMicMode}
              disabled={!sttAvailable && !micEnabled}
            >
              {micEnabled ? "[mic] Disable Microphone" : "[mic] Enable Microphone"}
            </button>
          </div>
        </form>
        {!sttAvailable ? (
          <p className="muted">Microphone unavailable in this browser. Typing still works.</p>
        ) : null}
        <p className="muted">Shortcuts: M toggles mic, Escape turns mic off.</p>
        <p className="muted">
          Voice auto send: {voiceAutoSend ? `on (min ${voiceMinChars} chars)` : "off"}
        </p>
        <p className="muted">Last response: {lastUserResponse ?? "none"}</p>
      </div>

      <div className="card">
        <h2>Raven Output</h2>
        <div className="debug-console">
          {ravenLines.length === 0 ? <p className="muted">No output yet.</p> : null}
          {[...ravenLines].reverse().map((line, index) => (
            <p key={`${line}-${index}`} className="debug-line">
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Session Memory</h2>
        <pre className="debug-console">{sessionMemorySummary}</pre>
      </div>

      {debugMode && showTurnLog ? (
        <div className="card">
          <h2>Session Turn Log</h2>
          <div className="debug-console">
            {sessionTurnLog.length === 0 ? <p className="muted">No turn log yet.</p> : null}
            {sessionTurnLog.map((entry) => (
              <div key={entry.turnId} className="debug-line">
                <p>turn_id: {entry.turnId}</p>
                <p>user_message_id: {entry.sourceUserMessageId}</p>
                <p>created_at: {new Date(entry.createdAt).toLocaleTimeString()}</p>
                <p>conversation_mode: {entry.conversationMode ?? "none"}</p>
                <p>user_text: {entry.userText || "none"}</p>
                <p>raven_output: {entry.ravenOutputText || "none yet"}</p>
                <p>assistant_render_count: {entry.assistantRenderAppendEvents}</p>
                <p>append_runs: {entry.appendRavenOutputRunsForTurn}</p>
                <p>
                  recovery_render_fired:{" "}
                  {entry.recoverSkippedAssistantRenderFired ? "yes" : "no"}
                </p>
                <p>visible_strings_shown: {entry.visibleAssistantStringsShownForTurn}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {debugMode ? (
        <div className="card">
          <h2>Mood and Relationship Debug</h2>
          <p>mood_score: {Math.round(moodSnapshot.mood_score)}</p>
          <p>mood_label: {moodSnapshot.mood_label}</p>
          <p>decay_adjusted_score: {Math.round(moodSnapshot.decay_adjusted_score)}</p>
          <p>compliance_streak: {moodSnapshot.compliance_streak}</p>
          <p>miss_streak: {moodSnapshot.miss_streak}</p>
          <p>last_event: {moodSnapshot.last_event}</p>
          <p>last_event_delta: {moodSnapshot.last_event_delta}</p>
          <p>relationship_label: {relationshipState.relationship_label}</p>
          <p>trust_score: {Math.round(relationshipState.trust_score)}</p>
          <p>rapport_score: {Math.round(relationshipState.rapport_score)}</p>
          <p>reliability_score: {Math.round(relationshipState.reliability_score)}</p>
          <p>difficulty_level: {difficultyLevel}</p>
          <p>policy: {tonePolicyText}</p>
          {lastSessionMetrics ? (
            <pre className="debug-console">{JSON.stringify(lastSessionMetrics, null, 2)}</pre>
          ) : (
            <p className="muted">No session_end metrics yet.</p>
          )}
          <h3>Memory Debug</h3>
          {memoryDebugError ? <p className="error-text">{memoryDebugError}</p> : null}
          {memoryDebugState ? (
            <div className="debug-console">
              <p className="debug-line">
                extracted_candidates={memoryDebugState.extractedCandidates.length} pending=
                {memoryDebugState.pendingSuggestions.length} retrieved=
                {memoryDebugState.retrievedMemories.length}
              </p>
              {memoryDebugState.extractedCandidates.slice(0, 6).map((candidate, index) => (
                <p key={`${candidate.key}-${index}`} className="debug-line">
                  candidate {candidate.key}: {candidate.value} importance=
                  {candidate.importance.toFixed(2)} stability={candidate.stability.toFixed(2)}{" "}
                  confidence=
                  {candidate.confidence.toFixed(2)} rationale={candidate.rationale}
                </p>
              ))}
              <pre className="debug-line">{memoryDebugState.injectedMemoryBlock}</pre>
            </div>
          ) : (
            <p className="muted">No memory debug data yet.</p>
          )}
          <h3>Immersion Debug</h3>
          {immersionDebugState ? (
            <div className="debug-console">
              <p className="debug-line">
                updated={new Date(immersionDebugState.timestamp).toLocaleTimeString()} act=
                {immersionDebugState.dialogueAct} phase={immersionDebugState.sessionPhase}
              </p>
              <p className="debug-line">
                playbooks: {immersionDebugState.selectedPlaybooks.join(", ") || "none"}
              </p>
              <p className="debug-line">
                critic_reasons: {immersionDebugState.criticReasons.join(", ") || "none"}
              </p>
              <p className="debug-line">shape_reason: {immersionDebugState.shapeReason}</p>
              <p className="debug-line">noop_reason: {immersionDebugState.noopReason ?? "none"}</p>
            </div>
          ) : (
            <p className="muted">No immersion debug data yet.</p>
          )}
          <h3>Conversation Debug</h3>
          <pre className="debug-console">{buildConversationStateBlock(conversationDebugState)}</pre>
          <h3>Prompt Debug</h3>
          {promptDebugState ? (
            <div className="debug-console">
              <p className="debug-line">
                strategy={promptDebugState.responseStrategy} prompt_estimate=
                {promptDebugState.promptSizeEstimate}
              </p>
              <p className="debug-line">
                included_context: {promptDebugState.includedContext.join(", ")}
              </p>
              {promptDebugState.includedTurns.slice(0, 6).map((turn, index) => (
                <p key={`${turn.role}-${index}`} className="debug-line">
                  include {turn.role}: {turn.reason} :: {turn.content}
                </p>
              ))}
              {promptDebugState.excludedTurns.slice(0, 4).map((turn, index) => (
                <p key={`excluded-${turn.role}-${index}`} className="debug-line">
                  exclude {turn.role}: {turn.reason} :: {turn.content}
                </p>
              ))}
            </div>
          ) : (
            <p className="muted">No prompt debug data yet.</p>
          )}
          <div className="camera-controls">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("verification_pass")}
            >
              Sim verification_pass
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("verification_fail")}
            >
              Sim verification_fail
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("verification_inconclusive")}
            >
              Sim verification_inconclusive
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("user_ack")}
            >
              Sim user_ack
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("user_refusal")}
            >
              Sim user_refusal
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("user_answered")}
            >
              Sim user_answered
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("user_question")}
            >
              Sim user_question
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("idle_timeout")}
            >
              Sim idle_timeout
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("session_start")}
            >
              Sim session_start
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => simulateStateEvent("session_end")}
            >
              Sim session_end
            </button>
          </div>
        </div>
      ) : null}

      {visionDebugMode ? (
        <div className="card">
          <h2>Vision Debug</h2>
          <p>camera_available: {latestObservation?.camera_available ? "true" : "false"}</p>
          <p>inference_status: {latestObservation?.inference_status ?? "unavailable"}</p>
          <p>observation_fps: {latestObservation?.inference_fps?.toFixed(2) ?? "0.00"}</p>
          <p>last_inference_ms: {latestObservation?.last_inference_ms?.toFixed(1) ?? "0.0"}</p>
          <p>object_model: {latestObservation?.object_debug.model_name ?? "none"}</p>
          <p>object_input_resolution: {latestObservation?.object_debug.input_resolution ?? 0}</p>
          <p>raw_detections: {latestObservation?.object_debug.raw_count ?? 0}</p>
          <p>post_threshold: {latestObservation?.object_debug.post_threshold_count ?? 0}</p>
          <p>post_nms: {latestObservation?.object_debug.post_nms_count ?? 0}</p>
          <p>scene_objects_summary: {latestObservation?.scene_objects_summary ?? "I see: none"}</p>
          <p>scene_objects_change: {latestObservation?.scene_objects_change ?? "none"}</p>
          <p>face_present: {latestObservation?.face_present ? "true" : "false"}</p>
          <p>mouth_open: {latestObservation?.mouth_open ? "true" : "false"}</p>
          <p>mouth_open_ratio: {latestObservation?.mouth_open_ratio?.toFixed(3) ?? "0.000"}</p>
          <p>smile_score: {latestObservation?.smile_score?.toFixed(2) ?? "0.00"}</p>
          <p>brow_furrow_score: {latestObservation?.brow_furrow_score?.toFixed(2) ?? "0.00"}</p>
          <p>
            eye_openness: L {latestObservation?.eye_openness_left?.toFixed(2) ?? "0.00"} / R{" "}
            {latestObservation?.eye_openness_right?.toFixed(2) ?? "0.00"}
          </p>
          <p>
            head_pose: yaw {latestObservation?.head_pose?.yaw?.toFixed(1) ?? "0.0"} pitch{" "}
            {latestObservation?.head_pose?.pitch?.toFixed(1) ?? "0.0"} roll{" "}
            {latestObservation?.head_pose?.roll?.toFixed(1) ?? "0.0"}
          </p>
          <p>gaze_direction: {latestObservation?.gaze_direction ?? "unknown"}</p>
          <p>face_fps: {latestObservation?.face_fps?.toFixed(2) ?? "0.00"}</p>
          {latestObservation?.objects_stable?.length ? (
            <pre className="debug-console">
              {JSON.stringify(latestObservation.objects_stable, null, 2)}
            </pre>
          ) : (
            <p className="muted">No stable objects yet.</p>
          )}
          <p>signals_available: {visionSignalsStatus.signals_available.join(", ") || "none"}</p>
          <h3>Detectors</h3>
          {visionSignalsStatus.detectors.length > 0 ? (
            <div className="debug-console">
              {visionSignalsStatus.detectors.map((detector) => (
                <p key={detector.detector_id} className="debug-line">
                  {detector.detector_id} enabled={detector.enabled ? "true" : "false"} healthy=
                  {detector.healthy ? "true" : "false"} last_run_ts=
                  {detector.last_run_ts ?? "none"} signals=
                  {detector.supported_signals.join(", ") || "none"}
                </p>
              ))}
            </div>
          ) : (
            <p className="muted">No detector status yet.</p>
          )}
          <h3>Capability Catalog</h3>
          {capabilityCatalog.length > 0 ? (
            <div className="debug-console">
              {capabilityCatalog.map((capability) => (
                <p key={capability.capability_id} className="debug-line">
                  {capability.capability_id} params=
                  {Object.entries(capability.parameters_schema)
                    .map(([key, schema]) => `${key}:${schema.type}`)
                    .join(", ") || "none"}{" "}
                  reliability=
                  {capability.estimated_reliability}
                </p>
              ))}
            </div>
          ) : (
            <p className="muted">No verification capabilities available.</p>
          )}
          <h3>Last Plan Validation</h3>
          {lastPlanRaw ? (
            <pre className="debug-console">{lastPlanRaw}</pre>
          ) : (
            <p className="muted">No planner output yet.</p>
          )}
          {lastPlanValidation ? (
            <pre className="debug-console">{JSON.stringify(lastPlanValidation, null, 2)}</pre>
          ) : (
            <p className="muted">No plan validation details yet.</p>
          )}
          <p>
            last_update:{" "}
            {latestObservation ? new Date(latestObservation.ts).toLocaleTimeString() : "none"}
          </p>
          <pre className="debug-console">
            {latestObservation ? JSON.stringify(latestObservation, null, 2) : "No observation yet."}
          </pre>
        </div>
      ) : null}

      <div className="card">
        <h2>Event Feed (last 50)</h2>
        <div className="debug-console">
          {feed.length === 0 ? <p className="muted">No events yet.</p> : null}
          {feed.map((entry, index) => (
            <p key={`${entry.timestamp}-${index}`} className="debug-line">
              [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.label} - {entry.detail}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
