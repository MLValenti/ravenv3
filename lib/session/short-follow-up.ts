import { buildCoreConversationReply } from "../chat/core-turn-move.ts";
import {
  detectRepairTurnKind,
  resolveRepairTurn,
} from "../chat/repair-turn.ts";

type ShortFollowUpMode =
  | "normal_chat"
  | "question_answering"
  | "profile_building"
  | "relational_chat"
  | "task_planning"
  | "task_execution"
  | "locked_task_execution"
  | "game";

type ShortFollowUpTopic =
  | "none"
  | "general_request"
  | "game_setup"
  | "game_execution"
  | "reward_window"
  | "reward_negotiation"
  | "task_negotiation"
  | "task_execution"
  | "duration_negotiation"
  | "task_terms_negotiation"
  | "verification_in_progress";

export type ShortFollowUpKind =
  | "what"
  | "why"
  | "how"
  | "go_on"
  | "clarify"
  | "repeat";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[!?.,]+$/g, "");
}

const WEAK_CONTEXT_TOKENS = new Set([
  "actual",
  "actually",
  "about",
  "after",
  "again",
  "also",
  "because",
  "being",
  "change",
  "changes",
  "decorative",
  "from",
  "good",
  "going",
  "have",
  "happen",
  "happened",
  "happens",
  "happening",
  "image",
  "inside",
  "just",
  "keep",
  "like",
  "matter",
  "matters",
  "mean",
  "part",
  "people",
  "point",
  "real",
  "really",
  "same",
  "say",
  "saying",
  "should",
  "speaking",
  "start",
  "starts",
  "stay",
  "that",
  "there",
  "tell",
  "this",
  "directly",
  "first",
  "thread",
  "use",
  "used",
  "using",
  "usually",
  "when",
  "would",
  "could",
  "should",
  "makes",
  "sounds",
  "what",
  "with",
  "wording",
]);

function cleanContextFragment(fragment: string | null | undefined): string | null {
  if (!fragment) {
    return null;
  }
  const cleaned = normalize(fragment)
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return null;
  }
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !WEAK_CONTEXT_TOKENS.has(token));
  if (tokens.length === 0) {
    return null;
  }
  return tokens.slice(0, 3).join(" ");
}

function extractContextPhrase(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const patterns = [
    /\bstay with\s+([^.!?,:;]{3,60})/i,
    /\bpart about\s+([^.!?,:;]{3,60})/i,
    /\btalk about\s+([^.!?,:;]{3,60})/i,
    /\bstart with\s+([^.!?,:;]{3,60})/i,
    /\bthe part people usually miss is\s+([^.!?,:;]{3,60})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const fragment = cleanContextFragment(match?.[1]);
    if (fragment) {
      return fragment;
    }
  }
  return null;
}

function rewriteClarificationClause(fragment: string): string | null {
  const cleaned = normalize(fragment)
    .replace(/^[,.:;-\s]+/, "")
    .replace(/[.?!,:;]+$/g, "")
    .replace(/^one thing\s+/i, "what ")
    .replace(/^something\s+/i, "what ")
    .replace(/^the exact live point you want answered\b/i, "what you actually want answered")
    .replace(/^the exact point you want answered\b/i, "what you actually want answered")
    .replace(/^what i can do for you\b/i, "what you can do for me")
    .replace(/^being trained by me\b/i, "being trained by me in a way that actually changes you")
    .replace(/\s+and i will keep it in mind\b/i, "")
    .replace(/^how i can (be useful|help|please|serve|entertain) you\b/i, "how you could actually $1 me")
    .replace(/[.?!,:;]+$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  const strong = cleanContextFragment(cleaned);
  if (!strong && !/^(what|how|whether)\b/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function extractSemanticClarificationClause(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const patterns = [
    /\btell me\s+([^.!?]{3,120})/i,
    /\bwhat interests me is\s+([^.!?]{3,140})/i,
    /\bwhat matters next is\s+([^.!?]{3,140})/i,
    /\bi want to talk about\s+([^.!?]{3,140})/i,
    /\bthe part people usually miss is\s+([^.!?]{3,140})/i,
    /\bthe interesting part is\s+([^.!?]{3,140})/i,
    /\bwhat people usually miss about you\b/i,
    /\bbeing trained by me\b/i,
    /\bstructure instead of play\b/i,
    /\bconsistency, honesty, and follow[- ]through\b/i,
    /\bwhat i can do for you\b/i,
    /\bhow i can (?:be useful|help|please|serve|entertain) you\b/i,
    /\bbondage when it actually changes the dynamic\b/i,
    /\bi like bondage\b/i,
    /\bobedience when it has nerve in it\b/i,
    /\bi like obedience\b/i,
    /\bi like toys when they sharpen the dynamic\b/i,
    /\bi like dildos and plugs\b/i,
    /\bi like service when it is real enough to lighten my hand\b/i,
    /\bi like control when it has intention behind it\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const clause = rewriteClarificationClause(match[1] ?? match[0]);
    if (clause) {
      return clause;
    }
  }
  return null;
}

function extractContextToken(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const normalizedText = normalize(text);
  if (
    /\btell me (?:what|where|which|how|whether)\b/i.test(normalizedText) ||
    /\bwhat (?:would|should|do|does|did|is|are)\b/i.test(normalizedText)
  ) {
    return null;
  }
  const phrase = extractContextPhrase(text);
  if (phrase) {
    return phrase;
  }
  const stop = new Set([
    "what",
    "why",
    "how",
    "when",
    "where",
    "who",
    "which",
    "tell",
    "about",
    "yourself",
    "mean",
    "this",
    "that",
    "there",
    "here",
    "have",
    "with",
    "does",
    "just",
    "stay",
    "decorative",
    "starts",
    "start",
    "point",
    "part",
    "image",
    "people",
    "inside",
    "good",
    "would",
    "could",
    "should",
    "makes",
    "sounds",
    "should",
    "speaking",
    "directly",
    "land",
  ]);
  const tokens = normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stop.has(token));
  return tokens[0] ?? null;
}

function buildQuestionClarificationLead(text: string | null | undefined): string | null {
  const normalized = normalize(text ?? "");
  if (!normalized) {
    return null;
  }
  const semanticClause = extractSemanticClarificationClause(text);
  if (semanticClause) {
    return `I mean ${semanticClause}`;
  }
  if (/\bwhat should i call you\b/i.test(normalized)) {
    return "I mean the name you want me to use when I am speaking to you directly";
  }
  if (/\bi mean the name you want me to use when i am speaking to you directly\b/i.test(normalized)) {
    return "I mean the name you want me to use when I am speaking to you directly";
  }
  if (/\btell me one thing people usually miss about you\b/i.test(normalized)) {
    return "I mean the part about you that people usually miss";
  }
  if (/\bwhat people usually miss about you\b/i.test(normalized)) {
    return "I mean what people usually miss about you";
  }
  if (/\bbeing trained by me\b/i.test(normalized)) {
    return "I mean being trained by me in a way that actually changes you";
  }
  if (/\bbeing owned by me\b/i.test(normalized) || /\bowned by me\b/i.test(normalized)) {
    return "I mean what being owned by me would actually ask of you";
  }
  if (/\bbondage when it actually changes the dynamic\b/i.test(normalized) || /\bi like bondage\b/i.test(normalized)) {
    return "I mean what bondage changes once it stops being decorative";
  }
  if (/\bobedience when it has nerve in it\b/i.test(normalized) || /\bi like obedience\b/i.test(normalized)) {
    return "I mean what obedience would actually ask of you";
  }
  if (/\bi like service when it is real enough to lighten my hand\b/i.test(normalized) || /\bwhat kind of service do you actually imagine\b/i.test(normalized)) {
    return "I mean what real service from you would actually look like";
  }
  if (/\bi like control when it has intention behind it\b/i.test(normalized)) {
    return "I mean what control changes once it stops being theater";
  }
  if (/\bi like toys when they sharpen the dynamic\b/i.test(normalized)) {
    return "I mean how toys sharpen the dynamic instead of replacing it";
  }
  if (/\bi like dildos and plugs\b/i.test(normalized)) {
    return "I mean how you would actually want to use that toy";
  }
  if (/\bwanting training is easy to say\b/i.test(normalized)) {
    return "I mean what being trained by me would actually change for you";
  }
  if (/\bletting it change you is the harder part\b/i.test(normalized)) {
    return "I mean what being trained by me would actually change for you";
  }
  if (/\bstructure instead of play\b/i.test(normalized)) {
    return "I mean structure instead of play";
  }
  if (/\bconsistency, honesty, and follow[- ]through\b/i.test(normalized)) {
    return "I mean consistency, honesty, and follow-through";
  }
  if (
    /\bhonest enough for me to see where you hold\b/i.test(normalized) ||
    /\bconsistent enough that i can actually shape something\b/i.test(normalized) ||
    /\bbe trainable\b/i.test(normalized)
  ) {
    return "I mean honesty, consistency, and trainability";
  }
  if (/\battention, follow[- ]through, honesty, and enough steadiness\b/i.test(normalized)) {
    return "I mean attention, follow-through, honesty, and steadiness";
  }
  if (/\bwhether you want attention, usefulness, or real change\b/i.test(normalized)) {
    return "I mean whether you want attention, usefulness, or real change";
  }
  if (/\bexact part of work that keeps dragging your attention\b/i.test(normalized)) {
    return "I mean the exact part of work that keeps dragging your attention";
  }
  if (/\b(?:is it\s+)?workload,\s*a person,\s*or a decision you keep circling\b/i.test(normalized)) {
    return "I mean the exact part of work that keeps dragging your attention: the amount, the person, or the choice";
  }
  if (
    /\bkeeps dragging your attention\b/i.test(normalized) &&
    /\b(?:amount|workload|person|choice|decision)\b/i.test(normalized)
  ) {
    return "I mean the exact part of work that keeps dragging your attention";
  }
  if (
    /\bi do not usually say this out loud\b/i.test(normalized) ||
    /\btrying not to say\b/i.test(normalized)
  ) {
    return "I mean the part you were trying not to say out loud";
  }
  if (
    /\bmean what you say\b/i.test(normalized) ||
    /\bhold steady\b/i.test(normalized) ||
    /\blong enough for it to count\b/i.test(normalized)
  ) {
    return "I mean whether you mean what you say and can hold steady long enough for it to count";
  }
  if (/\bwhether i am dealing with a person or a performance\b/i.test(normalized)) {
    return "I mean whether I am dealing with a person or a performance";
  }
  if (/\busefulness is not a pose\b/i.test(normalized)) {
    return "I mean what would make you useful to me";
  }
  if (/\bwhat you can actually do for me\b/i.test(normalized)) {
    return "I mean what you can do for me";
  }
  if (/\bwhat you can do for me\b/i.test(normalized)) {
    return "I mean what you can do for me";
  }
  if (/\banswer cleanly, and follow through\b/i.test(normalized)) {
    return "I mean answering cleanly and following through long enough for it to mean something";
  }
  if (/\bwhether you answer cleanly or perform\b/i.test(normalized)) {
    return "I mean whether you answer cleanly or perform";
  }
  if (/\btell me one thing\b.*\babout you\b/i.test(normalized)) {
    return "I mean the part about you that actually matters here";
  }
  if (/\bi mean the part about you that people usually miss\b/i.test(normalized)) {
    return "I mean the part about you that people usually miss";
  }
  if (
    /\bwhat keeps my attention is the part that is real\b/i.test(normalized) ||
    /\bask me something real\b/i.test(normalized) ||
    /\bwhat do you want to know about me\b/i.test(normalized)
  ) {
    return "I mean the part that is real enough to hold my attention";
  }
  const definitionQuestion = normalized.match(/^(?:what is|what's|whats)\s+([^?.!,]{2,80})$/i)?.[1];
  if (definitionQuestion) {
    return `I mean ${definitionQuestion.trim()}`;
  }
  if (/\bhow long\b|\btime window\b|\blength\b/i.test(normalized)) {
    return "I mean the time window";
  }
  if (/\bwhat items are actually available\b|\bwhat can you actually use\b|\bwhat do you actually have\b/i.test(normalized)) {
    return "I mean which item or tool you actually have available right now";
  }
  if (/\boral use\b|\banal use\b|\bprop\b/i.test(normalized)) {
    return "I mean how that item is meant to be used here";
  }
  return null;
}

function stripClarificationLeadPrefix(text: string): string {
  return text.replace(/^I mean\s+/i, "").replace(/[.?!]+$/g, "").trim();
}

function buildWhyFollowUpReply(
  questionLead: string | null,
  contextLead: string,
): string {
  const focus = questionLead ? stripClarificationLeadPrefix(questionLead).toLowerCase() : "";
  if (/\bwhat you can do for me\b|\bwhat would make you useful to me\b/.test(focus)) {
    return "Because that tells me whether you want to offer something real or just sound eager.";
  }
  if (/\bbeing trained by me\b/.test(focus)) {
    return "Because wanting training is easy to say. What matters is what you think it would actually ask of you.";
  }
  if (/\bwhat being owned by me would actually ask of you\b/.test(focus)) {
    return "Because being owned only means something if it would actually cost you comfort, control, or excuses.";
  }
  if (/\bwhat bondage changes once it stops being decorative\b/.test(focus)) {
    return "Because bondage only interests me when it changes the dynamic instead of just decorating it.";
  }
  if (/\bwhat obedience would actually ask of you\b/.test(focus)) {
    return "Because obedience is only interesting once it asks something real of you.";
  }
  if (/\bwhat real service from you would actually look like\b/.test(focus)) {
    return "Because service only matters if it becomes useful instead of ornamental.";
  }
  if (/\bhow toys sharpen the dynamic instead of replacing it\b/.test(focus)) {
    return "Because a toy should sharpen the exchange, not do the whole job for you.";
  }
  if (/\bhow you would actually want to use that toy\b/.test(focus)) {
    return "Because the use matters more than the label.";
  }
  if (/\bwhat people usually miss about you\b/.test(focus)) {
    return "Because what people usually miss about you usually tells me more than the first answer people reach for.";
  }
  return `${contextLead}. That is the part that actually tells me something useful.`;
}

function buildGoOnReply(questionLead: string | null, contextToken: string | null): string {
  const focus = questionLead ? stripClarificationLeadPrefix(questionLead).toLowerCase() : "";
  if (/\bwhat you can do for me\b|\bwhat would make you useful to me\b/.test(focus)) {
    return "Good. Then tell me what you can actually do for me, not just what sounds good.";
  }
  if (/\bbeing trained by me\b/.test(focus)) {
    return "Good. Then tell me what being trained by me would actually change in you.";
  }
  if (/\bwhat being owned by me would actually ask of you\b/.test(focus)) {
    return "Good. Then tell me what being owned by me would actually ask of you once it stopped being fantasy.";
  }
  if (/\bwhat bondage changes once it stops being decorative\b/.test(focus)) {
    return "Good. Then tell me what bondage changes for you once it is more than decoration.";
  }
  if (/\bwhat obedience would actually ask of you\b/.test(focus)) {
    return "Good. Then tell me what obedience would actually cost you once I stopped making it easy.";
  }
  if (/\bwhat real service from you would actually look like\b/.test(focus)) {
    return "Good. Then tell me what real service from you would actually look like.";
  }
  if (/\bhow toys sharpen the dynamic instead of replacing it\b/.test(focus)) {
    return "Good. Then tell me which toy use actually changes the dynamic for you.";
  }
  if (/\bhow you would actually want to use that toy\b/.test(focus)) {
    return "Good. Then tell me how you would actually want to use it.";
  }
  if (/\bwhat people usually miss about you\b/.test(focus)) {
    return "Good. Then tell me what people usually get wrong about you.";
  }
  if (
    /\bwork that keeps dragging your attention\b/.test(focus) ||
    /\bpart of work that keeps dragging your attention\b/.test(focus) ||
    /\bexact part of work that keeps dragging your attention\b/.test(focus) ||
    /\bworkload\b.*\bperson\b.*\bchoice\b/.test(focus) ||
    /\bamount\b.*\bperson\b.*\bchoice\b/.test(focus)
  ) {
    return "Good. Then pick one of those three and I will keep the thread on it.";
  }
  if (/\bconsistency\b|\bfollow-through\b|\bhonesty\b|\bsteadiness\b/.test(focus)) {
    return "Good. Then tell me which part of that would be hardest for you to hold.";
  }
  if (/\bpart that is real enough to hold my attention\b/.test(focus)) {
    return "Good. Then ask me about the patterns, pressure, or motive that actually keep me interested.";
  }
  if (contextToken) {
    return `Good. Keep going. Stay with the concrete part of ${contextToken}, not the wording around it.`;
  }
  return "Good. Keep going. Tell me the concrete part, not the wording around it.";
}

function buildDirectClarificationReply(
  questionLead: string | null,
  contextToken: string | null,
  lead: string,
): string {
  if (questionLead) {
    return `${questionLead}.`;
  }
  if (contextToken) {
    return `I mean ${contextToken}.`;
  }
  return `${lead}.`;
}

function shouldPreferRepairReply(
  resolution: ReturnType<typeof resolveRepairTurn>,
): boolean {
  if (!resolution.detected || !resolution.reply) {
    return false;
  }
  if (resolution.confidence === "high") {
    return true;
  }
  return /\b(when you said|scripted questioning|talk directly|the part you just said|last answer sounded|last answer|last point)\b/i.test(
    resolution.reply,
  );
}

export function detectShortFollowUpKind(text: string): ShortFollowUpKind | null {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }
  const repairKind = detectRepairTurnKind(normalized);
  if (repairKind === "clarify_reason") {
    return "why";
  }
  if (repairKind === "repeat_previous") {
    return "repeat";
  }
  if (repairKind === "clarify_meaning" || repairKind === "clarify_referent") {
    return normalized === "what" || normalized === "huh" ? "what" : "clarify";
  }
  if (normalized === "what") {
    return "what";
  }
  if (normalized === "why" || normalized === "how so") {
    return "why";
  }
  if (normalized === "how") {
    return "how";
  }
  if (normalized === "go on" || normalized === "more" || normalized === "then what") {
    return "go_on";
  }
  if (
    normalized === "tell me more" ||
    normalized === "say more" ||
    normalized === "keep going"
  ) {
    return "go_on";
  }
  if (
    normalized === "what do you mean" ||
    normalized === "explain" ||
    normalized === "explain that" ||
    normalized === "explain more" ||
    normalized === "clarify" ||
    normalized === "say that again"
  ) {
    return "clarify";
  }
  if (normalized === "repeat that") {
    return "repeat";
  }
  return null;
}

export function isShortClarificationTurn(text: string): boolean {
  return detectShortFollowUpKind(text) !== null;
}

function buildContextLead(
  interactionMode: ShortFollowUpMode | undefined,
  topicType: ShortFollowUpTopic | undefined,
): string {
  if (interactionMode === "locked_task_execution" || interactionMode === "task_execution" || topicType === "task_execution") {
    return "I mean the step in front of you";
  }
  if (interactionMode === "game" || topicType === "game_execution" || topicType === "game_setup") {
    return "I mean the move on the table";
  }
  if (interactionMode === "profile_building") {
    return "I mean the piece I just pressed on";
  }
  if (interactionMode === "relational_chat") {
    return "I mean exactly what I gave you";
  }
  return "I mean the point I just made";
}

export function buildShortClarificationReply(input: {
  userText: string;
  interactionMode?: ShortFollowUpMode;
  topicType?: ShortFollowUpTopic;
  lastQuestion?: string | null;
  lastAssistantText?: string | null;
  lastUserText?: string | null;
  lastUserAnswer?: string | null;
  currentTopic?: string | null;
}): string {
  const kind = detectShortFollowUpKind(input.userText);
  const lead = buildContextLead(input.interactionMode, input.topicType);
  const previousUserText = input.lastUserText ?? input.lastUserAnswer ?? input.lastQuestion ?? null;
  const repairResolution = resolveRepairTurn({
    userText: input.userText,
    previousAssistantText: input.lastAssistantText,
    previousUserText,
    currentTopic: input.currentTopic,
    memoryFallbackText: input.lastUserAnswer ?? input.lastQuestion ?? null,
  });
  const questionLead =
    buildQuestionClarificationLead(input.lastAssistantText) ??
    buildQuestionClarificationLead(input.lastQuestion) ??
    buildQuestionClarificationLead(previousUserText) ??
    buildQuestionClarificationLead(input.currentTopic);
  const contextToken =
    (questionLead
      ? null
      : extractContextToken(input.lastAssistantText) ??
        extractContextToken(input.lastQuestion) ??
        extractContextToken(previousUserText) ??
        extractContextToken(input.currentTopic));
  const contextLead = questionLead ?? (contextToken ? `I mean the part about ${contextToken}` : lead);

  if (kind === "why") {
    if (repairResolution.detected && repairResolution.kind === "clarify_reason" && repairResolution.reply) {
      return repairResolution.reply;
    }
    if (
      input.interactionMode === "task_execution" ||
      input.interactionMode === "locked_task_execution" ||
      input.topicType === "task_execution"
    ) {
      return "Because that is the live step. It is the piece that moves the task forward instead of reopening it.";
    }
    return buildWhyFollowUpReply(questionLead, contextLead);
  }

  if (kind === "go_on") {
    if (
      questionLead &&
      (/\bbeing trained by me\b/i.test(questionLead) ||
        /\bperson or a performance\b/i.test(questionLead) ||
        /\bexact part of work that keeps dragging your attention\b/i.test(questionLead) ||
        /\bpart that is real enough to hold my attention\b/i.test(questionLead))
    ) {
      return buildGoOnReply(questionLead, contextToken);
    }
    const semanticContinuation = buildCoreConversationReply({
      userText: input.userText,
      previousAssistantText: input.lastAssistantText,
      currentTopic: input.currentTopic,
    });
    if (semanticContinuation) {
      return semanticContinuation;
    }
    return buildGoOnReply(questionLead, contextToken);
  }

  if (kind === "repeat") {
    if (questionLead) {
      return buildDirectClarificationReply(questionLead, contextToken, lead);
    }
    return shouldPreferRepairReply(repairResolution)
      ? (repairResolution.reply ?? buildDirectClarificationReply(questionLead, contextToken, lead))
      : buildDirectClarificationReply(questionLead, contextToken, lead);
  }

  if (shouldPreferRepairReply(repairResolution)) {
    return repairResolution.reply;
  }

  return buildDirectClarificationReply(questionLead, contextToken, lead);
}
