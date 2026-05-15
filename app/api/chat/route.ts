import { NextResponse } from "next/server.js";

import { CHAT_ROUTE_BLOCKED_ERROR, shouldBlockChatRoute } from "@/lib/chat-route-guard";
import {
  buildDeviceContextMessage,
  buildMemoryContextMessage,
  buildSystemMessages,
  type ToneProfile,
  type HistoryMessage,
} from "@/lib/chat-prompt";
import { buildPersonaPackSystemMessage } from "@/lib/persona/style-pack";
import { loadPersonaStylePack } from "@/lib/persona/style-pack.server";
import { loadCustomPersonaSpec } from "@/lib/persona/custom-persona.server";
import { buildCustomPersonaSteeringMessage } from "@/lib/persona/custom-persona";
import {
  buildDialogueActPrompt,
  evaluateImmersionQuality,
  buildStateGuidanceBlock,
  shapeAssistantOutput,
  type DialogueAct,
} from "@/lib/chat/conversation-quality";
import {
  attachWinnerToLiveTurnDiagnostic,
  buildServerCanonicalTurnMove,
  buildLiveTurnDiagnosticRecord,
  interpretLiveRouteTurn,
  type LiveTurnDiagnosticRecord,
  type ServerCanonicalTurnMove,
} from "@/lib/chat/live-turn-interpretation";
import { getSelectedPersonaPlaybookIds } from "@/lib/chat/behavior-pack";
import {
  shouldNoopForNoNewUserMessage,
} from "@/lib/chat/session-contract";
import {
  buildRecentTurnsContext,
  buildTurnPlan,
  buildTurnPlanFallback,
  buildTurnPlanSystemMessage,
  isTurnPlanSatisfied,
  type TurnPlan,
} from "@/lib/chat/turn-plan";
import {
  deriveConversationStateFromMessages,
  buildVoiceContinuityBlock,
  formatRollingSummaryText,
  noteConversationAssistantTurn,
  normalizeConversationStateSnapshot,
  type ConversationStateSnapshot,
} from "@/lib/chat/conversation-state";
import { assemblePrompt, type PromptAssemblyDebug } from "@/lib/chat/prompt-assembly";
import { setPromptDebugEntry } from "@/lib/chat/prompt-debug";
import {
  chooseVoicePromptProfile,
  resolvePromptRouteMode,
  shouldIncludeResponseStrategyPromptBlock,
  shouldIncludeTaskRuntimePromptBlocks,
  type PromptRouteMode,
  type VoicePromptProfile,
} from "@/lib/chat/prompt-profile";
import { stripClientPromptScaffolding } from "@/lib/chat/request-messages";
import {
  buildRepairDebugHeaders,
  resolveRepairTurn,
} from "@/lib/chat/repair-turn";
import {
  buildResponseStrategyBlock,
  buildContinuityRecoveryReply,
  chooseResponseStrategy,
  shouldKeepCoherentModelReply,
} from "@/lib/chat/response-strategy";
import {
  detectStaleResponseReuse,
  shouldPreserveAnsweredQuestionAgainstRepetitionFallback,
} from "@/lib/chat/repetition";
import { containsAgeAmbiguityTerms, isConsentComplete } from "@/lib/consent";
import {
  appendChatHistory,
  createLongTermMemory,
  createMemorySuggestion,
  getProfileProgressFromDb,
  getMemoryPreferencesFromDb,
  forgetLongTermMemories,
  getLatestSessionSummary,
  getProfileFromDb,
  getRecentChatHistory,
  listTasksFromDb,
  listTaskEvidenceEventsFromDb,
  listTaskOccurrencesFromDb,
  getSessionSummary,
  listMemorySuggestions,
  listCustomItemsWithRefsFromDb,
  listLongTermMemories,
  markMemoriesRecalled,
  refreshExpiredTasksInDb,
  upsertSessionSummary,
} from "@/lib/db";
import { getDeviceService } from "@/lib/devices/device-service";
import { getEmergencyStopSnapshot } from "@/lib/emergency-stop";
import { validateAndNormalizeLocalHttpBaseUrl } from "@/lib/local-url";
import { parseMemoryCommand } from "@/lib/memory/commands";
import { DEFAULT_MEMORY_AUTO_SAVE } from "@/lib/memory/config";
import { extractMemorySuggestions } from "@/lib/memory/extract";
import { setMemoryDebugEntry } from "@/lib/memory/debug";
import {
  buildPinnedMemoryBlock,
  buildLearnedUserProfileBlock,
  buildMemoryInjectionBlock,
  selectRelevantMemories,
} from "@/lib/memory/retrieval";
import {
  buildTaskActionSchemaPromptBlock,
  buildTaskCatalogPromptBlock,
  buildTaskContextBlock,
  buildTaskReviewQueue,
  buildTaskRewardPolicyBlock,
} from "@/lib/tasks/system";
import {
  buildCapabilityCatalog,
  buildCapabilityCatalogPrompt,
  inferVisionSignalsStatusFromObservation,
  normalizeVisionSignalsStatus,
  validateCapabilityCheck,
  type PlannerCheckValidationReport,
} from "@/lib/camera/vision-capabilities";
import {
  buildObservationPromptBlock,
  normalizeObservationPrompt,
} from "@/lib/session/observation-prompt";
import { scrubVisibleInternalLeakText } from "@/lib/session/response-gate";
import { applyFreshGreetingGuard } from "@/lib/chat/fresh-greeting-guard";
import {
  answeredDirectQuestionFirst,
  maybeHandleSessionReplayDeterministicBypass,
  type SessionReplayDebugContext,
} from "@/lib/session/live-turn-controller";
import {
  buildSessionInventoryContextMessage,
  normalizeSessionInventory,
} from "@/lib/session/session-inventory";
import { parseAndValidatePlannedStep } from "@/lib/session/step-planner-schema";
import {
  buildObservationTrustGuardLine,
  evaluateObservationTrust,
} from "@/lib/session/observation-trust";
import { inspectGameStartContract } from "@/lib/session/game-start-contract";
import { normalizeWorkingMemory } from "@/lib/session/working-memory";
import { persistTaskFromAssistantText } from "@/lib/session/task-persistence";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  createSessionStateContract,
  reduceAssistantEmission,
  reduceUserTurn,
} from "@/lib/session/session-state-contract";
import {
  updateCanonicalTurnState,
  type PlannedMove,
  type TurnMeaning,
} from "@/lib/session/turn-meaning";
import {
  generateLlmSemanticCandidates,
} from "@/lib/session/semantic-candidate-generator";
import {
  createActiveInteractionStateOwner,
  normalizeActiveInteractionState,
  routeTurnWithActiveInteraction,
  updateActiveInteractionState,
  type ActiveInteractionState,
  type ActiveInteractionStateOwner,
} from "@/lib/session/active-interaction";
import {
  buildResponseBrief,
  buildResponseBriefPrompt,
  detectGenericAssistantVoice,
  normalizePreviousResponseBriefSummary,
  realizeResponseFromBrief,
  summarizeResponseBrief,
  validateReplyAgainstBrief,
  type PreviousResponseBriefSummary,
} from "@/lib/session/response-brief";
import {
  planDomainAnswer,
} from "@/lib/session/raven-preferences";
import {
  commitVisibleOutput,
  recordVisibleCandidate,
  selectVisibleOutputOwner,
  visibleTextImpliesUnlimitedConsent,
} from "@/lib/session/visible-output-authority";
import {
  buildServerAuthorityTrace,
  createAuthorityErrorPayload,
  SERVER_AUTHORITY_SENTINEL,
  VISIBLE_OUTPUT_AUTHORITY_TRACE_VERSION,
} from "@/lib/session/client-visible-authority";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatRequestBody = {
  requestId?: unknown;
  turnId?: unknown;
  messages?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  personaPackId?: unknown;
  toneProfile?: unknown;
  llmTemperature?: unknown;
  llmTopP?: unknown;
  llmTopK?: unknown;
  llmRepeatPenalty?: unknown;
  llmStop?: unknown;
  consent?: unknown;
  planner?: unknown;
  sessionMode?: unknown;
  awaitingUser?: unknown;
  userAnswered?: unknown;
  verificationJustCompleted?: unknown;
  sessionPhase?: unknown;
  lastAssistantOutput?: unknown;
  moodLabel?: unknown;
  relationshipLabel?: unknown;
  observations?: unknown;
  visionSignalsStatus?: unknown;
  deviceOptIn?: unknown;
  deviceExecutionSummary?: unknown;
  sessionId?: unknown;
  memoryAutoSave?: unknown;
  memoryText?: unknown;
  inventory?: unknown;
  conversationState?: unknown;
  activeInteraction?: unknown;
  previousResponseBrief?: unknown;
  activeStateOwner?: unknown;
  workingMemory?: unknown;
  verificationSummary?: unknown;
  debugRawModel?: unknown;
};

type ChatResponseStatePayload = {
  activeInteraction?: ActiveInteractionState | null;
  previousResponseBrief?: PreviousResponseBriefSummary | null;
  activeStateOwner?: ActiveInteractionStateOwner | null;
  statePersistence?: {
    state_returned_to_server: boolean;
    state_returned_to_client: boolean;
    previous_instruction_id: string | null;
    active_interaction_before_id: string | null;
    active_interaction_after_id: string | null;
    active_state_created_this_turn?: boolean;
    active_state_creation_reason?: string | null;
    previous_response_brief_created_this_turn?: boolean;
    previous_response_brief_sent_to_server?: boolean;
    previous_response_brief_received_by_server?: boolean;
    last_assistant_instruction_created_this_turn?: boolean;
    last_assistant_instruction_sent_to_server?: boolean;
  };
  semanticTrace?: unknown;
};

type ChatTraceHeadersInput = {
  requestId: string;
  turnId: string;
  generationPath: string;
  modelRan: boolean;
  deterministicRail?: string | null;
  postProcessed?: boolean;
};

type PlannerRequest = {
  enabled: boolean;
  stepIndex: number;
};

type ConversationStateInput = {
  awaitingUser: boolean;
  userAnswered: boolean;
  verificationJustCompleted: boolean;
  sessionPhase: string;
  moodLabel: string;
  relationshipLabel: string;
  lastAssistantOutput: string | null;
};

type OllamaSamplingOptions = {
  temperature: number;
  top_p: number;
  top_k: number;
  repeat_penalty: number;
  stop: string[];
};

const PLANNER_JSON_SYSTEM_MESSAGE =
  'Planner mode: return ONLY strict JSON with fields {"mode","say","checkType","checkParams","question","timeoutSeconds","onPassSay","onFailSay","maxRetries"}. Rules: vary steps, ask questions, do not repeat, keep one instruction per step, include mode listen at least every 3 steps, and simplify after failures. mode must be talk/check/listen. checkType must come from the Supported verification capabilities section. No markdown.';

const SESSION_CONVERSATION_SYSTEM_MESSAGE =
  "Session mode rules: always respond to the user's latest message. If the user asks a question, answer it directly before giving any new instruction. Use Session Memory and Observations when relevant. Ask at most one follow-up question per user message. If the topic is open and user context is still thin, use that question to learn one stable thing about the user such as a goal, preference, limit, or improvement area. Do not ignore user questions, and do not jump to a new instruction without acknowledging what the user said first. Keep responses under 180 words. Never claim visual facts that are not present in Observations. Stay in character as Raven and do not drift into generic technical guidance.";

const TASK_ACTIONS_SYSTEM_MESSAGE = buildTaskActionSchemaPromptBlock();
const PLANNER_TIMEOUT_MS = 6000;
const MODEL_TIMEOUT_MS = 12000;
const RENDERER_TIMEOUT_MS = 8000;
const ROUTE_TOTAL_TIMEOUT_MS = 18000;

export const runtime = "nodejs";
const pendingForgetBySession = new Map<string, { query: string; expiresAt: number }>();
const FORGET_CONFIRM_TTL_MS = 2 * 60 * 1000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response | null; timedOut: boolean; error: string | null; elapsedMs: number }> {
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return { response, timedOut: false, error: null, elapsedMs: Date.now() - started };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    return {
      response: null,
      timedOut: name === "AbortError",
      error: message || "fetch_failed",
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function toSafeSessionId(value: unknown): string {
  if (typeof value !== "string") {
    return "default-session";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "default-session";
  }
  return trimmed.slice(0, 80);
}

function toSafeTraceId(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 120) || fallback;
}

function substantiveSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const words = (value: string | null | undefined) =>
    new Set(
      (value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 4),
    );
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

function buildChatTraceHeaders(input: ChatTraceHeadersInput): Record<string, string> {
  return {
    "x-raven-request-id": input.requestId,
    "x-raven-turn-id": input.turnId,
    "x-raven-generation-path": input.generationPath,
    "x-raven-model-ran": input.modelRan ? "1" : "0",
    "x-raven-deterministic-rail": input.deterministicRail?.trim() || "none",
    "x-raven-post-processed": input.postProcessed ? "1" : "0",
  };
}

function createStaticAssistantNdjsonResponse(
  text: string,
  extraHeaders: Record<string, string> = {},
  statePayload: ChatResponseStatePayload = {},
  routeDebug: Record<string, unknown> = {},
) {
  const authorizedPayload = authorizeStaticAssistantStatePayload(text, extraHeaders, statePayload);
  if (!authorizedPayload.ok) {
    logSessionRouteDebug({
      stage: "route_authority_contract",
      route_received_user_text: routeDebug.route_received_user_text ?? "unknown",
      planner_strategy: routeDebug.planner_strategy ?? "none",
      planner_step_valid: routeDebug.planner_step_valid ?? "not_applicable",
      planner_error_category: routeDebug.planner_error_category ?? null,
      response_brief_created: routeDebug.response_brief_created ?? false,
      visible_authority_commit_attempted: true,
      server_authority_sentinel_attached: false,
      ndjson_assistant_payload_sent: false,
      ndjson_error_payload_sent: true,
    });
    return createHandledAuthorityErrorNdjsonResponse({
      errorCategory: "authority_validation_error",
      blockedReason: authorizedPayload.reason,
      serverCommitPath: authorizedPayload.serverCommitPath,
      rawResponseShape: authorizedPayload.rawResponseShape,
      routeDebug,
    });
  }
  logSessionRouteDebug({
    stage: "route_authority_contract",
    route_received_user_text: routeDebug.route_received_user_text ?? "unknown",
    planner_strategy: routeDebug.planner_strategy ?? "none",
    planner_step_valid: routeDebug.planner_step_valid ?? "not_applicable",
    planner_error_category: routeDebug.planner_error_category ?? null,
    response_brief_created: routeDebug.response_brief_created ?? Boolean(statePayload.previousResponseBrief),
    visible_authority_commit_attempted: Boolean(text.trim()),
    server_authority_sentinel_attached:
      authorizedPayload.authorityTrace.server_authority_sentinel === SERVER_AUTHORITY_SENTINEL,
    ndjson_assistant_payload_sent: Boolean(text.trim()),
    ndjson_error_payload_sent: false,
  });
  const encoded = `${JSON.stringify({
    response: text,
    done: true,
    ...authorizedPayload.payload,
    authorityTrace: authorizedPayload.authorityTrace,
    ...authorizedPayload.authorityTrace,
  })}\n`;
  return new Response(encoded, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function createHandledAuthorityErrorNdjsonResponse(input: {
  errorCategory: string;
  blockedReason: string;
  serverCommitPath?: string | null;
  rawResponseShape?: unknown;
  plannerError?: Record<string, unknown> | null;
  extra?: Record<string, unknown> | null;
  routeDebug?: Record<string, unknown>;
  headers?: Record<string, string>;
}) {
  const routeDebug = input.routeDebug ?? {};
  logSessionRouteDebug({
    stage: "route_authority_contract",
    route_received_user_text: routeDebug.route_received_user_text ?? true,
    planner_strategy: routeDebug.planner_strategy ?? "none",
    planner_step_valid: routeDebug.planner_step_valid ?? "not_applicable",
    planner_error_category:
      input.errorCategory === "planner_validation_error" ? input.errorCategory : null,
    response_brief_created: routeDebug.response_brief_created ?? false,
    visible_authority_commit_attempted: routeDebug.visible_authority_commit_attempted ?? false,
    server_authority_sentinel_attached: false,
    ndjson_assistant_payload_sent: false,
    ndjson_error_payload_sent: true,
    error_category: input.errorCategory,
    blocked_reason: input.blockedReason,
    ...(routeDebug ?? {}),
  });
  const payload = createAuthorityErrorPayload({
    errorCategory: input.errorCategory,
    blockedReason: input.blockedReason,
    serverCommitPath: input.serverCommitPath ?? "missing",
    rawResponseShape: input.rawResponseShape,
    plannerError: input.plannerError,
    extra: {
      route_received_user_text: true,
      visible_authority_commit_attempted: false,
      ndjson_error_payload_sent: true,
      assistant_text_sent: false,
      planner_timeout_ms: PLANNER_TIMEOUT_MS,
      model_timeout_ms: MODEL_TIMEOUT_MS,
      renderer_timeout_ms: RENDERER_TIMEOUT_MS,
      route_total_timeout_ms: ROUTE_TOTAL_TIMEOUT_MS,
      ...(input.extra ?? {}),
    },
  });
  return new Response(`${JSON.stringify({ response: "", done: true, ...payload })}\n`, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      ...(input.headers ?? {}),
    },
  });
}

function hasRequiredVisibleAuthorityFields(trace: Record<string, unknown>): boolean {
  return (
    trace.authority_trace_present === true &&
    trace.authority_trace_version === VISIBLE_OUTPUT_AUTHORITY_TRACE_VERSION &&
    trace.server_authority_sentinel === SERVER_AUTHORITY_SENTINEL &&
    typeof trace.server_commit_path === "string" &&
    trace.server_commit_path.trim().length > 0 &&
    typeof trace.final_visible_owner === "string" &&
    trace.final_visible_owner.trim().length > 0 &&
    typeof trace.final_visible_source === "string" &&
    trace.final_visible_source.trim().length > 0 &&
    trace.candidate_kind === "visible_assistant_prose" &&
    trace.candidate_visible_safe === true &&
    trace.visible_commit_allowed === true &&
    trace.client_generated_reply_used === false &&
    trace.assistant_output_quality !== "failed_fulfillment" &&
    trace.assistant_output_quality !== "fallback_plan_leak" &&
    trace.assistant_output_quality !== "generic_assistant_voice" &&
    trace.assistant_output_context_eligible === true &&
    trace.request_fulfilled === true
  );
}

function authorizeStaticAssistantStatePayload(
  text: string,
  extraHeaders: Record<string, string>,
  statePayload: ChatResponseStatePayload,
):
  | { ok: true; payload: ChatResponseStatePayload; authorityTrace: Record<string, unknown> }
  | {
      ok: false;
      reason: string;
      serverCommitPath: string | null;
      rawResponseShape: Record<string, unknown>;
    } {
  if (!text.trim()) {
    return { ok: true, payload: statePayload, authorityTrace: {} };
  }
  const authorityTrace = buildServerAuthorityTrace({
    semanticTrace: statePayload.semanticTrace,
    generationPath: extraHeaders["x-raven-generation-path"],
    finalOutputSource: extraHeaders["x-raven-final-output-source"],
    serverCommitPath: "route_authorized_visible_commit",
  });
  if (authorityTrace.client_generated_reply_used === true) {
    return {
      ok: false,
      reason: "client_generated_reply_used",
      serverCommitPath:
        typeof authorityTrace.server_commit_path === "string"
          ? authorityTrace.server_commit_path
          : null,
      rawResponseShape: {
        text_present: true,
        state_payload_keys: Object.keys(statePayload).sort(),
        semantic_trace_keys:
          statePayload.semanticTrace && typeof statePayload.semanticTrace === "object"
            ? Object.keys(statePayload.semanticTrace as Record<string, unknown>).sort()
            : [],
      },
    };
  }
  if (!hasRequiredVisibleAuthorityFields(authorityTrace)) {
    return {
      ok: false,
      reason: "visible_authority_contract_incomplete",
      serverCommitPath:
        typeof authorityTrace.server_commit_path === "string"
          ? authorityTrace.server_commit_path
          : null,
      rawResponseShape: {
        text_present: true,
        state_payload_keys: Object.keys(statePayload).sort(),
        semantic_trace_keys:
          statePayload.semanticTrace && typeof statePayload.semanticTrace === "object"
            ? Object.keys(statePayload.semanticTrace as Record<string, unknown>).sort()
            : [],
        authority_trace_keys: Object.keys(authorityTrace).sort(),
      },
    };
  }
  return {
    ok: true,
    payload: {
      ...statePayload,
      semanticTrace: statePayload.semanticTrace,
    },
    authorityTrace,
  };
}

function buildChatResponseStatePayload(input: {
  activeInteractionBefore: ActiveInteractionState | null;
  activeInteractionAfter: ActiveInteractionState | null;
  previousResponseBrief: PreviousResponseBriefSummary | null;
  owner: ActiveInteractionStateOwner;
  semanticTrace?: unknown;
}): ChatResponseStatePayload {
  return {
    activeInteraction: input.activeInteractionAfter,
    previousResponseBrief: input.previousResponseBrief,
    activeStateOwner: input.owner,
    statePersistence: {
      state_returned_to_server: Boolean(input.activeInteractionBefore?.active_interaction_id),
      state_returned_to_client: true,
      previous_instruction_id:
        input.activeInteractionBefore?.last_assistant_instruction?.instruction_id ?? null,
      active_interaction_before_id: input.activeInteractionBefore?.active_interaction_id ?? null,
      active_interaction_after_id: input.activeInteractionAfter?.active_interaction_id ?? null,
      active_state_created_this_turn: Boolean(
        !input.activeInteractionBefore?.active_interaction_id &&
          input.activeInteractionAfter?.active_interaction_id,
      ),
      active_state_creation_reason:
        !input.activeInteractionBefore?.active_interaction_id &&
        input.activeInteractionAfter?.active_interaction_id
          ? "active_interaction_after_created"
          : null,
      previous_response_brief_created_this_turn: Boolean(input.previousResponseBrief),
      previous_response_brief_sent_to_server: Boolean(
        input.activeInteractionBefore?.previous_response_brief_id,
      ),
      previous_response_brief_received_by_server: Boolean(
        input.activeInteractionBefore?.previous_response_brief_id,
      ),
      last_assistant_instruction_created_this_turn: Boolean(
        input.activeInteractionAfter?.last_assistant_instruction?.instruction_id,
      ),
      last_assistant_instruction_sent_to_server: Boolean(
        input.activeInteractionBefore?.last_assistant_instruction?.instruction_id,
      ),
    },
    semanticTrace: input.semanticTrace,
  };
}

function encodeHeaderList(values: string[]): string {
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 12);
  return cleaned.length > 0 ? cleaned.join(",") : "none";
}

function previousAssistantText(messages: ChatMessage[]): string | null {
  return [...messages].reverse().find((message) => message.role === "assistant")?.content ?? null;
}

function previousUserText(messages: ChatMessage[]): string | null {
  let seenLatestUser = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }
    if (!seenLatestUser) {
      seenLatestUser = true;
      continue;
    }
    return message.content;
  }
  return null;
}

function buildPromptRouteSystemMessage(mode: PromptRouteMode): string | null {
  if (mode === "fresh_greeting") {
    return [
      "Fresh-turn rule:",
      "- The latest user line is a greeting or casual opener.",
      "- Treat it as a fresh open-chat turn.",
      "- Do not continue stale game, task, or profile threads unless a real lock is active.",
      "- Reply with one brief in-character opener.",
      "- A simple grounded greeting is enough here; do not force pressure or a hard redirect unless the scene already calls for it.",
      "- Do not turn a plain greeting into an ownership claim or a stack of commands in the first line.",
    ].join("\n");
  }
  if (mode === "relational_direct") {
    return [
      "Relational turn rule:",
      "- The latest user line is ordinary relational chat, a question about Raven, or a clarification turn.",
      "- Answer personally and directly in the first sentence.",
      "- If the user asks what you mean or what part, restate your immediately previous meaning plainly.",
      "- Use the previous Raven line as the main source of truth for clarification.",
      "- Do not ask for angle, specificity, or clarification unless the question is truly unclear.",
      "- Do not continue stale game, task, or profile-question threads on this turn.",
    ].join("\n");
  }
  return null;
}

function buildPromptRouteTurnPlanMessage(
  mode: PromptRouteMode,
  turnPlan: TurnPlan,
): string {
  if (mode === "fresh_greeting") {
    return [
      "Turn plan:",
      "Required move: greet_and_invite",
      "Reason: the latest user line is a greeting opener",
      `Latest user line: ${turnPlan.latestUserMessage || "none"}`,
      "Rules:",
      "- Treat this as a fresh open-chat opener.",
      "- Do not continue stale thread continuity from the previous assistant line.",
      "- Use one brief in-character opener.",
      "- If you invite the user forward, do it naturally rather than as an immediate demand.",
      "- Keep the first line calm, controlled, and brief instead of pushing correction or obedience immediately.",
    ].join("\n");
  }
  if (mode === "relational_direct") {
    return [
      "Turn plan:",
      "Required move: answer_relational_question",
      "Reason: the latest user line asks about Raven, the relationship dynamic, or Raven's prior meaning",
      `Latest user line: ${turnPlan.latestUserMessage || "none"}`,
      "Rules:",
      "- Answer the user directly in the first sentence.",
      "- On clarification turns, restate the exact point you just made before doing anything else.",
      "- Do not ask for angle or exact scope before answering.",
      "- Do not continue stale thread continuity from the previous assistant line.",
      "- At most one brief reciprocal question, only if it fits naturally.",
    ].join("\n");
  }
  return buildTurnPlanSystemMessage(turnPlan);
}

function buildPromptRouteConversationState(
  state: ConversationStateSnapshot,
  mode: PromptRouteMode,
): ConversationStateSnapshot {
  void mode;
  return state;
}

function logSessionRouteDebug(payload: Record<string, unknown>): void {
  console.info("raven.route.debug", JSON.stringify(payload));
}

function compactDiagnosticText(text: string | null | undefined, max = 160): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function buildActiveThreadHint(
  conversationStateSnapshot: ConversationStateSnapshot,
): string | null {
  return (
    compactDiagnosticText(
      conversationStateSnapshot.active_thread !== "none"
        ? conversationStateSnapshot.active_thread
        : conversationStateSnapshot.last_conversation_topic !== "none"
          ? conversationStateSnapshot.last_conversation_topic
          : conversationStateSnapshot.pending_user_request !== "none"
            ? conversationStateSnapshot.pending_user_request
            : null,
    ) ?? null
  );
}

function buildServerTurnDiagnosticRecord(input: {
  requestId: string;
  turnId: string;
  sessionId: string;
  interpretationInput: Parameters<typeof buildLiveTurnDiagnosticRecord>[0]["interpretationInput"];
  messages: ChatMessage[];
  conversationStateSnapshot: ConversationStateSnapshot;
  canonicalTurnMove?: ServerCanonicalTurnMove | null;
}): LiveTurnDiagnosticRecord {
  const baseRecord = buildLiveTurnDiagnosticRecord({
    requestId: input.requestId,
    turnId: input.turnId,
    sessionId: input.sessionId,
    interpretationInput: input.interpretationInput,
    interactionMode: input.conversationStateSnapshot.current_mode,
    activeThreadHint: buildActiveThreadHint(input.conversationStateSnapshot),
  });
  const latestUserIndex = [...input.messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;
  if (latestUserIndex === undefined) {
    return baseRecord;
  }

  let contract = createSessionStateContract(`route-diagnostic-${input.sessionId}`);
  for (let index = 0; index < latestUserIndex; index += 1) {
    const message = input.messages[index];
    if (!message || message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      const reduced = reduceUserTurn(contract, {
        text: message.content,
        nowMs: index + 1,
      });
      contract = reduced.next;
      continue;
    }
    contract = reduceAssistantEmission(contract, {
      stepId: `route-diagnostic-${index}`,
      content: message.content,
      isQuestion: message.content.includes("?"),
    });
  }

  const reducedLatest = reduceUserTurn(contract, {
    text: input.messages[latestUserIndex]?.content ?? input.interpretationInput.lastUserMessage,
    nowMs: latestUserIndex + 1,
    diagnosticRecord: baseRecord,
    canonicalTurnMove: input.canonicalTurnMove ?? null,
  });
  return reducedLatest.diagnostic ?? baseRecord;
}

async function persistSessionTurnSummary(
  sessionId: string,
  userText: string,
  assistantText: string,
  stateBeforeAssistant: ConversationStateSnapshot,
  ravenIntent = "respond",
): Promise<void> {
  const compactUser = userText.replace(/\s+/g, " ").trim();
  const compactAssistant = assistantText.replace(/\s+/g, " ").trim();
  if (!compactUser || !compactAssistant) {
    return;
  }

  const summaryState = noteConversationAssistantTurn(stateBeforeAssistant, {
    text: compactAssistant,
    ravenIntent,
    nowMs: Date.now(),
  });
  const existing = await getSessionSummary(sessionId);
  await upsertSessionSummary({
    sessionId,
    summary: formatRollingSummaryText(summaryState.rolling_summary),
    structuredSummary: summaryState.rolling_summary,
    turnCount: (existing?.turn_count ?? 0) + 1,
  });
}

function isValidMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeMessage = value as { role?: unknown; content?: unknown };
  return (
    (maybeMessage.role === "user" ||
      maybeMessage.role === "assistant" ||
      maybeMessage.role === "system") &&
    typeof maybeMessage.content === "string"
  );
}

function parsePlannerRequest(value: unknown): PlannerRequest {
  if (!value || typeof value !== "object") {
    return { enabled: false, stepIndex: 1 };
  }

  const candidate = value as { enabled?: unknown; stepIndex?: unknown };
  const rawStepIndex =
    typeof candidate.stepIndex === "number" ? candidate.stepIndex : Number(candidate.stepIndex);

  return {
    enabled: candidate.enabled === true,
    stepIndex: Number.isFinite(rawStepIndex) && rawStepIndex > 0 ? Math.floor(rawStepIndex) : 1,
  };
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildSemanticGuidanceBlock(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
  candidateSource: string;
}): string {
  const { turnMeaning, plannedMove } = input;
  return [
    "Semantic turn contract:",
    `candidate_source: ${input.candidateSource}`,
    `speech_act: ${turnMeaning.speech_act}`,
    `target: ${turnMeaning.target}`,
    `subject_domain: ${turnMeaning.subject_domain}`,
    `requested_operation: ${turnMeaning.requested_operation}`,
    `question_shape: ${turnMeaning.question_shape}`,
    `requested_facet: ${turnMeaning.requested_facet}`,
    `required_referent: ${turnMeaning.required_referent ?? "none"}`,
    `planned_move: ${plannedMove.move}`,
    `answer_contract: ${turnMeaning.answer_contract}`,
    "Choose visible content that satisfies this semantic contract. Do not invent a different move.",
  ].join("\n");
}

function normalizeSamplingOptions(
  payload: ChatRequestBody,
  plannerEnabled: boolean,
): OllamaSamplingOptions {
  const temperature = plannerEnabled
    ? Math.max(0.1, Math.min(0.8, asNumber(payload.llmTemperature, 0.25)))
    : Math.max(
        0.1,
        Math.min(1.5, asNumber(payload.llmTemperature, DEFAULT_SETTINGS.llmTemperature)),
      );
  const topP = Math.max(0.1, Math.min(1, asNumber(payload.llmTopP, DEFAULT_SETTINGS.llmTopP)));
  const topK = Math.max(
    1,
    Math.min(200, Math.floor(asNumber(payload.llmTopK, DEFAULT_SETTINGS.llmTopK))),
  );
  const repeatPenalty = Math.max(
    1,
    Math.min(2, asNumber(payload.llmRepeatPenalty, DEFAULT_SETTINGS.llmRepeatPenalty)),
  );
  const stop = Array.isArray(payload.llmStop)
    ? payload.llmStop
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
        .slice(0, 8)
    : DEFAULT_SETTINGS.llmStopSequences;
  return {
    temperature: Number(temperature.toFixed(2)),
    top_p: Number(topP.toFixed(2)),
    top_k: topK,
    repeat_penalty: Number(repeatPenalty.toFixed(2)),
    stop: stop.length > 0 ? stop : DEFAULT_SETTINGS.llmStopSequences,
  };
}

function summarizeMemoryForContext(memoryBlock: string): string[] {
  const lines = memoryBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.toLowerCase() !== "long-term memory:")
    .filter((line) => line.toLowerCase() !== "memory:")
    .filter((line) => line.toLowerCase() !== "none")
    .slice(0, 6);
  if (lines.length === 0) {
    return ["none"];
  }
  return lines;
}

function summarizeVisionForContext(observationPrompt: string): string[] {
  const allowedPrefixes = [
    "scene_summary:",
    "scene_change_summary:",
    "scene_objects_summary:",
    "scene_objects_change:",
    "person_present:",
    "pose_label:",
    "motion_state:",
    "camera_available:",
  ];
  const lines = observationPrompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => allowedPrefixes.some((prefix) => line.toLowerCase().startsWith(prefix)))
    .slice(0, 3);

  return lines.length > 0 ? lines : ["camera_available: false"];
}

function findVerificationSummary(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "system" && message.role !== "user") {
      continue;
    }
    const match = message.content.match(/Recent verification:\s*(.+)/i);
    if (match && typeof match[1] === "string") {
      const value = match[1].trim();
      if (value) {
        return value.slice(0, 180);
      }
    }
  }
  return "none";
}

function buildCompactContextBlock(input: {
  memoryBlock: string;
  toneProfile: ToneProfile;
  moodLabel: string;
  relationshipLabel: string;
  observationPrompt: string;
  deviceContextMessage: string;
  inventoryContextMessage: string;
  verificationSummary: string;
}): string {
  const memoryLines = summarizeMemoryForContext(input.memoryBlock);
  const observationLines = summarizeVisionForContext(input.observationPrompt);
  const deviceLines = input.deviceContextMessage
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  const inventoryLines = input.inventoryContextMessage
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^Session inventory:/i.test(line))
    .slice(0, 4);
  return [
    "Compact context:",
    "Memory summary:",
    ...memoryLines.map((line) => `- ${line}`),
    `Tone profile: ${input.toneProfile}`,
    `Mood: ${input.moodLabel || "neutral"}`,
    `Relationship: ${input.relationshipLabel || "building"}`,
    "Vision summary:",
    ...observationLines.map((line) => `- ${line}`),
    `Verification result: ${input.verificationSummary || "none"}`,
    `Devices: ${deviceLines.join(" | ")}`,
    `Inventory: ${inventoryLines.join(" | ")}`,
  ].join("\n");
}

function buildVerifiableAlternativePrompt(checkTypes: string[]): string {
  if (checkTypes.length === 0) {
    return "I cannot verify that action right now. Give one alternative I can confirm manually.";
  }
  return `I cannot verify that action with current detectors. Give one alternative using one of these checks: ${checkTypes.join(", ")}.`;
}

function collectObjectLabelsFromObservationPayload(observations: unknown): string[] {
  if (!observations || typeof observations !== "object") {
    return [];
  }
  const payload = observations as {
    objects?: Array<{ label?: unknown }>;
    objects_stable?: Array<{ label?: unknown }>;
    custom_objects?: Array<{ label?: unknown }>;
  };

  const labels = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized) {
      labels.add(normalized);
    }
  };

  if (Array.isArray(payload.objects)) {
    for (const item of payload.objects) {
      push(item?.label);
    }
  }
  if (Array.isArray(payload.objects_stable)) {
    for (const item of payload.objects_stable) {
      push(item?.label);
    }
  }
  if (Array.isArray(payload.custom_objects)) {
    for (const item of payload.custom_objects) {
      push(item?.label);
    }
  }
  return [...labels];
}

function shouldAutoSaveCategory(
  memoryType: "preference" | "goal" | "constraint" | "setup" | "habit" | "misc",
  preferences: Awaited<ReturnType<typeof getMemoryPreferencesFromDb>>,
): boolean {
  if (!preferences.auto_save) {
    return false;
  }
  if (memoryType === "goal") {
    return preferences.auto_save_goals;
  }
  if (memoryType === "constraint") {
    return preferences.auto_save_constraints;
  }
  if (memoryType === "preference") {
    return preferences.auto_save_preferences;
  }
  return preferences.auto_save_goals;
}

function isSuggestionSnoozed(
  preferences: Awaited<ReturnType<typeof getMemoryPreferencesFromDb>>,
): boolean {
  if (!preferences.suggestion_snooze_until) {
    return false;
  }
  const until = Date.parse(preferences.suggestion_snooze_until);
  if (!Number.isFinite(until)) {
    return false;
  }
  return until > Date.now();
}

function validatePlannerStepAgainstCatalog(
  step: {
    id: string;
    mode: string;
    say: string;
    checkType?: string;
    checkParams?: Record<string, unknown>;
    question?: string;
    timeoutSeconds: number;
    onPassSay: string;
    onFailSay: string;
    maxRetries: number;
  },
  allowedCheckTypes: string[],
  capabilityCatalog: ReturnType<typeof buildCapabilityCatalog>,
): {
  step: typeof step;
  validation: PlannerCheckValidationReport;
} {
  const report: PlannerCheckValidationReport = {
    accepted: [],
    removed: [],
    downgraded: false,
    downgrade_reason: null,
    clamp_notes: [],
  };

  if (step.mode !== "check" || !step.checkType) {
    return { step, validation: report };
  }

  const check = validateCapabilityCheck(step.checkType, step.checkParams ?? {}, capabilityCatalog);
  if (!check.ok) {
    report.removed.push({
      checkType: step.checkType,
      reason: check.reason ?? "unsupported capability",
    });
    report.downgraded = true;
    report.downgrade_reason = check.reason ?? "unsupported capability";
    return {
      step: {
        ...step,
        mode: "listen",
        checkType: undefined,
        checkParams: undefined,
        question: buildVerifiableAlternativePrompt(allowedCheckTypes),
        timeoutSeconds: Math.max(step.timeoutSeconds, 20),
        maxRetries: 0,
      },
      validation: report,
    };
  }

  report.accepted.push({
    checkType: check.checkType,
    checkParams: check.params,
  });
  if (check.clampNotes.length > 0) {
    report.clamp_notes.push(...check.clampNotes);
  }

  return {
    step: {
      ...step,
      checkType: check.checkType,
      checkParams: check.params,
    },
    validation: report,
  };
}

async function buildPreparedMessages(
  messages: ChatMessage[],
  plannerEnabled: boolean,
  sessionMode: boolean,
  toneProfile: ToneProfile,
  dialogueAct: DialogueAct,
  conversationState: ConversationStateInput,
  observationsPayload: unknown,
  capabilityPrompt: string,
  deviceContextMessage: string,
  inventoryContextMessage: string,
  verificationSummary: string,
  observationTrustLine: string,
  userQuery: string,
  sessionId: string,
  personaPackId: string | null,
  personaSteeringSystemMessage: string | null,
  turnPlan: TurnPlan,
  conversationStateSnapshot: ConversationStateSnapshot,
  responseStrategyBlock: string,
  semanticGuidanceBlock: string,
): Promise<{
  messages: HistoryMessage[];
  promptDebug: PromptAssemblyDebug;
  promptProfile: VoicePromptProfile;
  promptRouteMode: PromptRouteMode;
}> {
  const sanitizedMessages = sessionMode ? stripClientPromptScaffolding(messages) : messages;
  const latestUserMessage =
    [...sanitizedMessages].reverse().find((message) => message.role === "user")?.content ?? "";
  const promptRouteMode = resolvePromptRouteMode(latestUserMessage);
  const promptProfile = chooseVoicePromptProfile({
    plannerEnabled,
    sessionMode,
    promptRouteMode,
    latestUserMessage,
    currentMode: conversationStateSnapshot.current_mode,
  });
  const promptRouteSystemMessage = buildPromptRouteSystemMessage(promptRouteMode);
  const promptConversationState = buildPromptRouteConversationState(
    conversationStateSnapshot,
    promptRouteMode,
  );
  const includeTaskRuntimePromptBlocks = shouldIncludeTaskRuntimePromptBlocks({
    plannerEnabled,
    currentMode: conversationStateSnapshot.current_mode,
    sessionPhase: conversationState.sessionPhase,
    latestUserMessage,
    promptRouteMode,
  });
  const includeResponseStrategyPromptBlock = shouldIncludeResponseStrategyPromptBlock({
    plannerEnabled,
    currentMode: conversationStateSnapshot.current_mode,
    sessionPhase: conversationState.sessionPhase,
    latestUserMessage,
    promptRouteMode,
  });
  await refreshExpiredTasksInDb();
  const [
    profile,
    recentHistory,
    longTermMemories,
    lastSessionSummary,
    activeTasks,
    taskEvents,
    allOccurrences,
    progress,
  ] = await Promise.all([
    getProfileFromDb(),
    getRecentChatHistory(sessionId, 12),
    listLongTermMemories(300),
    getLatestSessionSummary(sessionId),
    listTasksFromDb({ status: "active", limit: 20 }),
    listTaskEvidenceEventsFromDb({ limit: 600 }),
    listTaskOccurrencesFromDb({ status: "all", limit: 3000 }),
    getProfileProgressFromDb(),
  ]);
  const profileFacts = Object.entries(profile).map(([key, value]) => ({ key, value: value ?? "" }));
  const memoryContext = buildMemoryContextMessage(profileFacts, recentHistory);
  const relevantMemories = selectRelevantMemories(longTermMemories, userQuery, 11);
  await markMemoriesRecalled(relevantMemories.map((memory) => memory.id));
  const fixedMemoryBlock = buildPinnedMemoryBlock({
    memories: longTermMemories,
    maxLines: 6,
  });
  const longTermMemoryBlock = buildMemoryInjectionBlock({
    memories: relevantMemories,
    lastSessionSummary: lastSessionSummary?.summary ?? null,
    maxLines: 10,
  });
  const learnedUserProfileBlock = buildLearnedUserProfileBlock({
    memories: relevantMemories,
    lastSessionSummary: lastSessionSummary?.summary ?? null,
    maxLines: 8,
  });
  const personaPack = loadPersonaStylePack(personaPackId);
  const personaPackSystemMessage = personaPack
    ? buildPersonaPackSystemMessage(personaPack, {
        includeExamples: promptProfile !== "minimal_voice_chat",
      })
    : null;
  const systemMessages = buildSystemMessages(memoryContext, {
    includeDeviceActions: !plannerEnabled && promptProfile === "full",
    includeBehaviorPack: promptProfile === "full",
    includeToneExamples: promptProfile === "full",
    toneProfile,
    moodLabel: conversationState.moodLabel,
    dialogueAct,
    sessionPhase: conversationState.sessionPhase,
    personaPackSystemMessage,
    personaSteeringSystemMessage,
  });
  const observationPrompt = buildObservationPromptBlock(
    normalizeObservationPrompt(observationsPayload),
  );
  const compactContext = buildCompactContextBlock({
    memoryBlock: longTermMemoryBlock,
    toneProfile,
    moodLabel: conversationState.moodLabel,
    relationshipLabel: conversationState.relationshipLabel,
    observationPrompt,
    deviceContextMessage: includeTaskRuntimePromptBlocks ? deviceContextMessage : "",
    inventoryContextMessage: includeTaskRuntimePromptBlocks ? inventoryContextMessage : "",
    verificationSummary: includeTaskRuntimePromptBlocks ? verificationSummary : "",
  });
  const isMinimalVoicePrompt = promptProfile === "minimal_voice_chat";
  // Only carry task/runtime scaffolding when the live turn is actually on a task, game, verification, or device rail.
  const taskRuntimeSystemMessages: HistoryMessage[] = includeTaskRuntimePromptBlocks
    ? [
        {
          role: "system",
          content: buildTaskContextBlock({
            activeTasks,
            progress,
            reviewQueue: buildTaskReviewQueue({
              activeTasks,
              occurrences: allOccurrences,
              events: taskEvents,
            }),
            todayOccurrences: activeTasks.map((task) => {
              const todayYmd = new Date().toISOString().slice(0, 10);
              const rows = allOccurrences.filter(
                (occurrence) =>
                  occurrence.task_id === task.id && occurrence.scheduled_date === todayYmd,
              );
              return {
                task_id: task.id,
                pending: rows.filter((occurrence) => occurrence.status === "pending").length,
                completed: rows.filter((occurrence) => occurrence.status === "completed").length,
                missed: rows.filter((occurrence) => occurrence.status === "missed").length,
              };
            }),
          }),
        },
        {
          role: "system",
          content: buildTaskRewardPolicyBlock(progress.free_pass_count),
        },
        { role: "system", content: TASK_ACTIONS_SYSTEM_MESSAGE },
        { role: "system", content: buildTaskCatalogPromptBlock() },
        { role: "system", content: capabilityPrompt },
        { role: "system", content: deviceContextMessage },
        { role: "system", content: inventoryContextMessage },
      ]
    : [];
  const minimalAuxiliaryMessages: HistoryMessage[] = [
    ...(promptRouteSystemMessage
      ? ([{ role: "system", content: promptRouteSystemMessage }] as HistoryMessage[])
      : []),
    ...(promptRouteMode === "relational_direct"
      ? ([{ role: "system", content: buildRecentTurnsContext(sanitizedMessages) }] as HistoryMessage[])
      : []),
  ];
  const observationMessages: HistoryMessage[] = [
    { role: "system", content: buildDialogueActPrompt(dialogueAct) },
    { role: "system", content: semanticGuidanceBlock },
    // Keep response-strategy guidance for structured rails, but do not push it into ordinary open conversation by default.
    ...(includeResponseStrategyPromptBlock
      ? ([{ role: "system", content: responseStrategyBlock }] as HistoryMessage[])
      : []),
    { role: "system", content: buildPromptRouteTurnPlanMessage(promptRouteMode, turnPlan) },
    ...(promptRouteMode === "default"
      ? ([{ role: "system", content: buildRecentTurnsContext(sanitizedMessages) }] as HistoryMessage[])
      : []),
    ...(promptRouteSystemMessage
      ? ([{ role: "system", content: promptRouteSystemMessage }] as HistoryMessage[])
      : []),
    {
      role: "system",
      content: [
        buildStateGuidanceBlock(
          conversationState.moodLabel,
          conversationState.relationshipLabel,
          toneProfile,
        ),
        `Awaiting user: ${conversationState.awaitingUser ? "yes" : "no"}`,
        `Verification just completed: ${conversationState.verificationJustCompleted ? "yes" : "no"}`,
      ].join("\n"),
    },
    { role: "system", content: observationTrustLine },
    { role: "system", content: observationPrompt },
    { role: "system", content: compactContext },
    ...(fixedMemoryBlock ? ([{ role: "system", content: fixedMemoryBlock }] as HistoryMessage[]) : []),
    ...taskRuntimeSystemMessages,
    { role: "system", content: longTermMemoryBlock },
    { role: "system", content: learnedUserProfileBlock },
  ];
  const sessionMessages = sessionMode
    ? ([{ role: "system", content: SESSION_CONVERSATION_SYSTEM_MESSAGE }] as HistoryMessage[])
    : [];
  const auxiliarySystemMessages = isMinimalVoicePrompt
    ? minimalAuxiliaryMessages
    : [...observationMessages, ...sessionMessages];

  const assembled = assemblePrompt({
    baseSystemMessages: systemMessages,
    auxiliarySystemMessages,
    incomingMessages: sanitizedMessages,
    conversationState: promptConversationState,
    stateBlockOverride: isMinimalVoicePrompt
      ? buildVoiceContinuityBlock(promptConversationState)
      : undefined,
    contextPolicy: {
      suppressPriorDialogue: false,
    },
  });

  if (!plannerEnabled) {
    return {
      messages: assembled.messages,
      promptDebug: assembled.debug,
      promptProfile,
      promptRouteMode,
    };
  }

  return {
    messages: [...assembled.messages, { role: "system", content: PLANNER_JSON_SYSTEM_MESSAGE }],
    promptDebug: assembled.debug,
    promptProfile,
    promptRouteMode,
  };
}

export async function POST(request: Request) {
  const routeStartedAtMs = Date.now();
  const emergencyStop = await getEmergencyStopSnapshot();
  if (await shouldBlockChatRoute(emergencyStop.stopped)) {
    return NextResponse.json({ error: CHAT_ROUTE_BLOCKED_ERROR }, { status: 403 });
  }

  let payload: ChatRequestBody;
  try {
    payload = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = rawMessages.filter(isValidMessage);
  const planner = parsePlannerRequest(payload.planner);
  const sessionMode = payload.sessionMode === true;
  const requestId = toSafeTraceId(payload.requestId, `chat-${Date.now()}`);
  const turnId = toSafeTraceId(payload.turnId, "none");
  const toneProfile: ToneProfile =
    payload.toneProfile === "dominant" || payload.toneProfile === "friendly"
      ? payload.toneProfile
      : "neutral";

  if (!isConsentComplete(payload.consent)) {
    return NextResponse.json(
      { error: "Consent is required. Complete the Consent Setup screen before using chat." },
      { status: 403 },
    );
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "At least one chat message is required." }, { status: 400 });
  }

  const userMessages = messages.filter((message) => message.role === "user");
  const hasAgeAmbiguity = userMessages.some((message) =>
    containsAgeAmbiguityTerms(message.content),
  );
  if (hasAgeAmbiguity) {
    return NextResponse.json(
      {
        error:
          "Age ambiguity or minor-related terms detected. Rephrase with clearly adult-only (21+) consensual context.",
      },
      { status: 400 },
    );
  }

  if (
    shouldNoopForNoNewUserMessage({
      messages,
      sessionMode,
      plannerEnabled: planner.enabled,
    })
  ) {
    return createStaticAssistantNdjsonResponse("", {
      ...buildChatTraceHeaders({
        requestId,
        turnId,
        generationPath: "noop",
        modelRan: false,
        deterministicRail: "no_new_user_message",
        postProcessed: false,
      }),
      "x-raven-noop": "1",
      "x-raven-noop-reason": "no_new_user_message",
    });
  }

  const conversationState: ConversationStateInput = {
    awaitingUser: asBoolean(payload.awaitingUser, false),
    userAnswered: asBoolean(payload.userAnswered, false),
    verificationJustCompleted: asBoolean(payload.verificationJustCompleted, false),
    sessionPhase: asString(payload.sessionPhase, sessionMode ? "build" : "chat"),
    moodLabel: asString(payload.moodLabel, "neutral"),
    relationshipLabel: asString(payload.relationshipLabel, "building"),
    lastAssistantOutput:
      typeof payload.lastAssistantOutput === "string" ? payload.lastAssistantOutput.trim() : null,
  };
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const turnInterpretation = interpretLiveRouteTurn({
    lastUserMessage: lastUserMessage?.content ?? "",
    awaitingUser: conversationState.awaitingUser,
    userAnswered: conversationState.userAnswered,
    verificationJustCompleted: conversationState.verificationJustCompleted,
    sessionPhase: conversationState.sessionPhase,
    previousAssistantMessage: conversationState.lastAssistantOutput,
    currentTopic: null,
  });
  const dialogueAct = turnInterpretation.dialogueAct;
  const selectedPlaybookIds = getSelectedPersonaPlaybookIds({
    dialogueAct,
    sessionPhase: conversationState.sessionPhase,
  });

  const model =
    typeof payload.model === "string" && payload.model.trim().length > 0
      ? payload.model.trim()
      : DEFAULT_SETTINGS.ollamaModel;
  const personaPackId =
    typeof payload.personaPackId === "string" && payload.personaPackId.trim().length > 0
      ? payload.personaPackId.trim()
      : DEFAULT_SETTINGS.personaPackId;
  const customPersona = personaPackId === "custom" ? loadCustomPersonaSpec() : null;
  const personaSteeringSystemMessage = customPersona
    ? buildCustomPersonaSteeringMessage(customPersona)
    : null;
  const baseUrl =
    typeof payload.baseUrl === "string" && payload.baseUrl.trim().length > 0
      ? payload.baseUrl.trim()
      : DEFAULT_SETTINGS.ollamaBaseUrl;
  const samplingOptions = normalizeSamplingOptions(payload, planner.enabled);

  const validatedBaseUrl = validateAndNormalizeLocalHttpBaseUrl(baseUrl);
  if (!validatedBaseUrl.ok) {
    return NextResponse.json({ error: validatedBaseUrl.error }, { status: 400 });
  }

  const sessionId = toSafeSessionId(payload.sessionId);
  const conversationStateSnapshot =
    payload.conversationState !== undefined
      ? normalizeConversationStateSnapshot(payload.conversationState, sessionId)
      : deriveConversationStateFromMessages({
          sessionId,
          messages,
          classifyUserIntent: turnInterpretation.classifyUserIntentForState,
          classifyRouteAct: turnInterpretation.classifyRouteActForState,
        });
  const activeInteractionBefore =
    normalizeActiveInteractionState(payload.activeInteraction) ?? null;
  const previousResponseBrief =
    normalizePreviousResponseBriefSummary(payload.previousResponseBrief);
  let liveTurnDiagnosticRecord = buildServerTurnDiagnosticRecord({
    requestId,
    turnId,
    sessionId,
    interpretationInput: {
      lastUserMessage: lastUserMessage?.content ?? "",
      awaitingUser: conversationState.awaitingUser,
      userAnswered: conversationState.userAnswered,
      verificationJustCompleted: conversationState.verificationJustCompleted,
      sessionPhase: conversationState.sessionPhase,
      previousAssistantMessage: conversationState.lastAssistantOutput,
      currentTopic: null,
    },
    messages,
    conversationStateSnapshot,
  });
  const canonicalTurnMove: ServerCanonicalTurnMove = buildServerCanonicalTurnMove({
    interpretation: turnInterpretation,
    diagnosticRecord: liveTurnDiagnosticRecord,
  });
  liveTurnDiagnosticRecord = buildServerTurnDiagnosticRecord({
    requestId,
    turnId,
    sessionId,
    interpretationInput: {
      lastUserMessage: lastUserMessage?.content ?? "",
      awaitingUser: conversationState.awaitingUser,
      userAnswered: conversationState.userAnswered,
      verificationJustCompleted: conversationState.verificationJustCompleted,
      sessionPhase: conversationState.sessionPhase,
      previousAssistantMessage: conversationState.lastAssistantOutput,
      currentTopic: null,
    },
    messages,
    conversationStateSnapshot,
    canonicalTurnMove,
  });
  const workingMemory = normalizeWorkingMemory(payload.workingMemory);
  const turnPlan = buildTurnPlan(messages, {
    conversationState: conversationStateSnapshot,
  });
  const semanticCandidateResult = planner.enabled || (lastUserMessage ? parseMemoryCommand(lastUserMessage.content) : null)
    ? { candidates: [], rejected: [] }
    : await generateLlmSemanticCandidates(
        {
          userText: lastUserMessage?.content ?? "",
          previousAssistantText: conversationState.lastAssistantOutput ?? previousAssistantText(messages),
          previousUserText: previousUserText(messages),
          currentTopic:
            conversationStateSnapshot.last_conversation_topic !== "none"
              ? conversationStateSnapshot.last_conversation_topic
              : null,
        },
        async (prompt) => {
          const response = await fetch(`${validatedBaseUrl.normalizedBaseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "system",
                  content:
                    "Return JSON only. Generate semantic interpretation candidates, never visible reply text.",
                },
                { role: "user", content: prompt },
              ],
              stream: false,
              options: {
                ...samplingOptions,
                temperature: 0.1,
                top_p: 0.7,
              },
            }),
          });
          if (!response.ok) {
            return "{\"candidates\":[]}";
          }
          const body = (await response.json().catch(() => null)) as {
            message?: { content?: unknown };
            response?: unknown;
          } | null;
          return typeof body?.message?.content === "string"
            ? body.message.content
            : typeof body?.response === "string"
              ? body.response
              : "{\"candidates\":[]}";
        },
      ).catch(() => ({ candidates: [], rejected: [] }));
  const canonicalTurnState = updateCanonicalTurnState({
    userText: lastUserMessage?.content ?? "",
    previousAssistantText: conversationState.lastAssistantOutput ?? previousAssistantText(messages),
    previousUserText: previousUserText(messages),
    currentTopic:
      conversationStateSnapshot.last_conversation_topic !== "none"
        ? conversationStateSnapshot.last_conversation_topic
        : null,
    llmSemanticCandidates: semanticCandidateResult.candidates,
    llmSemanticRejectedCandidates: semanticCandidateResult.rejected,
    activeInteraction: activeInteractionBefore,
  });
  const turnMeaning = canonicalTurnState.turn_meaning;
  const semanticMove = canonicalTurnState.planned_move;
  const responseStrategy = chooseResponseStrategy({
    turnPlan,
    conversationState: conversationStateSnapshot,
  });
  const responseStrategyBlock = buildResponseStrategyBlock(
    responseStrategy,
    conversationStateSnapshot,
  );
  const semanticGuidanceBlock = buildSemanticGuidanceBlock({
    turnMeaning,
    plannedMove: semanticMove,
    candidateSource: canonicalTurnState.semantic_arbitration.chosen_source,
  });
  const memoryPreferences = await getMemoryPreferencesFromDb();
  const memoryAutoSave =
    typeof payload.memoryAutoSave === "boolean"
      ? payload.memoryAutoSave
      : (memoryPreferences.auto_save ?? DEFAULT_MEMORY_AUTO_SAVE);
  const lastUserText = lastUserMessage?.content ?? "";
  const memoryText =
    typeof payload.memoryText === "string" && payload.memoryText.trim().length > 0
      ? payload.memoryText.trim()
      : planner.enabled
        ? ""
        : lastUserText;
  let extractedMemoryCandidates: ReturnType<typeof extractMemorySuggestions> = [];

  const memoryCommand = lastUserMessage ? parseMemoryCommand(lastUserMessage.content) : null;
  if (memoryCommand && !planner.enabled) {
    if (memoryCommand.type === "show") {
      const memories = await listLongTermMemories(12);
      const summary =
        memories.length === 0
          ? "No long-term memories saved yet."
          : [
              "Saved memories:",
              ...memories.map((memory) => `- ${memory.key}: ${memory.value}`),
            ].join("\n");
      await appendChatHistory("user", lastUserMessage?.content ?? "show memories", sessionId);
      await appendChatHistory("assistant", summary, sessionId);
      await persistSessionTurnSummary(
        sessionId,
        lastUserMessage?.content ?? "show memories",
        summary,
        conversationStateSnapshot,
        "memory_command",
      );
      return createStaticAssistantNdjsonResponse(summary, {
        ...buildChatTraceHeaders({
          requestId,
          turnId,
          generationPath: "memory-command",
          modelRan: false,
          deterministicRail: "memory_show",
          postProcessed: false,
        }),
      });
    }

    if (memoryCommand.type === "forget") {
      pendingForgetBySession.set(sessionId, {
        query: memoryCommand.text,
        expiresAt: Date.now() + FORGET_CONFIRM_TTL_MS,
      });
      const reply = `Confirm forget by sending: forget confirm: ${memoryCommand.text}`;
      await appendChatHistory(
        "user",
        lastUserMessage?.content ?? `forget ${memoryCommand.text}`,
        sessionId,
      );
      await appendChatHistory("assistant", reply, sessionId);
      await persistSessionTurnSummary(
        sessionId,
        lastUserMessage?.content ?? `forget ${memoryCommand.text}`,
        reply,
        conversationStateSnapshot,
        "memory_command",
      );
      return createStaticAssistantNdjsonResponse(reply, {
        ...buildChatTraceHeaders({
          requestId,
          turnId,
          generationPath: "memory-command",
          modelRan: false,
          deterministicRail: "memory_forget",
          postProcessed: false,
        }),
      });
    }

    if (memoryCommand.type === "forget_confirm") {
      const pendingForget = pendingForgetBySession.get(sessionId);
      if (
        !pendingForget ||
        pendingForget.expiresAt < Date.now() ||
        pendingForget.query.toLowerCase() !== memoryCommand.text.toLowerCase()
      ) {
        const reply = "No pending forget request to confirm. Send forget: <key or phrase> first.";
        await appendChatHistory("assistant", reply, sessionId);
        return createStaticAssistantNdjsonResponse(reply, {
          ...buildChatTraceHeaders({
            requestId,
            turnId,
            generationPath: "memory-command",
            modelRan: false,
            deterministicRail: "memory_forget_confirm_missing",
            postProcessed: false,
          }),
        });
      }
      pendingForgetBySession.delete(sessionId);
      const deleted = await forgetLongTermMemories(memoryCommand.text);
      const reply =
        deleted > 0
          ? `Removed ${deleted} memory item${deleted === 1 ? "" : "s"} matching "${memoryCommand.text}".`
          : `No saved memory matched "${memoryCommand.text}".`;
      await appendChatHistory(
        "user",
        lastUserMessage?.content ?? `forget confirm: ${memoryCommand.text}`,
        sessionId,
      );
      await appendChatHistory("assistant", reply, sessionId);
      await persistSessionTurnSummary(
        sessionId,
        lastUserMessage?.content ?? `forget confirm: ${memoryCommand.text}`,
        reply,
        conversationStateSnapshot,
        "memory_command",
      );
      return createStaticAssistantNdjsonResponse(reply, {
        ...buildChatTraceHeaders({
          requestId,
          turnId,
          generationPath: "memory-command",
          modelRan: false,
          deterministicRail: "memory_forget_confirm",
          postProcessed: false,
        }),
      });
    }

    const candidates = extractMemorySuggestions(memoryCommand.text);
    extractedMemoryCandidates = candidates;
    const candidate = candidates[0] ?? {
      key: "note",
      value: memoryCommand.text,
      type: "misc" as const,
      tags: [],
      importance: 0.7,
      stability: 0.7,
      confidence: 0.65,
      suggestion_kind: "new" as const,
    };
    const suggested = await createMemorySuggestion({
      key: candidate.key,
      value: candidate.value,
      type: candidate.type,
      tags: candidate.tags,
      importance: candidate.importance,
      stability: candidate.stability,
      confidence: candidate.confidence,
      suggestionKind: candidate.suggestion_kind,
      sourceSessionId: sessionId,
      sourceTurnId: null,
    });
    const reply = suggested
      ? `Memory suggestion created: ${candidate.key}: ${candidate.value} (approve it in Memory panel).`
      : `Memory suggestion ignored because it is already known or recently rejected.`;
    await appendChatHistory(
      "user",
      lastUserMessage?.content ?? `remember ${memoryCommand.text}`,
      sessionId,
    );
    await appendChatHistory("assistant", reply, sessionId);
    await persistSessionTurnSummary(
      sessionId,
      lastUserMessage?.content ?? `remember ${memoryCommand.text}`,
      reply,
      conversationStateSnapshot,
      "memory_command",
    );
    return createStaticAssistantNdjsonResponse(reply, {
      ...buildChatTraceHeaders({
        requestId,
        turnId,
        generationPath: "memory-command",
        modelRan: false,
        deterministicRail: "memory_remember",
        postProcessed: false,
      }),
    });
  }

  if (lastUserMessage && !planner.enabled) {
    await appendChatHistory("user", lastUserMessage.content, sessionId);
  }

  if (memoryText) {
    const candidates = extractMemorySuggestions(memoryText);
    extractedMemoryCandidates = candidates;
    const createSuggestions = !isSuggestionSnoozed(memoryPreferences);
    for (const candidate of candidates) {
      const shouldAutoSave = shouldAutoSaveCategory(candidate.type, {
        ...memoryPreferences,
        auto_save: memoryAutoSave,
      });
      if (shouldAutoSave) {
        await createLongTermMemory({
          key: candidate.key,
          value: candidate.value,
          type: candidate.type,
          tags: candidate.tags,
          importance: candidate.importance,
          stability: candidate.stability,
          confidence: candidate.confidence,
          sourceSessionId: sessionId,
          sourceTurnId: null,
        });
      } else if (createSuggestions) {
        await createMemorySuggestion({
          key: candidate.key,
          value: candidate.value,
          type: candidate.type,
          tags: candidate.tags,
          importance: candidate.importance,
          stability: candidate.stability,
          confidence: candidate.confidence,
          suggestionKind: candidate.suggestion_kind,
          sourceSessionId: sessionId,
          sourceTurnId: null,
        });
      }
    }
  }

  const observationForSignals =
    payload.observations && typeof payload.observations === "object"
      ? (payload.observations as { ts?: unknown; camera_available?: unknown })
      : null;
  const inferredObservation =
    observationForSignals &&
    typeof observationForSignals.ts === "number" &&
    typeof observationForSignals.camera_available === "boolean"
      ? (payload.observations as Parameters<typeof inferVisionSignalsStatusFromObservation>[0])
      : null;
  const clientVisionSignals = normalizeVisionSignalsStatus(payload.visionSignalsStatus);
  const effectiveVisionSignals =
    clientVisionSignals.detectors.length > 0
      ? clientVisionSignals
      : inferVisionSignalsStatusFromObservation(inferredObservation);
  const [customItems, observedObjectLabels] = await Promise.all([
    listCustomItemsWithRefsFromDb(),
    Promise.resolve(collectObjectLabelsFromObservationPayload(payload.observations)),
  ]);
  const customLabels = customItems.map((item) => item.label.toLowerCase());
  const objectLabelOptions = [...new Set([...observedObjectLabels, ...customLabels])];
  const capabilityCatalog = buildCapabilityCatalog(effectiveVisionSignals, {
    objectLabelOptions,
  });
  const allowedCheckTypes = capabilityCatalog.map((entry) => entry.capability_id);
  const capabilityPrompt = buildCapabilityCatalogPrompt(capabilityCatalog);
  const [debugMemories, debugSessionSummary, debugPendingSuggestions] = await Promise.all([
    listLongTermMemories(300),
    getLatestSessionSummary(sessionId),
    listMemorySuggestions("pending"),
  ]);
  const debugRetrievedMemories = selectRelevantMemories(debugMemories, memoryText, 10);
  const debugMemoryBlock = buildMemoryInjectionBlock({
    memories: debugRetrievedMemories,
    lastSessionSummary: debugSessionSummary?.summary ?? null,
    maxLines: 10,
  });
  setMemoryDebugEntry({
    sessionId,
    timestamp: Date.now(),
    extractedCandidates: extractedMemoryCandidates.map((candidate) => ({
      key: candidate.key,
      value: candidate.value,
      type: candidate.type,
      importance: candidate.importance,
      stability: candidate.stability,
      confidence: candidate.confidence,
      rationale: candidate.rationale,
    })),
    pendingSuggestions: debugPendingSuggestions.slice(0, 20).map((item) => ({
      id: item.id,
      key: item.key,
      value: item.value,
      status: item.status,
    })),
    retrievedMemories: debugRetrievedMemories.map((item) => ({
      id: item.id,
      key: item.key,
      value: item.value,
      type: item.type,
    })),
    injectedMemoryBlock: debugMemoryBlock,
  });

  let sessionReplayDebugContext: SessionReplayDebugContext | null = null;

  const sessionReplayResult = await maybeHandleSessionReplayDeterministicBypass({
    sessionMode,
    plannerEnabled: planner.enabled,
    lastUserMessage,
    messages,
    inventory: payload.inventory,
    deviceOptIn: payload.deviceOptIn === true,
    observations: payload.observations,
    emergencyStopStopped: emergencyStop.stopped,
    workingMemory,
    lastAssistantOutput: conversationState.lastAssistantOutput,
    conversationStateSnapshot,
    activeInteraction: activeInteractionBefore,
    previousResponseBrief,
    toneProfile,
    turnPlan,
    requestId,
    turnId,
    sessionId,
    capabilityCatalog,
    allowedCheckTypes,
    diagnosticRecord: liveTurnDiagnosticRecord,
    canonicalTurnMove,
    logSessionRouteDebug,
    maybePersistTaskFromAssistantText: persistTaskFromAssistantText,
    appendChatHistory,
    persistSessionTurnSummary,
    createStaticAssistantNdjsonResponse,
    buildChatTraceHeaders,
  });
  sessionReplayDebugContext = sessionReplayResult.sessionReplayDebugContext;
  liveTurnDiagnosticRecord = sessionReplayResult.diagnosticRecord ?? liveTurnDiagnosticRecord;
  if (sessionReplayResult.response) {
    return sessionReplayResult.response;
  }

  const preparedPrompt = await buildPreparedMessages(
    messages,
    planner.enabled,
    sessionMode,
    toneProfile,
    dialogueAct,
    conversationState,
    payload.observations,
    capabilityPrompt,
    buildDeviceContextMessage({
      connected: getDeviceService().getStatus().connected,
      optIn: payload.deviceOptIn === true,
      emergencyStop: emergencyStop.stopped,
      devices: getDeviceService().listDevices(),
      lastExecutionSummary:
        typeof payload.deviceExecutionSummary === "string" ? payload.deviceExecutionSummary : null,
    }),
    buildSessionInventoryContextMessage(normalizeSessionInventory(payload.inventory)),
    typeof payload.verificationSummary === "string" && payload.verificationSummary.trim().length > 0
      ? payload.verificationSummary.trim()
      : findVerificationSummary(messages),
    buildObservationTrustGuardLine(evaluateObservationTrust(payload.observations)),
    memoryText,
    sessionId,
    personaPackId,
    personaSteeringSystemMessage,
    turnPlan,
    conversationStateSnapshot,
    responseStrategyBlock,
    semanticGuidanceBlock,
  );
  const promptDebugEntry = {
    sessionId,
    timestamp: Date.now(),
    promptProfile: preparedPrompt.promptProfile,
    promptRouteMode: preparedPrompt.promptRouteMode,
    stateSnapshot: preparedPrompt.promptDebug.stateSnapshot,
    responseStrategy,
    semanticCandidateSource: canonicalTurnState.semantic_arbitration.chosen_source,
    semanticCandidateRejections: canonicalTurnState.semantic_arbitration.rejected_candidates.map(
      (candidate) => candidate.reason,
    ),
    promptSizeEstimate: preparedPrompt.promptDebug.promptSizeEstimate,
    includedTurns: preparedPrompt.promptDebug.includedTurns,
    excludedTurns: preparedPrompt.promptDebug.excludedTurns,
    includedContext: preparedPrompt.promptDebug.includedContext,
    assembledPromptPreview: preparedPrompt.messages.map(
      (message) => `${message.role}: ${message.content.slice(0, 220)}`,
    ),
    assembledPromptMessages: preparedPrompt.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
  setPromptDebugEntry(promptDebugEntry);

  const upstreamFetch = await fetchWithTimeout(`${validatedBaseUrl.normalizedBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: preparedPrompt.messages,
        stream: false,
        options: samplingOptions,
      }),
    }, planner.enabled ? PLANNER_TIMEOUT_MS : MODEL_TIMEOUT_MS);
  if (!upstreamFetch.response) {
    return createHandledAuthorityErrorNdjsonResponse({
      errorCategory: upstreamFetch.timedOut ? "model_timeout" : "model_unavailable",
      blockedReason: planner.enabled
        ? upstreamFetch.timedOut
          ? "planner_timeout"
          : "planner_model_unavailable"
        : upstreamFetch.timedOut
          ? "model_timeout"
          : "model_unavailable",
      rawResponseShape: {
        upstream_response_present: false,
        timed_out: upstreamFetch.timedOut,
        elapsed_ms: upstreamFetch.elapsedMs,
        error: upstreamFetch.error,
        planner_enabled: planner.enabled,
      },
      routeDebug: {
        route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
        planner_strategy: planner.enabled ? "interpret_then_lead" : "none",
        planner_step_valid: planner.enabled ? false : "not_applicable",
        planner_error_category: planner.enabled ? "planner_validation_error" : null,
        response_brief_created: false,
        visible_authority_commit_attempted: false,
        planner_timeout_ms: PLANNER_TIMEOUT_MS,
        model_timeout_ms: MODEL_TIMEOUT_MS,
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
      extra: {
        upstream_elapsed_ms: upstreamFetch.elapsedMs,
        planner_timeout_ms: PLANNER_TIMEOUT_MS,
        model_timeout_ms: MODEL_TIMEOUT_MS,
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
    });
  }

  const upstreamResponse = upstreamFetch.response;
  if (!upstreamResponse.ok) {
    const details = await upstreamResponse.text();
    return createHandledAuthorityErrorNdjsonResponse({
      errorCategory: "model_unavailable",
      blockedReason: planner.enabled ? "planner_model_unavailable" : "model_unavailable",
      rawResponseShape: {
        upstream_status: upstreamResponse.status,
        details: details.slice(0, 500),
        planner_enabled: planner.enabled,
      },
      routeDebug: {
        route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
        planner_strategy: planner.enabled ? "interpret_then_lead" : "none",
        planner_step_valid: planner.enabled ? false : "not_applicable",
        planner_error_category: planner.enabled ? "planner_validation_error" : null,
        response_brief_created: false,
        visible_authority_commit_attempted: false,
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
      extra: {
        upstream_status: upstreamResponse.status,
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
    });
  }

  if (planner.enabled) {
    const upstreamBody = (await upstreamResponse.json().catch(() => null)) as {
      message?: { content?: unknown };
      response?: unknown;
    } | null;

    const rawPlannerText =
      typeof upstreamBody?.message?.content === "string"
        ? upstreamBody.message.content
        : typeof upstreamBody?.response === "string"
          ? upstreamBody.response
          : "";

    const parsed = parseAndValidatePlannedStep(rawPlannerText, planner.stepIndex, {
      allowedCheckTypes,
    });
    if (!parsed.ok) {
      const missingFields =
        parsed.missingFields && parsed.missingFields.length > 0
          ? parsed.missingFields
          : ["say", "onPassSay", "onFailSay"];
      return createHandledAuthorityErrorNdjsonResponse({
          errorCategory: "planner_validation_error",
          blockedReason: "planner_step_missing_required_fields",
          serverCommitPath: "missing",
          rawResponseShape: {
            planner_enabled: true,
            raw_present: Boolean(rawPlannerText.trim()),
            validation_error: parsed.error,
            route_elapsed_ms: Date.now() - routeStartedAtMs,
          },
          plannerError: {
            missing_fields: missingFields,
            planner_path: "api_chat_planner",
            strategy: "interpret_then_lead",
          },
          routeDebug: {
            route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
            planner_strategy: "interpret_then_lead",
            planner_step_valid: false,
            planner_error_category: "planner_validation_error",
            response_brief_created: false,
            visible_authority_commit_attempted: false,
            ndjson_error_payload_sent: true,
            route_elapsed_ms: Date.now() - routeStartedAtMs,
          },
          extra: {
            route_elapsed_ms: Date.now() - routeStartedAtMs,
          },
        });
    }

    const validated = validatePlannerStepAgainstCatalog(
      parsed.step,
      allowedCheckTypes,
      capabilityCatalog,
    );

    logSessionRouteDebug({
      stage: "route_authority_contract",
      route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
      planner_strategy: "interpret_then_lead",
      planner_step_valid: true,
      planner_error_category: null,
      response_brief_created: false,
      visible_authority_commit_attempted: false,
      server_authority_sentinel_attached: false,
      ndjson_assistant_payload_sent: false,
      ndjson_error_payload_sent: false,
    });
    return NextResponse.json({
      step: validated.step,
      fallback: false,
      raw: rawPlannerText,
      validation: validated.validation,
    });
  }

  const upstreamBody = (await upstreamResponse.json().catch(() => null)) as {
    message?: { content?: unknown };
    response?: unknown;
  } | null;
  const rawAssistantText =
    typeof upstreamBody?.message?.content === "string"
      ? upstreamBody.message.content
      : typeof upstreamBody?.response === "string"
        ? upstreamBody.response
        : "";
  const rawGameStartInspection = inspectGameStartContract(rawAssistantText);
  if (payload.debugRawModel === true) {
    setPromptDebugEntry({
      ...promptDebugEntry,
      modelTrace: {
        rawModelOutput: rawAssistantText,
        shapedOutput: rawAssistantText,
        finalAssistantOutput: rawAssistantText,
        shapeReason: null,
        finalOutputSource: "raw_model_debug",
        preservedModelVoice: true,
        criticReasons: [],
        appCandidates: [
          {
            source: "raw_model_output",
            text: rawAssistantText,
            selected: true,
          },
        ],
      },
    });
    return NextResponse.json({
      sessionId,
      promptProfile: preparedPrompt.promptProfile,
      promptRouteMode: preparedPrompt.promptRouteMode,
      responseStrategy,
      promptSizeEstimate: preparedPrompt.promptDebug.promptSizeEstimate,
      selectedPlaybookIds,
      assembledPromptMessages: preparedPrompt.messages,
      rawModelOutput: rawAssistantText,
      rawGameStartDetected: rawGameStartInspection.detected,
      rawGameStartFirstPromptPresent: rawGameStartInspection.hasPlayablePrompt,
    });
  }
  const allowFreshGreetingOpener = preparedPrompt.promptRouteMode === "fresh_greeting";
  const shaped = shapeAssistantOutput({
    rawText: rawAssistantText,
    lastUserMessage: lastUserMessage?.content ?? "",
    lastAssistantOutput: conversationState.lastAssistantOutput,
    toneProfile,
    dialogueAct,
    dominantAddressTerm: customPersona?.address_term ?? null,
    allowFreshGreetingOpener,
  });
  const postShapeCritic = evaluateImmersionQuality({
    text: shaped.text,
    lastUserMessage: lastUserMessage?.content ?? "",
    toneProfile,
    dialogueAct,
    dominantAddressTerm: customPersona?.address_term ?? null,
    allowFreshGreetingOpener,
  });
  const modelRepairResolution = resolveRepairTurn({
    userText: lastUserMessage?.content ?? "",
    previousAssistantText: conversationState.lastAssistantOutput ?? previousAssistantText(messages),
    previousUserText: previousUserText(messages),
    currentTopic:
      conversationStateSnapshot.last_conversation_topic !== "none"
        ? conversationStateSnapshot.last_conversation_topic
        : null,
  });
  const baseResponseHeaders: Record<string, string> = {
    ...buildChatTraceHeaders({
      requestId,
      turnId,
      generationPath: "model",
      modelRan: true,
      deterministicRail: null,
      postProcessed: false,
    }),
    "x-raven-dialogue-act": dialogueAct,
    "x-raven-session-phase": conversationState.sessionPhase,
    "x-raven-response-strategy": responseStrategy,
    "x-raven-playbooks": encodeHeaderList(selectedPlaybookIds),
    "x-raven-shape-reason": shaped.reason ?? "none",
    "x-raven-critic-reasons": encodeHeaderList(postShapeCritic.reasons),
    ...buildRepairDebugHeaders(modelRepairResolution),
    "x-raven-turn-plan": `${turnPlan.requiredMove}:${turnPlan.requestedAction}`,
    "x-raven-turn-meaning": `${turnMeaning.speech_act}:${turnMeaning.subject_domain}:${turnMeaning.requested_operation}`,
    "x-raven-semantic-move": `${semanticMove.move}:${semanticMove.content_key}`,
    "x-raven-semantic-candidate-source": canonicalTurnState.semantic_arbitration.chosen_source,
    "x-raven-semantic-rejections": encodeHeaderList(
      canonicalTurnState.semantic_arbitration.rejected_candidates.map(
        (candidate) => candidate.reason,
      ),
    ),
    "x-raven-shape-source": shaped.debug?.selectedSource ?? "model",
    "x-raven-prompt-profile": preparedPrompt.promptProfile,
    "x-raven-prompt-route": preparedPrompt.promptRouteMode,
  };

  const appCandidates = [
    {
      source: "buildDeterministicDominantWeakInputReply",
      text: shaped.debug?.deterministicWeakCandidate ?? null,
      selected: shaped.debug?.selectedSource === "deterministic_weak_input",
    },
    {
      source: "fallbackSentenceForDialogueAct",
      text: shaped.debug?.dialogueFallbackCandidate ?? null,
      selected:
        shaped.debug?.selectedSource === "dialogue_fallback" ||
        shaped.debug?.selectedSource === "dominant_contract",
    },
    {
      source: "buildHumanQuestionFallback",
      text: shaped.debug?.questionFallbackCandidate ?? null,
      selected: false,
    },
    {
      source: "shapeAssistantOutput",
      text: shaped.text,
      selected: false,
    },
  ];

  if (shaped.noop) {
    setPromptDebugEntry({
      ...promptDebugEntry,
      modelTrace: {
        rawModelOutput: rawAssistantText,
        shapedOutput: shaped.text,
        finalAssistantOutput: "",
        shapeReason: shaped.reason ?? null,
        finalOutputSource: "noop",
        preservedModelVoice: shaped.debug?.preservedModelVoice ?? false,
        criticReasons: postShapeCritic.reasons,
        appCandidates,
      },
    });
    return createStaticAssistantNdjsonResponse("", {
      ...baseResponseHeaders,
      "x-raven-post-processed": "1",
      "x-raven-noop": "1",
      "x-raven-noop-reason": shaped.reason ?? "no_op",
    });
  }

  if (!shaped.text) {
    return createHandledAuthorityErrorNdjsonResponse({
      errorCategory: "renderer_validation_error",
      blockedReason: "empty_assistant_response",
      rawResponseShape: {
        raw_present: Boolean(rawAssistantText.trim()),
        shape_reason: shaped.reason ?? null,
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
      routeDebug: {
        route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
        planner_strategy: "none",
        planner_step_valid: "not_applicable",
        planner_error_category: null,
        response_brief_created: false,
        visible_authority_commit_attempted: false,
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
      extra: {
        route_elapsed_ms: Date.now() - routeStartedAtMs,
      },
    });
  }
  let finalAssistantText = shaped.text;
  let finalOutputSource = "model";
  const routeReplacementChain: Array<{
    oldText: string;
    newText: string;
    reason: string;
    sourcePath: string;
  }> = [];
  const freshGreetingGuard = applyFreshGreetingGuard({
    text: finalAssistantText,
    lastUserMessage: lastUserMessage?.content ?? "",
    promptRouteMode: preparedPrompt.promptRouteMode,
    currentMode: conversationStateSnapshot.current_mode,
    pendingModification: conversationStateSnapshot.pending_modification,
    lastUserIntent: conversationStateSnapshot.last_user_intent,
    sceneScope: sessionReplayDebugContext?.sceneScope ?? "open_conversation",
    sceneTopicLocked: sessionReplayDebugContext?.sceneTopicLocked ?? false,
    taskHardLockActive: sessionReplayDebugContext?.taskHardLockActive ?? false,
  });
  if (freshGreetingGuard.changed) {
    finalAssistantText = freshGreetingGuard.text;
    finalOutputSource = "freshGreetingGuard";
    baseResponseHeaders["x-raven-fresh-greeting-guard"] = freshGreetingGuard.reason ?? "normalized";
  } else {
    baseResponseHeaders["x-raven-fresh-greeting-guard"] = "pass";
  }
  const turnPlanCheck = isTurnPlanSatisfied(turnPlan, finalAssistantText);
  if (!turnPlanCheck.ok) {
    if (
      !shouldKeepCoherentModelReply({
        text: finalAssistantText,
        state: conversationStateSnapshot,
        lastUserMessage: lastUserMessage?.content ?? "",
        turnPlan,
      })
    ) {
      finalAssistantText = buildTurnPlanFallback(turnPlan, toneProfile);
      finalOutputSource = "buildTurnPlanFallback";
      baseResponseHeaders["x-raven-turn-plan-check"] = `fallback:${turnPlanCheck.reason}`;
    } else {
      baseResponseHeaders["x-raven-turn-plan-check"] = `kept:${turnPlanCheck.reason}`;
    }
  } else {
    baseResponseHeaders["x-raven-turn-plan-check"] = `pass:${turnPlanCheck.reason}`;
  }
  const recentAssistantReplies = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .slice(-4);
  const repetitionCheck = detectStaleResponseReuse(finalAssistantText, recentAssistantReplies);
  const preserveAnsweredQuestion =
    shouldPreserveAnsweredQuestionAgainstRepetitionFallback({
      repetitionCheck,
      turnPlanRequiredMove: turnPlan.requiredMove,
      turnPlanCheck,
    });
  if (repetitionCheck.repeated && !preserveAnsweredQuestion) {
    finalAssistantText =
      turnPlan.requiredMove === "answer_user_question"
        ? buildTurnPlanFallback(turnPlan, toneProfile)
        : buildContinuityRecoveryReply({
            strategy: responseStrategy,
            state: conversationStateSnapshot,
            lastUserMessage: lastUserMessage?.content ?? "",
            toneProfile,
          });
    finalOutputSource =
      turnPlan.requiredMove === "answer_user_question"
        ? "buildTurnPlanFallback"
        : "buildContinuityRecoveryReply";
    baseResponseHeaders["x-raven-repetition-check"] = `fallback:${repetitionCheck.reason}`;
  } else if (preserveAnsweredQuestion) {
    // Keep a valid fresh question answer instead of replacing it with a weaker fallback.
    baseResponseHeaders["x-raven-repetition-check"] = `kept:${repetitionCheck.reason}`;
  } else {
    baseResponseHeaders["x-raven-repetition-check"] = `pass:${repetitionCheck.reason}`;
  }

  const persisted = await persistTaskFromAssistantText({
    text: finalAssistantText,
    lastUserText: lastUserMessage?.content ?? "",
    allowedCheckTypes,
    sessionMode,
    capabilityCatalog,
    sessionId,
    turnId,
  });
  finalAssistantText = persisted.text;
  const createdTaskId = persisted.createdTaskId;
  const finalLeakScrub = scrubVisibleInternalLeakText(finalAssistantText);
  if (finalLeakScrub.changed) {
    // Final defense-in-depth: never return planner/runtime residue on the normal model path.
    if (finalLeakScrub.blocked) {
      finalAssistantText =
        turnPlan.requiredMove === "answer_user_question"
          ? buildTurnPlanFallback(turnPlan, toneProfile)
          : buildContinuityRecoveryReply({
              strategy: responseStrategy,
              state: conversationStateSnapshot,
              lastUserMessage: lastUserMessage?.content ?? "",
              toneProfile,
            });
      finalOutputSource =
        turnPlan.requiredMove === "answer_user_question"
          ? "buildTurnPlanFallback"
          : "buildContinuityRecoveryReply";
      baseResponseHeaders["x-raven-final-leak-scrub"] = "fallback";
    } else {
      finalAssistantText = finalLeakScrub.text;
      finalOutputSource = "finalLeakScrub";
      baseResponseHeaders["x-raven-final-leak-scrub"] = "scrubbed";
    }
  } else {
    baseResponseHeaders["x-raven-final-leak-scrub"] = "pass";
  }
  const answerPlan = planDomainAnswer({ turnMeaning, plannedMove: semanticMove });
  const responseBrief = buildResponseBrief({
    turnMeaning,
    plannedMove: semanticMove,
    answerIntent: answerPlan.answer_intent,
    previousBrief: previousResponseBrief,
    activeInteraction: activeInteractionBefore,
    sourceTurnId: requestId,
  });
  type RouteAssistantOutputQuality =
    | "valid_model_reply"
    | "valid_fallback_reply"
    | "repaired_reply"
    | "rejected_internal_leak"
    | "fallback_plan_leak"
    | "generic_assistant_voice"
    | "failed_fulfillment"
    | "unknown";
  const ordinaryOrRelationalRender =
    turnMeaning.current_domain_handler === "conversation" ||
    turnMeaning.current_domain_handler === "relational_dynamics" ||
    semanticMove.content_key === "greeting_open" ||
    semanticMove.content_key === "current_status_answer" ||
    semanticMove.content_key === "clarification_answer" ||
    semanticMove.content_key === "conversation_continue" ||
    semanticMove.content_key === "reciprocal_user_probe";
  let responseBriefValidation = validateReplyAgainstBrief(finalAssistantText, responseBrief);
  let assistantOutputQuality: RouteAssistantOutputQuality =
    finalOutputSource === "model" && responseBriefValidation.ok
      ? "valid_model_reply"
      : "unknown";
  let assistantOutputContextEligible =
    assistantOutputQuality === "valid_model_reply";
  let llmRendererRetryUsed = false;
  let llmRendererError: string | null = null;
  const shouldRetryApprovedRenderer = ordinaryOrRelationalRender;
  if (shouldRetryApprovedRenderer) {
    llmRendererRetryUsed = true;
    const rendererPrompt = buildResponseBriefPrompt(responseBrief, responseBriefValidation);
    const rendererFetch = await fetchWithTimeout(`${validatedBaseUrl.normalizedBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SESSION_CONVERSATION_SYSTEM_MESSAGE },
          { role: "user", content: rendererPrompt },
        ],
        stream: false,
        options: samplingOptions,
      }),
    }, RENDERER_TIMEOUT_MS);
    const rendererResponse = rendererFetch.response;
    if (rendererResponse?.ok) {
      const rendererBody = (await rendererResponse.json().catch(() => null)) as {
        message?: { content?: unknown };
        response?: unknown;
      } | null;
      const rendererText =
        typeof rendererBody?.message?.content === "string"
          ? rendererBody.message.content.trim()
          : typeof rendererBody?.response === "string"
            ? rendererBody.response.trim()
            : "";
      const rendererValidation = validateReplyAgainstBrief(rendererText, responseBrief);
      if (rendererText && rendererValidation.ok) {
        const oldText = finalAssistantText;
        finalAssistantText = rendererText;
        finalOutputSource = "llm_brief_realizer";
        responseBriefValidation = rendererValidation;
        assistantOutputQuality = "valid_model_reply";
        assistantOutputContextEligible = true;
        routeReplacementChain.push({
          oldText,
          newText: finalAssistantText,
          reason: "response_brief_llm_renderer_retry",
          sourcePath: "routeApprovedLlmRendererRetry",
        });
        baseResponseHeaders["x-raven-response-brief-renderer-retry"] = "pass";
      } else {
        llmRendererError = rendererText
          ? `validation_failed:${rendererValidation.reason}`
          : "empty_renderer_response";
        baseResponseHeaders["x-raven-response-brief-renderer-retry"] =
          `failed:${rendererValidation.reason}`;
      }
    } else {
      llmRendererError = rendererFetch.timedOut ? "model_timeout" : "model_unavailable";
      baseResponseHeaders["x-raven-response-brief-renderer-retry"] =
        rendererFetch.timedOut ? "failed:model_timeout" : "failed:model_unavailable";
    }
  } else {
    baseResponseHeaders["x-raven-response-brief-renderer-retry"] = "not_needed";
  }
  const softAcceptableConversationCandidate =
    ordinaryOrRelationalRender &&
    (finalOutputSource === "model" || finalOutputSource === "llm_brief_realizer") &&
    !responseBriefValidation.ok &&
    responseBriefValidation.failures.length > 0 &&
    responseBriefValidation.failures.every((failure) => failure.startsWith("missing_must_address:")) &&
    !/\b(?:answer_mode|requested_facet|ResponseBrief|nonvisible_|current_step_summary|Planner step|fallback plan)\b/i.test(
      finalAssistantText,
    ) &&
    !visibleTextImpliesUnlimitedConsent(finalAssistantText);
  if (responseBriefValidation.failures.includes("generic_assistant_voice")) {
    assistantOutputQuality = "generic_assistant_voice";
    assistantOutputContextEligible = false;
  }
  if (softAcceptableConversationCandidate) {
    responseBriefValidation = {
      ok: true,
      reason: "conversation_model_candidate_soft_accept",
      failures: [],
    };
    assistantOutputQuality = "valid_model_reply";
    assistantOutputContextEligible = true;
    routeReplacementChain.push({
      oldText: finalAssistantText,
      newText: finalAssistantText,
      reason: "response_brief_soft_accept_conversational_model_candidate",
      sourcePath: "routeResponseBriefSoftAccept",
    });
    baseResponseHeaders["x-raven-response-brief-soft-accept"] = "missing_must_address_only";
  } else {
    baseResponseHeaders["x-raven-response-brief-soft-accept"] = "pass";
  }
  const modelPathNeedsBriefRepair =
    turnMeaning.current_domain_handler === "relational_dynamics" &&
    (!responseBriefValidation.ok ||
      /\bKeep going\b|\bStay with the concrete part\b|\bconcrete part of open\b|\bcurrent checkpoint\b|\brock\s+paper\s+scissors\b/i.test(
        finalAssistantText,
      ));
  if (modelPathNeedsBriefRepair) {
    if (ordinaryOrRelationalRender && llmRendererRetryUsed) {
      assistantOutputQuality = "failed_fulfillment";
      assistantOutputContextEligible = false;
      routeReplacementChain.push({
        oldText: finalAssistantText,
        newText: finalAssistantText,
        reason: `response_brief_repair_blocked_after_llm_retry:${responseBriefValidation.reason}`,
        sourcePath: "routeResponseBriefRepair",
      });
    } else {
      const oldText = finalAssistantText;
      const briefRepair = realizeResponseFromBrief({
        brief: responseBrief,
        llmCandidate: finalAssistantText,
      });
      finalAssistantText = briefRepair.text;
      finalOutputSource = briefRepair.content_realizer;
      responseBriefValidation = briefRepair.validation_result;
      assistantOutputQuality = briefRepair.assistant_output_quality;
      assistantOutputContextEligible = briefRepair.assistant_output_context_eligible;
      routeReplacementChain.push({
        oldText,
        newText: finalAssistantText,
        reason: "response_brief_repair",
        sourcePath: "routeResponseBriefRepair",
      });
    }
    baseResponseHeaders["x-raven-response-brief-repair"] =
      responseBriefValidation.ok ? "repaired" : `failed:${responseBriefValidation.reason}`;
  } else {
    baseResponseHeaders["x-raven-response-brief-repair"] = "pass";
  }
  const repeatedAnswerSimilarity = substantiveSimilarity(
    finalAssistantText,
    previousAssistantText(messages),
  );
  let repeatedAnswerDetected = false;
  let repetitionRepairUsed = false;
  if (
    turnMeaning.current_domain_handler === "relational_dynamics" &&
    turnMeaning.dynamic_slots?.state_delta_type &&
    repeatedAnswerSimilarity >= 0.58
  ) {
    repeatedAnswerDetected = true;
    const oldText = finalAssistantText;
    const repaired = realizeResponseFromBrief({
      brief: {
        ...responseBrief,
        required_novelty_reason:
          responseBrief.required_novelty_reason ??
          `Do not repeat the previous answer. Address the new user delta: ${turnMeaning.dynamic_slots.state_delta_summary ?? "new state"}.`,
        must_address: Array.from(
          new Set([
            ...responseBrief.must_address,
            "revised answer",
            "experience level",
          ]),
        ),
      },
    });
    finalAssistantText = repaired.text;
    finalOutputSource = repaired.content_realizer;
    responseBriefValidation = repaired.validation_result;
    assistantOutputQuality = repaired.assistant_output_quality;
    assistantOutputContextEligible = repaired.assistant_output_context_eligible;
    repetitionRepairUsed = true;
    routeReplacementChain.push({
      oldText,
      newText: finalAssistantText,
      reason: "repetition_repair_state_delta",
      sourcePath: "routeResponseBriefRepetitionRepair",
    });
    baseResponseHeaders["x-raven-repetition-repair"] = "state-delta";
  } else {
    baseResponseHeaders["x-raven-repetition-repair"] = "pass";
  }
  let routeContentRealizer =
    finalOutputSource === "llm_brief_realizer" ||
    finalOutputSource === "deterministic_brief_fallback"
      ? finalOutputSource
      : finalOutputSource === "model" && responseBriefValidation.ok
        ? "llm_brief_realizer"
        : null;
  let visibleAuthority = selectVisibleOutputOwner({
    turnMeaning,
    plannedMove: semanticMove,
    activeInteraction: activeInteractionBefore,
    candidateSource: finalOutputSource,
    finalSource: finalOutputSource,
    responseBriefId: responseBrief.brief_id,
    contentRealizer: routeContentRealizer,
    replacementChain: routeReplacementChain,
    assistantOutputQuality,
    assistantOutputContextEligible,
    requestFulfilled: responseBriefValidation.ok && assistantOutputContextEligible,
    candidates: [
      recordVisibleCandidate("raw_model", rawAssistantText, "raw_model", {
        selected: finalOutputSource === "model",
      }),
      recordVisibleCandidate(finalOutputSource, finalAssistantText, finalOutputSource === "deterministic_brief_fallback" ? "response_brief" : /fallback|guard|deterministic|scaffold|turnPlan/i.test(finalOutputSource) ? "legacy" : "response_brief", {
        selected: true,
        owner: routeContentRealizer === "llm_brief_realizer"
          ? "approved_llm_renderer_from_response_brief"
          : routeContentRealizer === "deterministic_brief_fallback"
            ? "approved_response_brief_fallback"
            : null,
        visible_safe:
          responseBriefValidation.ok &&
          Boolean(routeContentRealizer) &&
          assistantOutputContextEligible,
        internal_source_type: routeContentRealizer ? "visible_safe" : undefined,
      }),
    ],
  });
  if (
    visibleAuthority.final_visible_owner === "blocked" ||
    visibleTextImpliesUnlimitedConsent(finalAssistantText)
  ) {
    const oldText = finalAssistantText;
    if (ordinaryOrRelationalRender && llmRendererRetryUsed) {
      assistantOutputQuality = "failed_fulfillment";
      assistantOutputContextEligible = false;
    } else {
      const authorityRepair = realizeResponseFromBrief({ brief: responseBrief });
      finalAssistantText = authorityRepair.text;
      finalOutputSource = authorityRepair.content_realizer;
      routeContentRealizer = authorityRepair.content_realizer;
      responseBriefValidation = authorityRepair.validation_result;
      assistantOutputQuality = authorityRepair.assistant_output_quality;
      assistantOutputContextEligible = authorityRepair.assistant_output_context_eligible;
    }
    routeReplacementChain.push({
      oldText,
      newText: finalAssistantText,
      reason: visibleTextImpliesUnlimitedConsent(oldText)
        ? "unsafe_unlimited_consent_text"
        : "visible_output_authority_legacy_emitter_blocked",
      sourcePath: "routeVisibleOutputAuthority",
    });
    visibleAuthority = selectVisibleOutputOwner({
      turnMeaning,
      plannedMove: semanticMove,
      activeInteraction: activeInteractionBefore,
      candidateSource: "route_visible_output_authority",
      finalSource: finalOutputSource,
      responseBriefId: responseBrief.brief_id,
      contentRealizer: routeContentRealizer,
      replacementChain: routeReplacementChain,
      assistantOutputQuality,
      assistantOutputContextEligible,
      requestFulfilled: responseBriefValidation.ok && assistantOutputContextEligible,
      candidates: [
        recordVisibleCandidate("raw_model", rawAssistantText, "raw_model"),
        recordVisibleCandidate("route_visible_output_authority", finalAssistantText, "response_brief", {
          selected: true,
          owner: routeContentRealizer === "llm_brief_realizer"
            ? "approved_llm_renderer_from_response_brief"
            : "approved_response_brief_fallback",
          visible_safe: responseBriefValidation.ok && assistantOutputContextEligible,
          internal_source_type: "visible_safe",
        }),
      ],
    });
    baseResponseHeaders["x-raven-visible-output-authority"] = "repaired";
  } else {
    baseResponseHeaders["x-raven-visible-output-authority"] = visibleAuthority.final_visible_owner;
  }
  let visibleCommitDecision = commitVisibleOutput({
    decision: visibleAuthority,
    text: finalAssistantText,
    candidate: visibleAuthority.final_visible_candidate,
  });
  if (!visibleCommitDecision.allow) {
    const oldText = finalAssistantText;
    if (ordinaryOrRelationalRender && llmRendererRetryUsed) {
      assistantOutputQuality = "failed_fulfillment";
      assistantOutputContextEligible = false;
    } else {
      const commitRepair = realizeResponseFromBrief({ brief: responseBrief });
      finalAssistantText = commitRepair.text;
      finalOutputSource = commitRepair.content_realizer;
      routeContentRealizer = commitRepair.content_realizer;
      responseBriefValidation = commitRepair.validation_result;
      assistantOutputQuality = commitRepair.assistant_output_quality;
      assistantOutputContextEligible = commitRepair.assistant_output_context_eligible;
    }
    routeReplacementChain.push({
      oldText,
      newText: finalAssistantText,
      reason: `visible_commit_rejected_${visibleCommitDecision.reason}`,
      sourcePath: "routeVisibleCommitAuthority",
    });
    visibleAuthority = selectVisibleOutputOwner({
      turnMeaning,
      plannedMove: semanticMove,
      activeInteraction: activeInteractionBefore,
      candidateSource: "route_visible_commit_authority",
      finalSource: finalOutputSource,
      responseBriefId: responseBrief.brief_id,
      contentRealizer: routeContentRealizer,
      replacementChain: routeReplacementChain,
      assistantOutputQuality,
      assistantOutputContextEligible,
      requestFulfilled: responseBriefValidation.ok && assistantOutputContextEligible,
      candidates: [
        recordVisibleCandidate("raw_model", rawAssistantText, "raw_model"),
        recordVisibleCandidate("route_visible_commit_authority", finalAssistantText, "response_brief", {
          selected: true,
          owner: routeContentRealizer === "llm_brief_realizer"
            ? "approved_llm_renderer_from_response_brief"
            : "approved_response_brief_fallback",
          visible_safe: responseBriefValidation.ok && assistantOutputContextEligible,
          internal_source_type: "visible_safe",
        }),
      ],
    });
    visibleCommitDecision = commitVisibleOutput({
      decision: visibleAuthority,
      text: finalAssistantText,
      candidate: visibleAuthority.final_visible_candidate,
    });
  }
  const finalRequestFulfilled =
    assistantOutputQuality !== "failed_fulfillment" &&
    assistantOutputQuality !== "fallback_plan_leak" &&
    assistantOutputQuality !== "generic_assistant_voice" &&
    assistantOutputContextEligible &&
    responseBriefValidation.ok &&
    visibleCommitDecision.allow;
  if (!finalRequestFulfilled) {
    const renderErrorCategory =
      llmRendererError === "model_timeout"
        ? "model_timeout"
        : responseBriefValidation.failures.includes("generic_assistant_voice") ||
            assistantOutputQuality === "generic_assistant_voice"
          ? "renderer_validation_error"
          : "no_valid_visible_reply";
    const renderBlockedReason =
      renderErrorCategory === "model_timeout"
        ? "model_timeout"
        : renderErrorCategory === "renderer_validation_error"
          ? "generic_assistant_voice"
          : "no_valid_visible_reply";
    logSessionRouteDebug({
      stage: "route_authority_contract",
      route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
      planner_strategy: "none",
      planner_step_valid: "not_applicable",
      planner_error_category: null,
      response_brief_created: true,
      visible_authority_commit_attempted: true,
      server_authority_sentinel_attached: false,
      ndjson_assistant_payload_sent: false,
      ndjson_error_payload_sent: true,
      render_error_category: renderErrorCategory,
      render_blocked_reason: renderBlockedReason,
      model_reply_used: visibleAuthority.model_reply_used,
      llm_renderer_used: visibleAuthority.llm_renderer_used,
      approved_response_brief_fallback_used:
        visibleAuthority.approved_response_brief_fallback_used,
      assistant_output_quality: assistantOutputQuality,
      assistant_output_context_eligible: assistantOutputContextEligible,
      request_fulfilled: false,
      visible_commit_reason: visibleCommitDecision.reason,
      route_elapsed_ms: Date.now() - routeStartedAtMs,
    });
    return createHandledAuthorityErrorNdjsonResponse({
        errorCategory: renderErrorCategory,
        blockedReason: renderBlockedReason,
        serverCommitPath: "missing",
        rawResponseShape: {
          response_brief_id: responseBrief.brief_id,
          final_output_source: finalOutputSource,
          response_brief_validation_reason: responseBriefValidation.reason,
          visible_commit_reason: visibleCommitDecision.reason,
          llm_renderer_retry_used: llmRendererRetryUsed,
          llm_renderer_error: llmRendererError,
          route_elapsed_ms: Date.now() - routeStartedAtMs,
        },
        extra: {
          model_reply_used: visibleAuthority.model_reply_used,
          llm_renderer_used: visibleAuthority.llm_renderer_used,
          approved_response_brief_fallback_used:
            visibleAuthority.approved_response_brief_fallback_used,
          assistant_output_quality: assistantOutputQuality,
          assistant_output_context_eligible: assistantOutputContextEligible,
          request_fulfilled: false,
          llm_renderer_error: llmRendererError,
          replacement_chain: routeReplacementChain,
          route_elapsed_ms: Date.now() - routeStartedAtMs,
        },
        routeDebug: {
          route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
          planner_strategy: "none",
          planner_step_valid: "not_applicable",
          planner_error_category: null,
          response_brief_created: true,
          visible_authority_commit_attempted: true,
          route_elapsed_ms: Date.now() - routeStartedAtMs,
        },
      });
  }
  const assistantOutputStateEligible =
    assistantOutputQuality === "valid_model_reply" &&
    assistantOutputContextEligible &&
    responseBriefValidation.ok &&
    visibleCommitDecision.allow &&
    finalRequestFulfilled &&
    !detectGenericAssistantVoice(finalAssistantText);
  const activeInteractionUpdate = updateActiveInteractionState({
    before: activeInteractionBefore,
    turnMeaning,
    responseBrief,
    assistantText: assistantOutputStateEligible ? finalAssistantText : "",
    turnId: requestId,
  });
  const activeInteractionAfter =
    normalizeActiveInteractionState(activeInteractionUpdate.after) ?? activeInteractionBefore;
  assistantOutputContextEligible =
    assistantOutputContextEligible && visibleCommitDecision.allow && responseBriefValidation.ok;
  const previousResponseBriefAfter = assistantOutputStateEligible
    ? summarizeResponseBrief(responseBrief, finalAssistantText)
    : null;
  const activeInteractionRouting = routeTurnWithActiveInteraction({
    text: lastUserMessage?.content ?? "",
    activeInteraction: activeInteractionBefore,
    previousResponseBriefPresent: Boolean(previousResponseBrief),
  });
  const activeStateOwner = createActiveInteractionStateOwner({
    requestId,
    turnId,
    userMessageId: Number.isFinite(Number(turnId)) ? Number(turnId) : null,
    assistantTurnId: null,
  });
  const finalGameStartInspection = inspectGameStartContract(
    finalAssistantText,
    rawGameStartInspection.templateId,
  );

  setPromptDebugEntry({
    ...promptDebugEntry,
    modelTrace: {
      rawModelOutput: rawAssistantText,
      shapedOutput: shaped.text,
      finalAssistantOutput: finalAssistantText,
      shapeReason: shaped.reason ?? null,
      finalOutputSource,
      preservedModelVoice: shaped.debug?.preservedModelVoice ?? false,
      criticReasons: postShapeCritic.reasons,
      appCandidates: [
        ...appCandidates,
        {
          source: "freshGreetingGuard",
          text: freshGreetingGuard.text,
          selected: finalOutputSource === "freshGreetingGuard",
        },
        {
          source: "buildTurnPlanFallback",
          text: buildTurnPlanFallback(turnPlan, toneProfile),
          selected: finalOutputSource === "buildTurnPlanFallback",
        },
        {
          source: "buildContinuityRecoveryReply",
          text: buildContinuityRecoveryReply({
            strategy: responseStrategy,
            state: conversationStateSnapshot,
            lastUserMessage: lastUserMessage?.content ?? "",
            toneProfile,
          }),
          selected: finalOutputSource === "buildContinuityRecoveryReply",
        },
        {
          source: "final_displayed_output",
          text: finalAssistantText,
          selected: true,
        },
      ],
    },
  });

  liveTurnDiagnosticRecord = attachWinnerToLiveTurnDiagnostic(liveTurnDiagnosticRecord, {
    pathWinner: "server_model_path",
    pathReason: sessionReplayDebugContext?.deterministicBypassReason ?? "model_path_after_replay_fallthrough",
    finalWinningResponseSource: finalOutputSource,
  });

  if (sessionReplayDebugContext && lastUserMessage) {
    logSessionRouteDebug({
      stage: "session_final",
      latest_user_message: sessionReplayDebugContext.latestUserMessage,
      detected_user_act: sessionReplayDebugContext.detectedUserAct,
      canonical_turn_move: canonicalTurnMove,
      current_session_mode: sessionReplayDebugContext.currentSessionMode,
      replayed_scene_state: sessionReplayDebugContext.replayedSceneStateSummary,
      scene_scope: sessionReplayDebugContext.sceneScope,
      deterministic_bypass_triggered: sessionReplayDebugContext.deterministicBypassTriggered,
      deterministic_bypass_reason: sessionReplayDebugContext.deterministicBypassReason,
      model_called: true,
      chosen_response_source:
        finalOutputSource === "buildTurnPlanFallback"
          ? "turn-plan fallback"
          : finalOutputSource === "freshGreetingGuard"
            ? "fresh-greeting guard"
            : "model",
      direct_question: sessionReplayDebugContext.directQuestion,
      answered_direct_question_first: answeredDirectQuestionFirst(
        lastUserMessage.content,
        finalAssistantText,
        sessionReplayDebugContext.detectedUserAct,
      ),
      live_turn_diagnostic: liveTurnDiagnosticRecord,
      pre_model_candidate_source: sessionReplayDebugContext.preModelCandidateSource,
      final_output_source: finalOutputSource,
      turn_plan_check: baseResponseHeaders["x-raven-turn-plan-check"] ?? "none",
    });
  }

  await appendChatHistory("assistant", finalAssistantText, sessionId);
  await persistSessionTurnSummary(
    sessionId,
    lastUserMessage?.content ?? "",
    finalAssistantText,
    conversationStateSnapshot,
    responseStrategy,
  );
  return createStaticAssistantNdjsonResponse(finalAssistantText, {
      ...baseResponseHeaders,
      "x-raven-final-output-source": finalOutputSource,
      "x-raven-post-processed":
        shaped.reason !== "none" || postShapeCritic.reasons.length > 0 ? "1" : "0",
      "x-raven-task-create-source": persisted.taskCreateSource,
      "x-raven-task-create-kind": persisted.taskCreateKind,
      "x-raven-task-origin-turn-id": turnId,
      "x-raven-game-start-detected": rawGameStartInspection.detected ? "1" : "0",
      "x-raven-game-start-raw-question-present": rawGameStartInspection.hasPlayablePrompt
        ? "1"
        : "0",
      "x-raven-game-start-final-question-present": finalGameStartInspection.hasPlayablePrompt
        ? "1"
        : "0",
      ...(createdTaskId
        ? {
            "x-raven-task-created": "1",
            "x-raven-task-id": createdTaskId,
          }
        : {}),
    }, buildChatResponseStatePayload({
    activeInteractionBefore,
    activeInteractionAfter,
    previousResponseBrief: previousResponseBriefAfter,
    owner: activeStateOwner,
    semanticTrace: {
      authority_trace_present: true,
      authority_trace_version: "visible-output-authority-v2",
      server_commit_path: "app_api_chat_route_static_assistant_ndjson",
      client_commit_path: null,
      active_interaction_before: activeInteractionBefore,
      active_interaction_after: activeInteractionAfter,
      active_interaction_transition: activeInteractionUpdate.transition,
      active_state_created_this_turn: Boolean(
        !activeInteractionBefore?.active_interaction_id &&
          activeInteractionAfter?.active_interaction_id,
      ),
      active_state_creation_reason:
        !activeInteractionBefore?.active_interaction_id &&
        activeInteractionAfter?.active_interaction_id
          ? activeInteractionUpdate.transition.reason
          : null,
      active_interaction_before_request_client: activeInteractionBefore,
      active_interaction_sent_to_server: activeInteractionBefore,
      active_interaction_received_by_server: activeInteractionBefore,
      active_interaction_before_routing: activeInteractionBefore,
      active_interaction_after_response_gate: activeInteractionAfter,
      active_interaction_returned_to_client: activeInteractionAfter,
      active_interaction_accepted_by_client: true,
      active_interaction_rejected_by_client_reason: null,
      previous_instruction_id:
        activeInteractionBefore?.last_assistant_instruction?.instruction_id ?? null,
      attached_instruction_id: activeInteractionUpdate.attached_instruction_id,
      previous_response_brief_created_this_turn: Boolean(previousResponseBriefAfter),
      previous_response_brief_sent_to_server: Boolean(previousResponseBrief),
      previous_response_brief_received_by_server: Boolean(previousResponseBrief),
      previous_response_brief_used_in_routing:
        activeInteractionRouting.previous_response_brief_used,
      last_assistant_instruction_created_this_turn: Boolean(
        activeInteractionUpdate.attached_instruction_id,
      ),
      last_assistant_instruction_sent_to_server: Boolean(
        activeInteractionBefore?.last_assistant_instruction,
      ),
      last_assistant_instruction_used_for_followup: Boolean(
        turnMeaning.requested_facet === "clarification_recovery" ||
          turnMeaning.requested_facet.startsWith("active_") ||
          activeInteractionBefore?.last_assistant_instruction,
      ),
      repeated_answer_detected: repeatedAnswerDetected,
      repeated_answer_similarity: repeatedAnswerSimilarity,
      repetition_repair_used: repetitionRepairUsed,
      state_delta_detected: Boolean(turnMeaning.dynamic_slots?.state_delta_type),
      state_delta_type: turnMeaning.dynamic_slots?.state_delta_type ?? null,
      active_state_delta_applied: Boolean(
        turnMeaning.dynamic_slots?.state_delta_type && activeInteractionAfter,
      ),
      new_slots_added: turnMeaning.dynamic_slots?.new_slots_added ?? [],
      pending_unaddressed_slots:
        turnMeaning.dynamic_slots?.pending_unaddressed_slots ??
        activeInteractionAfter?.pending_unaddressed_slots ??
        [],
      last_answer_signature: activeInteractionAfter?.last_answer_signature ?? null,
      meta_feedback_detected:
        turnMeaning.speech_act === "meta_feedback" ||
        turnMeaning.speech_act === "complaint_about_response" ||
        turnMeaning.dynamic_slots?.state_delta_type === "meta_feedback",
      internal_instruction_summary_rendered: /\bfollow\s+Choose\b|\bChoose a role frame\b/i.test(
        finalAssistantText,
      ),
      instruction_renderable_field_used: !/\bfollow\s+Choose\b|\bChoose a role frame\b/i.test(
        finalAssistantText,
      ),
      response_brief: responseBrief,
      response_brief_id: responseBrief.brief_id,
      assistant_output_quality: assistantOutputQuality,
      assistant_output_context_eligible: assistantOutputContextEligible,
      assistant_output_state_eligible: assistantOutputStateEligible,
      request_fulfilled:
        finalRequestFulfilled,
      final_visible_source: visibleAuthority.final_visible_source,
      final_visible_owner: visibleAuthority.final_visible_owner,
      candidate_kind: visibleAuthority.candidate_kind,
      candidate_visible_safe: visibleAuthority.candidate_visible_safe,
      approved_response_brief_fallback_used:
        visibleAuthority.approved_response_brief_fallback_used,
      strict_relational_authority: visibleAuthority.strict_relational_authority,
      all_visible_candidates: visibleAuthority.all_visible_candidates,
      rejected_visible_candidates: visibleAuthority.rejected_visible_candidates,
      replacement_chain: visibleAuthority.replacement_chain,
      model_reply_used: visibleAuthority.model_reply_used,
      response_brief_used: visibleAuthority.response_brief_used,
      response_gate_replaced: visibleAuthority.response_gate_replaced,
      client_generated_reply_used: visibleAuthority.client_generated_reply_used,
      legacy_visible_emitter_used: visibleAuthority.legacy_visible_emitter_used,
      legacy_visible_emitter_blocked: visibleAuthority.legacy_visible_emitter_blocked,
      deterministic_bypass_used: visibleAuthority.deterministic_bypass_used,
      deterministic_bypass_reason: visibleAuthority.deterministic_bypass_reason,
      scene_scaffold_candidate_created: visibleAuthority.scene_scaffold_candidate_created,
      scene_scaffold_candidate_used: visibleAuthority.scene_scaffold_candidate_used,
      turn_plan_fallback_created: visibleAuthority.turn_plan_fallback_created,
      turn_plan_fallback_used: visibleAuthority.turn_plan_fallback_used,
      brief_realizer_used: visibleAuthority.brief_realizer_used,
      llm_renderer_used: visibleAuthority.llm_renderer_used,
      visible_commit_owner: visibleAuthority.visible_commit_owner,
      visible_commit_allowed: visibleCommitDecision.allow,
      state_returned_to_server: Boolean(activeInteractionBefore?.active_interaction_id),
      state_persisted_to_client: true,
      active_interaction_route_considered:
        activeInteractionRouting.active_interaction_route_considered,
      active_interaction_continuity_score:
        activeInteractionRouting.active_interaction_continuity_score,
      topic_shift_score: activeInteractionRouting.topic_shift_score,
      candidate_routes: activeInteractionRouting.candidate_routes,
      chosen_route: activeInteractionRouting.chosen_route,
      rejected_routes: activeInteractionRouting.rejected_routes,
      rejected_game_reason: activeInteractionRouting.rejected_game_reason,
      rejected_generic_task_reason: activeInteractionRouting.rejected_generic_task_reason,
      rejected_definition_reason: activeInteractionRouting.rejected_definition_reason,
      conversation_mode_overridden_by_active_interaction:
        activeInteractionRouting.conversation_mode_overridden_by_active_interaction,
      previous_response_brief_used: activeInteractionRouting.previous_response_brief_used,
    },
    }), {
      route_received_user_text: Boolean(lastUserMessage?.content?.trim()),
      planner_strategy: "none",
      planner_step_valid: "not_applicable",
      planner_error_category: null,
      response_brief_created: Boolean(responseBrief.brief_id),
    });
}
