import {
  extractAssistantGeneralPreferenceTopic,
  extractAssistantPreferenceTopic,
  isAssistantGeneralPreferenceQuestion,
  isAssistantPreferenceQuestion,
  normalizeAssistantSelfQuestionText,
} from "./interaction-mode.ts";

export type TurnSpeechAct =
  | "greeting"
  | "direct_question"
  | "self_disclosure"
  | "challenge"
  | "clarification"
  | "correction"
  | "preference_statement"
  | "reciprocal_offer"
  | "request_for_advice"
  | "request_for_examples"
  | "request_for_elaboration"
  | "continuation"
  | "unknown";

export type TurnTarget =
  | "assistant"
  | "user"
  | "shared_topic"
  | "prior_assistant_answer"
  | "prior_user_answer";

export type TurnSubjectDomain =
  | "assistant_preferences"
  | "user_preferences"
  | "definition"
  | "factual_question"
  | "relational_exchange"
  | "planning"
  | "game"
  | "task"
  | "general";

export type TurnRequestedOperation =
  | "answer"
  | "elaborate"
  | "clarify"
  | "revise"
  | "ask_follow_up"
  | "compare"
  | "explain_application"
  | "acknowledge_and_probe"
  | "continue";

export type TurnStance =
  | "neutral"
  | "curious"
  | "challenging"
  | "corrective"
  | "reciprocal"
  | "vulnerable";

export type TurnContinuityAttachment =
  | "immediate_prior_answer"
  | "active_thread"
  | "fresh_topic"
  | "none";

export type TurnQuestionShape =
  | "yes_no_about_item"
  | "binary_compare_or_choice"
  | "favorites_request"
  | "list_expansion"
  | "topic_drilldown"
  | "invitation_or_proposal"
  | "application_request"
  | "challenge_or_correction"
  | "clarification_request"
  | "definition_request"
  | "factual_request"
  | "greeting_or_opener"
  | "statement_or_disclosure"
  | "open_question"
  | "unknown";

export type TurnAnswerContract =
  | "answer_yes_no_with_item"
  | "compare_or_choose_between_entities"
  | "provide_favorites"
  | "expand_list"
  | "address_topic_directly"
  | "answer_invitation_or_boundary"
  | "explain_application"
  | "revise_or_clarify_prior_claim"
  | "clarify_prior_point"
  | "define_term"
  | "answer_fact"
  | "acknowledge_and_probe"
  | "continue";

export type TurnRequiredScope =
  | "direct_answer_only"
  | "answer_plus_explanation"
  | "answer_plus_follow_up_question";

export type TurnDomainHandler =
  | "raven_preferences"
  | "definitions"
  | "relational_dynamics"
  | "generic_qa"
  | "conversation"
  | "planning"
  | "game"
  | "task";

export type TurnAlternativeInterpretation = {
  speech_act: TurnSpeechAct;
  requested_operation: TurnRequestedOperation;
  confidence: number;
  reason: string;
};

export type TurnMeaningComponent = {
  speech_act: TurnSpeechAct;
  target: TurnTarget;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  referent: string | null;
};

export type TurnMeaning = {
  raw_text: string;
  normalized_text: string;
  speech_act: TurnSpeechAct;
  target: TurnTarget;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  referent: string | null;
  stance: TurnStance;
  continuity_attachment: TurnContinuityAttachment;
  question_shape: TurnQuestionShape;
  entity_set: string[];
  answer_contract: TurnAnswerContract;
  required_referent: string | null;
  required_scope: TurnRequiredScope;
  current_domain_handler: TurnDomainHandler;
  confidence: number;
  components: TurnMeaningComponent[];
  alternative_interpretations: TurnAlternativeInterpretation[];
};

export type SemanticMove =
  | "answer"
  | "elaborate"
  | "clarify"
  | "refuse"
  | "revise"
  | "acknowledge_and_probe"
  | "explain_application"
  | "ask_focused_follow_up"
  | "continue";

export type PlannedMove = {
  move: SemanticMove;
  target: TurnTarget;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  referent: string | null;
  content_key:
    | "greeting_open"
    | "assistant_preference_answer"
    | "assistant_preference_elaboration"
    | "assistant_preference_revision"
    | "user_preference_application"
    | "raven_invitation_answer"
    | "reciprocal_user_probe"
    | "definition_answer"
    | "factual_answer"
    | "clarification_answer"
    | "conversation_continue"
    | "unknown_clarify";
  confidence: number;
  reason: string;
};

export type TurnMeaningInput = {
  userText: string;
  previousAssistantText?: string | null;
  previousUserText?: string | null;
  currentTopic?: string | null;
};

export type CanonicalTurnState = {
  turn_meaning: TurnMeaning;
  planned_move: PlannedMove;
  semantic_owner: "semantic_planner";
  fallback_allowed: boolean;
};

const PREFERENCE_DOMAIN_PATTERN =
  /\b(pegging|bondage|restraint|rope|cuffs?|collars?|chastity|cages?|plug|plugs|dildo|dildos|vibrator|wand|toy|toys|fetish|fetishes|kink|kinks|spanking|impact|pain|obedience|submission|dominance|control|humiliation|degradation|praise|service|strap-?on|anal(?:\s+play|\s+training)?|oral(?:\s+training)?|throat(?:\s+training)?)\b/i;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeLower(text: string): string {
  return normalize(text).toLowerCase();
}

function cleanReferent(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value
    .trim()
    .replace(/^(?:about|into|for|your|my|the)\s+/i, "")
    .replace(/\b(?:so|and so|but|because)\s+.*$/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  if (!cleaned || /^(?:it|that|this|anything|something|mine|yours)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function alternative(
  speech_act: TurnSpeechAct,
  requested_operation: TurnRequestedOperation,
  confidence: number,
  reason: string,
): TurnAlternativeInterpretation {
  return { speech_act, requested_operation, confidence, reason };
}

function uniqueEntities(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const entities: string[] = [];
  for (const value of values) {
    const cleaned = cleanReferent(value)?.toLowerCase();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    entities.push(cleaned);
  }
  return entities;
}

function extractPreferenceEntities(text: string): string[] {
  const normalized = normalize(text);
  const matches = normalized.match(new RegExp(PREFERENCE_DOMAIN_PATTERN.source, "gi")) ?? [];
  const entities = uniqueEntities(matches.map((match) => match.replace(/strapon/i, "strap-on")));
  if (/\bkinks?\b/i.test(normalized) && !entities.includes("kink") && !entities.includes("kinks")) {
    entities.push("kinks");
  }
  if (/\bfetishes\b/i.test(normalized) && !entities.includes("fetishes")) {
    entities.push("fetishes");
  }
  return entities;
}

function extractBinaryChoiceEntities(text: string): string[] {
  const normalized = normalize(text);
  if (isFavoritesQuestion(normalized)) {
    return [];
  }
  const match =
    normalized.match(/\b(?:do you like|do you prefer|would you prefer|which do you like|which would you choose)\s+([^?.,]{2,60}?)\s+or\s+([^?.,]{2,60})\??$/i) ??
    normalized.match(/\b([^?.,]{2,60}?)\s+or\s+([^?.,]{2,60})\??$/i);
  if (!match) {
    return [];
  }
  const left = extractPreferenceDomainReferent(match[1] ?? "") ?? cleanReferent(match[1]);
  const right = extractPreferenceDomainReferent(match[2] ?? "") ?? cleanReferent(match[2]);
  const entities = uniqueEntities([left, right]);
  return entities.length === 2 ? entities : [];
}

function isFavoritesQuestion(normalized: string): boolean {
  return /\bfavou?rites?\b/i.test(normalized) || /\bwhich are your favorite\b/i.test(normalized);
}

function isTopicDrilldownQuestion(normalized: string): boolean {
  return /^(?:what about|and what about|how about)\s+[^?.,]{2,80}\??$/i.test(normalized);
}

function isInvitationOrProposal(normalized: string): boolean {
  return (
    /\bwould you like to (?:explore|try|use|do|peg)\b/i.test(normalized) ||
    /\bwould you (?:peg|use|explore|try|do)\b/i.test(normalized) ||
    /\bcan we (?:explore|try|use|do)\b/i.test(normalized)
  );
}

function deriveEntitySet(input: {
  normalized: string;
  referent: string | null;
  subject_domain: TurnSubjectDomain;
}): string[] {
  const binary = extractBinaryChoiceEntities(input.normalized);
  if (binary.length > 0) {
    return binary;
  }
  if (
    input.subject_domain === "assistant_preferences" ||
    input.subject_domain === "user_preferences" ||
    input.subject_domain === "relational_exchange"
  ) {
    const preferenceEntities = extractPreferenceEntities(input.normalized);
    return uniqueEntities([input.referent, ...preferenceEntities]);
  }
  return uniqueEntities([input.referent]);
}

function deriveQuestionShape(input: {
  normalized: string;
  speech_act: TurnSpeechAct;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  entity_set: string[];
}): TurnQuestionShape {
  if (input.speech_act === "greeting") {
    return "greeting_or_opener";
  }
  if (input.requested_operation === "revise" || input.speech_act === "challenge") {
    return "challenge_or_correction";
  }
  if (input.requested_operation === "clarify" || input.speech_act === "clarification") {
    return "clarification_request";
  }
  if (input.requested_operation === "explain_application") {
    return "application_request";
  }
  if (input.subject_domain === "definition") {
    return "definition_request";
  }
  if (input.subject_domain === "factual_question") {
    return "factual_request";
  }
  if (isInvitationOrProposal(input.normalized)) {
    return "invitation_or_proposal";
  }
  if (extractBinaryChoiceEntities(input.normalized).length === 2) {
    return "binary_compare_or_choice";
  }
  if (
    input.subject_domain === "assistant_preferences" &&
    /\b(?:what are you(?:r)? kinks?|what kinks do you like|what fetishes do you like|what are you into|what do you like)\b/i.test(
      input.normalized,
    )
  ) {
    return "favorites_request";
  }
  if (isFavoritesQuestion(input.normalized)) {
    return "favorites_request";
  }
  if (isElaborationRequest(input.normalized)) {
    return "list_expansion";
  }
  if (isTopicDrilldownQuestion(input.normalized)) {
    return "topic_drilldown";
  }
  if (
    input.subject_domain === "assistant_preferences" &&
    /^(?:do|does|did|are|is|would|could|can)\b/i.test(input.normalized) &&
    input.entity_set.length > 0
  ) {
    return "yes_no_about_item";
  }
  if (input.speech_act === "preference_statement" || input.speech_act === "self_disclosure") {
    return "statement_or_disclosure";
  }
  return input.speech_act === "direct_question" ? "open_question" : "unknown";
}

function answerContractForShape(shape: TurnQuestionShape): TurnAnswerContract {
  switch (shape) {
    case "yes_no_about_item":
      return "answer_yes_no_with_item";
    case "binary_compare_or_choice":
      return "compare_or_choose_between_entities";
    case "favorites_request":
      return "provide_favorites";
    case "list_expansion":
      return "expand_list";
    case "topic_drilldown":
      return "address_topic_directly";
    case "invitation_or_proposal":
      return "answer_invitation_or_boundary";
    case "application_request":
      return "explain_application";
    case "challenge_or_correction":
      return "revise_or_clarify_prior_claim";
    case "clarification_request":
      return "clarify_prior_point";
    case "definition_request":
      return "define_term";
    case "factual_request":
      return "answer_fact";
    case "greeting_or_opener":
      return "acknowledge_and_probe";
    default:
      return "continue";
  }
}

function domainHandlerForMeaning(subjectDomain: TurnSubjectDomain): TurnDomainHandler {
  switch (subjectDomain) {
    case "assistant_preferences":
    case "user_preferences":
      return "raven_preferences";
    case "definition":
      return "definitions";
    case "factual_question":
      return "generic_qa";
    case "relational_exchange":
      return "relational_dynamics";
    case "planning":
      return "planning";
    case "game":
      return "game";
    case "task":
      return "task";
    default:
      return "conversation";
  }
}

function scopeForContract(contract: TurnAnswerContract): TurnRequiredScope {
  if (contract === "acknowledge_and_probe") {
    return "answer_plus_follow_up_question";
  }
  if (contract === "define_term" || contract === "answer_fact") {
    return "direct_answer_only";
  }
  return "answer_plus_explanation";
}

function buildMeaning(input: {
  rawText: string;
  normalized: string;
  speech_act: TurnSpeechAct;
  target: TurnTarget;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  referent?: string | null;
  stance?: TurnStance;
  continuity_attachment?: TurnContinuityAttachment;
  confidence: number;
  components?: TurnMeaningComponent[];
  alternative_interpretations?: TurnAlternativeInterpretation[];
  question_shape?: TurnQuestionShape;
  entity_set?: string[];
  answer_contract?: TurnAnswerContract;
  required_referent?: string | null;
  required_scope?: TurnRequiredScope;
  current_domain_handler?: TurnDomainHandler;
}): TurnMeaning {
  const referent = input.referent ?? null;
  const entity_set = input.entity_set ?? deriveEntitySet({
    normalized: input.normalized,
    referent,
    subject_domain: input.subject_domain,
  });
  const question_shape =
    input.question_shape ??
    deriveQuestionShape({
      normalized: input.normalized,
      speech_act: input.speech_act,
      subject_domain: input.subject_domain,
      requested_operation: input.requested_operation,
      entity_set,
    });
  const answer_contract = input.answer_contract ?? answerContractForShape(question_shape);
  const primaryComponent: TurnMeaningComponent = {
    speech_act: input.speech_act,
    target: input.target,
    subject_domain: input.subject_domain,
    requested_operation: input.requested_operation,
    referent,
  };
  return {
    raw_text: input.rawText,
    normalized_text: input.normalized,
    speech_act: input.speech_act,
    target: input.target,
    subject_domain: input.subject_domain,
    requested_operation: input.requested_operation,
    referent,
    stance: input.stance ?? "neutral",
    continuity_attachment: input.continuity_attachment ?? "fresh_topic",
    question_shape,
    entity_set,
    answer_contract,
    required_referent: input.required_referent ?? referent ?? entity_set[0] ?? null,
    required_scope: input.required_scope ?? scopeForContract(answer_contract),
    current_domain_handler: input.current_domain_handler ?? domainHandlerForMeaning(input.subject_domain),
    confidence: input.confidence,
    components: input.components ?? [primaryComponent],
    alternative_interpretations: input.alternative_interpretations ?? [],
  };
}

function extractDefinitionSubject(text: string): string | null {
  if (/^\s*what\s+about\b/i.test(text)) {
    return null;
  }
  const match =
    text.match(/^define\s+([^?!.,]{2,80})/i)?.[1] ??
    text.match(/^what\s+does\s+([^?!.,]{2,80})\s+mean\??$/i)?.[1] ??
    text.match(/^(?:what(?:'s| is)?|who(?: is)?|where(?: is)?|when(?: is)?)\s+([^?!.,]{2,80})/i)?.[1] ??
    null;
  return cleanReferent(match);
}

function extractUserPreferenceDisclosure(text: string): string | null {
  const normalized = normalize(text);
  const explicit =
    normalized.match(/\b(?:i like|i enjoy|i love|i'?m into|i am into|my favorite(?:\s+\w+)? is)\s+([^?.!,]{2,100})/i)?.[1] ??
    normalized.match(/\b(?:for me it'?s|for me it is|mine is|my thing is)\s+([^?.!,]{2,100})/i)?.[1] ??
    null;
  const cleanedExplicit = cleanReferent(explicit);
  if (cleanedExplicit) {
    return cleanedExplicit;
  }
  const domainMatches = normalized.match(new RegExp(PREFERENCE_DOMAIN_PATTERN.source, "gi"));
  if (domainMatches && domainMatches.length > 0) {
    return domainMatches.slice(0, 3).join(" and ");
  }
  return null;
}

function extractRecentPreferenceReferent(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const match = normalize(text).match(PREFERENCE_DOMAIN_PATTERN)?.[0] ?? null;
  return cleanReferent(match)?.toLowerCase() ?? null;
}

function extractAssistantPreferenceReferent(text: string): string | null {
  const topic =
    extractAssistantPreferenceTopic(text) ??
    extractAssistantGeneralPreferenceTopic(text) ??
    null;
  if (topic) {
    return /kinks?|fetishes|toys|preferences/i.test(topic)
      ? `Raven's ${topic.replace(/^your\s+/i, "")}`
      : topic;
  }
  if (/\bkinks?\b/i.test(text)) {
    return "Raven's kinks";
  }
  if (/\bfavorites?\b/i.test(text)) {
    return "Raven's favorites";
  }
  return null;
}

function isGreeting(normalized: string): boolean {
  return (
    /^(hi|hello|hey)(?:\s+(?:miss\s+raven|mistress|miss|raven|ma'am|mam))?$/.test(
      normalized,
    ) || /^(?:let'?s chat|lets chat|i'?m here to chat|i am here to chat)$/.test(normalized)
  );
}

function isQuestionLike(normalized: string): boolean {
  return (
    normalized.includes("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|is|are|define)\b/.test(
      normalized,
    )
  );
}

function isReciprocalOffer(normalized: string): boolean {
  return /\b(would you like to know mine|want to hear mine|should i tell you mine|do you want to know anything(?: else)? about me)\b/i.test(
    normalized,
  );
}

function isFavoritePreferenceChallenge(normalized: string): boolean {
  return (
    /\byou (?:have to|must|gotta|do|should)\s+have\b[^.!?]{0,80}\bfavorites?\b[^.!?]{0,40}\b(kinks?|fetishes|preferences)\b/i.test(
      normalized,
    ) ||
    /\b(?:come on|be honest)\b[^.!?]{0,80}\byou\b[^.!?]{0,40}\b(?:must|have to|do)?\s*have\b[^.!?]{0,40}\bfavorites?\b/i.test(
      normalized,
    ) ||
    /\bthat (?:cannot|can't) be all\b/i.test(normalized) ||
    /\bsurely\b[^.!?]{0,80}\byou\b[^.!?]{0,40}\bhave\b[^.!?]{0,40}\bfavorites?\b/i.test(
      normalized,
    )
  );
}

function isPreferenceApplicationRequest(normalized: string): boolean {
  return (
    /\bhow (?:could|would|do) you use (?:that|it|this|[^?.!,]{2,60})\b/i.test(normalized) ||
    /\bhow (?:can|could|would) we use (?:that|it|this|[^?.!,]{2,60})\b/i.test(normalized) ||
    /\bwhat would you do with (?:that|it|this|[^?.!,]{2,60})\b/i.test(normalized) ||
    /\bwhat would you do with that preference\b/i.test(normalized) ||
    /\bhow would that (?:fit|work|play out)\b/i.test(normalized)
  );
}

function extractPreferenceDomainReferent(text: string): string | null {
  const match = normalize(text).match(PREFERENCE_DOMAIN_PATTERN)?.[0] ?? null;
  return cleanReferent(match);
}

function isAssistantPreferenceQuestionLike(normalized: string, selfNormalized: string): boolean {
  if (
    isAssistantPreferenceQuestion(selfNormalized) ||
    isAssistantGeneralPreferenceQuestion(selfNormalized) ||
    isAssistantPreferenceElaborationText(normalized)
  ) {
    return true;
  }
  if (
    /\byour\b/i.test(selfNormalized) &&
    /\bfavou?rites?\b/i.test(selfNormalized) &&
    /\b(?:which|what|do|have|are)\b/i.test(selfNormalized)
  ) {
    return true;
  }
  const mentionsAssistant = /\b(?:you|your|yours|raven)\b/i.test(selfNormalized);
  const mentionsPreferenceDomain = PREFERENCE_DOMAIN_PATTERN.test(selfNormalized);
  const asksPreference =
    /\b(?:like|enjoy|into|favorite|favourite|preference|prefer|kink|fetish)\b/i.test(
      selfNormalized,
    );
  return mentionsAssistant && mentionsPreferenceDomain && asksPreference;
}

function isElaborationRequest(normalized: string): boolean {
  return /\b(what other|what else|anything else|tell me more|say more|in more detail|more details)\b/i.test(
    normalized,
  );
}

function isAssistantPreferenceElaborationText(normalized: string): boolean {
  return (
    /\bwhat other\b[^?.!,]{0,80}\b(?:kinks?|fetishes|toys|preferences)\b[^?.!,]{0,40}\bdo you like\b/i.test(
      normalized,
    ) ||
    /\bwhat else do you like\b/i.test(normalized) ||
    /\bany other (?:kinks?|fetishes|toys|preferences)\b/i.test(normalized)
  );
}

export function interpretTurnMeaning(input: TurnMeaningInput): TurnMeaning {
  const rawText = input.userText;
  const normalized = normalizeLower(rawText);
  const selfNormalized = normalizeAssistantSelfQuestionText(rawText);

  if (!normalized) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "unknown",
      target: "shared_topic",
      subject_domain: "general",
      requested_operation: "clarify",
      confidence: 0.2,
      continuity_attachment: "none",
    });
  }

  if (isGreeting(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "greeting",
      target: "assistant",
      subject_domain: "relational_exchange",
      requested_operation: "acknowledge_and_probe",
      referent: null,
      stance: "neutral",
      continuity_attachment: "fresh_topic",
      confidence: 0.98,
    });
  }

  if (isFavoritePreferenceChallenge(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "challenge",
      target: "prior_assistant_answer",
      subject_domain: "assistant_preferences",
      requested_operation: "revise",
      referent: "prior Raven claim about favorite kinks",
      stance: "challenging",
      continuity_attachment: "immediate_prior_answer",
      confidence: 0.9,
      alternative_interpretations: [
        alternative("direct_question", "answer", 0.46, "could be read as a direct favorites request"),
      ],
    });
  }

  if (isReciprocalOffer(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "reciprocal_offer",
      target: "user",
      subject_domain: "user_preferences",
      requested_operation: "ask_follow_up",
      referent: "user preferences",
      stance: "reciprocal",
      continuity_attachment: "active_thread",
      confidence: 0.92,
      question_shape: "open_question",
      answer_contract: "acknowledge_and_probe",
      current_domain_handler: "raven_preferences",
    });
  }

  const disclosedPreference = extractUserPreferenceDisclosure(rawText);
  if (disclosedPreference && isPreferenceApplicationRequest(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "self_disclosure",
      target: "assistant",
      subject_domain: "user_preferences",
      requested_operation: "explain_application",
      referent: disclosedPreference,
      stance: "vulnerable",
      continuity_attachment: input.previousAssistantText ? "immediate_prior_answer" : "active_thread",
      confidence: 0.88,
      components: [
        {
          speech_act: "preference_statement",
          target: "user",
          subject_domain: "user_preferences",
          requested_operation: "acknowledge_and_probe",
          referent: disclosedPreference,
        },
        {
          speech_act: "request_for_advice",
          target: "assistant",
          subject_domain: "relational_exchange",
          requested_operation: "explain_application",
          referent: disclosedPreference,
        },
      ],
      alternative_interpretations: [
        alternative("direct_question", "answer", 0.55, "contains an assistant-facing how question"),
      ],
    });
  }

  if (!disclosedPreference && isPreferenceApplicationRequest(normalized)) {
    const applicationReferent =
      extractPreferenceDomainReferent(rawText) ??
      extractRecentPreferenceReferent(input.previousUserText) ??
      extractRecentPreferenceReferent(input.previousAssistantText) ??
      extractRecentPreferenceReferent(input.currentTopic);
    if (applicationReferent) {
      return buildMeaning({
        rawText,
        normalized,
        speech_act: "request_for_advice",
        target: "assistant",
        subject_domain: "user_preferences",
        requested_operation: "explain_application",
        referent: applicationReferent,
        stance: "curious",
        continuity_attachment:
          /\b(that|it|this|preference)\b/i.test(normalized) && input.previousAssistantText
            ? "immediate_prior_answer"
            : "active_thread",
        confidence: 0.84,
        alternative_interpretations: [
          alternative("direct_question", "answer", 0.48, "contains an assistant-facing how question"),
        ],
      });
    }
  }

  if (isInvitationOrProposal(normalized)) {
    const invitationReferent =
      extractPreferenceDomainReferent(rawText) ??
      extractRecentPreferenceReferent(input.previousUserText) ??
      extractRecentPreferenceReferent(input.previousAssistantText) ??
      extractRecentPreferenceReferent(input.currentTopic) ??
      "the invitation";
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "direct_question",
      target: "assistant",
      subject_domain: "assistant_preferences",
      requested_operation: "answer",
      referent: invitationReferent,
      stance: "reciprocal",
      continuity_attachment: /\b(it|that|this)\b/i.test(normalized)
        ? "immediate_prior_answer"
        : "active_thread",
      confidence: 0.86,
      question_shape: "invitation_or_proposal",
      answer_contract: "answer_invitation_or_boundary",
      current_domain_handler: "raven_preferences",
      alternative_interpretations: [
        alternative("request_for_advice", "explain_application", 0.42, "proposal could be read as an applied dynamic request"),
      ],
    });
  }

  if (
    isAssistantPreferenceQuestionLike(normalized, selfNormalized)
  ) {
    const binaryEntities = extractBinaryChoiceEntities(selfNormalized);
    const requestedOperation: TurnRequestedOperation =
      binaryEntities.length === 2
        ? "compare"
        : isElaborationRequest(normalized)
          ? "elaborate"
          : "answer";
    const referent =
      binaryEntities.length === 2
        ? binaryEntities.join(" or ")
        : extractAssistantPreferenceReferent(selfNormalized) ??
          extractPreferenceDomainReferent(selfNormalized) ??
          (isFavoritesQuestion(selfNormalized) ? "Raven's favorite kinks" : "Raven's kinks");
    return buildMeaning({
      rawText,
      normalized,
      speech_act: isElaborationRequest(normalized) ? "request_for_elaboration" : "direct_question",
      target: "assistant",
      subject_domain: "assistant_preferences",
      requested_operation: requestedOperation,
      referent,
      stance: "curious",
      continuity_attachment: isElaborationRequest(normalized) ? "active_thread" : "fresh_topic",
      confidence: 0.91,
      entity_set: binaryEntities.length === 2 ? binaryEntities : undefined,
      alternative_interpretations: normalized.startsWith("which")
        ? [alternative("direct_question", "compare", 0.34, "leading which can look comparative without assistant-preference target")]
        : [],
    });
  }

  if (isTopicDrilldownQuestion(normalized)) {
    const drilldownReferent = extractPreferenceDomainReferent(rawText);
    const hasPreferenceContext =
      Boolean(drilldownReferent) ||
      Boolean(extractRecentPreferenceReferent(input.previousAssistantText)) ||
      Boolean(extractRecentPreferenceReferent(input.previousUserText)) ||
      Boolean(extractRecentPreferenceReferent(input.currentTopic));
    if (hasPreferenceContext) {
      return buildMeaning({
        rawText,
        normalized,
        speech_act: "request_for_elaboration",
        target: "assistant",
        subject_domain: "assistant_preferences",
        requested_operation: "elaborate",
        referent:
          drilldownReferent ??
          extractRecentPreferenceReferent(input.previousAssistantText) ??
          extractRecentPreferenceReferent(input.previousUserText) ??
          extractRecentPreferenceReferent(input.currentTopic) ??
          "the active preference topic",
        stance: "curious",
        continuity_attachment: "active_thread",
        confidence: 0.84,
        question_shape: "topic_drilldown",
        answer_contract: "address_topic_directly",
        current_domain_handler: "raven_preferences",
      });
    }
  }

  if (/^\s*do you (?:like|enjoy) it\??\s*$/i.test(rawText)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "direct_question",
      target: "assistant",
      subject_domain: "assistant_preferences",
      requested_operation: "answer",
      referent:
        extractRecentPreferenceReferent(input.previousAssistantText) ??
        extractRecentPreferenceReferent(input.currentTopic) ??
        "the prior preference referent",
      stance: "curious",
      continuity_attachment: "immediate_prior_answer",
      confidence: 0.82,
      question_shape: "yes_no_about_item",
      answer_contract: "answer_yes_no_with_item",
    });
  }

  const definitionSubject = extractDefinitionSubject(rawText);
  if (definitionSubject && /^(what(?:'s| is| does)?|define|who(?: is)?|where(?: is)?|when(?: is)?)\b/i.test(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "direct_question",
      target: "shared_topic",
      subject_domain:
        /^what color is\b/i.test(normalized) || /^who wrote\b/i.test(normalized)
          ? "factual_question"
          : "definition",
      requested_operation: "answer",
      referent: definitionSubject,
      stance: "neutral",
      continuity_attachment: "fresh_topic",
      confidence: 0.86,
    });
  }

  if (/^(?:what do you mean|explain|clarify|what\??|huh\??)$/i.test(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "clarification",
      target: "prior_assistant_answer",
      subject_domain: "relational_exchange",
      requested_operation: "clarify",
      referent: input.previousAssistantText ? "prior Raven point" : null,
      stance: "curious",
      continuity_attachment: input.previousAssistantText ? "immediate_prior_answer" : "none",
      confidence: 0.88,
    });
  }

  if (disclosedPreference) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "preference_statement",
      target: "user",
      subject_domain: "user_preferences",
      requested_operation: "acknowledge_and_probe",
      referent: disclosedPreference,
      stance: "vulnerable",
      continuity_attachment: input.previousAssistantText ? "immediate_prior_answer" : "active_thread",
      confidence: 0.74,
    });
  }

  if (isQuestionLike(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "direct_question",
      target: "shared_topic",
      subject_domain: "general",
      requested_operation: normalized.startsWith("which") ? "compare" : "answer",
      referent: null,
      stance: "neutral",
      continuity_attachment: "fresh_topic",
      confidence: 0.55,
    });
  }

  return buildMeaning({
    rawText,
    normalized,
    speech_act: "continuation",
    target: "shared_topic",
    subject_domain: "general",
    requested_operation: "continue",
    referent: cleanReferent(input.currentTopic) ?? null,
    stance: "neutral",
    continuity_attachment: input.previousAssistantText ? "active_thread" : "none",
    confidence: 0.48,
  });
}

export function planSemanticResponse(turnMeaning: TurnMeaning): PlannedMove {
  if (turnMeaning.confidence < 0.4) {
    return {
      move: "clarify",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: "clarify",
      referent: turnMeaning.referent,
      content_key: "unknown_clarify",
      confidence: turnMeaning.confidence,
      reason: "low confidence semantic interpretation",
    };
  }

  if (turnMeaning.speech_act === "greeting") {
    return {
      move: "acknowledge_and_probe",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "greeting_open",
      confidence: turnMeaning.confidence,
      reason: "greeting starts an open conversational beat",
    };
  }

  if (
    turnMeaning.subject_domain === "assistant_preferences" &&
    turnMeaning.requested_operation === "revise"
  ) {
    return {
      move: "revise",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "assistant_preference_revision",
      confidence: turnMeaning.confidence,
      reason: "challenge asks Raven to revise or clarify a prior preference claim",
    };
  }

  if (
    turnMeaning.subject_domain === "assistant_preferences" &&
    turnMeaning.requested_operation === "elaborate"
  ) {
    return {
      move: "elaborate",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "assistant_preference_elaboration",
      confidence: turnMeaning.confidence,
      reason: "assistant preference follow-up asks for more of the same domain",
    };
  }

  if (
    turnMeaning.current_domain_handler === "raven_preferences" &&
    turnMeaning.answer_contract === "answer_invitation_or_boundary"
  ) {
    return {
      move: "answer",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "raven_invitation_answer",
      confidence: turnMeaning.confidence,
      reason: "assistant-facing invitation requires a direct boundary-aware answer",
    };
  }

  if (turnMeaning.subject_domain === "assistant_preferences") {
    return {
      move: "answer",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "assistant_preference_answer",
      confidence: turnMeaning.confidence,
      reason: "direct assistant self-disclosure request",
    };
  }

  if (turnMeaning.requested_operation === "explain_application") {
    return {
      move: "explain_application",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "user_preference_application",
      confidence: turnMeaning.confidence,
      reason: "user disclosed a preference and asked how Raven would apply it",
    };
  }

  if (turnMeaning.speech_act === "reciprocal_offer") {
    return {
      move: "ask_focused_follow_up",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "reciprocal_user_probe",
      confidence: turnMeaning.confidence,
      reason: "reciprocal offer asks Raven to choose a focused user-facing probe",
    };
  }

  if (turnMeaning.subject_domain === "definition") {
    return {
      move: "answer",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "definition_answer",
      confidence: turnMeaning.confidence,
      reason: "definition question should be answered substantively",
    };
  }

  if (turnMeaning.subject_domain === "factual_question") {
    return {
      move: "answer",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "factual_answer",
      confidence: turnMeaning.confidence,
      reason: "factual question should be answered directly",
    };
  }

  if (turnMeaning.requested_operation === "clarify") {
    return {
      move: "clarify",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      content_key: "clarification_answer",
      confidence: turnMeaning.confidence,
      reason: "clarification attaches to the prior answer",
    };
  }

  return {
    move: "continue",
    target: turnMeaning.target,
    subject_domain: turnMeaning.subject_domain,
    requested_operation: turnMeaning.requested_operation,
    referent: turnMeaning.referent,
    content_key: "conversation_continue",
    confidence: turnMeaning.confidence,
    reason: "no higher-priority semantic response plan matched",
  };
}

export function updateCanonicalTurnState(input: TurnMeaningInput): CanonicalTurnState {
  const turnMeaning = interpretTurnMeaning(input);
  const plannedMove = planSemanticResponse(turnMeaning);
  return {
    turn_meaning: turnMeaning,
    planned_move: plannedMove,
    semantic_owner: "semantic_planner",
    fallback_allowed: plannedMove.content_key === "unknown_clarify" || plannedMove.confidence < 0.4,
  };
}

export type SemanticTurnTrace = {
  turn_meaning: TurnMeaning;
  planned_move: PlannedMove;
  winning_subsystem: string;
  content_source: string;
  style_wrapper_applied: boolean;
  guard_intervention: boolean;
  commit_owner_id: string | null;
  legacy_override_attempted: boolean;
};

export function buildSemanticTurnTrace(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
  winningSubsystem: string;
  contentSource?: string;
  styleWrapperApplied: boolean;
  guardIntervention: boolean;
  commitOwnerId?: string | null;
  legacyOverrideAttempted?: boolean;
}): SemanticTurnTrace {
  return {
    turn_meaning: input.turnMeaning,
    planned_move: input.plannedMove,
    winning_subsystem: input.winningSubsystem,
    content_source: input.contentSource ?? input.winningSubsystem,
    style_wrapper_applied: input.styleWrapperApplied,
    guard_intervention: input.guardIntervention,
    commit_owner_id: input.commitOwnerId ?? null,
    legacy_override_attempted: input.legacyOverrideAttempted ?? false,
  };
}
