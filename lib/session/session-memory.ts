import {
  isAssistantSelfQuestion,
  isAssistantTrainingRequest,
  isChatSwitchRequest,
  isGoalOrIntentStatement,
  isMutualGettingToKnowRequest,
  isNormalChatRequest,
  isProfileSummaryRequest,
  isRelationalOfferStatement,
  type InteractionMode,
} from "./interaction-mode.ts";
import { isShortClarificationTurn } from "./short-follow-up.ts";

export type SessionMemorySlotKey =
  | "profile_fact"
  | "reply_style"
  | "constraints"
  | "improvement_area";

export type MemoryEntry = {
  value: string;
  updatedAt: number;
  confidence: number;
};

export type UserProfileFactKind =
  | "identity"
  | "hobby"
  | "interest"
  | "preference"
  | "dislike"
  | "constraint"
  | "other";

export type UserProfileFactCategory =
  | "preferred_labels_or_names"
  | "hobbies_interests"
  | "communication_preferences"
  | "relationship_preferences"
  | "dislikes"
  | "constraints"
  | "other";

export type UserProfileFact = MemoryEntry & {
  kind: UserProfileFactKind;
  category: UserProfileFactCategory;
};

export type SessionMemory = {
  user_profile_facts: UserProfileFact[];
  session_intent: MemoryEntry | null;
  temporary_reply_directives: MemoryEntry[];
  last_user_question: MemoryEntry | null;
  last_user_answer: MemoryEntry | null;
  conversation_mode: MemoryEntry | null;
  constraints: MemoryEntry | null;
  improvement_area: MemoryEntry | null;
  last_verified_result_summary: MemoryEntry | null;
};

export type SessionMemoryWriteKey =
  | "user_profile_facts"
  | "session_intent"
  | "temporary_reply_directives"
  | "last_user_question"
  | "last_user_answer"
  | "conversation_mode"
  | "constraints"
  | "improvement_area"
  | "last_verified_result_summary";

export type SessionMemoryWriteRecord = {
  key: SessionMemoryWriteKey;
  value: string;
  kind?: UserProfileFactKind;
  category?: UserProfileFactCategory;
};

export type SessionMemoryWriteTrace = {
  memory: SessionMemory;
  attempted: SessionMemoryWriteRecord[];
  committed: SessionMemoryWriteRecord[];
};

const SLOT_ORDER: SessionMemorySlotKey[] = [
  "profile_fact",
  "reply_style",
  "constraints",
  "improvement_area",
];

const PROFILE_BUILDING_PATTERNS = [
  /\bget to know me\b/i,
  /\blearn (?:what )?i like\b/i,
  /\blearn about me\b/i,
  /\bknow me better\b/i,
  /\bbuild (?:my )?profile\b/i,
  /\bwhat should you know about me\b/i,
];

export function isConversationArrivalAnswer(text: string): boolean {
  return /\b(?:i(?:'m| am|m)\s+|just\s+)?here to (?:talk|chat)\b/i.test(text);
}

function isMetaConversationIntent(text: string): boolean {
  return (
    matchesAny(text, PROFILE_BUILDING_PATTERNS) ||
    isMutualGettingToKnowRequest(text) ||
    isAssistantSelfQuestion(text)
  );
}

const TASK_REQUEST_PATTERNS = [
  /\bgive me (?:a|another)\b.+\btask\b/i,
  /\bset (?:me )?(?:a|another)\b.+\btask\b/i,
  /\bassign (?:me )?(?:a|another)\b.+\btask\b/i,
  /\bi want (?:a|another)\b.+\btask\b/i,
];

const GAME_PATTERNS = [/\blet'?s play\b/i, /\bplay a game\b/i, /\byou pick\b/i];

const DIRECTIVE_PATTERNS = [
  /\bask me more questions\b/i,
  /\bask more questions\b/i,
  /\bask more follow[- ]?ups\b/i,
  /\bkeep asking\b/i,
  /\bbe more curious\b/i,
  /\bgo deeper\b/i,
  /\bprobe more\b/i,
  /\bfollow up more\b/i,
  /\bquestion me more\b/i,
];

const DURABLE_PREFERENCE_PATTERNS = [
  /\bi prefer\b/i,
  /\bi usually prefer\b/i,
  /\bin general\b/i,
  /\bgenerally\b/i,
  /\bmost of the time\b/i,
  /\bfrom now on\b/i,
  /\balways\b/i,
];

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function cleanFactValue(text: string): string {
  return normalize(text)
    .replace(/^(?:to\s+)/i, "")
    .replace(/^(?:that\s+)/i, "")
    .replace(/[.?!]+$/g, "");
}

function isWeakMemoryValue(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return true;
  }
  if (
    /^(?:i(?:'m| am|m)\s+)?(?:ok(?:ay)?|fine|good|alright|all right|all good|doing okay|doing ok)$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(exactly|that makes sense|makes sense|right|true|fair|good point|that's a good point|thats a good point)$/i.test(normalized)) {
    return true;
  }
  if (/^that (?:sounds|feels) more [a-z]+$/i.test(normalized)) {
    return true;
  }
  return /^(yes|yeah|yep|ok|okay|sure|fine|ready|done|hi|hello|hey)(?:\s+(mistress|raven|maam|ma'am))?$/.test(
    normalized,
  );
}

function isTransientStateDisclosure(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  return /^(?:(?:i(?:'m| am|m)|feeling)\s+)?(?:horny|turned on|aroused|tired|sleepy|stressed|anxious|nervous|sad|lonely|bored|overwhelmed|restless|worked up)\b/.test(
    normalized,
  );
}

function isEphemeralRelationalOffer(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    isAssistantTrainingRequest(normalized) ||
    /\b(thinking|wondering|trying|figuring out)\b.{0,60}\b(what i can do for you|how i can (?:be useful|help|please|serve|entertain) you)\b/i.test(
      normalized,
    ) ||
    /\bi(?:'d| would) love to be trained by you\b/i.test(normalized) ||
    /\bi want to be trained by you\b/i.test(normalized) ||
    /\bi want to (?:serve|please|help|be useful to) you\b/i.test(normalized) ||
    /\bwhat i can do for you\b/i.test(normalized) ||
    /\bhow i can (?:be useful|help|please|serve|entertain) you\b/i.test(normalized)
  );
}

function isMalformedProfileFallbackValue(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return true;
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const unstableTokens = new Set([
    "what",
    "why",
    "how",
    "when",
    "where",
    "who",
    "which",
    "that",
    "this",
    "there",
    "here",
    "keep",
    "going",
    "tell",
    "say",
    "mean",
    "part",
    "thing",
    "stuff",
    "happen",
    "happened",
    "happens",
    "first",
    "more",
    "real",
    "actually",
    "makes",
    "sounds",
    "would",
    "could",
    "should",
  ]);
  const meaningfulTokens = tokens.filter((token) => !unstableTokens.has(token));
  if (meaningfulTokens.length === 0) {
    return true;
  }
  if (tokens.length <= 4 && tokens.some((token) => ["what", "why", "how", "when", "where", "who", "which"].includes(token))) {
    return true;
  }
  if (tokens.length <= 4 && meaningfulTokens.length <= 1) {
    return true;
  }
  return false;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function includesAny(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function looksLikeDirectQuestion(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|is|are)\b/.test(
      normalized,
    )
  );
}

function createEntry(value: string, updatedAt: number, confidence: number): MemoryEntry {
  return {
    value,
    updatedAt,
    confidence: clampConfidence(confidence),
  };
}

function hasDurablePreferenceMarker(text: string): boolean {
  return matchesAny(text, DURABLE_PREFERENCE_PATTERNS);
}

function isTemporaryReplyDirective(text: string): boolean {
  return matchesAny(text, DIRECTIVE_PATTERNS) && !hasDurablePreferenceMarker(text);
}

function inferConversationModeValue(text: string): InteractionMode | null {
  if (isChatSwitchRequest(text)) {
    return "normal_chat";
  }
  if (isConversationArrivalAnswer(text)) {
    return "normal_chat";
  }
  if (isProfileSummaryRequest(text)) {
    return "profile_building";
  }
  if (isAssistantSelfQuestion(text) || isMutualGettingToKnowRequest(text)) {
    return "relational_chat";
  }
  if (isRelationalOfferStatement(text) || isEphemeralRelationalOffer(text)) {
    return "relational_chat";
  }
  if (isMetaConversationIntent(text)) {
    return "profile_building";
  }
  if (isGoalOrIntentStatement(text)) {
    return "normal_chat";
  }
  if (matchesAny(text, TASK_REQUEST_PATTERNS)) {
    return "task_planning";
  }
  if (matchesAny(text, GAME_PATTERNS)) {
    return "game";
  }
  if (looksLikeDirectQuestion(text)) {
    return "question_answering";
  }
  return null;
}

function inferSessionIntentValue(text: string): string | null {
  const normalized = text.toLowerCase();
  if (isChatSwitchRequest(text)) {
    return "chat_switch";
  }
  if (isProfileSummaryRequest(text)) {
    return "profile_summary_request";
  }
  if (isAssistantSelfQuestion(text) || isMutualGettingToKnowRequest(text)) {
    return "relational_chat";
  }
  if (isRelationalOfferStatement(text) || isEphemeralRelationalOffer(text)) {
    return "relational_chat";
  }
  if (matchesAny(text, PROFILE_BUILDING_PATTERNS)) {
    return "profile_building";
  }
  if (matchesAny(text, TASK_REQUEST_PATTERNS)) {
    return "task_request";
  }
  if (matchesAny(text, GAME_PATTERNS)) {
    return "game";
  }

  const goalMatch =
    text.match(/\bmy goal is\s+([^.!?]{2,120})/i) ??
    text.match(/\bi want help with\s+([^.!?]{2,120})/i) ??
    text.match(/\bi want to improve\s+([^.!?]{2,120})/i) ??
    text.match(/\bi want to work on\s+([^.!?]{2,120})/i) ??
    text.match(/\bi(?:'d| would) love to\s+([^.!?]{2,120})/i) ??
    text.match(/\bi want you to\s+([^.!?]{2,120})/i) ??
    text.match(/\bi want to\s+([^.!?]{2,120})/i);
  if (goalMatch?.[1]) {
    return cleanFactValue(goalMatch[1]);
  }

  if (normalized.includes("learn what i like") || normalized.includes("get to know me")) {
    return "profile_building";
  }
  return null;
}

function extractProfileFacts(text: string, slotHint: SessionMemorySlotKey | null): UserProfileFact[] {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const isTaskUtilityAnswer =
    /^\d+\s*(minutes?|hours?)$/.test(normalized) ||
    /^(anal|oral|prop|external)$/.test(normalized) ||
    /^(different task|different kind of task|another one|something else|not that)$/.test(
      normalized,
    ) ||
    /^(make it (?:shorter|longer|\d+\s*(?:minutes?|hours?))|change (?:the )?(?:time|duration|how long))$/.test(
      normalized,
    );
  if (
    isMetaConversationIntent(text) ||
    isProfileSummaryRequest(text) ||
    isChatSwitchRequest(text) ||
    isConversationArrivalAnswer(text) ||
    isNormalChatRequest(text) ||
    isTransientStateDisclosure(text) ||
    isEphemeralRelationalOffer(text) ||
    isTaskUtilityAnswer
  ) {
    return [];
  }
  const facts: UserProfileFact[] = [];
  const nameMatch =
    text.match(/\bmy name is\s+([a-z][a-z'-]{1,24})\b/i) ??
    text.match(/\bcall me\s+([a-z][a-z'-]{1,24})\b/i) ??
    text.match(/\bmy name'?s\s+([a-z][a-z'-]{1,24})\b/i);
  if (nameMatch?.[1]) {
    facts.push({
      kind: "identity",
      category: "preferred_labels_or_names",
      value: cleanFactValue(nameMatch[1]),
      updatedAt: 0,
      confidence: 0,
    });
  }

  const hobbyMatch =
    text.match(/\bi like to\s+([^.!?]{2,80})/i) ??
    text.match(/\bi like\s+([^.!?]{2,80})/i) ??
    text.match(/\bi enjoy\s+([^.!?]{2,80})/i) ??
    text.match(/\bmy hobbies are\s+([^.!?]{2,120})/i) ??
    text.match(/\bmy hobby is\s+([^.!?]{2,80})/i);
  if (hobbyMatch?.[1]) {
    const hobbyValue = cleanFactValue(hobbyMatch[1]);
    if (
      !/\b(push|structure|control|firm|dominant|tease|guidance|training|challenge|pressure)\b/i.test(
        hobbyValue,
      )
    ) {
      facts.push({
        kind: /\bgolf|hiking|reading|gaming|cooking|running|lifting|music|art|travel/i.test(
          hobbyMatch[1],
        )
          ? "hobby"
          : "interest",
        category: "hobbies_interests",
        value: hobbyValue,
        updatedAt: 0,
        confidence: 0,
      });
    }
  }

  const preferenceMatch =
    text.match(/\bi prefer\s+([^.!?]{2,120})/i) ??
    text.match(/\bi usually prefer\s+([^.!?]{2,120})/i) ??
    text.match(/\bwhat i want you to remember is\s+([^.!?]{2,120})/i) ??
    text.match(/\b(?:keep it|be|stay)\s+(direct|brief|short|open-ended|gentle|soft|firm|slow|slower|steady|brisk|faster|light|lighter|intense|more intense)\b/i) ??
    text.match(/\bi like (?:it )?(direct|brief|short|open-ended|gentle|soft|firm|slow|slower|steady|brisk|faster|light|lighter|intense|more intense)\b/i);
  if (preferenceMatch?.[1]) {
    const preferenceValue = cleanFactValue(preferenceMatch[1]);
    facts.push({
      kind: "preference",
      category:
        /\b(talk|answers?|question|direct|brief|short|open-ended|tone|pace|brisk|steady|slower|light|lighter|gentle|soft|firm|intense)\b/i.test(
          preferenceValue,
        )
          ? "communication_preferences"
          : "relationship_preferences",
      value: preferenceValue,
      updatedAt: 0,
      confidence: 0,
    });
  }

  const relationshipPreferenceMatch =
    text.match(/\bi like\s+([^.!?]{2,120})\b(?:\s+from you|\s+in a dynamic|\s+in conversation)?/i) ??
    text.match(/\bi want\s+([^.!?]{2,120})\b(?:\s+from you|\s+in a dynamic)?/i);
  if (
    relationshipPreferenceMatch?.[1] &&
    /\b(push|structure|control|firm|dominant|tease|guidance|training|challenge|pressure)\b/i.test(
      relationshipPreferenceMatch[1],
    )
  ) {
    facts.push({
      kind: "preference",
      category: "relationship_preferences",
      value: cleanFactValue(relationshipPreferenceMatch[1]),
      updatedAt: 0,
      confidence: 0,
    });
  }

  const dislikeMatch =
    text.match(/\bi don't like\s+([^.!?]{2,120})/i) ??
    text.match(/\bi do not like\s+([^.!?]{2,120})/i) ??
    text.match(/\bi hate\s+([^.!?]{2,120})/i);
  if (dislikeMatch?.[1]) {
    facts.push({
      kind: "dislike",
      category: "dislikes",
      value: cleanFactValue(dislikeMatch[1]),
      updatedAt: 0,
      confidence: 0,
    });
  }

  const constraintMatch =
    text.match(/\b(?:no|avoid|off limits|hard limit)\s+([^.!?]{2,120})/i) ??
    text.match(/\b(?:public tasks|public scenes|humiliation|degradation)\b/i);
  if (constraintMatch?.[1] || /\bno public\b/i.test(text)) {
    facts.push({
      kind: "constraint",
      category: "constraints",
      value: cleanFactValue(constraintMatch?.[1] ?? text.match(/\b(no public[^.!?]{0,80})/i)?.[1] ?? text),
      updatedAt: 0,
      confidence: 0,
    });
  }

  if (
    slotHint === "profile_fact" &&
    facts.length === 0 &&
    !inferSessionIntentValue(text) &&
    !isTransientStateDisclosure(text) &&
    !isEphemeralRelationalOffer(text) &&
    !isMalformedProfileFallbackValue(text)
  ) {
    facts.push({
      kind: "other",
      category: "other",
      value: cleanFactValue(text),
      updatedAt: 0,
      confidence: 0,
    });
  }

  return facts;
}

function pushUniqueEntry(
  entries: MemoryEntry[],
  next: MemoryEntry,
  maxEntries: number,
): MemoryEntry[] {
  const normalizedNext = next.value.toLowerCase();
  const filtered = entries.filter((entry) => entry.value.toLowerCase() !== normalizedNext);
  return [...filtered, next].slice(-maxEntries);
}

function pushUniqueFact(
  facts: UserProfileFact[],
  next: UserProfileFact,
  nowMs: number,
  confidence: number,
): UserProfileFact[] {
  const normalizedValue = next.value.toLowerCase();
  const filtered = facts.filter(
    (fact) => !(fact.kind === next.kind && fact.value.toLowerCase() === normalizedValue),
  );
  return [
    ...filtered,
    {
      ...next,
      updatedAt: nowMs,
      confidence: clampConfidence(confidence),
    },
  ].slice(-8);
}

function slotSummaryLine(label: string, entry: MemoryEntry | null): string | null {
  if (!entry?.value) {
    return null;
  }
  return `- ${label}: ${entry.value}`;
}

function factSummaryLine(facts: UserProfileFact[]): string | null {
  if (!facts.length) {
    return null;
  }
  return `- user_profile_facts: ${facts.map((fact) => `${fact.kind}: ${fact.value}`).join(" | ")}`;
}

function directiveSummaryLine(directives: MemoryEntry[]): string | null {
  if (!directives.length) {
    return null;
  }
  return `- temporary_reply_directives: ${directives.map((entry) => entry.value).join(" | ")}`;
}

function hasProfileFact(
  facts: UserProfileFact[],
  candidate: Pick<UserProfileFact, "kind" | "category" | "value">,
): boolean {
  const normalizedValue = candidate.value.toLowerCase();
  return facts.some(
    (fact) =>
      fact.kind === candidate.kind &&
      fact.category === candidate.category &&
      fact.value.toLowerCase() === normalizedValue,
  );
}

export function describeSessionMemoryWrites(
  previous: SessionMemory,
  next: SessionMemory,
): SessionMemoryWriteRecord[] {
  const writes: SessionMemoryWriteRecord[] = [];

  if (
    previous.session_intent?.value !== next.session_intent?.value &&
    next.session_intent?.value
  ) {
    writes.push({ key: "session_intent", value: next.session_intent.value });
  }

  if (
    previous.conversation_mode?.value !== next.conversation_mode?.value &&
    next.conversation_mode?.value
  ) {
    writes.push({
      key: "conversation_mode",
      value: next.conversation_mode.value,
    });
  }

  if (
    previous.last_user_question?.value !== next.last_user_question?.value &&
    next.last_user_question?.value
  ) {
    writes.push({
      key: "last_user_question",
      value: next.last_user_question.value,
    });
  }

  if (
    previous.last_user_answer?.value !== next.last_user_answer?.value &&
    next.last_user_answer?.value
  ) {
    writes.push({
      key: "last_user_answer",
      value: next.last_user_answer.value,
    });
  }

  for (const fact of next.user_profile_facts) {
    if (!hasProfileFact(previous.user_profile_facts, fact)) {
      writes.push({
        key: "user_profile_facts",
        value: fact.value,
        kind: fact.kind,
        category: fact.category,
      });
    }
  }

  for (const directive of next.temporary_reply_directives) {
    if (
      !previous.temporary_reply_directives.some(
        (entry) => entry.value.toLowerCase() === directive.value.toLowerCase(),
      )
    ) {
      writes.push({
        key: "temporary_reply_directives",
        value: directive.value,
      });
    }
  }

  if (
    previous.constraints?.value !== next.constraints?.value &&
    next.constraints?.value
  ) {
    writes.push({ key: "constraints", value: next.constraints.value });
  }

  if (
    previous.improvement_area?.value !== next.improvement_area?.value &&
    next.improvement_area?.value
  ) {
    writes.push({
      key: "improvement_area",
      value: next.improvement_area.value,
    });
  }

  if (
    previous.last_verified_result_summary?.value !== next.last_verified_result_summary?.value &&
    next.last_verified_result_summary?.value
  ) {
    writes.push({
      key: "last_verified_result_summary",
      value: next.last_verified_result_summary.value,
    });
  }

  return writes;
}

export function createSessionMemory(): SessionMemory {
  return {
    user_profile_facts: [],
    session_intent: null,
    temporary_reply_directives: [],
    last_user_question: null,
    last_user_answer: null,
    conversation_mode: null,
    constraints: null,
    improvement_area: null,
    last_verified_result_summary: null,
  };
}

export function ensureSessionMemory(value: SessionMemory | null | undefined): SessionMemory {
  return value ?? createSessionMemory();
}

export function getLatestSessionMemoryUserText(
  value: SessionMemory | null | undefined,
): string | null {
  const memory = ensureSessionMemory(value);
  return memory.last_user_answer?.value ?? memory.last_user_question?.value ?? null;
}

export function writeConversationMode(
  memory: SessionMemory,
  mode: InteractionMode,
  nowMs: number,
  confidence = 0.94,
): SessionMemory {
  return {
    ...memory,
    conversation_mode: {
      value: mode,
      updatedAt: nowMs,
      confidence,
    },
  };
}

export function inferSlotFromAnswer(text: string): SessionMemorySlotKey {
  const normalized = text.toLowerCase();
  if (isMetaConversationIntent(text)) {
    return "reply_style";
  }
  if (
    /\b(call me|my name is|i like to|i enjoy|my hobbies are|what i want you to remember)\b/i.test(text)
  ) {
    return "profile_fact";
  }
  if (
    isTemporaryReplyDirective(text) ||
    includesAny(normalized, [
      "direct",
      "brief",
      "short",
      "warmer",
      "colder",
      "clinical",
      "gentle",
      "stricter",
      "questions",
    ])
  ) {
    return "reply_style";
  }
  if (
    includesAny(normalized, [
      "limit",
      "constraint",
      "avoid",
      "cannot",
      "can't",
      "dont",
      "don't",
      "do not",
      "no ",
      "private",
      "public",
      "hard limit",
      "off limits",
    ])
  ) {
    return "constraints";
  }
  if (
    includesAny(normalized, [
      "improve",
      "practice",
      "focus",
      "weak",
      "challenge",
      "struggle",
      "consistency",
      "follow through",
      "discipline",
      "routine",
    ])
  ) {
    return "improvement_area";
  }
  return "profile_fact";
}

export function chooseNextAskSlot(memory: SessionMemory): SessionMemorySlotKey | null {
  const profileMode =
    memory.conversation_mode?.value === "profile_building" ||
    memory.session_intent?.value === "profile_building" ||
    memory.session_intent?.value === "mutual_getting_to_know_each_other";
  if (!profileMode) {
    return null;
  }

  const hasIdentity = memory.user_profile_facts.some((fact) => fact.kind === "identity");
  if (!hasIdentity || memory.user_profile_facts.length < 2) {
    return "profile_fact";
  }
  const hasReplyPreference = memory.user_profile_facts.some((fact) => fact.kind === "preference");
  if (memory.temporary_reply_directives.length === 0 && !hasReplyPreference) {
    return "reply_style";
  }
  if (!memory.constraints) {
    return "constraints";
  }
  if (!memory.improvement_area) {
    return "improvement_area";
  }
  return null;
}

export function listMissingAskSlots(memory: SessionMemory): SessionMemorySlotKey[] {
  return SLOT_ORDER.filter((slot) => {
    if (slot === "profile_fact") {
      return memory.user_profile_facts.length < 2;
    }
    if (slot === "reply_style") {
      return (
        memory.temporary_reply_directives.length === 0 &&
        !memory.user_profile_facts.some((fact) => fact.kind === "preference")
      );
    }
    return !memory[slot];
  });
}

export function writeUserQuestion(
  memory: SessionMemory,
  text: string,
  nowMs: number,
  confidence = 0.9,
): SessionMemory {
  const next = normalize(text);
  if (!next) {
    return memory;
  }

  const nextIntent = inferSessionIntentValue(next);
  const inferredMode = inferConversationModeValue(next) ?? "question_answering";
  const shouldPreserveRelationalMode =
    !isShortClarificationTurn(next) &&
    inferredMode === "question_answering" &&
    memory.conversation_mode?.value === "relational_chat" &&
    !isChatSwitchRequest(next) &&
    !isProfileSummaryRequest(next) &&
    !isNormalChatRequest(next) &&
    !matchesAny(next, TASK_REQUEST_PATTERNS) &&
    !matchesAny(next, GAME_PATTERNS) &&
    !matchesAny(next, PROFILE_BUILDING_PATTERNS);
  const nextMode = isShortClarificationTurn(next)
    ? memory.conversation_mode?.value ?? "question_answering"
    : (shouldPreserveRelationalMode ? "relational_chat" : inferredMode);
  return {
    ...memory,
    session_intent: nextIntent
      ? createEntry(nextIntent, nowMs, confidence)
      : memory.session_intent,
    conversation_mode: createEntry(nextMode, nowMs, confidence),
    last_user_question: createEntry(next, nowMs, confidence),
  };
}

export function traceWriteUserQuestion(
  memory: SessionMemory,
  text: string,
  nowMs: number,
  confidence = 0.9,
): SessionMemoryWriteTrace {
  const next = normalize(text);
  if (!next) {
    return {
      memory,
      attempted: [],
      committed: [],
    };
  }

  const attempted: SessionMemoryWriteRecord[] = [
    {
      key: "last_user_question",
      value: next,
    },
    {
      key: "conversation_mode",
      value: isShortClarificationTurn(next)
        ? (memory.conversation_mode?.value ?? "question_answering")
        : (inferConversationModeValue(next) ?? "question_answering"),
    },
  ];
  const nextIntent = inferSessionIntentValue(next);
  if (nextIntent) {
    attempted.push({
      key: "session_intent",
      value: nextIntent,
    });
  }

  const updatedMemory = writeUserQuestion(memory, text, nowMs, confidence);
  return {
    memory: updatedMemory,
    attempted,
    committed: describeSessionMemoryWrites(memory, updatedMemory),
  };
}

export function writeUserAnswer(
  memory: SessionMemory,
  text: string,
  nowMs: number,
  slotHint: SessionMemorySlotKey | null,
  confidence = 0.85,
): SessionMemory {
  const next = normalize(text);
  if (!next) {
    return memory;
  }

  const effectiveSlot = slotHint ?? inferSlotFromAnswer(next);
  const nextIntent = inferSessionIntentValue(next);
  const inferredMode = inferConversationModeValue(next);
  const shouldPreserveRelationalMode =
    inferredMode === "normal_chat" &&
    (memory.conversation_mode?.value === "relational_chat" ||
      memory.conversation_mode?.value === "profile_building") &&
    !isChatSwitchRequest(next) &&
    !isProfileSummaryRequest(next) &&
    !isNormalChatRequest(next) &&
    !matchesAny(next, TASK_REQUEST_PATTERNS) &&
    !matchesAny(next, GAME_PATTERNS);
  const nextMode =
    (shouldPreserveRelationalMode ? memory.conversation_mode?.value : inferredMode) ??
    (nextIntent === "profile_building" ||
    nextIntent === "mutual_getting_to_know_each_other"
      ? "profile_building"
      : nextIntent === "relational_chat"
        ? "relational_chat"
      : memory.conversation_mode?.value ?? null);

  let updated: SessionMemory = {
    ...memory,
    last_user_answer: createEntry(
      next,
      nowMs,
      isWeakMemoryValue(next) ? confidence * 0.5 : confidence,
    ),
    last_user_question: null,
    session_intent: nextIntent ? createEntry(nextIntent, nowMs, confidence) : memory.session_intent,
    conversation_mode: nextMode ? createEntry(nextMode, nowMs, confidence) : memory.conversation_mode,
  };

  if (isWeakMemoryValue(next)) {
    return updated;
  }

  const shouldStoreTemporaryDirective =
    (!isMetaConversationIntent(next) && isTemporaryReplyDirective(next)) ||
    (effectiveSlot === "reply_style" &&
      !isMetaConversationIntent(next) &&
      !hasDurablePreferenceMarker(next) &&
      !/\bi prefer\b/i.test(next));

  if (shouldStoreTemporaryDirective) {
    const directive = createEntry(next, nowMs, confidence);
    updated = {
      ...updated,
      temporary_reply_directives: pushUniqueEntry(
        updated.temporary_reply_directives,
        directive,
        4,
      ),
    };
  }

  const extractedFacts = extractProfileFacts(next, effectiveSlot);
  if (!isTemporaryReplyDirective(next)) {
    for (const extractedFact of extractedFacts) {
      if (
        (nextIntent === "profile_building" ||
          nextIntent === "mutual_getting_to_know_each_other") &&
        extractedFact.kind === "other"
      ) {
        continue;
      }
      updated = {
        ...updated,
        user_profile_facts: pushUniqueFact(
          updated.user_profile_facts,
          extractedFact,
          nowMs,
          confidence,
        ),
      };
    }
  }

  if (
    effectiveSlot === "constraints" ||
    /\b(limit|constraint|avoid|cannot|can't|don't|do not|hard limit|off limits|no public)\b/i.test(
      next,
    )
  ) {
    updated = {
      ...updated,
      constraints: createEntry(next, nowMs, confidence),
    };
  }

  if (
    effectiveSlot === "improvement_area" ||
    /\b(improve|practice|focus|struggle|consistency|follow through|discipline|routine)\b/i.test(
      next,
    )
  ) {
    updated = {
      ...updated,
      improvement_area: createEntry(next, nowMs, confidence),
    };
  }

  return updated;
}

export function traceWriteUserAnswer(
  memory: SessionMemory,
  text: string,
  nowMs: number,
  slotHint: SessionMemorySlotKey | null,
  confidence = 0.85,
): SessionMemoryWriteTrace {
  const next = normalize(text);
  if (!next) {
    return {
      memory,
      attempted: [],
      committed: [],
    };
  }

  const effectiveSlot = slotHint ?? inferSlotFromAnswer(next);
  const nextIntent = inferSessionIntentValue(next);
  const nextMode =
    inferConversationModeValue(next) ??
    (nextIntent === "profile_building" ||
    nextIntent === "mutual_getting_to_know_each_other"
      ? "profile_building"
      : nextIntent === "relational_chat"
        ? "relational_chat"
      : memory.conversation_mode?.value ?? null);

  const attempted: SessionMemoryWriteRecord[] = [
    {
      key: "last_user_answer",
      value: next,
    },
  ];

  if (nextIntent) {
    attempted.push({
      key: "session_intent",
      value: nextIntent,
    });
  }

  if (nextMode) {
    attempted.push({
      key: "conversation_mode",
      value: nextMode,
    });
  }

  const shouldStoreTemporaryDirective =
    (!isMetaConversationIntent(next) && isTemporaryReplyDirective(next)) ||
    (effectiveSlot === "reply_style" &&
      !isMetaConversationIntent(next) &&
      !hasDurablePreferenceMarker(next) &&
      !/\bi prefer\b/i.test(next));
  if (shouldStoreTemporaryDirective) {
    attempted.push({
      key: "temporary_reply_directives",
      value: next,
    });
  }

  if (!isTemporaryReplyDirective(next)) {
    for (const fact of extractProfileFacts(next, effectiveSlot)) {
      attempted.push({
        key: "user_profile_facts",
        value: fact.value,
        kind: fact.kind,
        category: fact.category,
      });
    }
  }

  if (
    effectiveSlot === "constraints" ||
    /\b(limit|constraint|avoid|cannot|can't|don't|do not|hard limit|off limits|no public)\b/i.test(
      next,
    )
  ) {
    attempted.push({
      key: "constraints",
      value: next,
    });
  }

  if (
    effectiveSlot === "improvement_area" ||
    /\b(improve|practice|focus|struggle|consistency|follow through|discipline|routine)\b/i.test(
      next,
    )
  ) {
    attempted.push({
      key: "improvement_area",
      value: next,
    });
  }

  const updatedMemory = writeUserAnswer(memory, text, nowMs, slotHint, confidence);
  return {
    memory: updatedMemory,
    attempted,
    committed: describeSessionMemoryWrites(memory, updatedMemory),
  };
}

export function writeVerifiedResult(
  memory: SessionMemory,
  summary: string,
  nowMs: number,
  confidence: number,
): SessionMemory {
  const next = normalize(summary);
  if (!next) {
    return memory;
  }
  return {
    ...memory,
    last_verified_result_summary: createEntry(next, nowMs, confidence),
  };
}

export function getSessionMemoryFocus(memory: SessionMemory): string | null {
  const intent = memory.session_intent?.value ?? "";
  if (
    intent &&
    intent !== "profile_building" &&
    intent !== "mutual_getting_to_know_each_other" &&
    intent !== "task_request" &&
    intent !== "game"
  ) {
    return intent;
  }
  if (memory.improvement_area?.value) {
    return memory.improvement_area.value;
  }
  const fact =
    memory.user_profile_facts.find((entry) => entry.kind === "hobby") ??
    memory.user_profile_facts.find((entry) => entry.kind === "interest") ??
    memory.user_profile_facts[0];
  return fact?.value ?? null;
}

export function summarizeSessionMemory(memory: SessionMemory): string {
  const lines = [
    factSummaryLine(memory.user_profile_facts),
    slotSummaryLine("session_intent", memory.session_intent),
    directiveSummaryLine(memory.temporary_reply_directives),
    slotSummaryLine("last_user_question", memory.last_user_question),
    slotSummaryLine("last_user_answer", memory.last_user_answer),
    slotSummaryLine("conversation_mode", memory.conversation_mode),
    slotSummaryLine("constraints", memory.constraints),
    slotSummaryLine("improvement_area", memory.improvement_area),
    slotSummaryLine("last_verified_result_summary", memory.last_verified_result_summary),
  ].filter((line): line is string => Boolean(line));

  if (!lines.length) {
    return "- none";
  }

  return lines.join("\n");
}

function summarizeFactCategory(memory: SessionMemory, category: UserProfileFactCategory): string[] {
  return memory.user_profile_facts
    .filter((fact) => fact.category === category)
    .map((fact) => fact.value);
}

export function buildProfileMemorySummaryReply(memory: SessionMemory): string {
  const names = summarizeFactCategory(memory, "preferred_labels_or_names");
  const hobbies = summarizeFactCategory(memory, "hobbies_interests");
  const communication = summarizeFactCategory(memory, "communication_preferences");
  const relationship = summarizeFactCategory(memory, "relationship_preferences");
  const dislikes = summarizeFactCategory(memory, "dislikes");
  const limits = summarizeFactCategory(memory, "constraints");
  const parts = [
    names.length ? `name: ${names.join(", ")}` : "",
    hobbies.length ? `interests: ${hobbies.join(", ")}` : "",
    communication.length ? `communication: ${communication.join(", ")}` : "",
    relationship.length ? `dynamic: ${relationship.join(", ")}` : "",
    dislikes.length ? `dislikes: ${dislikes.join(", ")}` : "",
    limits.length ? `limits: ${limits.join(", ")}` : "",
    memory.improvement_area?.value ? `focus area: ${memory.improvement_area.value}` : "",
  ].filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "Not much yet. Tell me one thing about yourself you actually want me to remember.";
  }

  return `So far I have: ${parts.join(" | ")}. Give me the next useful piece when you are ready.`;
}
