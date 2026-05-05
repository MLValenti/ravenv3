import type { ResponseBrief } from "./response-brief.ts";
import type { TurnMeaning } from "./turn-meaning.ts";

export type ActiveInteractionType =
  | "relational_setup"
  | "service_protocol"
  | "training_discussion"
  | "check_in_sequence"
  | "task_sequence"
  | "game"
  | "generic_conversation";

export type ActiveInteractionStatus =
  | "setting_up"
  | "awaiting_confirmation"
  | "awaiting_user_answer"
  | "awaiting_progress_report"
  | "awaiting_next_step_request"
  | "active"
  | "paused"
  | "stopped"
  | "completed";

export type ExpectedUserResponseType =
  | "confirmation"
  | "readiness"
  | "progress_report"
  | "rule_selection"
  | "answer"
  | "next_step_request"
  | "correction"
  | "none";

export type ActiveInteractionInstruction = {
  instruction_id: string;
  plain_language_summary: string;
  expected_user_response_type: ExpectedUserResponseType;
  required_slots: string[];
  example_user_response: string;
  safety_or_boundary_notes: string[];
  linked_response_brief_id: string | null;
  linked_active_interaction_id: string | null;
};

export type ActiveInteractionState = {
  active_interaction_id: string | null;
  interaction_type: ActiveInteractionType;
  domain_handler: string;
  status: ActiveInteractionStatus;
  current_step_id: string | null;
  current_step_summary: string | null;
  previous_step_summary: string | null;
  next_step_policy: string | null;
  user_goal: string | null;
  known_limits: string[];
  known_boundaries: string[];
  known_equipment: string[];
  known_preferences: string[];
  known_experience_level: string | null;
  awaiting_user_input_type: ExpectedUserResponseType;
  last_assistant_instruction: ActiveInteractionInstruction | null;
  last_assistant_question: ActiveInteractionInstruction | null;
  last_user_progress_report: string | null;
  last_user_confusion: string | null;
  stop_or_pause_signal_seen: boolean;
  safety_review_required: boolean;
  created_from_turn_id: string | null;
  updated_at_turn_id: string | null;
  current_task_lane: string | null;
  daily_task_requested: boolean;
  training_goals: string[];
  protocol_rules: string[];
  previous_response_brief_id: string | null;
  answered_topics: string[];
  last_answer_signature: string | null;
  last_answered_slots: string[];
  pending_unaddressed_slots: string[];
  user_feedback_on_last_response: string | null;
};

export type ActiveInteractionStateOwner = {
  request_id: string | null;
  turn_id: string | null;
  user_message_id: number | null;
  assistant_turn_id: string | null;
  committed_at_ms: number | null;
};

export type ActiveInteractionStateEnvelope = {
  activeInteraction: ActiveInteractionState | null;
  owner: ActiveInteractionStateOwner;
};

export type ActiveInteractionTurnClassification = {
  speech_act:
    | "service_request"
    | "protocol_setup_request"
    | "user_preference_disclosure"
    | "user_confusion"
    | "next_step_request"
    | "progress_report"
    | "readiness_confirmation"
    | "active_step_confusion"
    | "continue_current_step"
    | "pause_or_stop_request"
    | "correction_to_active_interaction"
    | "meta_feedback"
    | "complaint_about_response"
    | "boundary_update";
  requested_facet:
    | "service_task"
    | "training_guidance"
    | "protocol_setup"
    | "service_preference"
    | "clarification_recovery"
    | "active_next_step"
    | "active_progress_report"
    | "active_readiness_confirmation"
    | "active_step_confusion"
    | "pause_or_stop"
    | "correction_to_active_interaction"
    | "response_correction"
    | "boundary_update";
  answer_contract:
    | "service_task"
    | "training_guidance"
    | "protocol_setup"
    | "service_preference"
    | "clarification_recovery"
    | "active_next_step"
    | "active_progress_report"
    | "active_readiness_confirmation"
    | "active_step_confusion"
    | "pause_or_stop"
    | "correction_to_active_interaction"
    | "revise_or_clarify_prior_claim"
    | "boundary_update";
  primary_subject: string;
  requested_operation: "answer" | "clarify" | "revise";
  confidence: number;
  reason: string;
  safety_review_required: boolean;
  state_delta_type?: string | null;
  state_delta_summary?: string | null;
  new_slots_added?: string[];
  pending_unaddressed_slots?: string[];
  experience_level?: string | null;
  desired_role?: string | null;
  meta_feedback?: string | null;
};

export type ActiveInteractionRoutingDecision = {
  active_interaction_route_considered: boolean;
  active_interaction_continuity_score: number;
  topic_shift_score: number;
  candidate_routes: Array<{ route: string; eligible: boolean; reason: string }>;
  chosen_route: string;
  rejected_routes: Array<{ route: string; reason: string }>;
  rejected_game_reason: string | null;
  rejected_generic_task_reason: string | null;
  rejected_definition_reason: string | null;
  conversation_mode_overridden_by_active_interaction: boolean;
  previous_response_brief_used: boolean;
};

export type ActiveInteractionTransition = {
  from_status: ActiveInteractionStatus;
  to_status: ActiveInteractionStatus;
  from_interaction_type: ActiveInteractionType;
  to_interaction_type: ActiveInteractionType;
  reason: string;
};

const EMPTY_ID = null;

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

function normalizeLower(text: string | null | undefined): string {
  return normalize(text).toLowerCase();
}

function stableId(prefix: string, seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(36)}`;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? normalize(value) : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(value.filter((entry): entry is string => typeof entry === "string"));
}

function normalizeInteractionType(value: unknown): ActiveInteractionType {
  switch (value) {
    case "relational_setup":
    case "service_protocol":
    case "training_discussion":
    case "check_in_sequence":
    case "task_sequence":
    case "game":
    case "generic_conversation":
      return value;
    default:
      return "generic_conversation";
  }
}

function normalizeStatus(value: unknown): ActiveInteractionStatus {
  switch (value) {
    case "setting_up":
    case "awaiting_confirmation":
    case "awaiting_user_answer":
    case "awaiting_progress_report":
    case "awaiting_next_step_request":
    case "active":
    case "paused":
    case "stopped":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

function normalizeExpectedResponse(value: unknown): ExpectedUserResponseType {
  switch (value) {
    case "confirmation":
    case "readiness":
    case "progress_report":
    case "rule_selection":
    case "answer":
    case "next_step_request":
    case "correction":
    case "none":
      return value;
    default:
      return "none";
  }
}

export function normalizeActiveInteractionInstruction(
  value: unknown,
): ActiveInteractionInstruction | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ActiveInteractionInstruction>;
  const instructionId = normalizeString(raw.instruction_id);
  if (!instructionId) {
    return null;
  }
  return {
    instruction_id: instructionId,
    plain_language_summary: normalizeString(raw.plain_language_summary) ?? "Continue the active step.",
    expected_user_response_type: normalizeExpectedResponse(raw.expected_user_response_type),
    required_slots: normalizeStringList(raw.required_slots),
    example_user_response: normalizeString(raw.example_user_response) ?? "I understand and I am ready.",
    safety_or_boundary_notes: normalizeStringList(raw.safety_or_boundary_notes),
    linked_response_brief_id: normalizeString(raw.linked_response_brief_id),
    linked_active_interaction_id: normalizeString(raw.linked_active_interaction_id),
  };
}

export function normalizeActiveInteractionState(
  value: unknown,
): ActiveInteractionState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ActiveInteractionState>;
  const base = createActiveInteractionState();
  return {
    active_interaction_id: normalizeString(raw.active_interaction_id),
    interaction_type: normalizeInteractionType(raw.interaction_type),
    domain_handler: normalizeString(raw.domain_handler) ?? base.domain_handler,
    status: normalizeStatus(raw.status),
    current_step_id: normalizeString(raw.current_step_id),
    current_step_summary: normalizeString(raw.current_step_summary),
    previous_step_summary: normalizeString(raw.previous_step_summary),
    next_step_policy: normalizeString(raw.next_step_policy),
    user_goal: normalizeString(raw.user_goal),
    known_limits: normalizeStringList(raw.known_limits),
    known_boundaries: normalizeStringList(raw.known_boundaries),
    known_equipment: normalizeStringList(raw.known_equipment),
    known_preferences: normalizeStringList(raw.known_preferences),
    known_experience_level: normalizeString(raw.known_experience_level),
    awaiting_user_input_type: normalizeExpectedResponse(raw.awaiting_user_input_type),
    last_assistant_instruction: normalizeActiveInteractionInstruction(raw.last_assistant_instruction),
    last_assistant_question: normalizeActiveInteractionInstruction(raw.last_assistant_question),
    last_user_progress_report: normalizeString(raw.last_user_progress_report),
    last_user_confusion: normalizeString(raw.last_user_confusion),
    stop_or_pause_signal_seen:
      typeof raw.stop_or_pause_signal_seen === "boolean"
        ? raw.stop_or_pause_signal_seen
        : base.stop_or_pause_signal_seen,
    safety_review_required:
      typeof raw.safety_review_required === "boolean"
        ? raw.safety_review_required
        : base.safety_review_required,
    created_from_turn_id: normalizeString(raw.created_from_turn_id),
    updated_at_turn_id: normalizeString(raw.updated_at_turn_id),
    current_task_lane: normalizeString(raw.current_task_lane),
    daily_task_requested:
      typeof raw.daily_task_requested === "boolean"
        ? raw.daily_task_requested
        : base.daily_task_requested,
    training_goals: normalizeStringList(raw.training_goals),
    protocol_rules: normalizeStringList(raw.protocol_rules),
    previous_response_brief_id: normalizeString(raw.previous_response_brief_id),
    answered_topics: normalizeStringList(raw.answered_topics),
    last_answer_signature: normalizeString(raw.last_answer_signature),
    last_answered_slots: normalizeStringList(raw.last_answered_slots),
    pending_unaddressed_slots: normalizeStringList(raw.pending_unaddressed_slots),
    user_feedback_on_last_response: normalizeString(raw.user_feedback_on_last_response),
  };
}

export function normalizeActiveInteractionStateOwner(
  value: unknown,
): ActiveInteractionStateOwner {
  if (!value || typeof value !== "object") {
    return {
      request_id: null,
      turn_id: null,
      user_message_id: null,
      assistant_turn_id: null,
      committed_at_ms: null,
    };
  }
  const raw = value as Partial<ActiveInteractionStateOwner>;
  return {
    request_id: normalizeString(raw.request_id),
    turn_id: normalizeString(raw.turn_id),
    user_message_id:
      typeof raw.user_message_id === "number" && Number.isFinite(raw.user_message_id)
        ? raw.user_message_id
        : null,
    assistant_turn_id: normalizeString(raw.assistant_turn_id),
    committed_at_ms:
      typeof raw.committed_at_ms === "number" && Number.isFinite(raw.committed_at_ms)
        ? raw.committed_at_ms
        : null,
  };
}

export function createActiveInteractionStateOwner(input: {
  requestId?: string | null;
  turnId?: string | null;
  userMessageId?: number | null;
  assistantTurnId?: string | null;
  committedAtMs?: number | null;
}): ActiveInteractionStateOwner {
  return {
    request_id: normalizeString(input.requestId),
    turn_id: normalizeString(input.turnId),
    user_message_id:
      typeof input.userMessageId === "number" && Number.isFinite(input.userMessageId)
        ? input.userMessageId
        : null,
    assistant_turn_id: normalizeString(input.assistantTurnId),
    committed_at_ms:
      typeof input.committedAtMs === "number" && Number.isFinite(input.committedAtMs)
        ? input.committedAtMs
        : null,
  };
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return left === right ? 0 : left > right ? 1 : -1;
}

export function shouldAcceptActiveInteractionStateUpdate(input: {
  current: ActiveInteractionState | null | undefined;
  incoming: ActiveInteractionState | null | undefined;
  currentOwner?: ActiveInteractionStateOwner | null;
  incomingOwner?: ActiveInteractionStateOwner | null;
}): { accept: boolean; reason: string } {
  const incoming = normalizeActiveInteractionState(input.incoming);
  if (!incoming) {
    return { accept: false, reason: "missing_incoming_active_interaction" };
  }
  const current = normalizeActiveInteractionState(input.current);
  const incomingOwner = normalizeActiveInteractionStateOwner(input.incomingOwner);
  const currentOwner = normalizeActiveInteractionStateOwner(input.currentOwner);
  const userMessageComparison = compareNullableNumbers(
    incomingOwner.user_message_id,
    currentOwner.user_message_id,
  );
  if (userMessageComparison < 0) {
    return { accept: false, reason: "stale_user_message_owner" };
  }
  if (userMessageComparison === 0) {
    const commitComparison = compareNullableNumbers(
      incomingOwner.committed_at_ms,
      currentOwner.committed_at_ms,
    );
    if (commitComparison < 0) {
      return { accept: false, reason: "stale_commit_owner" };
    }
  }
  if (!current?.active_interaction_id && incoming.active_interaction_id) {
    return { accept: true, reason: "incoming_created_active_interaction" };
  }
  if (
    current?.active_interaction_id &&
    incoming.active_interaction_id &&
    current.active_interaction_id !== incoming.active_interaction_id &&
    userMessageComparison < 1
  ) {
    return { accept: false, reason: "different_active_interaction_from_non_newer_owner" };
  }
  return { accept: true, reason: "incoming_active_interaction_is_current_or_newer" };
}

export function createActiveInteractionState(): ActiveInteractionState {
  return {
    active_interaction_id: EMPTY_ID,
    interaction_type: "generic_conversation",
    domain_handler: "conversation",
    status: "completed",
    current_step_id: null,
    current_step_summary: null,
    previous_step_summary: null,
    next_step_policy: null,
    user_goal: null,
    known_limits: [],
    known_boundaries: [],
    known_equipment: [],
    known_preferences: [],
    known_experience_level: null,
    awaiting_user_input_type: "none",
    last_assistant_instruction: null,
    last_assistant_question: null,
    last_user_progress_report: null,
    last_user_confusion: null,
    stop_or_pause_signal_seen: false,
    safety_review_required: false,
    created_from_turn_id: null,
    updated_at_turn_id: null,
    current_task_lane: null,
    daily_task_requested: false,
    training_goals: [],
    protocol_rules: [],
    previous_response_brief_id: null,
    answered_topics: [],
    last_answer_signature: null,
    last_answered_slots: [],
    pending_unaddressed_slots: [],
    user_feedback_on_last_response: null,
  };
}

export function isActiveInteractionLive(state: ActiveInteractionState | null | undefined): boolean {
  return Boolean(
    state?.active_interaction_id &&
      !["completed", "stopped"].includes(state.status) &&
      state.interaction_type !== "generic_conversation",
  );
}

function isRelationalActiveInteraction(state: ActiveInteractionState | null | undefined): boolean {
  return Boolean(
    isActiveInteractionLive(state) &&
      state?.interaction_type !== "game" &&
      state?.interaction_type !== "generic_conversation",
  );
}

function hasExplicitGameRequest(normalized: string): boolean {
  return /\b(?:play\s+a\s+game|start\s+a\s+game|game\s+now|rock\s+paper\s+scissors|riddle\s+game|quiz\s+game)\b/i.test(
    normalized,
  );
}

function activeContinuityScore(normalized: string, state: ActiveInteractionState): number {
  let score = 0;
  if (/\b(?:tasks?|daily|every\s+day|rules?|protocol|training|service|serve|next|progress|ready|limits?|boundar(?:y|ies)|role|permission|approval|check[- ]?in|chastity|anal)\b/i.test(normalized)) {
    score += 0.55;
  }
  if (
    state.awaiting_user_input_type !== "none" &&
    /^(?:yes|yes\s+mistress|ok|okay|sounds\s+good|yes\s+please|i\s+agree|agreed)(?:[.!])?$/i.test(
      normalized,
    )
  ) {
    score += 0.6;
  }
  if (/\b(?:what\s+else|now\s+what|what\s+do\s+i\s+do|what\s+do\s+you\s+mean|what\s+are\s+you\s+asking\s+me\s+to\s+do|confused|understand|explain)\b/i.test(normalized)) {
    score += 0.4;
  }
  if (/\b(?:repeating|already\s+said|not\s+what\s+i\s+asked|not\s+answering|say\s+it\s+differently)\b/i.test(normalized)) {
    score += 0.55;
  }
  if (/\b(?:new\s+to\s+this|inexperienced|beginner|not\s+much\s+training|never\s+done\s+much|little\s+training)\b/i.test(normalized)) {
    score += 0.55;
  }
  const stateText = [
    state.current_step_summary,
    state.user_goal,
    ...state.known_preferences,
    ...state.known_limits,
    ...state.known_equipment,
    ...state.training_goals,
    ...state.protocol_rules,
  ].join(" ");
  if (stateText && /\b(?:task|rule|protocol|training|service|chastity|anal|permission|approval)\b/i.test(stateText)) {
    score += 0.15;
  }
  return Math.min(1, score);
}

function topicShiftScore(normalized: string): number {
  if (hasExplicitGameRequest(normalized)) {
    return 0.9;
  }
  if (/\b(?:different topic|change topic|let'?s talk about something else|unrelated|weather|code|work project)\b/i.test(normalized)) {
    return 0.85;
  }
  return 0.1;
}

export function routeTurnWithActiveInteraction(input: {
  text: string;
  activeInteraction?: ActiveInteractionState | null;
  previousResponseBriefPresent?: boolean;
  candidateRoutes?: string[];
}): ActiveInteractionRoutingDecision {
  const normalized = normalizeLower(input.text);
  const active = input.activeInteraction ?? null;
  const considered = isRelationalActiveInteraction(active);
  const continuity = considered && active ? activeContinuityScore(normalized, active) : 0;
  const shift = topicShiftScore(normalized);
  const compatible = considered && continuity >= 0.45 && shift < 0.75;
  const candidates = input.candidateRoutes ?? [
    "active_interaction",
    "relational_dynamic",
    "game",
    "generic_task",
    "definition",
    "question_answering",
  ];
  const rejectedRoutes: Array<{ route: string; reason: string }> = [];
  const addRejected = (route: string, reason: string) => {
    rejectedRoutes.push({ route, reason });
  };
  if (compatible) {
    addRejected("game", hasExplicitGameRequest(normalized) ? "explicit_game_request_would_allow_game" : "active_relational_interaction_blocks_game_route");
    addRejected("generic_task", "active_relational_task_context_blocks_generic_task_route");
    addRejected("definition", "active_interaction_turn_not_a_definition_request");
    addRejected("question_answering", "active_interaction_context_overrides_question_answering_mode");
  }
  const rejectedGameReason = rejectedRoutes.find((route) => route.route === "game")?.reason ?? null;
  const rejectedGenericTaskReason = rejectedRoutes.find((route) => route.route === "generic_task")?.reason ?? null;
  const rejectedDefinitionReason = rejectedRoutes.find((route) => route.route === "definition")?.reason ?? null;
  return {
    active_interaction_route_considered: considered,
    active_interaction_continuity_score: continuity,
    topic_shift_score: shift,
    candidate_routes: candidates.map((route) => ({
      route,
      eligible:
        !compatible ||
        !["game", "generic_task", "definition", "question_answering"].includes(route),
      reason:
        compatible && ["game", "generic_task", "definition", "question_answering"].includes(route)
          ? rejectedRoutes.find((candidate) => candidate.route === route)?.reason ?? "rejected_by_active_interaction"
          : "eligible",
    })),
    chosen_route: compatible ? "relational_dynamic" : "default_route",
    rejected_routes: rejectedRoutes,
    rejected_game_reason: rejectedGameReason,
    rejected_generic_task_reason: rejectedGenericTaskReason,
    rejected_definition_reason: rejectedDefinitionReason,
    conversation_mode_overridden_by_active_interaction:
      compatible && rejectedRoutes.some((route) => route.route === "question_answering"),
    previous_response_brief_used: Boolean(input.previousResponseBriefPresent),
  };
}

export function classifyActiveInteractionTurn(
  text: string,
  state: ActiveInteractionState | null | undefined,
): ActiveInteractionTurnClassification | null {
  if (!isActiveInteractionLive(state)) {
    return null;
  }
  const normalized = normalizeLower(text);
  const route = routeTurnWithActiveInteraction({ text: normalized, activeInteraction: state });
  const activeCompatible = route.chosen_route === "relational_dynamic";
  const activeSubject = state?.current_step_summary ?? state?.user_goal ?? "active interaction";
  if (/\b(?:i\s+have|i\s+bought|i\s+own|i\s+got)\b[^.?!]*(?:cage|plug|collar|cuffs?|rope|remote toy|toy|strap[- ]?on|gear|restraints?|leash|dildos?|device)\b/i.test(normalized)) {
    return null;
  }
  if (
    /\b(?:i\s+want|i\s+need|i\s+like)\b/i.test(normalized) &&
    /\b(?:tasks?|rules?|permission|approval|service)\b/i.test(normalized) &&
    /\b(?:training|boundar(?:y|ies)|limits?|hard\s+limit|no\s+\w+|but\s+no)\b/i.test(normalized)
  ) {
    return null;
  }
  if (/\b(?:not a game|task not a game|stop making it a game|no,\s*stay on this|stay on this|i mean service task)\b/i.test(normalized)) {
    return {
      speech_act: "correction_to_active_interaction",
      requested_facet: "correction_to_active_interaction",
      answer_contract: "correction_to_active_interaction",
      primary_subject: activeSubject,
      requested_operation: "revise",
      confidence: 0.93,
      reason: "user corrected the active interaction",
      safety_review_required: false,
      state_delta_type: "correction_to_active_interaction",
      state_delta_summary: "user corrected the active interaction direction",
      new_slots_added: ["correction"],
    };
  }
  if (
    /\b(?:why\s+are\s+you\s+repeating|you\s+already\s+said\s+that|stop\s+repeating|repeating\s+yourself|that\s+is\s+not\s+what\s+i\s+asked|you\s+are\s+not\s+answering\s+me|you\s+keep\s+saying\s+the\s+same|say\s+it\s+differently)\b/i.test(
      normalized,
    )
  ) {
    return {
      speech_act: "complaint_about_response",
      requested_facet: "response_correction",
      answer_contract: "revise_or_clarify_prior_claim",
      primary_subject: activeSubject,
      requested_operation: "revise",
      confidence: 0.94,
      reason: "user gave feedback that the prior response repeated or missed the ask",
      safety_review_required: false,
      state_delta_type: "meta_feedback",
      state_delta_summary: "user says Raven repeated or missed the requested answer",
      new_slots_added: ["user_feedback_on_last_response"],
      meta_feedback: normalized,
    };
  }
  if (
    /\b(?:stop|pause|enough|not now|end this)\b/i.test(normalized) ||
    /^(?:i'?m\s+)?done[.!]?$/i.test(normalized) ||
    /\bdone\s+(?:now|with\s+this)\b/i.test(normalized)
  ) {
    return {
      speech_act: "pause_or_stop_request",
      requested_facet: "pause_or_stop",
      answer_contract: "pause_or_stop",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.94,
      reason: "user asked to pause or stop the active interaction",
      safety_review_required: true,
    };
  }
  if (
    activeCompatible &&
    state?.awaiting_user_input_type !== "none" &&
    /\bi\s+agree\b[^.?!]{0,80}\bservice\s+submissive\b|\bservice\s+submissive\b[^.?!]{0,80}\b(?:good first step|works|fits|agree)\b/i.test(
      normalized,
    )
  ) {
    return {
      speech_act: "readiness_confirmation",
      requested_facet: "active_readiness_confirmation",
      answer_contract: "active_readiness_confirmation",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.92,
      reason: "user selected service submissive for the pending role ask",
      safety_review_required: false,
      state_delta_type: "user_preference_delta",
      state_delta_summary: "user selected service submissive as the starting role",
      new_slots_added: ["desired_role"],
      desired_role: "service submissive",
      pending_unaddressed_slots: ["boundary", "service_lane"],
    };
  }
  if (
    activeCompatible &&
    state?.awaiting_user_input_type !== "none" &&
    /^(?:yes|yes\s+mistress|ok|okay|sounds\s+good|yes\s+please|i\s+agree|agreed)(?:[.!])?$/i.test(
      normalized,
    )
  ) {
    return {
      speech_act: "readiness_confirmation",
      requested_facet: "active_readiness_confirmation",
      answer_contract: "active_readiness_confirmation",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.91,
      reason: "user acknowledged the pending active assistant ask",
      safety_review_required: false,
      state_delta_type: /\bservice\s+submissive\b/i.test(normalized)
        ? "user_preference_delta"
        : "readiness_confirmation",
      state_delta_summary: /\bservice\s+submissive\b/i.test(normalized)
        ? "user selected service submissive as the starting role"
        : "user accepted the pending active ask",
      new_slots_added: /\bservice\s+submissive\b/i.test(normalized)
        ? ["desired_role"]
        : ["confirmation"],
      desired_role: /\bservice\s+submissive\b/i.test(normalized)
        ? "service submissive"
        : null,
      pending_unaddressed_slots: /\bservice\s+submissive\b/i.test(normalized)
        ? ["boundary", "service_lane"]
        : [],
    };
  }
  if (/\b(?:i'?m\s+confused|im\s+confused|i\s+don'?t\s+understand|what\s+do\s+you\s+mean|what\s+are\s+you\s+asking\s+me\s+to\s+do|explain\s+that|explain\s+that\s+again|say\s+that\s+simpler|can\s+you\s+clarify|what\s+do\s+you\s+mean\s+by\s+(?:that\s+)?task|what\s+do\s+you\s+mean\s+by\s+daily\s+task)\b/i.test(normalized)) {
    return {
      speech_act: "user_confusion",
      requested_facet: "clarification_recovery",
      answer_contract: "clarification_recovery",
      primary_subject: activeSubject,
      requested_operation: "clarify",
      confidence: 0.92,
      reason: "user is confused about the active step",
      safety_review_required: false,
    };
  }
  if (
    activeCompatible &&
    /\b(?:daily\s+task|service\s+task|give\s+me\s+(?:a\s+)?task|what\s+should\s+my\s+daily\s+task\s+be|what\s+task\s+should\s+i\s+do|how\s+about\s+a\s+daily\s+task|something\s+to\s+do\s+for\s+you\s+today|first\s+task|tasks?)\b/i.test(normalized)
  ) {
    return {
      speech_act: "service_request",
      requested_facet: "service_task",
      answer_contract: "service_task",
      primary_subject: /\bdaily|every\s+day\b/i.test(normalized) ? "daily service task" : "service task",
      requested_operation: "answer",
      confidence: 0.93,
      reason: "active relational task request stays in service task lane",
      safety_review_required: true,
    };
  }
  if (
    activeCompatible &&
    /\b(?:first\s+rule|rule|rules|protocol|permission rules?|daily check[- ]?in)\b/i.test(normalized)
  ) {
    return {
      speech_act: "protocol_setup_request",
      requested_facet: "protocol_setup",
      answer_contract: "protocol_setup",
      primary_subject: "active relational protocol",
      requested_operation: "answer",
      confidence: 0.9,
      reason: "active relational rule or protocol request",
      safety_review_required: true,
    };
  }
  if (
    activeCompatible &&
    /\b(?:i\s+don'?t\s+have\s+much\s+training|i\s+am\s+new\s+to\s+this|i'?m\s+new\s+to\s+this|i\s+am\s+inexperienced|i'?m\s+inexperienced|i\s+have\s+never\s+done\s+much\s+of\s+this|i\s+need\s+beginner\s+steps|beginner\s+steps)\b/i.test(normalized)
  ) {
    return {
      speech_act: "user_preference_disclosure",
      requested_facet: "training_guidance",
      answer_contract: "training_guidance",
      primary_subject: state?.training_goals.length
        ? state.training_goals.join(", ")
        : "beginner training pace",
      requested_operation: "answer",
      confidence: 0.9,
      reason: "user added low experience context to the active training plan",
      safety_review_required: true,
      state_delta_type: "user_experience_delta",
      state_delta_summary: "user has low experience and needs beginner-safe pacing",
      new_slots_added: ["experience_level"],
      pending_unaddressed_slots:
        state?.training_goals.includes("chastity training") === true
          ? []
          : ["chastity training"],
      experience_level: "beginner",
    };
  }
  if (
    activeCompatible &&
    /\b(?:training|trained|anal|chastity)\b/i.test(normalized)
  ) {
    const specificTrainingGoals = unique([
      /\banal\b/i.test(normalized) ? "anal training" : null,
      /\bchastity\b/i.test(normalized) ? "chastity training" : null,
    ]);
    return {
      speech_act: "user_preference_disclosure",
      requested_facet: "training_guidance",
      answer_contract: "training_guidance",
      primary_subject: specificTrainingGoals.length > 0 ? specificTrainingGoals.join(", ") : "training",
      requested_operation: "answer",
      confidence: 0.88,
      reason: "active relational training disclosure",
      safety_review_required: true,
      state_delta_type: "training_goal_delta",
      state_delta_summary: "user added active training goals",
      new_slots_added: ["training_goals"],
      pending_unaddressed_slots:
        specificTrainingGoals.length > 1 ? specificTrainingGoals.slice(1) : [],
    };
  }
  if (/\b(?:what\s+else|now\s+what|now\s+what\s+do\s+i\s+do|what\s+comes\s+next|what\s+should\s+i\s+do\s+next|first\s+instruction|what\s+is\s+your\s+first\s+instruction)\b/i.test(normalized)) {
    return {
      speech_act: "next_step_request",
      requested_facet: "active_next_step",
      answer_contract: "active_next_step",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.92,
      reason: "user asked for the next active step",
      safety_review_required: false,
    };
  }
  if (/\b(?:i'?m|i am)\s+ready\b|\bready\s+for\s+what'?s\s+next\b|\byes\s+.*\bnext\b|\byes\s+i\s+agree\b|\bi\s+agree\b|\bcontinue\b|\bkeep\s+going\b/i.test(normalized)) {
    return {
      speech_act: "readiness_confirmation",
      requested_facet: "active_readiness_confirmation",
      answer_contract: "active_readiness_confirmation",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.88,
      reason: "user confirmed readiness for the active interaction",
      safety_review_required: false,
    };
  }
  if (/\b(?:doing\s+that\s+now|i\s+started|started|still\s+doing\s+it|never\s+stopped|will\s+keep|keep\s+fingering|doing\s+it\s+now|feels\s+(?:so\s+)?(?:tight|intense|uncomfortable|painful|wrong))\b/i.test(normalized)) {
    return {
      speech_act: "progress_report",
      requested_facet: "active_progress_report",
      answer_contract: "active_progress_report",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.89,
      reason: "user reported progress or sensation on the active step",
      safety_review_required: /\b(?:uncomfortable|painful|wrong|too much|hurts?|tight|intense)\b/i.test(normalized),
    };
  }
  if (
    /\b(?:limit|boundary|too much|hurts?|pain|uncomfortable|stop if)\b/i.test(normalized) &&
    !/\bi\s+(?:want|need|like)\b/i.test(normalized) &&
    !/\b(?:tasks?|training|rules?|approval|permission)\b/i.test(normalized)
  ) {
    return {
      speech_act: "boundary_update",
      requested_facet: "boundary_update",
      answer_contract: "boundary_update",
      primary_subject: activeSubject,
      requested_operation: "answer",
      confidence: 0.84,
      reason: "user updated a boundary or safety condition",
      safety_review_required: true,
    };
  }
  return null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = normalizeLower(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    output.push(cleaned);
  }
  return output;
}

function interactionTypeForFacet(facet: string, currentDomain: string): ActiveInteractionType {
  if (currentDomain === "game") return "game";
  if (facet === "training_guidance") return "training_discussion";
  if (facet === "role_negotiation") return "relational_setup";
  if (
    facet === "service_initiation" ||
    facet === "service_direction" ||
    facet === "service_task" ||
    facet === "protocol_setup" ||
    facet === "expectations" ||
    facet === "correction_to_prior_plan" ||
    facet === "correction_to_active_interaction"
  ) {
    return "service_protocol";
  }
  if (facet.startsWith("active_")) return "check_in_sequence";
  return "generic_conversation";
}

function expectedResponseForFacet(facet: string): ExpectedUserResponseType {
  switch (facet) {
    case "training_guidance":
      return "confirmation";
    case "service_task":
    case "active_next_step":
    case "active_readiness_confirmation":
      return "progress_report";
    case "service_direction":
    case "service_initiation":
    case "role_negotiation":
    case "expectations":
    case "protocol_setup":
    case "clarification_recovery":
    case "active_step_confusion":
      return "answer";
    case "active_progress_report":
      return "next_step_request";
    default:
      return "none";
  }
}

function statusForFacet(facet: string): ActiveInteractionStatus {
  switch (facet) {
    case "training_guidance":
      return "awaiting_confirmation";
    case "service_task":
    case "active_next_step":
    case "active_readiness_confirmation":
      return "awaiting_progress_report";
    case "active_progress_report":
      return "awaiting_next_step_request";
    case "active_step_confusion":
    case "clarification_recovery":
      return "awaiting_user_answer";
    case "pause_or_stop":
      return "paused";
    default:
      return "awaiting_user_answer";
  }
}

function instructionSummaryForBrief(brief: ResponseBrief): string {
  switch (brief.requested_facet) {
    case "training_guidance":
      return `Keep ${brief.primary_subject ?? "the training"} gradual: name baseline comfort, pacing, limits, and the next small step.`;
    case "service_task":
      return "Complete one bounded service task and report back with outcome and limits.";
    case "service_direction":
    case "service_initiation":
      return "Send role, one hard limit, and the service lane to start from.";
    case "active_next_step":
    case "active_readiness_confirmation":
      return `Continue the active ${brief.interaction_type ?? "interaction"} with one bounded next step.`;
    case "active_progress_report":
      return "Acknowledge the progress report and wait for a next-step request or clear report-back.";
    case "active_step_confusion":
      return "Restate the current active instruction in simpler language with one example.";
    case "role_negotiation":
      return "Choose a role frame, name a boundary, and give one next step for the dynamic.";
    case "expectations":
      return "Explain Raven's expectations for the active dynamic and ask for one boundary or service lane.";
    default:
      return brief.reply_goal;
  }
}

function exampleForFacet(facet: string): string {
  switch (facet) {
    case "training_guidance":
      return "I agree; my baseline is comfortable, pain is a stop, and I want the next step gradual.";
    case "service_task":
    case "active_next_step":
    case "active_readiness_confirmation":
      return "I did the step, stayed inside my limit, and I am ready for the next instruction.";
    case "active_progress_report":
      return "I am doing it now; it feels intense but not painful.";
    case "active_step_confusion":
      return "I understand: I should answer with role, limit, and service lane.";
    default:
      return "I understand the step, my limit is clear, and I am ready to continue.";
  }
}

function answerSignature(text: string): string {
  return normalizeLower(text)
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 28)
    .join(" ");
}

type AssistantAskOverride = {
  interaction_type?: ActiveInteractionType;
  status?: ActiveInteractionStatus;
  expected_user_response_type: ExpectedUserResponseType;
  plain_language_summary: string;
  required_slots: string[];
  example_user_response: string;
  next_step_policy: string;
  protocol_rule?: string | null;
};

function inferAssistantAskOverride(input: {
  assistantText: string;
  responseBrief: ResponseBrief;
}): AssistantAskOverride | null {
  const text = normalizeLower(input.assistantText);
  if (
    input.responseBrief.domain_handler === "relational_dynamics" &&
    /\bchoose\b[^.?!]{0,80}\bfirst\s+rule\b|\bfirst\s+rule\b[^.?!]{0,80}\bhold\s+you\s+to\b/i.test(
      text,
    )
  ) {
    return {
      interaction_type: "relational_setup",
      status: "awaiting_user_answer",
      expected_user_response_type: "rule_selection",
      plain_language_summary:
        "Raven asked the user to choose the first rule for the dynamic.",
      required_slots: ["rule_selection"],
      example_user_response: "Start with a check-in rule.",
      next_step_policy: "wait for the user to choose or accept the first rule",
      protocol_rule: "first rule pending selection",
    };
  }
  if (
    input.responseBrief.domain_handler === "relational_dynamics" &&
    ["role_negotiation", "service_initiation", "service_direction", "protocol_setup"].includes(
      input.responseBrief.requested_facet,
    ) &&
    /\b(?:send|write|give)\b[^.?!]{0,100}\b(?:role|limit|service lane|check[- ]?in)\b/i.test(text)
  ) {
    return {
      interaction_type: "service_protocol",
      status: "awaiting_user_answer",
      expected_user_response_type: "answer",
      plain_language_summary:
        "Raven asked for a setup check-in with role, limit, and service lane.",
      required_slots: ["role", "hard_limit", "service_lane"],
      example_user_response:
        "I want to be your submissive. My hard limit is scat. I want tasks first.",
      next_step_policy: "wait for the setup check-in before giving a heavier instruction",
      protocol_rule: "setup check-in required",
    };
  }
  return null;
}

export function updateActiveInteractionState(input: {
  before?: ActiveInteractionState | null;
  turnMeaning: TurnMeaning;
  responseBrief: ResponseBrief;
  assistantText: string;
  turnId?: string | null;
}): {
  after: ActiveInteractionState;
  transition: ActiveInteractionTransition;
  attached_instruction_id: string | null;
} {
  const before = input.before ?? createActiveInteractionState();
  const facet = input.turnMeaning.requested_facet;
  const interactionType = interactionTypeForFacet(facet, input.turnMeaning.current_domain_handler);
  const shouldCreate =
    input.turnMeaning.current_domain_handler === "relational_dynamics" ||
    facet.startsWith("active_") ||
    facet === "pause_or_stop" ||
    facet === "correction_to_active_interaction" ||
    interactionType === "game";
  if (!shouldCreate && !isActiveInteractionLive(before)) {
    return {
      after: before,
      transition: {
        from_status: before.status,
        to_status: before.status,
        from_interaction_type: before.interaction_type,
        to_interaction_type: before.interaction_type,
        reason: "no_active_interaction_change",
      },
      attached_instruction_id: before.last_assistant_instruction?.instruction_id ?? null,
    };
  }
  const activeId =
    before.active_interaction_id ??
    stableId("interaction", `${input.turnMeaning.normalized_text}:${input.turnId ?? ""}:${interactionType}`);
  const instructionId = stableId("instruction", `${activeId}:${input.responseBrief.brief_id}:${facet}`);
  const askOverride = inferAssistantAskOverride({
    assistantText: input.assistantText,
    responseBrief: input.responseBrief,
  });
  const expected = askOverride?.expected_user_response_type ?? expectedResponseForFacet(facet);
  const instruction: ActiveInteractionInstruction = {
    instruction_id: instructionId,
    plain_language_summary:
      askOverride?.plain_language_summary ?? instructionSummaryForBrief(input.responseBrief),
    expected_user_response_type: expected,
    required_slots: askOverride?.required_slots ?? input.responseBrief.required_answer_slots,
    example_user_response: askOverride?.example_user_response ?? exampleForFacet(facet),
    safety_or_boundary_notes: input.responseBrief.allowed_boundaries,
    linked_response_brief_id: input.responseBrief.brief_id,
    linked_active_interaction_id: activeId,
  };
  const reportedProgress =
    facet === "active_progress_report" ||
    input.turnMeaning.speech_act === "progress_report" ||
    input.turnMeaning.speech_act === "continue_current_step";
  const confusion =
    facet === "active_step_confusion" || facet === "clarification_recovery"
      ? input.turnMeaning.raw_text
      : before.last_user_confusion;
  const stop = facet === "pause_or_stop";
  const status = stop ? "paused" : askOverride?.status ?? statusForFacet(facet);
  const nextStepPolicy =
    askOverride?.next_step_policy ??
    (status === "awaiting_progress_report"
      ? "wait for a progress report before escalating"
      : status === "awaiting_next_step_request"
        ? "offer the next bounded step when asked"
        : status === "awaiting_confirmation"
          ? "wait for consent or readiness before the first instruction"
          : stop
            ? "pause until the user explicitly restarts"
            : "clarify missing input before continuing");
  const resolvedInteractionType = askOverride?.interaction_type ?? interactionType;
  const after: ActiveInteractionState = {
    ...before,
    active_interaction_id: activeId,
    interaction_type: resolvedInteractionType === "generic_conversation" ? before.interaction_type : resolvedInteractionType,
    domain_handler: input.turnMeaning.current_domain_handler,
    status,
    current_step_id: instruction.instruction_id,
    current_step_summary: instruction.plain_language_summary,
    previous_step_summary: before.current_step_summary,
    next_step_policy: nextStepPolicy,
    user_goal: input.turnMeaning.primary_subject ?? before.user_goal,
    known_limits: unique([
      ...before.known_limits,
      ...(input.turnMeaning.dynamic_slots?.hard_limits ?? []),
    ]),
    known_boundaries: unique([
      ...before.known_boundaries,
      input.turnMeaning.dynamic_slots?.boundary_or_safety_needed ? "boundary review needed" : null,
    ]),
    known_equipment: unique([
      ...before.known_equipment,
      ...(input.turnMeaning.dynamic_slots?.disclosed_objects ?? []),
    ]),
    known_preferences: unique([
      ...before.known_preferences,
      input.turnMeaning.dynamic_slots?.user_preference ?? null,
      input.turnMeaning.dynamic_slots?.service_style ?? null,
      input.turnMeaning.dynamic_slots?.desired_role ?? null,
    ]),
    known_experience_level:
      input.turnMeaning.dynamic_slots?.experience_level ?? before.known_experience_level,
    awaiting_user_input_type: expected,
    last_assistant_instruction: instruction,
    last_assistant_question: input.assistantText.includes("?") ? instruction : before.last_assistant_question,
    last_user_progress_report: reportedProgress ? input.turnMeaning.raw_text : before.last_user_progress_report,
    last_user_confusion: confusion,
    stop_or_pause_signal_seen: stop || before.stop_or_pause_signal_seen,
    safety_review_required:
      input.responseBrief.active_interaction_safety_notes.length > 0 ||
      input.turnMeaning.dynamic_slots?.boundary_or_safety_needed === true ||
      before.safety_review_required,
    created_from_turn_id: before.active_interaction_id ? before.created_from_turn_id : input.turnId ?? null,
    updated_at_turn_id: input.turnId ?? null,
    current_task_lane:
      input.turnMeaning.dynamic_slots?.current_task_lane ??
      (facet === "service_task" ? "service task" : before.current_task_lane),
    daily_task_requested:
      input.turnMeaning.dynamic_slots?.daily_task_requested === true ||
      before.daily_task_requested,
    training_goals: unique([
      ...before.training_goals,
      ...(input.turnMeaning.dynamic_slots?.training_goals ?? []),
    ]),
    protocol_rules: unique([
      ...before.protocol_rules,
      ...(input.turnMeaning.dynamic_slots?.protocol_rules ?? []),
      input.turnMeaning.dynamic_slots?.requested_protocol ?? null,
      askOverride?.protocol_rule ?? null,
    ]),
    previous_response_brief_id: input.responseBrief.brief_id ?? before.previous_response_brief_id,
    answered_topics: unique([
      ...before.answered_topics,
      input.responseBrief.primary_subject,
      input.turnMeaning.requested_facet,
      ...(input.turnMeaning.dynamic_slots?.training_goals ?? []),
    ]),
    last_answer_signature: answerSignature(input.assistantText),
    last_answered_slots: input.responseBrief.must_address,
    pending_unaddressed_slots: unique([
      ...(input.turnMeaning.dynamic_slots?.pending_unaddressed_slots ?? []),
    ]),
    user_feedback_on_last_response:
      input.turnMeaning.dynamic_slots?.meta_feedback ?? before.user_feedback_on_last_response,
  };
  return {
    after,
    transition: {
      from_status: before.status,
      to_status: after.status,
      from_interaction_type: before.interaction_type,
      to_interaction_type: after.interaction_type,
      reason: askOverride
        ? `active_interaction_update:${facet}:assistant_ask_detected`
        : `active_interaction_update:${facet}`,
    },
    attached_instruction_id: instruction.instruction_id,
  };
}
