import {
  buildClarifyNudge,
  buildOpenChatChoiceGreeting,
  buildHowAreYouOpenReply,
  buildOpenChatGreeting,
  buildOpenChatNudge,
  buildRelationalTurnBack,
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
  interpretTurnMeaning,
  planSemanticResponse,
  type PlannedMove,
  type TurnMeaning,
} from "../session/turn-meaning.ts";
import {
  answerRavenPreferenceQuestion,
  answerRavenSelfDisclosure,
  buildRavenReciprocalFollowUp,
  elaborateRavenPreference,
  explainRavenApplicationOfUserPreference,
  reviseRavenPreferenceClaim,
} from "../session/raven-profile.ts";
import {
  extractAssistantGeneralPreferenceTopic,
  extractAssistantPreferenceTopic,
  isAssistantGeneralPreferenceQuestion,
  isAssistantTrainingRequest,
  isAssistantServiceQuestion,
  isAssistantPreferenceQuestion,
  isMutualGettingToKnowRequest,
  isProfileBuildingRequest,
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
  return /^(hi|hello|hey)(?:\s+(?:miss\s+raven|mistress|miss|raven|ma'am|mam))?$/.test(
    normalized,
  );
}

function isTitledGreetingText(text: string): boolean {
  return /^(hi|hello|hey)\s+(?:miss\s+raven|mistress|miss|raven|ma'am|mam)$/.test(
    normalize(text).toLowerCase(),
  );
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

const RELATIONAL_PREFERENCE_DOMAIN_PATTERN =
  /\b(pegging|bondage|restraint|rope|cuffs?|collars?|chastity|cages?|plug|dildo|vibrator|wand|toy|toys|fetish|fetishes|kink|kinks|spanking|impact|pain|obedience|submission|dominance|control|humiliation|degradation|praise|service|strap-?on|anal(?:\s+play|\s+training)?|oral(?:\s+training)?|throat(?:\s+training)?)\b/i;

function hasPreferenceContext(context?: OpenQuestionContext): boolean {
  const combined = normalize(
    `${context?.previousAssistantText ?? ""} ${context?.currentTopic ?? ""}`,
  ).toLowerCase();
  return (
    /\b(control with purpose|power exchange|bondage|restraint|obedience|submission|toys?|plug|dildo|anal training|service with teeth)\b/.test(
      combined,
    ) || RELATIONAL_PREFERENCE_DOMAIN_PATTERN.test(combined)
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
  const cleanedCapture = cleanRecentReferent(capture.trim());
  if (cleanedCapture && /^(?:it|that|this)$/i.test(cleanedCapture)) {
    return extractRecentPreferenceReferent(context);
  }
  const directTopic = extractAssistantPreferenceTopic(`do you like ${capture}`);
  if (directTopic) {
    return directTopic;
  }
  if (!hasPreferenceContext(context)) {
    return null;
  }
  return cleanedCapture ?? capture.trim();
}

function isReciprocalInterestOfferQuestion(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\b(?:would you like to know mine|want to hear mine|should i tell you mine)\b/.test(
      normalized,
    ) ||
    /\bdo you want to know anything(?: else)? about me\b/.test(normalized)
  );
}

function extractRelationalPreferenceDisclosure(question: string): string | null {
  return cleanTopic(
    question.match(/\b(?:i like|i enjoy|i love|i'm into|i am into)\s+([^?.!,]{2,80})/i)?.[1] ??
      question.match(/\b(?:for me it'?s|for me it is)\s+([^?.!,]{2,80})/i)?.[1] ??
      question.match(/\b(?:mine is|my thing is)\s+([^?.!,]{2,80})/i)?.[1] ??
      null,
  );
}

function buildPreferenceDisclosureFollowUp(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  if (isLikelyQuestionText(question)) {
    return null;
  }
  const statedPreference = extractRelationalPreferenceDisclosure(question);
  if (!statedPreference) {
    return null;
  }
  const previous = normalize(context?.previousAssistantText ?? "").toLowerCase();
  const invitedDisclosure =
    /\b(what pulls at you hardest|what about it lands for you hardest|what actually lands for you there|what part of it is the real pull|what side of that actually pulls at you|what do you reach for first|what kind of service do you actually imagine)\b/.test(
      previous,
    ) || hasPreferenceContext(context);
  if (!invitedDisclosure) {
    return null;
  }
  return `${capitalizeFirst(statedPreference)}. Good. What is the real pull for you there: the control, the sensation, the trust, or the shift in the dynamic?`;
}

function cleanRecentReferent(value: string | null | undefined): string | null {
  const cleaned = cleanTopic(value);
  if (!cleaned) {
    return null;
  }
  if (
    /^(?:it|that|this|something|anything|none|question|answer|part|thing|what i want to know about you|what you want to know about me|what you can do for me)$/i.test(
      cleaned,
    )
  ) {
    return null;
  }
  return cleaned.split(/\s+/).length <= 4 ? cleaned : null;
}

function extractRecentPreferenceReferent(context?: OpenQuestionContext): string | null {
  const previousAssistantMatch = normalize(context?.previousAssistantText ?? "").match(
    RELATIONAL_PREFERENCE_DOMAIN_PATTERN,
  )?.[0];
  const previousAssistantReferent = cleanRecentReferent(previousAssistantMatch);
  if (previousAssistantReferent) {
    return previousAssistantReferent;
  }
  const topicReferent = cleanRecentReferent(context?.currentTopic ?? null);
  if (topicReferent && RELATIONAL_PREFERENCE_DOMAIN_PATTERN.test(topicReferent)) {
    return topicReferent;
  }
  return null;
}

function buildReciprocalInterestReply(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  if (!isReciprocalInterestOfferQuestion(question)) {
    return null;
  }
  const turnMeaning = interpretTurnMeaning({
    userText: question,
    previousAssistantText: context?.previousAssistantText ?? null,
    currentTopic: context?.currentTopic ?? null,
  });
  return buildRavenReciprocalFollowUp({ userText: question, turnMeaning });
}

function isAssistantPreferenceExpansionQuestion(
  question: string,
  context?: OpenQuestionContext,
): boolean {
  const normalized = normalize(question).toLowerCase();
  if (
    !/^(?:what other [^?.!,]{2,60} do you like|what else do you like|any other (?:kinks|fetishes|toys|preferences))\??$/.test(
      normalized,
    )
  ) {
    return false;
  }
  return (
    hasPreferenceContext(context) ||
    /\b(kinks|fetishes|toys|preferences)\b/.test(normalized)
  );
}

function buildAssistantPreferenceExpansionReply(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  if (!isAssistantPreferenceExpansionQuestion(question, context)) {
    return null;
  }
  const turnMeaning = interpretTurnMeaning({
    userText: question,
    previousAssistantText: context?.previousAssistantText ?? null,
    currentTopic: context?.currentTopic ?? null,
  });
  const plannedMove = planSemanticResponse(turnMeaning);
  return elaborateRavenPreference({ userText: question, turnMeaning, plannedMove });
}

function buildPronounPreferenceFollowUpReply(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  if (!/^\s*do you (?:like|enjoy) it\??\s*$/i.test(normalize(question))) {
    return null;
  }
  const referent = extractRecentPreferenceReferent(context);
  if (!referent) {
    return null;
  }
  const directPreferenceTopic = extractAssistantPreferenceTopic(`do you like ${referent}`);
  if (directPreferenceTopic) {
    return buildAssistantPreferenceReply(`do you like ${directPreferenceTopic}`);
  }
  if (!hasPreferenceContext({
    previousAssistantText: `${context?.previousAssistantText ?? ""} ${referent}`,
    currentTopic: context?.currentTopic ?? null,
  })) {
    return null;
  }
  return buildAssistantSelfDisclosureReply(`what do you like about ${referent}`);
}

function hasServiceContext(context?: OpenQuestionContext): boolean {
  const combined = normalize(
    `${context?.previousAssistantText ?? ""} ${context?.currentTopic ?? ""}`,
  ).toLowerCase();
  return /\b(useful|usefulness|trained|training|trainable|serve|service|follow through|follow-through|consistency|honesty|structure|steadiness|answer cleanly|obedience|drill|permission|cuffs?|collars?|plug|prove first|notice first)\b/.test(
    combined,
  );
}

function buildPreferenceReasonReply(question: string): string | null {
  const topic = cleanTopic(
    question.match(/^why do (?:people|some people) like\s+([^?.!,]{2,80})\??$/i)?.[1],
  );
  if (!topic || !RELATIONAL_PREFERENCE_DOMAIN_PATTERN.test(topic)) {
    return null;
  }
  return `${capitalizeFirst(topic)} usually appeals for a mix of sensation, control, trust, novelty, or the shift in who is doing what. Most of the time it is about the dynamic, not just the act. Which side of ${topic} are you actually asking about?`;
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

function buildProfileQuestionFallback(question: string, context?: OpenQuestionContext): string | null {
  const normalized = normalize(question).toLowerCase();
  const previous = normalize(context?.previousAssistantText ?? "").toLowerCase();
  const statedPreference =
    cleanTopic(
      question.match(/\b(?:i like|i enjoy|i love)\s+([^?.!,]{2,80})/i)?.[1] ??
        question.match(/\b(?:it'?s|it is)\s+([^?.!,]{2,80})/i)?.[1] ??
        question,
    ) ?? null;

  if (
    /\bwhat do you actually enjoy doing when you are off the clock\b/.test(previous) &&
    statedPreference &&
    !isLikelyQuestionText(question)
  ) {
    return `${capitalizeFirst(statedPreference)}. Good. What else should I know about your boundaries or the things you do not want pushed?`;
  }
  if (/\bask me more questions\b/.test(normalized)) {
    return "Good. I will ask more. What is one thing people usually miss about you that I should not miss?";
  }
  if (
    /\b(tell me more about me|what do you want to know about me|where do we start|okay ask|ok ask)\b/.test(
      normalized,
    )
  ) {
    return "Fine. Start simple. What do you actually enjoy doing when you are off the clock?";
  }
  if (/\bask me something real\b/.test(normalized)) {
    return "Good. Start with the thing people usually miss about you that I should not miss.";
  }
  if (isProfileBuildingRequest(question)) {
    return "Fine. Start simple. What do you actually enjoy doing when you are off the clock?";
  }
  if (
    /\b(give me one more detail|tell me one thing people usually miss about you|what else should i know about your boundaries)\b/.test(
      previous,
    )
  ) {
    return "Good. Stay on you. Tell me one thing people usually miss about you that I should keep in mind.";
  }
  return null;
}

function buildChoiceOrThreadContinuationFallback(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  const normalized = normalize(question).toLowerCase();
  const previous = normalize(context?.previousAssistantText ?? "").toLowerCase();

  if (
    /\bwhat has your attention tonight\b/.test(previous) &&
    /\bchat\b/.test(previous) &&
    /\bplan\b/.test(previous) &&
    /\bgame\b/.test(previous)
  ) {
    if (normalized === "chat") {
      return "Fine. What has the most pressure on you right now?";
    }
    if (normalized === "plan") {
      return "Fine. What are we planning first?";
    }
    if (normalized === "game") {
      return "Fine. Do you want something quick, or do you want me to pick?";
    }
  }

  if (/\bwhat has the most pressure on you right now\b/.test(previous)) {
    if (/^\s*work\s*$/i.test(normalized)) {
      return "Good. Is it workload, a person, or a decision you keep circling?";
    }
    if (/^\s*(?:a )?person\s*$/i.test(normalized)) {
      return "Good. Is it pressure from them, a pattern between you, or something you still have not said cleanly?";
    }
    if (/^\s*(?:a )?(?:decision|choice)\s*$/i.test(normalized)) {
      return "Good. Is it one you keep delaying, one you regret, or one that changes the week if you make it?";
    }
  }

  return null;
}

function buildCasualDisclosureFollowUp(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  const previous = normalize(context?.previousAssistantText ?? "").toLowerCase();
  const statedPreference =
    cleanTopic(
      question.match(/\b(?:i like|i enjoy|i love)\s+([^?.!,]{2,80})/i)?.[1] ??
        question.match(/\bmy hobbies are\s+([^?.!,]{2,80})/i)?.[1],
    ) ?? null;

  if (!statedPreference || isLikelyQuestionText(question)) {
    return null;
  }

  if (
    /\b(talk to me normally|what is actually on your mind|what has your attention tonight|for a minute)\b/.test(
      previous,
    )
  ) {
    if (/\bgolf\b/i.test(statedPreference)) {
      return "Golf. Good. What do you like about it most: the focus, the quiet, or the competition?";
    }
    return `${capitalizeFirst(statedPreference)}. Good. What about it actually keeps you there when your head needs somewhere to go?`;
  }

  return null;
}

function buildPlanningDetourBridge(planningWindow: string | null): string {
  if (planningWindow === "week") {
    return "Good. One round first, then we return to the week. Do you want something quick, or do you want me to pick?";
  }
  if (planningWindow === "saturday") {
    return "Good. One round first, then we return to Saturday. Do you want something quick, or do you want me to pick?";
  }
  if (planningWindow === "tomorrow morning" || planningWindow === "morning") {
    return "Good. One round first, then we return to tomorrow morning. Do you want something quick, or do you want me to pick?";
  }
  if (planningWindow === "evening" || planningWindow === "tonight") {
    return "Good. One round first, then we return to the evening plan. Do you want something quick, or do you want me to pick?";
  }
  return "Good. One round first, then we return to the plan. Do you want something quick, or do you want me to pick?";
}

function isPlanningOpener(text: string): boolean {
  return /\b(?:help(?: me)? plan|let'?s plan|help me figure out|plan my|plan tomorrow|plan saturday|plan the week|plan this week)\b/i.test(
    text,
  );
}

function isPlanningReturnRequest(text: string): boolean {
  return /\b(?:go back|back to|return to)\b/i.test(text);
}

function isPlanningContinuationCue(text: string): boolean {
  return /^(?:keep going|go on|continue|then what|what next|and then what|ok(?:ay)?|why|what do you mean)\??$/i.test(
    normalize(text),
  );
}

function hasPlanningContext(question: string, context?: OpenQuestionContext): boolean {
  const combined = normalize(
    `${question} ${context?.previousAssistantText ?? ""} ${context?.currentTopic ?? ""}`,
  ).toLowerCase();
  return (
    isPlanningOpener(question) ||
    isPlanningReturnRequest(question) ||
    /\b(plan|planning|workdays|weekends|errands first|gym first|downtime first|morning plan|morning block|wake time|focused hour|first block|evening stays|saturday|tomorrow morning)\b/.test(
      combined,
    )
  );
}

function extractPlanningWindow(question: string, context?: OpenQuestionContext): string | null {
  const combined = normalize(
    `${question} ${context?.previousAssistantText ?? ""} ${context?.currentTopic ?? ""}`,
  ).toLowerCase();
  if (/\btomorrow morning\b/.test(combined)) {
    return "tomorrow morning";
  }
  if (/\bsaturday\b/.test(combined)) {
    return "saturday";
  }
  if (/\bweek\b/.test(combined)) {
    return "week";
  }
  if (/\bevening\b/.test(combined)) {
    return "evening";
  }
  if (/\btonight\b/.test(combined)) {
    return "tonight";
  }
  if (/\bmorning\b/.test(combined)) {
    return "morning";
  }
  return null;
}

export function buildPlanningQuestionFallback(
  question: string,
  context?: OpenQuestionContext,
): string | null {
  const normalized = normalize(question).toLowerCase();
  const previous = normalize(context?.previousAssistantText ?? "").toLowerCase();
  const planningWindow = extractPlanningWindow(question, context);

  if (!hasPlanningContext(question, context)) {
    return null;
  }

  if (/\b(?:play a game|game first|let'?s play|lets play)\b/.test(normalized)) {
    return buildPlanningDetourBridge(planningWindow);
  }

  if (isPlanningOpener(question)) {
    if (planningWindow === "week") {
      return "Fine. Workdays first or weekends first?";
    }
    if (planningWindow === "saturday") {
      return "Fine. Do you want errands first, gym first, or downtime first?";
    }
    if (planningWindow === "tomorrow morning" || planningWindow === "morning") {
      return "Fine. Start with the anchor. What time does tomorrow morning begin?";
    }
    if (planningWindow === "evening" || planningWindow === "tonight") {
      return "Fine. Start with the anchor. What time does the evening actually begin?";
    }
    return "Fine. Start with the anchor. What is the first block we need to place cleanly?";
  }

  if (/\bworkdays first or weekends first\b/.test(previous)) {
    if (/^\s*workdays first\s*$/i.test(normalized)) {
      return "Good. Workdays first. Lock your wake time, your first work block, and one clean stopping point before we touch the weekend.";
    }
    if (/^\s*weekends first\s*$/i.test(normalized)) {
      return "Good. Weekends first. Lock the one thing that actually needs energy, then we can make the workdays cleaner around it.";
    }
  }

  if (/\bdo you want errands first, gym first, or downtime first\b/.test(previous)) {
    if (/^\s*errands first\s*$/i.test(normalized)) {
      return "Good. Errands first while the day is clean, then gym, then the evening stays open.";
    }
    if (/^\s*gym first\s*$/i.test(normalized)) {
      return "Good. Gym first while your energy is still clean, then errands, then the evening stays open.";
    }
    if (/^\s*downtime first\s*$/i.test(normalized)) {
      return "Good. Downtime first to settle the pace, then errands, then gym once you are actually awake.";
    }
  }

  if (
    planningWindow === "saturday" &&
    /\berrands first\b/.test(previous)
  ) {
    if (/^\s*why\??\s*$/i.test(normalized) || /^what do you mean\??$/i.test(normalized)) {
      return "Because errands spill if you push them late. This keeps the rest of Saturday cleaner.";
    }
    if (/^(?:then what|what next|and then what)\??$/i.test(normalized)) {
      return "Then gym, then food, then the evening stays flexible.";
    }
    if (/\bchange that\b/i.test(normalized) && /\bgym\b/i.test(normalized) && /\berrands\b/i.test(normalized)) {
      return "Fine. Gym first, errands second, evening still open. The thread stays the same, only the order changes.";
    }
    if (/\bevening\b/.test(normalized)) {
      return "Keep the evening light. One social thing at most, then a clean stop.";
    }
    if (isPlanningContinuationCue(question)) {
      return "Good. After errands, move to the gym, then keep the evening light instead of letting it sprawl.";
    }
  }

  if (/\bwhat time does tomorrow morning begin\b/.test(previous)) {
    const time = question.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i)?.[0]?.trim();
    if (time) {
      return `Good. Start at ${time}. Lock the wake time first, then protect one focused hour before anything noisy.`;
    }
  }

  if (/\berrands first while the day is clean, then gym, then the evening stays open\b/.test(previous)) {
    if (/^\s*why\??\s*$/i.test(normalized) || /^what do you mean\??$/i.test(normalized)) {
      return "Because errands spill if you push them late. This keeps the rest of Saturday cleaner.";
    }
    if (/^(?:then what|what next|and then what)\??$/i.test(normalized)) {
      return "Then gym, then food, then the evening stays flexible.";
    }
    if (/\bchange that\b/i.test(normalized) && /\bgym\b/i.test(normalized) && /\berrands\b/i.test(normalized)) {
      return "Fine. Gym first, errands second, evening still open. The thread stays the same, only the order changes.";
    }
    if (/\bevening\b/.test(normalized)) {
      return "Keep the evening light. One social thing at most, then a clean stop.";
    }
    if (isPlanningContinuationCue(question)) {
      return "Good. After errands, move to the gym, then keep the evening light instead of letting it sprawl.";
    }
  }

  if (/\bbecause errands spill if you push them late\b/.test(previous)) {
    if (/^(?:then what|what next|and then what)\??$/i.test(normalized)) {
      return "Then gym, then food, then the evening stays flexible.";
    }
    if (/\bevening\b/.test(normalized)) {
      return "Keep the evening light. One social thing at most, then a clean stop.";
    }
  }

  if (
    /\bone round\b/.test(normalized) &&
    isPlanningReturnRequest(question) &&
    /\bmorning plan\b/i.test(normalized)
  ) {
    return "Good. After this round, we return to the morning plan and lock the first block cleanly.";
  }

  if (
    /\bafter this round, we return to the morning plan and lock the first block cleanly\b/.test(
      previous,
    ) &&
    (isPlanningReturnRequest(question) || /\bmorning block\b/i.test(normalized))
  ) {
    return "Fine. Back to the morning block. Start by fixing the wake time, then protect one focused hour before anything noisy.";
  }

  if (
    /\b(?:go back|back to|return to)\b/i.test(normalized) &&
    /\bmorning\b/i.test(normalized)
  ) {
    return "Fine. Back to the morning block. Start by fixing the wake time, then protect one focused hour before anything noisy.";
  }

  if (planningWindow === "week" && isPlanningContinuationCue(question)) {
    return "Good. Keep the week thread clean. Lock the workdays first, then decide what the weekend is actually for.";
  }
  if ((planningWindow === "tomorrow morning" || planningWindow === "morning") && isPlanningContinuationCue(question)) {
    return "Good. Stay on the morning block. Fix the wake time first, then protect one focused hour before anything noisy.";
  }
  if (planningWindow === "saturday" && isPlanningContinuationCue(question)) {
    if (/^\s*why\??\s*$/i.test(normalized) || /^what do you mean\??$/i.test(normalized)) {
      return "Because the first block sets the pace. If Saturday starts scattered, the rest of it leaks after that.";
    }
    if (/^(?:then what|what next|and then what)\??$/i.test(normalized)) {
      return "Then the second block lands clean, then food, then the evening stays open instead of sprawling.";
    }
    if (/\bchange that\b/i.test(normalized) && /\bgym\b/i.test(normalized) && /\berrands\b/i.test(normalized)) {
      return "Fine. Gym first, errands second, evening still open. The thread stays the same, only the order changes.";
    }
    if (/\bevening\b/.test(normalized)) {
      return "Keep the evening light. One social thing at most, then a clean stop.";
    }
    return "Good. Keep Saturday clean: first block, second block, then an evening that still has room to breathe.";
  }

  return null;
}

export function buildAssistantPreferenceReply(question: string): string {
  const turnMeaning = interpretTurnMeaning({ userText: question });
  const plannedMove = planSemanticResponse(turnMeaning);
  return answerRavenPreferenceQuestion({ userText: question, turnMeaning, plannedMove });
}

export function buildAssistantSelfDisclosureReply(question: string): string {
  const turnMeaning = interpretTurnMeaning({ userText: question });
  const plannedMove = planSemanticResponse(turnMeaning);
  return answerRavenSelfDisclosure({ userText: question, turnMeaning, plannedMove });
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
    return "Usefulness is simple. Be clear, follow through, and stop making me drag the truth out of you. If you want to offer me something, start there.";
  }
  return "Start with clarity. Mean what you say, do what you promise, and hold steady once it costs you something. That is the part I pay attention to.";
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
  return "Start with consistency. Say it cleanly, do what you promised, and keep your nerve long enough for it to mean something. That is where people usually fail first.";
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
    /^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|is|are|define)\b/.test(
      normalized,
    )
  );
}

function buildSimpleArithmeticAnswer(question: string): string | null {
  const normalized = normalize(question).toLowerCase();
  const match = normalized.match(
    /^(?:what(?:'s| is)?|calculate|compute|solve)\s+(-?\d+(?:\.\d+)?)\s*(\+|plus|-|minus|\*|x|times|\/|divided by)\s*(-?\d+(?:\.\d+)?)\??$/,
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const left = Number(match[1]);
  const right = Number(match[3]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  let value: number;
  switch (match[2]) {
    case "+":
    case "plus":
      value = left + right;
      break;
    case "-":
    case "minus":
      value = left - right;
      break;
    case "*":
    case "x":
    case "times":
      value = left * right;
      break;
    case "/":
    case "divided by":
      if (right === 0) {
        return "That division is undefined because you are dividing by zero.";
      }
      value = left / right;
      break;
    default:
      return null;
  }
  return `${match[1]} ${match[2]} ${match[3]} is ${Number.isInteger(value) ? value : Number(value.toFixed(6))}.`;
}

type LocalDefinitionEntry = {
  term: string;
  aliases?: string[];
  definition: string;
};

const LOCAL_TERM_DEFINITIONS: LocalDefinitionEntry[] = [
  {
    term: "female-led relationship",
    aliases: ["female led relationship"],
    definition:
      "It is a consensual relationship dynamic where the woman or feminine partner takes the primary leadership role, with expectations, boundaries, and decision-making negotiated rather than assumed.",
  },
  {
    term: "consensual non-consent",
    aliases: ["consensual non consent"],
    definition:
      "It is negotiated roleplay where participants consent in advance to scenes that simulate reluctance, force, or resistance, with clear boundaries, limits, and safewords.",
  },
];

function normalizeDefinitionKey(value: string): string {
  return normalize(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildInitialism(value: string): string | null {
  const words = normalizeDefinitionKey(value)
    .split(/[\s-]+/)
    .filter((word) => /^[a-z0-9]+$/.test(word));
  if (words.length < 2) {
    return null;
  }
  return words.map((word) => word.charAt(0)).join("");
}

function getDefinitionKeys(entry: LocalDefinitionEntry): string[] {
  const phrases = [entry.term, ...(entry.aliases ?? [])];
  const keys = new Set<string>();
  for (const phrase of phrases) {
    const normalized = normalizeDefinitionKey(phrase);
    if (normalized) {
      keys.add(normalized);
    }
    const initialism = buildInitialism(phrase);
    if (initialism) {
      keys.add(initialism);
    }
  }
  return [...keys];
}

function buildLocalTermDefinitionAnswer(subject: string | null): string | null {
  const normalizedSubject = subject ? normalizeDefinitionKey(subject) : "";
  if (!normalizedSubject) {
    return null;
  }
  const entry = LOCAL_TERM_DEFINITIONS.find((candidate) =>
    getDefinitionKeys(candidate).includes(normalizedSubject),
  );
  if (!entry) {
    return null;
  }
  const termInitialism = buildInitialism(entry.term);
  if (termInitialism && normalizedSubject === termInitialism) {
    return `${normalizedSubject.toUpperCase()} means ${entry.term}. ${entry.definition}`;
  }
  return `${capitalizeFirst(entry.term)}: ${entry.definition}`;
}

function buildKnownDirectAnswer(question: string): string | null {
  const normalized = normalize(question).toLowerCase();
  const localDefinitionAnswer = buildLocalTermDefinitionAnswer(
    extractDirectDefinitionSubject(question),
  );
  if (localDefinitionAnswer) {
    return localDefinitionAnswer;
  }
  if (
    /\bwhat(?:'s| is)\s+the weather like\b/i.test(normalized) ||
    (/\bweather\b/i.test(normalized) && /\b(today|right now|by you|where you are|there)\b/i.test(normalized))
  ) {
    return "I do not have a local body or a live weather feed, so I cannot tell you the weather by me. If you want the real conditions, check a local forecast for your area.";
  }
  if (/^(?:what(?:'s| is)?|define)\s+spring\s*boot\??$/i.test(normalized)) {
    return "Spring Boot is a Java framework built on Spring that helps you create standalone applications quickly, usually with auto-configuration and embedded servers.";
  }
  if (/^(?:what(?:'s| is)?|define)\s+oauth\??$/i.test(normalized)) {
    return "OAuth is an authorization standard that lets one application request limited access to another service on a user's behalf without sharing the user's password.";
  }
  if (/^who wrote\s+hamlet\??$/i.test(normalized)) {
    return "Hamlet was written by William Shakespeare.";
  }
  if (/^(?:what(?:'s| is)?|define)\s+pegging\??$/i.test(normalized)) {
    return "Pegging is a sexual activity where one partner uses a strap-on to penetrate the other anally.";
  }
  if (/^what color is\s+the sky\??$/i.test(normalized)) {
    return "The sky usually looks blue in daylight, though it can also appear gray, orange, pink, or black depending on the weather and the time of day.";
  }
  return null;
}

function buildSemanticPlannedReply(
  question: string,
  tone: QuestionToneProfile,
  context?: OpenQuestionContext,
): string | null {
  const turnMeaning = interpretTurnMeaning({
    userText: question,
    previousAssistantText: context?.previousAssistantText ?? null,
    currentTopic: context?.currentTopic ?? null,
  });
  const plannedMove = planSemanticResponse(turnMeaning);
  const answer = realizeSemanticContent(question, turnMeaning, plannedMove, context);
  return answer ? applyPersonaStyle(answer, turnMeaning, plannedMove, tone) : null;
}

export function realizeSemanticContent(
  question: string,
  turnMeaning: TurnMeaning,
  plannedMove: PlannedMove,
  context?: OpenQuestionContext,
): string | null {
  switch (plannedMove.content_key) {
    case "greeting_open":
      return isTitledGreetingText(question) ? buildOpenChatChoiceGreeting() : buildOpenChatGreeting();
    case "assistant_preference_answer":
      if (/^\s*do you (?:like|enjoy) it\??\s*$/i.test(normalize(question)) && turnMeaning.referent) {
        return answerRavenPreferenceQuestion({ userText: question, turnMeaning, plannedMove });
      }
      return answerRavenPreferenceQuestion({ userText: question, turnMeaning, plannedMove });
    case "raven_invitation_answer":
      return answerRavenPreferenceQuestion({ userText: question, turnMeaning, plannedMove });
    case "assistant_preference_elaboration":
      return elaborateRavenPreference({ userText: question, turnMeaning, plannedMove });
    case "assistant_preference_revision":
      return reviseRavenPreferenceClaim({ userText: question, turnMeaning, plannedMove });
    case "user_preference_application":
      return explainRavenApplicationOfUserPreference({ turnMeaning, plannedMove });
    case "reciprocal_user_probe":
      return buildRavenReciprocalFollowUp({ userText: question, turnMeaning });
    case "definition_answer":
    case "factual_answer":
      return buildKnownDirectAnswer(question);
    case "clarification_answer":
    case "conversation_continue":
    case "unknown_clarify":
      return null;
    default:
      return null;
  }
}

export function applyPersonaStyle(
  text: string,
  turnMeaning: TurnMeaning,
  plannedMove: PlannedMove,
  _tone: QuestionToneProfile,
): string {
  void _tone;
  void turnMeaning;
  void plannedMove;
  // Style is deliberately post-semantic and identity-only here: it may not change
  // the selected move, requested operation, or referent. Future style wrappers
  // must preserve those fields and only decorate already-realized content.
  return text;
}

function withDominantPrefix(text: string, tone: QuestionToneProfile): string {
  void tone;
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

function capitalizeFirst(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function extractDirectDefinitionSubject(text: string): string | null {
  const patterns = [
    /^define\s+([^?!.,]{2,80})/i,
    /^what\s+does\s+([^?!.,]{2,80})\s+mean\??$/i,
    /^who wrote\s+([^?!.,]{2,80})/i,
    /^what color is\s+([^?!.,]{2,80})/i,
    /^(?:what(?:'s| is)?|who(?: is)?|where(?: is)?|when(?: is)?)\s+([^?!.,]{2,80})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const subject = cleanTopic(match?.[1]);
    if (subject) {
      return subject;
    }
  }
  return null;
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
  if (/^(what|who|when|where|define)\b/.test(normalized)) {
    return { normalized, kind: "definition", topic };
  }
  return { normalized, kind: "generic", topic };
}

export function buildHumanQuestionFallback(
  question: string,
  tone: QuestionToneProfile = "neutral",
  context?: OpenQuestionContext,
): string {
  if (/^\s*tell me more about you\s*$/i.test(normalize(question))) {
    return withDominantPrefix(buildRelationalTurnBack(), tone);
  }
  const semanticReply = buildSemanticPlannedReply(question, tone, context);
  if (semanticReply) {
    return semanticReply;
  }
  const reciprocalInterestReply = buildReciprocalInterestReply(question, context);
  if (reciprocalInterestReply) {
    return withDominantPrefix(reciprocalInterestReply, tone);
  }
  const preferenceExpansionReply = buildAssistantPreferenceExpansionReply(question, context);
  if (preferenceExpansionReply) {
    return withDominantPrefix(preferenceExpansionReply, tone);
  }
  const preferenceDisclosureFollowUp = buildPreferenceDisclosureFollowUp(question, context);
  if (preferenceDisclosureFollowUp) {
    return withDominantPrefix(preferenceDisclosureFollowUp, tone);
  }
  const planningQuestionFallback = buildPlanningQuestionFallback(question, context);
  if (planningQuestionFallback) {
    return withDominantPrefix(planningQuestionFallback, tone);
  }
  const profileQuestionFallback = buildProfileQuestionFallback(question, context);
  if (profileQuestionFallback) {
    return withDominantPrefix(profileQuestionFallback, tone);
  }
  const casualDisclosureFallback = buildCasualDisclosureFollowUp(question, context);
  if (casualDisclosureFallback) {
    return withDominantPrefix(casualDisclosureFallback, tone);
  }
  const choiceOrThreadFallback = buildChoiceOrThreadContinuationFallback(question, context);
  if (choiceOrThreadFallback) {
    return withDominantPrefix(choiceOrThreadFallback, tone);
  }
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
  const arithmeticAnswer = buildSimpleArithmeticAnswer(question);
  if (arithmeticAnswer) {
    return withDominantPrefix(arithmeticAnswer, tone);
  }
  const knownDirectAnswer = buildKnownDirectAnswer(question);
  if (knownDirectAnswer) {
    return withDominantPrefix(knownDirectAnswer, tone);
  }
  const preferenceReasonReply = buildPreferenceReasonReply(question);
  if (preferenceReasonReply) {
    return withDominantPrefix(preferenceReasonReply, tone);
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
  const pronounPreferenceReply = buildPronounPreferenceFollowUpReply(question, context);
  if (pronounPreferenceReply) {
    return withDominantPrefix(pronounPreferenceReply, tone);
  }
  const contextualPreferenceTopic = extractContextualPreferenceTopic(question, context);
  if (contextualPreferenceTopic) {
    return withDominantPrefix(
      buildAssistantPreferenceReply(`do you like ${contextualPreferenceTopic}`),
      tone,
    );
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
  if (isAssistantGeneralPreferenceQuestion(question)) {
    return withDominantPrefix(buildAssistantSelfDisclosureReply(question), tone);
  }
  if (isMutualGettingToKnowRequest(question)) {
    return withDominantPrefix(buildReciprocalInterestReply(question, context) ?? buildRelationalTurnBack(), tone);
  }
  if (isGreetingText(question)) {
    return withDominantPrefix(
      isTitledGreetingText(question) ? buildOpenChatChoiceGreeting() : buildOpenChatGreeting(),
      tone,
    );
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
  const definitionSubject = extractDirectDefinitionSubject(question);

  const buildDefinitionStyleReply = (): string => {
    const subject = cleanTopic(definitionSubject);
    if (!subject) {
      return "That should get a direct definition, not a continuation of the previous thread.";
    }
    if (/^who wrote\b/i.test(normalize(question))) {
      return `${capitalizeFirst(subject)} is the work you asked about. The direct factual answer should name its author.`;
    }
    if (/^what color is\b/i.test(normalize(question))) {
      return `${capitalizeFirst(subject)} is the thing you asked about. The direct answer should name its color.`;
    }
    return `I do not have a reliable local definition for ${subject} in this offline build, so I should not pretend one. Give me the domain you mean, and I can keep it precise.`;
  };

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
          return withDominantPrefix(buildDefinitionStyleReply(), tone);
        }
      }
      return withDominantPrefix(buildDefinitionStyleReply(), tone);
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
