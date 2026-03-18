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

const REFUSAL_OR_CONFUSION_TERMS = [
  "no",
  "stop",
  "i won't",
  "i dont",
  "i don't",
  "cannot",
  "can't",
  "confused",
  "what do you mean",
  "not sure",
  "i do not understand",
  "dont understand",
  "don't understand",
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

  if (containsAny(text, REFUSAL_OR_CONFUSION_TERMS)) {
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
