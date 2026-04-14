import {
  classifyDialogueRoute,
  type DialogueRouteResult,
  type SessionTopic,
} from "../dialogue/router.ts";
import {
  classifyUserIntent,
  type UserIntent,
} from "./intent-router.ts";
import {
  attachStateRouteToLiveTurnDiagnostic,
  type LiveTurnDiagnosticRecord,
} from "../chat/live-turn-interpretation.ts";
import {
  createWorkingMemory,
  noteWorkingMemoryAssistantTurn,
  noteWorkingMemoryUserTurn,
  type WorkingMemory,
} from "./working-memory.ts";
import {
  createTurnGate,
  markAssistantEmitted,
  persistUserMessage,
  type TurnGateState,
} from "./turn-gate.ts";

export type SessionStateContract = {
  turnGate: TurnGateState;
  workingMemory: WorkingMemory;
  sessionTopic: SessionTopic | null;
};

export type UserTurnReduceResult = {
  next: SessionStateContract;
  intent: UserIntent;
  route: DialogueRouteResult;
  awaitingBeforePersist: boolean;
  diagnostic?: LiveTurnDiagnosticRecord | null;
};

export type TurnGateUiProjection = {
  awaitingUser: boolean;
  lastUserMessageId: number;
  lastAssistantTurnId: number;
  stepIndex: number;
};

export function createSessionStateContract(sessionId?: string): SessionStateContract {
  const gate = createTurnGate(sessionId);
  return {
    turnGate: gate,
    workingMemory: createWorkingMemory(),
    sessionTopic: null,
  };
}

export function projectTurnGateUi(gate: TurnGateState): TurnGateUiProjection {
  return {
    awaitingUser: gate.awaitingUser,
    lastUserMessageId: gate.lastUserMessageId,
    lastAssistantTurnId: gate.lastAssistantTurnId,
    stepIndex: gate.stepIndex,
  };
}

export function reduceUserTurn(
  state: SessionStateContract,
  input: {
    text: string;
    nowMs: number;
    diagnosticRecord?: LiveTurnDiagnosticRecord | null;
  },
): UserTurnReduceResult {
  const text = input.text.trim();
  const awaitingBeforePersist = state.turnGate.awaitingUser;
  const nextGate = persistUserMessage(state.turnGate, text);
  const intent = classifyUserIntent(text, awaitingBeforePersist);
  const route = classifyDialogueRoute({
    text,
    awaitingUser: awaitingBeforePersist,
    currentTopic: state.sessionTopic,
    nowMs: input.nowMs,
  });
  const nextWorkingMemory = noteWorkingMemoryUserTurn(state.workingMemory, {
    text,
    act: route.act,
    nextTopic: route.nextTopic,
  });
  const diagnostic = input.diagnosticRecord
    ? attachStateRouteToLiveTurnDiagnostic(input.diagnosticRecord, {
        text,
        awaitingUser: awaitingBeforePersist,
        currentTopic: state.sessionTopic,
        nowMs: input.nowMs,
      })
    : null;
  return {
    next: {
      turnGate: nextGate,
      workingMemory: nextWorkingMemory,
      sessionTopic: route.nextTopic,
    },
    intent,
    route,
    awaitingBeforePersist,
    diagnostic,
  };
}

export function reduceAssistantEmission(
  state: SessionStateContract,
  input: {
    stepId: string;
    content: string;
    isQuestion: boolean;
    topicResolved?: boolean;
  },
): SessionStateContract {
  const nextGate = markAssistantEmitted(state.turnGate, {
    stepId: input.stepId,
    content: input.content,
    isQuestion: input.isQuestion,
  });
  const nextWorkingMemory = noteWorkingMemoryAssistantTurn(state.workingMemory, {
    commitment: input.content,
    topicResolved: input.topicResolved === true,
  });
  return {
    turnGate: nextGate,
    workingMemory: nextWorkingMemory,
    sessionTopic: nextWorkingMemory.session_topic,
  };
}
