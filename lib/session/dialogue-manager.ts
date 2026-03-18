import type { UserIntent } from "./intent-router";
import type { VerificationCheckType, VerificationResult } from "./verification";

export type DialogueAct =
  | "answer_user_question"
  | "ask_one_question"
  | "give_instruction"
  | "acknowledge_and_reflect"
  | "verify_action"
  | "clarify_once"
  | "noop";

export type DialogueStepType =
  | "instruct_step"
  | "ask_step"
  | "verify_step"
  | "respond_step"
  | "reflect_step";

export type RetryPolicy = "none" | "single_retry";

export type InstructStep = {
  id: string;
  type: "instruct_step";
  text: string;
  check_required: boolean;
  check_type: VerificationCheckType | null;
  retry_policy: RetryPolicy;
};

export type AskStep = {
  id: string;
  type: "ask_step";
  question: string;
  slot_key: string;
};

export type VerifyStep = {
  id: string;
  type: "verify_step";
  check_type: VerificationCheckType;
  retry_policy: RetryPolicy;
  previous_instruction: string;
};

export type RespondStep = {
  id: string;
  type: "respond_step";
  text: string;
};

export type ReflectStep = {
  id: string;
  type: "reflect_step";
  text: string;
  verify_summary: string | null;
};

export type DialogueStep = InstructStep | AskStep | VerifyStep | RespondStep | ReflectStep;

export type DialogueDecisionContext = {
  hasNewUserMessage: boolean;
  awaitingUser: boolean;
  userIntent: UserIntent | null;
  pendingVerification: boolean;
  clarificationUsedForMessage: boolean;
  shouldAskQuestion: boolean;
};

export type DialogueDecision = {
  act: DialogueAct;
  reason: string;
};

export function selectDialogueAct(context: DialogueDecisionContext): DialogueDecision {
  if (!context.hasNewUserMessage && context.awaitingUser) {
    return { act: "noop", reason: "awaiting user input" };
  }

  if (context.userIntent === "user_question") {
    return { act: "answer_user_question", reason: "user asked a question" };
  }

  if (context.userIntent === "user_short_follow_up") {
    return { act: "clarify_once", reason: "user asked for a short clarification" };
  }

  if (context.userIntent === "user_refusal_or_confusion") {
    if (context.clarificationUsedForMessage) {
      return { act: "acknowledge_and_reflect", reason: "confusion already clarified once" };
    }
    return { act: "clarify_once", reason: "user expressed confusion" };
  }

  if (context.pendingVerification && context.hasNewUserMessage) {
    return { act: "verify_action", reason: "verification is pending and user responded" };
  }

  if (context.userIntent === "user_answer") {
    return { act: "acknowledge_and_reflect", reason: "user answered a prior question" };
  }

  if (context.shouldAskQuestion) {
    return { act: "ask_one_question", reason: "missing memory slot needs user input" };
  }

  if (context.hasNewUserMessage && context.userIntent === "user_ack") {
    return { act: "give_instruction", reason: "user acknowledged and can continue" };
  }

  if (context.hasNewUserMessage && context.userIntent === "user_smalltalk") {
    return { act: "acknowledge_and_reflect", reason: "smalltalk should be acknowledged" };
  }

  if (!context.hasNewUserMessage && context.pendingVerification) {
    return { act: "verify_action", reason: "pending verification without new text" };
  }

  return { act: "give_instruction", reason: "default instruction flow" };
}

export function buildVerificationSummary(result: VerificationResult): string {
  return `${result.checkType}:${result.status} confidence=${result.confidence.toFixed(2)} summary=${result.summary}`;
}
