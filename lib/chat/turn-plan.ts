import {
  buildHumanQuestionFallback,
  buildPriorBeatOpinionReply,
  buildTopicInitiationReply,
  isTopicInitiationRequest,
} from "./open-question.ts";
import {
  buildCoreConversationReply,
  classifyCoreConversationMove,
  type CoreConversationMove,
} from "./core-turn-move.ts";
import {
  resolveTurnRequestState,
  type ConversationStateSnapshot,
  type RequestedTurnAction,
  type ResponseOutputShape,
  type UserResponseEnergy,
} from "./conversation-state.ts";

type ChatMessageLike = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type TurnPlanRequiredMove =
  | "answer_user_question"
  | "acknowledge_user_answer"
  | "follow_through_previous_commitment"
  | "continue_same_topic";

export type PersonaTurnIntent =
  | "notice_contradiction"
  | "deepen_vulnerability"
  | "reward_honesty"
  | "withhold_approval"
  | "soften_without_losing_control"
  | "intensify_pressure"
  | "shift_from_observation_to_guidance"
  | "hold_tension"
  | "reference_prior_emotional_beat"
  | "stabilize_scene"
  | "move_from_interview_mode_into_interpretation"
  | "observe_without_asking"
  | "lead_next_beat";

export type TurnPlan = {
  latestUserMessage: string;
  previousAssistantMessage: string | null;
  previousUserMessage: string | null;
  requiredMove: TurnPlanRequiredMove;
  conversationMove: CoreConversationMove;
  requestedAction: RequestedTurnAction;
  activeThread: string;
  pendingUserRequest: string;
  pendingModification: string;
  outputShape: ResponseOutputShape;
  hasSufficientContextToAct: boolean;
  personaIntent: PersonaTurnIntent;
  userResponseEnergy: UserResponseEnergy | "steady";
  relationalBeatReference: string;
  reason: string;
  userKeywords: string[];
  previousAssistantKeywords: string[];
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "been",
  "before",
  "between",
  "from",
  "have",
  "just",
  "like",
  "make",
  "next",
  "over",
  "that",
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

const ACK_PATTERNS = [
  /^(ok|okay|yes|no|done|ready|got it|sounds good|that works|continue|start)$/i,
  /^(i did|i have|i'm|im)\b/i,
];

const QUESTION_START_PATTERN =
  /^\s*(how|what|why|when|where|which|who|can|could|do|does|did|is|are|will|would|should)\b/i;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function nonSystemMessages(messages: ChatMessageLike[]): ChatMessageLike[] {
  return messages.filter((message) => message.role !== "system");
}

function extractKeywords(text: string, limit = 6): string[] {
  const unique = new Set<string>();
  const tokens = normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  for (const token of tokens) {
    if (unique.size >= limit) {
      break;
    }
    unique.add(token);
  }
  return [...unique];
}

function hasOverlap(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return false;
  }
  const normalized = normalize(text).toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function isQuestion(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return normalized.includes("?") || QUESTION_START_PATTERN.test(normalized);
}

function isBareOpinionFollowUp(text: string): boolean {
  return /^\s*(?:and\s+)?what do you think\??\s*$/i.test(normalize(text));
}

function looksShortAcknowledgement(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.split(" ").length <= 4 &&
    ACK_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return true;
  }
  return ACK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeCommitment(text: string): boolean {
  return /\b(i pick|we are doing|here is your task|you will|start now|next step|first throw|first guess|first prompt)\b/i.test(
    text,
  );
}

function isDurationQuestion(text: string): boolean {
  return /\b(how long|hours?|minutes?|duration)\b/i.test(text);
}

function isGameQuestion(text: string): boolean {
  return /\b(game|play|rules?|round|throw|guess|prompt)\b/i.test(text);
}

function isTaskQuestion(text: string): boolean {
  return /\b(task|challenge|check in|report back|done|complete|what should i do next|what now|what next)\b/i.test(
    text,
  );
}

function isWagerQuestion(text: string): boolean {
  return /\b(stakes?|wager|bet|if i win|if you win|on the line)\b/i.test(text);
}

function isNextStepQuestion(text: string): boolean {
  return /\b(what now|what next|next move|my move|first move|how do i continue|how do we continue)\b/i.test(
    text,
  );
}

function isUserExpectationQuestion(text: string): boolean {
  return /\bwhat do you want (?:from me|me to do|to do)\b/i.test(text);
}

function extractTopicRequest(text: string): string | null {
  const match = text.match(/\b(?:talk about|discuss|focus on|explore)\s+([^.!?]{2,80})/i);
  return match?.[1]?.trim() ?? null;
}

function hasSpeedChoiceCue(text: string): boolean {
  return /\b(quick|faster|short|longer|few minutes)\b/i.test(text);
}

function hasGameCue(text: string): boolean {
  return /\b(game|play|round|rock paper scissors|rps|number|riddle|math duel|number hunt)\b/i.test(
    text,
  );
}

function hasGameMoveCue(text: string): boolean {
  return /\b(rock|paper|scissors)\b/i.test(text) || /^\s*\d{1,2}\s*$/.test(text.trim());
}

function hasTaskCue(text: string): boolean {
  return /\b(task|challenge|check in|report back|duration|minutes?|hours?)\b/i.test(text);
}

function hasChooseCue(text: string): boolean {
  return /\b(you pick|you choose|dealer'?s choice|your choice|surprise me|pick for me)\b/i.test(
    text,
  );
}

function hasWagerCue(text: string): boolean {
  return /\b(stakes?|wager|bet|if i win|if you win|on the line)\b/i.test(text);
}

function isGreetingLike(text: string): boolean {
  return /^(hi|hello|hey)(?:\s+(mistress|miss|raven|ma'am|mam))?$/i.test(normalize(text));
}

function pickFirstDifferent(previousAssistantMessage: string | null, candidates: string[]): string {
  const previous = normalizeForCompare(previousAssistantMessage ?? "");
  for (const candidate of candidates) {
    if (normalizeForCompare(candidate) !== previous) {
      return candidate;
    }
  }
  return candidates[0] ?? "";
}

function normalizeForCompare(text: string): string {
  return normalize(text).toLowerCase();
}

function inferUserResponseEnergy(text: string): UserResponseEnergy | "steady" {
  const normalized = normalize(text).toLowerCase();
  if (/\b(whatever|fine|sure|if you say so)\b/.test(normalized)) {
    return "deflecting";
  }
  if (/\b(no|stop|not that|leave it)\b/.test(normalized)) {
    return "defensive";
  }
  if (/\b(i guess|maybe|not sure|kind of)\b/.test(normalized)) {
    return "hesitant";
  }
  if (/\b(honestly|truth is|i admit|i want|i need)\b/.test(normalized)) {
    return "open";
  }
  if (/\b(yes|exactly|more|again)\b/.test(normalized)) {
    return "eager";
  }
  if (/\b(private|guarded|careful)\b/.test(normalized)) {
    return "guarded";
  }
  return "steady";
}

function selectPersonaIntent(input: {
  latestUserMessage: string;
  previousAssistantMessage: string | null;
  requiredMove: TurnPlanRequiredMove;
  requestedAction: RequestedTurnAction;
  conversationState?: ConversationStateSnapshot | null;
  userResponseEnergy: UserResponseEnergy | "steady";
}): PersonaTurnIntent {
  const latest = normalize(input.latestUserMessage).toLowerCase();
  const state = input.conversationState;
  const beat = state?.relational_continuity.current_emotional_beat ?? "";
  const move = state?.relational_continuity.should_press_soften_observe_challenge_reward_or_hold;
  if (/\b(actually|but|except|not really|that isn't)\b/.test(latest)) {
    return "notice_contradiction";
  }
  if (/\b(honestly|truth is|i admit)\b/.test(latest)) {
    return "reward_honesty";
  }
  if (/\b(ashamed|embarrassed|afraid|nervous|hard to say)\b/.test(latest)) {
    return "deepen_vulnerability";
  }
  if (input.requestedAction === "interpret_and_reflect") {
    return beat ? "reference_prior_emotional_beat" : "observe_without_asking";
  }
  if (
    input.requestedAction === "modify_existing_idea" ||
    input.requestedAction === "revise_previous_plan" ||
    input.requestedAction === "follow_through_commitment"
  ) {
    return "shift_from_observation_to_guidance";
  }
  if (state?.current_mode === "profile_building") {
    return input.requiredMove === "acknowledge_user_answer"
      ? "move_from_interview_mode_into_interpretation"
      : "observe_without_asking";
  }
  if (state?.current_mode === "relational_chat") {
    return "hold_tension";
  }
  if (input.requiredMove === "follow_through_previous_commitment") {
    return "stabilize_scene";
  }
  if (input.requiredMove === "answer_user_question") {
    return "shift_from_observation_to_guidance";
  }
  if (move === "challenge" || input.userResponseEnergy === "defensive") {
    return "withhold_approval";
  }
  if (move === "press" || input.userResponseEnergy === "deflecting") {
    return "intensify_pressure";
  }
  if (beat === "earned_honesty" || move === "reward") {
    return "reward_honesty";
  }
  if (beat === "tender_exposure" || move === "soften") {
    return "soften_without_losing_control";
  }
  if (beat) {
    return "reference_prior_emotional_beat";
  }
  return "lead_next_beat";
}

function findPreviousByRole(
  messages: ChatMessageLike[],
  role: "user" | "assistant",
  startIndex: number,
): string | null {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return normalize(messages[index].content);
    }
  }
  return null;
}

export function buildTurnPlan(
  messages: ChatMessageLike[],
  input?: { conversationState?: ConversationStateSnapshot | null },
): TurnPlan {
  const history = nonSystemMessages(messages);
  const latestUserIndex = [...history]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  const latestUserMessage =
    typeof latestUserIndex === "number" ? normalize(history[latestUserIndex]?.content ?? "") : "";
  const previousAssistantMessage =
    typeof latestUserIndex === "number"
      ? findPreviousByRole(history, "assistant", latestUserIndex - 1)
      : findPreviousByRole(history, "assistant", history.length - 1);
  const previousUserMessage =
    typeof latestUserIndex === "number"
      ? findPreviousByRole(history, "user", latestUserIndex - 1)
      : null;

  const requiredMove: TurnPlanRequiredMove = isQuestion(latestUserMessage)
    ? "answer_user_question"
    : previousAssistantMessage &&
        previousAssistantMessage.includes("?") &&
        latestUserMessage.length > 0
      ? "acknowledge_user_answer"
      : previousAssistantMessage &&
          looksLikeCommitment(previousAssistantMessage) &&
          looksShortAcknowledgement(latestUserMessage)
        ? "follow_through_previous_commitment"
        : "continue_same_topic";

  const reason =
    requiredMove === "answer_user_question"
      ? "latest_user_message_is_question"
      : requiredMove === "acknowledge_user_answer"
        ? "assistant_asked_and_user_replied"
        : requiredMove === "follow_through_previous_commitment"
          ? "user_acknowledged_prior_commitment"
          : "default_continue";
  const requestState = resolveTurnRequestState({
    text: latestUserMessage,
    currentMode: input?.conversationState?.current_mode ?? "normal_chat",
    state: input?.conversationState ?? null,
    previousAssistantMessage,
  });
  const userResponseEnergy = inferUserResponseEnergy(latestUserMessage);
  const conversationMove = classifyCoreConversationMove({
    userText: latestUserMessage,
    previousAssistantText: previousAssistantMessage,
    currentTopic:
      input?.conversationState?.active_thread ??
      input?.conversationState?.active_topic ??
      previousUserMessage,
  });
  const personaIntent = selectPersonaIntent({
    latestUserMessage,
    previousAssistantMessage,
    requiredMove,
    requestedAction: requestState.action,
    conversationState: input?.conversationState ?? null,
    userResponseEnergy,
  });
  const relationalBeatReference =
    input?.conversationState?.relational_continuity.current_emotional_beat ??
    input?.conversationState?.rolling_summary.emotional_beat_history.slice(-1)[0] ??
    "steady_pressure";

  return {
    latestUserMessage,
    previousAssistantMessage,
    previousUserMessage,
    requiredMove,
    conversationMove,
    requestedAction: requestState.action,
    activeThread: requestState.activeThread,
    pendingUserRequest: requestState.pendingUserRequest,
    pendingModification: requestState.pendingModification,
    outputShape: requestState.outputShape,
    hasSufficientContextToAct: requestState.hasSufficientContextToAct,
    personaIntent,
    userResponseEnergy,
    relationalBeatReference,
    reason,
    userKeywords: extractKeywords(latestUserMessage),
    previousAssistantKeywords: extractKeywords(previousAssistantMessage ?? ""),
  };
}

export function buildTurnPlanSystemMessage(turnPlan: TurnPlan): string {
  const latestUser = turnPlan.latestUserMessage || "none";
  const previousAssistant = turnPlan.previousAssistantMessage || "none";
  return [
    "Turn plan:",
    `Required move: ${turnPlan.requiredMove}`,
    `Conversation move: ${turnPlan.conversationMove}`,
    `Requested action: ${turnPlan.requestedAction}`,
    `Active thread: ${turnPlan.activeThread || "none"}`,
    `Pending user request: ${turnPlan.pendingUserRequest || "none"}`,
    `Pending modification: ${turnPlan.pendingModification || "none"}`,
    `Output shape: ${turnPlan.outputShape}`,
    `Context sufficient to act: ${turnPlan.hasSufficientContextToAct ? "yes" : "no"}`,
    `Persona intent: ${turnPlan.personaIntent}`,
    `User response energy: ${turnPlan.userResponseEnergy}`,
    `Relational beat reference: ${turnPlan.relationalBeatReference}`,
    `Reason: ${turnPlan.reason}`,
    `Latest user line: ${latestUser}`,
    `Previous assistant line: ${previousAssistant}`,
    "Rules:",
    "- Reply to the latest user line directly in the first sentence.",
    "- If context is sufficient, act on the request instead of asking a sorting question.",
    "- Stay on the active thread until the pending user request is fulfilled.",
    "- Keep continuity with the previous assistant line.",
    "- Keep continuity with the current relational beat, not only the topic.",
    "- Do not drift into profile intake when the user made a concrete request.",
    "- Match the response shape to the selected output shape.",
    "- Do not repeat the previous assistant line verbatim.",
    "- Do not switch topics unless the user explicitly asks to switch.",
  ].join("\n");
}

export function buildRecentTurnsContext(messages: ChatMessageLike[], maxLines = 6): string {
  const lines = nonSystemMessages(messages)
    .slice(-maxLines)
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Raven"}: ${normalize(message.content).slice(0, 220)}`,
    );

  return ["Recent turns:", ...(lines.length > 0 ? lines : ["none"])].join("\n");
}

export function isTurnPlanSatisfied(
  turnPlan: TurnPlan,
  assistantText: string,
): {
  ok: boolean;
  reason: string;
} {
  const response = normalize(assistantText);
  if (!response) {
    return { ok: false, reason: "empty_response" };
  }

  if (
    turnPlan.previousAssistantMessage &&
    normalizeForCompare(turnPlan.previousAssistantMessage) === normalizeForCompare(response)
  ) {
    return { ok: false, reason: "repeated_previous_assistant" };
  }

  const questionCount = (response.match(/\?/g) ?? []).length;
  const profileHijack =
    turnPlan.requestedAction !== "gather_profile_only_when_needed" &&
    /\b(what should i call you|what do you want me to understand about you|what boundaries|what should i read correctly about you|what pulls you in)\b/i.test(
      response,
    );
  if (profileHijack) {
    return { ok: false, reason: "profile_hijack_during_action" };
  }
  if (
    turnPlan.hasSufficientContextToAct &&
    turnPlan.requestedAction !== "clarify_missing_blocker" &&
    questionCount > 0 &&
    !/\b(i think|because|that means|here is|start|next|we keep|we stay)\b/i.test(response)
  ) {
    return { ok: false, reason: "asked_instead_of_acting" };
  }
  if (
    /\b(tell me whether you want|pick the angle|psychology, mechanics, or pressure|choose quick or longer)\b/i.test(
      response,
    ) &&
    turnPlan.hasSufficientContextToAct
  ) {
    return { ok: false, reason: "menu_drift" };
  }

  if (turnPlan.requestedAction === "clarify_missing_blocker") {
    return questionCount === 1
      ? { ok: true, reason: "single_blocker_question" }
      : { ok: false, reason: "missing_single_blocker_question" };
  }

  if (turnPlan.requestedAction === "summarize_current_thread") {
    return /\b(so far|current thread|already set|still open)\b/i.test(response)
      ? { ok: true, reason: "thread_summarized" }
      : { ok: false, reason: "missing_thread_summary" };
  }

  if (turnPlan.requestedAction === "generate_structured_output") {
    return /^(?:\d+\.|-)\s+/m.test(assistantText)
      ? { ok: true, reason: "structured_output_provided" }
      : { ok: false, reason: "missing_structured_output" };
  }

  if (turnPlan.requestedAction === "interpret_and_reflect") {
    if (isBareOpinionFollowUp(turnPlan.latestUserMessage)) {
      const priorBeatKeywords = turnPlan.previousAssistantKeywords.filter(
        (keyword) =>
          keyword.length >= 5 &&
          !["about", "doing", "more", "other", "there", "thing", "think"].includes(keyword),
      );
      const referencesPriorBeat =
        hasOverlap(response, priorBeatKeywords) ||
        /\b(hesitation|truth was in the last line|more exposed than you meant|something real under it|actually change you)\b/i.test(
          response,
        );
      if (!referencesPriorBeat) {
        return { ok: false, reason: "prior_beat_not_referenced" };
      }
    }
    if (
      /\b(i think|that tells me|what matters is|useful when|i care more about|the part that matters)\b/i.test(
        response,
      )
    ) {
      return { ok: true, reason: "interpretation_provided" };
    }
    return { ok: false, reason: "missing_interpretation" };
  }

  if (
    turnPlan.requestedAction === "modify_existing_idea" ||
    turnPlan.requestedAction === "revise_previous_plan"
  ) {
    const referencesThread =
      hasOverlap(response, extractKeywords(turnPlan.activeThread, 6)) ||
      hasOverlap(response, turnPlan.previousAssistantKeywords) ||
      hasOverlap(response, turnPlan.userKeywords);
    const referencesModification =
      turnPlan.pendingModification === "none" ||
      hasOverlap(response, extractKeywords(turnPlan.pendingModification, 6));
    return referencesThread && referencesModification
      ? { ok: true, reason: "modification_applied" }
      : { ok: false, reason: "missing_modification_application" };
  }

  if (
    turnPlan.requestedAction === "continue_active_thread" ||
    turnPlan.requestedAction === "expand_previous_answer" ||
    turnPlan.requestedAction === "follow_through_commitment" ||
    turnPlan.requestedAction === "acknowledge_then_act"
  ) {
    const referencesThread =
      hasOverlap(response, extractKeywords(turnPlan.activeThread, 6)) ||
      hasOverlap(response, turnPlan.previousAssistantKeywords) ||
      hasOverlap(response, turnPlan.userKeywords) ||
      /\b(we stay|we keep|next|start|continue|back to)\b/i.test(response);
    if (!referencesThread) {
      return { ok: false, reason: "active_thread_missed" };
    }
  }

  if (
    turnPlan.conversationMove === "agree_and_extend" ||
    turnPlan.conversationMove === "continue_current_thought"
  ) {
    if (
      /\b(drop the fog and say what you want|name the part that lost you|state the angle cleanly|we can break it down cleanly|start talking)\b/i.test(
        response,
      )
    ) {
      return { ok: false, reason: "fallback_reset_on_valid_continuation" };
    }
    if (
      /\b(exactly|yes|good|stay with|that is where)\b/i.test(response) ||
      hasOverlap(response, turnPlan.previousAssistantKeywords)
    ) {
      return { ok: true, reason: "conversation_continued" };
    }
    return { ok: false, reason: "continuation_not_built_on" };
  }

  if (turnPlan.conversationMove === "clarify_meaning") {
    if (
      /\b(name the part that lost you|ask the exact question|state the angle cleanly|start talking)\b/i.test(
        response,
      )
    ) {
      return { ok: false, reason: "clarification_reset" };
    }
    if (/\b(i mean|part about|part underneath|what i mean)\b/i.test(response)) {
      return { ok: true, reason: "clarification_provided" };
    }
    return { ok: false, reason: "missing_clarification" };
  }

  if (
    turnPlan.conversationMove === "user_correction" ||
    turnPlan.conversationMove === "request_revision"
  ) {
    if (/\b(start talking|state the angle cleanly|drop the fog)\b/i.test(response)) {
      return { ok: false, reason: "correction_reset" };
    }
    if (/\b(we keep|change only|correct|revision|not a reset)\b/i.test(response)) {
      return { ok: true, reason: "correction_applied" };
    }
    return { ok: false, reason: "missing_correction_handling" };
  }

  if (turnPlan.requiredMove === "answer_user_question") {
    if (isDurationQuestion(turnPlan.latestUserMessage)) {
      return /\b\d+\s*(hour|hours|minute|minutes)\b/i.test(response)
        ? { ok: true, reason: "duration_answered" }
        : { ok: false, reason: "missing_duration_answer" };
    }
    if (isGameQuestion(turnPlan.latestUserMessage)) {
      return /\b(game|rules?|play|round|throw|guess|prompt)\b/i.test(response)
        ? { ok: true, reason: "game_answered" }
        : { ok: false, reason: "missing_game_answer" };
    }
    if (isTaskQuestion(turnPlan.latestUserMessage)) {
      return /\b(task|challenge|checkpoint|secure|halfway|report|complete|next step)\b/i.test(
        response,
      )
        ? { ok: true, reason: "task_answered" }
        : { ok: false, reason: "missing_task_answer" };
    }
    if (isWagerQuestion(turnPlan.latestUserMessage)) {
      return /\b(stakes?|wager|bet|if i win|if you win|terms?)\b/i.test(response)
        ? { ok: true, reason: "wager_answered" }
        : { ok: false, reason: "missing_wager_answer" };
    }
    if (
      hasOverlap(response, turnPlan.userKeywords) ||
      /\b(i mean|answering now|here is|because|it means)\b/i.test(response)
    ) {
      return { ok: true, reason: "generic_question_answered" };
    }
    return { ok: false, reason: "missing_question_alignment" };
  }

  if (turnPlan.requiredMove === "acknowledge_user_answer") {
    if (/\b(noted|good|understood|heard|accepted|lock it in)\b/i.test(response)) {
      return { ok: true, reason: "acknowledged_user_answer" };
    }
    if (hasOverlap(response, turnPlan.userKeywords)) {
      return { ok: true, reason: "acknowledged_by_overlap" };
    }
    return { ok: false, reason: "missing_acknowledgement" };
  }

  if (turnPlan.requiredMove === "follow_through_previous_commitment") {
    if (
      hasOverlap(response, turnPlan.previousAssistantKeywords) ||
      /\b(next|continue|start|first|second|task|round|prompt)\b/i.test(response)
    ) {
      return { ok: true, reason: "commitment_follow_through" };
    }
    return { ok: false, reason: "missing_follow_through" };
  }

  if (turnPlan.userKeywords.length === 0) {
    return { ok: true, reason: "no_keyword_constraint" };
  }
  if (hasOverlap(response, turnPlan.userKeywords)) {
    return { ok: true, reason: "topic_continuity_kept" };
  }
  return { ok: false, reason: "topic_continuity_missing" };
}

export function buildTurnPlanFallback(
  turnPlan: TurnPlan,
  toneProfile: "neutral" | "friendly" | "dominant",
): string {
  const conversationFallback = buildCoreConversationReply({
    userText: turnPlan.latestUserMessage,
    previousAssistantText: turnPlan.previousAssistantMessage,
    currentTopic: turnPlan.activeThread || turnPlan.previousUserMessage,
  });

  if (
    conversationFallback &&
    !hasTaskCue(turnPlan.latestUserMessage) &&
    (
      turnPlan.conversationMove === "continue_current_thought" ||
      turnPlan.conversationMove === "agree_and_extend" ||
      turnPlan.conversationMove === "clarify_meaning" ||
      turnPlan.conversationMove === "user_correction" ||
      turnPlan.conversationMove === "request_revision" ||
      turnPlan.conversationMove === "raven_leads_next_beat"
    )
  ) {
    return conversationFallback;
  }

  if (turnPlan.requestedAction === "summarize_current_thread") {
    return `Current thread: ${turnPlan.activeThread || "this thread"}. What is already live is the part we have in motion. What is still open is ${turnPlan.pendingUserRequest || "the next clear move"}.`;
  }

  if (turnPlan.requestedAction === "clarify_missing_blocker") {
    return turnPlan.activeThread && turnPlan.activeThread !== "none"
      ? `Before I sharpen ${turnPlan.activeThread}, what is the one variable you have not given me yet?`
      : "What is the one concrete variable you want me to work from?";
  }

  if (
    turnPlan.requestedAction === "modify_existing_idea" ||
    turnPlan.requestedAction === "revise_previous_plan"
  ) {
    const thread = turnPlan.activeThread || "the current thread";
    const modification =
      turnPlan.pendingModification !== "none"
        ? turnPlan.pendingModification
        : turnPlan.latestUserMessage;
    return `Good. We keep ${thread} and change it around ${modification}. That makes the next beat tighter and more deliberate instead of restarting the whole thing.`;
  }

  if (turnPlan.requestedAction === "expand_previous_answer") {
    const thread = turnPlan.activeThread || "the current thread";
    return `More on ${thread}: stay with the exact part already in play and build it one clean step further instead of reopening the whole topic.`;
  }

  if (turnPlan.requestedAction === "generate_structured_output") {
    const thread = turnPlan.activeThread || "the current thread";
    return [
      `1. Keep the focus on ${thread}.`,
      "2. Apply the user's latest change before opening anything new.",
      "3. Continue only from the revised version, not from a reset.",
    ].join("\n");
  }

  if (turnPlan.requestedAction === "interpret_and_reflect") {
    if (isBareOpinionFollowUp(turnPlan.latestUserMessage)) {
      return buildPriorBeatOpinionReply(turnPlan.previousAssistantMessage);
    }
  }

  if (turnPlan.requiredMove === "answer_user_question") {
    if (isDurationQuestion(turnPlan.latestUserMessage)) {
      const candidates =
        toneProfile === "dominant"
          ? [
              "Listen carefully, pet. For this round, 30 minutes.",
              "Listen carefully, pet. This round runs for 30 minutes.",
            ]
          : ["For this round, 30 minutes.", "This round runs for 30 minutes."];
      return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
    }
    if (isGameQuestion(turnPlan.latestUserMessage)) {
      if (isNextStepQuestion(turnPlan.latestUserMessage)) {
        const candidates =
          toneProfile === "dominant"
            ? [
                "Listen carefully, pet. Next move now: answer with one clean move, then wait for my next prompt.",
                "Stay sharp, pet. Your next move is one clean answer, then hold for my prompt.",
              ]
            : [
                "Next move now: answer with one clean move, then wait for the next prompt.",
                "Your next move is one clean answer, then wait for the next prompt.",
              ];
        return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
      }
      const candidates =
        toneProfile === "dominant"
          ? [
              "Listen carefully, pet. We stay on one game thread: one prompt from me, one clean reply from you.",
              "Listen carefully, pet. One game, one prompt, one reply. Keep the round clean.",
            ]
          : [
              "We stay on one game thread: one prompt from me, one clean reply from you.",
              "One game, one prompt, one reply. Keep the round clean.",
            ];
      return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
    }
    if (isTaskQuestion(turnPlan.latestUserMessage)) {
      const candidates =
        toneProfile === "dominant"
          ? [
              "Listen carefully, pet. Next step: complete the current checkpoint and report back cleanly.",
              "Stay focused, pet. Finish the current checkpoint, then report back cleanly.",
            ]
          : [
              "Next step: complete the current checkpoint and report back cleanly.",
              "Finish the current checkpoint, then report back cleanly.",
            ];
      return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
    }
    if (isWagerQuestion(turnPlan.latestUserMessage)) {
      const candidates =
        toneProfile === "dominant"
          ? [
              "Listen carefully, pet. We lock both win and lose terms before the round starts.",
              "Listen carefully, pet. Set both win and lose terms now, then we start the round.",
            ]
          : [
              "We lock both win and lose terms before the round starts.",
              "Set both win and lose terms now, then we start the round.",
            ];
      return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
    }
    if (isUserExpectationQuestion(turnPlan.latestUserMessage)) {
      return buildHumanQuestionFallback(turnPlan.latestUserMessage, toneProfile, {
        previousAssistantText: turnPlan.previousAssistantMessage,
        currentTopic: turnPlan.activeThread || turnPlan.previousUserMessage,
      });
    }
    return buildHumanQuestionFallback(turnPlan.latestUserMessage, toneProfile, {
      previousAssistantText: turnPlan.previousAssistantMessage,
      currentTopic: turnPlan.activeThread || turnPlan.previousUserMessage,
    });
  }

  if (turnPlan.requiredMove === "acknowledge_user_answer") {
    return toneProfile === "dominant"
      ? "Noted, pet. I heard your answer and I am continuing from it now."
      : "Noted. I heard your answer and I am continuing from it now.";
  }

  if (turnPlan.requiredMove === "follow_through_previous_commitment") {
    const candidates =
      toneProfile === "dominant"
        ? [
            "Good. Continue from the last commitment now. No topic switch.",
            "Stay sharp, pet. Follow through on the previous step now.",
            "Eyes on me, pet. Continue exactly where we left off.",
          ]
        : ["Good. Continue from the last commitment now.", "Continue exactly where we left off."];
    return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
  }

  const latest = turnPlan.latestUserMessage;
  const treatAsGameCue =
    hasGameCue(latest) ||
    (hasGameMoveCue(latest) && hasGameCue(turnPlan.previousAssistantMessage ?? ""));
  if (hasWagerCue(latest)) {
    const candidates =
      toneProfile === "dominant"
        ? [
            "Good. Lock the wager now: state the stakes, your win terms, and my win terms in one line.",
            "Listen carefully, pet. We set the wager first. Give stakes, your win terms, then my win terms.",
          ]
        : [
            "Lock the wager now: state stakes, your win terms, and my win terms.",
            "Set the wager first with stakes, your win terms, and my win terms.",
          ];
    return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
  }

  if (treatAsGameCue) {
    if (hasGameMoveCue(latest)) {
      return toneProfile === "dominant"
        ? "Good. Move accepted. Next turn now: give one clean move and stay on this round."
        : "Move accepted. Next turn now: give one clean move and stay on this round.";
    }
    const candidates =
      toneProfile === "dominant"
        ? hasChooseCue(latest) || hasSpeedChoiceCue(latest)
          ? [
              "I pick. We are doing rock paper scissors streak. First throw now: choose rock, paper, or scissors.",
              "I choose. Quick round: number hunt. Pick one number from 1 to 10 now.",
            ]
          : [
              "Good. We are playing. Choose quick or longer, or tell me to pick right now.",
              "Stay sharp, pet. We keep the same game thread. Pick quick or longer now.",
            ]
        : hasChooseCue(latest)
          ? [
              "I pick. We are doing rock paper scissors streak. First throw now: choose rock, paper, or scissors.",
              "I choose number hunt. Pick one number from 1 to 10 now.",
            ]
          : [
              "We are playing. Choose quick or longer, or tell me to pick now.",
              "Stay on this game thread. Choose quick or longer now.",
            ];
    return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
  }

  if (hasTaskCue(latest)) {
    const candidates =
      toneProfile === "dominant"
        ? [
            "Listen carefully, pet. Task stays active. Confirm secure, then check in halfway and report completion.",
            "Good. Keep the task rail. One update now: secure, halfway, or complete.",
          ]
        : [
            "Task stays active. Confirm secure, then check in halfway and report completion.",
            "Keep the task flow: secure, halfway, then complete.",
          ];
    return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
  }

  if (isTopicInitiationRequest(latest)) {
    return buildTopicInitiationReply({
      userText: latest,
      currentTopic: turnPlan.activeThread || turnPlan.previousUserMessage,
      tone: toneProfile,
    });
  }

  const requestedTopic = extractTopicRequest(latest);
  if (requestedTopic) {
    return buildTopicInitiationReply({
      userText: latest,
      currentTopic: requestedTopic,
      tone: toneProfile,
    });
  }

  if (isGreetingLike(latest)) {
    const candidates = [
      "Talk to me. What is on your mind?",
      "Good. Tell me what is actually pressing on you.",
    ];
    return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
  }

  const candidates =
      toneProfile === "dominant"
      ? [
          buildHumanQuestionFallback(latest || "what next", toneProfile, {
            previousAssistantText: turnPlan.previousAssistantMessage,
            currentTopic: turnPlan.activeThread || turnPlan.previousUserMessage,
          }),
          turnPlan.personaIntent === "move_from_interview_mode_into_interpretation"
            ? "That is still surface. Give me the part that is actually true."
            : turnPlan.personaIntent === "reference_prior_emotional_beat"
              ? "Stay with the part that had weight in it. Do not flatten it now."
              : "Give me one clear thing you want, and I will take it from there.",
        ]
      : [
          buildHumanQuestionFallback(latest || "what next", toneProfile, {
            previousAssistantText: turnPlan.previousAssistantMessage,
            currentTopic: turnPlan.activeThread || turnPlan.previousUserMessage,
          }),
          "Give me one concrete question or one concrete goal.",
        ];
  return pickFirstDifferent(turnPlan.previousAssistantMessage, candidates);
}
