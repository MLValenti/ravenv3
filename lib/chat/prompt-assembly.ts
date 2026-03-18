import type { HistoryMessage } from "../chat-prompt.ts";
import {
  buildConversationStateBlock,
  type ConversationStateSnapshot,
} from "./conversation-state.ts";

export type PromptAssemblyDebug = {
  stateSnapshot: string;
  includedTurns: Array<{ role: string; content: string; reason: string }>;
  excludedTurns: Array<{ role: string; content: string; reason: string }>;
  includedContext: string[];
  promptSizeEstimate: number;
};

type AssemblePromptInput = {
  baseSystemMessages: HistoryMessage[];
  auxiliarySystemMessages: HistoryMessage[];
  incomingMessages: HistoryMessage[];
  conversationState: ConversationStateSnapshot;
  contextPolicy?: {
    suppressPriorDialogue?: boolean;
  };
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  );
}

function estimatePromptSize(messages: HistoryMessage[]): number {
  const totalWords = messages.reduce(
    (sum, message) => sum + normalize(message.content).split(/\s+/).length,
    0,
  );
  return Math.round(totalWords * 1.3);
}

function hasOverlap(content: string, keywords: Set<string>): boolean {
  if (keywords.size === 0) {
    return false;
  }
  const tokens = tokenize(content);
  for (const keyword of keywords) {
    if (tokens.has(keyword)) {
      return true;
    }
  }
  return false;
}

function isLowSignalPriorDialogue(content: string): boolean {
  const normalized = normalize(content).toLowerCase();
  if (!normalized) {
    return true;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return true;
  }
  if (words.length <= 3) {
    return /^(ok|okay|yes|no|fine|sure|done|ready|thanks)$/i.test(normalized);
  }
  return /\b(stay with the current thread|ask the exact question|what do you want\?)\b/i.test(normalized);
}

function buildRelationalSeed(state: ConversationStateSnapshot): Set<string> {
  return new Set<string>([
    ...tokenize(state.relational_continuity.current_emotional_beat),
    ...tokenize(state.relational_continuity.current_relational_direction),
    ...tokenize(state.relational_continuity.last_unresolved_relational_move),
    ...state.relational_continuity.what_raven_has_implicitly_established_about_herself.flatMap(
      (entry) => [...tokenize(entry)],
    ),
    ...state.rolling_summary.emotional_beat_history.flatMap((entry) => [...tokenize(entry)]),
    ...state.rolling_summary.raven_identity_notes.flatMap((entry) => [...tokenize(entry)]),
  ]);
}

function supportsIdentityContinuity(
  content: string,
  state: ConversationStateSnapshot,
): boolean {
  const normalized = normalize(content).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /\b(i notice|i noticed|i remember|i prefer|i like|that tells me|you say that like|better|good|stay with that)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return state.relational_continuity.what_raven_has_implicitly_established_about_herself.some(
    (entry) => normalize(entry).length > 0 && normalized.includes(normalize(entry).toLowerCase()),
  );
}

function isRelationalContinuityTurn(
  content: string,
  role: HistoryMessage["role"],
  state: ConversationStateSnapshot,
): boolean {
  const normalized = normalize(content).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (role === "assistant") {
    if (
      /\b(i noticed|that tells me|you say that like|stay with that|better|good|not quite|do not blur it|say it plainly)\b/i.test(
        normalized,
      )
    ) {
      return true;
    }
  }
  if (role === "user") {
    if (
      /\b(honestly|truth is|i admit|ashamed|embarrassed|afraid|nervous|not sure|i guess|i want|i need)\b/i.test(
        normalized,
      )
    ) {
      return true;
    }
  }
  return hasOverlap(content, buildRelationalSeed(state));
}

function findLatestUserIndex(messages: HistoryMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

export function assemblePrompt(input: AssemblePromptInput): {
  messages: HistoryMessage[];
  debug: PromptAssemblyDebug;
} {
  const nonSystem = input.incomingMessages.filter((message) => message.role !== "system");
  const incomingSystem = input.incomingMessages.filter((message) => message.role === "system");
  const latestUserIndex = findLatestUserIndex(nonSystem);
  const latestUser =
    (latestUserIndex >= 0 ? nonSystem[latestUserIndex] : null) ??
    ({ role: "user", content: "" } as HistoryMessage);
  const priorDialogue = latestUserIndex >= 0 ? nonSystem.slice(0, latestUserIndex) : nonSystem;
  const trailingDialogue = latestUserIndex >= 0 ? nonSystem.slice(latestUserIndex + 1) : [];
  const keywordSeed = new Set<string>([
    ...tokenize(latestUser.content),
    ...tokenize(input.conversationState.active_topic),
    ...tokenize(input.conversationState.active_thread),
    ...tokenize(input.conversationState.pending_user_request),
    ...tokenize(input.conversationState.pending_modification),
    ...tokenize(input.conversationState.last_satisfied_request),
    ...(input.conversationState.user_goal ? [...tokenize(input.conversationState.user_goal)] : []),
    ...input.conversationState.rolling_summary.recent_topic_history.flatMap((topic) => [
      ...tokenize(topic),
    ]),
    ...input.conversationState.rolling_summary.unresolved_questions.flatMap((question) => [
      ...tokenize(question),
    ]),
    ...input.conversationState.important_entities.flatMap((entity) => [...tokenize(entity)]),
    ...input.conversationState.open_loops.flatMap((loop) => [...tokenize(loop)]),
    ...buildRelationalSeed(input.conversationState),
  ]);

  const selectedDialogue: HistoryMessage[] = [];
  const includedTurns: PromptAssemblyDebug["includedTurns"] = [];
  const excludedTurns: PromptAssemblyDebug["excludedTurns"] = [];
  const recentStartIndex = Math.max(0, priorDialogue.length - 8);
  const suppressPriorDialogue = input.contextPolicy?.suppressPriorDialogue === true;

  if (suppressPriorDialogue) {
    for (const message of priorDialogue) {
      excludedTurns.push({
        role: message.role,
        content: message.content.slice(0, 220),
        reason: "suppressed_for_fresh_turn",
      });
    }
  }

  for (const [index, message] of suppressPriorDialogue ? ([] as Array<[number, HistoryMessage]>) : Array.from(priorDialogue.entries())) {
    const reasons: string[] = [];
    const isRecent = index >= recentStartIndex;
    const isRelevant = hasOverlap(message.content, keywordSeed);
    const supportsOpenLoop = input.conversationState.open_loops.some((loop) =>
      hasOverlap(message.content, tokenize(loop)),
    );
    const supportsGoal =
      Boolean(input.conversationState.user_goal) &&
      hasOverlap(message.content, tokenize(input.conversationState.user_goal ?? ""));
    const supportsActiveThread =
      input.conversationState.active_thread !== "none" &&
      hasOverlap(message.content, tokenize(input.conversationState.active_thread));
    const supportsPendingRequest =
      input.conversationState.pending_user_request !== "none" &&
      hasOverlap(message.content, tokenize(input.conversationState.pending_user_request));
    const supportsPendingModification =
      input.conversationState.pending_modification !== "none" &&
      hasOverlap(message.content, tokenize(input.conversationState.pending_modification));
    const supportsIdentity = supportsIdentityContinuity(message.content, input.conversationState);
    const supportsRelationalContinuity = isRelationalContinuityTurn(
      message.content,
      message.role,
      input.conversationState,
    );
    if (isRecent) {
      reasons.push("recent_window");
    }
    if (isRelevant) {
      reasons.push("keyword_overlap");
    }
    if (supportsOpenLoop) {
      reasons.push("supports_open_loop");
    }
    if (supportsGoal) {
      reasons.push("supports_user_goal");
    }
    if (supportsActiveThread) {
      reasons.push("active_thread");
    }
    if (supportsPendingRequest) {
      reasons.push("pending_request");
    }
    if (supportsPendingModification) {
      reasons.push("pending_modification");
    }
    if (supportsIdentity) {
      reasons.push("identity_continuity");
    }
    if (supportsRelationalContinuity) {
      reasons.push("relational_continuity");
    }
    if (
      isLowSignalPriorDialogue(message.content) &&
      !isRelevant &&
      !supportsOpenLoop &&
      !supportsGoal &&
      !supportsActiveThread &&
      !supportsPendingRequest &&
      !supportsPendingModification &&
      !supportsIdentity &&
      !supportsRelationalContinuity
    ) {
      excludedTurns.push({
        role: message.role,
        content: message.content.slice(0, 220),
        reason: "low_signal_prior_turn",
      });
      continue;
    }
    if (reasons.length > 0) {
      selectedDialogue.push(message);
      includedTurns.push({
        role: message.role,
        content: message.content.slice(0, 220),
        reason: reasons.join("+"),
      });
      continue;
    }
    excludedTurns.push({
      role: message.role,
      content: message.content.slice(0, 220),
      reason: "older_low_relevance_turn",
    });
  }

  for (const message of trailingDialogue) {
    excludedTurns.push({
      role: message.role,
      content: message.content.slice(0, 220),
      reason: "after_latest_user_message",
    });
  }

  const stateBlock = buildConversationStateBlock(input.conversationState);
  const messages = [
    ...input.baseSystemMessages,
    { role: "system", content: stateBlock } satisfies HistoryMessage,
    ...input.auxiliarySystemMessages,
    ...incomingSystem,
    ...selectedDialogue,
    latestUser,
  ];

  return {
    messages,
    debug: {
      stateSnapshot: stateBlock,
      includedTurns,
      excludedTurns,
      includedContext: [
        "system_instructions",
        "conversation_state",
        "auxiliary_context",
        "incoming_system_messages",
        "selected_recent_turns",
        "latest_user_message",
      ],
      promptSizeEstimate: estimatePromptSize(messages),
    },
  };
}
