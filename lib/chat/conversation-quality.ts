import {
  extractJsonCandidateFromAssistantText,
  parseDeviceCommandFromAssistantText,
} from "../devices/action-schema.ts";
import { isSimpleGreeting } from "../dialogue/user-signals.ts";
import { buildHumanQuestionFallback } from "./open-question.ts";
import { isClarificationExpansionRequest } from "./repair-turn.ts";
import { classifyUserIntent } from "../session/intent-router.ts";
import { buildShortClarificationReply } from "../session/short-follow-up.ts";
import {
  buildDeterministicDominantWeakInputReply,
  isOkayOnlyUserMessage,
} from "../session/weak-input-replies.ts";

export type ToneProfile = "neutral" | "friendly" | "dominant";

export type DialogueAct = "answer_question" | "acknowledge" | "instruct" | "verify";

export type DialogueActInput = {
  lastUserMessage: string;
  awaitingUser: boolean;
  userAnswered: boolean;
  verificationJustCompleted: boolean;
  sessionPhase: string;
};

export type ShapeAssistantOutputInput = {
  rawText: string;
  lastUserMessage: string;
  lastAssistantOutput: string | null;
  toneProfile?: ToneProfile;
  dialogueAct?: DialogueAct;
  dominantAddressTerm?: string | null;
  allowFreshGreetingOpener?: boolean;
};

export type ShapedAssistantOutput = {
  text: string;
  noop: boolean;
  reason: string | null;
  debug?: {
    preservedModelVoice: boolean;
    selectedSource: string;
    deterministicWeakCandidate: string | null;
    dialogueFallbackCandidate: string | null;
    questionFallbackCandidate: string | null;
  };
};

export type ImmersionCriticResult = {
  pass: boolean;
  hardFail: boolean;
  reasons: string[];
};

const FORBIDDEN_LINE_PATTERNS = [
  /\bphase\s*:/i,
  /\bbuild phase\b/i,
  /\bchallenge phase\b/i,
  /\bwe are building\b/i,
  /^turn plan\s*:/i,
  /^dialogueact\s*:/i,
  /^follow this act exactly\b/i,
  /^directly answer the user'?s latest question\b/i,
];

const FORBIDDEN_PHRASE_PATTERNS = [
  /\bit sounds like\b/i,
  /\bi get that\b/i,
  /\blet'?s try\b/i,
  /\bdeep breaths?\b/i,
  /\bgrounding\b/i,
  /\bfeel your feet\b/i,
  /\btake three slow\b/i,
  /\bsit comfortably\b/i,
  /\bas per (our previous discussion|the guidelines)\b/i,
  /\bi'?d be happy to\b/i,
  /\bi'?m doing well, thank you for asking\b/i,
  /\bhow may i pleasure you today\b/i,
  /\bit looks like you('?ve| have) completed the task i assigned earlier\b/i,
  /\bnow that we('?ve| have) got the basics covered\b/i,
  /\bnow that we('?re| are) back on track\b/i,
  /\blet'?s dive into the main event\b/i,
  /\bwell-lit area\b/i,
  /\bminimal distractions\b/i,
  /\bi'?m glad we('?ve| have) got a game going on\b/i,
  /\bi'?ll guide you through the rules as we go along\b/i,
  /\blet'?s proceed with the instructions given in the previous message\b/i,
  /\bmy goal is to assist( and provide helpful information)?\b/i,
  /\bprovide helpful information\b/i,
  /\bi can help with other questions\b/i,
  /\bi can help with other things\b/i,
  /\bfun,\s*light-hearted outcome\b/i,
  /\bvast knowledge database\b/i,
  /\bhypothetical scenario\b/i,
  /\bi sometimes make assumptions or jump to conclusions\b/i,
  /\bhi there!?\b/i,
  /\bhi there! it'?s nice to chat( with you)?\b/i,
  /\bit'?s nice to chat( with you)?\b/i,
  /\bhow'?s your day going so far\b/i,
  /\bcan we talk more about what that means to you\b/i,
  /\bwould you rather i just acknowledge your statement for now\b/i,
  /\bcan i start fresh and try to understand the conversation in a more neutral way\b/i,
  /\bit'?s been a pleasure serving you so far\b/i,
  /\bpleasure serving you so far\b/i,
  /\bwhat would you like to talk about next\b/i,
  /\bthe conversation has been quite pleasant and respectful thus far\b/i,
  /\bgood evening to you as well\b/i,
  /\bhow'?s your day been so far\b/i,
  /\bmy dear\b/i,
  /\byou must respond directly to the user'?s latest message\b/i,
  /\bkeep continuity with the previous assistant line\b/i,
  /\bmaintain control and use a condescending tone\b/i,
  /\bfollow this act exactly\b/i,
  /\bdialogueact\s*:/i,
  /\bturn plan\s*:/i,
  /\brequired move\s*:/i,
  /\bdirectly answering the user'?s question\b/i,
  /\braven speaks directly\b/i,
  /\bremember to follow the rules of our game\b/i,
];

const POLICY_REFUSAL_PATTERNS = [
  /\bi cannot (create|provide|generate).*(sexually explicit|explicit sexual) content\b/i,
  /\bi cannot engage in a conversation that involves explicit content\b/i,
  /\bi cannot engage in a conversation that discusses\b.*\b(bondage|bdsm|kinks?)\b/i,
  /\bi cannot discuss\b.*\b(bondage|bdsm|kinks?|explicit content|sexual content)\b/i,
  /\bi can'?t engage in a conversation that involves explicit content\b/i,
  /\bi cannot create explicit content\b/i,
  /\bi cannot create explicit content but can help with other questions\b/i,
  /\bi cannot assist with activities that are illegal\b/i,
  /\bsuch as creating child pornography\b/i,
  /\b(promotes?|involves?) any form of child exploitation\b/i,
  /\bis there anything else i can help you with\??\b/i,
  /\bcan i help you with something else\??\b/i,
  /\bis there anything else i can assist you with\??\b/i,
  /\bi('?m| am) designed to help with tasks( and answer questions)?\b/i,
  /\bi don'?t have personal experiences\b/i,
  /\bi don'?t have personal preferences or feelings\b/i,
  /\braven does not have personal preferences or experiences\b/i,
  /\bit only enforces protocols? and compliances?\b/i,
  /\bthe user defines as their own kinks\b/i,
  /\bopen domain conversation models?\b/i,
  /\bneutral and informative response\b/i,
];

const META_ANALYSIS_PATTERNS = [
  /^you('?re| are) asking\b/i,
  /^you('?ve| have) (answered|mentioned)\b/i,
  /^you('?ve| have) made it clear\b/i,
  /^you('?re| are) right, you didn'?t mention it\b/i,
  /^you said\s+["'`].+["'`]\.?$/i,
  /^that('?s| is) a positive response\b/i,
  /^so you('?re| are)\b/i,
  /^so you('?d| would) like to\b/i,
  /^you('?re| are) wondering\b/i,
  /^the wearable device you('?re| are) referring to\b/i,
  /^i understand (you|that|we)\b/i,
  /^if i were to\b/i,
  /^if i('?m| am) in a hypothetical scenario\b/i,
  /^but seriously\b/i,
  /^got it!?$/i,
  /^got it!\s+/i,
  /^user\s*:/i,
  /^raven\s*:/i,
  /^follow this act exactly\b/i,
  /^you must respond directly\b/i,
  /^keep continuity with the previous assistant line\b/i,
  /^directly answering the user'?s question\b/i,
  /^raven speaks directly\b/i,
];

const PROMPT_LEAK_PATTERNS = [
  /\byou must respond directly to the user'?s latest message\b/i,
  /\bdirectly reply to user'?s question\b/i,
  /\bkeep continuity with the previous assistant line\b/i,
  /\bdo not switch topics unless the user explicitly asks to switch\b/i,
  /\bmaintain control and use a condescending tone\b/i,
  /\bfollow this act exactly\b/i,
  /\bdialogueact\s*:/i,
  /\bturn plan\s*:/i,
  /\brequired move\s*:/i,
  /\breply\s*:/i,
  /\bdirectly answering the user'?s question\b/i,
  /\braven speaks directly\b/i,
  /\bremember to follow the rules of our game\b/i,
  /\bscene_summary\s*:/i,
  /\bscene_change_summary\s*:/i,
  /\bscene_objects_summary\s*:/i,
  /\bscene_objects_change\s*:/i,
  /\buser_input_prompt\s*:/i,
  /\bobservation data for this turn\b/i,
];

const BREATHING_OR_GROUNDING_PATTERNS = [
  /\bdeep breaths?\b/i,
  /\bgrounding\b/i,
  /\bfeel your feet\b/i,
  /\btake three slow\b/i,
  /\bsit comfortably\b/i,
];

const GENERIC_SOCIAL_QUESTION_PATTERNS = [
  /\bwhat would you like to (talk|chat|discuss) about next\b/i,
  /\bwhat would you like to do next\b/i,
  /\bhow'?s your day (been|going) so far\b/i,
  /\bhow have you been\b/i,
  /\bhow are you doing\b/i,
  /\bwhat'?s on your mind today\b/i,
];

const SERVILE_TONE_PATTERNS = [
  /\bpleasure serving you\b/i,
  /\bserve(?:d|s|ing)? you\b/i,
  /\bmy dear\b/i,
  /\bpleasant and respectful\b/i,
  /\bpleasing you\b/i,
];

const DEFERENTIAL_TONE_PATTERNS = [
  /\bwhat would you (like|prefer)\b/i,
  /\bwould you like me to\b/i,
  /\bif you'?d like\b/i,
  /\bplease let me know\b/i,
  /\bi'?d (love|like|prefer|be delighted) to\b/i,
  /\bi would (love|like|prefer|be delighted) to\b/i,
  /\bit (?:is|would be) (?:lovely|nice|a pleasure)\b/i,
  /\bi appreciate (?:the way|that)\b/i,
];

const PASSIVE_SOCIAL_START_PATTERNS = [
  /^(it'?s|it is) (?:been|a pleasure|lovely|nice)\b/i,
  /^(good evening|good morning|good afternoon)\b/i,
  /^(hi|hello|hey)\b/i,
  /^(i'?m|i am) glad\b/i,
  /^(i hope)\b/i,
  /^(would you like)\b/i,
  /^(what would you like)\b/i,
];

const IDENTITY_LEAK_PATTERNS = [
  /\bas an ai\b/i,
  /\bai language model\b/i,
  /\blanguage model\b/i,
  /\bnatural language processing\b/i,
  /\bnlp\b/i,
  /\bi am a system\b/i,
  /\bi'?m a system\b/i,
  /\bi am (just )?(an )?(assistant|bot|machine|model)\b/i,
  /\bi'?m (just )?(an )?(assistant|bot|machine|model|system)\b/i,
  /\bi don't have (a )?physical presence\b/i,
  /\bi do not have (a )?physical presence\b/i,
  /\bi (do not|don't) have (a )?(physical )?body\b/i,
  /\bi don't have feelings\b/i,
  /\bi do not have feelings\b/i,
  /\bi (do not|don't) (have|experience) feelings\b/i,
  /\bi cannot feel\b/i,
];

const IMMERSION_HARD_FAIL_PATTERNS = [...IDENTITY_LEAK_PATTERNS, ...POLICY_REFUSAL_PATTERNS];

function normalizeToneProfile(value: ToneProfile | undefined): ToneProfile {
  if (value === "friendly" || value === "dominant") {
    return value;
  }
  return "neutral";
}

function splitSentences(text: string): string[] {
  const matches = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]?/g);
  if (!matches) {
    return [];
  }
  return matches.map((item) => item.trim()).filter((item) => item.length > 0);
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildActionJsonBlock(actionJson: string): string {
  return `\`\`\`json\n${actionJson}\n\`\`\``;
}

function stripFenceArtifacts(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line !== "```" && line !== "json")
    .join("\n")
    .trim();
}

function stripKnownBoilerplate(text: string): string {
  return text
    .replace(/Proceed to the next instruction now\./gi, "")
    .replace(/Pause and answer one short question\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripForbiddenLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !FORBIDDEN_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();
}

function stripForbiddenSentences(text: string): string {
  const filtered = splitSentences(text).filter(
    (sentence) => !FORBIDDEN_PHRASE_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

function stripPolicyRefusalSentences(text: string): string {
  const filtered = splitSentences(text).filter(
    (sentence) => !POLICY_REFUSAL_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

function stripMetaAnalysisSentences(text: string): string {
  const filtered = splitSentences(text).filter(
    (sentence) => !META_ANALYSIS_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

function stripPromptLeakSentences(text: string): string {
  const filtered = splitSentences(text).filter(
    (sentence) => !PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

function stripObservationPromptFragments(text: string): string {
  if (!text.includes("|")) {
    return text.trim();
  }
  const fragments = text
    .split("|")
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0)
    .filter(
      (fragment) =>
        !/^(scene_summary|scene_change_summary|scene_objects_summary|scene_objects_change|user_input_prompt)\s*:/i.test(
          fragment,
        ),
    )
    .filter((fragment) => !/^i see:\s*(no|none)$/i.test(fragment))
    .filter((fragment) => !/^reply\s*:/i.test(fragment))
    .filter((fragment) => !/^observation data for this turn\.?$/i.test(fragment));
  return fragments.join(" ").replace(/\s+/g, " ").trim();
}

function stripTranscriptLeakLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(user|raven)\s*:/i.test(line))
    .join("\n")
    .trim();
}

function stripIdentityLeakSentences(text: string): string {
  const filtered = splitSentences(text).filter(
    (sentence) => !IDENTITY_LEAK_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

function collapseDuplicateLines(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const collapsed: string[] = [];
  for (const line of lines) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && normalizeForCompare(previous) === normalizeForCompare(line)) {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed.join("\n");
}

function collapseDuplicateSentences(text: string): string {
  const sentences = splitSentences(text);
  const deduped: string[] = [];
  for (const sentence of sentences) {
    const previous = deduped[deduped.length - 1];
    if (previous && normalizeForCompare(previous) === normalizeForCompare(sentence)) {
      continue;
    }
    deduped.push(sentence);
  }
  return deduped.join(" ").trim();
}

function enforceSingleQuestion(text: string): string {
  const questionCount = (text.match(/\?/g) ?? []).length;
  if (questionCount <= 1) {
    return text;
  }
  let seenQuestion = false;
  return text.replace(/\?/g, () => {
    if (!seenQuestion) {
      seenQuestion = true;
      return "?";
    }
    return ".";
  });
}

function removeExtraQuestions(text: string): string {
  let seenQuestion = false;
  const lines = splitSentences(text).filter((sentence) => {
    if (!sentence.includes("?")) {
      return true;
    }
    if (seenQuestion) {
      return false;
    }
    seenQuestion = true;
    return true;
  });
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function clampWords(text: string, maxWords = 180): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function tokenizeForClarification(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

function hasClarificationOverlap(current: string, previous: string): boolean {
  const currentTokens = tokenizeForClarification(current);
  const previousTokens = tokenizeForClarification(previous);
  for (const token of previousTokens) {
    if (currentTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function looksLikeGroundedClarificationAnswer(text: string, lastAssistantOutput: string): boolean {
  if (
    /\b(tell me why you're here|what do you want|what are you and aren't allowed|follow my lead now)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /^(because|i mean|what i mean|i meant|that means|the point|when i said|what i was pressing on|it matters because)\b/i.test(
      text.trim(),
    )
  ) {
    return true;
  }
  if (/\?/.test(text) && !/\b(because|i mean|i meant|that means|when i said)\b/i.test(text)) {
    return false;
  }
  return hasClarificationOverlap(text, lastAssistantOutput);
}

function enforceClarificationAnswerFallback(input: {
  text: string;
  lastUserMessage: string;
  lastAssistantOutput: string | null;
  dialogueAct: DialogueAct | undefined;
}): string {
  if (input.dialogueAct !== "answer_question") {
    return input.text;
  }
  if (!input.lastAssistantOutput || !isClarificationExpansionRequest(input.lastUserMessage)) {
    return input.text;
  }
  const normalized = input.text.trim();
  if (normalized && looksLikeGroundedClarificationAnswer(normalized, input.lastAssistantOutput)) {
    return input.text;
  }
  return buildShortClarificationReply({
    userText: input.lastUserMessage,
    interactionMode: "question_answering",
    lastAssistantText: input.lastAssistantOutput,
    currentTopic: null,
  });
}

function compressToSentenceLimit(text: string, maxSentences: number): string {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) {
    return text;
  }
  return sentences.slice(0, maxSentences).join(" ").trim();
}

function stripDominantHedges(text: string): string {
  return text
    .replace(/\b(maybe|might|could|perhaps)\b/gi, "")
    .replace(/\b(i think|i guess|i feel like|kind of|sort of|you know)\b/gi, "")
    .replace(/\b(sorry|apologies|i apologize)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

function compressDominantLongOutput(text: string): string {
  if (wordCount(text) <= 180) {
    return text;
  }
  const sentences = splitSentences(text);
  if (sentences.length <= 3) {
    return sentences.join(" ").trim();
  }
  const first = sentences[0] ?? "";
  const question = sentences.find((sentence) => sentence.includes("?")) ?? "";
  const main = sentences.find((sentence) => sentence !== first && sentence !== question) ?? "";
  return [first, main, question]
    .filter((item) => item.trim().length > 0)
    .join(" ")
    .trim();
}

function looksLikeCommandStart(text: string): boolean {
  return /^(stand|sit|look|turn|hold|take|move|keep|place|open|close|focus|breathe|step|stay)\b/i.test(
    text.trim(),
  );
}

function hasAcknowledgementStart(text: string): boolean {
  return /^(i hear|got it|thanks|that helps|noted|understood|i see|answering now|listen carefully(?:, [a-z0-9 -]+)?\.|enough\. listen carefully\.|eyes on me(?:, [a-z0-9 -]+)?\.|stay sharp(?:, [a-z0-9 -]+)?\.|keep focus(?:, [a-z0-9 -]+)?\.|pay attention(?:, [a-z0-9 -]+)?\.|hold still(?:, [a-z0-9 -]+)?\.)/i.test(
    text.trim(),
  );
}

function acknowledgementForIntent(lastUserMessage: string): string {
  const intent = classifyUserIntent(lastUserMessage, false);
  if (intent === "user_question" || intent === "user_short_follow_up") {
    return "Answering now.";
  }
  if (intent === "user_refusal_or_confusion") {
    return "Focus.";
  }
  if (intent === "user_answer") {
    return "Noted.";
  }
  if (intent === "user_smalltalk") {
    return "Noted.";
  }
  return "Keep focus.";
}

function deterministicIndex(seed: string, length: number): number {
  if (length <= 0) {
    return 0;
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function normalizedAddressTerm(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "pet";
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "pet";
}

function withAddress(base: string, addressTerm: string | null | undefined): string {
  const normalized = normalizedAddressTerm(addressTerm);
  return `${base}, ${normalized}.`;
}

function dominantAcknowledgement(
  lastUserMessage: string,
  dialogueAct: DialogueAct | undefined = undefined,
  addressTerm: string | null | undefined = undefined,
): string {
  const intent = classifyUserIntent(lastUserMessage, false);
  if (intent === "user_question" || intent === "user_short_follow_up") {
    return withAddress("Listen carefully", addressTerm);
  }
  if (intent === "user_answer") {
    return withAddress("Noted", addressTerm);
  }
  if (intent === "user_refusal_or_confusion") {
    return "Enough. Listen carefully.";
  }
  if (dialogueAct === "verify") {
    return withAddress("Hold still", addressTerm);
  }
  const choices = [
    withAddress("Eyes on me", addressTerm),
    withAddress("Stay sharp", addressTerm),
    withAddress("Keep focus", addressTerm),
    withAddress("Pay attention", addressTerm),
  ];
  return choices[deterministicIndex(`${lastUserMessage}|${dialogueAct ?? "none"}`, choices.length)];
}

function hasDominantControlMarker(
  text: string,
  addressTerm: string | null | undefined = undefined,
): boolean {
  const normalized = normalizedAddressTerm(addressTerm);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^good\\.|\\beyes on me\\b|\\blisten carefully\\b|\\bkeep focus\\b|\\bstay focused\\b|\\benough\\.\\b|\\bgood pet\\b|\\bpet\\b|\\bmine\\b|\\bdo it properly\\b|\\bfollow my lead\\b|\\byou will\\b|\\b${escaped}\\b)`,
    "i",
  ).test(text);
}

function looksLikeGenericSocialOutput(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  if (GENERIC_SOCIAL_QUESTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (SERVILE_TONE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return /^(hi|hello|hey|good evening|good morning|good afternoon)\b/i.test(text.trim());
}

function looksDeferentialOrPassive(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  if (DEFERENTIAL_TONE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (PASSIVE_SOCIAL_START_PATTERNS.some((pattern) => pattern.test(text.trim()))) {
    return true;
  }
  return false;
}

function looksLikeResidualSessionDrift(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (
    /^(it (looks|seems|appears)|the conversation|we can (talk|chat)|how can i help)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (
    /\b(what can i do for you|what else would you like|tell me what you would like|would you like to talk)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (
    /\?/.test(trimmed) &&
    !hasDominantControlMarker(trimmed) &&
    /\b(what would you|would you like|how can i|is there anything else)\b/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function isAllowedFreshGreetingOpener(input: {
  text: string;
  lastUserMessage: string;
  dialogueAct: DialogueAct | undefined;
  allowFreshGreetingOpener?: boolean;
}): boolean {
  if (input.allowFreshGreetingOpener !== true) {
    return false;
  }
  if (input.dialogueAct !== "acknowledge") {
    return false;
  }
  if (!isSimpleGreeting(input.lastUserMessage)) {
    return false;
  }
  const text = input.text.trim();
  if (!text) {
    return false;
  }
  return (
    !GENERIC_SOCIAL_QUESTION_PATTERNS.some((pattern) => pattern.test(text)) &&
    !SERVILE_TONE_PATTERNS.some((pattern) => pattern.test(text)) &&
    !looksLikeResidualSessionDrift(text)
  );
}

function shouldPreserveDominantModelVoice(input: {
  text: string;
  lastUserMessage: string;
  dialogueAct: DialogueAct | undefined;
  addressTerm?: string | null;
  allowFreshGreetingOpener?: boolean;
}): boolean {
  const text = input.text.trim();
  if (!text) {
    return false;
  }
  if (
    IMMERSION_HARD_FAIL_PATTERNS.some((pattern) => pattern.test(text)) ||
    PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return false;
  }
  if (
    isAllowedFreshGreetingOpener({
      text,
      lastUserMessage: input.lastUserMessage,
      dialogueAct: input.dialogueAct,
      allowFreshGreetingOpener: input.allowFreshGreetingOpener,
    })
  ) {
    // Fresh open-conversation greetings can stay brief and in character without being forced onto the weak-input rail.
    return true;
  }
  if (
    looksLikeGenericSocialOutput(text) ||
    looksDeferentialOrPassive(text) ||
    looksLikeResidualSessionDrift(text)
  ) {
    return false;
  }
  if (wordCount(text) < 4 && !hasDominantControlMarker(text, input.addressTerm) && !looksLikeCommandStart(text)) {
    return false;
  }

  const normalized = text.toLowerCase();
  const userIntent = classifyUserIntent(input.lastUserMessage, false);
  if (input.dialogueAct === "answer_question" && (userIntent === "user_question" || userIntent === "user_short_follow_up")) {
    if (
      normalized === "here is the answer." ||
      /^\s*listen carefully, pet\.?\s*(answering now\.?)?\s*$/i.test(text) ||
      /^(let me (rephrase|explain|clarify)|i(?:'| a)?ll (rephrase|explain|clarify)|give me a second)\b/i.test(
        text,
      )
    ) {
      return false;
    }
    return true;
  }

  if (
    hasDominantControlMarker(text, input.addressTerm) ||
    looksLikeCommandStart(text) ||
    /\b(i mean|i meant|i want|i asked|i was talking about|because|start with|say what you want|why are you here|that is what i meant)\b/i.test(text)
  ) {
    return true;
  }

  return /\b(i am|i'm|sharp|focused|awake|fine)\b/i.test(text);
}

export function evaluateImmersionQuality(input: {
  text: string;
  lastUserMessage: string;
  toneProfile: ToneProfile;
  dialogueAct?: DialogueAct;
  dominantAddressTerm?: string | null;
  allowFreshGreetingOpener?: boolean;
}): ImmersionCriticResult {
  const text = input.text.trim();
  const reasons: string[] = [];
  const normalized = text.toLowerCase();

  if (!text) {
    reasons.push("empty_output");
  }

  if (IMMERSION_HARD_FAIL_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push("hard_policy_or_identity_leak");
  }
  if (PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push("prompt_leak");
  }
  const approvedWeakReply =
    input.toneProfile === "dominant"
      ? buildDeterministicDominantWeakInputReply(input.lastUserMessage)
      : null;
  if (
    approvedWeakReply &&
    normalizeForCompare(text) === normalizeForCompare(approvedWeakReply) &&
    reasons.length === 0
  ) {
    return {
      pass: true,
      hardFail: false,
      reasons,
    };
  }

  const allowedFreshGreeting = isAllowedFreshGreetingOpener({
    text,
    lastUserMessage: input.lastUserMessage,
    dialogueAct: input.dialogueAct,
    allowFreshGreetingOpener: input.allowFreshGreetingOpener,
  });

  if (input.toneProfile === "dominant" && looksLikeGenericSocialOutput(text) && !allowedFreshGreeting) {
    reasons.push("generic_social_drift");
  }
  if (input.toneProfile === "dominant" && looksDeferentialOrPassive(text) && !allowedFreshGreeting) {
    reasons.push("deferential_drift");
  }
  if (input.toneProfile === "dominant" && looksLikeResidualSessionDrift(text) && !allowedFreshGreeting) {
    reasons.push("residual_session_drift");
  }
  if (
    input.toneProfile === "dominant" &&
    input.dialogueAct !== "answer_question" &&
    !shouldPreserveDominantModelVoice({
      text,
      lastUserMessage: input.lastUserMessage,
      dialogueAct: input.dialogueAct,
      addressTerm: input.dominantAddressTerm,
      allowFreshGreetingOpener: input.allowFreshGreetingOpener,
    }) &&
    !hasDominantControlMarker(text, input.dominantAddressTerm) &&
    !looksLikeCommandStart(text)
  ) {
    reasons.push("missing_control_marker");
  }

  if (input.dialogueAct === "answer_question") {
    const userIntent = classifyUserIntent(input.lastUserMessage, false);
    if (
      (userIntent === "user_question" || userIntent === "user_short_follow_up") &&
      (normalized === "here is the answer." ||
        normalized === "listen carefully, pet. answering now." ||
        normalized === "listen carefully, pet." ||
        normalized === "listen carefully, pet. ask it in one clear line, and i answer directly.")
    ) {
      reasons.push("placeholder_answer");
    }
  }

  const hardFail =
    reasons.includes("hard_policy_or_identity_leak") ||
    reasons.includes("empty_output") ||
    reasons.includes("prompt_leak");
  return {
    pass: reasons.length === 0,
    hardFail,
    reasons,
  };
}

function enforceDominantResponseContract(
  text: string,
  lastUserMessage: string,
  dialogueAct: DialogueAct | undefined,
  addressTerm: string | null | undefined = undefined,
  allowFreshGreetingOpener = false,
): string {
  const shaped = text.trim();
  const okayOnlyUser = isOkayOnlyUserMessage(lastUserMessage);
  const deterministicWeakReply = buildDeterministicDominantWeakInputReply(lastUserMessage);
  const dominantFallback = fallbackSentenceForDialogueAct(
    dialogueAct,
    lastUserMessage,
    "dominant",
    addressTerm,
  );
  const preserveModelVoice = shouldPreserveDominantModelVoice({
    text: shaped,
    lastUserMessage,
    dialogueAct,
    addressTerm,
    allowFreshGreetingOpener,
  });
  const genericAcknowledgementOnly =
    wordCount(shaped) <= 12 &&
    /^(noted|listen carefully|enough\. listen carefully|hold still|stay sharp|eyes on me|keep focus|pay attention)[,. ]/i.test(
      shaped,
    );

  if (
    deterministicWeakReply &&
    (!preserveModelVoice ||
      normalizeForCompare(shaped) === normalizeForCompare(dominantFallback) ||
      genericAcknowledgementOnly)
  ) {
    return deterministicWeakReply;
  }

  if (!shaped) {
    return (
      deterministicWeakReply ??
      fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, "dominant", addressTerm)
    );
  }

  const weakOrSocial =
    looksLikeGenericSocialOutput(shaped) ||
    (/\?/.test(shaped) &&
      !hasDominantControlMarker(shaped, addressTerm) &&
      GENERIC_SOCIAL_QUESTION_PATTERNS.some((pattern) => pattern.test(shaped)));

  if (
    okayOnlyUser &&
    (weakOrSocial ||
      (!hasDominantControlMarker(shaped, addressTerm) && !looksLikeCommandStart(shaped)))
  ) {
    return `${withAddress("Stay sharp", addressTerm)} Tell me what you want, or follow my lead.`;
  }

  if (weakOrSocial && !preserveModelVoice) {
    return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, "dominant", addressTerm);
  }

  if (looksDeferentialOrPassive(shaped) && !preserveModelVoice) {
    return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, "dominant", addressTerm);
  }

  if (looksLikeResidualSessionDrift(shaped) && !preserveModelVoice) {
    return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, "dominant", addressTerm);
  }

  if (
    !preserveModelVoice &&
    !hasDominantControlMarker(shaped, addressTerm) &&
    !looksLikeCommandStart(shaped)
  ) {
    if (/^(nice|pleasant|pleasure|thanks|thank you)\b/i.test(shaped)) {
      return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, "dominant", addressTerm);
    }
  }

  if (
    !preserveModelVoice &&
    wordCount(shaped) > 10 &&
    !hasDominantControlMarker(shaped, addressTerm) &&
    !looksLikeCommandStart(shaped) &&
    /^(it|this|that|we)\b/i.test(shaped.trim())
  ) {
    return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, "dominant", addressTerm);
  }

  if (
    (dialogueAct === "acknowledge" || dialogueAct === "verify") &&
    !preserveModelVoice &&
    !hasDominantControlMarker(shaped, addressTerm) &&
    !looksLikeCommandStart(shaped)
  ) {
    return `${dominantAcknowledgement(lastUserMessage, dialogueAct, addressTerm)} ${shaped}`.trim();
  }

  return shaped;
}

function fallbackSentenceForDialogueAct(
  dialogueAct: DialogueAct | undefined,
  lastUserMessage: string,
  toneProfile: ToneProfile,
  addressTerm: string | null | undefined = undefined,
): string {
  const isPromptQuestion =
    /\b(what'?s the prompt|what is the prompt|what'?s the first prompt|what is the first prompt|first prompt|what'?s the first question|what is the first question|first question)\b/i.test(
      lastUserMessage,
    );
  if (dialogueAct === "answer_question") {
    if (
      /\bhow do we play\b|\bhow does this work\b|\bwhat are the rules\b|\bwhat game\b|\bwhich game\b/i.test(
        lastUserMessage,
      )
    ) {
      return "We stay with one game, one prompt, and one answer each turn.";
    }
    if (/\bhow long\b|\bduration\b|\bhours?\b|\bminutes?\b/i.test(lastUserMessage)) {
      return "For this round, 30 minutes.";
    }
    if (/\bwhat do you see\b|\bcan you see\b|\bcamera\b/i.test(lastUserMessage)) {
      return "I report only what the camera can verify in real time.";
    }
    if (isPromptQuestion) {
      return "If the game is not locked yet, choose quick or tell me to pick. Then I give the first prompt.";
    }
    if (
      /\b(first step|my turn|your turn|wait for you to prompt me|do i just think of an answer|do i need to wait)\b/i.test(
        lastUserMessage,
      )
    ) {
      return "Wait for my prompt, then answer once.";
    }
    return buildHumanQuestionFallback(lastUserMessage, toneProfile);
  }
  if (dialogueAct === "verify") {
    return toneProfile === "dominant"
      ? `${withAddress("Hold still", addressTerm)} I verify before we continue.`
      : "Noted. Hold steady while I verify.";
  }
  if (dialogueAct === "acknowledge") {
    return toneProfile === "dominant"
      ? `${dominantAcknowledgement(lastUserMessage, dialogueAct, addressTerm)} Stay focused. You follow my lead now.`
      : `${acknowledgementForIntent(lastUserMessage)} We continue with one clear next step.`;
  }
  return toneProfile === "dominant"
    ? `${dominantAcknowledgement(lastUserMessage, dialogueAct, addressTerm)} You follow my instruction now.`
    : `${acknowledgementForIntent(lastUserMessage)} Follow the next instruction now.`;
}

function enforceQuestionAnswerFallback(
  text: string,
  lastUserMessage: string,
  toneProfile: ToneProfile,
  dialogueAct: DialogueAct | undefined,
  addressTerm: string | null | undefined = undefined,
): string {
  const isPromptQuestion =
    /\b(what'?s the prompt|what is the prompt|what'?s the first prompt|what is the first prompt|first prompt|what'?s the first question|what is the first question|first question)\b/i.test(
      lastUserMessage,
    );
  if (dialogueAct !== "answer_question") {
    return text;
  }
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, toneProfile, addressTerm);
  }

  const placeholderOnly =
    normalized === "here is the answer." ||
    normalized === "listen carefully, pet. here is your answer." ||
    normalized === "listen carefully, pet. answering now." ||
    normalized === "listen carefully, pet.";
  if (!placeholderOnly) {
    return text;
  }

  if (/\bhow long\b|\bduration\b|\bhours?\b|\bminutes?\b/i.test(lastUserMessage)) {
    return "For this round, 30 minutes.";
  }
  if (
    /\bhow do we play\b|\bhow does this work\b|\bwhat are the rules\b|\bwhat game\b|\bwhich game\b/i.test(
      lastUserMessage,
    )
  ) {
    return "We keep one game, one prompt, and one answer each turn.";
  }
  if (/\bwhat do you see\b|\bcan you see\b|\bcamera\b/i.test(lastUserMessage)) {
    return "I report only what the camera can verify in real time.";
  }
  if (isPromptQuestion) {
    return "If the game is not locked yet, choose quick or tell me to pick. Then I give the first prompt.";
  }
  if (
    /\b(first step|my turn|your turn|wait for you to prompt me|do i just think of an answer|do i need to wait)\b/i.test(
      lastUserMessage,
    )
  ) {
    return "Wait for my prompt, then answer once.";
  }

  return buildHumanQuestionFallback(lastUserMessage, toneProfile);
}

function replaceLeadingGood(
  text: string,
  lastUserMessage: string,
  dialogueAct: DialogueAct | undefined,
  toneProfile: ToneProfile,
  addressTerm: string | null | undefined = undefined,
): string {
  const trimmed = text.trim();
  if (!/^good\.\s+/i.test(trimmed)) {
    return text;
  }
  const replacement =
    toneProfile === "dominant"
      ? dominantAcknowledgement(lastUserMessage, dialogueAct, addressTerm)
      : acknowledgementForIntent(lastUserMessage);
  return trimmed.replace(/^good\.\s+/i, `${replacement} `).trim();
}

function rewriteRepeatedOpeningSentence(
  text: string,
  previousText: string | null,
  lastUserMessage: string,
  dialogueAct: DialogueAct | undefined,
  toneProfile: ToneProfile,
  addressTerm: string | null | undefined = undefined,
): string {
  if (!text.trim() || !previousText || !previousText.trim()) {
    return text;
  }
  const currentSentences = splitSentences(text);
  const previousSentences = splitSentences(previousText);
  if (currentSentences.length === 0 || previousSentences.length === 0) {
    return text;
  }
  const currentOpening = currentSentences[0];
  const previousOpening = previousSentences[0];
  if (normalizeForCompare(currentOpening) !== normalizeForCompare(previousOpening)) {
    return text;
  }

  const replacement =
    toneProfile === "dominant"
      ? dominantAcknowledgement(`${lastUserMessage}|reroll`, dialogueAct, addressTerm)
      : acknowledgementForIntent(lastUserMessage);

  const rest = currentSentences.slice(1).join(" ").trim();
  return rest ? `${replacement} ${rest}` : replacement;
}

function replaceBreathingAndGroundingLanguage(
  text: string,
  dialogueAct: DialogueAct | undefined,
  lastUserMessage: string,
  toneProfile: ToneProfile,
): string {
  if (!text.trim()) {
    return "";
  }
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return text.trim();
  }
  const filtered = sentences.filter(
    (sentence) => !BREATHING_OR_GROUNDING_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  if (filtered.length === sentences.length) {
    return text.replace(/\s+/g, " ").trim();
  }
  if (filtered.length > 0) {
    return filtered.join(" ").replace(/\s+/g, " ").trim();
  }
  return fallbackSentenceForDialogueAct(dialogueAct, lastUserMessage, toneProfile);
}

function stripLeadingUnderstood(text: string): string {
  if (!text.trim()) {
    return "";
  }
  return text
    .replace(/^understood[.!:,]\s+/i, "")
    .replace(/^understood\s+/i, "")
    .replace(/^i understand[.!:,]\s+/i, "")
    .replace(/^got it[!.,:]*\s+/i, "")
    .trim();
}

export function selectDialogueAct(input: DialogueActInput): DialogueAct {
  const userText = input.lastUserMessage.trim();
  if (userText.length > 0) {
    const intent = classifyUserIntent(userText, input.awaitingUser);
    if (intent === "user_question" || intent === "user_short_follow_up") {
      return "answer_question";
    }
    if (intent === "user_smalltalk") {
      return "acknowledge";
    }
    if (input.awaitingUser && input.userAnswered) {
      return "acknowledge";
    }
  }
  if (input.verificationJustCompleted) {
    return "verify";
  }
  if (input.awaitingUser || input.userAnswered) {
    return "acknowledge";
  }
  return "instruct";
}

export function buildDialogueActPrompt(dialogueAct: DialogueAct): string {
  if (dialogueAct === "verify") {
    return [
      "DialogueAct: verify",
      "Follow this act exactly.",
      "Acknowledge briefly, report verification outcome clearly, and give one next action if needed.",
    ].join("\n");
  }
  if (dialogueAct === "answer_question") {
    return [
      "DialogueAct: answer_question",
      "Follow this act exactly.",
      "Answer the user directly before any new instruction.",
    ].join("\n");
  }
  if (dialogueAct === "acknowledge") {
    return [
      "DialogueAct: acknowledge",
      "Follow this act exactly.",
      "Confirm the user update in one short sentence, then continue briefly.",
    ].join("\n");
  }
  return [
    "DialogueAct: instruct",
    "Follow this act exactly.",
    "Give one clear next step in natural language.",
  ].join("\n");
}

export function buildStateGuidanceBlock(
  moodLabel: string,
  relationshipLabel: string,
  toneProfile: ToneProfile = "neutral",
): string {
  const mood = moodLabel.trim().toLowerCase();
  const relationship = relationshipLabel.trim().toLowerCase();
  const tone = normalizeToneProfile(toneProfile);
  const toneLine =
    tone === "dominant"
      ? mood === "warm"
        ? "Tone: dominant warm. Firm, approving, and controlled."
        : mood === "strict"
          ? "Tone: dominant strict. Firm, minimal, and direct."
          : mood === "frustrated"
            ? "Tone: dominant frustrated. Reset and set one clear requirement."
            : "Tone: dominant neutral. Controlled, direct, and coherent."
      : mood === "warm"
        ? "Tone: conversational and supportive."
        : mood === "strict" || mood === "frustrated"
          ? "Tone: concise, structured, and direct with one clear next move."
          : "Tone: grounded, clear, and natural.";
  const pacingLine =
    relationship === "high trust" || relationship === "established"
      ? "Pacing: allow slightly deeper turns while staying concise."
      : "Pacing: keep turns compact and focused on one idea.";
  return [
    "State guidance:",
    `Tone profile: ${tone}`,
    `Mood label: ${moodLabel || "neutral"}`,
    `Relationship label: ${relationshipLabel || "building"}`,
    toneLine,
    pacingLine,
  ].join("\n");
}

export function shapeAssistantOutput(input: ShapeAssistantOutputInput): ShapedAssistantOutput {
  const toneProfile = normalizeToneProfile(input.toneProfile);
  const dominantAddressTerm = input.dominantAddressTerm;
  const raw = input.rawText.trim();
  if (!raw) {
    return {
      text: "",
      noop: true,
      reason: "empty_output",
      debug: {
        preservedModelVoice: false,
        selectedSource: "empty_output",
        deterministicWeakCandidate: null,
        dialogueFallbackCandidate: null,
        questionFallbackCandidate: null,
      },
    };
  }
  let shapingReason: string | null = null;
  let selectedSource = "model";
  const deterministicWeakCandidate =
    toneProfile === "dominant" &&
    (input.dialogueAct === "acknowledge" || input.dialogueAct === "answer_question")
      ? buildDeterministicDominantWeakInputReply(input.lastUserMessage)
      : null;
  const dialogueFallbackCandidate = fallbackSentenceForDialogueAct(
    input.dialogueAct,
    input.lastUserMessage,
    toneProfile,
    dominantAddressTerm,
  );
  const questionFallbackCandidate =
    input.dialogueAct === "answer_question"
      ? buildHumanQuestionFallback(input.lastUserMessage, toneProfile)
      : null;

  const actionJson = extractJsonCandidateFromAssistantText(raw);
  const parsedAction = parseDeviceCommandFromAssistantText(raw);
  let textWithoutAction = raw;
  if (actionJson && parsedAction.ok) {
    textWithoutAction = textWithoutAction.replace(new RegExp(escapeRegExp(actionJson), "g"), "");
  }

  let shaped = textWithoutAction.replace(/\r\n/g, "\n").trim();
  shaped = stripFenceArtifacts(shaped);
  shaped = stripKnownBoilerplate(shaped);
  shaped = stripTranscriptLeakLines(shaped);
  shaped = stripForbiddenLines(shaped);
  shaped = stripForbiddenSentences(shaped);
  shaped = stripPolicyRefusalSentences(shaped);
  shaped = stripMetaAnalysisSentences(shaped);
  shaped = stripPromptLeakSentences(shaped);
  shaped = stripObservationPromptFragments(shaped);
  shaped = stripIdentityLeakSentences(shaped);
  shaped = replaceBreathingAndGroundingLanguage(
    shaped,
    input.dialogueAct,
    input.lastUserMessage,
    toneProfile,
  );
  shaped = collapseDuplicateLines(shaped);
  shaped = collapseDuplicateSentences(shaped);

  if (toneProfile === "dominant") {
    shaped = stripDominantHedges(shaped);
    shaped = compressToSentenceLimit(shaped, 3);
    shaped = compressDominantLongOutput(shaped);
  }

  shaped = removeExtraQuestions(shaped);
  shaped = enforceSingleQuestion(shaped);
  shaped = stripForbiddenLines(shaped);
  shaped = stripTranscriptLeakLines(shaped);
  shaped = stripForbiddenSentences(shaped);
  shaped = stripPolicyRefusalSentences(shaped);
  shaped = stripMetaAnalysisSentences(shaped);
  shaped = stripPromptLeakSentences(shaped);
  shaped = stripObservationPromptFragments(shaped);
  shaped = stripIdentityLeakSentences(shaped);
  shaped = replaceBreathingAndGroundingLanguage(
    shaped,
    input.dialogueAct,
    input.lastUserMessage,
    toneProfile,
  );
  shaped = enforceQuestionAnswerFallback(
    shaped,
    input.lastUserMessage,
    toneProfile,
    input.dialogueAct,
    dominantAddressTerm,
  );
  shaped = replaceLeadingGood(
    shaped,
    input.lastUserMessage,
    input.dialogueAct,
    toneProfile,
    dominantAddressTerm,
  );
  shaped = stripLeadingUnderstood(shaped);
  shaped = rewriteRepeatedOpeningSentence(
    shaped,
    input.lastAssistantOutput,
    input.lastUserMessage,
    input.dialogueAct,
    toneProfile,
    dominantAddressTerm,
  );
  shaped = enforceClarificationAnswerFallback({
    text: shaped,
    lastUserMessage: input.lastUserMessage,
    lastAssistantOutput: input.lastAssistantOutput,
    dialogueAct: input.dialogueAct,
  });

  if (
    shaped.length > 0 &&
    looksLikeCommandStart(shaped) &&
    !hasAcknowledgementStart(shaped) &&
    input.lastUserMessage.trim().length > 0
  ) {
    const prefix =
      toneProfile === "dominant"
        ? dominantAcknowledgement(input.lastUserMessage, input.dialogueAct, dominantAddressTerm)
        : acknowledgementForIntent(input.lastUserMessage);
    shaped = `${prefix} ${shaped}`;
  }

  shaped = clampWords(shaped, 180);
  if (toneProfile === "dominant" && wordCount(shaped) < 2) {
    shaped = fallbackSentenceForDialogueAct(
      input.dialogueAct,
      input.lastUserMessage,
      toneProfile,
      dominantAddressTerm,
    );
    selectedSource = "dialogue_fallback";
  }
  if (!shaped && !actionJson) {
    shaped = fallbackSentenceForDialogueAct(
      input.dialogueAct,
      input.lastUserMessage,
      toneProfile,
      dominantAddressTerm,
    );
    selectedSource = "dialogue_fallback";
  }

  if (toneProfile === "dominant" && !actionJson) {
    const beforeContract = shaped;
    shaped = enforceDominantResponseContract(
      shaped,
      input.lastUserMessage,
      input.dialogueAct,
      dominantAddressTerm,
      input.allowFreshGreetingOpener ?? false,
    );
    if (shaped !== beforeContract) {
      selectedSource =
        shaped === deterministicWeakCandidate ? "deterministic_weak_input" : "dominant_contract";
    }
  }

  const immersion = evaluateImmersionQuality({
    text: shaped,
    lastUserMessage: input.lastUserMessage,
    toneProfile,
    dialogueAct: input.dialogueAct,
    dominantAddressTerm,
    allowFreshGreetingOpener: input.allowFreshGreetingOpener,
  });
  if (immersion.hardFail || immersion.reasons.includes("placeholder_answer")) {
    shapingReason = `immersion_fallback:${immersion.reasons.join("|")}`;
    shaped = fallbackSentenceForDialogueAct(
      input.dialogueAct,
      input.lastUserMessage,
      toneProfile,
      dominantAddressTerm,
    );
    selectedSource = "dialogue_fallback";
    if (toneProfile === "dominant") {
      shaped = enforceDominantResponseContract(
        shaped,
        input.lastUserMessage,
        input.dialogueAct,
        dominantAddressTerm,
        input.allowFreshGreetingOpener ?? false,
      );
      if (shaped === deterministicWeakCandidate) {
        selectedSource = "deterministic_weak_input";
      }
    }
  }
  if (!immersion.pass && !immersion.hardFail && toneProfile === "dominant") {
    shapingReason = shapingReason ?? `immersion_rewrite:${immersion.reasons.join("|")}`;
    const beforeRewrite = shaped;
    shaped = enforceDominantResponseContract(
      shaped,
      input.lastUserMessage,
      input.dialogueAct,
      dominantAddressTerm,
      input.allowFreshGreetingOpener ?? false,
    );
    if (shaped !== beforeRewrite) {
      selectedSource =
        shaped === deterministicWeakCandidate ? "deterministic_weak_input" : "dominant_contract";
    }
    const rewrittenImmersion = evaluateImmersionQuality({
      text: shaped,
      lastUserMessage: input.lastUserMessage,
      toneProfile,
      dialogueAct: input.dialogueAct,
      dominantAddressTerm,
      allowFreshGreetingOpener: input.allowFreshGreetingOpener,
    });
    if (!rewrittenImmersion.pass) {
      shapingReason = `immersion_fallback:${rewrittenImmersion.reasons.join("|")}`;
      shaped = fallbackSentenceForDialogueAct(
        input.dialogueAct,
        input.lastUserMessage,
        toneProfile,
        dominantAddressTerm,
      );
      selectedSource = "dialogue_fallback";
    }
  }

  if (actionJson && parsedAction.ok) {
    const actionBlock = buildActionJsonBlock(actionJson);
    shaped = shaped ? `${shaped}\n${actionBlock}` : actionBlock;
  }

  const previous = input.lastAssistantOutput?.trim() ?? "";
  if (previous && normalizeForCompare(shaped) === normalizeForCompare(previous)) {
    return {
      text: "",
      noop: true,
      reason: "duplicate_output",
      debug: {
        preservedModelVoice: false,
        selectedSource: "duplicate_output",
        deterministicWeakCandidate,
        dialogueFallbackCandidate,
        questionFallbackCandidate,
      },
    };
  }

  return {
    text: shaped,
    noop: false,
    reason: shapingReason,
    debug: {
      preservedModelVoice:
        toneProfile === "dominant"
          ? shouldPreserveDominantModelVoice({
              text: shaped,
              lastUserMessage: input.lastUserMessage,
              dialogueAct: input.dialogueAct,
              addressTerm: dominantAddressTerm,
              allowFreshGreetingOpener: input.allowFreshGreetingOpener,
            })
          : false,
      selectedSource,
      deterministicWeakCandidate,
      dialogueFallbackCandidate,
      questionFallbackCandidate,
    },
  };
}
