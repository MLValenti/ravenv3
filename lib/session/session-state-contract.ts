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
import {
  beginAssistantRuntimeRequest,
  clearAssistantRuntimeForAcceptedUserTurn,
  commitVisibleAssistantTurn,
  createAssistantTurnRuntimeState,
  finishAssistantRuntimeRequest,
  getActiveAssistantRuntimeRequestId,
  hasVisibleAssistantCommit,
  registerAssistantRuntimeFinalize,
  type AssistantGuardDecision,
  type AssistantTurnRuntimeState,
  type AssistantVisibleTurnEntry,
} from "./assistant-turn-guard.ts";

export type SessionStateContract = {
  turnGate: TurnGateState;
  workingMemory: WorkingMemory;
  sessionTopic: SessionTopic | null;
  assistantRuntime: AssistantTurnRuntimeState;
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
    assistantRuntime: createAssistantTurnRuntimeState(),
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
      assistantRuntime: clearAssistantRuntimeForAcceptedUserTurn(
        state.assistantRuntime,
        nextGate.lastUserMessageId,
      ),
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
    assistantRuntime: state.assistantRuntime,
  };
}

export function reduceBeginAssistantRequest(
  state: SessionStateContract,
  input: {
    kind: "turn" | "model";
    sourceUserMessageId: number;
    requestId: string;
  },
): { next: SessionStateContract; decision: AssistantGuardDecision } {
  const reduced = beginAssistantRuntimeRequest(
    state.assistantRuntime,
    input.kind,
    input.sourceUserMessageId,
    input.requestId,
  );
  return {
    next:
      reduced.next === state.assistantRuntime
        ? state
        : {
            ...state,
            assistantRuntime: reduced.next,
          },
    decision: reduced.decision,
  };
}

export function reduceFinishAssistantRequest(
  state: SessionStateContract,
  input: {
    kind: "turn" | "model";
    sourceUserMessageId: number;
    requestId: string;
  },
): SessionStateContract {
  return {
    ...state,
    assistantRuntime: finishAssistantRuntimeRequest(
      state.assistantRuntime,
      input.kind,
      input.sourceUserMessageId,
      input.requestId,
    ),
  };
}

export function reduceRegisterAssistantFinalize(
  state: SessionStateContract,
  requestId: string,
): { next: SessionStateContract; decision: AssistantGuardDecision } {
  const reduced = registerAssistantRuntimeFinalize(state.assistantRuntime, requestId);
  return {
    next:
      reduced.next === state.assistantRuntime
        ? state
        : {
            ...state,
            assistantRuntime: reduced.next,
          },
    decision: reduced.decision,
  };
}

export function reduceVisibleAssistantCommit(
  state: SessionStateContract,
  input: {
    anchorUserMessageId: number;
    requestId: string | null | undefined;
    renderedText: string;
    turnIdEstimate: number;
    committedAtMs: number;
    generationPath: string;
    recovered?: boolean;
  },
): {
  next: SessionStateContract;
  decision: AssistantGuardDecision & { normalizedText: string };
} {
  const reduced = commitVisibleAssistantTurn(state.assistantRuntime, input);
  return {
    next:
      reduced.next === state.assistantRuntime
        ? state
        : {
            ...state,
            assistantRuntime: reduced.next,
          },
    decision: reduced.decision,
  };
}

export function selectHasVisibleAssistantCommit(
  state: SessionStateContract,
  sourceUserMessageId: number,
): boolean {
  return hasVisibleAssistantCommit(state.assistantRuntime, sourceUserMessageId);
}

export function selectActiveAssistantRequestId(
  state: SessionStateContract,
  kind: "turn" | "model",
  sourceUserMessageId: number,
): string | null {
  return getActiveAssistantRuntimeRequestId(state.assistantRuntime, kind, sourceUserMessageId);
}

export function selectLastCommittedAssistantTurn(
  state: SessionStateContract,
): AssistantVisibleTurnEntry | null {
  return state.assistantRuntime.lastCommittedTurn;
}
