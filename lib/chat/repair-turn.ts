export type RepairTurnKind =
  | "clarify_meaning"
  | "clarify_referent"
  | "clarify_reason"
  | "repeat_previous";

export type RepairResolutionSource =
  | "previous_assistant"
  | "previous_user"
  | "scene_topic"
  | "memory"
  | "none";

export type RepairConfidence = "high" | "medium" | "low";

export type RepairTurnInput = {
  userText: string;
  previousAssistantText?: string | null;
  previousUserText?: string | null;
  currentTopic?: string | null;
  memoryFallbackText?: string | null;
};

export type RepairResolution = {
  detected: boolean;
  kind: RepairTurnKind | null;
  source: RepairResolutionSource;
  sourceUtterance: string | null;
  referentCandidate: string | null;
  confidence: RepairConfidence;
  usedFallbackRestatement: boolean;
  lastAssistantClaim: string | null;
  lastAssistantQuestion: string | null;
  lastAssistantReferentCandidate: string | null;
  lastConversationTopic: string | null;
  lastUserStatedTopic: string | null;
  repairContext: string | null;
  reply: string | null;
};

const WEAK_REFERENT_PATTERNS = [
  /^(?:none|null|nil|n\/a|na)$/i,
  /^(?:that|this|it|something|anything|nothing|stuff|part|thing|line|point)$/i,
  /^(?:about )?(?:that|this|it|something|anything|nothing|stuff|none)$/i,
  /^(?:the )?part$/i,
  /^(?:the )?thing$/i,
];

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeClarificationCue(text: string): string {
  return normalize(text)
    .toLowerCase()
    .replace(/[!?.,]+$/g, "")
    .replace(/^(?:(?:yes|yeah|yep|ok|okay|alright|all right|right|sure|please)\s+){0,3}/i, "")
    .trim();
}

function splitSentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripLeadFillers(text: string): string {
  return normalize(text)
    .replace(/^(?:fine|good|yes|right|alright|all right|okay|ok|listen)\.?\s+/i, "")
    .trim();
}

function lowerFirst(text: string): string {
  if (!text) {
    return text;
  }
  return text[0]!.toLowerCase() + text.slice(1);
}

function cleanSnippet(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const cleaned = normalize(text)
    .replace(/^[,.:;-\s]+/, "")
    .replace(/[.?!,:;]+$/g, "")
    .trim();
  return cleaned || null;
}

export function isWeakRepairReferent(text: string | null | undefined): boolean {
  const cleaned = cleanSnippet(text);
  if (!cleaned) {
    return true;
  }
  return WEAK_REFERENT_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function detectRepairTurnKind(text: string): RepairTurnKind | null {
  const normalized = normalizeClarificationCue(text);
  if (!normalized) {
    return null;
  }
  if (
    /^(?:say that again|repeat that|come again)$/.test(normalized)
  ) {
    return "repeat_previous";
  }
  if (
    /^(?:why do you say that|why that)$/.test(normalized)
  ) {
    return "clarify_reason";
  }
  if (
    /^(?:what do you mean|what do you mean by that|what do you mean about that|about what|what are you talking about|what part|that part|which part|what|what\?|huh|huh\?|clarify|explain|explain that)$/.test(
      normalized,
    )
  ) {
    return normalized === "what part" || normalized === "that part" || normalized === "which part"
      ? "clarify_referent"
      : "clarify_meaning";
  }
  if (
    /^(?:i asked you that|that is what i asked|that's what i asked|i already asked that|i just asked that|you skipped my question)$/.test(
      normalized,
    )
  ) {
    return "clarify_meaning";
  }
  return null;
}

export function isClarificationExpansionRequest(text: string): boolean {
  const normalized = normalizeClarificationCue(text);
  if (!normalized) {
    return false;
  }
  if (detectRepairTurnKind(normalized)) {
    return true;
  }
  return /^(?:tell me more|say more|more detail|more details|go on|keep going|how so|why|then what|elaborate|expand on that)$/i.test(
    normalized,
  );
}

function extractLastMeaningfulSentence(text: string | null | undefined): string | null {
  const sentences = splitSentences(text ?? "");
  if (sentences.length === 0) {
    return null;
  }
  const meaningful =
    sentences.find((sentence) =>
      /(?:you said|when you said|that answer|that part|without the scaffolding|what should i call you|what do you want|what people usually|being trained by me|that hesitation)/i.test(
        sentence,
      ),
    ) ??
    sentences.find((sentence) => stripLeadFillers(sentence).length > 8) ??
    sentences[sentences.length - 1] ??
    null;
  return cleanSnippet(stripLeadFillers(meaningful ?? ""));
}

function extractLastAssistantQuestion(text: string | null | undefined): string | null {
  const sentences = splitSentences(text ?? "");
  const question = [...sentences].reverse().find((sentence) => sentence.includes("?"));
  return cleanSnippet(question ?? null);
}

function extractExplicitReferent(previousAssistantText: string, previousUserText: string | null): string | null {
  const explicit =
    previousAssistantText.match(/\b(?:you said|when you said)\s+([^,.!?;]{1,80})/i)?.[1] ??
    previousAssistantText.match(/\bthe part (?:you just said )?about\s+([^,.!?;]{1,80})/i)?.[1] ??
    null;
  const cleanedExplicit = cleanSnippet(explicit);
  if (cleanedExplicit && !isWeakRepairReferent(cleanedExplicit)) {
    return cleanedExplicit;
  }
  if (
    /\b(that answer|that part|that hesitation|that line|that point)\b/i.test(previousAssistantText) &&
    previousUserText
  ) {
    const cleanedPreviousUser = cleanSnippet(previousUserText);
    if (cleanedPreviousUser) {
      return cleanedPreviousUser;
    }
  }
  if (/^what should i call you\b/i.test(previousAssistantText)) {
    return "the name I should use for you";
  }
  return cleanedExplicit;
}

function buildRestatementFromAssistant(
  assistantSentence: string,
  previousUserText: string | null,
  kind: RepairTurnKind,
): { reply: string; referentCandidate: string | null; usedFallbackRestatement: boolean } {
  const normalizedAssistant = normalize(assistantSentence);
  const cleanedAssistant = cleanSnippet(stripLeadFillers(normalizedAssistant)) ?? normalizedAssistant;
  const explicitReferent = extractExplicitReferent(cleanedAssistant, previousUserText);
  const safeReferent = explicitReferent && !isWeakRepairReferent(explicitReferent) ? explicitReferent : null;

  if (/\byou said\b/i.test(cleanedAssistant) && /\bthat answer usually hides something\b/i.test(cleanedAssistant)) {
    const userPhrase = cleanSnippet(previousUserText) ?? safeReferent;
    if (userPhrase) {
      return {
        reply: `I meant when you said ${userPhrase}, it sounded like you were closing the door on the subject instead of giving me the real answer.`,
        referentCandidate: userPhrase,
        usedFallbackRestatement: !safeReferent,
      };
    }
    return {
      reply: "I meant your last answer sounded like a cover instead of the real point.",
      referentCandidate: null,
      usedFallbackRestatement: true,
    };
  }

  if (/\bwithout the scaffolding\b/i.test(cleanedAssistant)) {
    return {
      reply: "I mean we can stop the scripted questioning for a minute and talk directly.",
      referentCandidate: "talk directly without the scripted questioning",
      usedFallbackRestatement: false,
    };
  }

  if (/\bthat part matters more than you are pretending\b/i.test(cleanedAssistant)) {
    const userPhrase = cleanSnippet(previousUserText);
    if (userPhrase && !isWeakRepairReferent(userPhrase)) {
      return {
        reply: `I mean the part you just said about ${userPhrase}. That is the part that matters more than you are pretending.`,
        referentCandidate: userPhrase,
        usedFallbackRestatement: false,
      };
    }
    return {
      reply: "I mean the part of your last answer that actually carried weight, not the cover around it.",
      referentCandidate: null,
      usedFallbackRestatement: true,
    };
  }

  if (/\bthat answer is doing more work than you think\b/i.test(cleanedAssistant)) {
    return {
      reply: "I mean your last answer is carrying more than you think, not just sitting there as a throwaway line.",
      referentCandidate: cleanSnippet(previousUserText),
      usedFallbackRestatement: true,
    };
  }

  if (/\bstart with what actually holds your attention\b/i.test(cleanedAssistant)) {
    return {
      reply:
        "I mean I want you to start with what is actually holding your attention instead of circling it from a distance.",
      referentCandidate: "what is actually holding your attention",
      usedFallbackRestatement: false,
    };
  }

  if (/^what should i call you\b/i.test(cleanedAssistant)) {
    return {
      reply: "I mean the name you want me to use when I am speaking to you directly.",
      referentCandidate: "the name you want me to use",
      usedFallbackRestatement: false,
    };
  }

  if (safeReferent && kind === "clarify_referent") {
    return {
      reply: `I mean the part about ${safeReferent}.`,
      referentCandidate: safeReferent,
      usedFallbackRestatement: false,
    };
  }

  if (safeReferent && kind === "clarify_meaning") {
    return {
      reply: `I mean ${safeReferent}.`,
      referentCandidate: safeReferent,
      usedFallbackRestatement: false,
    };
  }

  if (kind === "clarify_reason") {
    const becauseClause = cleanedAssistant.replace(/^i mean\s+/i, "");
    return {
      reply: `Because ${lowerFirst(becauseClause)}.`,
      referentCandidate: safeReferent,
      usedFallbackRestatement: true,
    };
  }

  if (/^i mean\b/i.test(cleanedAssistant)) {
    return {
      reply: `${cleanedAssistant}.`,
      referentCandidate: safeReferent,
      usedFallbackRestatement: true,
    };
  }

  return {
    reply: `I mean ${lowerFirst(cleanedAssistant)}.`,
    referentCandidate: safeReferent,
    usedFallbackRestatement: true,
  };
}

function buildRestatementFromUser(previousUserText: string, kind: RepairTurnKind): RepairResolution["reply"] {
  const cleaned = cleanSnippet(previousUserText);
  if (!cleaned) {
    return null;
  }
  if (isWeakRepairReferent(cleaned)) {
    if (kind === "clarify_reason") {
      return "Because I was pressing on your last answer, not the empty wording around it.";
    }
    return "I mean your last answer, not the empty wording around it.";
  }
  if (kind === "clarify_reason") {
    return `Because your last point about ${cleaned} mattered more than the cover around it.`;
  }
  return `I mean your last point about ${cleaned}.`;
}

export function resolveRepairTurn(input: RepairTurnInput): RepairResolution {
  const kind = detectRepairTurnKind(input.userText);
  const previousAssistantText = cleanSnippet(input.previousAssistantText);
  const previousUserText = cleanSnippet(input.previousUserText);
  const currentTopic = cleanSnippet(input.currentTopic);
  const memoryFallbackText = cleanSnippet(input.memoryFallbackText);
  const lastAssistantClaim = extractLastMeaningfulSentence(previousAssistantText);
  const lastAssistantQuestion = extractLastAssistantQuestion(previousAssistantText);
  const lastAssistantReferentCandidate =
    previousAssistantText && previousUserText
      ? extractExplicitReferent(previousAssistantText, previousUserText)
      : previousAssistantText
        ? extractExplicitReferent(previousAssistantText, null)
        : null;
  const lastUserStatedTopic =
    previousUserText && !isWeakRepairReferent(previousUserText) ? previousUserText : currentTopic;

  if (!kind) {
    return {
      detected: false,
      kind: null,
      source: "none",
      sourceUtterance: null,
      referentCandidate: null,
      confidence: "low",
      usedFallbackRestatement: false,
      lastAssistantClaim,
      lastAssistantQuestion,
      lastAssistantReferentCandidate,
      lastConversationTopic: currentTopic,
      lastUserStatedTopic,
      repairContext: null,
      reply: null,
    };
  }

  if (lastAssistantClaim || lastAssistantQuestion) {
    const sourceUtterance = lastAssistantClaim ?? lastAssistantQuestion;
    const assistantRestatement = buildRestatementFromAssistant(
      sourceUtterance ?? "",
      previousUserText,
      kind,
    );
    const repairContext = [
      `source=previous_assistant`,
      `kind=${kind}`,
      `claim=${lastAssistantClaim ?? "none"}`,
      `question=${lastAssistantQuestion ?? "none"}`,
      `referent=${assistantRestatement.referentCandidate ?? lastAssistantReferentCandidate ?? "none"}`,
    ].join(" | ");
    return {
      detected: true,
      kind,
      source: "previous_assistant",
      sourceUtterance,
      referentCandidate:
        assistantRestatement.referentCandidate ?? lastAssistantReferentCandidate ?? null,
      confidence:
        assistantRestatement.usedFallbackRestatement ||
        isWeakRepairReferent(assistantRestatement.referentCandidate)
          ? "medium"
          : "high",
      usedFallbackRestatement: assistantRestatement.usedFallbackRestatement,
      lastAssistantClaim,
      lastAssistantQuestion,
      lastAssistantReferentCandidate,
      lastConversationTopic: currentTopic,
      lastUserStatedTopic,
      repairContext,
      reply: assistantRestatement.reply,
    };
  }

  if (previousUserText) {
    const reply = buildRestatementFromUser(previousUserText, kind);
    return {
      detected: true,
      kind,
      source: "previous_user",
      sourceUtterance: previousUserText,
      referentCandidate: isWeakRepairReferent(previousUserText) ? null : previousUserText,
      confidence: isWeakRepairReferent(previousUserText) ? "low" : "medium",
      usedFallbackRestatement: true,
      lastAssistantClaim,
      lastAssistantQuestion,
      lastAssistantReferentCandidate,
      lastConversationTopic: currentTopic,
      lastUserStatedTopic,
      repairContext: `source=previous_user | kind=${kind} | referent=${previousUserText}`,
      reply,
    };
  }

  if (currentTopic) {
    return {
      detected: true,
      kind,
      source: "scene_topic",
      sourceUtterance: currentTopic,
      referentCandidate: currentTopic,
      confidence: "low",
      usedFallbackRestatement: true,
      lastAssistantClaim,
      lastAssistantQuestion,
      lastAssistantReferentCandidate,
      lastConversationTopic: currentTopic,
      lastUserStatedTopic,
      repairContext: `source=scene_topic | kind=${kind} | topic=${currentTopic}`,
      reply:
        kind === "clarify_reason"
          ? `Because I was still talking about ${currentTopic}.`
          : `I mean the thread we were just on about ${currentTopic}.`,
    };
  }

  if (memoryFallbackText) {
    return {
      detected: true,
      kind,
      source: "memory",
      sourceUtterance: memoryFallbackText,
      referentCandidate: isWeakRepairReferent(memoryFallbackText) ? null : memoryFallbackText,
      confidence: "low",
      usedFallbackRestatement: true,
      lastAssistantClaim,
      lastAssistantQuestion,
      lastAssistantReferentCandidate,
      lastConversationTopic: currentTopic,
      lastUserStatedTopic,
      repairContext: `source=memory | kind=${kind} | referent=${memoryFallbackText}`,
      reply:
        kind === "clarify_reason"
          ? "Because I was still pressing on the same thread."
          : "I mean the point we were already on, not a random fragment.",
    };
  }

  return {
    detected: true,
    kind,
    source: "none",
    sourceUtterance: null,
    referentCandidate: null,
    confidence: "low",
    usedFallbackRestatement: true,
    lastAssistantClaim,
    lastAssistantQuestion,
    lastAssistantReferentCandidate,
    lastConversationTopic: currentTopic,
    lastUserStatedTopic,
    repairContext: `source=none | kind=${kind}`,
    reply:
      kind === "clarify_reason"
        ? "Because I was still pointing at the same last thought."
        : "I mean my last point, not a random fragment.",
  };
}

export function buildRepairDebugHeaders(
  resolution: RepairResolution | null,
): Record<string, string> {
  if (!resolution?.detected) {
    return {};
  }
  return {
    "x-raven-repair-turn": "1",
    "x-raven-repair-source": resolution.source,
    "x-raven-repair-referent": resolution.referentCandidate ?? "none",
    "x-raven-repair-confidence": resolution.confidence,
    "x-raven-repair-fallback-restatement": resolution.usedFallbackRestatement ? "1" : "0",
  };
}
