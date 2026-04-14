import { classifyCoreConversationMove, type CoreConversationMove } from "./core-turn-move.ts";
import {
  selectDialogueAct,
  type DialogueAct,
  type DialogueActInput,
} from "./conversation-quality.ts";
import {
  classifyDialogueRoute,
  type DialogueRouteAct,
  type SessionTopic,
} from "../dialogue/router.ts";
import { classifyUserIntent, type UserIntent } from "../session/intent-router.ts";

export type LiveRouteTurnInterpretationInput = DialogueActInput & {
  lastUserMessage: string;
  previousAssistantMessage?: string | null;
  currentTopic?: string | null;
};

export type LiveRouteTurnInterpretation = {
  dialogueAct: DialogueAct;
  latestUserIntent: UserIntent;
  latestRouteAct: DialogueRouteAct;
  latestRouteReason: string;
  latestCoreConversationMove: CoreConversationMove | null;
  classifyUserIntentForState: (text: string, awaitingUser: boolean) => UserIntent;
  classifyRouteActForState: (text: string, awaitingUser: boolean) => DialogueRouteAct;
};

export type LiveTurnDiagnosticPathWinner =
  | "client_local_deterministic"
  | "server_replay_bypass"
  | "server_model_path"
  | null;

export type LiveTurnDiagnosticRecord = {
  requestId: string;
  turnId: string;
  sessionId: string;
  rawUserText: string;

  awaitingUser: boolean;
  userAnswered: boolean;
  verificationJustCompleted: boolean;
  sessionPhase: string;
  previousAssistantText: string | null;
  currentTopicInput: string | null;

  intentUsed: UserIntent;
  liveRouteAct: DialogueRouteAct;
  liveRouteReason: string;
  stateRouteAct: DialogueRouteAct | null;
  stateRouteReason: string | null;
  dialogueActUsed: DialogueAct;
  coreConversationMoveUsed: CoreConversationMove | null;

  classifierDisagreement: boolean;
  disagreementKinds: string[];
  questionLike: boolean;

  interactionMode: string | null;
  topicType: string | null;
  topicLocked: boolean | null;
  taskHardLockActive: boolean | null;
  taskProgress: string | null;
  gameProgress: string | null;
  activeThreadHint: string | null;

  pathWinner: LiveTurnDiagnosticPathWinner;
  pathReason: string | null;
  finalWinningResponseSource: string | null;
};

function compactDiagnosticText(text: string | null | undefined, max = 160): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function routeCategory(routeAct: DialogueRouteAct | null): string | null {
  switch (routeAct) {
    case "short_follow_up":
      return "clarify";
    case "user_question":
      return "question";
    case "task_request":
      return "task";
    case "duration_request":
      return "revision";
    case "propose_activity":
    case "answer_activity_choice":
      return "activity";
    case "acknowledgement":
    case "user_answer":
    case "confusion":
    case "other":
      return "continuation";
    default:
      return null;
  }
}

function dialogueCategory(dialogueAct: DialogueAct): string {
  switch (dialogueAct) {
    case "answer_question":
      return "question";
    case "acknowledge":
      return "continuation";
    case "verify":
      return "verify";
    case "instruct":
      return "task_or_progress";
    default:
      return "continuation";
  }
}

function coreMoveCategory(move: CoreConversationMove | null): string | null {
  switch (move) {
    case "clarify_meaning":
    case "blocked_need_clarification":
      return "clarify";
    case "answer_direct_question":
      return "question";
    case "concrete_request":
      return "task";
    case "request_revision":
      return "revision";
    case "continue_current_thought":
    case "agree_and_extend":
    case "user_correction":
    case "raven_leads_next_beat":
      return "continuation";
    default:
      return null;
  }
}

function deriveLiveTurnDiagnosticDisagreement(
  record: Pick<
    LiveTurnDiagnosticRecord,
    | "intentUsed"
    | "liveRouteAct"
    | "stateRouteAct"
    | "dialogueActUsed"
    | "coreConversationMoveUsed"
  >,
): {
  classifierDisagreement: boolean;
  disagreementKinds: string[];
} {
  const disagreementKinds: string[] = [];
  const liveRouteCategory = routeCategory(record.liveRouteAct);
  const stateRouteCategory = routeCategory(record.stateRouteAct);
  const dialogueActCategory = dialogueCategory(record.dialogueActUsed);
  const coreCategory = coreMoveCategory(record.coreConversationMoveUsed);

  if (
    record.stateRouteAct !== null &&
    record.stateRouteAct !== record.liveRouteAct
  ) {
    disagreementKinds.push("live_route_vs_state_route");
  }

  if (
    liveRouteCategory !== null &&
    dialogueActCategory !== "verify" &&
    liveRouteCategory !== dialogueActCategory &&
    !(
      liveRouteCategory === "clarify" &&
      dialogueActCategory === "question"
    )
  ) {
    disagreementKinds.push("dialogue_act_vs_route");
  }

  if (
    coreCategory !== null &&
    liveRouteCategory !== null &&
    coreCategory !== liveRouteCategory &&
    !(
      liveRouteCategory === "question" &&
      coreCategory === "clarify"
    ) &&
    !(
      liveRouteCategory === "continuation" &&
      coreCategory === "question"
    )
  ) {
    disagreementKinds.push("core_move_vs_route");
  }

  if (
    (record.intentUsed === "user_question" || record.intentUsed === "user_short_follow_up") &&
    liveRouteCategory !== "question" &&
    liveRouteCategory !== "clarify"
  ) {
    disagreementKinds.push("question_signal_split");
  }

  return {
    classifierDisagreement: disagreementKinds.length > 0,
    disagreementKinds,
  };
}

function isQuestionLikeDiagnosticRecord(
  record: Pick<
    LiveTurnDiagnosticRecord,
    | "rawUserText"
    | "intentUsed"
    | "liveRouteAct"
    | "stateRouteAct"
    | "dialogueActUsed"
    | "coreConversationMoveUsed"
  >,
): boolean {
  const normalized = record.rawUserText.trim().toLowerCase();
  return (
    normalized.includes("?") ||
    record.intentUsed === "user_question" ||
    record.intentUsed === "user_short_follow_up" ||
    record.liveRouteAct === "user_question" ||
    record.liveRouteAct === "short_follow_up" ||
    record.stateRouteAct === "user_question" ||
    record.stateRouteAct === "short_follow_up" ||
    record.dialogueActUsed === "answer_question" ||
    record.coreConversationMoveUsed === "answer_direct_question" ||
    record.coreConversationMoveUsed === "clarify_meaning"
  );
}

export function classifyRouteActForState(text: string, awaitingUser: boolean): DialogueRouteAct {
  return classifyDialogueRoute({
    text,
    awaitingUser,
    currentTopic: null,
    nowMs: Date.now(),
  }).act;
}

export function interpretLiveRouteTurn(
  input: LiveRouteTurnInterpretationInput,
): LiveRouteTurnInterpretation {
  const dialogueAct = selectDialogueAct(input);
  const latestUserIntent = classifyUserIntent(input.lastUserMessage, input.awaitingUser);
  const latestRoute = classifyDialogueRoute({
    text: input.lastUserMessage,
    awaitingUser: input.awaitingUser,
    currentTopic: null,
    nowMs: Date.now(),
  });
  const latestCoreConversationMove = input.lastUserMessage.trim()
    ? classifyCoreConversationMove({
        userText: input.lastUserMessage,
        previousAssistantText: input.previousAssistantMessage ?? null,
        currentTopic: input.currentTopic ?? null,
      })
    : null;
  return {
    dialogueAct,
    latestUserIntent,
    latestRouteAct: latestRoute.act,
    latestRouteReason: latestRoute.reason,
    latestCoreConversationMove,
    classifyUserIntentForState: classifyUserIntent,
    classifyRouteActForState,
  };
}

export function buildLiveTurnDiagnosticRecord(input: {
  requestId: string;
  turnId: string;
  sessionId: string;
  interpretationInput: LiveRouteTurnInterpretationInput;
  interactionMode?: string | null;
  topicType?: string | null;
  topicLocked?: boolean | null;
  taskHardLockActive?: boolean | null;
  taskProgress?: string | null;
  gameProgress?: string | null;
  activeThreadHint?: string | null;
}): LiveTurnDiagnosticRecord {
  const interpretation = interpretLiveRouteTurn(input.interpretationInput);
  const baseRecord: LiveTurnDiagnosticRecord = {
    requestId: input.requestId,
    turnId: input.turnId,
    sessionId: input.sessionId,
    rawUserText: input.interpretationInput.lastUserMessage,

    awaitingUser: input.interpretationInput.awaitingUser,
    userAnswered: input.interpretationInput.userAnswered,
    verificationJustCompleted: input.interpretationInput.verificationJustCompleted,
    sessionPhase: input.interpretationInput.sessionPhase,
    previousAssistantText: compactDiagnosticText(input.interpretationInput.previousAssistantMessage),
    currentTopicInput: compactDiagnosticText(input.interpretationInput.currentTopic),

    intentUsed: interpretation.latestUserIntent,
    liveRouteAct: interpretation.latestRouteAct,
    liveRouteReason: interpretation.latestRouteReason,
    stateRouteAct: null,
    stateRouteReason: null,
    dialogueActUsed: interpretation.dialogueAct,
    coreConversationMoveUsed: interpretation.latestCoreConversationMove,

    classifierDisagreement: false,
    disagreementKinds: [],
    questionLike: false,

    interactionMode: input.interactionMode ?? null,
    topicType: input.topicType ?? null,
    topicLocked: input.topicLocked ?? null,
    taskHardLockActive: input.taskHardLockActive ?? null,
    taskProgress: input.taskProgress ?? null,
    gameProgress: input.gameProgress ?? null,
    activeThreadHint: compactDiagnosticText(input.activeThreadHint),

    pathWinner: null,
    pathReason: null,
    finalWinningResponseSource: null,
  };
  const disagreement = deriveLiveTurnDiagnosticDisagreement(baseRecord);
  return {
    ...baseRecord,
    classifierDisagreement: disagreement.classifierDisagreement,
    disagreementKinds: disagreement.disagreementKinds,
    questionLike: isQuestionLikeDiagnosticRecord(baseRecord),
  };
}

export function attachStateRouteToLiveTurnDiagnostic(
  record: LiveTurnDiagnosticRecord,
  input: {
    text: string;
    awaitingUser: boolean;
    currentTopic: SessionTopic | null;
    nowMs: number;
  },
): LiveTurnDiagnosticRecord {
  const stateRoute = classifyDialogueRoute({
    text: input.text,
    awaitingUser: input.awaitingUser,
    currentTopic: input.currentTopic,
    nowMs: input.nowMs,
  });
  const nextRecord: LiveTurnDiagnosticRecord = {
    ...record,
    stateRouteAct: stateRoute.act,
    stateRouteReason: stateRoute.reason,
  };
  const disagreement = deriveLiveTurnDiagnosticDisagreement(nextRecord);
  return {
    ...nextRecord,
    classifierDisagreement: disagreement.classifierDisagreement,
    disagreementKinds: disagreement.disagreementKinds,
    questionLike: isQuestionLikeDiagnosticRecord(nextRecord),
  };
}

export function attachWinnerToLiveTurnDiagnostic(
  record: LiveTurnDiagnosticRecord,
  input: {
    pathWinner: LiveTurnDiagnosticPathWinner;
    pathReason: string | null;
    finalWinningResponseSource: string | null;
  },
): LiveTurnDiagnosticRecord {
  return {
    ...record,
    pathWinner: input.pathWinner,
    pathReason: input.pathReason,
    finalWinningResponseSource: input.finalWinningResponseSource,
  };
}
