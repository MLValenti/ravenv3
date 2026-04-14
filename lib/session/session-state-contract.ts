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
  type ServerCanonicalTurnMove,
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
import { isConversationArrivalAnswer } from "./session-memory.ts";

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
    canonicalTurnMove?: ServerCanonicalTurnMove | null;
  },
): UserTurnReduceResult {
  const text = input.text.trim();
  const awaitingBeforePersist = state.turnGate.awaitingUser;
  const nextGate = persistUserMessage(state.turnGate, text);
  const intent = classifyUserIntent(text, awaitingBeforePersist);
  const rawRoute = classifyDialogueRoute({
    text,
    awaitingUser: awaitingBeforePersist,
    currentTopic: state.sessionTopic,
    nowMs: input.nowMs,
  });
  const intentAdjustedRoute =
    intent === "user_answer" &&
    rawRoute.act === "other" &&
    isConversationArrivalAnswer(text)
      ? {
          ...rawRoute,
          act: "user_answer" as const,
          reason: `${rawRoute.reason}; conversation-arrival answer preserved user-answer route`,
        }
      : rawRoute;
  const route = adaptRouteWithCanonicalTurnMove(
    intentAdjustedRoute,
    state.sessionTopic,
    input.canonicalTurnMove,
  );
  let nextWorkingMemory = noteWorkingMemoryUserTurn(state.workingMemory, {
    text,
    act: route.act,
    nextTopic: route.nextTopic,
  });
  if (intent === "user_answer" && nextWorkingMemory.current_unresolved_question) {
    nextWorkingMemory = {
      ...nextWorkingMemory,
      current_unresolved_question: "",
    };
  }
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

function adaptRouteWithCanonicalTurnMove(
  rawRoute: DialogueRouteResult,
  currentTopic: SessionTopic | null,
  canonicalTurnMove?: ServerCanonicalTurnMove | null,
): DialogueRouteResult {
  if (!canonicalTurnMove || canonicalTurnMove.ambiguity === "high") {
    return rawRoute;
  }

  let nextAct = rawRoute.act;
  let nextTopic = rawRoute.nextTopic;
  let canonicalReason: string | null = null;

  if (canonicalTurnMove.revisionKind === "duration_only") {
    nextAct = "duration_request";
    if (currentTopic) {
      nextTopic = currentTopic;
    }
    canonicalReason = "canonical duration-only revision preserved active topic";
  } else if (
    (
      canonicalTurnMove.taskContextKind === "task_follow_through" ||
      canonicalTurnMove.taskContextKind === "task_revision"
    ) &&
    currentTopic
  ) {
    nextAct = canonicalTurnMove.primaryRouteAct;
    nextTopic = currentTopic;
    canonicalReason =
      canonicalTurnMove.taskContextKind === "task_revision"
        ? "canonical task revision preserved active topic"
        : "canonical task follow-through preserved active topic";
  } else if (
    canonicalTurnMove.continuationKind === "continue_current_thought" &&
    currentTopic
  ) {
    nextAct = canonicalTurnMove.primaryRouteAct;
    nextTopic = currentTopic;
    canonicalReason = "canonical continuation preserved active topic";
  }

  if (
    nextAct === rawRoute.act &&
    nextTopic === rawRoute.nextTopic &&
    canonicalReason === null
  ) {
    return rawRoute;
  }

  return {
    ...rawRoute,
    act: nextAct,
    reason: canonicalReason ? `${rawRoute.reason}; ${canonicalReason}` : rawRoute.reason,
    nextTopic,
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
