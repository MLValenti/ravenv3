import {
  buildConversationContinuationReply,
  buildConversationLeadReply,
  isBroadConversationContinuationPrompt,
} from "./conversation-lead.ts";
import {
  isAssistantPreferenceQuestion,
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isAssistantTrainingRequest,
} from "../session/interaction-mode.ts";

export type CoreConversationMove =
  | "continue_current_thought"
  | "agree_and_extend"
  | "clarify_meaning"
  | "answer_direct_question"
  | "user_correction"
  | "raven_leads_next_beat"
  | "concrete_request"
  | "request_revision"
  | "blocked_need_clarification";

export function isStableCoreConversationMove(move: CoreConversationMove): boolean {
  return (
    move === "continue_current_thought" ||
    move === "agree_and_extend" ||
    move === "clarify_meaning" ||
    move === "user_correction" ||
    move === "request_revision" ||
    move === "raven_leads_next_beat"
  );
}

type CoreTurnMoveInput = {
  userText: string;
  previousAssistantText?: string | null;
  currentTopic?: string | null;
};

const STOP_WORDS = new Set([
  "answer",
  "about",
  "after",
  "again",
  "also",
  "actually",
  "because",
  "being",
  "cleanly",
  "changes",
  "from",
  "gets",
  "good",
  "have",
  "happen",
  "happened",
  "happens",
  "hear",
  "here",
  "just",
  "keep",
  "land",
  "like",
  "mean",
  "matter",
  "matters",
  "more",
  "once",
  "outline",
  "part",
  "people",
  "point",
  "loud",
  "real",
  "really",
  "same",
  "say",
  "thinking",
  "that",
  "that's",
  "there",
  "these",
  "thing",
  "version",
  "this",
  "talk",
  "topic",
  "discuss",
  "tell",
  "what",
  "when",
  "where",
  "which",
  "would",
  "could",
  "should",
  "with",
  "want",
  "whether",
  "yeah",
  "usually",
]);

const WEAK_ANCHOR_TOKENS = new Set([
  "answer",
  "actually",
  "stay",
  "decorative",
  "changes",
  "starts",
  "start",
  "people",
  "inside",
  "image",
  "asked",
  "asking",
  "cleanly",
  "means",
  "meant",
  "miss",
  "more",
  "question",
  "reset",
  "fine",
  "first",
  "going",
  "happen",
  "happened",
  "happens",
  "hear",
  "here",
  "keep",
  "land",
  "tell",
  "thread",
  "outline",
  "whether",
  "would",
  "could",
  "should",
  "usually",
  "loud",
  "like",
]);

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function tokenize(text: string): string[] {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function pickAnchorToken(tokens: string[]): string | null {
  for (const token of tokens) {
    if (!WEAK_ANCHOR_TOKENS.has(token)) {
      return token;
    }
  }
  return null;
}

export function isCoreTopicLeadRequest(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /\b(pick|choose)\s+(?:a\s+)?topic\b/.test(normalized) ||
    /\b(?:pick|choose)\s+something\s+to\s+(?:talk about|discuss)\b/.test(normalized) ||
    /\byou\s+(?:pick|choose)\s+(?:what|something)\s+to\s+(?:talk about|discuss)\b/.test(normalized) ||
    /^\s*you pick\s*$/i.test(normalized) ||
    /\bwhat do you want to talk about\b/.test(normalized) ||
    /\bchoose something to discuss\b/.test(normalized) ||
    /\bwhat else would you like me to say about that\b/.test(normalized)
  );
}

function isQuestion(text: string): boolean {
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

function isClarificationCue(text: string): boolean {
  return /^(what|what do you mean|why|how so|explain|explain that|clarify|say that again|repeat that|go on|keep going|more|then what)$/i.test(
    normalize(text).toLowerCase(),
  );
}

function isAgreementCue(text: string): boolean {
  return /^(yeah|yes|exactly|right|true|fair|ok|okay|alright|sounds good|got it|that makes sense|that sounds more real|that feels more real|that's a good point|thats a good point|good point)\b/i.test(
    normalize(text).toLowerCase(),
  );
}

function isCorrectionCue(text: string): boolean {
  return /\b(not like that|not that|no,? that does(?:n't| not) fit|that does(?:n't| not) fit|too much|less intense|more personal|more specific)\b/i.test(
    text,
  );
}

function isRevisionCue(text: string): boolean {
  return /\b(different task|different kind of task|change the time|change how long|make it shorter|make it longer|make it \d+\s*(?:minutes?|hours?)|revise|adjust|make it stricter|expand that|more pressure)\b/i.test(
    text,
  );
}

function isConcreteRequest(text: string): boolean {
  return (
    /\b(give me|make me|build me|set me|assign me|can we|let's|lets)\b/i.test(text) ||
    /^\s*i want\s+(?:you|to|a\b|an\b)/i.test(text)
  );
}

function extractAnchor(input: CoreTurnMoveInput): string | null {
  const normalizedTopic = normalize(input.currentTopic ?? "");
  const topicTokens = tokenize(normalizedTopic.toLowerCase() === "none" ? "" : normalizedTopic);
  const topicAnchor = pickAnchorToken(topicTokens);
  if (topicAnchor) {
    return topicAnchor;
  }

  if (/^what interests me is whether\b/i.test(normalize(input.previousAssistantText ?? ""))) {
    return null;
  }

  const normalizedPrevious = normalize(input.previousAssistantText ?? "");
  if (
    /^(tell me|what should|what do you|give me|name the|state the|drop the fog|keep going|good\. then tell me|yes\. then tell me|yes\. keep going|good\. keep going|then tell me)\b/i.test(
      normalizedPrevious,
    ) ||
    /\btell me (?:what|where|which|how|whether)\b/i.test(normalizedPrevious)
  ) {
    return null;
  }
  const previousTokens = tokenize(normalizedPrevious);
  const previousAnchor = pickAnchorToken(previousTokens);
  if (previousAnchor) {
    return previousAnchor;
  }

  const userTokens = tokenize(input.userText);
  const userAnchor = pickAnchorToken(userTokens);
  if (userAnchor) {
    return userAnchor;
  }

  return null;
}

function extractLeadAnchor(input: CoreTurnMoveInput): string | null {
  const normalizedTopic = normalize(input.currentTopic ?? "");
  const topicTokens = tokenize(normalizedTopic.toLowerCase() === "none" ? "" : normalizedTopic);
  const topicAnchor = pickAnchorToken(topicTokens);
  if (topicAnchor) {
    return topicAnchor;
  }

  const normalizedPrevious = normalize(input.previousAssistantText ?? "");
  if (
    /^(tell me|what should|what do you|give me|name the|state the|drop the fog|keep going|good\. then tell me|yes\. then tell me|yes\. keep going|good\. keep going|then tell me)\b/i.test(
      normalizedPrevious,
    ) ||
    /\btell me (?:what|where|which|how|whether)\b/i.test(normalizedPrevious)
  ) {
    return null;
  }
  const previousTokens = tokenize(normalizedPrevious);
  const previousAnchor = pickAnchorToken(previousTokens);
  if (previousAnchor) {
    return previousAnchor;
  }

  return null;
}

function extractSemanticFocus(text: string | null | undefined): string | null {
  const normalized = normalize(text ?? "");
  if (!normalized) {
    return null;
  }
  if (
    /\bobedience drill\b/i.test(normalized) &&
    /\bone clean sentence\b/i.test(normalized) &&
    /\bpermission\b/i.test(normalized)
  ) {
    return "a focused obedience drill with clean answers and permission before shifting";
  }
  if (
    /\bprecision\b/i.test(normalized) &&
    /\bone clean sentence\b/i.test(normalized) &&
    /\bpermission\b/i.test(normalized)
  ) {
    return "a focused obedience drill with clean answers and permission before shifting";
  }
  if (/\bfocused and honest\b/i.test(normalized) && /\bnot just for show\b/i.test(normalized)) {
    return "a focused obedience drill with clean answers and pressure that is not just for show";
  }
  if (/\bi(?:'d| would) love to be trained by you\b/i.test(normalized)) {
    return "being trained by me in a way that actually changes you";
  }
  if (/\bi want to be trained\b/i.test(normalized)) {
    return "what being trained would actually change for you";
  }
  if (/\bbeing trained by me\b/i.test(normalized)) {
    return "being trained by me in a way that actually changes you";
  }
  if (/\bi want structure, not just play\b/i.test(normalized)) {
    return "structure instead of play";
  }
  if (/\bstructure instead of play\b/i.test(normalized)) {
    return "structure instead of play";
  }
  if (/\bconsistency, honesty, and follow through\b/i.test(normalized)) {
    return "consistency, honesty, and follow-through";
  }
  if (/\bconsistency, honesty, and follow-?through\b/i.test(normalized)) {
    return "consistency, honesty, and follow-through";
  }
  if (/\battention, follow-?through, honesty, and enough steadiness\b/i.test(normalized)) {
    return "attention, follow-through, honesty, and steadiness";
  }
  if (/\bbe trainable\b/i.test(normalized) || /\bhonest enough for me to see where you hold\b/i.test(normalized) || /\bconsistent enough that i can actually shape something\b/i.test(normalized)) {
    return "honesty, consistency, and trainability";
  }
  if (/\bwhether you answer cleanly or perform\b/i.test(normalized)) {
    return "whether you answer cleanly or perform";
  }
  if (/\banswer cleanly, and follow through long enough for it to mean something\b/i.test(normalized)) {
    return "answering cleanly and following through long enough for it to mean something";
  }
  if (/\bwhat would make me useful to you\b/i.test(normalized)) {
    return "what would make you useful to me";
  }
  if (/\bwhat would make you useful to me\b/i.test(normalized)) {
    return "what would make you useful to me";
  }
  if (/\bwhat i can do for you\b/i.test(normalized)) {
    return "what you can do for me";
  }
  if (/\bhow i can (?:be useful|help|please|serve|entertain) you\b/i.test(normalized)) {
    return "what you can do for me";
  }
  if (/\b(?:be|being) owned by you\b/i.test(normalized) || /\bowned by you\b/i.test(normalized)) {
    return "what being owned by me would actually ask of you";
  }
  if (/\bbeing owned by me\b/i.test(normalized)) {
    return "what being owned by me would actually ask of you";
  }
  if (/\bobedience\b/i.test(normalized)) {
    return "what obedience would actually ask of you";
  }
  if (/\bbondage\b/i.test(normalized)) {
    return "what bondage changes once it stops being ornamental";
  }
  if (/\banal training\b/i.test(normalized)) {
    return "how anal training actually works when it is deliberate";
  }
  if (/\b(dildo|plug|toy)\b/i.test(normalized)) {
    return "how you actually want to use that toy";
  }
  if (/\bwhether you are here to entertain me, be useful to me, or be trained into something better\b/i.test(normalized)) {
    return "whether you are here to entertain me, be useful to me, or be trained into something better";
  }
  if (/\bi do not usually say this out loud\b/i.test(normalized)) {
    return "saying it out loud at all";
  }
  const usefulnessMatch = normalized.match(
    /\bhow i can (be useful|help|please|serve|entertain) you\b/i,
  );
  if (usefulnessMatch?.[1]) {
    return `how you could actually ${usefulnessMatch[1].toLowerCase()} me`;
  }
  if (/\bpeople usually miss about you\b/i.test(normalized)) {
    return "what people usually miss about you";
  }
  return null;
}

function buildAgreementFromSemanticFocus(semanticFocus: string): string {
  const normalized = semanticFocus.toLowerCase();
  if (/\bfocused obedience drill with clean answers and permission before shifting\b/.test(normalized)) {
    return "Exactly. That only works if you stay precise when the pressure stops flattering you.";
  }
  if (/\bbeing trained by me\b/.test(normalized)) {
    return "Exactly. Wanting training is easy to say. Letting it change you is the harder part.";
  }
  if (
    /\bwhat would make you useful to me\b/.test(normalized) ||
    /\bwhat you can do for me\b/.test(normalized) ||
    /\bhonesty, consistency, and trainability\b/.test(normalized) ||
    /\battention, follow-through, honesty, and steadiness\b/.test(normalized) ||
    /\bconsistency, honesty, and follow-through\b/.test(normalized) ||
    /\banswering cleanly and following through\b/.test(normalized)
  ) {
    return "Exactly. Usefulness is not a pose. It shows up in honesty, steadiness, and follow-through.";
  }
  if (/\bsaying it out loud at all\b/.test(normalized)) {
    return "Exactly. Once you say something like that out loud, it becomes something real instead of private noise.";
  }
  if (/\bwhether you are here to entertain me, be useful to me, or be trained into something better\b/.test(normalized)) {
    return "Exactly. That question matters because it tells me whether you want attention, usefulness, or real change.";
  }
  if (/\bwhat people usually miss about you\b/.test(normalized)) {
    return "Exactly. That is usually the part that tells me the most about someone.";
  }
  if (/\bwhat being trained would actually change for you\b/.test(normalized)) {
    return "Exactly. Wanting training is the easy part. The harder part is knowing what you expect it to change in you.";
  }
  if (/\bwhat being owned by me would actually ask of you\b/.test(normalized)) {
    return "Exactly. Being owned by me sounds easy until it starts costing you comfort, control, or excuses.";
  }
  if (/\bwhat obedience would actually ask of you\b/.test(normalized)) {
    return "Exactly. Obedience is only interesting when it survives contact with discomfort.";
  }
  if (/\bwhat bondage changes once it stops being ornamental\b/.test(normalized)) {
    return "Exactly. Bondage only matters to me when it changes the dynamic instead of decorating it.";
  }
  if (/\bstructure instead of play\b/.test(normalized)) {
    return "Exactly. Structure matters because it asks more of you than play does.";
  }
  if (/\bwhether you answer cleanly or perform\b/.test(normalized)) {
    return "Exactly. That tells me very quickly whether I am dealing with a person or a performance.";
  }
  return "Exactly. That is the part that tells me whether someone actually means it.";
}

function buildContinuationFromSemanticFocus(semanticFocus: string): string {
  const normalized = semanticFocus.toLowerCase();
  if (/\bfocused obedience drill with clean answers and permission before shifting\b/.test(normalized)) {
    return "Good. Then we keep it concrete: one clean sentence at a time, permission before you shift the subject, and no softening anything. If you want more pressure, add cuffs, a collar, or a plug and hold the same rule inside it.";
  }
  if (/\bfocused obedience drill with clean answers and pressure that is not just for show\b/.test(normalized)) {
    return "Good. Then we keep it strict: one clean sentence at a time, permission before you shift, and no softening. Add cuffs, a collar, or a plug if you want the pressure to sit in the body too.";
  }
  if (/\bbeing trained by me\b/.test(normalized)) {
    return "If you want that from me, tell me what being trained by me would actually change in you.";
  }
  if (
    /\bhonesty, consistency, and trainability\b/.test(normalized)
  ) {
    return "Yes. Then tell me how focused and honest you can stay once it stops being talk.";
  }
  if (
    /\bwhat would make you useful to me\b/.test(normalized) ||
    /\bwhat you can do for me\b/.test(normalized) ||
    /\bhonesty, consistency, and trainability\b/.test(normalized)
  ) {
    return "Yes. Then tell me what you can actually do for me, not just what sounds good.";
  }
  if (
    /\battention, follow-through, honesty, and steadiness\b/.test(normalized) ||
    /\bconsistency, honesty, and follow-through\b/.test(normalized) ||
    /\banswering cleanly and following through\b/.test(normalized)
  ) {
    return "Yes. Then tell me which part is hardest for you to hold once it has to be real.";
  }
  if (/\bsaying it out loud at all\b/.test(normalized)) {
    return "If you do not usually say this out loud, then it already means something real. Now say the part you were trying not to say.";
  }
  if (/\bwhether you are here to entertain me, be useful to me, or be trained into something better\b/.test(normalized)) {
    return "Then tell me which one you actually want, not just which one sounds good when you say it.";
  }
  if (/\bwhat being owned by me would actually ask of you\b/.test(normalized)) {
    return "Then tell me what being owned by me would actually ask of you once it stopped being fantasy.";
  }
  if (/\bwhat obedience would actually ask of you\b/.test(normalized)) {
    return "Then tell me what obedience would actually cost you once I stopped making it easy.";
  }
  if (/\bwhat bondage changes once it stops being ornamental\b/.test(normalized)) {
    return "Then tell me what bondage changes for you once it is more than decoration.";
  }
  if (/\bhow you actually want to use that toy\b/.test(normalized)) {
    return "Then tell me how you want to use it, and be specific.";
  }
  if (/\bwhat people usually miss about you\b/.test(normalized)) {
    return "Yes. Then tell me what people usually get wrong about you.";
  }
  if (/\bwhat being trained would actually change for you\b/.test(normalized)) {
    return "If you want training, tell me what you want it to change in you once it stops being decorative.";
  }
  if (/\bstructure instead of play\b/.test(normalized)) {
    return "Yes. Then tell me what structure would ask of you that play never would.";
  }
  if (/\bwhether you answer cleanly or perform\b/.test(normalized)) {
    return "Yes. Then tell me which one you think I would notice first.";
  }
  return "Yes. Keep going. Tell me the concrete part.";
}

export function classifyCoreConversationMove(input: CoreTurnMoveInput): CoreConversationMove {
  const userText = normalize(input.userText);
  if (!userText) {
    return "blocked_need_clarification";
  }

  if (isCoreTopicLeadRequest(userText)) {
    return "raven_leads_next_beat";
  }
  if (isConcreteRequest(userText) && /\b(task|challenge|options|choose the task|pick the task)\b/i.test(userText)) {
    return "concrete_request";
  }
  if (isRevisionCue(userText)) {
    return "request_revision";
  }
  if (isCorrectionCue(userText)) {
    return "user_correction";
  }
  if (isClarificationCue(userText)) {
    return normalize(userText).toLowerCase() === "go on" ||
        normalize(userText).toLowerCase() === "keep going" ||
        normalize(userText).toLowerCase() === "more"
      ? "continue_current_thought"
      : "clarify_meaning";
  }
  if (isBroadConversationContinuationPrompt(userText)) {
    return input.previousAssistantText ? "continue_current_thought" : "raven_leads_next_beat";
  }
  if (isQuestion(userText)) {
    return "answer_direct_question";
  }
  if (isAgreementCue(userText)) {
    return "agree_and_extend";
  }
  if (isConcreteRequest(userText)) {
    return "concrete_request";
  }

  const wordCount = userText.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2) {
    return "blocked_need_clarification";
  }
  return "continue_current_thought";
}

export function buildCoreConversationReply(input: CoreTurnMoveInput): string | null {
  if (
    isAssistantTrainingRequest(input.userText) ||
    isAssistantServiceQuestion(input.userText) ||
    isAssistantPreferenceQuestion(input.userText) ||
    isAssistantSelfQuestion(input.userText)
  ) {
    return null;
  }
  if (isBroadConversationContinuationPrompt(input.userText)) {
    return buildConversationContinuationReply({
      userText: input.userText,
      previousAssistantText: input.previousAssistantText,
      currentTopic: input.currentTopic,
    });
  }
  const move = classifyCoreConversationMove(input);
  const anchor = extractAnchor(input);
  const leadAnchor = extractLeadAnchor(input);
  const semanticFocus =
    extractSemanticFocus(input.userText) ??
    extractSemanticFocus(input.previousAssistantText) ??
    extractSemanticFocus(input.currentTopic);

  switch (move) {
    case "raven_leads_next_beat":
      return buildConversationLeadReply({
        userText: input.userText,
        previousAssistantText: input.previousAssistantText,
        currentTopic: input.currentTopic ?? leadAnchor,
      });
    case "agree_and_extend":
      if (semanticFocus) {
        return buildAgreementFromSemanticFocus(semanticFocus);
      }
      return anchor
        ? `Exactly. ${anchor[0]!.toUpperCase()}${anchor.slice(1)} is the part that tells me whether someone actually means it.`
        : "Exactly. That is the part that tells me whether someone actually means it.";
    case "continue_current_thought":
      if (
        /\breal version\b/i.test(input.userText) &&
        /\bdecorative\b/i.test(input.userText) &&
        anchor
      ) {
        return `Yes. Then tell me what the real version of ${anchor} looks like to you.`;
      }
      if (semanticFocus) {
        return buildContinuationFromSemanticFocus(semanticFocus);
      }
      return anchor
        ? `Yes. Keep going. Stay with the concrete part of ${anchor}, not the wording around it.`
        : "Yes. Keep going. Tell me the concrete part, not the wording around it.";
    case "clarify_meaning":
      if (semanticFocus) {
        return `I mean ${semanticFocus}.`;
      }
      return anchor
        ? `I mean ${anchor}.`
        : "I mean the last idea, not the stray wording around it.";
    case "user_correction":
      return anchor
        ? `Fine. Then we correct ${anchor} and keep going.`
        : "Fine. Then we correct the part that does not fit and keep going.";
    case "request_revision":
      if (/\bmore pressure\b/i.test(input.userText)) {
        return anchor
          ? `Fine. We keep ${anchor} and add pressure without changing the whole thread.`
          : "Fine. We keep the current thread and add pressure without changing the whole thing.";
      }
      return anchor
        ? `Fine. We keep ${anchor} and change only the part you just touched.`
        : "Fine. We keep the current thread and change only the part you just touched.";
    case "concrete_request":
      if (semanticFocus) {
        return buildContinuationFromSemanticFocus(semanticFocus);
      }
      return null;
    case "answer_direct_question":
    case "blocked_need_clarification":
      return null;
  }
}
