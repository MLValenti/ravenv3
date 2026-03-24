type ConversationLeadContext = {
  userText: string;
  currentTopic?: string | null;
  previousAssistantText?: string | null;
};

const WEAK_TOPIC_TERMS = new Set([
  "about",
  "actually",
  "again",
  "anything",
  "else",
  "good",
  "line",
  "lived",
  "matters",
  "mean",
  "more",
  "part",
  "point",
  "polished",
  "real",
  "say",
  "saying",
  "something",
  "talk",
  "that",
  "then",
  "thing",
  "this",
  "want",
  "what",
  "will",
  "wording",
]);

function normalizeSemanticTopic(value: string | null | undefined): string | null {
  const cleaned = cleanTopic(value);
  if (!cleaned) {
    return null;
  }
  if (/\bwhat i want to know about you\b/i.test(cleaned)) {
    return "what people usually miss about you";
  }
  if (/\bwhat you want to know about me\b/i.test(cleaned)) {
    return "what you actually want to know about me";
  }
  if (/\bwhat i can do for you\b/i.test(cleaned)) {
    return "what you can do for me";
  }
  if (/\bhow i can (?:be useful|help|please|serve|entertain) you\b/i.test(cleaned)) {
    return "what you can do for me";
  }
  if (/\bi(?:'d| would) love to be trained by you\b/i.test(cleaned)) {
    return "what being trained by me would actually change for you";
  }
  if (/\b(?:be|being) trained by you\b/i.test(cleaned)) {
    return "what being trained by me would actually change for you";
  }
  if (/\b(?:be|being) owned by you\b/i.test(cleaned) || /\bowned by you\b/i.test(cleaned)) {
    return "what being owned by me would actually ask of you";
  }
  if (/\bobedience\b/i.test(cleaned)) {
    return "what obedience would actually ask of you";
  }
  if (/\bservice\b/i.test(cleaned)) {
    return "what real service would look like from you";
  }
  return cleaned;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function cleanTopic(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = normalize(value)
    .replace(/^the\s+/i, "")
    .replace(/[.?!,:;]+$/g, "")
    .trim();
  return cleaned || null;
}

function tokenizeTopic(text: string | null | undefined): string[] {
  return normalize(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function isWeakConversationTopic(topic: string | null | undefined): boolean {
  const cleaned = normalizeSemanticTopic(topic);
  if (!cleaned) {
    return true;
  }
  if (/^(?:be|being|do|doing|have|having|would|could|should)\b/i.test(cleaned)) {
    return true;
  }
  const tokens = tokenizeTopic(cleaned);
  if (tokens.length === 0) {
    return true;
  }
  const strongTokens = tokens.filter((token) => !WEAK_TOPIC_TERMS.has(token));
  if (strongTokens.length === 0) {
    return true;
  }
  return strongTokens.length === 1 && ["will", "else", "more", "part", "thing", "outline"].includes(strongTokens[0] ?? "");
}

function extractExplicitTopic(text: string): string | null {
  const patterns = [
    /\b(?:talk about|discuss|explore|focus on)\s+([^.!?]{2,80})/i,
    /\bwhat about\s+([^.!?]{2,80})/i,
    /\babout\s+([^.!?]{2,80})\?*$/i,
  ];
  for (const pattern of patterns) {
    const topic = normalizeSemanticTopic(text.match(pattern)?.[1]);
    if (topic && !isWeakConversationTopic(topic)) {
      return topic;
    }
  }
  return null;
}

function extractPreviousTopic(text: string | null | undefined): string | null {
  const source = text ?? "";
  const patterns = [
    /\b(?:talk about|start with|stay on)\s+([^.!?,:;]{3,80})/i,
    /\bpart about\s+([^.!?,:;]{3,80})/i,
    /\bwhat matters next is\s+([^.!?,:;]{3,80})/i,
  ];
  for (const pattern of patterns) {
    const topic = normalizeSemanticTopic(source.match(pattern)?.[1]);
    if (topic && !isWeakConversationTopic(topic)) {
      return topic;
    }
  }
  return null;
}

function hasCue(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function buildDefaultLeadTopic(context: ConversationLeadContext): string {
  const combined = normalize(
    `${context.userText} ${context.previousAssistantText ?? ""} ${context.currentTopic ?? ""}`,
  ).toLowerCase();

  if (hasCue(combined, /\b(train|training|trained|discipline|obedience|service)\b/)) {
    return "whether you actually want to be trained or just liked for sounding willing";
  }
  if (hasCue(combined, /\b(owned|ownership|belong|obedience)\b/)) {
    return "what being owned by me would actually ask of you";
  }
  if (hasCue(combined, /\b(entertain|amuse|please|impress)\b/)) {
    return "whether you are here to entertain me or to become genuinely useful";
  }
  if (hasCue(combined, /\b(useful|usefulness|offer|offering|serve|service)\b/)) {
    return "what you are actually useful for once the performance drops";
  }
  return "whether you are here to entertain me, be useful to me, or be trained into something better";
}

export function resolveConversationLeadTopic(context: ConversationLeadContext): string {
  const explicit = extractExplicitTopic(context.userText);
  if (explicit) {
    return explicit;
  }
  const current = normalizeSemanticTopic(context.currentTopic);
  if (current && !isWeakConversationTopic(current)) {
    return current;
  }
  const previous = extractPreviousTopic(context.previousAssistantText);
  if (previous) {
    return previous;
  }
  return buildDefaultLeadTopic(context);
}

export function buildConversationLeadReply(context: ConversationLeadContext): string {
  const topic = resolveConversationLeadTopic(context);
  if (/\bwhat you can do for me\b/i.test(topic)) {
    return "I want to hear what you can actually do for me, not just what sounds good when you say it.";
  }
  if (/\bwhat being trained by me would actually change for you\b/i.test(topic)) {
    return "I want to hear what being trained by me would actually change for you, not just how good it sounds in your head.";
  }
  if (/\bwhat being owned by me would actually ask of you\b/i.test(topic)) {
    return "I want to hear what being owned by me would actually ask of you. Otherwise it is just theater.";
  }
  if (/\bwhat obedience would actually ask of you\b/i.test(topic)) {
    return "I want to hear what obedience would actually ask of you once it had consequences.";
  }
  if (/^whether\b/i.test(topic)) {
    return `I want to hear ${topic}. I would rather start there than waste time on small talk.`;
  }
  return `Tell me about ${topic}. I want the part that actually matters to you.`;
}

export function buildConversationContinuationReply(context: ConversationLeadContext): string {
  const topic = resolveConversationLeadTopic(context);
  if (/\bwhat you can do for me\b/i.test(topic)) {
    return "Keep going. Tell me what you can actually do for me, not just what sounds good.";
  }
  if (/\bwhat being trained by me would actually change for you\b/i.test(topic)) {
    return "Keep going. Tell me what being trained by me would actually change for you.";
  }
  if (/\bwhat being owned by me would actually ask of you\b/i.test(topic)) {
    return "Keep going. Tell me what being owned by me would actually ask of you once it was real.";
  }
  if (/\bwhat obedience would actually ask of you\b/i.test(topic)) {
    return "Keep going. Tell me what obedience would actually ask of you in practice.";
  }
  if (/\bwhat real service would look like from you\b/i.test(topic)) {
    return "Keep going. Tell me what real service from you would actually look like.";
  }
  if (/^whether\b/i.test(topic)) {
    return `Keep going. Tell me where you actually land on ${topic}.`;
  }
  if (/^(?:what|how|why)\b/i.test(topic)) {
    return `Keep going. Tell me more about ${topic}.`;
  }
  return `Keep going. Tell me more about ${topic}.`;
}

export function isBroadConversationContinuationPrompt(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /^(?:what|anything)\s+(?:else|more)(?:\s+(?:then|there|from that|to that|after that))?\??$/.test(
      normalized,
    ) ||
    /^(?:and then|then what|what then|and after that|what about that|where does that go)\??$/.test(
      normalized,
    )
  );
}
