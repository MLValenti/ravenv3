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
  | "current_status_request"
  | "factual_request"
  | "greeting_or_opener"
  | "statement_or_disclosure"
  | "open_question"
  | "unknown";

export type TurnRequestedFacet =
  | "category_overview"
  | "favorites_subset"
  | "list_expansion"
  | "yes_no_about_item"
  | "binary_compare_or_choice"
  | "reason_about_item"
  | "possession_or_tool_availability"
  | "current_activity_or_status"
  | "definition"
  | "clarifying_enumeration"
  | "invitation_response"
  | "application_explanation"
  | "challenge_response"
  | "clarification"
  | "factual_answer"
  | "reciprocal_probe"
  | "continuation"
  | "unknown";

export type TurnAnswerContract =
  | "answer_yes_no_with_item"
  | "compare_or_choose_between_entities"
  | "provide_category_overview"
  | "provide_favorites"
  | "expand_list"
  | "address_topic_directly"
  | "explain_reason_about_item"
  | "answer_possession_or_tool_availability"
  | "answer_current_status"
  | "clarify_enumeration"
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

export type DomainHandlerEligibilityDecision = {
  handler: TurnDomainHandler;
  eligible: boolean;
  reason: string;
  required_slots: string[];
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
  requested_facet: TurnRequestedFacet;
  primary_subject: string | null;
  secondary_subjects: string[];
  entity_set: string[];
  answer_contract: TurnAnswerContract;
  required_answer_slots: string[];
  handler_eligibility_requirements: string[];
  required_referent: string | null;
  required_scope: TurnRequiredScope;
  current_domain_handler: TurnDomainHandler;
  eligible_domain_handlers: DomainHandlerEligibilityDecision[];
  rejected_domain_handlers: DomainHandlerEligibilityDecision[];
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
  requested_facet: TurnRequestedFacet;
  answer_contract: TurnAnswerContract;
  content_key:
    | "greeting_open"
    | "assistant_preference_answer"
    | "assistant_preference_elaboration"
    | "assistant_preference_clarification"
    | "assistant_preference_revision"
    | "user_preference_application"
    | "raven_invitation_answer"
    | "reciprocal_user_probe"
    | "definition_answer"
    | "factual_answer"
    | "current_status_answer"
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
    .replace(/^(?:about|into|for|your|my|the|a|an)\s+/i, "")
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
    normalized.match(/\bwhich do you prefer,?\s+([^?.,]{2,60}?)\s+or\s+([^?.,]{2,60})\??$/i) ??
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

function isCategoryOverviewQuestion(normalized: string): boolean {
  return (
    /\bwhat are you(?:r)? kinks?\b/i.test(normalized) ||
    /\bwhat kinks? (?:are you into|do you like)\b/i.test(normalized) ||
    /\bwhat (?:kind|type) of (?:stuff|things|dynamics|kinks?) (?:are )?you (?:into|like)\b/i.test(normalized) ||
    /\bwhat are you into\b/i.test(normalized)
  );
}

function isTopicDrilldownQuestion(normalized: string): boolean {
  return /^(?:what about|and what about|how about)\s+[^?.,]{2,80}\??$/i.test(normalized);
}

function isCurrentStatusRequest(normalized: string): boolean {
  return (
    /^(?:what(?:'re| are| r)?|what is|what's)\s+(?:you|u)\s+(?:doing|up to)(?:\s+right now| now| today)?\??$/i.test(
      normalized,
    ) ||
    /^(?:what are you doing right now|what are you up to right now)\??$/i.test(normalized)
  );
}

function isPossessionOrToolAvailabilityRequest(normalized: string): boolean {
  return (
    /\b(?:do you have|have you got|do you own|got any|is there|are there)\b[^?]{0,80}\b(?:strap-?on|strap|gear|cuffs?|rope|collar|toy|toys|plug|dildo|wand|cage)\b/i.test(
      normalized,
    ) ||
    /\bwould you use\b[^?]{0,80}\b(?:strap-?on|strap|gear|cuffs?|rope|collar|toy|toys|plug|dildo|wand|cage)\b/i.test(
      normalized,
    )
  );
}

function isReasonAboutItemRequest(normalized: string): boolean {
  return (
    /\bwhat do you like about (?:it|that|this|[^?.,]{2,60})\??$/i.test(normalized) ||
    /\bwhy do you like (?:it|that|this|[^?.,]{2,60})\??$/i.test(normalized)
  );
}

function isClarifyingEnumeration(normalized: string): boolean {
  return (
    /^(?:i mean|i mean like|like|as in)\b/i.test(normalized) &&
    (extractPreferenceEntities(normalized).length >= 2 || /\betc\b/i.test(normalized))
  );
}

function isInvitationOrProposal(normalized: string): boolean {
  return (
    /\bwould you like to (?:explore|try|use|do|peg)\b/i.test(normalized) ||
    /\bwould you (?:peg|use|explore|try|do)\b/i.test(normalized) ||
    /\bwould you be into (?:it|that|this|[^?.!,]{2,60})\b/i.test(normalized) ||
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
  if (isCurrentStatusRequest(input.normalized)) {
    return "current_status_request";
  }
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
    isCategoryOverviewQuestion(input.normalized)
  ) {
    return "open_question";
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

function requestedFacetForShape(input: {
  shape: TurnQuestionShape;
  normalized: string;
  speech_act: TurnSpeechAct;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  entity_set: string[];
}): TurnRequestedFacet {
  if (input.shape === "current_status_request") {
    return "current_activity_or_status";
  }
  if (isClarifyingEnumeration(input.normalized)) {
    return "clarifying_enumeration";
  }
  if (isPossessionOrToolAvailabilityRequest(input.normalized)) {
    return "possession_or_tool_availability";
  }
  if (isReasonAboutItemRequest(input.normalized)) {
    return "reason_about_item";
  }
  if (input.shape === "topic_drilldown") {
    return "reason_about_item";
  }
  switch (input.shape) {
    case "yes_no_about_item":
      return "yes_no_about_item";
    case "binary_compare_or_choice":
      return "binary_compare_or_choice";
    case "favorites_request":
      return "favorites_subset";
    case "list_expansion":
      return "list_expansion";
    case "invitation_or_proposal":
      return "invitation_response";
    case "application_request":
      return "application_explanation";
    case "challenge_or_correction":
      return "challenge_response";
    case "clarification_request":
      return "clarification";
    case "definition_request":
      return "definition";
    case "factual_request":
      return "factual_answer";
    case "greeting_or_opener":
      return "reciprocal_probe";
    default:
      if (
        input.subject_domain === "assistant_preferences" &&
        input.requested_operation === "answer" &&
        isCategoryOverviewQuestion(input.normalized)
      ) {
        return "category_overview";
      }
      return input.requested_operation === "continue" ? "continuation" : "unknown";
  }
}

function answerContractForFacet(facet: TurnRequestedFacet): TurnAnswerContract {
  switch (facet) {
    case "yes_no_about_item":
      return "answer_yes_no_with_item";
    case "binary_compare_or_choice":
      return "compare_or_choose_between_entities";
    case "category_overview":
      return "provide_category_overview";
    case "favorites_subset":
      return "provide_favorites";
    case "list_expansion":
      return "expand_list";
    case "reason_about_item":
      return "explain_reason_about_item";
    case "possession_or_tool_availability":
      return "answer_possession_or_tool_availability";
    case "current_activity_or_status":
      return "answer_current_status";
    case "clarifying_enumeration":
      return "clarify_enumeration";
    case "invitation_response":
      return "answer_invitation_or_boundary";
    case "application_explanation":
      return "explain_application";
    case "challenge_response":
      return "revise_or_clarify_prior_claim";
    case "clarification":
      return "clarify_prior_point";
    case "definition":
      return "define_term";
    case "factual_answer":
      return "answer_fact";
    case "reciprocal_probe":
      return "acknowledge_and_probe";
    default:
      return "continue";
  }
}

function slotsForFacet(facet: TurnRequestedFacet): string[] {
  switch (facet) {
    case "category_overview":
      return ["category_examples", "dominant_frame"];
    case "favorites_subset":
      return ["favorites"];
    case "list_expansion":
      return ["expanded_items"];
    case "yes_no_about_item":
      return ["yes_no_boundary", "item_referent"];
    case "binary_compare_or_choice":
      return ["compared_options", "preference_or_choice"];
    case "reason_about_item":
      return ["item_referent", "reason"];
    case "possession_or_tool_availability":
      return ["tool_referent", "availability_boundary"];
    case "current_activity_or_status":
      return ["current_status"];
    case "definition":
      return ["term", "definition"];
    case "clarifying_enumeration":
      return ["clarified_entity_set", "active_category"];
    case "invitation_response":
      return ["invitation_answer", "boundary"];
    case "application_explanation":
      return ["item_referent", "application"];
    case "challenge_response":
      return ["prior_claim", "revision_or_clarification"];
    default:
      return [];
  }
}

function domainHandlerForMeaning(subjectDomain: TurnSubjectDomain, facet: TurnRequestedFacet): TurnDomainHandler {
  if (facet === "definition") {
    return "definitions";
  }
  if (facet === "current_activity_or_status") {
    return "conversation";
  }
  if (facet === "factual_answer") {
    return "generic_qa";
  }
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
  if (contract === "define_term" || contract === "answer_fact" || contract === "answer_current_status") {
    return "direct_answer_only";
  }
  return "answer_plus_explanation";
}

const HANDLER_FACETS: Record<TurnDomainHandler, TurnRequestedFacet[]> = {
  raven_preferences: [
    "category_overview",
    "favorites_subset",
    "list_expansion",
    "yes_no_about_item",
    "binary_compare_or_choice",
    "reason_about_item",
    "possession_or_tool_availability",
    "clarifying_enumeration",
    "invitation_response",
    "application_explanation",
    "challenge_response",
    "reciprocal_probe",
  ],
  definitions: ["definition"],
  relational_dynamics: ["application_explanation", "invitation_response", "clarification"],
  generic_qa: ["factual_answer"],
  conversation: ["current_activity_or_status", "clarification", "continuation", "reciprocal_probe"],
  planning: ["continuation", "clarification"],
  game: ["continuation", "clarification"],
  task: ["continuation", "clarification"],
};

export function selectEligibleDomainHandler(input: Pick<
  TurnMeaning,
  "current_domain_handler" | "requested_facet" | "required_answer_slots" | "subject_domain"
>): {
  chosen: TurnDomainHandler;
  decisions: DomainHandlerEligibilityDecision[];
} {
  const handlers: TurnDomainHandler[] = [
    "raven_preferences",
    "definitions",
    "relational_dynamics",
    "generic_qa",
    "conversation",
    "planning",
    "game",
    "task",
  ];
  const decisions = handlers.map((handler): DomainHandlerEligibilityDecision => {
    const supportsFacet = HANDLER_FACETS[handler].includes(input.requested_facet);
    if (!supportsFacet) {
      return {
        handler,
        eligible: false,
        reason: `handler_does_not_support_${input.requested_facet}`,
        required_slots: input.required_answer_slots,
      };
    }
    if (handler === "raven_preferences" && input.requested_facet === "definition") {
      return {
        handler,
        eligible: false,
        reason: "preference_domain_cannot_define_general_terms",
        required_slots: input.required_answer_slots,
      };
    }
    return {
      handler,
      eligible: true,
      reason: `supports_${input.requested_facet}`,
      required_slots: input.required_answer_slots,
    };
  });
  const preferred = decisions.find(
    (decision) => decision.handler === input.current_domain_handler && decision.eligible,
  );
  const chosen = preferred?.handler ?? decisions.find((decision) => decision.eligible)?.handler ?? "conversation";
  return { chosen, decisions };
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
  requested_facet?: TurnRequestedFacet;
  primary_subject?: string | null;
  secondary_subjects?: string[];
  entity_set?: string[];
  answer_contract?: TurnAnswerContract;
  required_answer_slots?: string[];
  handler_eligibility_requirements?: string[];
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
  const requested_facet =
    input.requested_facet ??
    requestedFacetForShape({
      shape: question_shape,
      normalized: input.normalized,
      speech_act: input.speech_act,
      subject_domain: input.subject_domain,
      requested_operation: input.requested_operation,
      entity_set,
    });
  const answer_contract = input.answer_contract ?? answerContractForFacet(requested_facet);
  const primary_subject = input.primary_subject ?? referent ?? entity_set[0] ?? null;
  const secondary_subjects =
    input.secondary_subjects ?? entity_set.filter((entity) => entity !== primary_subject);
  const required_answer_slots = input.required_answer_slots ?? slotsForFacet(requested_facet);
  const current_domain_handler =
    input.current_domain_handler ?? domainHandlerForMeaning(input.subject_domain, requested_facet);
  const eligibility = selectEligibleDomainHandler({
    current_domain_handler,
    requested_facet,
    required_answer_slots,
    subject_domain: input.subject_domain,
  });
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
    requested_facet,
    primary_subject,
    secondary_subjects,
    entity_set,
    answer_contract,
    required_answer_slots,
    handler_eligibility_requirements: input.handler_eligibility_requirements ?? required_answer_slots,
    required_referent: input.required_referent ?? referent ?? entity_set[0] ?? null,
    required_scope: input.required_scope ?? scopeForContract(answer_contract),
    current_domain_handler: eligibility.chosen,
    eligible_domain_handlers: eligibility.decisions.filter((decision) => decision.eligible),
    rejected_domain_handlers: eligibility.decisions.filter((decision) => !decision.eligible),
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
    text.match(/^([^?!.,]{2,40})\s+meaning\??$/i)?.[1] ??
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

function extractToolReferent(text: string): string | null {
  const normalized = normalize(text);
  const tool =
    normalized.match(/\b(strap-?on|strap|gear|cuffs?|rope|collar|toy|toys|plug|dildo|wand|cage)\b/i)?.[1] ??
    null;
  if (!tool) {
    return null;
  }
  return tool.replace(/strapon/i, "strap-on").toLowerCase();
}

function isAssistantPreferenceQuestionLike(normalized: string, selfNormalized: string): boolean {
  if (
    isCategoryOverviewQuestion(selfNormalized) ||
    isPossessionOrToolAvailabilityRequest(selfNormalized) ||
    isReasonAboutItemRequest(selfNormalized)
  ) {
    return true;
  }
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

  if (isCurrentStatusRequest(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "direct_question",
      target: "assistant",
      subject_domain: "relational_exchange",
      requested_operation: "answer",
      referent: "Raven's current state",
      stance: "neutral",
      continuity_attachment: "fresh_topic",
      confidence: 0.9,
      question_shape: "current_status_request",
      requested_facet: "current_activity_or_status",
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
      requested_facet: "reciprocal_probe",
      answer_contract: "acknowledge_and_probe",
      current_domain_handler: "raven_preferences",
    });
  }

  const disclosedPreference = extractUserPreferenceDisclosure(rawText);

  if (isClarifyingEnumeration(normalized)) {
    const entities = extractPreferenceEntities(rawText);
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "clarification",
      target: "prior_assistant_answer",
      subject_domain: "assistant_preferences",
      requested_operation: "clarify",
      referent:
        extractAssistantPreferenceReferent(input.previousUserText ?? "") ??
        extractAssistantPreferenceReferent(input.previousAssistantText ?? "") ??
        "Raven's kinks",
      stance: "corrective",
      continuity_attachment: "immediate_prior_answer",
      confidence: 0.82,
      question_shape: "clarification_request",
      requested_facet: "clarifying_enumeration",
      answer_contract: "clarify_enumeration",
      entity_set: entities,
      current_domain_handler: "raven_preferences",
      alternative_interpretations: [
        alternative("preference_statement", "acknowledge_and_probe", 0.38, "enumerated kink terms can look like user disclosure without prior context"),
      ],
    });
  }

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

  if (isInvitationOrProposal(normalized) && !isPossessionOrToolAvailabilityRequest(normalized)) {
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
    const hasToolFacet = isPossessionOrToolAvailabilityRequest(normalized);
    const hasReasonFacet = isReasonAboutItemRequest(normalized);
    const requestedOperation: TurnRequestedOperation =
      binaryEntities.length === 2
        ? "compare"
        : hasReasonFacet
          ? "elaborate"
        : isElaborationRequest(normalized)
          ? "elaborate"
          : "answer";
    const toolReferent = extractToolReferent(rawText);
    const recentReferent =
      extractRecentPreferenceReferent(input.previousAssistantText) ??
      extractRecentPreferenceReferent(input.previousUserText) ??
      extractRecentPreferenceReferent(input.currentTopic);
    const referent =
      binaryEntities.length === 2
        ? binaryEntities.join(" or ")
        : toolReferent && hasToolFacet
          ? toolReferent
        : hasReasonFacet && /\b(?:it|that|this)\b/i.test(normalized)
          ? recentReferent ?? extractPreferenceDomainReferent(selfNormalized) ?? "the active preference topic"
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
      continuity_attachment: hasReasonFacet && /\b(?:it|that|this)\b/i.test(normalized)
        ? "immediate_prior_answer"
        : isElaborationRequest(normalized)
          ? "active_thread"
          : "fresh_topic",
      confidence: 0.91,
      entity_set:
        binaryEntities.length === 2
          ? binaryEntities
          : uniqueEntities([referent, ...extractPreferenceEntities(rawText)]),
      requested_facet: hasToolFacet
        ? "possession_or_tool_availability"
        : hasReasonFacet
          ? "reason_about_item"
          : undefined,
      answer_contract: hasToolFacet
        ? "answer_possession_or_tool_availability"
        : hasReasonFacet
          ? "explain_reason_about_item"
          : undefined,
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
        requested_facet: "reason_about_item",
        answer_contract: "explain_reason_about_item",
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
  if (definitionSubject && (/^(what(?:'s| is| does)?|define|who(?: is)?|where(?: is)?|when(?: is)?)\b/i.test(normalized) || /\bmeaning\??$/i.test(normalized))) {
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
      content_key: "assistant_preference_revision",
      confidence: turnMeaning.confidence,
      reason: "challenge asks Raven to revise or clarify a prior preference claim",
    };
  }

  if (
    turnMeaning.subject_domain === "assistant_preferences" &&
    turnMeaning.requested_facet === "clarifying_enumeration"
  ) {
    return {
      move: "clarify",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
      content_key: "assistant_preference_clarification",
      confidence: turnMeaning.confidence,
      reason: "clarifying enumeration refines the active assistant preference category",
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
      content_key:
        turnMeaning.requested_facet === "clarifying_enumeration"
          ? "assistant_preference_clarification"
          : "assistant_preference_elaboration",
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
      content_key: "factual_answer",
      confidence: turnMeaning.confidence,
      reason: "factual question should be answered directly",
    };
  }

  if (turnMeaning.requested_facet === "current_activity_or_status") {
    return {
      move: "answer",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
      content_key: "current_status_answer",
      confidence: turnMeaning.confidence,
      reason: "current-status question should answer Raven's present conversational state",
    };
  }

  if (turnMeaning.requested_operation === "clarify") {
    return {
      move: "clarify",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
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
    requested_facet: turnMeaning.requested_facet,
    answer_contract: turnMeaning.answer_contract,
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
  eligible_handlers_considered: DomainHandlerEligibilityDecision[];
  chosen_handler: TurnDomainHandler;
  rejected_handlers: DomainHandlerEligibilityDecision[];
  answer_contract_validation: {
    ok: boolean;
    reason: string;
  } | null;
  required_answer_slots: string[];
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
  answerContractValidation?: {
    ok: boolean;
    reason: string;
  } | null;
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
    eligible_handlers_considered: input.turnMeaning.eligible_domain_handlers,
    chosen_handler: input.turnMeaning.current_domain_handler,
    rejected_handlers: input.turnMeaning.rejected_domain_handlers,
    answer_contract_validation: input.answerContractValidation ?? null,
    required_answer_slots: input.turnMeaning.required_answer_slots,
  };
}
