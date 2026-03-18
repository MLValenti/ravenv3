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

export type AssistantGuardDecision = {
  allow: boolean;
  reason: string;
};

export function normalizeAssistantCommitText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
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
