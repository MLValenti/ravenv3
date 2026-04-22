export type AssistantCommitMeta = {
  requestId: string;
  sourceUserMessageId: number;
};

export type AssistantCommitRecord = {
  requestId: string;
  normalizedText: string;
};

export type AssistantReplayRecord = {
  anchorUserMessageId: number;
  normalizedText: string;
};

export type AssistantVisibleTurnEntry = {
  sourceUserMessageId: number;
  requestId: string;
  normalizedText: string;
  renderedText: string;
  turnIdEstimate: number;
  committedAtMs: number;
  generationPath: string;
  recovered: boolean;
};

export type AssistantTurnRuntimeState = {
  inFlightTurnRequests: Map<number, string>;
  inFlightModelRequests: Map<number, string>;
  committedTurns: Map<number, AssistantCommitRecord>;
  visibleTurns: Map<number, string>;
  lastReplay: AssistantReplayRecord | null;
  finalizedRequestIds: Set<string>;
  visibleTurnLog: AssistantVisibleTurnEntry[];
  lastCommittedTurn: AssistantVisibleTurnEntry | null;
};

export type AssistantGuardDecision = {
  allow: boolean;
  reason: string;
};

export function createAssistantTurnRuntimeState(): AssistantTurnRuntimeState {
  return {
    inFlightTurnRequests: new Map(),
    inFlightModelRequests: new Map(),
    committedTurns: new Map(),
    visibleTurns: new Map(),
    lastReplay: null,
    finalizedRequestIds: new Set(),
    visibleTurnLog: [],
    lastCommittedTurn: null,
  };
}

export function normalizeAssistantCommitText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function cloneRequests(requests: Map<number, string>): Map<number, string> {
  return new Map(requests);
}

function cloneCommittedTurns(
  committedTurns: Map<number, AssistantCommitRecord>,
): Map<number, AssistantCommitRecord> {
  return new Map(committedTurns);
}

function cloneVisibleTurns(visibleTurns: Map<number, string>): Map<number, string> {
  return new Map(visibleTurns);
}

function cloneFinalizedRequestIds(finalizedRequestIds: Set<string>): Set<string> {
  return new Set(finalizedRequestIds);
}

export function beginTurnRequest(
  requests: Map<number, string>,
  sourceUserMessageId: number,
  requestId: string,
): AssistantGuardDecision {
  if (sourceUserMessageId <= 0) {
    return { allow: true, reason: "no_source_user_turn" };
  }
  const active = requests.get(sourceUserMessageId);
  if (!active) {
    requests.set(sourceUserMessageId, requestId);
    return { allow: true, reason: "started" };
  }
  if (active === requestId) {
    return { allow: false, reason: "request_already_active" };
  }
  return { allow: false, reason: "different_request_already_active" };
}

export function finishTurnRequest(
  requests: Map<number, string>,
  sourceUserMessageId: number,
  requestId: string,
): void {
  if (sourceUserMessageId <= 0) {
    return;
  }
  if (requests.get(sourceUserMessageId) === requestId) {
    requests.delete(sourceUserMessageId);
  }
}

export function registerStreamFinalize(
  finalizedRequestIds: Set<string>,
  requestId: string,
): AssistantGuardDecision {
  if (finalizedRequestIds.has(requestId)) {
    return { allow: false, reason: "duplicate_finalize" };
  }
  finalizedRequestIds.add(requestId);
  return { allow: true, reason: "registered" };
}

export function canCommitAssistantReplay(
  lastReplay: AssistantReplayRecord | null,
  anchorUserMessageId: number,
  text: string,
): AssistantGuardDecision & { normalizedText: string } {
  const normalizedText = normalizeAssistantCommitText(text);
  if (!normalizedText) {
    return { allow: false, reason: "empty_text", normalizedText };
  }
  if (
    lastReplay &&
    lastReplay.anchorUserMessageId === anchorUserMessageId &&
    lastReplay.normalizedText === normalizedText
  ) {
    return { allow: false, reason: "duplicate_without_new_user_message", normalizedText };
  }
  return { allow: true, reason: "ok", normalizedText };
}

export function markAssistantReplay(
  anchorUserMessageId: number,
  normalizedText: string,
): AssistantReplayRecord {
  return {
    anchorUserMessageId,
    normalizedText,
  };
}

export function canCommitAssistantTurn(
  committedTurns: Map<number, AssistantCommitRecord>,
  meta: AssistantCommitMeta,
  text: string,
): AssistantGuardDecision & { normalizedText: string } {
  const normalizedText = normalizeAssistantCommitText(text);
  if (!normalizedText) {
    return { allow: false, reason: "empty_text", normalizedText };
  }
  if (meta.sourceUserMessageId <= 0) {
    return { allow: true, reason: "no_source_user_turn", normalizedText };
  }

  const existing = committedTurns.get(meta.sourceUserMessageId);
  if (!existing) {
    return { allow: true, reason: "first_commit_for_turn", normalizedText };
  }

  if (existing.requestId === meta.requestId) {
    if (existing.normalizedText === normalizedText) {
      return { allow: false, reason: "duplicate_commit_same_request", normalizedText };
    }
    return { allow: false, reason: "second_commit_same_request", normalizedText };
  }

  if (existing.normalizedText === normalizedText) {
    return { allow: false, reason: "duplicate_content_same_turn", normalizedText };
  }

  return { allow: false, reason: "second_authoritative_reply_same_turn", normalizedText };
}

export function canCommitAnchoredAssistantTurn(
  committedTurns: Map<number, AssistantCommitRecord>,
  anchorUserMessageId: number,
  requestId: string | null | undefined,
  text: string,
): AssistantGuardDecision & { normalizedText: string } {
  const normalizedText = normalizeAssistantCommitText(text);
  if (!normalizedText) {
    return { allow: false, reason: "empty_text", normalizedText };
  }
  if (anchorUserMessageId <= 0) {
    return { allow: true, reason: "no_source_user_turn", normalizedText };
  }
  return canCommitAssistantTurn(
    committedTurns,
    {
      requestId: requestId?.trim() || `anchored-${anchorUserMessageId}`,
      sourceUserMessageId: anchorUserMessageId,
    },
    text,
  );
}

export function markAssistantTurnCommitted(
  committedTurns: Map<number, AssistantCommitRecord>,
  meta: AssistantCommitMeta,
  normalizedText: string,
): void {
  if (meta.sourceUserMessageId <= 0 || !normalizedText) {
    return;
  }
  committedTurns.set(meta.sourceUserMessageId, {
    requestId: meta.requestId,
    normalizedText,
  });
}

export function beginAssistantRuntimeRequest(
  state: AssistantTurnRuntimeState,
  kind: "turn" | "model",
  sourceUserMessageId: number,
  requestId: string,
): { next: AssistantTurnRuntimeState; decision: AssistantGuardDecision } {
  const target =
    kind === "model" ? cloneRequests(state.inFlightModelRequests) : cloneRequests(state.inFlightTurnRequests);
  const decision = beginTurnRequest(target, sourceUserMessageId, requestId);
  if (!decision.allow) {
    return { next: state, decision };
  }
  return {
    next: {
      ...state,
      inFlightTurnRequests: kind === "turn" ? target : state.inFlightTurnRequests,
      inFlightModelRequests: kind === "model" ? target : state.inFlightModelRequests,
    },
    decision,
  };
}

export function finishAssistantRuntimeRequest(
  state: AssistantTurnRuntimeState,
  kind: "turn" | "model",
  sourceUserMessageId: number,
  requestId: string,
): AssistantTurnRuntimeState {
  const target =
    kind === "model" ? cloneRequests(state.inFlightModelRequests) : cloneRequests(state.inFlightTurnRequests);
  finishTurnRequest(target, sourceUserMessageId, requestId);
  return {
    ...state,
    inFlightTurnRequests: kind === "turn" ? target : state.inFlightTurnRequests,
    inFlightModelRequests: kind === "model" ? target : state.inFlightModelRequests,
  };
}

export function registerAssistantRuntimeFinalize(
  state: AssistantTurnRuntimeState,
  requestId: string,
): { next: AssistantTurnRuntimeState; decision: AssistantGuardDecision } {
  const finalizedRequestIds = cloneFinalizedRequestIds(state.finalizedRequestIds);
  const decision = registerStreamFinalize(finalizedRequestIds, requestId);
  if (!decision.allow) {
    return { next: state, decision };
  }
  return {
    next: {
      ...state,
      finalizedRequestIds,
    },
    decision,
  };
}

export function hasVisibleAssistantCommit(
  state: AssistantTurnRuntimeState,
  sourceUserMessageId: number,
): boolean {
  return Boolean(state.visibleTurns.get(sourceUserMessageId));
}

export function getActiveAssistantRuntimeRequestId(
  state: AssistantTurnRuntimeState,
  kind: "turn" | "model",
  sourceUserMessageId: number,
): string | null {
  if (sourceUserMessageId <= 0) {
    return null;
  }
  return (
    (kind === "model" ? state.inFlightModelRequests : state.inFlightTurnRequests).get(
      sourceUserMessageId,
    ) ?? null
  );
}

export function clearAssistantRuntimeForAcceptedUserTurn(
  state: AssistantTurnRuntimeState,
  sourceUserMessageId: number,
): AssistantTurnRuntimeState {
  if (sourceUserMessageId <= 0) {
    return {
      ...state,
      lastReplay: null,
    };
  }
  const inFlightTurnRequests = cloneRequests(state.inFlightTurnRequests);
  const inFlightModelRequests = cloneRequests(state.inFlightModelRequests);
  const committedTurns = cloneCommittedTurns(state.committedTurns);
  const visibleTurns = cloneVisibleTurns(state.visibleTurns);
  inFlightTurnRequests.delete(sourceUserMessageId);
  inFlightModelRequests.delete(sourceUserMessageId);
  committedTurns.delete(sourceUserMessageId);
  visibleTurns.delete(sourceUserMessageId);
  return {
    ...state,
    inFlightTurnRequests,
    inFlightModelRequests,
    committedTurns,
    visibleTurns,
    lastReplay: null,
  };
}

export function commitVisibleAssistantTurn(
  state: AssistantTurnRuntimeState,
  input: {
    anchorUserMessageId: number;
    requestId: string | null | undefined;
    renderedText: string;
    turnIdEstimate: number;
    committedAtMs: number;
    generationPath: string;
    recovered?: boolean;
  },
): { next: AssistantTurnRuntimeState; decision: AssistantGuardDecision & { normalizedText: string } } {
  const normalizedText = normalizeAssistantCommitText(input.renderedText);
  if (!normalizedText) {
    return {
      next: state,
      decision: { allow: false, reason: "empty_text", normalizedText },
    };
  }

  const existingVisibleNormalizedText = state.visibleTurns.get(input.anchorUserMessageId) ?? null;
  if (existingVisibleNormalizedText) {
    return {
      next: state,
      decision: {
        allow: false,
        reason:
          existingVisibleNormalizedText === normalizedText
            ? "duplicate_visible_commit_same_turn"
            : "second_visible_reply_same_turn",
        normalizedText,
      },
    };
  }

  const replayDecision = canCommitAssistantReplay(
    state.lastReplay,
    input.anchorUserMessageId,
    input.renderedText,
  );
  if (!replayDecision.allow) {
    return {
      next: state,
      decision: replayDecision,
    };
  }

  const committedTurns = cloneCommittedTurns(state.committedTurns);
  const commitDecision = canCommitAnchoredAssistantTurn(
    committedTurns,
    input.anchorUserMessageId,
    input.requestId,
    input.renderedText,
  );
  if (!commitDecision.allow) {
    return {
      next: state,
      decision: commitDecision,
    };
  }

  const requestId = input.requestId?.trim() || `anchored-${input.anchorUserMessageId}`;
  markAssistantTurnCommitted(
    committedTurns,
    {
      requestId,
      sourceUserMessageId: input.anchorUserMessageId,
    },
    commitDecision.normalizedText,
  );

  const visibleTurns = cloneVisibleTurns(state.visibleTurns);
  visibleTurns.set(input.anchorUserMessageId, commitDecision.normalizedText);

  const lastReplay = markAssistantReplay(input.anchorUserMessageId, commitDecision.normalizedText);
  const entry: AssistantVisibleTurnEntry = {
    sourceUserMessageId: input.anchorUserMessageId,
    requestId,
    normalizedText: commitDecision.normalizedText,
    renderedText: input.renderedText,
    turnIdEstimate: input.turnIdEstimate,
    committedAtMs: input.committedAtMs,
    generationPath: input.generationPath,
    recovered: input.recovered === true,
  };

  return {
    next: {
      ...state,
      committedTurns,
      visibleTurns,
      lastReplay,
      visibleTurnLog: [...state.visibleTurnLog, entry],
      lastCommittedTurn: entry,
    },
    decision: {
      allow: true,
      reason: "committed",
      normalizedText: commitDecision.normalizedText,
    },
  };
}
