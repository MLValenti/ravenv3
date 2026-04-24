import {
  extractAssistantGeneralPreferenceTopic,
  extractAssistantPreferenceTopic,
  isAssistantGeneralPreferenceQuestion,
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isMutualGettingToKnowRequest,
  normalizeAssistantSelfQuestionText,
} from "../session/interaction-mode.ts";
import { detectRepairTurnKind } from "./repair-turn.ts";

const QUESTION_TOKEN_STOP_WORDS = new Set([
  "about",
  "actually",
  "anything",
  "around",
  "favorite",
  "favorites",
  "into",
  "just",
  "kind",
  "kinds",
  "like",
  "mean",
  "preferences",
  "preference",
  "tell",
  "thing",
  "things",
  "what",
  "which",
  "your",
]);

const LOW_VALUE_ENTITY_TOKENS = new Set([
  "chat",
  "color",
  "favorite",
  "hello",
  "kinds",
  "miss",
  "preferences",
  "question",
  "talk",
  "thread",
  "asked",
  "today",
]);

const DIRECT_SELF_DISCLOSURE_PATTERN =
  /\b(i like|i enjoy|i prefer|i'?m into|i am into|my favorite(?:\s+\w+)? is|favorite(?:\s+\w+)? is|what keeps my attention|what pulls me in|what matters to me)\b/i;

const DIRECT_SERVICE_ANSWER_PATTERN =
  /\b(i want|i expect|start with|first i would want|i would want|i notice|clarity|honesty|follow[- ]through|precision|obedience|steadiness|useful|usefulness)\b/i;

const DIRECT_MUTUAL_DISCLOSURE_PATTERN =
  /\b(what do you want to know first|ask me something real|put a real question on me first|play it both ways|give me something real back|what i want to know)\b/i;

const EXPLICIT_BOUNDARY_PATTERN =
  /\b(i (?:won't|will not|can't|cannot|don't|do not) (?:answer|share|get into|go into|talk about)|not something i(?:'m| am) (?:sharing|get into|going into)|i(?:'m| am) keeping that private|that stays private|i(?:'m| am) not answering that)\b/i;

const WEAK_NONANSWER_PATTERNS = [
  /\bi care less about the label\b/i,
  /\bmore about how it actually shows up between people\b/i,
  /\bhow it actually shows up between people\b/i,
  /\bless about the label\b/i,
  /\bis the subject you asked me to define directly\b/i,
  /\bthe direct factual answer should\b/i,
];

const WRONG_SPEAKER_SELF_PROFILE_PATTERNS = [
  /\bi enjoy being submissive\b/i,
  /\bi(?:'m| am)\s+submissive\b/i,
  /\bsubmissive in a controlled environment\b/i,
];

const COLOR_WORDS = [
  "black",
  "blue",
  "green",
  "red",
  "white",
  "silver",
  "gold",
  "gray",
  "grey",
  "crimson",
  "scarlet",
  "emerald",
  "navy",
  "violet",
];

const PREFERENCE_DOMAIN_GROUPS: Array<{ pattern: RegExp; aliases: RegExp[] }> = [
  {
    pattern: /\b(control|dominance|dominant|power exchange|authority)\b/i,
    aliases: [/\b(control|dominance|power exchange)\b/i],
  },
  {
    pattern: /\b(bondage|restraint|restraints|rope|cuffs?|collars?)\b/i,
    aliases: [/\b(bondage|restraint|rope|cuffs?|collars?)\b/i],
  },
  {
    pattern: /\b(obedience|submission|submissive|owned|ownership)\b/i,
    aliases: [/\b(obedience|submission|owned)\b/i],
  },
  {
    pattern: /\b(service|usefulness|useful|serving)\b/i,
    aliases: [/\b(service|usefulness|serving)\b/i],
  },
  {
    pattern: /\b(toys?|plugs?|dildos?|cages?|vibrators?|wands?)\b/i,
    aliases: [/\b(toys?|plugs?|dildos?|cages?|vibrators?|wands?)\b/i],
  },
  {
    pattern: /\b(anal training|throat training|training|patience)\b/i,
    aliases: [/\b(anal training|throat training)\b/i],
  },
  {
    pattern: /\b(spanking|impact|pain)\b/i,
    aliases: [/\b(spanking|impact|pain)\b/i],
  },
  {
    pattern: /\b(humiliation|degradation)\b/i,
    aliases: [/\b(humiliation|degradation)\b/i],
  },
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isSocialStatusQuestion(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /^(?:how are you(?: doing)?(?: today)?|how(?:'s| is) it going(?: today)?|you good|what(?:'s| is) up)\??$/.test(
    normalized,
  );
}

function isSocialStatusAnswer(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  if (isExplicitBoundaryAnswer(normalized)) {
    return true;
  }
  return (
    /\b(i(?:'m| am)|doing|feeling)\s+(?:good|okay|ok|fine|well|sharp|watchful|awake|steady|tired|rough|better)\b/i.test(
      normalized,
    ) ||
    /\b(a little|a bit)\s+(?:sharp|watchful|tired|off|better|rough)\b/i.test(normalized) ||
    /\bwhat about you\b/i.test(normalized) ||
    /\bon yours\b/i.test(normalized)
  );
}

export function isQuestionText(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|is|are)\b/i.test(
      normalized,
    )
  );
}

export function isExplicitBoundaryAnswer(answerText: string): boolean {
  return EXPLICIT_BOUNDARY_PATTERN.test(normalize(answerText));
}

function tokenizeForQuestion(text: string): string[] {
  return normalizeAssistantSelfQuestionText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !QUESTION_TOKEN_STOP_WORDS.has(token));
}

export function extractHighSignalTokens(text: string, limit = 6): string[] {
  const tokens = tokenizeForQuestion(text).filter((token) => !LOW_VALUE_ENTITY_TOKENS.has(token));
  return Array.from(new Set(tokens)).slice(0, limit);
}

function hasTopicOverlap(topic: string, answerText: string): boolean {
  const topicTokens = extractHighSignalTokens(topic, 4);
  const normalizedAnswer = normalize(answerText);
  return topicTokens.some((token) => normalizedAnswer.includes(token));
}

function isDirectColorAnswer(answerText: string): boolean {
  const normalized = normalize(answerText);
  if (/\bmy favorite color is\b/i.test(normalized) || /\bfavorite color is\b/i.test(normalized)) {
    return true;
  }
  return COLOR_WORDS.some((color) => new RegExp(`\\b${color}\\b`, "i").test(normalized));
}

function countPreferenceDomainHits(answerText: string): number {
  const normalized = normalize(answerText);
  return PREFERENCE_DOMAIN_GROUPS.reduce((count, group) => {
    return group.pattern.test(normalized) ? count + 1 : count;
  }, 0);
}

function matchesPreferenceTopicSemantically(preferenceTopic: string, answerText: string): boolean {
  const normalizedTopic = normalize(preferenceTopic);
  const normalizedAnswer = normalize(answerText);
  if (!normalizedTopic || !normalizedAnswer) {
    return false;
  }
  if (hasTopicOverlap(normalizedTopic, normalizedAnswer)) {
    return true;
  }

  const matchingGroups = PREFERENCE_DOMAIN_GROUPS.filter((group) =>
    group.aliases.some((alias) => alias.test(normalizedTopic)),
  );
  if (matchingGroups.length > 0) {
    return matchingGroups.some((group) => group.pattern.test(normalizedAnswer));
  }

  if (/\b(kink|kinks|fetish|fetishes)\b/i.test(normalizedTopic)) {
    return countPreferenceDomainHits(normalizedAnswer) >= 2;
  }
  if (/\b(toy|toys)\b/i.test(normalizedTopic)) {
    return /\b(plugs?|dildos?|cages?|vibrators?|wands?|toys?)\b/i.test(normalizedAnswer);
  }
  return false;
}

function hasWrongSpeakerSelfProfile(questionText: string, answerText: string): boolean {
  if (!isAssistantSelfQuestion(questionText)) {
    return false;
  }
  const normalizedAnswer = normalize(answerText);
  if (WRONG_SPEAKER_SELF_PROFILE_PATTERNS.some((pattern) => pattern.test(normalizedAnswer))) {
    return true;
  }
  return (
    /\bit calms me down\b/i.test(normalizedAnswer) &&
    /\b(controlled environment|submissive)\b/i.test(normalizedAnswer)
  );
}

function isDirectAssistantSelfAnswer(questionText: string, answerText: string): boolean {
  const normalizedQuestion = normalizeAssistantSelfQuestionText(questionText);
  const normalizedAnswer = normalize(answerText);
  if (!normalizedAnswer) {
    return false;
  }
  if (hasWrongSpeakerSelfProfile(normalizedQuestion, normalizedAnswer)) {
    return false;
  }
  if (isExplicitBoundaryAnswer(normalizedAnswer)) {
    return true;
  }
  if (WEAK_NONANSWER_PATTERNS.some((pattern) => pattern.test(normalizedAnswer))) {
    return false;
  }

  const favoriteTopic = extractAssistantGeneralPreferenceTopic(normalizedQuestion);
  if (favoriteTopic && /\bcolor\b/i.test(favoriteTopic)) {
    return isDirectColorAnswer(normalizedAnswer);
  }

  if (isAssistantServiceQuestion(normalizedQuestion)) {
    return DIRECT_SERVICE_ANSWER_PATTERN.test(normalizedAnswer);
  }

  if (isMutualGettingToKnowRequest(normalizedQuestion)) {
    return DIRECT_MUTUAL_DISCLOSURE_PATTERN.test(normalizedAnswer);
  }

  const preferenceTopic = extractAssistantPreferenceTopic(normalizedQuestion);
  if (preferenceTopic) {
    return (
      (DIRECT_SELF_DISCLOSURE_PATTERN.test(normalizedAnswer) &&
        (matchesPreferenceTopicSemantically(preferenceTopic, normalizedAnswer) ||
          extractHighSignalTokens(normalizedAnswer, 8).length >= 2)) ||
      matchesPreferenceTopicSemantically(preferenceTopic, normalizedAnswer)
    );
  }

  if (isAssistantGeneralPreferenceQuestion(normalizedQuestion) || isAssistantSelfQuestion(normalizedQuestion)) {
    return (
      DIRECT_SELF_DISCLOSURE_PATTERN.test(normalizedAnswer) &&
      extractHighSignalTokens(normalizedAnswer, 8).length >= 2
    );
  }

  return false;
}

export function questionSatisfiedMeaningfully(questionText: string, answerText: string): boolean {
  const normalizedQuestion = normalize(questionText);
  const normalizedAnswer = normalize(answerText);
  if (!normalizedAnswer) {
    return false;
  }
  if (!normalizedQuestion) {
    return true;
  }
  if (WEAK_NONANSWER_PATTERNS.some((pattern) => pattern.test(normalizedAnswer))) {
    return false;
  }
  if (detectRepairTurnKind(normalizedQuestion)) {
    return true;
  }
  if (isSocialStatusQuestion(normalizedQuestion)) {
    return isSocialStatusAnswer(normalizedAnswer);
  }
  if (isDirectAssistantSelfAnswer(normalizedQuestion, normalizedAnswer)) {
    return true;
  }
  if (
    isAssistantServiceQuestion(normalizedQuestion) ||
    isAssistantGeneralPreferenceQuestion(normalizedQuestion) ||
    isAssistantSelfQuestion(normalizedQuestion) ||
    isMutualGettingToKnowRequest(normalizedQuestion)
  ) {
    return false;
  }
  if (isExplicitBoundaryAnswer(normalizedAnswer)) {
    return true;
  }
  const questionTokens = extractHighSignalTokens(normalizedQuestion, 6);
  if (questionTokens.length === 0) {
    return normalizedAnswer.length > 0;
  }
  return questionTokens.some((token) => normalizedAnswer.includes(token));
}

export function shouldReplaceOpenQuestion(
  previousQuestion: string,
  nextQuestion: string,
): boolean {
  if (!isQuestionText(previousQuestion) || !isQuestionText(nextQuestion)) {
    return false;
  }
  if (detectRepairTurnKind(previousQuestion) || detectRepairTurnKind(nextQuestion)) {
    return false;
  }

  const previousNormalized = normalizeAssistantSelfQuestionText(previousQuestion);
  const nextNormalized = normalizeAssistantSelfQuestionText(nextQuestion);
  if (previousNormalized === nextNormalized) {
    return false;
  }

  const previousTokens = extractHighSignalTokens(previousNormalized, 6);
  const nextTokens = extractHighSignalTokens(nextNormalized, 6);
  if (previousTokens.length === 0 || nextTokens.length === 0) {
    return true;
  }
  return !previousTokens.some((token) => nextTokens.includes(token));
}
