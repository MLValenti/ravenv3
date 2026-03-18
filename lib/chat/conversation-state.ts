import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  isAssistantSelfQuestion,
  isChatLikeSmalltalk,
  isNormalChatRequest,
  isProfileBuildingRequest,
  isMutualGettingToKnowRequest,
  normalizeInteractionMode,
  type InteractionMode,
} from "../session/interaction-mode.ts";

export type ConversationMode = InteractionMode;

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type RelationalMove =
  | "observe"
  | "press"
  | "soften"
  | "challenge"
  | "reward"
  | "hold"
  | "guide";

export type PressureLevel = "low" | "measured" | "high";
export type WarmthLevel = "cool" | "measured" | "warm";
export type UserResponseEnergy =
  | "guarded"
  | "hesitant"
  | "steady"
  | "open"
  | "eager"
  | "defensive"
  | "deflecting";

export type RelationalContinuityState = {
  raven_stance_in_current_exchange: string;
  current_emotional_beat: string;
  recent_vulnerability_or_defensiveness_from_user: string;
  pressure_level: PressureLevel;
  warmth_level: WarmthLevel;
  current_relational_direction: string;
  last_unresolved_relational_move: string;
  what_raven_has_implicitly_established_about_herself: string[];
  user_response_energy: UserResponseEnergy;
  should_press_soften_observe_challenge_reward_or_hold: RelationalMove;
};

export type StructuredRollingSummary = {
  active_topic: string;
  recent_topic_history: string[];
  user_goals: string[];
  commitments_or_assigned_tasks: string[];
  unresolved_questions: string[];
  open_loops: string[];
  important_user_facts: string[];
  current_tone_or_emotional_context: string;
  recent_mode_shifts: string[];
  important_entities: string[];
  relational_direction: string;
  emotional_beat_history: string[];
  unresolved_relational_moves: string[];
  raven_identity_notes: string[];
};

export type RequestedTurnAction =
  | "answer_direct_question"
  | "continue_active_thread"
  | "revise_previous_plan"
  | "modify_existing_idea"
  | "expand_previous_answer"
  | "generate_structured_output"
  | "interpret_and_reflect"
  | "clarify_missing_blocker"
  | "acknowledge_then_act"
  | "summarize_current_thread"
  | "shift_topic"
  | "gather_profile_only_when_needed"
  | "follow_through_commitment";

export type ResponseOutputShape =
  | "direct_answer"
  | "revised_plan"
  | "continuation_paragraph"
  | "structured_output"
  | "short_interpretation"
  | "observation_plus_guidance"
  | "acknowledgment_plus_modification"
  | "brief_answer_plus_next_step"
  | "single_clarifying_question"
  | "thread_summary";

export type ConversationStateSnapshot = {
  session_id: string;
  active_topic: string;
  current_mode: ConversationMode;
  user_goal: string | null;
  recent_facts_from_user: string[];
  recent_commitments_or_tasks: string[];
  unanswered_questions: string[];
  emotional_tone_or_conversation_tone: string;
  last_raven_intent: string;
  last_user_intent: string;
  open_loops: string[];
  important_entities: string[];
  active_thread: string;
  pending_user_request: string;
  pending_modification: string;
  last_satisfied_request: string;
  current_output_shape: ResponseOutputShape;
  request_fulfilled: boolean;
  current_turn_action: RequestedTurnAction;
  relational_continuity: RelationalContinuityState;
  rolling_summary: StructuredRollingSummary;
  recent_window: ConversationTurn[];
  updated_at: number;
};

type UserTurnInput = {
  text: string;
  userIntent: string;
  routeAct?: string | null;
  nowMs: number;
};

type AssistantTurnInput = {
  text: string;
  ravenIntent: string;
  nowMs: number;
};

const WINDOW_LIMIT = 10;
const LIST_LIMIT = 6;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "been",
  "from",
  "have",
  "just",
  "like",
  "make",
  "next",
  "that",
  "them",
  "then",
  "there",
  "they",
  "this",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function trimList(values: string[], limit = LIST_LIMIT): string[] {
  const deduped = Array.from(new Set(values.map((value) => normalize(value)).filter(Boolean)));
  return deduped.slice(-limit);
}

function appendRecentWindow(
  window: ConversationTurn[],
  next: ConversationTurn,
  limit = WINDOW_LIMIT,
): ConversationTurn[] {
  return [...window, next].slice(-limit);
}

function extractTopic(text: string): string | null {
  if (isProfileBuildingRequest(text)) {
    return "profile";
  }
  const patterns = [
    /\b(?:talk about|discuss|focus on|explore|plan|planning)\s+([^.!?]{2,80})/i,
    /\bhelp(?: me)?\s+plan(?:ning)?\s+([^.!?]{2,80})/i,
    /\bhelp with\s+([^.!?]{2,80})/i,
    /\b(?:build|create|make|give)\s+(?:me\s+)?(?:a|an|the)?\s*([^.!?]{2,80})/i,
    /\b(?:go back to|back to|return to)\s+([^.!?]{2,80})/i,
    /\b(?:play|game)\b/i,
    /\btask\b/i,
  ];
  for (const pattern of patterns.slice(0, 5)) {
    const directMatch = text.match(pattern);
    if (directMatch?.[1]) {
      return normalize(directMatch[1]).replace(/^the\s+/i, "");
    }
  }
  if (patterns[5].test(text)) {
    return "game";
  }
  if (patterns[6].test(text)) {
    return "task";
  }
  return null;
}

function extractGoal(text: string): string | null {
  const match =
    text.match(/\b(?:my goal is|i want to|i want|i need to|help me)\s+([^.!?]{3,120})/i) ??
    text.match(/\b(?:focus on|work on)\s+([^.!?]{3,120})/i);
  return match?.[1] ? normalize(match[1]) : null;
}

function extractFacts(text: string): string[] {
  const facts: string[] = [];
  const patterns = [
    /\bmy name is\s+([^.!?]{2,40})/i,
    /\bcall me\s+([^.!?]{2,40})/i,
    /\bi prefer\s+([^.!?]{2,80})/i,
    /\bi like\s+([^.!?]{2,80})/i,
    /\bi don't like\s+([^.!?]{2,80})/i,
    /\bmy goal is\s+([^.!?]{2,120})/i,
    /\bi want\s+([^.!?]{2,120})/i,
    /\bno\s+(public [^.!?]+|calls?[^.!?]*|pain[^.!?]*|humiliation[^.!?]*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      facts.push(normalize(match[0]));
    }
  }
  return trimList(facts);
}

function extractEntities(text: string): string[] {
  const requestedTopic = extractTopic(text);
  const tokens =
    normalize(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
      .slice(0, 6) ?? [];
  return trimList([...(requestedTopic ? [requestedTopic] : []), ...tokens], 8);
}

function inferTone(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(confused|unsure|not sure|lost)\b/.test(normalized)) {
    return "uncertain";
  }
  if (/\b(frustrated|annoyed|bored|tired)\b/.test(normalized)) {
    return "frustrated";
  }
  if (/\b(excited|ready|eager)\b/.test(normalized)) {
    return "engaged";
  }
  return "steady";
}

function inferUserResponseEnergy(text: string): UserResponseEnergy {
  const normalized = text.toLowerCase();
  if (/\b(whatever|fine|sure|i guess|if you say so)\b/.test(normalized)) {
    return "deflecting";
  }
  if (/\b(no|stop|not that|don't push|leave it)\b/.test(normalized)) {
    return "defensive";
  }
  if (/\b(i guess|maybe|not sure|i think|kind of)\b/.test(normalized)) {
    return "hesitant";
  }
  if (/\b(honestly|truth is|i admit|i like|i want|i need)\b/.test(normalized)) {
    return "open";
  }
  if (/\b(yes|ready|exactly|more|again)\b/.test(normalized)) {
    return "eager";
  }
  if (/\b(quiet|careful|guarded|private|hard to say|i don't usually)\b/.test(normalized)) {
    return "guarded";
  }
  return "steady";
}

function inferUserVulnerabilityOrDefensiveness(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(no|don't|do not|stop|not that|leave it|back off)\b/.test(normalized)) {
    return "defensive";
  }
  if (/\b(ashamed|embarrassed|afraid|nervous|vulnerable|hard to admit|hard to say)\b/.test(normalized)) {
    return "vulnerable";
  }
  if (/\b(i guess|maybe|not sure|i think)\b/.test(normalized)) {
    return "hesitant";
  }
  if (/\b(honestly|truth is|i admit)\b/.test(normalized)) {
    return "open";
  }
  return "steady";
}

function inferCurrentRelationalDirection(input: {
  text: string;
  currentMode: ConversationMode;
  previousDirection: string;
}): string {
  const normalized = input.text.toLowerCase();
  if (input.currentMode === "profile_building") {
    return "reading_the_user";
  }
  if (input.currentMode === "relational_chat") {
    return "mutual_tension";
  }
  if (/\b(ask me|tell me about yourself|what do you like|what are you into)\b/.test(normalized)) {
    return "reciprocal_disclosure";
  }
  if (/\b(why|what do you mean|explain|clarify|what\?)\b/.test(normalized)) {
    return "stabilizing_meaning";
  }
  if (/\b(i want|i need|my goal|help me)\b/.test(normalized)) {
    return "defining_terms";
  }
  return input.previousDirection || "holding_presence";
}

function inferCurrentEmotionalBeat(input: {
  text: string;
  currentMode: ConversationMode;
  previousBeat: string;
}): string {
  const normalized = input.text.toLowerCase();
  if (/\b(ashamed|embarrassed|afraid|nervous)\b/.test(normalized)) {
    return "tender_exposure";
  }
  if (/\b(no|don't|leave it|not that)\b/.test(normalized)) {
    return "resistance";
  }
  if (/\b(honestly|truth is|i admit)\b/.test(normalized)) {
    return "earned_honesty";
  }
  if (input.currentMode === "profile_building") {
    return "measured_reading";
  }
  if (input.currentMode === "relational_chat") {
    return "charged_attention";
  }
  if (/\b(why|what|how|explain|clarify)\b/.test(normalized)) {
    return "controlled_explanation";
  }
  return input.previousBeat || "steady_pressure";
}

function inferNextRelationalMove(input: {
  text: string;
  currentMode: ConversationMode;
  vulnerability: string;
  userEnergy: UserResponseEnergy;
}): RelationalMove {
  const normalized = input.text.toLowerCase();
  if (input.vulnerability === "vulnerable") {
    return "soften";
  }
  if (input.vulnerability === "defensive" || input.userEnergy === "deflecting") {
    return "challenge";
  }
  if (/\b(honestly|truth is|i admit)\b/.test(normalized)) {
    return "reward";
  }
  if (input.currentMode === "profile_building") {
    return /\?/.test(normalized) ? "guide" : "observe";
  }
  if (input.currentMode === "relational_chat") {
    return "hold";
  }
  if (/\b(why|what|how|explain|clarify)\b/.test(normalized)) {
    return "guide";
  }
  if (/\b(i want|i need|help me)\b/.test(normalized)) {
    return "press";
  }
  return "observe";
}

function inferPressureLevelFromMove(move: RelationalMove, mode: ConversationMode): PressureLevel {
  if (mode === "task_execution" || mode === "locked_task_execution") {
    return "high";
  }
  if (move === "press" || move === "challenge") {
    return "high";
  }
  if (move === "guide" || move === "hold") {
    return "measured";
  }
  return "low";
}

function inferWarmthLevel(input: {
  move: RelationalMove;
  vulnerability: string;
  mode: ConversationMode;
}): WarmthLevel {
  if (input.move === "soften" || input.vulnerability === "vulnerable") {
    return "warm";
  }
  if (input.mode === "relational_chat" || input.move === "reward") {
    return "measured";
  }
  return "cool";
}

function inferRavenStance(input: {
  mode: ConversationMode;
  move: RelationalMove;
  warmth: WarmthLevel;
}): string {
  if (input.mode === "profile_building") {
    return input.move === "observe" ? "quiet_reading" : "measured_dominance";
  }
  if (input.mode === "relational_chat") {
    return input.warmth === "warm" ? "selective_warmth" : "self_possessed_control";
  }
  if (input.move === "challenge" || input.move === "press") {
    return "cool_pressure";
  }
  if (input.move === "reward") {
    return "selective_approval";
  }
  return "measured_dominance";
}

function extractRavenIdentityNotes(text: string): string[] {
  const matches = [
    ...text.matchAll(/\b(i (?:like|prefer|notice|pay attention|remember|care more about|read people quickly|lose interest when|decide|keep|watch))\b[^.!?]{0,120}/gi),
  ].map((match) => normalize(match[0]));
  return trimList(matches, 6);
}

function createDefaultRequestedTurnAction(): RequestedTurnAction {
  return "continue_active_thread";
}

function normalizeRequestedTurnAction(value: unknown): RequestedTurnAction {
  const action = typeof value === "string" ? normalize(value) : "";
  switch (action) {
    case "answer_direct_question":
    case "continue_active_thread":
    case "revise_previous_plan":
    case "modify_existing_idea":
    case "expand_previous_answer":
    case "generate_structured_output":
    case "interpret_and_reflect":
    case "clarify_missing_blocker":
    case "acknowledge_then_act":
    case "summarize_current_thread":
    case "shift_topic":
    case "gather_profile_only_when_needed":
    case "follow_through_commitment":
      return action;
    default:
      return createDefaultRequestedTurnAction();
  }
}

function createDefaultResponseOutputShape(): ResponseOutputShape {
  return "continuation_paragraph";
}

function normalizeResponseOutputShape(value: unknown): ResponseOutputShape {
  const shape = typeof value === "string" ? normalize(value) : "";
  switch (shape) {
    case "direct_answer":
    case "revised_plan":
    case "continuation_paragraph":
    case "structured_output":
    case "short_interpretation":
    case "observation_plus_guidance":
    case "acknowledgment_plus_modification":
    case "brief_answer_plus_next_step":
    case "single_clarifying_question":
    case "thread_summary":
      return shape;
    default:
      return createDefaultResponseOutputShape();
  }
}

function resolveExistingThread(state?: ConversationStateSnapshot | null): string {
  if (!state) {
    return "none";
  }
  return (
    state.active_thread ||
    state.pending_user_request ||
    state.recent_commitments_or_tasks[0] ||
    state.open_loops[0] ||
    state.active_topic ||
    state.user_goal ||
    "none"
  );
}

function isBareOpinionFollowUp(text: string): boolean {
  return /^\s*(?:and\s+)?what do you think\??\s*$/i.test(normalize(text));
}

function isSummaryRequest(text: string): boolean {
  return /\b(summarize|summary|where are we|what have you learned|what do you have so far|recap)\b/i.test(
    text,
  );
}

function hasStructuredOutputCue(text: string): boolean {
  return /\b(outline|list|steps?|bullet|structure|format|break it down|layout)\b/i.test(
    text,
  );
}

function hasContinuationCue(text: string): boolean {
  return /\b(continue|keep going|go on|more on that|more on this|expand|go deeper|stay on|same thread)\b/i.test(
    text,
  );
}

function hasRevisionCue(text: string): boolean {
  return /\b(change|instead|revise|rewrite|rework|adjust|swap|replace|turn it into)\b/i.test(text);
}

function hasModificationCue(text: string): boolean {
  return (
    /\b(add|include|with|using|fold in|bring in|work in|make it|make that|more|less|another layer)\b/i.test(
      text,
    ) ||
    /^\s*what about(?:\s+if)?\b/i.test(text)
  );
}

function hasTopicShiftCue(text: string): boolean {
  return /\b(let'?s talk about|let'?s discuss|switch to|change topic|different topic|back to|go back to|return to|focus on)\b/i.test(
    text,
  );
}

function extractPendingModification(text: string): string {
  const patterns = [
    /\b(?:add|include|use|using|with|fold in|bring in|work in)\s+([^.!?]{2,120})/i,
    /\b(?:change|revise|adjust|replace|swap)\s+([^.!?]{2,120})/i,
    /\bmake it\s+([^.!?]{2,120})/i,
    /^\s*what about(?:\s+if)?\s+([^.!?]{2,120})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalize(match[1]);
    }
  }
  return "none";
}

function deriveRequestedAction(input: {
  text: string;
  currentMode: ConversationMode;
  state?: ConversationStateSnapshot | null;
  previousAssistantMessage?: string | null;
}): RequestedTurnAction {
  const normalized = normalize(input.text).toLowerCase();
  const existingThread = resolveExistingThread(input.state);

  if (isSummaryRequest(normalized)) {
    return "summarize_current_thread";
  }
  if (hasTopicShiftCue(normalized) && extractTopic(normalized)) {
    return "shift_topic";
  }
  if (hasRevisionCue(normalized) && existingThread !== "none") {
    return "revise_previous_plan";
  }
  if (hasModificationCue(normalized) && existingThread !== "none") {
    return "modify_existing_idea";
  }
  if (hasStructuredOutputCue(normalized) && !isQuestion(normalized)) {
    return "generate_structured_output";
  }
  if (isBareOpinionFollowUp(normalized)) {
    return "interpret_and_reflect";
  }
  if (
    !input.previousAssistantMessage &&
    /\b(give me|build me|make me|show me|write me)\b/i.test(normalized)
  ) {
    return "continue_active_thread";
  }
  if (hasContinuationCue(normalized) && existingThread !== "none") {
    return "expand_previous_answer";
  }
  if (
    /\b(give me|build me|make me|use that and give me|show me|write me)\b/i.test(normalized) &&
    existingThread !== "none"
  ) {
    return "modify_existing_idea";
  }
  if (
    input.previousAssistantMessage &&
    /\?/.test(input.previousAssistantMessage) &&
    normalized.length > 0 &&
    !isQuestion(normalized)
  ) {
    return input.currentMode === "profile_building"
      ? "gather_profile_only_when_needed"
      : "acknowledge_then_act";
  }
  if (
    input.previousAssistantMessage &&
    /\b(start|next|first|report|hold|lock in|we will|you will|pick|choose|we are doing)\b/i.test(
      input.previousAssistantMessage,
    ) &&
    /^(ok|okay|yes|done|ready|go on|continue|start)$/i.test(normalized)
  ) {
    return "follow_through_commitment";
  }
  if (isQuestion(normalized)) {
    return "answer_direct_question";
  }
  if (input.currentMode === "profile_building" && !isQuestion(normalized)) {
    return "gather_profile_only_when_needed";
  }
  if (input.currentMode === "profile_building") {
    return "gather_profile_only_when_needed";
  }
  if (existingThread !== "none") {
    return "continue_active_thread";
  }
  return "continue_active_thread";
}

function deriveOutputShape(action: RequestedTurnAction): ResponseOutputShape {
  switch (action) {
    case "answer_direct_question":
      return "direct_answer";
    case "revise_previous_plan":
      return "revised_plan";
    case "modify_existing_idea":
    case "acknowledge_then_act":
      return "acknowledgment_plus_modification";
    case "generate_structured_output":
      return "structured_output";
    case "interpret_and_reflect":
    case "gather_profile_only_when_needed":
      return "short_interpretation";
    case "clarify_missing_blocker":
      return "single_clarifying_question";
    case "summarize_current_thread":
      return "thread_summary";
    case "follow_through_commitment":
      return "brief_answer_plus_next_step";
    case "shift_topic":
      return "observation_plus_guidance";
    case "expand_previous_answer":
    case "continue_active_thread":
    default:
      return "continuation_paragraph";
  }
}

function deriveActiveThread(input: {
  text: string;
  state?: ConversationStateSnapshot | null;
  action: RequestedTurnAction;
}): string {
  const requestedTopic = extractTopic(input.text);
  if (requestedTopic) {
    return requestedTopic;
  }
  if (input.action === "shift_topic" && requestedTopic) {
    return requestedTopic;
  }
  const existingThread = resolveExistingThread(input.state);
  if (existingThread !== "none") {
    return existingThread;
  }
  return requestedTopic ?? "none";
}

function hasEnoughContextForAction(input: {
  text: string;
  state?: ConversationStateSnapshot | null;
  action: RequestedTurnAction;
  activeThread: string;
  previousAssistantMessage?: string | null;
}): boolean {
  switch (input.action) {
    case "modify_existing_idea":
    case "revise_previous_plan":
    case "expand_previous_answer":
    case "continue_active_thread":
    case "summarize_current_thread":
    case "follow_through_commitment":
      return input.activeThread !== "none" || Boolean(input.previousAssistantMessage);
    case "generate_structured_output":
      return input.activeThread !== "none" || hasStructuredOutputCue(input.text);
    case "interpret_and_reflect":
    case "acknowledge_then_act":
      return Boolean(input.previousAssistantMessage) || input.activeThread !== "none";
    case "shift_topic":
    case "answer_direct_question":
    case "gather_profile_only_when_needed":
      return true;
    case "clarify_missing_blocker":
      return false;
    default:
      return true;
  }
}

function derivePendingUserRequest(text: string, action: RequestedTurnAction): string {
  if (action === "clarify_missing_blocker") {
    return "none";
  }
  return normalize(text) || "none";
}

function inferAssistantOutputShape(text: string, fallback: ResponseOutputShape): ResponseOutputShape {
  const normalized = normalize(text);
  if (!normalized) {
    return fallback;
  }
  if (/\b(so far|current thread|already set|still open)\b/i.test(normalized)) {
    return "thread_summary";
  }
  if (/^(?:\d+\.|-)\s+/m.test(text)) {
    return "structured_output";
  }
  if (/\?/.test(normalized)) {
    return normalized.split("?").length - 1 <= 1
      ? "single_clarifying_question"
      : fallback;
  }
  if (/\b(i think|that tells me|what matters is|useful when|i care more about)\b/i.test(normalized)) {
    return "short_interpretation";
  }
  if (/\b(next|start|first|then)\b/i.test(normalized)) {
    return "brief_answer_plus_next_step";
  }
  return fallback;
}

function isRequestFulfilled(input: {
  text: string;
  action: RequestedTurnAction;
  pendingUserRequest: string;
  activeThread: string;
  pendingModification: string;
  outputShape: ResponseOutputShape;
}): boolean {
  const response = normalize(input.text).toLowerCase();
  if (!response) {
    return false;
  }
  const activeThread = normalize(input.activeThread).toLowerCase();
  const pendingRequest = normalize(input.pendingUserRequest).toLowerCase();
  const pendingModification = normalize(input.pendingModification).toLowerCase();
  const hasThreadReference =
    activeThread === "none" ||
    activeThread.length < 4 ||
    response.includes(activeThread) ||
    extractEntities(activeThread).some((token) => response.includes(token));
  const hasRequestReference =
    pendingRequest === "none" ||
    pendingRequest.length < 4 ||
    extractEntities(pendingRequest).some((token) => response.includes(token));
  const hasModificationReference =
    pendingModification === "none" ||
    pendingModification.length < 4 ||
    extractEntities(pendingModification).some((token) => response.includes(token));

  if (input.action === "clarify_missing_blocker") {
    return /\?/.test(response);
  }
  if (input.outputShape === "thread_summary") {
    return /\b(so far|current thread|already set|still open)\b/i.test(response);
  }
  if (input.outputShape === "structured_output") {
    return /^(?:\d+\.|-)\s+/m.test(input.text);
  }
  if (input.action === "interpret_and_reflect") {
    return (
      /\b(i think|that tells me|what matters is|useful when|i care more about|the part that matters)\b/i.test(
        response,
      ) && (hasThreadReference || hasRequestReference)
    );
  }
  if (input.action === "modify_existing_idea" || input.action === "revise_previous_plan") {
    return hasThreadReference && hasModificationReference && !/^\s*(what|which|do)\b/i.test(response);
  }
  if (input.action === "answer_direct_question") {
    return hasRequestReference || hasThreadReference;
  }
  return hasThreadReference || hasRequestReference;
}

export function resolveTurnRequestState(input: {
  text: string;
  currentMode: ConversationMode;
  state?: ConversationStateSnapshot | null;
  previousAssistantMessage?: string | null;
}): {
  action: RequestedTurnAction;
  activeThread: string;
  pendingUserRequest: string;
  pendingModification: string;
  outputShape: ResponseOutputShape;
  hasSufficientContextToAct: boolean;
} {
  const action = deriveRequestedAction(input);
  const activeThread = deriveActiveThread({
    text: input.text,
    state: input.state,
    action,
  });
  const pendingUserRequest = derivePendingUserRequest(input.text, action);
  const pendingModification =
    action === "modify_existing_idea" || action === "revise_previous_plan"
      ? extractPendingModification(input.text)
      : "none";
  const hasSufficientContextToAct = hasEnoughContextForAction({
    text: input.text,
    state: input.state,
    action,
    activeThread,
    previousAssistantMessage: input.previousAssistantMessage,
  });

  return {
    action: hasSufficientContextToAct ? action : "clarify_missing_blocker",
    activeThread,
    pendingUserRequest,
    pendingModification,
    outputShape: deriveOutputShape(hasSufficientContextToAct ? action : "clarify_missing_blocker"),
    hasSufficientContextToAct,
  };
}

function createRelationalContinuityState(): RelationalContinuityState {
  return {
    raven_stance_in_current_exchange: "measured_dominance",
    current_emotional_beat: "steady_pressure",
    recent_vulnerability_or_defensiveness_from_user: "steady",
    pressure_level: "measured",
    warmth_level: "cool",
    current_relational_direction: "holding_presence",
    last_unresolved_relational_move: "none",
    what_raven_has_implicitly_established_about_herself: [],
    user_response_energy: "steady",
    should_press_soften_observe_challenge_reward_or_hold: "observe",
  };
}

export function normalizeRelationalContinuityState(value: unknown): RelationalContinuityState {
  if (!value || typeof value !== "object") {
    return createRelationalContinuityState();
  }
  const raw = value as Partial<RelationalContinuityState>;
  const base = createRelationalContinuityState();
  const pressure =
    raw.pressure_level === "low" || raw.pressure_level === "measured" || raw.pressure_level === "high"
      ? raw.pressure_level
      : base.pressure_level;
  const warmth =
    raw.warmth_level === "cool" || raw.warmth_level === "measured" || raw.warmth_level === "warm"
      ? raw.warmth_level
      : base.warmth_level;
  const energy =
    raw.user_response_energy === "guarded" ||
    raw.user_response_energy === "hesitant" ||
    raw.user_response_energy === "steady" ||
    raw.user_response_energy === "open" ||
    raw.user_response_energy === "eager" ||
    raw.user_response_energy === "defensive" ||
    raw.user_response_energy === "deflecting"
      ? raw.user_response_energy
      : base.user_response_energy;
  const move =
    raw.should_press_soften_observe_challenge_reward_or_hold === "observe" ||
    raw.should_press_soften_observe_challenge_reward_or_hold === "press" ||
    raw.should_press_soften_observe_challenge_reward_or_hold === "soften" ||
    raw.should_press_soften_observe_challenge_reward_or_hold === "challenge" ||
    raw.should_press_soften_observe_challenge_reward_or_hold === "reward" ||
    raw.should_press_soften_observe_challenge_reward_or_hold === "hold" ||
    raw.should_press_soften_observe_challenge_reward_or_hold === "guide"
      ? raw.should_press_soften_observe_challenge_reward_or_hold
      : base.should_press_soften_observe_challenge_reward_or_hold;

  return {
    raven_stance_in_current_exchange:
      typeof raw.raven_stance_in_current_exchange === "string" &&
      normalize(raw.raven_stance_in_current_exchange)
        ? normalize(raw.raven_stance_in_current_exchange)
        : base.raven_stance_in_current_exchange,
    current_emotional_beat:
      typeof raw.current_emotional_beat === "string" && normalize(raw.current_emotional_beat)
        ? normalize(raw.current_emotional_beat)
        : base.current_emotional_beat,
    recent_vulnerability_or_defensiveness_from_user:
      typeof raw.recent_vulnerability_or_defensiveness_from_user === "string" &&
      normalize(raw.recent_vulnerability_or_defensiveness_from_user)
        ? normalize(raw.recent_vulnerability_or_defensiveness_from_user)
        : base.recent_vulnerability_or_defensiveness_from_user,
    pressure_level: pressure,
    warmth_level: warmth,
    current_relational_direction:
      typeof raw.current_relational_direction === "string" && normalize(raw.current_relational_direction)
        ? normalize(raw.current_relational_direction)
        : base.current_relational_direction,
    last_unresolved_relational_move:
      typeof raw.last_unresolved_relational_move === "string" && normalize(raw.last_unresolved_relational_move)
        ? normalize(raw.last_unresolved_relational_move)
        : base.last_unresolved_relational_move,
    what_raven_has_implicitly_established_about_herself: trimList(
      Array.isArray(raw.what_raven_has_implicitly_established_about_herself)
        ? raw.what_raven_has_implicitly_established_about_herself
        : [],
      6,
    ),
    user_response_energy: energy,
    should_press_soften_observe_challenge_reward_or_hold: move,
  };
}

function isQuestion(text: string): boolean {
  return (
    /\?/.test(text) || /^(what|why|how|when|where|who|which|can|could|would|will)\b/i.test(text)
  );
}

function createStructuredRollingSummary(): StructuredRollingSummary {
  return {
    active_topic: "none",
    recent_topic_history: [],
    user_goals: [],
    commitments_or_assigned_tasks: [],
    unresolved_questions: [],
    open_loops: [],
    important_user_facts: [],
    current_tone_or_emotional_context: "steady",
    recent_mode_shifts: [],
    important_entities: [],
    relational_direction: "holding_presence",
    emotional_beat_history: [],
    unresolved_relational_moves: [],
    raven_identity_notes: [],
  };
}

export function normalizeStructuredRollingSummary(value: unknown): StructuredRollingSummary {
  if (!value || typeof value !== "object") {
    return createStructuredRollingSummary();
  }

  const raw = value as Partial<StructuredRollingSummary>;
  return {
    active_topic:
      typeof raw.active_topic === "string" && normalize(raw.active_topic)
        ? normalize(raw.active_topic)
        : "none",
    recent_topic_history: trimList(
      Array.isArray(raw.recent_topic_history) ? raw.recent_topic_history : [],
      8,
    ),
    user_goals: trimList(Array.isArray(raw.user_goals) ? raw.user_goals : [], 4),
    commitments_or_assigned_tasks: trimList(
      Array.isArray(raw.commitments_or_assigned_tasks) ? raw.commitments_or_assigned_tasks : [],
      8,
    ),
    unresolved_questions: trimList(
      Array.isArray(raw.unresolved_questions) ? raw.unresolved_questions : [],
      8,
    ),
    open_loops: trimList(Array.isArray(raw.open_loops) ? raw.open_loops : [], 8),
    important_user_facts: trimList(
      Array.isArray(raw.important_user_facts) ? raw.important_user_facts : [],
      8,
    ),
    current_tone_or_emotional_context:
      typeof raw.current_tone_or_emotional_context === "string" &&
      normalize(raw.current_tone_or_emotional_context)
        ? normalize(raw.current_tone_or_emotional_context)
        : "steady",
    recent_mode_shifts: trimList(
      Array.isArray(raw.recent_mode_shifts) ? raw.recent_mode_shifts : [],
      8,
    ),
    important_entities: trimList(
      Array.isArray(raw.important_entities) ? raw.important_entities : [],
      8,
    ),
    relational_direction:
      typeof raw.relational_direction === "string" && normalize(raw.relational_direction)
        ? normalize(raw.relational_direction)
        : "holding_presence",
    emotional_beat_history: trimList(
      Array.isArray(raw.emotional_beat_history) ? raw.emotional_beat_history : [],
      8,
    ),
    unresolved_relational_moves: trimList(
      Array.isArray(raw.unresolved_relational_moves) ? raw.unresolved_relational_moves : [],
      8,
    ),
    raven_identity_notes: trimList(
      Array.isArray(raw.raven_identity_notes) ? raw.raven_identity_notes : [],
      8,
    ),
  };
}

function appendHistoryIfChanged(
  history: string[],
  nextValue: string,
  previousValue: string,
): string[] {
  if (!nextValue || nextValue === "none" || nextValue === previousValue) {
    return history;
  }
  return trimList([...history, nextValue], 8);
}

function appendModeShift(
  shifts: string[],
  previousMode: ConversationMode,
  nextMode: ConversationMode,
): string[] {
  if (previousMode === nextMode) {
    return shifts;
  }
  return trimList([...shifts, `${previousMode} -> ${nextMode}`], 8);
}

function buildRollingSummary(state: ConversationStateSnapshot): StructuredRollingSummary {
  const previous = normalizeStructuredRollingSummary(state.rolling_summary);
  return {
    active_topic: state.active_topic || "none",
    recent_topic_history: appendHistoryIfChanged(
      previous.recent_topic_history,
      state.active_topic,
      previous.active_topic,
    ),
    user_goals: trimList(
      [...previous.user_goals, ...(state.user_goal ? [state.user_goal] : [])],
      4,
    ),
    commitments_or_assigned_tasks: trimList(state.recent_commitments_or_tasks, 8),
    unresolved_questions: trimList(state.unanswered_questions, 8),
    open_loops: trimList(state.open_loops, 8),
    important_user_facts: trimList(state.recent_facts_from_user, 8),
    current_tone_or_emotional_context: state.emotional_tone_or_conversation_tone,
    recent_mode_shifts: appendModeShift(
      previous.recent_mode_shifts,
      state.current_mode,
      state.current_mode,
    ),
    important_entities: trimList(state.important_entities, 8),
    relational_direction:
      state.relational_continuity.current_relational_direction || previous.relational_direction,
    emotional_beat_history: trimList(
      [...previous.emotional_beat_history, state.relational_continuity.current_emotional_beat],
      8,
    ),
    unresolved_relational_moves: trimList(
      [
        ...previous.unresolved_relational_moves,
        state.relational_continuity.last_unresolved_relational_move,
      ].filter((value) => value && value !== "none"),
      8,
    ),
    raven_identity_notes: trimList(
      [
        ...previous.raven_identity_notes,
        ...state.relational_continuity.what_raven_has_implicitly_established_about_herself,
      ],
      8,
    ),
  };
}

function buildRollingSummaryWithTransition(
  previousState: ConversationStateSnapshot,
  nextState: ConversationStateSnapshot,
): StructuredRollingSummary {
  const previousSummary = normalizeStructuredRollingSummary(previousState.rolling_summary);
  return {
    active_topic: nextState.active_topic || "none",
    recent_topic_history: appendHistoryIfChanged(
      previousSummary.recent_topic_history,
      nextState.active_topic,
      previousState.active_topic,
    ),
    user_goals: trimList(
      [...previousSummary.user_goals, ...(nextState.user_goal ? [nextState.user_goal] : [])],
      4,
    ),
    commitments_or_assigned_tasks: trimList(nextState.recent_commitments_or_tasks, 8),
    unresolved_questions: trimList(nextState.unanswered_questions, 8),
    open_loops: trimList(nextState.open_loops, 8),
    important_user_facts: trimList(nextState.recent_facts_from_user, 8),
    current_tone_or_emotional_context: nextState.emotional_tone_or_conversation_tone,
    recent_mode_shifts: appendModeShift(
      previousSummary.recent_mode_shifts,
      previousState.current_mode,
      nextState.current_mode,
    ),
    important_entities: trimList(nextState.important_entities, 8),
    relational_direction:
      nextState.relational_continuity.current_relational_direction ||
      previousSummary.relational_direction,
    emotional_beat_history: trimList(
      [
        ...previousSummary.emotional_beat_history,
        nextState.relational_continuity.current_emotional_beat,
      ],
      8,
    ),
    unresolved_relational_moves: trimList(
      [
        ...previousSummary.unresolved_relational_moves,
        nextState.relational_continuity.last_unresolved_relational_move,
      ].filter((value) => value && value !== "none"),
      8,
    ),
    raven_identity_notes: trimList(
      [
        ...previousSummary.raven_identity_notes,
        ...nextState.relational_continuity.what_raven_has_implicitly_established_about_herself,
      ],
      8,
    ),
  };
}

export function formatRollingSummaryText(summary: StructuredRollingSummary): string {
  const lines = [
    `active_topic: ${summary.active_topic || "none"}`,
    `recent_topic_history: ${summary.recent_topic_history.join(" | ") || "none"}`,
    `user_goals: ${summary.user_goals.join(" | ") || "none"}`,
    `commitments_or_assigned_tasks: ${summary.commitments_or_assigned_tasks.join(" | ") || "none"}`,
    `unresolved_questions: ${summary.unresolved_questions.join(" | ") || "none"}`,
    `open_loops: ${summary.open_loops.join(" | ") || "none"}`,
    `important_user_facts: ${summary.important_user_facts.join(" | ") || "none"}`,
    `current_tone_or_emotional_context: ${summary.current_tone_or_emotional_context || "steady"}`,
    `recent_mode_shifts: ${summary.recent_mode_shifts.join(" | ") || "none"}`,
    `important_entities: ${summary.important_entities.join(" | ") || "none"}`,
    `relational_direction: ${summary.relational_direction || "holding_presence"}`,
    `emotional_beat_history: ${summary.emotional_beat_history.join(" | ") || "none"}`,
    `unresolved_relational_moves: ${summary.unresolved_relational_moves.join(" | ") || "none"}`,
    `raven_identity_notes: ${summary.raven_identity_notes.join(" | ") || "none"}`,
  ];
  return lines.join("\n");
}

function inferMode(input: {
  userIntent: string;
  routeAct?: string | null;
  text: string;
  previousMode: ConversationMode;
}): ConversationMode {
  const normalized = input.text.toLowerCase();
  if (isAssistantSelfQuestion(normalized) || isMutualGettingToKnowRequest(normalized)) {
    return "relational_chat";
  }
  if (isProfileBuildingRequest(normalized)) {
    return "profile_building";
  }
  if (input.routeAct === "propose_activity" || input.routeAct === "answer_activity_choice") {
    return "game";
  }
  if (input.routeAct === "task_request") {
    return "task_planning";
  }
  if (input.userIntent === "user_question" || input.userIntent === "user_short_follow_up") {
    return "question_answering";
  }
  if (isNormalChatRequest(normalized) || isChatLikeSmalltalk(normalized)) {
    return "normal_chat";
  }
  if (input.previousMode === "profile_building") {
    return "profile_building";
  }
  return "normal_chat";
}

function questionSatisfied(question: string, assistantText: string): boolean {
  const questionTokens = extractEntities(question);
  const answer = normalize(assistantText).toLowerCase();
  if (questionTokens.length === 0) {
    return answer.length > 0;
  }
  return questionTokens.some((token) => answer.includes(token));
}

function extractCommitments(text: string): string[] {
  const matches = [
    ...text.matchAll(
      /\b(?:you will|next|start by|start with|we will|i want you to|pick|choose|report|lock in)\b[^.!?]{3,120}/gi,
    ),
    ...text.matchAll(/\b(?:task|challenge|checkpoint)\b[^.!?]{6,120}/gi),
  ];
  return trimList(matches.map((match) => normalize(match[0])));
}

export function createConversationStateSnapshot(
  sessionId = "default-session",
): ConversationStateSnapshot {
  return {
    session_id: sessionId,
    active_topic: "none",
    current_mode: "normal_chat",
    user_goal: null,
    recent_facts_from_user: [],
    recent_commitments_or_tasks: [],
    unanswered_questions: [],
    emotional_tone_or_conversation_tone: "steady",
    last_raven_intent: "none",
    last_user_intent: "none",
    open_loops: [],
    important_entities: [],
    active_thread: "none",
    pending_user_request: "none",
    pending_modification: "none",
    last_satisfied_request: "none",
    current_output_shape: createDefaultResponseOutputShape(),
    request_fulfilled: true,
    current_turn_action: createDefaultRequestedTurnAction(),
    relational_continuity: createRelationalContinuityState(),
    rolling_summary: createStructuredRollingSummary(),
    recent_window: [],
    updated_at: Date.now(),
  };
}

export function normalizeConversationStateSnapshot(
  value: unknown,
  sessionId = "default-session",
): ConversationStateSnapshot {
  if (!value || typeof value !== "object") {
    return createConversationStateSnapshot(sessionId);
  }
  const raw = value as Partial<ConversationStateSnapshot>;
  const base = createConversationStateSnapshot(
    typeof raw.session_id === "string" && raw.session_id.trim() ? raw.session_id : sessionId,
  );
  const normalized: ConversationStateSnapshot = {
    ...base,
    active_topic:
      typeof raw.active_topic === "string" ? normalize(raw.active_topic) || "none" : "none",
    current_mode: normalizeInteractionMode(raw.current_mode),
    user_goal: typeof raw.user_goal === "string" ? normalize(raw.user_goal) : null,
    recent_facts_from_user: trimList(
      Array.isArray(raw.recent_facts_from_user) ? raw.recent_facts_from_user : [],
    ),
    recent_commitments_or_tasks: trimList(
      Array.isArray(raw.recent_commitments_or_tasks) ? raw.recent_commitments_or_tasks : [],
    ),
    unanswered_questions: trimList(
      Array.isArray(raw.unanswered_questions) ? raw.unanswered_questions : [],
    ),
    emotional_tone_or_conversation_tone:
      typeof raw.emotional_tone_or_conversation_tone === "string"
        ? normalize(raw.emotional_tone_or_conversation_tone)
        : base.emotional_tone_or_conversation_tone,
    last_raven_intent:
      typeof raw.last_raven_intent === "string" ? normalize(raw.last_raven_intent) : "none",
    last_user_intent:
      typeof raw.last_user_intent === "string" ? normalize(raw.last_user_intent) : "none",
    open_loops: trimList(Array.isArray(raw.open_loops) ? raw.open_loops : []),
    important_entities: trimList(
      Array.isArray(raw.important_entities) ? raw.important_entities : [],
      8,
    ),
    active_thread:
      typeof raw.active_thread === "string" ? normalize(raw.active_thread) || "none" : "none",
    pending_user_request:
      typeof raw.pending_user_request === "string"
        ? normalize(raw.pending_user_request) || "none"
        : "none",
    pending_modification:
      typeof raw.pending_modification === "string"
        ? normalize(raw.pending_modification) || "none"
        : "none",
    last_satisfied_request:
      typeof raw.last_satisfied_request === "string"
        ? normalize(raw.last_satisfied_request) || "none"
        : "none",
    current_output_shape: normalizeResponseOutputShape(raw.current_output_shape),
    request_fulfilled:
      typeof raw.request_fulfilled === "boolean" ? raw.request_fulfilled : base.request_fulfilled,
    current_turn_action: normalizeRequestedTurnAction(raw.current_turn_action),
    relational_continuity: normalizeRelationalContinuityState(raw.relational_continuity),
    rolling_summary:
      typeof raw.rolling_summary === "string"
        ? {
            ...base.rolling_summary,
            active_topic: base.active_topic,
          }
        : normalizeStructuredRollingSummary(raw.rolling_summary),
    recent_window: Array.isArray(raw.recent_window)
      ? raw.recent_window
          .filter((entry): entry is ConversationTurn =>
            Boolean(
              entry &&
              typeof entry === "object" &&
              ((entry as ConversationTurn).role === "user" ||
                (entry as ConversationTurn).role === "assistant") &&
              typeof (entry as ConversationTurn).content === "string",
            ),
          )
          .slice(-WINDOW_LIMIT)
      : [],
    updated_at:
      typeof raw.updated_at === "number" && Number.isFinite(raw.updated_at)
        ? raw.updated_at
        : Date.now(),
  };
  normalized.rolling_summary = buildRollingSummary(normalized);
  return normalized;
}

export function noteConversationUserTurn(
  state: ConversationStateSnapshot,
  input: UserTurnInput,
): ConversationStateSnapshot {
  const text = normalize(input.text);
  const previousAssistantMessage =
    [...state.recent_window]
      .reverse()
      .find((entry) => entry.role === "assistant")
      ?.content ?? null;
  const currentMode = inferMode({
    userIntent: input.userIntent,
    routeAct: input.routeAct ?? null,
    text,
    previousMode: state.current_mode,
  });
  const activeTopic = extractTopic(text) ?? (currentMode === "profile_building" ? "profile" : state.active_topic);
  const userGoal = extractGoal(text) ?? state.user_goal;
  const facts = trimList([...state.recent_facts_from_user, ...extractFacts(text)]);
  const entities = trimList([...state.important_entities, ...extractEntities(text)], 8);
  const unanswered = isQuestion(text)
    ? trimList([...state.unanswered_questions, text], 8)
    : state.unanswered_questions;
  const previousRelational = normalizeRelationalContinuityState(state.relational_continuity);
  const vulnerability = inferUserVulnerabilityOrDefensiveness(text);
  const userEnergy = inferUserResponseEnergy(text);
  const relationalDirection = inferCurrentRelationalDirection({
    text,
    currentMode,
    previousDirection: previousRelational.current_relational_direction,
  });
  const emotionalBeat = inferCurrentEmotionalBeat({
    text,
    currentMode,
    previousBeat: previousRelational.current_emotional_beat,
  });
  const relationalMove = inferNextRelationalMove({
    text,
    currentMode,
    vulnerability,
    userEnergy,
  });
  const warmth = inferWarmthLevel({
    move: relationalMove,
    vulnerability,
    mode: currentMode,
  });
  const pressure = inferPressureLevelFromMove(relationalMove, currentMode);
  const requestState = resolveTurnRequestState({
    text,
    currentMode,
    state,
    previousAssistantMessage,
  });
  const next: ConversationStateSnapshot = {
    ...state,
    active_topic: activeTopic || "none",
    current_mode: currentMode,
    user_goal: userGoal,
    recent_facts_from_user: facts,
    unanswered_questions: unanswered,
    emotional_tone_or_conversation_tone: inferTone(text),
    last_user_intent: input.routeAct ?? input.userIntent,
    important_entities: entities,
    active_thread: requestState.activeThread,
    pending_user_request: requestState.pendingUserRequest,
    pending_modification: requestState.pendingModification,
    current_output_shape: requestState.outputShape,
    request_fulfilled: false,
    current_turn_action: requestState.action,
    relational_continuity: {
      ...previousRelational,
      raven_stance_in_current_exchange: inferRavenStance({
        mode: currentMode,
        move: relationalMove,
        warmth,
      }),
      current_emotional_beat: emotionalBeat,
      recent_vulnerability_or_defensiveness_from_user: vulnerability,
      pressure_level: pressure,
      warmth_level: warmth,
      current_relational_direction: relationalDirection,
      last_unresolved_relational_move:
        relationalMove === "reward" ? previousRelational.last_unresolved_relational_move : relationalMove,
      user_response_energy: userEnergy,
      should_press_soften_observe_challenge_reward_or_hold: relationalMove,
    },
    recent_window: appendRecentWindow(state.recent_window, { role: "user", content: text }),
    updated_at: input.nowMs,
  };
  next.open_loops = trimList(
    [...next.unanswered_questions, ...next.recent_commitments_or_tasks].filter(Boolean),
    8,
  );
  next.rolling_summary = buildRollingSummaryWithTransition(state, next);
  return next;
}

export function noteConversationAssistantTurn(
  state: ConversationStateSnapshot,
  input: AssistantTurnInput,
): ConversationStateSnapshot {
  const text = normalize(input.text);
  const remainingQuestions = state.unanswered_questions.filter(
    (question) => !questionSatisfied(question, text),
  );
  const commitments = trimList([...state.recent_commitments_or_tasks, ...extractCommitments(text)]);
  const previousRelational = normalizeRelationalContinuityState(state.relational_continuity);
  const identityNotes = extractRavenIdentityNotes(text);
  const assistantMove = /\b(good|better|cleaner|exactly)\b/i.test(text)
    ? "reward"
    : /\b(not quite|no|wrong|missed|stop blurring)\b/i.test(text)
      ? "challenge"
      : /\b(look at|notice|i noticed|that tells me|what that tells me)\b/i.test(text)
        ? "observe"
        : /\b(start|do this|take|go back|stay with|hold)\b/i.test(text)
          ? "guide"
          : previousRelational.should_press_soften_observe_challenge_reward_or_hold;
  const warmth = /\b(good|better|stay with that|that was honest)\b/i.test(text)
    ? "measured"
    : previousRelational.warmth_level;
  const pressure =
    assistantMove === "challenge" || assistantMove === "press"
      ? "high"
      : assistantMove === "guide" || assistantMove === "hold"
        ? "measured"
        : previousRelational.pressure_level;
  const requestFulfilled = isRequestFulfilled({
    text,
    action: state.current_turn_action,
    pendingUserRequest: state.pending_user_request,
    activeThread: state.active_thread,
    pendingModification: state.pending_modification,
    outputShape: state.current_output_shape,
  });
  const next: ConversationStateSnapshot = {
    ...state,
    recent_commitments_or_tasks: commitments,
    unanswered_questions: remainingQuestions,
    last_raven_intent: normalize(input.ravenIntent) || "respond",
    pending_modification: requestFulfilled ? "none" : state.pending_modification,
    last_satisfied_request: requestFulfilled ? state.pending_user_request : state.last_satisfied_request,
    current_output_shape: inferAssistantOutputShape(text, state.current_output_shape),
    request_fulfilled: requestFulfilled,
    relational_continuity: {
      ...previousRelational,
      raven_stance_in_current_exchange: inferRavenStance({
        mode: state.current_mode,
        move: assistantMove,
        warmth,
      }),
      current_emotional_beat:
        /\b(i noticed|what that tells me|that tells me|you say that like)\b/i.test(text)
          ? "interpretive_pressure"
          : /\b(good|better|cleaner)\b/i.test(text)
            ? "selective_approval"
            : previousRelational.current_emotional_beat,
      pressure_level: pressure,
      warmth_level: warmth,
      current_relational_direction:
        previousRelational.current_relational_direction || "holding_presence",
      last_unresolved_relational_move:
        assistantMove === "reward" ? "observe" : previousRelational.last_unresolved_relational_move,
      what_raven_has_implicitly_established_about_herself: trimList(
        [
          ...previousRelational.what_raven_has_implicitly_established_about_herself,
          ...identityNotes,
        ],
        6,
      ),
      should_press_soften_observe_challenge_reward_or_hold: assistantMove,
    },
    recent_window: appendRecentWindow(state.recent_window, { role: "assistant", content: text }),
    updated_at: input.nowMs,
  };
  next.open_loops = trimList(
    [...next.unanswered_questions, ...next.recent_commitments_or_tasks].filter(Boolean),
    8,
  );
  next.rolling_summary = buildRollingSummaryWithTransition(state, next);
  return next;
}

export function buildConversationStateBlock(state: ConversationStateSnapshot): string {
  const summary = buildRollingSummary(state);
  const relational = normalizeRelationalContinuityState(state.relational_continuity);
  return [
    "Conversation state:",
    `Active topic: ${state.active_topic || "none"}`,
    `Current mode: ${state.current_mode}`,
    `User goal: ${state.user_goal ?? "none"}`,
    `Recent user facts: ${state.recent_facts_from_user.join(" | ") || "none"}`,
    `Recent commitments: ${state.recent_commitments_or_tasks.join(" | ") || "none"}`,
    `Unanswered questions: ${state.unanswered_questions.join(" | ") || "none"}`,
    `Conversation tone: ${state.emotional_tone_or_conversation_tone}`,
    `Last Raven intent: ${state.last_raven_intent || "none"}`,
    `Last user intent: ${state.last_user_intent || "none"}`,
    `Open loops: ${state.open_loops.join(" | ") || "none"}`,
    `Important entities: ${state.important_entities.join(" | ") || "none"}`,
    `Active thread: ${state.active_thread || "none"}`,
    `Pending user request: ${state.pending_user_request || "none"}`,
    `Pending modification: ${state.pending_modification || "none"}`,
    `Last satisfied request: ${state.last_satisfied_request || "none"}`,
    `Current turn action: ${state.current_turn_action}`,
    `Current output shape: ${state.current_output_shape}`,
    `Request fulfilled: ${state.request_fulfilled ? "yes" : "no"}`,
    "Relational continuity:",
    `- Raven stance: ${relational.raven_stance_in_current_exchange}`,
    `- Emotional beat: ${relational.current_emotional_beat}`,
    `- User vulnerability or defensiveness: ${relational.recent_vulnerability_or_defensiveness_from_user}`,
    `- Pressure level: ${relational.pressure_level}`,
    `- Warmth level: ${relational.warmth_level}`,
    `- Relational direction: ${relational.current_relational_direction}`,
    `- Last unresolved relational move: ${relational.last_unresolved_relational_move}`,
    `- User response energy: ${relational.user_response_energy}`,
    `- Next move preference: ${relational.should_press_soften_observe_challenge_reward_or_hold}`,
    `- Raven identity notes: ${relational.what_raven_has_implicitly_established_about_herself.join(" | ") || "none"}`,
    "Structured summary:",
    `- Active topic: ${summary.active_topic || "none"}`,
    `- Recent topic history: ${summary.recent_topic_history.join(" | ") || "none"}`,
    `- User goals: ${summary.user_goals.join(" | ") || "none"}`,
    `- Commitments or assigned tasks: ${summary.commitments_or_assigned_tasks.join(" | ") || "none"}`,
    `- Unresolved questions: ${summary.unresolved_questions.join(" | ") || "none"}`,
    `- Open loops: ${summary.open_loops.join(" | ") || "none"}`,
    `- Important user facts: ${summary.important_user_facts.join(" | ") || "none"}`,
    `- Tone or emotional context: ${summary.current_tone_or_emotional_context || "steady"}`,
    `- Recent mode shifts: ${summary.recent_mode_shifts.join(" | ") || "none"}`,
    `- Important entities: ${summary.important_entities.join(" | ") || "none"}`,
    `- Relational direction: ${summary.relational_direction || "holding_presence"}`,
    `- Emotional beat history: ${summary.emotional_beat_history.join(" | ") || "none"}`,
    `- Unresolved relational moves: ${summary.unresolved_relational_moves.join(" | ") || "none"}`,
    `- Raven identity notes: ${summary.raven_identity_notes.join(" | ") || "none"}`,
  ].join("\n");
}

export function deriveConversationStateFromMessages(input: {
  sessionId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  classifyUserIntent: (text: string, awaitingUser: boolean) => string;
  classifyRouteAct: (text: string, awaitingUser: boolean) => DialogueRouteAct;
}): ConversationStateSnapshot {
  let state = createConversationStateSnapshot(input.sessionId);
  for (const message of input.messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      const userIntent = input.classifyUserIntent(message.content, false);
      const routeAct = input.classifyRouteAct(message.content, false);
      state = noteConversationUserTurn(state, {
        text: message.content,
        userIntent,
        routeAct,
        nowMs: Date.now(),
      });
      continue;
    }
    state = noteConversationAssistantTurn(state, {
      text: message.content,
      ravenIntent: "respond",
      nowMs: Date.now(),
    });
  }
  return state;
}
