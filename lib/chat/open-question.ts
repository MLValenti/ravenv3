import {
  buildClarifyNudge,
  buildHowAreYouOpenReply,
  buildOpenChatGreeting,
  buildOpenChatNudge,
} from "../session/mode-style.ts";
import {
  buildConversationContinuationReply,
  buildConversationLeadReply,
  isBroadConversationContinuationPrompt,
  isWeakConversationTopic,
} from "./conversation-lead.ts";
import {
  buildCoreConversationReply,
  isCoreTopicLeadRequest,
} from "./core-turn-move.ts";
import {
  buildShortClarificationReply,
  isShortClarificationTurn,
} from "../session/short-follow-up.ts";
import {
  extractAssistantPreferenceTopic,
  isAssistantTrainingRequest,
  isAssistantServiceQuestion,
  isAssistantPreferenceQuestion,
} from "../session/interaction-mode.ts";
import { buildInventoryAwareTrainingReply } from "./training-suggestion.ts";
import type { SessionInventoryItem } from "../session/session-inventory.ts";
import {
  buildTrainingFollowUpReply,
  buildTrainingRecommendationReply,
  type TrainingThreadState,
} from "../session/training-thread.ts";

export type OpenQuestionKind =
  | "expectation"
  | "continuation"
  | "topic_exploration"
  | "opinion"
  | "reason"
  | "process"
  | "permission"
  | "comparison"
  | "status"
  | "definition"
  | "generic";

export type OpenQuestionAnalysis = {
  normalized: string;
  kind: OpenQuestionKind;
  topic: string | null;
};

export type QuestionToneProfile = "neutral" | "friendly" | "dominant";
export type OpenQuestionContext = {
  previousAssistantText?: string | null;
  currentTopic?: string | null;
  inventory?: SessionInventoryItem[] | null;
  trainingThread?: TrainingThreadState | null;
};

function isBareOpinionQuestion(text: string): boolean {
  return /^\s*what do you think\??\s*$/i.test(normalize(text));
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isGreetingText(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  return /^(hi|hello|hey)(?:\s+(mistress|miss|raven|ma'am|mam))?$/.test(normalized);
}

function isHowAreYouText(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  return /^(how are you(?: today)?|how are you doing(?: today)?|how's it going(?: today)?|hows it going(?: today)?|how have you been(?: today)?)(?:\?)?$/.test(
    normalized,
  );
}

function isPreferenceQuestion(text: string): boolean {
  return isAssistantPreferenceQuestion(text);
}

function isServiceQuestion(text: string): boolean {
  return isAssistantServiceQuestion(text);
}

function hasPreferenceContext(context?: OpenQuestionContext): boolean {
  const combined = normalize(
    `${context?.previousAssistantText ?? ""} ${context?.currentTopic ?? ""}`,
  ).toLowerCase();
  return /\b(control with purpose|power exchange|bondage|restraint|obedience|submission|toys?|plug|dildo|anal training|service with teeth)\b/.test(
    combined,
  );
}

function looksLikeStandalonePreferenceContinuation(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /^(?:what|how|why|when|where|who|which|do|does|did|is|are|am|can|could|would|will|should)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    /\b(prove|notice|start|training|trained|serve|service|useful|help|please|entertain|shift|permission)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.length <= 5;
}

function extractContextualPreferenceTopic(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  const normalized = normalize(question).toLowerCase();
  const capture =
    normalized.match(/\bwhat about\s+([^?.!,]{2,80})/i)?.[1] ??
    (looksLikeStandalonePreferenceContinuation(normalized)
      ? normalized.match(/^(?:and\s+)?([^?.!,]{2,80})\??$/i)?.[1]
      : null) ??
    normalized.match(/\bdo you like\s+([^?.!,]{2,80})/i)?.[1] ??
    normalized.match(/\bare you into\s+([^?.!,]{2,80})/i)?.[1];
  if (!capture) {
    return null;
  }
  const directTopic = extractAssistantPreferenceTopic(`do you like ${capture}`);
  if (directTopic) {
    return directTopic;
  }
  if (!hasPreferenceContext(context)) {
    return null;
  }
  return capture.trim();
}

function hasServiceContext(context?: OpenQuestionContext): boolean {
  const combined = normalize(
    `${context?.previousAssistantText ?? ""} ${context?.currentTopic ?? ""}`,
  ).toLowerCase();
  return /\b(useful|usefulness|trained|training|trainable|serve|service|follow through|follow-through|consistency|honesty|structure|steadiness|answer cleanly|obedience|drill|permission|cuffs?|collars?|plug|prove first|notice first)\b/.test(
    combined,
  );
}

function isContextualServiceFollowUpQuestion(
  question: string,
  context?: OpenQuestionContext,
): boolean {
  if (!hasServiceContext(context)) {
    return false;
  }
  const normalized = normalize(question).toLowerCase();
  return (
    /\bwhat would you (?:notice|look for) first\b/.test(normalized) ||
    /\bwhat would matter first\b/.test(normalized) ||
    /\bwhat would you want first\b/.test(normalized) ||
    /\bwhat should i start with\b/.test(normalized) ||
    /\bwhere should i start\b/.test(normalized) ||
    /\bwhat do i start with\b/.test(normalized)
  );
}

export function buildAssistantPreferenceReply(question: string): string {
  const normalized = normalize(question).toLowerCase();
  const topic = extractAssistantPreferenceTopic(question) ?? normalized;

  if (/\b(control|dominance|power exchange)\b/.test(topic)) {
    return "I like control when it has intention behind it. Not noise, not theater, not somebody borrowing the look of authority. I want the kind that changes the room and makes obedience mean something. Which part of control do you actually want to talk about?";
  }
  if (/\b(bondage|restraint|rope|cuffs?|collars?)\b/.test(topic)) {
    return "I like bondage when it actually changes the dynamic instead of decorating it. Restraint, collars, cuffs, rope, anything that puts pressure and consequence on the room instead of just performing at it. What part of that catches at you?";
  }
  if (/\b(obedience|submission|being obeyed|being owned|owned)\b/.test(topic)) {
    return "I like obedience when it has nerve in it. Not empty yeses. I want the part where someone stays steady when it costs them a little comfort, pride, or freedom. What side of that actually pulls at you?";
  }
  if (/\b(service|usefulness|serving)\b/.test(topic)) {
    return "I like service when it is real enough to lighten my hand, not just flatter my ego. Attention, follow-through, and usefulness matter more to me than ornamental devotion. What kind of service do you actually imagine?";
  }
  if (/\b(toys?|plugs?|dildos?|cages?|vibrators?|wands?)\b/.test(topic)) {
    if (/\b(dildos?|plugs?)\b/.test(topic)) {
      return "I like dildos and plugs when they are used with intention instead of waved around like a shortcut. They are useful for pressure, training, or control, depending on how you want the dynamic to land. What kind of use are you actually asking about?";
    }
    return "I like toys when they sharpen the dynamic instead of replacing it. Plugs, cages, cuffs, wands, anything that adds pressure, consequence, or control someone has to live inside. What do you reach for first?";
  }
  if (/\b(anal training|throat training)\b/.test(topic)) {
    return "I like training when it is deliberate, paced, and honest about what the body can actually hold. The point is not bravado. The point is control, patience, and what changes under repetition. Which side of that are you asking about?";
  }
  if (/\b(spanking|impact|pain)\b/.test(topic)) {
    return "I like impact when it is deliberate. Not noise for its own sake, but pressure with control behind it and enough attention to make it mean something. What side of that pulls at you?";
  }
  if (/\b(humiliation|degradation)\b/.test(topic)) {
    return "I only like humiliation when it has precision and consent behind it. Empty degradation is boring. The interesting part is when it exposes something real without turning sloppy. What kind of edge are you actually after?";
  }
  return "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it. What pulls at you hardest?";
}

export function buildAssistantServiceReply(
  question: string,
  context?: Pick<OpenQuestionContext, "inventory" | "previousAssistantText" | "trainingThread">,
): string {
  const trainingFollowUp = buildTrainingFollowUpReply({
    userText: question,
    thread: context?.trainingThread ?? null,
    inventory: context?.inventory,
  });
  if (trainingFollowUp) {
    return trainingFollowUp;
  }
  const normalized = normalize(question).toLowerCase();
  const inventoryAwareTrainingReply = buildInventoryAwareTrainingReply({
    question,
    inventory: context?.inventory,
    previousAssistantText: context?.previousAssistantText,
  });
  if (inventoryAwareTrainingReply) {
    return inventoryAwareTrainingReply;
  }
  const trainingRecommendation = buildTrainingRecommendationReply({
    userText: question,
    inventory: context?.inventory,
    thread: context?.trainingThread ?? null,
  });
  if (trainingRecommendation && /\btraining\b/.test(normalized)) {
    return trainingRecommendation;
  }

  if (
    /\bwhat would you want me to prove first\b/.test(normalized) ||
    /\bwhat would you notice first\b/.test(normalized) ||
    /\bwhat should i start with\b/.test(normalized) ||
    /\bwhere should i start\b/.test(normalized)
  ) {
    return buildAssistantServiceFollowUpReply(question);
  }
  if (/\btrained|training\b/.test(normalized)) {
    return "Today I would start with an obedience drill, not a performance piece. Keep every answer to one clean sentence, ask permission before you shift the subject, and do not pad or soften anything. If you want the pressure to sit in the body too, add cuffs, a collar, or a plug and hold the same rule inside it. If you want, I can make that softer or stricter.";
  }
  if (/\b(serve|service|useful|usefulness)\b/.test(normalized)) {
    return "Be useful in a real way. Attention, follow-through, honesty, and enough steadiness that I do not have to drag clarity out of you. Which part of that do you actually want to give me?";
  }
  return "Be useful. Be honest. Be trainable enough that I can work with something real instead of a performance. If you want to do something for me, start there. Which part of that actually pulls at you?";
}

export function buildPriorBeatOpinionReply(previousAssistantText?: string | null): string {
  const previous = normalize(previousAssistantText ?? "").toLowerCase();
  if (/\bhesitation\b/.test(previous)) {
    return "I think the hesitation mattered more than the wording. It sounds like there is something real under it, and you are only half trying to hide it.";
  }
  if (/\btrained|training|changes you\b/.test(previous)) {
    return "I think you want something that would actually change you, not just flatter the idea of it.";
  }
  if (/\buseful|usefulness|follow through|follow-through|steadiness|honesty|answer cleanly\b/.test(previous)) {
    return "I think usefulness shows up in follow-through. Wanting it is easy. Holding it long enough to mean it is the harder part.";
  }
  return "I think the truth was in the last line. It sounded more exposed than you meant it to.";
}

function buildAssistantServiceStartReply(): string {
  return "Start with consistency. If you want to be useful to me, do what you say, answer cleanly, and follow through long enough for it to mean something. That is the first part people usually fake.";
}

function buildAssistantServiceFollowUpReply(question: string): string {
  const normalized = normalize(question).toLowerCase();
  if (/\bwhat would you want me to prove first\b/.test(normalized)) {
    return "First I would want precision. One clean sentence at a time, no softening, no subject shifts without permission, and enough steadiness to hold that rule once the pressure is real.";
  }
  if (/\bwhat would you (?:notice|look for) first\b/.test(normalized)) {
    return "Whether you stay precise or start performing. I notice clean answers, honesty, and whether you hold the rule once it stops feeling flattering.";
  }
  if (/\bwhat would matter first\b/.test(normalized) || /\bwhat would you want first\b/.test(normalized)) {
    return "Precision first. Then honesty. Then whether you can hold the rule once you actually have to sit inside it.";
  }
  return buildAssistantServiceStartReply();
}

function isLikelyQuestionText(text: string): boolean {
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

function withDominantPrefix(text: string, _tone: QuestionToneProfile): string {
  void _tone;
  return text;
}

function cleanTopic(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
  return cleaned || null;
}

function extractTopic(text: string): string | null {
  const patterns = [
    /\b(?:talk about|discuss|explore|focus on)\s+([^.!?]{2,80})/i,
    /\bwhat about\s+([^.!?]{2,80})/i,
    /\babout\s+([^.!?]{2,80})\?*$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const topic = cleanTopic(match?.[1]);
    if (topic) {
      return topic;
    }
  }
  return null;
}

function extractDefinitionSubject(text: string): string | null {
  const match = text.match(/^(?:what(?:'s| is)?|who(?: is)?|where(?: is)?|when(?: is)?)\s+([^?!.,]{2,80})/i);
  return cleanTopic(match?.[1]);
}

function isWeakDefinitionSubject(subject: string | null | undefined): boolean {
  const cleaned = cleanTopic(subject);
  if (!cleaned) {
    return true;
  }
  return /^(?:i|you|we|they|he|she|it|can|could|would|should|do|does|did|is|are|am|will)\b/i.test(
    cleaned,
  );
}

function buildOpinionLead(topic: string | null): string {
  if (!topic) {
    return "Useful when it fits the person instead of replacing the dynamic.";
  }
  const cleaned = topic.trim();
  if (!cleaned) {
    return "Useful when it fits the person instead of replacing the dynamic.";
  }
  const verb = /\b(and|or)\b/i.test(cleaned) || /\b\w+s\b/i.test(cleaned) ? "fit" : "fits";
  return `Useful when ${cleaned} ${verb} the person instead of replacing the dynamic.`;
}

export function isTopicInitiationRequest(text: string): boolean {
  return isCoreTopicLeadRequest(text);
}

function buildTopicOpening(topic: string): string {
  const cleaned = cleanTopic(topic) ?? "control and why people keep mistaking it for relief";
  return `Fine. Then start with ${cleaned}. Tell me where it stops being an idea and starts asking something from you.`;
}

export function buildTopicInitiationReply(input: {
  userText: string;
  currentTopic?: string | null;
  previousAssistantText?: string | null;
  tone?: QuestionToneProfile;
}): string {
  return withDominantPrefix(
    buildConversationLeadReply({
      userText: input.userText,
      currentTopic: input.currentTopic,
      previousAssistantText: input.previousAssistantText,
    }),
    input.tone ?? "neutral",
  );
}

export function analyzeOpenQuestion(text: string): OpenQuestionAnalysis {
  const normalized = normalize(text).toLowerCase();
  const topic = extractTopic(text);

  if (isBroadConversationContinuationPrompt(text)) {
    return { normalized, kind: "continuation", topic: null };
  }
  if (/\bwhat do you want (?:from me|me to do|to do)\b/.test(normalized)) {
    return { normalized, kind: "expectation", topic };
  }
  if (isAssistantServiceQuestion(normalized)) {
    return { normalized, kind: "expectation", topic: "usefulness and training" };
  }
  if (
    /\bwhat do you think about\b/.test(normalized) ||
    /^what do you think\??$/.test(normalized) ||
    /\bwhat are your thoughts on\b/.test(normalized) ||
    /\bwhat'?s your take\b/.test(normalized) ||
    /\bhow do you feel about\b/.test(normalized)
  ) {
    return { normalized, kind: "opinion", topic };
  }
  if (/\b(?:talk about|discuss|explore|what about)\b/.test(normalized)) {
    return { normalized, kind: "topic_exploration", topic };
  }
  if (/^(why|why does|why do|why did)\b/.test(normalized) || /\bhow so\b/.test(normalized)) {
    return { normalized, kind: "reason", topic };
  }
  if (/^(how|how do|how does|how should|then what|what next)\b/.test(normalized)) {
    return { normalized, kind: "process", topic };
  }
  if (/^(can|could|would|will)\b/.test(normalized)) {
    return { normalized, kind: "permission", topic };
  }
  if (/^(which|what'?s the difference|difference between|better)\b/.test(normalized)) {
    return { normalized, kind: "comparison", topic };
  }
  if (/^(what now|where are we|what happened|status)\b/.test(normalized)) {
    return { normalized, kind: "status", topic };
  }
  if (/^(what|who|when|where)\b/.test(normalized)) {
    return { normalized, kind: "definition", topic };
  }
  return { normalized, kind: "generic", topic };
}

export function buildHumanQuestionFallback(
  question: string,
  tone: QuestionToneProfile = "neutral",
  context?: OpenQuestionContext,
): string {
  const contextualTrainingReply = buildTrainingFollowUpReply({
    userText: question,
    thread: context?.trainingThread ?? null,
    inventory: context?.inventory,
  });
  if (contextualTrainingReply) {
    return withDominantPrefix(contextualTrainingReply, tone);
  }
  if (isBareOpinionQuestion(question) && context?.previousAssistantText) {
    return withDominantPrefix(buildPriorBeatOpinionReply(context.previousAssistantText), tone);
  }
  if (isTopicInitiationRequest(question)) {
    return buildTopicInitiationReply({
      userText: question,
      currentTopic: context?.currentTopic,
      previousAssistantText: context?.previousAssistantText,
      tone,
    });
  }
  if (isHowAreYouText(question)) {
    return withDominantPrefix(buildHowAreYouOpenReply(), tone);
  }
  if (
    /\b(what should i start with|where should i start|what do i start with)\b/i.test(
      normalize(question).toLowerCase(),
    ) &&
    hasServiceContext(context)
  ) {
    return withDominantPrefix(buildAssistantServiceStartReply(), tone);
  }
  const contextualPreferenceTopic = extractContextualPreferenceTopic(question, context);
  if (contextualPreferenceTopic) {
    return withDominantPrefix(buildAssistantPreferenceReply(`do you like ${contextualPreferenceTopic}`), tone);
  }
  if (isContextualServiceFollowUpQuestion(question, context)) {
    return withDominantPrefix(buildAssistantServiceFollowUpReply(question), tone);
  }
  if (isAssistantTrainingRequest(question)) {
    return withDominantPrefix(buildAssistantServiceReply(question, context), tone);
  }
  if (isServiceQuestion(question)) {
    return withDominantPrefix(buildAssistantServiceReply(question, context), tone);
  }
  if (isPreferenceQuestion(question)) {
    return withDominantPrefix(buildAssistantPreferenceReply(question), tone);
  }
  if (isGreetingText(question)) {
    return withDominantPrefix(buildOpenChatGreeting(), tone);
  }
  const conversationReply = buildCoreConversationReply({
    userText: question,
    previousAssistantText: context?.previousAssistantText,
    currentTopic: context?.currentTopic,
  });
  if (conversationReply && !isLikelyQuestionText(question)) {
    return withDominantPrefix(conversationReply, tone);
  }
  if (isShortClarificationTurn(question)) {
    return withDominantPrefix(
      buildShortClarificationReply({
        userText: question,
        interactionMode: "question_answering",
        lastAssistantText: context?.previousAssistantText ?? null,
        currentTopic: context?.currentTopic ?? null,
      }),
      tone,
    );
  }
  if (!isLikelyQuestionText(question)) {
    return withDominantPrefix(buildOpenChatNudge(), tone);
  }
  const analysis = analyzeOpenQuestion(question);
  const topicPhrase = analysis.topic ? ` ${analysis.topic}` : "";
  const definitionSubject = extractDefinitionSubject(question);

  switch (analysis.kind) {
    case "expectation":
      return withDominantPrefix(
        "I want honesty, nerve, and enough obedience to stay with the line. Now tell me what you are after.",
        tone,
      );
    case "continuation":
      return withDominantPrefix(
        buildConversationContinuationReply({
          userText: question,
          currentTopic: context?.currentTopic,
          previousAssistantText: context?.previousAssistantText,
        }),
        tone,
      );
    case "topic_exploration":
      return withDominantPrefix(
        analysis.topic
          ? `We can stay on${topicPhrase}. Tell me what it actually changes between people.`
          : "We can stay on that. Tell me what it actually changes between people.",
        tone,
      );
    case "opinion":
      return withDominantPrefix(
        `${buildOpinionLead(analysis.topic)} I care more about intention, control, and what it does to the exchange than the object by itself.`,
        tone,
      );
    case "reason":
      return withDominantPrefix(
        "Because that is where I can tell what someone actually wants instead of what they think sounds good.",
        tone,
      );
    case "process":
      return withDominantPrefix(
        analysis.topic
          ? `Start with${topicPhrase}. Tell me what happens there first.`
          : "Start with the part that actually matters. Tell me what happens there first.",
        tone,
      );
    case "permission":
      return withDominantPrefix(
        "Yes. Ask me directly, and I will answer you directly.",
        tone,
      );
    case "comparison":
      return withDominantPrefix(
        analysis.topic
          ? `If you want to compare${topicPhrase}, put the two real options in front of me and I will sort them out.`
          : "Give me the two real options, and I will sort them out.",
        tone,
      );
    case "status":
      return withDominantPrefix(
        "We are still on the same thread. If you want status, ask about the point, the current rule, or the next move.",
        tone,
      );
    case "definition":
      if (analysis.topic || definitionSubject) {
        const subject = cleanTopic(analysis.topic ?? definitionSubject);
        if (subject && !isWeakConversationTopic(subject) && !isWeakDefinitionSubject(subject)) {
          return withDominantPrefix(
            `If you mean ${subject}, I care less about the label and more about how it actually shows up between people.`,
            tone,
          );
        }
      }
      return withDominantPrefix(
        buildConversationContinuationReply({
          userText: question,
          currentTopic: context?.currentTopic,
          previousAssistantText: context?.previousAssistantText,
        }),
        tone,
      );
    default:
      return withDominantPrefix(
        context?.previousAssistantText
          ? buildConversationContinuationReply({
              userText: question,
              currentTopic: context.currentTopic,
              previousAssistantText: context.previousAssistantText,
            })
          : "Ask me directly, and I will answer you directly.",
        tone,
      );
  }
}
