export type TurnGateState = {
  sessionId: string;
  stepIndex: number;
  awaitingUser: boolean;
  lastUserMessageId: number;
  lastAssistantStepId: string | null;
  lastAssistantTurnId: number;
  lastAssistantMessageText: string | null;
  lastAssistantUserMessageId: number;
  lastStoredMessageRole: "assistant" | "user" | "none";
  stepRepeatCount: Record<string, number>;
};

export type TurnGateDecision = {
  allow: boolean;
  reason: string;
};

type AssistantEmission = {
  stepId: string;
  content: string;
  isQuestion: boolean;
};

function normalizeContent(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createSessionId(): string {
  const random = Math.floor(Math.random() * 1_000_000);
  return `session-${Date.now()}-${random}`;
}

export function createTurnGate(sessionId = createSessionId()): TurnGateState {
  return {
    sessionId,
    stepIndex: 1,
    awaitingUser: false,
    lastUserMessageId: 0,
    lastAssistantStepId: null,
    lastAssistantTurnId: 0,
    lastAssistantMessageText: null,
    lastAssistantUserMessageId: 0,
    lastStoredMessageRole: "none",
    stepRepeatCount: {},
  };
}

export function canEmitAssistant(
  state: TurnGateState,
  stepId: string,
  content: string,
): TurnGateDecision {
  const hasNewUserMessage = state.lastUserMessageId > state.lastAssistantUserMessageId;

  if (state.awaitingUser && !hasNewUserMessage) {
    return { allow: false, reason: "awaiting_user" };
  }

  if (!hasNewUserMessage && state.lastAssistantStepId === stepId) {
    return { allow: false, reason: "duplicate_step_without_new_user_message" };
  }

  const normalizedNext = normalizeContent(content);
  const normalizedLast = normalizeContent(state.lastAssistantMessageText ?? "");
  if (!hasNewUserMessage && normalizedNext && normalizedNext === normalizedLast) {
    return { allow: false, reason: "duplicate_content_without_new_user_message" };
  }

  return { allow: true, reason: "ok" };
}

export function markAssistantEmitted(
  state: TurnGateState,
  emission: AssistantEmission,
): TurnGateState {
  return {
    ...state,
    awaitingUser: emission.isQuestion,
    stepIndex: state.stepIndex + 1,
    lastAssistantStepId: emission.stepId,
    lastAssistantTurnId: state.lastAssistantTurnId + 1,
    lastAssistantMessageText: emission.content,
    lastAssistantUserMessageId: state.lastUserMessageId,
    lastStoredMessageRole: "assistant",
    stepRepeatCount: {
      ...state.stepRepeatCount,
      [emission.stepId]: 0,
    },
  };
}

export function persistUserMessage(
  state: TurnGateState,
  content: string,
): TurnGateState {
  const text = content.trim();
  if (!text) {
    return state;
  }

  const nextMessageId = state.lastUserMessageId + 1;
  return {
    ...state,
    awaitingUser: false,
    lastUserMessageId: nextMessageId,
    lastStoredMessageRole: "user",
    stepRepeatCount: {},
  };
}

export function shouldHoldForNoNewUserAfterAssistant(state: TurnGateState): boolean {
  return (
    state.lastStoredMessageRole === "assistant" &&
    state.lastUserMessageId === state.lastAssistantUserMessageId
  );
}

export function incrementStepRepeatCount(
  state: TurnGateState,
  stepId: string,
): TurnGateState {
  const current = state.stepRepeatCount[stepId] ?? 0;
  return {
    ...state,
    stepRepeatCount: {
      ...state.stepRepeatCount,
      [stepId]: current + 1,
    },
  };
}
