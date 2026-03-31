import { buildHumanQuestionFallback, type QuestionToneProfile } from "./open-question.ts";
import type { ConversationStateSnapshot } from "./conversation-state.ts";
import type { TurnPlan } from "./turn-plan.ts";
import { buildCoreConversationReply } from "./core-turn-move.ts";
import { isAssistantSelfQuestion } from "../session/interaction-mode.ts";
import { isCoherentRelationalQuestionAnswer } from "./relational-answer-alignment.ts";
import { isClarificationExpansionRequest } from "./repair-turn.ts";
import { toUserFacingDetail, toUserFacingThreadLabel } from "./user-facing-thread.ts";

export type ResponseStrategy =
  | "answer_direct"
  | "fulfill_active_request"
  | "revise_active_thread"
  | "continue_open_loop"
  | "follow_through_commitment"
  | "interpret_then_lead"
  | "hold_relational_tension"
  | "stabilize_scene"
  | "reward_honesty";

export function chooseResponseStrategy(input: {
  turnPlan: TurnPlan;
  conversationState: ConversationStateSnapshot;
}): ResponseStrategy {
  const move =
    input.conversationState.relational_continuity
      .should_press_soften_observe_challenge_reward_or_hold;
  if (
    input.turnPlan.previousAssistantMessage &&
    input.turnPlan.currentMode !== "task_planning" &&
    input.turnPlan.currentMode !== "task_execution" &&
    input.turnPlan.currentMode !== "locked_task_execution" &&
    input.turnPlan.currentMode !== "game" &&
    isClarificationExpansionRequest(input.turnPlan.latestUserMessage)
  ) {
    return "answer_direct";
  }
  if (input.turnPlan.requestedAction === "answer_direct_question") {
    return "answer_direct";
  }
  if (
    input.turnPlan.requestedAction === "modify_existing_idea" ||
    input.turnPlan.requestedAction === "revise_previous_plan"
  ) {
    return "revise_active_thread";
  }
  if (
    input.turnPlan.requestedAction === "continue_active_thread" ||
    input.turnPlan.requestedAction === "expand_previous_answer" ||
    input.turnPlan.requestedAction === "generate_structured_output" ||
    input.turnPlan.requestedAction === "acknowledge_then_act" ||
    input.turnPlan.requestedAction === "summarize_current_thread"
  ) {
    return "fulfill_active_request";
  }
  if (input.turnPlan.requiredMove === "answer_user_question") {
    return "answer_direct";
  }
  if (input.turnPlan.requiredMove === "follow_through_previous_commitment") {
    return "follow_through_commitment";
  }
  if (input.turnPlan.personaIntent === "reward_honesty" || move === "reward") {
    return "reward_honesty";
  }
  if (input.conversationState.current_mode === "relational_chat") {
    return "hold_relational_tension";
  }
  if (
    input.conversationState.current_mode === "task_execution" ||
    input.conversationState.current_mode === "locked_task_execution" ||
    input.conversationState.current_mode === "game"
  ) {
    return "stabilize_scene";
  }
  if (
    input.conversationState.current_mode === "profile_building" ||
    input.turnPlan.personaIntent === "move_from_interview_mode_into_interpretation" ||
    input.turnPlan.personaIntent === "observe_without_asking"
  ) {
    return "interpret_then_lead";
  }
  if (input.conversationState.unanswered_questions.length > 0) {
    return "continue_open_loop";
  }
  return "interpret_then_lead";
}

export function buildResponseStrategyBlock(
  strategy: ResponseStrategy,
  state: ConversationStateSnapshot,
): string {
  const activeTopic = state.active_topic || "none";
  const openLoop = state.open_loops[0] ?? "none";
  if (strategy === "answer_direct") {
    return [
      "Response strategy: answer_direct",
      `Active topic: ${activeTopic}`,
      "Answer the user's question in the first sentence.",
      "Reference current topic or recent facts when relevant.",
      "Do not pivot away before the answer is complete.",
    ].join("\n");
  }
  if (strategy === "fulfill_active_request") {
    return [
      "Response strategy: fulfill_active_request",
      `Active thread: ${state.active_thread || activeTopic}`,
      `Pending user request: ${state.pending_user_request || "none"}`,
      `Output shape: ${state.current_output_shape}`,
      "Fulfill the concrete request already on the table before asking anything new.",
      "Do not fall back to menus or profile intake while the active request is still live.",
    ].join("\n");
  }
  if (strategy === "revise_active_thread") {
    return [
      "Response strategy: revise_active_thread",
      `Active thread: ${state.active_thread || activeTopic}`,
      `Pending modification: ${state.pending_modification || "none"}`,
      `Output shape: ${state.current_output_shape}`,
      "Apply the user's requested revision to the existing thread instead of restarting categorization.",
      "Acknowledge the change and show the revised direction in the same reply.",
    ].join("\n");
  }
  if (strategy === "continue_open_loop") {
    return [
      "Response strategy: continue_open_loop",
      `Open loop: ${openLoop}`,
      "Continue the unresolved thread before opening a new one.",
      "If a follow-up question helps, ask exactly one focused question.",
    ].join("\n");
  }
  if (strategy === "follow_through_commitment") {
    return [
      "Response strategy: follow_through_commitment",
      `Commitment: ${state.recent_commitments_or_tasks[0] ?? "none"}`,
      "Follow through on Raven's most recent commitment before changing topics.",
    ].join("\n");
  }
  if (strategy === "interpret_then_lead") {
    return [
      "Response strategy: interpret_then_lead",
      `Relational beat: ${state.relational_continuity.current_emotional_beat}`,
      `Next move: ${state.relational_continuity.should_press_soften_observe_challenge_reward_or_hold}`,
      "Interpret what the user's line reveals before falling back to another question.",
      "Lead the next beat with an observation, challenge, or precise guidance.",
    ].join("\n");
  }
  if (strategy === "hold_relational_tension") {
    return [
      "Response strategy: hold_relational_tension",
      `Relational direction: ${state.relational_continuity.current_relational_direction}`,
      "Answer directly, but hold the pressure or tension in the exchange.",
      "Do not flatten into neutral explanation or filler.",
    ].join("\n");
  }
  if (strategy === "stabilize_scene") {
    return [
      "Response strategy: stabilize_scene",
      `Active topic: ${activeTopic}`,
      "Keep the current scene coherent and stable without generic reset language.",
      "If you need to direct, do it cleanly and in-character.",
    ].join("\n");
  }
  return [
    "Response strategy: reward_honesty",
    `Relational beat: ${state.relational_continuity.current_emotional_beat}`,
    "Acknowledge honest disclosure with measured approval, then lead the next beat.",
  ].join("\n");
}

export function buildContinuityRecoveryReply(input: {
  strategy: ResponseStrategy;
  state: ConversationStateSnapshot;
  lastUserMessage: string;
  toneProfile: QuestionToneProfile;
}): string {
  const topic = toUserFacingThreadLabel(
    input.state.active_topic !== "none"
      ? input.state.active_topic
      : (input.state.user_goal ?? input.state.important_entities[0] ?? "this conversation"),
    "this conversation",
  );
  const openLoop = toUserFacingDetail(
    input.state.open_loops[0] ?? input.state.unanswered_questions[0] ?? topic,
    "the next clear part",
  );
  const nextCommitment = toUserFacingDetail(
    input.state.recent_commitments_or_tasks[0] ?? openLoop,
    "the next clear step",
  );
  const conversationalRecovery =
    buildCoreConversationReply({
      userText: input.lastUserMessage,
      currentTopic: input.state.active_thread || topic,
    }) ??
    buildHumanQuestionFallback(input.lastUserMessage, input.toneProfile, {
      currentTopic: input.state.active_thread || topic,
    });
  const prefersConversationalRecovery =
    input.state.current_mode === "normal_chat" ||
    input.state.current_mode === "relational_chat" ||
    input.state.current_mode === "question_answering" ||
    isAssistantSelfQuestion(input.lastUserMessage);

  if (input.strategy === "answer_direct") {
    return buildHumanQuestionFallback(input.lastUserMessage, input.toneProfile, {
      currentTopic: input.state.active_thread || topic,
    });
  }

  if (input.strategy === "fulfill_active_request") {
    if (prefersConversationalRecovery) {
      return conversationalRecovery;
    }
    // Keep continuity recovery natural: no raw planner or runtime wording in visible text.
    return `Stay with ${topic}. Give me the exact thing already in play before you open anything else.`;
  }

  if (input.strategy === "revise_active_thread") {
    if (prefersConversationalRecovery) {
      return conversationalRecovery;
    }
    return `Stay with ${topic}. Make the change the user just asked for instead of resetting it.`;
  }

  if (input.strategy === "continue_open_loop") {
    if (prefersConversationalRecovery) {
      return conversationalRecovery;
    }
    return `Stay with ${topic}. Finish the part that is still open: ${openLoop}.`;
  }

  if (input.strategy === "follow_through_commitment") {
    if (prefersConversationalRecovery) {
      return conversationalRecovery;
    }
    return `Stay with ${topic}. I want the next move on ${nextCommitment}.`;
  }

  if (input.strategy === "interpret_then_lead") {
    if (prefersConversationalRecovery) {
      return conversationalRecovery;
    }
    return `You are still circling ${topic}. Give me the part that is actually true, and I will take it from there.`;
  }

  if (input.strategy === "hold_relational_tension") {
    if (prefersConversationalRecovery) {
      return conversationalRecovery;
    }
    return `Stay with ${topic}. Keep it clean and give me the exact part you want me to touch next.`;
  }

  if (input.strategy === "stabilize_scene") {
    return `Stay with ${topic}. Continue the line that is already in motion instead of jumping out of it.`;
  }

  return `Good. That was more honest than the rest. Stay with it and give me the next true part.`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const STOP_WORDS = new Set([
  "about",
  "again",
  "back",
  "from",
  "next",
  "that",
  "them",
  "then",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "want",
  "your",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  );
}

function hasTokenOverlap(left: string, right: string): boolean {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function isPlanningTurnPlan(turnPlan: TurnPlan): boolean {
  const combined = normalize(
    `${turnPlan.latestUserMessage} ${turnPlan.previousAssistantMessage ?? ""} ${turnPlan.activeThread}`,
  );
  return (
    /\b(?:help(?: me)? plan|let'?s plan|plan my|plan tomorrow|plan saturday|figure out my)\b/.test(
      combined,
    ) ||
    /\b(plan|planning|workdays|weekends|errands first|gym first|downtime first|morning plan|morning block|wake time|focused hour|first block|saturday|tomorrow morning)\b/.test(
      combined,
    )
  );
}

function isPlanningAlignedModelReply(turnPlan: TurnPlan, text: string): boolean {
  const normalized = normalize(text);
  const latestUser = normalize(turnPlan.latestUserMessage);
  if (
    /\b(fine\. say what you want|enough hovering|tell me why you'?re here|what you actually want|useful to me|trained into something better)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/\b(go back|back to|return to)\b/.test(latestUser)) {
    return (
      /\b(back to|return|morning block|wake time|focused hour|first block|morning plan|tomorrow morning)\b/.test(
        normalized,
      ) &&
      !/\b(first throw|rock|paper|scissors|number hunt|math duel|riddle|current move|round)\b/.test(
        normalized,
      )
    );
  }
  if (
    /\b(?:help(?: me)? plan|let'?s plan|plan my|plan tomorrow|plan saturday|figure out my)\b/.test(
      latestUser,
    )
  ) {
    return (
      /\?/.test(text) &&
      /\b(tomorrow morning|what time|wake time|anchor|first block|workdays|weekends|errands|gym|downtime|evening)\b/.test(
        normalized,
      )
    );
  }
  return (
    hasTokenOverlap(text, turnPlan.previousAssistantMessage ?? "") ||
    hasTokenOverlap(text, turnPlan.activeThread) ||
    /\b(plan|planning|morning|wake time|first block|errands|gym|food|evening|week|weekend|saturday|tomorrow)\b/.test(
      normalized,
    )
  );
}

function isTaskExecutionFollowUpTurn(turnPlan: TurnPlan): boolean {
  if (
    turnPlan.currentMode !== "task_execution" &&
    turnPlan.currentMode !== "locked_task_execution" &&
    turnPlan.currentMode !== "task_planning"
  ) {
    return false;
  }
  return (
    /\b(what counts as done|what counts as complete|what qualifies as done|how do i know it counts|what exactly counts as done)\b/.test(
      normalize(turnPlan.latestUserMessage),
    ) ||
    /\b(why that task|why this task|why that one|why this one)\b/.test(
      normalize(turnPlan.latestUserMessage),
    ) ||
    /\b(set me another one|give me another one|give me the next one|another task|new task|next task|what do you have for me)\b/.test(
      normalize(turnPlan.latestUserMessage),
    )
  );
}

function isTaskAlignedModelReply(turnPlan: TurnPlan, text: string): boolean {
  const normalized = normalize(text);
  const user = normalize(turnPlan.latestUserMessage);
  if (
    /\b(fine\. say what you want|enough hovering|tell me why you'?re here|what you actually want)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/\b(what counts as done|what counts as complete|what qualifies as done)\b/.test(user)) {
    return /\b(done means|counts as done|complete|full \d+|minutes|halfway|report back|checkpoint)\b/.test(
      normalized,
    );
  }
  if (/\b(why that task|why this task|why that one|why this one)\b/.test(user)) {
    return /\b(because|specific|measurable|focus|signal|hard to fake)\b/.test(normalized);
  }
  if (
    /\b(set me another one|give me another one|give me the next one|another task|new task|next task|what do you have for me)\b/.test(
      user,
    )
  ) {
    return /\b(next task|another one|another task|new task|minutes|report back)\b/.test(normalized);
  }
  return (
    hasTokenOverlap(text, turnPlan.previousAssistantMessage ?? "") ||
    hasTokenOverlap(text, turnPlan.activeThread) ||
    /\b(task|challenge|checkpoint|minutes|report back|done|complete)\b/.test(normalized)
  );
}

export function shouldKeepCoherentModelReply(input: {
  text: string;
  state: ConversationStateSnapshot;
  lastUserMessage: string;
  turnPlan?: TurnPlan | null;
}): boolean {
  const text = normalize(input.text);
  if (!text) {
    return false;
  }

  if (isCoherentRelationalQuestionAnswer(input.lastUserMessage, input.text)) {
    return true;
  }

  if (input.turnPlan && isPlanningTurnPlan(input.turnPlan)) {
    return isPlanningAlignedModelReply(input.turnPlan, input.text);
  }

  if (input.turnPlan && isTaskExecutionFollowUpTurn(input.turnPlan)) {
    return isTaskAlignedModelReply(input.turnPlan, input.text);
  }

  if (
    input.turnPlan?.previousAssistantMessage &&
    input.turnPlan.currentMode !== "task_planning" &&
    input.turnPlan.currentMode !== "task_execution" &&
    input.turnPlan.currentMode !== "locked_task_execution" &&
    input.turnPlan.currentMode !== "game" &&
    isClarificationExpansionRequest(input.lastUserMessage)
  ) {
    if (
      /\b(because|i mean|i meant|that means|when i said|what i was pressing on|it matters because)\b/.test(
        text,
      ) ||
      hasTokenOverlap(input.text, input.turnPlan.previousAssistantMessage)
    ) {
      return true;
    }
  }

  if (
    input.turnPlan &&
    input.turnPlan.hasSufficientContextToAct &&
    input.turnPlan.requestedAction !== "clarify_missing_blocker"
  ) {
    if (
      /\b(tell me whether you want|pick the angle|psychology, mechanics, or pressure|choose quick or longer)\b/.test(
        text,
      )
    ) {
      return false;
    }
    if (
      /\b(what should i call you|what boundaries|what should i read correctly about you|what pulls you in)\b/.test(
        text,
      )
    ) {
      return false;
    }
    if (
      /\?/.test(text) &&
      !/\b(i think|because|that means|here is|start|next|we stay|we keep)\b/.test(text)
    ) {
      return false;
    }
    if (
      input.turnPlan.pendingModification !== "none" &&
      hasTokenOverlap(input.text, input.turnPlan.pendingModification)
    ) {
      return true;
    }
    if (
      input.turnPlan.pendingUserRequest !== "none" &&
      hasTokenOverlap(input.text, input.turnPlan.pendingUserRequest)
    ) {
      return true;
    }
    if (
      input.turnPlan.activeThread !== "none" &&
      hasTokenOverlap(input.text, input.turnPlan.activeThread)
    ) {
      return true;
    }
  }

  if (hasTokenOverlap(input.text, input.lastUserMessage)) {
    return true;
  }
  if (
    input.state.active_topic !== "none" &&
    hasTokenOverlap(input.text, input.state.active_topic)
  ) {
    return true;
  }
  if (
    input.state.relational_continuity.current_emotional_beat &&
    hasTokenOverlap(input.text, input.state.relational_continuity.current_emotional_beat)
  ) {
    return true;
  }
  if (
    input.state.relational_continuity.current_relational_direction &&
    hasTokenOverlap(input.text, input.state.relational_continuity.current_relational_direction)
  ) {
    return true;
  }
  if (input.state.open_loops.some((loop) => hasTokenOverlap(input.text, loop))) {
    return true;
  }
  if (input.state.recent_commitments_or_tasks.some((item) => hasTokenOverlap(input.text, item))) {
    return true;
  }
  if (
    /\b(because|i mean|that means|start with|pick one|back to|first step|next move|i noticed|that tells me|better|stay with that)\b/.test(
      text,
    )
  ) {
    return true;
  }
  return input.state.relational_continuity.what_raven_has_implicitly_established_about_herself.some(
    (entry) => hasTokenOverlap(input.text, entry),
  );
}
