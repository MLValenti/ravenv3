export type UserIntent =
  | "user_question"
  | "user_short_follow_up"
  | "user_answer"
  | "user_refusal_or_confusion"
  | "user_ack"
  | "user_smalltalk";

import { isShortClarificationTurn } from "./short-follow-up.ts";

const QUESTION_STARTERS = [
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
  "can",
  "could",
  "would",
  "should",
  "do",
  "does",
  "did",
  "is",
  "are",
  "am",
  "will",
];

const ACK_TERMS = new Set([
  "ok",
  "okay",
  "yes",
  "y",
  "yeah",
  "yep",
  "done",
  "got it",
  "understood",
  "sure",
  "fine",
]);

const SMALLTALK_TERMS = ["hi", "hello", "thanks", "thank you", "lol", "haha", "nice", "cool"];

const REFUSAL_OR_CONFUSION_PATTERNS = [
  /\bno\b/i,
  /\bstop\b/i,
  /\bi won't\b/i,
  /\bi dont\b/i,
  /\bi don't\b/i,
  /\bcannot\b/i,
  /\bcan't\b/i,
  /\bconfused\b/i,
  /\bwhat do you mean\b/i,
  /\bnot sure\b/i,
  /\bi do not understand\b/i,
  /\bdont understand\b/i,
  /\bdon't understand\b/i,
];

const IMPLICIT_QUESTION_PATTERNS = [
  /\btell me more\b/i,
  /\bsay more\b/i,
  /\bexplain(?: that| more)?\b/i,
  /\belaborate\b/i,
  /\blike what\b/i,
  /\bhow so\b/i,
  /\bwhy that\b/i,
  /\bthen what\b/i,
  /\bwhat next\b/i,
  /\band then\b/i,
  /^\s*more\s*$/i,
  /^\s*another one\s*$/i,
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function startsWithQuestionWord(text: string): boolean {
  return QUESTION_STARTERS.some((word) => text.startsWith(`${word} `));
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasImplicitQuestionCue(text: string): boolean {
  return IMPLICIT_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

function isPositiveProfileBuildingInvitation(text: string): boolean {
  return (
    /\b(i want you to|i want us to|i(?: would|'d) like you to|can you|help you)\b[\w\s]{0,30}\b(get to know me better|know me better|understand me better|learn more about me)\b/i.test(
      text,
    ) &&
    !/\b(do not|don't|does not|doesn't|cannot|can't|won't)\b[\w\s]{0,20}\b(get to know me better|know me better|understand me better|learn more about me)\b/i.test(
      text,
    )
  );
}

function containsRefusalOrConfusionCue(text: string): boolean {
  return REFUSAL_OR_CONFUSION_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyUserIntent(input: string, awaitingUser: boolean): UserIntent {
  const text = normalize(input);
  if (!text) {
    return "user_ack";
  }

  if (isShortClarificationTurn(text)) {
    return "user_short_follow_up";
  }

  const hasQuestionMark = text.includes("?");
  if (hasQuestionMark || startsWithQuestionWord(text) || hasImplicitQuestionCue(text)) {
    return "user_question";
  }

  if (isPositiveProfileBuildingInvitation(text)) {
    return "user_answer";
  }

  if (containsRefusalOrConfusionCue(text)) {
    return "user_refusal_or_confusion";
  }

  if (ACK_TERMS.has(text)) {
    return "user_ack";
  }

  if (containsAny(text, SMALLTALK_TERMS) && text.split(" ").length <= 6) {
    return "user_smalltalk";
  }

  if (awaitingUser) {
    return "user_answer";
  }

  if (text.split(" ").length <= 3 && containsAny(text, SMALLTALK_TERMS)) {
    return "user_smalltalk";
  }

  return "user_answer";
}
