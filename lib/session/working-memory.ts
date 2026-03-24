import type { DialogueRouteAct, SessionTopic } from "../dialogue/router.ts";

export type PendingProposalKind = "none" | "task" | "game" | "session_flow";

export type WorkingMemory = {
  current_topic: string;
  last_user_intent: DialogueRouteAct | "none";
  last_user_request: string;
  last_assistant_commitment: string;
  current_unresolved_question: string;
  session_started: boolean;
  pending_proposal_kind: PendingProposalKind;
  pending_proposal_summary: string;
  negotiated_topic: string;
  last_assistant_action: string;
  rolling_summary: string;
  session_topic: SessionTopic | null;
  user_turn_count: number;
};

type UserTurnInput = {
  text: string;
  act: DialogueRouteAct;
  nextTopic: SessionTopic | null;
};

type AssistantTurnInput = {
  commitment?: string | null;
  topicResolved?: boolean;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isQuestionLike(text: string): boolean {
  return /\?/.test(text) || /^(how|what|why|when|where|which|who|can|could|do|does|did|is|are|will|would|should)\b/i.test(text);
}

function isGreetingLike(text: string): boolean {
  return /^(hi|hello|hey|yo|good (morning|afternoon|evening))[\s!.?]*$/i.test(text);
}

export function isProposalAcceptanceCue(text: string): boolean {
  return /\b(yes|yeah|yep|ok|okay|sure|fine|go ahead|start|start now|do it|let'?s begin|lets begin|let'?s start|lets start|begin|i'?m in|im in|ready)\b/i.test(
    text,
  );
}

function looksLikeTaskProposal(text: string): boolean {
  return /\b(here is your task|your task is|i want you to|start now|report back|check in once halfway through|finish the current checkpoint)\b/i.test(
    text,
  );
}

function looksLikeGameProposal(text: string): boolean {
  return /\b(here is the game|we are doing|first throw now|first guess now|first prompt now|pick one number|choose rock, paper, or scissors)\b/i.test(
    text,
  );
}

function looksLikeSessionFlowProposal(text: string): boolean {
  return /\b(what i want to talk about|let'?s start with|we can start with|this session should be about|i want this session to center on)\b/i.test(
    text,
  );
}

function detectPendingProposalKind(text: string): PendingProposalKind {
  if (looksLikeTaskProposal(text)) {
    return "task";
  }
  if (looksLikeGameProposal(text)) {
    return "game";
  }
  if (looksLikeSessionFlowProposal(text)) {
    return "session_flow";
  }
  return "none";
}

function detectLastAssistantAction(text: string): string {
  if (!text) {
    return "none";
  }
  if (looksLikeTaskProposal(text)) {
    return "propose_task";
  }
  if (looksLikeGameProposal(text)) {
    return "propose_game";
  }
  if (looksLikeSessionFlowProposal(text)) {
    return "propose_session_flow";
  }
  if (/\b(i mean|what i mean|because|the part i meant|my point was)\b/i.test(text)) {
    return "clarify";
  }
  if (isQuestionLike(text)) {
    return "ask_question";
  }
  if (isGreetingLike(text)) {
    return "greet";
  }
  return "respond";
}

function buildNegotiatedTopic(
  text: string,
  nextTopic: SessionTopic | null,
  previous: WorkingMemory,
): string {
  if (nextTopic?.summary) {
    return normalize(nextTopic.summary).slice(0, 220);
  }
  if (isQuestionLike(text)) {
    return normalize(text).slice(0, 220);
  }
  return previous.negotiated_topic;
}

function isPendingProposalAccepted(
  memory: WorkingMemory,
  text: string,
  act: DialogueRouteAct,
): boolean {
  if (memory.pending_proposal_kind === "none") {
    return false;
  }
  if (act === "answer_activity_choice") {
    return true;
  }
  if (act === "acknowledgement" || act === "user_answer" || act === "other") {
    // Only treat these as acceptance when a proposal is already pending.
    return isProposalAcceptanceCue(text);
  }
  return false;
}

function summarizeTopic(topic: SessionTopic | null): string {
  if (!topic) {
    return "none";
  }
  return `${topic.topic_type}:${topic.topic_state} ${topic.summary}`.trim();
}

function buildRollingSummary(memory: WorkingMemory): string {
  const parts = [
    memory.current_topic !== "none" ? `Topic ${memory.current_topic}.` : "",
    memory.negotiated_topic ? `Negotiating ${memory.negotiated_topic}.` : "",
    memory.current_unresolved_question
      ? `Still open: ${memory.current_unresolved_question}.`
      : "",
    memory.last_user_request ? `User asked: ${memory.last_user_request}.` : "",
    memory.last_assistant_commitment
      ? `Raven committed to: ${memory.last_assistant_commitment}.`
      : "",
  ].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return "No recent summary yet.";
  }
  return parts.join(" ").slice(0, 280);
}

export function createWorkingMemory(): WorkingMemory {
  return {
    current_topic: "none",
    last_user_intent: "none",
    last_user_request: "",
    last_assistant_commitment: "",
    current_unresolved_question: "",
    session_started: false,
    pending_proposal_kind: "none",
    pending_proposal_summary: "",
    negotiated_topic: "",
    last_assistant_action: "none",
    rolling_summary: "No recent summary yet.",
    session_topic: null,
    user_turn_count: 0,
  };
}

export function normalizeWorkingMemory(value: unknown): WorkingMemory {
  const base = createWorkingMemory();
  if (!value || typeof value !== "object") {
    return base;
  }
  const raw = value as Partial<WorkingMemory>;
  return {
    ...base,
    current_topic:
      typeof raw.current_topic === "string" && raw.current_topic.trim()
        ? normalize(raw.current_topic).slice(0, 220)
        : base.current_topic,
    last_user_intent: raw.last_user_intent ?? base.last_user_intent,
    last_user_request:
      typeof raw.last_user_request === "string"
        ? normalize(raw.last_user_request).slice(0, 220)
        : base.last_user_request,
    last_assistant_commitment:
      typeof raw.last_assistant_commitment === "string"
        ? normalize(raw.last_assistant_commitment).slice(0, 220)
        : base.last_assistant_commitment,
    current_unresolved_question:
      typeof raw.current_unresolved_question === "string"
        ? normalize(raw.current_unresolved_question).slice(0, 220)
        : base.current_unresolved_question,
    session_started: raw.session_started === true,
    pending_proposal_kind:
      raw.pending_proposal_kind === "task" ||
      raw.pending_proposal_kind === "game" ||
      raw.pending_proposal_kind === "session_flow"
        ? raw.pending_proposal_kind
        : "none",
    pending_proposal_summary:
      typeof raw.pending_proposal_summary === "string"
        ? normalize(raw.pending_proposal_summary).slice(0, 220)
        : base.pending_proposal_summary,
    negotiated_topic:
      typeof raw.negotiated_topic === "string"
        ? normalize(raw.negotiated_topic).slice(0, 220)
        : base.negotiated_topic,
    last_assistant_action:
      typeof raw.last_assistant_action === "string"
        ? normalize(raw.last_assistant_action).slice(0, 80)
        : base.last_assistant_action,
    rolling_summary:
      typeof raw.rolling_summary === "string" && raw.rolling_summary.trim()
        ? normalize(raw.rolling_summary).slice(0, 280)
        : base.rolling_summary,
    session_topic: raw.session_topic ?? base.session_topic,
    user_turn_count: typeof raw.user_turn_count === "number" ? raw.user_turn_count : 0,
  };
}

export function resolveWorkingMemoryContinuityTopic(memory: WorkingMemory): string | null {
  if (memory.negotiated_topic) {
    return memory.negotiated_topic;
  }
  if (memory.current_unresolved_question) {
    return memory.current_unresolved_question;
  }
  if (memory.current_topic !== "none") {
    return memory.current_topic;
  }
  return null;
}

export function shouldPreferFreshWorkingMemoryContinuity(input: {
  memory: WorkingMemory;
  latestUserText: string;
  dialogueAct: DialogueRouteAct;
}): boolean {
  const latestUserText = normalize(input.latestUserText).toLowerCase();
  if (!latestUserText) {
    return false;
  }
  if (input.memory.pending_proposal_kind === "none" || input.memory.session_started) {
    return false;
  }
  if (isGreetingLike(latestUserText)) {
    return true;
  }
  return input.dialogueAct === "user_question" && !/\b(task|duration|minute|minutes|hour|hours|proof|verify|verification|different task|another task|new task|do it|start now)\b/i.test(
    latestUserText,
  );
}

export function shouldUseStartedProposalFlowGuidance(input: {
  memory: WorkingMemory;
  latestUserText: string;
  dialogueAct: DialogueRouteAct;
}): boolean {
  const latestUserText = normalize(input.latestUserText).toLowerCase();
  if (!input.memory.session_started) {
    return false;
  }
  if (!/^propose_(task|game|session_flow)$/.test(input.memory.last_assistant_action)) {
    return false;
  }
  if (isProposalAcceptanceCue(latestUserText)) {
    return true;
  }
  return (
    input.dialogueAct === "user_question" &&
    /\b(what do i do first|what should i do first|what now|what next|how do i start|how do we start|first step)\b/i.test(
      latestUserText,
    )
  );
}

export function getStartedProposalFlowGuidance(memory: WorkingMemory): string | null {
  return memory.last_assistant_commitment || memory.pending_proposal_summary || null;
}

export function noteWorkingMemoryUserTurn(
  memory: WorkingMemory,
  input: UserTurnInput,
): WorkingMemory {
  const lastUserRequest = normalize(input.text).slice(0, 220);
  const acceptedPendingProposal = isPendingProposalAccepted(memory, lastUserRequest, input.act);
  const currentUnresolvedQuestion =
    input.act === "user_question" ? lastUserRequest : memory.current_unresolved_question;
  const next: WorkingMemory = {
    ...memory,
    current_topic: summarizeTopic(input.nextTopic),
    last_user_intent: input.act,
    last_user_request: lastUserRequest,
    current_unresolved_question: currentUnresolvedQuestion,
    session_started: acceptedPendingProposal ? true : memory.session_started,
    pending_proposal_kind: acceptedPendingProposal ? "none" : memory.pending_proposal_kind,
    pending_proposal_summary: acceptedPendingProposal ? "" : memory.pending_proposal_summary,
    negotiated_topic: buildNegotiatedTopic(lastUserRequest, input.nextTopic, memory),
    session_topic: input.nextTopic,
    user_turn_count: memory.user_turn_count + 1,
  };

  if (next.user_turn_count % 4 === 0) {
    next.rolling_summary = buildRollingSummary(next);
  }
  return next;
}

export function noteWorkingMemoryAssistantTurn(
  memory: WorkingMemory,
  input: AssistantTurnInput,
): WorkingMemory {
  const commitment = normalize(input.commitment ?? memory.last_assistant_commitment).slice(0, 220);
  const restatesAcceptedProposal =
    memory.session_started &&
    memory.pending_proposal_kind === "none" &&
    /^propose_(task|game|session_flow)$/.test(memory.last_assistant_action) &&
    normalize(memory.last_assistant_commitment) === commitment;
  const nextTopic =
    input.topicResolved && memory.session_topic
      ? { ...memory.session_topic, topic_state: "resolved" as const }
      : memory.session_topic;
  const pendingProposalKind = restatesAcceptedProposal
    ? "none"
    : detectPendingProposalKind(commitment);
  const next: WorkingMemory = {
    ...memory,
    current_topic: summarizeTopic(nextTopic),
    session_topic: nextTopic,
    last_assistant_commitment: commitment,
    current_unresolved_question: "",
    session_started:
      restatesAcceptedProposal
        ? true
        : pendingProposalKind !== "none" && !input.topicResolved
        ? false
        : input.topicResolved
          ? true
          : memory.session_started,
    pending_proposal_kind:
      pendingProposalKind !== "none" && !input.topicResolved
        ? pendingProposalKind
        : input.topicResolved
          ? "none"
          : memory.pending_proposal_kind,
    pending_proposal_summary:
      pendingProposalKind !== "none" && !input.topicResolved
        ? commitment
        : input.topicResolved
          ? ""
          : memory.pending_proposal_summary,
    negotiated_topic:
      memory.negotiated_topic ||
      (nextTopic?.summary ? normalize(nextTopic.summary).slice(0, 220) : memory.negotiated_topic),
    last_assistant_action: restatesAcceptedProposal
      ? memory.last_assistant_action
      : detectLastAssistantAction(commitment),
  };
  return {
    ...next,
    rolling_summary: buildRollingSummary(next),
  };
}

export function buildWorkingMemoryBlock(memory: WorkingMemory): string {
  return [
    "Working Memory:",
    `Topic: ${memory.current_topic || "none"}`,
    `Negotiated topic: ${memory.negotiated_topic || "none"}`,
    `Current unresolved question: ${memory.current_unresolved_question || "none"}`,
    `Session started: ${memory.session_started ? "yes" : "no"}`,
    `Pending proposal: ${memory.pending_proposal_kind}`,
    `Pending proposal summary: ${memory.pending_proposal_summary || "none"}`,
    `Last assistant action: ${memory.last_assistant_action || "none"}`,
    `Rolling summary: ${memory.rolling_summary || "No recent summary yet."}`,
    `Last user request: ${memory.last_user_request || "none"}`,
    `Next commitment: ${memory.last_assistant_commitment || "none"}`,
  ].join("\n");
}
