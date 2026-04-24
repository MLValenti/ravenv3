export type InteractionMode =
  | "normal_chat"
  | "task_planning"
  | "task_execution"
  | "locked_task_execution"
  | "game"
  | "profile_building"
  | "relational_chat"
  | "question_answering";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeAssistantSelfQuestionText(text: string): string {
  return normalize(text)
    .replace(/^\s*in detail\s+/g, "")
    .replace(/\bwhat are you kinks\b/g, "what are your kinks")
    .replace(/\bwhat are you fetishes\b/g, "what are your fetishes")
    .replace(/\bwhat are you toys\b/g, "what are your toys")
    .replace(/\bwhat are you preferences\b/g, "what are your preferences")
    .replace(/\bwhat(?:'s| is) you favorite\b/g, "what is your favorite")
    .replace(/\bwhat are you favorite\b/g, "what are your favorite");
}

function cleanPreferenceTopic(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value
    .trim()
    .replace(/^(?:about|into|for)\s+/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  return cleaned || null;
}

const ASSISTANT_PREFERENCE_DOMAIN_PATTERN =
  /\b(bondage|restraint|rope|cuffs?|collars?|chastity|cages?|plug|dildo|vibrator|wand|toy|toys|fetish|fetishes|kink|kinks|spanking|impact|pain|obedience|submission|dominance|control|humiliation|degradation|praise|service)\b/i;

const ASSISTANT_SERVICE_QUESTION_PATTERNS = [
  /\bwhat can i do for you\b/i,
  /\btell me what you can actually do for me\b/i,
  /\btell me what you can do for me\b/i,
  /\bwhat do you want me to do(?: for you)?\b/i,
  /\bwhat do you want from me\b/i,
  /\bhow can i (?:serve|help|please|entertain) you\b/i,
  /\bhow could i (?:serve|help|please|entertain) you\b/i,
  /\bhow can i be useful to you\b/i,
  /\bhow could i be useful to you\b/i,
  /\bwhat would make me useful to you\b/i,
  /\bhow can i be a better (?:sub|submissive) to you\b/i,
  /\bwhat can i do to be a better (?:sub|submissive) to you\b/i,
  /\bhow do i become a better (?:sub|submissive) for you\b/i,
  /\bhow do you want me to (?:serve|please|help) you\b/i,
  /\bwhat do you think would be a good training we could do today\b/i,
  /\bwhat(?: kind of)? training (?:should|could|would) (?:we|i) do(?: today)?\b/i,
  /\bwhat(?: kind of)? (?:[a-z]+\s+){0,3}training (?:should|could|would) (?:we|i) do(?: today)?\b/i,
  /\bwhat would you want me to prove first\b/i,
  /\bwhat would you notice first\b/i,
  /\bwhat should i start with\b/i,
];

export function isAssistantTrainingRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  if (/\b(task|challenge|assignment|routine|for\s+\d+\s*(?:minutes?|hours?))\b/.test(normalized)) {
    return false;
  }
  return (
    /\btrain me\b/.test(normalized) ||
    /\bwhat(?: kind of)? training do you think i need\b/.test(normalized) ||
    /\bwhat training would be good for me\b/.test(normalized) ||
    /\bwhat should i train\b/.test(normalized) ||
    /\b(?:give me|i want|i need|i(?:'d| would) like|can we do|let'?s do|lets do)\b[^.!?]{0,60}\btraining\b/.test(
      normalized,
    ) ||
    /\b(?:anal|throat|oral|chastity|bondage|obedience|service)\s+training\b/.test(normalized)
  );
}

export function extractAssistantPreferenceTopic(text: string): string | null {
  const normalized = normalizeAssistantSelfQuestionText(text);
  if (!normalized) {
    return null;
  }

  const captures = [
    normalized.match(/\bi want to know your\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bdo you like\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bare you into\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bdo you enjoy\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhat(?:'s| is) your favorite\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhat are your favorite\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhat\s+([^?.!,]{2,80})\s+are your favorite\b/i)?.[1],
    normalized.match(/\bwhich are your favorite\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhich\s+([^?.!,]{2,80})\s+are your favorites?\b/i)?.[1],
    normalized.match(/\bwhat are (?:your|you)\s+(kinks|fetishes|toys)\b/i)?.[1],
    normalized.match(/\bwhich\s+([^?.!,]{2,80})\s+do you like\b/i)?.[1],
    normalized.match(/\bwhat kind of\s+([^?.!,]{2,80})\s+are you into\b/i)?.[1],
  ];

  for (const capture of captures) {
    const topic = cleanPreferenceTopic(capture);
    if (topic && ASSISTANT_PREFERENCE_DOMAIN_PATTERN.test(topic)) {
      return topic;
    }
  }
  return null;
}

export function isAssistantPreferenceQuestion(text: string): boolean {
  const normalized = normalizeAssistantSelfQuestionText(text);
  if (!normalized) {
    return false;
  }

  if (extractAssistantPreferenceTopic(normalized)) {
    return true;
  }

  return /\b(what kinks do you like|what fetishes do you like|what toys do you like|what kind of kinks are you into|what kind of fetishes are you into|what kind of toys are you into|which kinks do you like|which toys do you like|what are you into|what are your favorite kinks|what are your favorite fetishes|what are your favorite toys)\b/i.test(
    normalized,
  );
}

export function extractAssistantGeneralPreferenceTopic(text: string): string | null {
  const normalized = normalizeAssistantSelfQuestionText(text);
  if (!normalized) {
    return null;
  }

  const captures = [
    normalized.match(/\bwhat(?:'s| is) your favorite\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhat are your favorite\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhich are your favorite\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhich\s+([^?.!,]{2,80})\s+are your favorites?\b/i)?.[1],
    normalized.match(/\bwhat do you like(?:\s+about)?\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhat do you enjoy\s+([^?.!,]{2,80})/i)?.[1],
    normalized.match(/\bwhat are you into(?:\s+about)?\s+([^?.!,]{2,80})/i)?.[1],
  ];

  for (const capture of captures) {
    const topic = cleanPreferenceTopic(capture);
    if (topic) {
      return topic;
    }
  }

  return null;
}

export function isAssistantGeneralPreferenceQuestion(text: string): boolean {
  const normalized = normalizeAssistantSelfQuestionText(text);
  if (!normalized) {
    return false;
  }
  if (isAssistantPreferenceQuestion(normalized)) {
    return true;
  }
  if (extractAssistantGeneralPreferenceTopic(normalized)) {
    return true;
  }
  return (
    /\bwhat do you like\b/i.test(normalized) ||
    /\bwhat do you enjoy\b/i.test(normalized) ||
    /\bwhat are you into\b/i.test(normalized) ||
    /\btell me about your preferences\b/i.test(normalized) ||
    /\bwhat are your preferences\b/i.test(normalized)
  );
}

export function isAssistantServiceQuestion(text: string): boolean {
  const normalized = normalizeAssistantSelfQuestionText(text);
  if (!normalized) {
    return false;
  }
  if (isAssistantTrainingRequest(normalized)) {
    return true;
  }
  if (isAssistantPreferenceQuestion(normalized) || isAssistantGeneralPreferenceQuestion(normalized)) {
    return false;
  }
  if (ASSISTANT_SERVICE_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const startsLikeQuestion = /^(what|how|would|could|should|do|does|did|where)\b/.test(normalized);
  if (!startsLikeQuestion) {
    return false;
  }

  return (
    /\b(trainable|useful|usefulness|serve|service|please|entertain)\b/.test(normalized) ||
    /\b(prove first|notice first|start with)\b/.test(normalized)
  );
}

export function isRelationalOfferStatement(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return (
    /\bi(?:'d| would) love to be trained by you\b/i.test(normalized) ||
    /\bi want to be trained(?: by you)?\b/i.test(normalized) ||
    /\bi want to be owned by you\b/i.test(normalized) ||
    /\bi want to (?:serve|please|help|be useful to|entertain) you\b/i.test(normalized) ||
    /\bwhat i can do for you\b/i.test(normalized) ||
    /\bhow i can (?:be useful|help|please|serve|entertain) you\b/i.test(normalized) ||
    /\bthinking about what i can do for you\b/i.test(normalized)
  );
}

export function isGoalOrIntentStatement(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  if (
    isProfileBuildingRequest(normalized) ||
    isMutualGettingToKnowRequest(normalized) ||
    isRelationalOfferStatement(normalized)
  ) {
    return false;
  }
  return (
    /\bi want you to\s+[^.!?]{2,120}/i.test(normalized) ||
    /\bi want to\s+[^.!?]{2,120}/i.test(normalized) ||
    /\bi want help with\s+[^.!?]{2,120}/i.test(normalized) ||
    /\bi want to work on\s+[^.!?]{2,120}/i.test(normalized) ||
    /\bi want to improve\s+[^.!?]{2,120}/i.test(normalized) ||
    /\bmy goal is\s+[^.!?]{2,120}/i.test(normalized)
  );
}

export function isMutualGettingToKnowRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /\b(learn more about you|learn about you|tell me about yourself|let me get to know you|get to know you|get to know each other|learn about each other|ask me questions and i(?:'ll| will) ask you some too|i(?:'d| would) like to know more about you|what do you want to know about me|what would you want to know about me|what do you want to ask me|what should i tell you about me|do you want to know anything(?: else)? about me|would you like to know mine|want to hear mine|should i tell you mine)\b/i.test(
    normalized,
  );
}

export function isAssistantSelfQuestion(text: string): boolean {
  const normalized = normalizeAssistantSelfQuestionText(text);
  if (!normalized) {
    return false;
  }
  if (isAssistantServiceQuestion(normalized)) {
    return true;
  }
  if (isAssistantPreferenceQuestion(normalized) || isAssistantGeneralPreferenceQuestion(normalized)) {
    return true;
  }
  return /\b(tell me more about you|what(?:'s| is) your favorite thing to talk about|what do you like|what are you into|what should i know about you|tell me about yourself|what do you enjoy talking about|what kinds of things do you like talking about|what matters to you|what are you like|what kinks do you like|what fetishes do you like|what toys do you like|what kind of kinks are you into|what kind of fetishes are you into|what kind of toys are you into|which kinks do you like|which toys do you like)\b/i.test(
    normalized,
  );
}

export function isProfileSummaryRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /\b(what have you learned about me(?: so far)?|what do you know about me|summari[sz]e what you(?:'ve| have) learned|summari[sz]e what you know about me|tell me what you know about me)\b/i.test(
    normalized,
  );
}

export function isProfileBuildingRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return (
    /\b(get to know me|know me better|learn about me|learn what i like|build (?:my )?profile|ask me about myself|want you to know me|figure me out|understand me better)\b/i.test(
      normalized,
    ) || isMutualGettingToKnowRequest(normalized)
  );
}

export function isChatSwitchRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /\b(let'?s just chat(?: for (?:a )?(?:minute|bit))?|let'?s chat(?: for (?:a )?(?:minute|bit))?|let'?s talk normally|just chat with me|forget the task(?: for (?:a )?second)?|pause the task|let'?s just talk|talk normally for a minute)\b/i.test(
    normalized,
  );
}

export function isNormalChatRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /\b(just chat|let'?s chat|talk normally|talk for a bit|switch topics|talk about something else|how are you|how are you doing|how's it going|hows it going|you good|what'?s up|whats up|what do you think)\b/i.test(
    normalized,
  );
}

export function isChatLikeSmalltalk(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|good night)\b/i.test(
    normalized,
  );
}

export function normalizeInteractionMode(value: unknown): InteractionMode {
  switch (value) {
    case "task_planning":
    case "task_execution":
    case "locked_task_execution":
    case "game":
    case "profile_building":
    case "relational_chat":
    case "question_answering":
    case "normal_chat":
      return value;
    default:
      return "normal_chat";
  }
}
