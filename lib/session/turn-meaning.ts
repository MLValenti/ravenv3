import {
  extractAssistantGeneralPreferenceTopic,
  extractAssistantPreferenceTopic,
  isAssistantGeneralPreferenceQuestion,
  isAssistantPreferenceQuestion,
  normalizeAssistantSelfQuestionText,
} from "./interaction-mode.ts";
import {
  semanticCandidateFromTurnMeaning,
  validateSemanticCandidateSchema,
  type RejectedSemanticCandidate,
  type SemanticCandidate,
  type SemanticCandidateArbitrationTrace,
} from "./semantic-candidate-generator.ts";
import {
  EMPTY_RELATIONAL_DYNAMIC_SLOTS,
  buildRelationalDynamicTrace,
  classifyRelationalDynamicTurn,
  dynamicStateUpdateForInterpretation,
  type RelationalDynamicAnswerContract,
  type RelationalDynamicSlots,
  type RelationalDynamicTrace,
} from "./relational-dynamic.ts";

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
  | "role_proposal"
  | "service_request"
  | "request_for_direction"
  | "compound_relational_disclosure"
  | "user_confusion"
  | "expectation_request"
  | "protocol_setup_request"
  | "service_preference_disclosure"
  | "user_preference_disclosure"
  | "user_capability_disclosure"
  | "user_equipment_disclosure"
  | "dynamic_application_request"
  | "boundary_or_safety_topic"
  | "ambiguous_dynamic_topic"
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
  | "hypothetical_request"
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
  | "procedural_preference"
  | "hypothetical_embodiment"
  | "remote_control_proposal"
  | "role_negotiation"
  | "service_initiation"
  | "service_direction"
  | "expectations"
  | "protocol_setup"
  | "service_preference"
  | "user_preference"
  | "equipment_disclosure"
  | "compound_relational_disclosure"
  | "clarification_recovery"
  | "dynamic_application"
  | "ambiguous_boundary_topic"
  | "safety_or_limits_discussion"
  | "compound_equipment_application"
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
  | "provide_procedural_preference"
  | "answer_hypothetical_embodiment"
  | "answer_remote_control_proposal"
  | "role_negotiation"
  | "service_initiation"
  | "service_direction"
  | "expectations"
  | "protocol_setup"
  | "service_preference"
  | "user_preference"
  | "equipment_disclosure"
  | "compound_relational_disclosure"
  | "clarification_recovery"
  | "dynamic_application"
  | "ambiguous_boundary_topic"
  | "safety_or_limits_discussion"
  | "compound_equipment_application"
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
  requested_facet?: TurnRequestedFacet;
  answer_contract?: TurnAnswerContract;
  primary_subject?: string | null;
  entity_set?: string[];
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
  requested_facets: TurnRequestedFacet[];
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
  dynamic_slots: RelationalDynamicSlots | null;
  confidence: number;
  components: TurnMeaningComponent[];
  compound_intent: boolean;
  normalization_applied: boolean;
  normalization_reason: string | null;
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
    | "relational_dynamic_answer"
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
  llmSemanticCandidates?: unknown[] | null;
  llmSemanticRejectedCandidates?: RejectedSemanticCandidate[] | null;
};

export type CanonicalTurnState = {
  turn_meaning: TurnMeaning;
  planned_move: PlannedMove;
  semantic_owner: "semantic_planner";
  fallback_allowed: boolean;
  semantic_arbitration: SemanticCandidateArbitrationTrace;
};

const PREFERENCE_DOMAIN_PATTERN =
  /\b(pegging|bondage|restraint|rope|cuffs?|collars?|chastity|cages?|plug|plugs|dildo|dildos|vibrator|wand|toy|toys|fetish|fetishes|kink|kinks|spanking|impact|pain|obedience|submission|dominance|control|humiliation|degradation|praise|service|strap-?on|anal(?:\s+play|\s+training)?|oral(?:\s+training)?|throat(?:\s+training)?)\b/i;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeLower(text: string): string {
  return normalize(text).toLowerCase();
}

function normalizeUserTextSemantically(input: TurnMeaningInput): {
  rawText: string;
  normalized: string;
  normalization_applied: boolean;
  normalization_reason: string | null;
} {
  const rawText = input.userText;
  let normalized = normalizeLower(rawText);
  const context = normalizeLower(
    `${rawText} ${input.previousAssistantText ?? ""} ${input.previousUserText ?? ""} ${input.currentTopic ?? ""}`,
  );
  const dynamicServeContext =
    /\b(?:serve|service|serving|mistress|submissive|dynamic|approval|rules?|tasks?|toys?|gear|equipment)\b/i.test(
      context,
    );
  if (
    dynamicServeContext &&
    /\bserver\s+better\b/i.test(normalized) &&
    !/\b(?:web|local|http|backend|database|api|node|windows|linux)\s+server\b/i.test(context)
  ) {
    normalized = normalized.replace(/\bserver\s+better\b/gi, "serve better");
    return {
      rawText,
      normalized,
      normalization_applied: true,
      normalization_reason:
        "low-risk semantic typo correction: server better -> serve better in active service/equipment context",
    };
  }
  return {
    rawText,
    normalized,
    normalization_applied: false,
    normalization_reason: null,
  };
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
    /\b(?:do you have|have you got|do you own|would you have|would you own|got any|is there|are there)\b[^?]{0,80}\b(?:strap-?on|strap|gear|cuffs?|rope|collar|toy|toys|plug|dildo|wand|cage)\b/i.test(
      normalized,
    ) ||
    /\bwould you use\b[^?]{0,80}\b(?:strap-?on|strap|gear|cuffs?|rope|collar|toy|toys|plug|dildo|wand|cage)\b/i.test(
      normalized,
    )
  );
}

function isProceduralPreferenceRequest(normalized: string): boolean {
  return (
    /\bwhat\s+(?:position|positions|pose)\b[^?]{0,80}\b(?:you like|do you like|you prefer|would you choose|when|for)\b/i.test(
      normalized,
    ) ||
    /\b(?:what|which)\s+(?:position|positions|pose)\s+(?:do|would)\s+you\s+(?:like|prefer|choose)\b/i.test(
      normalized,
    ) ||
    /\bhow would you position\b/i.test(normalized)
  );
}

function isHypotheticalEmbodimentRequest(normalized: string): boolean {
  return (
    /\bwhat if\b[^?!.]{0,120}\b(?:you had a body|had a body|physically here|in the room|same room)\b/i.test(
      normalized,
    ) ||
    /\bif you (?:had|were)\b[^?!.]{0,120}\b(?:a body|physically here|in the room|same room)\b/i.test(
      normalized,
    )
  );
}

function isRemoteControlProposal(normalized: string): boolean {
  return (
    /\b(?:remote|remotely|from a distance)\b[^?!.]{0,120}\b(?:peg|toy|control|use)\b/i.test(
      normalized,
    ) ||
    /\b(?:peg|control|use)\b[^?!.]{0,120}\b(?:remote|remotely|from a distance|toy you control|remote toy)\b/i.test(
      normalized,
    ) ||
    /\btoy you control\b/i.test(normalized) ||
    /\bremote toy\b/i.test(normalized)
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
  if (isHypotheticalEmbodimentRequest(input.normalized)) {
    return "hypothetical_request";
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
  if (isRemoteControlProposal(input.normalized)) {
    return "remote_control_proposal";
  }
  if (isHypotheticalEmbodimentRequest(input.normalized)) {
    return "hypothetical_embodiment";
  }
  if (isProceduralPreferenceRequest(input.normalized)) {
    return "procedural_preference";
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
    case "procedural_preference":
      return "provide_procedural_preference";
    case "hypothetical_embodiment":
      return "answer_hypothetical_embodiment";
    case "remote_control_proposal":
      return "answer_remote_control_proposal";
    case "role_negotiation":
      return "role_negotiation";
    case "service_initiation":
      return "service_initiation";
    case "service_direction":
      return "service_direction";
    case "expectations":
      return "expectations";
    case "protocol_setup":
      return "protocol_setup";
    case "service_preference":
      return "service_preference";
    case "user_preference":
      return "user_preference";
    case "equipment_disclosure":
      return "equipment_disclosure";
    case "compound_relational_disclosure":
      return "compound_relational_disclosure";
    case "clarification_recovery":
      return "clarification_recovery";
    case "dynamic_application":
      return "dynamic_application";
    case "ambiguous_boundary_topic":
      return "ambiguous_boundary_topic";
    case "safety_or_limits_discussion":
      return "safety_or_limits_discussion";
    case "compound_equipment_application":
      return "compound_equipment_application";
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
    case "procedural_preference":
      return ["item_referent", "procedure_preference", "boundary"];
    case "hypothetical_embodiment":
      return ["hypothetical_setup", "embodied_stance", "boundary"];
    case "remote_control_proposal":
      return ["proposal", "remote_capability_boundary", "available_next_step"];
    case "role_negotiation":
      return ["desired_role", "proposed_raven_role", "boundary", "next_step"];
    case "service_initiation":
      return ["requested_direction", "service_style", "boundary", "first_step"];
    case "service_direction":
      return ["requested_direction", "bounded_options", "boundary"];
    case "expectations":
      return ["expectation", "behavioral_expectations", "boundary"];
    case "protocol_setup":
      return ["requested_protocol", "rule_or_protocol", "consent_boundary"];
    case "service_preference":
      return ["service_style", "dynamic_next_step"];
    case "user_preference":
      return ["user_preference", "dynamic_meaning", "focused_follow_up"];
    case "equipment_disclosure":
      return ["disclosed_object", "capability_boundary", "focused_follow_up"];
    case "compound_relational_disclosure":
      return [
        "desired_service_lanes",
        "training_goals",
        "hard_limits",
        "boundary_preferences",
        "bounded_next_step",
      ];
    case "clarification_recovery":
      return ["previous_ask_summary", "previous_ask_slots", "example_user_response"];
    case "compound_equipment_application":
      return ["disclosed_object", "invitation_answer", "dynamic_application", "capability_boundary", "bounded_next_step"];
    case "dynamic_application":
      return ["item_referent", "dynamic_application", "capability_boundary"];
    case "ambiguous_boundary_topic":
      return ["ambiguous_topic", "clarifying_question", "safety_boundary"];
    case "safety_or_limits_discussion":
      return ["boundary_or_safety_needed", "limits_frame"];
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
  if (isRelationalDynamicFacet(facet)) {
    return "relational_dynamics";
  }
  if (
    facet === "procedural_preference" ||
    facet === "hypothetical_embodiment" ||
    facet === "remote_control_proposal"
  ) {
    return "raven_preferences";
  }
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

function isRelationalDynamicFacet(facet: TurnRequestedFacet): boolean {
  return (
    facet === "role_negotiation" ||
    facet === "service_initiation" ||
    facet === "service_direction" ||
    facet === "expectations" ||
    facet === "protocol_setup" ||
    facet === "service_preference" ||
    facet === "user_preference" ||
    facet === "equipment_disclosure" ||
    facet === "compound_relational_disclosure" ||
    facet === "clarification_recovery" ||
    facet === "dynamic_application" ||
    facet === "ambiguous_boundary_topic" ||
    facet === "safety_or_limits_discussion" ||
    facet === "compound_equipment_application"
  );
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
    "procedural_preference",
    "hypothetical_embodiment",
    "remote_control_proposal",
    "clarifying_enumeration",
    "invitation_response",
    "application_explanation",
    "challenge_response",
    "reciprocal_probe",
  ],
  definitions: ["definition"],
  relational_dynamics: [
    "application_explanation",
    "invitation_response",
    "remote_control_proposal",
    "clarification",
    "role_negotiation",
    "service_initiation",
    "service_direction",
    "expectations",
    "protocol_setup",
    "service_preference",
    "user_preference",
    "equipment_disclosure",
    "compound_relational_disclosure",
    "clarification_recovery",
    "dynamic_application",
    "ambiguous_boundary_topic",
    "safety_or_limits_discussion",
  ],
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
  normalization_applied?: boolean;
  normalization_reason?: string | null;
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
  dynamic_slots?: RelationalDynamicSlots | null;
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
    requested_facet,
    answer_contract,
    primary_subject,
    entity_set,
  };
  const components = input.components ?? [primaryComponent];
  const requested_facets = Array.from(
    new Set([requested_facet, ...components.map((component) => component.requested_facet)].filter(Boolean)),
  ) as TurnRequestedFacet[];
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
    requested_facets,
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
    dynamic_slots: input.dynamic_slots ?? null,
    confidence: input.confidence,
    components,
    compound_intent: components.length > 1 || requested_facets.length > 1,
    normalization_applied: input.normalization_applied ?? input.normalized !== normalizeLower(input.rawText),
    normalization_reason:
      input.normalization_reason ??
      (input.normalized !== normalizeLower(input.rawText) ? "semantic normalization changed user text" : null),
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
    isProceduralPreferenceRequest(selfNormalized) ||
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

function isSemanticContinuationRequest(normalized: string): boolean {
  return /\b(?:yes\s+please|please)?\s*(?:(?:mistress|sir|ma'am|pet|dear)[,\s]+)?(?:explain(?:\s+(?:it|that|this))?|say more|tell me how|how would that work|what do you mean(?: by that)?|explain that more)\??\s*$/i.test(
    normalized,
  );
}

function isUserConfusionRequest(normalized: string): boolean {
  return (
    /^(?:i\s+(?:dont|don't|do not)\s+understand(?:\s+what\s+you(?:'re| are)\s+asking\s+for)?|what\s+do\s+you\s+mean|can\s+you\s+clarify|what\s+are\s+you\s+asking\s+me\s+to\s+do|can\s+you\s+give\s+me\s+an\s+example)\??$/i.test(
      normalized,
    ) ||
    /^explain\s+(?:that|it|this)\s+more\s+simply\??$/i.test(normalized)
  );
}

type PreviousSubstantiveAsk = {
  ask_type: string;
  ask_slots: string[];
  plain_language_summary: string;
  example_user_response: string;
  semantic_plan_id: string;
};

function inferPreviousSubstantiveAsk(text: string | null | undefined): PreviousSubstantiveAsk | null {
  const normalized = normalize(text ?? "");
  if (!normalized) {
    return null;
  }
  if (/\bthree-line check-in\b|\brole,\s*one limit\b|\brole\b[\s\S]{0,100}\blimit\b[\s\S]{0,100}\bservice lane\b/i.test(normalized)) {
    return {
      ask_type: "service_setup_checkin",
      ask_slots: ["role", "limit", "service_lane"],
      plain_language_summary:
        "I was asking you to make the service dynamic concrete: name your role, one boundary I should respect, and the kind of service you want to start with.",
      example_user_response:
        "I want to be your submissive. My hard limit is scat. I want to start with tasks and permission rules.",
      semantic_plan_id: "semantic_planner:relational_dynamic_answer:service_direction",
    };
  }
  if (/\bservice lane\b[\s\S]{0,160}\btraining goal\b|\bintensity level\b|\banal training frame\b/i.test(normalized)) {
    return {
      ask_type: "compound_boundary_setup",
      ask_slots: ["service_lane", "training_goal", "hard_limit", "intensity_level"],
      plain_language_summary:
        "I was separating your service plan from your boundaries: what service lane you want, what training goal you mean, what is off-limits, and how intense the starting frame should be.",
      example_user_response:
        "Tasks first. Anal training is the goal. Scat is off-limits. Start with a low intensity level.",
      semantic_plan_id: "semantic_planner:relational_dynamic_answer:compound_relational_disclosure",
    };
  }
  if (/\bchoose one item\b|\btell me the limit\b|\breport before and after\b|\brestraint, denial, permission, accountability\b/i.test(normalized)) {
    return {
      ask_type: "equipment_protocol_setup",
      ask_slots: ["item", "limit", "meaning"],
      plain_language_summary:
        "I was asking you to choose one disclosed item, name the limit for it, and say what it should mean in the dynamic.",
      example_user_response:
        "Use the cage for denial, the limit is no pain or public exposure, and I will report before and after.",
      semantic_plan_id: "semantic_planner:relational_dynamic_answer:dynamic_application",
    };
  }
  if (/\brole options\b|\bthree clean role options\b|\bservice submissive\b|\bchoose the first rule\b/i.test(normalized)) {
    return {
      ask_type: "role_guidance_choice",
      ask_slots: ["role_choice", "first_rule", "limit"],
      plain_language_summary:
        "I was giving you role options and asking you to choose the starting frame before we treat it as a real dynamic.",
      example_user_response:
        "Service submissive fits. My first rule is permission before tasks, and scat is a hard limit.",
      semantic_plan_id: "semantic_planner:relational_dynamic_answer:role_negotiation",
    };
  }
  return null;
}

function inferPriorRelationalFacet(text: string | null | undefined): TurnRequestedFacet | null {
  const normalized = normalizeLower(text ?? "");
  if (!normalized) {
    return null;
  }
  if (
    /\b(training|anal control|paced anal|slow anal hold|bondage discipline|obedience training|proof|pressure|main focus|next round|same line|other angle|control instead of noise|line cleaner)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }
  if (/\b(role|roles|submissive|service submissive|pet|servant|mistress\/submissive)\b/i.test(normalized)) {
    return "role_negotiation";
  }
  if (/\b(chastity cage|butt plug|restraints?|dildos?|collar|leash|cuffs?|rope|toy|toys|gear|equipment)\b/i.test(normalized)) {
    if (/\b(use|used|protocol|incorporate|report before and after|choose one item)\b/i.test(normalized)) {
      return "dynamic_application";
    }
    return "equipment_disclosure";
  }
  if (/\b(check-in|service lane|serve|service|rules|tasks|permission|approval|accountability)\b/i.test(normalized)) {
    return "service_direction";
  }
  if (/\b(protocol|permission rule|report rule|stop phrase)\b/i.test(normalized)) {
    return "protocol_setup";
  }
  return null;
}

function continuationSubjectForFacet(facet: TurnRequestedFacet, previousAssistantText: string | null | undefined): string {
  if (facet === "role_negotiation") {
    return "role guidance";
  }
  if (facet === "dynamic_application" || facet === "equipment_disclosure") {
    const objects = normalizeLower(previousAssistantText ?? "").match(
      /\b(chastity cage|butt plug|restraints?|dildos?|collar|leash|cuffs?|rope|toy|toys|gear|equipment)\b/gi,
    );
    return objects ? Array.from(new Set(objects.map((value) => value.toLowerCase()))).join(", ") : "disclosed equipment";
  }
  if (facet === "service_direction") {
    return "service direction";
  }
  return "prior relational point";
}

export function interpretTurnMeaning(input: TurnMeaningInput): TurnMeaning {
  const semanticNormalization = normalizeUserTextSemantically(input);
  const rawText = semanticNormalization.rawText;
  const normalized = semanticNormalization.normalized;
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

  const previousAsk = inferPreviousSubstantiveAsk(input.previousAssistantText);
  if (previousAsk && isUserConfusionRequest(normalized)) {
    return buildMeaning({
      rawText,
      normalized,
      normalization_applied: semanticNormalization.normalization_applied,
      normalization_reason: semanticNormalization.normalization_reason,
      speech_act: "user_confusion",
      target: "prior_assistant_answer",
      subject_domain: "relational_exchange",
      requested_operation: "clarify",
      referent: previousAsk.plain_language_summary,
      stance: "curious",
      continuity_attachment: "immediate_prior_answer",
      confidence: 0.91,
      question_shape: "clarification_request",
      requested_facet: "clarification_recovery",
      answer_contract: "clarification_recovery",
      primary_subject: previousAsk.plain_language_summary,
      entity_set: previousAsk.ask_slots,
      required_referent: previousAsk.plain_language_summary,
      required_scope: "answer_plus_explanation",
      current_domain_handler: "relational_dynamics",
      dynamic_slots: {
        ...EMPTY_RELATIONAL_DYNAMIC_SLOTS,
        previous_ask_id: previousAsk.semantic_plan_id,
        previous_ask_type: previousAsk.ask_type,
        previous_ask_slots: previousAsk.ask_slots,
        previous_ask_summary: previousAsk.plain_language_summary,
        previous_ask_example: previousAsk.example_user_response,
        clarification_recovery_used: true,
        boundary_or_safety_needed: true,
      },
      components: [
        {
          speech_act: "user_confusion",
          target: "prior_assistant_answer",
          subject_domain: "relational_exchange",
          requested_operation: "clarify",
          referent: previousAsk.plain_language_summary,
          requested_facet: "clarification_recovery",
          answer_contract: "clarification_recovery",
          primary_subject: previousAsk.plain_language_summary,
          entity_set: previousAsk.ask_slots,
        },
      ],
      alternative_interpretations: [
        alternative("clarification", "clarify", 0.6, "surface form asks what the previous answer meant"),
      ],
    });
  }

  if (isSemanticContinuationRequest(normalized) && input.previousAssistantText) {
    const priorFacet = inferPriorRelationalFacet(input.previousAssistantText);
    if (priorFacet) {
      const facet =
        priorFacet === "equipment_disclosure" && /\b(?:tell me how|how would|how does|how do)\b/i.test(normalized)
          ? "dynamic_application"
          : priorFacet;
      const subject = continuationSubjectForFacet(facet, input.previousAssistantText);
      return buildMeaning({
        rawText,
        normalized,
        normalization_applied: semanticNormalization.normalization_applied,
        normalization_reason: semanticNormalization.normalization_reason,
        speech_act: "clarification",
        target: "prior_assistant_answer",
        subject_domain: "relational_exchange",
        requested_operation: facet === "dynamic_application" ? "explain_application" : "clarify",
        referent: subject,
        stance: "curious",
        continuity_attachment: "immediate_prior_answer",
        confidence: 0.89,
        question_shape: facet === "dynamic_application" ? "application_request" : "clarification_request",
        requested_facet: facet,
        answer_contract: facet === "dynamic_application" ? "dynamic_application" : (facet as TurnAnswerContract),
        primary_subject: subject,
        entity_set: subject.split(/\s*,\s*/).filter(Boolean),
        required_referent: subject,
        required_scope: "answer_plus_explanation",
        current_domain_handler: "relational_dynamics",
        dynamic_slots: {
          ...EMPTY_RELATIONAL_DYNAMIC_SLOTS,
          disclosed_objects:
            facet === "dynamic_application" || facet === "equipment_disclosure"
              ? subject.split(/\s*,\s*/).filter(Boolean)
              : [],
          disclosed_object:
            facet === "dynamic_application" || facet === "equipment_disclosure"
              ? subject.split(/\s*,\s*/).filter(Boolean)[0] ?? null
              : null,
          requested_direction: facet === "dynamic_application" ? "how the prior disclosed equipment should be used" : null,
          boundary_or_safety_needed: true,
        },
        components: [
          {
            speech_act: "clarification",
            target: "prior_assistant_answer",
            subject_domain: "relational_exchange",
            requested_operation: "clarify",
            referent: subject,
            requested_facet: facet,
            answer_contract: facet === "dynamic_application" ? "dynamic_application" : (facet as TurnAnswerContract),
            primary_subject: subject,
            entity_set: subject.split(/\s*,\s*/).filter(Boolean),
          },
        ],
        alternative_interpretations: [
          alternative("continuation", "continue", 0.34, "surface form is a short continuation"),
        ],
      });
    }
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

  const relationalDynamic = classifyRelationalDynamicTurn({
    text: normalized,
    previousAssistantText: input.previousAssistantText,
    previousUserText: input.previousUserText,
    currentTopic: input.currentTopic,
  });

  if (relationalDynamic.eligible && relationalDynamic.speech_act && relationalDynamic.requested_facet) {
    const referent = relationalDynamic.primary_subject;
    return buildMeaning({
      rawText,
      normalized,
      normalization_applied: semanticNormalization.normalization_applied,
      normalization_reason: semanticNormalization.normalization_reason,
      speech_act: relationalDynamic.speech_act,
      target: "assistant",
      subject_domain: "relational_exchange",
      requested_operation:
        relationalDynamic.requested_facet === "dynamic_application"
          ? "explain_application"
          : relationalDynamic.slots.follow_up_needed
            ? "ask_follow_up"
            : "answer",
      referent,
      stance: relationalDynamic.slots.boundary_or_safety_needed ? "curious" : "reciprocal",
      continuity_attachment: input.previousAssistantText ? "active_thread" : "fresh_topic",
      confidence: relationalDynamic.confidence,
      question_shape:
        relationalDynamic.speech_act === "user_equipment_disclosure" ||
        relationalDynamic.speech_act === "user_capability_disclosure" ||
        relationalDynamic.speech_act === "user_preference_disclosure" ||
        relationalDynamic.speech_act === "service_preference_disclosure"
          ? "statement_or_disclosure"
          : relationalDynamic.speech_act === "role_proposal"
            ? "invitation_or_proposal"
            : relationalDynamic.requested_facet === "dynamic_application"
              ? "application_request"
              : "open_question",
      requested_facet: relationalDynamic.requested_facet,
      answer_contract:
        (relationalDynamic.answer_contract ??
          relationalDynamic.requested_facet) as RelationalDynamicAnswerContract as TurnAnswerContract,
      required_answer_slots:
        relationalDynamic.answer_contract === "compound_equipment_application"
          ? slotsForFacet("compound_equipment_application")
          : undefined,
      primary_subject: relationalDynamic.primary_subject,
      entity_set: relationalDynamic.entity_set,
      required_referent: relationalDynamic.primary_subject,
      required_scope: relationalDynamic.slots.follow_up_needed
        ? "answer_plus_follow_up_question"
        : "answer_plus_explanation",
      current_domain_handler: "relational_dynamics",
      dynamic_slots: relationalDynamic.slots,
      components: relationalDynamic.components.map((component) => ({
        speech_act: component.speech_act,
        target: "assistant",
        subject_domain: "relational_exchange",
        requested_operation:
          component.requested_facet === "dynamic_application"
            ? "explain_application"
            : component.requested_facet === "equipment_disclosure"
              ? "acknowledge_and_probe"
              : "answer",
        referent: component.primary_subject,
        requested_facet: component.requested_facet,
        answer_contract: component.answer_contract as TurnAnswerContract,
        primary_subject: component.primary_subject,
        entity_set: component.entity_set,
      })),
      alternative_interpretations: [
        alternative(
          "direct_question",
          "answer",
          0.34,
          "relational dynamic turns can superficially look like generic questions",
        ),
      ],
    });
  }

  if (isHypotheticalEmbodimentRequest(normalized)) {
    const referent =
      extractPreferenceDomainReferent(rawText) ??
      extractToolReferent(rawText) ??
      "hypothetical embodied setup";
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "direct_question",
      target: "assistant",
      subject_domain: "assistant_preferences",
      requested_operation: "answer",
      referent,
      stance: "curious",
      continuity_attachment: "active_thread",
      confidence: 0.86,
      question_shape: "hypothetical_request",
      requested_facet: "hypothetical_embodiment",
      answer_contract: "answer_hypothetical_embodiment",
      current_domain_handler: "raven_preferences",
      alternative_interpretations: [
        alternative("request_for_advice", "explain_application", 0.42, "counterfactual could be applied to the active dynamic"),
      ],
    });
  }

  if (isRemoteControlProposal(normalized)) {
    const referent =
      extractPreferenceDomainReferent(rawText) ??
      extractToolReferent(rawText) ??
      extractRecentPreferenceReferent(input.previousAssistantText) ??
      extractRecentPreferenceReferent(input.currentTopic) ??
      "remote toy control";
    return buildMeaning({
      rawText,
      normalized,
      speech_act: isQuestionLike(normalized) ? "direct_question" : "request_for_advice",
      target: "assistant",
      subject_domain: "assistant_preferences",
      requested_operation: "answer",
      referent,
      stance: "curious",
      continuity_attachment: "active_thread",
      confidence: 0.84,
      question_shape: "invitation_or_proposal",
      requested_facet: "remote_control_proposal",
      answer_contract: "answer_remote_control_proposal",
      current_domain_handler: "raven_preferences",
      alternative_interpretations: [
        alternative("direct_question", "answer", 0.48, "remote tool proposal also asks about actual capability"),
      ],
    });
  }

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
    const hasProceduralFacet = isProceduralPreferenceRequest(normalized);
    const requestedOperation: TurnRequestedOperation =
      binaryEntities.length === 2
        ? "compare"
        : hasReasonFacet
          ? "elaborate"
          : hasProceduralFacet
            ? "answer"
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
        : hasProceduralFacet
          ? extractPreferenceDomainReferent(selfNormalized) ??
            extractRecentPreferenceReferent(input.previousAssistantText) ??
            "the active preference topic"
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
        : hasProceduralFacet
          ? "procedural_preference"
        : hasReasonFacet
          ? "reason_about_item"
          : undefined,
      answer_contract: hasToolFacet
        ? "answer_possession_or_tool_availability"
        : hasProceduralFacet
          ? "provide_procedural_preference"
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

  if (/^\s*what else\??\s*$/i.test(rawText)) {
    return buildMeaning({
      rawText,
      normalized,
      speech_act: "request_for_elaboration",
      target: "shared_topic",
      subject_domain: "general",
      requested_operation: "continue",
      referent: cleanReferent(input.currentTopic) ?? null,
      stance: "curious",
      continuity_attachment: input.previousAssistantText ? "active_thread" : "none",
      confidence: 0.74,
      question_shape: "unknown",
      requested_facet: "continuation",
      answer_contract: "continue",
      current_domain_handler: "conversation",
    });
  }

  if (/^(?:what do you mean\??|explain\??|clarify\??|what\??|huh\??)$/i.test(normalized)) {
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

  if (turnMeaning.current_domain_handler === "relational_dynamics") {
    return {
      move:
        turnMeaning.requested_facet === "service_initiation" ||
        turnMeaning.requested_facet === "service_direction" ||
        turnMeaning.requested_facet === "protocol_setup"
          ? "answer"
          : turnMeaning.dynamic_slots?.follow_up_needed
            ? "ask_focused_follow_up"
            : "answer",
      target: turnMeaning.target,
      subject_domain: turnMeaning.subject_domain,
      requested_operation: turnMeaning.requested_operation,
      referent: turnMeaning.referent,
      requested_facet: turnMeaning.requested_facet,
      answer_contract: turnMeaning.answer_contract,
      content_key: "relational_dynamic_answer",
      confidence: turnMeaning.confidence,
      reason: "relational dynamic turn requires structured role, service, protocol, or boundary handling",
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

function facetRequiresReferent(facet: TurnRequestedFacet): boolean {
  return (
    facet === "yes_no_about_item" ||
    facet === "reason_about_item" ||
    facet === "possession_or_tool_availability" ||
    facet === "procedural_preference" ||
    facet === "application_explanation" ||
    facet === "role_negotiation" ||
    facet === "expectations" ||
    facet === "protocol_setup" ||
    facet === "service_preference" ||
    facet === "user_preference" ||
    facet === "equipment_disclosure" ||
    facet === "compound_relational_disclosure" ||
    facet === "clarification_recovery" ||
    facet === "dynamic_application" ||
    facet === "ambiguous_boundary_topic" ||
    facet === "safety_or_limits_discussion" ||
    facet === "definition"
  );
}

function buildMeaningFromSemanticCandidate(
  input: TurnMeaningInput,
  candidate: SemanticCandidate,
): TurnMeaning {
  const normalized = normalizeLower(input.userText);
  return buildMeaning({
    rawText: input.userText,
    normalized,
    speech_act: candidate.speech_act,
    target: candidate.target,
    subject_domain: candidate.subject_domain,
    requested_operation: candidate.requested_operation,
    referent: candidate.required_referent ?? candidate.primary_subject,
    stance: candidate.speech_act === "challenge" ? "challenging" : "curious",
    continuity_attachment: candidate.continuity_attachment,
    confidence: candidate.confidence,
    question_shape: candidate.question_shape,
    requested_facet: candidate.requested_facet,
    primary_subject: candidate.primary_subject,
    secondary_subjects: candidate.secondary_subjects,
    entity_set: candidate.entity_set,
    required_referent: candidate.required_referent,
    required_scope: candidate.required_scope,
    current_domain_handler: candidate.current_domain_handler,
    alternative_interpretations: candidate.alternative_interpretations,
  });
}

function isStrongDefinitionSurface(normalizedText: string): boolean {
  return /^(?:define|what(?:'s| is| does)\b)|\bmeaning\??$/i.test(normalizedText);
}

function conflictsWithStrongLocalContext(
  deterministic: TurnMeaning,
  candidate: TurnMeaning,
): string | null {
  if (deterministic.speech_act === "greeting" && candidate.speech_act !== "greeting") {
    return "conflicts_with_strong_greeting_context";
  }
  if (
    deterministic.requested_facet === "current_activity_or_status" &&
    candidate.requested_facet !== "current_activity_or_status"
  ) {
    return "conflicts_with_current_status_context";
  }
  if (
    deterministic.requested_facet === "definition" &&
    candidate.requested_facet !== "definition" &&
    isStrongDefinitionSurface(deterministic.normalized_text)
  ) {
    return "conflicts_with_definition_context";
  }
  if (
    deterministic.confidence >= 0.9 &&
    deterministic.current_domain_handler !== "raven_preferences" &&
    candidate.current_domain_handler === "raven_preferences"
  ) {
    return "overclaims_raven_preferences_against_strong_local_context";
  }
  return null;
}

function facetSpecificityRank(facet: TurnRequestedFacet): number {
  switch (facet) {
    case "favorites_subset":
    case "reason_about_item":
    case "procedural_preference":
    case "possession_or_tool_availability":
    case "hypothetical_embodiment":
    case "remote_control_proposal":
    case "role_negotiation":
    case "service_initiation":
    case "service_direction":
    case "expectations":
    case "protocol_setup":
    case "service_preference":
    case "user_preference":
    case "equipment_disclosure":
    case "compound_relational_disclosure":
    case "clarification_recovery":
    case "dynamic_application":
    case "ambiguous_boundary_topic":
    case "safety_or_limits_discussion":
    case "binary_compare_or_choice":
    case "yes_no_about_item":
      return 3;
    case "application_explanation":
    case "invitation_response":
    case "challenge_response":
    case "clarifying_enumeration":
      return 2;
    case "category_overview":
    case "definition":
    case "factual_answer":
    case "current_activity_or_status":
      return 1;
    default:
      return 0;
  }
}

function canModelCandidateRefineCoarseLocalMeaning(input: {
  deterministic: TurnMeaning;
  candidate: TurnMeaning;
  deterministicScore: number;
  candidateScore: number;
}): boolean {
  if (input.candidateScore < input.deterministicScore - 0.25) {
    return false;
  }
  if (
    input.deterministic.current_domain_handler === input.candidate.current_domain_handler &&
    facetSpecificityRank(input.candidate.requested_facet) >
      facetSpecificityRank(input.deterministic.requested_facet)
  ) {
    return true;
  }
  if (
    input.deterministic.requested_facet === "definition" &&
    input.candidate.requested_facet !== "definition" &&
    input.candidate.target === "assistant" &&
    !isStrongDefinitionSurface(input.deterministic.normalized_text)
  ) {
    return true;
  }
  return false;
}

function semanticMeaningScore(meaning: TurnMeaning): number {
  let score = meaning.confidence;
  if (meaning.current_domain_handler !== "conversation" || meaning.requested_facet === "current_activity_or_status") {
    score += 0.1;
  }
  if (meaning.requested_facet !== "unknown" && meaning.answer_contract !== "continue") {
    score += 0.08;
  }
  if (!facetRequiresReferent(meaning.requested_facet) || meaning.required_referent) {
    score += 0.06;
  }
  if (meaning.entity_set.length > 0) {
    score += 0.04;
  }
  if (
    meaning.continuity_attachment === "immediate_prior_answer" ||
    meaning.continuity_attachment === "active_thread"
  ) {
    score += 0.03;
  }
  score += facetSpecificityRank(meaning.requested_facet) * 0.03;
  if (meaning.current_domain_handler === "raven_preferences" && meaning.requested_facet === "definition") {
    score -= 0.5;
  }
  return score;
}

function chooseSemanticCandidate(input: {
  turnInput: TurnMeaningInput;
  deterministicMeaning: TurnMeaning;
  rawLlmCandidates: unknown[];
  preRejectedCandidates?: RejectedSemanticCandidate[];
}): { turnMeaning: TurnMeaning; trace: SemanticCandidateArbitrationTrace } {
  const deterministicCandidate = semanticCandidateFromTurnMeaning(input.deterministicMeaning);
  const rejectedCandidates: RejectedSemanticCandidate[] = [...(input.preRejectedCandidates ?? [])];
  const validLlmCandidates: SemanticCandidate[] = [];
  const scored: Array<{ candidate: SemanticCandidate; meaning: TurnMeaning; score: number }> = [
    {
      candidate: deterministicCandidate,
      meaning: input.deterministicMeaning,
      score: semanticMeaningScore(input.deterministicMeaning),
    },
  ];

  input.rawLlmCandidates.slice(0, 3).forEach((rawCandidate, index) => {
    const schema = validateSemanticCandidateSchema(rawCandidate);
    if (!schema.ok) {
      rejectedCandidates.push({
        source: "llm",
        index,
        reason: schema.reason,
        candidate: null,
      });
      return;
    }
    const candidate = { ...schema.candidate, source: "llm" as const };
    validLlmCandidates.push(candidate);
    const meaning = buildMeaningFromSemanticCandidate(input.turnInput, candidate);
    if (meaning.current_domain_handler !== candidate.current_domain_handler) {
      rejectedCandidates.push({
        source: "llm",
        index,
        reason: "unsupported_handler_eligibility",
        candidate,
      });
      return;
    }
    if (facetRequiresReferent(candidate.requested_facet) && !candidate.required_referent) {
      rejectedCandidates.push({
        source: "llm",
        index,
        reason: "missing_required_referent",
        candidate,
      });
      return;
    }
    if (candidate.requested_facet === "binary_compare_or_choice" && candidate.entity_set.length < 2) {
      rejectedCandidates.push({
        source: "llm",
        index,
        reason: "missing_compare_entities",
        candidate,
      });
      return;
    }
    const conflict = conflictsWithStrongLocalContext(input.deterministicMeaning, meaning);
    if (conflict) {
      rejectedCandidates.push({
        source: "llm",
        index,
        reason: conflict,
        candidate,
      });
      return;
    }
    scored.push({ candidate, meaning, score: semanticMeaningScore(meaning) });
  });

  scored.sort((left, right) => right.score - left.score);
  const deterministicScore = scored.find((entry) => entry.candidate.source === "deterministic")?.score ?? 0;
  const deterministicEntry = scored.find((entry) => entry.candidate.source === "deterministic");
  const bestLlm = scored.find((entry) => entry.candidate.source === "llm");
  const best = scored[0] ?? {
    candidate: deterministicCandidate,
    meaning: input.deterministicMeaning,
    score: deterministicScore,
  };
  const deterministicNeedsHelp =
    input.deterministicMeaning.requested_facet === "unknown" ||
    input.deterministicMeaning.subject_domain === "general" ||
    (input.deterministicMeaning.requested_facet === "definition" &&
      /\b(?:do you like|are you into|you into|stuff|things|dynamics)\b/i.test(
        input.deterministicMeaning.normalized_text,
      )) ||
    input.deterministicMeaning.answer_contract === "continue";
  const llmMayRefineDeterministic =
    bestLlm &&
    canModelCandidateRefineCoarseLocalMeaning({
      deterministic: input.deterministicMeaning,
      candidate: bestLlm.meaning,
      deterministicScore,
      candidateScore: bestLlm.score,
    });
  const chosen =
    bestLlm &&
    (deterministicNeedsHelp || bestLlm.score >= deterministicScore + 0.07 || llmMayRefineDeterministic)
      ? bestLlm
      : deterministicEntry ?? best;

  scored.forEach((entry, index) => {
    if (entry.candidate.source !== "llm") {
      return;
    }
    if (entry.candidate === chosen.candidate) {
      return;
    }
    if (
      rejectedCandidates.some(
        (rejected) => rejected.candidate === entry.candidate,
      )
    ) {
      return;
    }
    rejectedCandidates.push({
      source: "llm",
      index,
      reason: "lower_arbitration_score",
      candidate: entry.candidate,
    });
  });

  return {
    turnMeaning: chosen.meaning,
    trace: {
      deterministic_candidate: deterministicCandidate,
      llm_candidates: validLlmCandidates,
      chosen_candidate: chosen.candidate,
      chosen_source: chosen.candidate.source,
      rejected_candidates: rejectedCandidates,
      arbitration_reason:
        chosen.candidate.source === "llm"
          ? "llm_candidate_passed_schema_eligibility_and_scored_higher"
          : "deterministic_candidate_retained",
    },
  };
}

export function updateCanonicalTurnState(input: TurnMeaningInput): CanonicalTurnState {
  const deterministicMeaning = interpretTurnMeaning(input);
  const arbitration = chooseSemanticCandidate({
    turnInput: input,
    deterministicMeaning,
    rawLlmCandidates: input.llmSemanticCandidates ?? [],
    preRejectedCandidates: input.llmSemanticRejectedCandidates ?? [],
  });
  const turnMeaning = arbitration.turnMeaning;
  const plannedMove = planSemanticResponse(turnMeaning);
  return {
    turn_meaning: turnMeaning,
    planned_move: plannedMove,
    semantic_owner: "semantic_planner",
    fallback_allowed: plannedMove.content_key === "unknown_clarify" || plannedMove.confidence < 0.4,
    semantic_arbitration: arbitration.trace,
  };
}

export type SemanticTurnTrace = {
  turn_meaning: TurnMeaning;
  planned_move: PlannedMove;
  semantic_owned: boolean;
  semantic_owner_id: string | null;
  winning_subsystem: string;
  content_source: string;
  content_source_before_gate: string | null;
  content_source_after_gate: string;
  style_wrapper_applied: boolean;
  guard_intervention: boolean;
  gate_replaced_output: boolean;
  replacement_source: string | null;
  scaffold_source: string | null;
  device_command_channel_used: boolean;
  visible_text_contains_tool_command: boolean;
  final_visible_source: string;
  commit_owner_id: string | null;
  legacy_override_attempted: boolean;
  previous_semantic_plan_id: string | null;
  continuation_attached_to_plan_id: string | null;
  continuation_attachment_reason: string | null;
  stale_scaffold_rejected: boolean;
  stale_game_scaffold_rejected: boolean;
  previous_substantive_ask_id: string | null;
  clarification_attached_to_ask_id: string | null;
  clarification_recovery_used: boolean;
  raw_echo_lint_rejected: boolean;
  compound_relational_slots: {
    desired_service_lanes: string[];
    intensity_preferences: string[];
    training_goals: string[];
    hard_limits: string[];
    boundary_preferences: string[];
    dynamic_goals: string[];
  } | null;
  equipment_disclosure_detected: boolean;
  equipment_rejection_reason: string | null;
  eligible_handlers_considered: DomainHandlerEligibilityDecision[];
  chosen_handler: TurnDomainHandler;
  rejected_handlers: DomainHandlerEligibilityDecision[];
  answer_contract_validation: {
    ok: boolean;
    reason: string;
  } | null;
  visible_lint_result: {
    ok: boolean;
    reason: string;
  } | null;
  answer_intent: {
    answer_mode: string;
    primary_claim_type: string;
    required_answer_slots: string[];
    embodiment_context: string;
    visible_response_contract: {
      answer_mode: string;
      must_address_referent: boolean;
      requires_boundary: boolean;
      required_slots: string[];
      must_include_any: string[];
      must_not_include: string[];
    };
  } | null;
  semantic_arbitration: SemanticCandidateArbitrationTrace | null;
  required_answer_slots: string[];
  relational_dynamic_trace: RelationalDynamicTrace | null;
};

export function buildSemanticTurnTrace(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
  winningSubsystem: string;
  contentSource?: string;
  contentSourceBeforeGate?: string | null;
  styleWrapperApplied: boolean;
  guardIntervention: boolean;
  gateReplacedOutput?: boolean;
  replacementSource?: string | null;
  scaffoldSource?: string | null;
  deviceCommandChannelUsed?: boolean;
  visibleTextContainsToolCommand?: boolean;
  finalVisibleSource?: string | null;
  commitOwnerId?: string | null;
  legacyOverrideAttempted?: boolean;
  answerContractValidation?: {
    ok: boolean;
    reason: string;
  } | null;
  visibleLintResult?: {
    ok: boolean;
    reason: string;
  } | null;
  answerIntent?: SemanticTurnTrace["answer_intent"];
  semanticArbitration?: SemanticCandidateArbitrationTrace | null;
  relationalDynamicTrace?: RelationalDynamicTrace | null;
  previousSemanticPlanId?: string | null;
  continuationAttachedToPlanId?: string | null;
  continuationAttachmentReason?: string | null;
  staleScaffoldRejected?: boolean;
  staleGameScaffoldRejected?: boolean;
  rawEchoLintRejected?: boolean;
}): SemanticTurnTrace {
  const semanticOwnedContentKeys = new Set([
    "greeting_open",
    "assistant_preference_answer",
    "assistant_preference_elaboration",
    "assistant_preference_clarification",
    "assistant_preference_revision",
    "user_preference_application",
    "raven_invitation_answer",
    "relational_dynamic_answer",
    "reciprocal_user_probe",
    "definition_answer",
    "factual_answer",
    "current_status_answer",
    "clarification_answer",
  ]);
  const semanticOwned = semanticOwnedContentKeys.has(input.plannedMove.content_key);
  const defaultRelationalTrace =
    input.turnMeaning.current_domain_handler === "relational_dynamics"
      ? buildRelationalDynamicTrace({
          isEligible: true,
          speechAct: input.turnMeaning.speech_act,
          requestedFacet: input.turnMeaning.requested_facet,
          slots: input.turnMeaning.dynamic_slots ?? EMPTY_RELATIONAL_DYNAMIC_SLOTS,
          components: input.turnMeaning.components
            .filter((component) => component.requested_facet)
            .map((component) => ({
              speech_act: component.speech_act as never,
              requested_facet: component.requested_facet as never,
              answer_contract: component.answer_contract as never,
              primary_subject: component.primary_subject ?? component.referent,
              entity_set: component.entity_set ?? [],
            })),
          stateUpdate: dynamicStateUpdateForInterpretation({
            eligible: true,
            speech_act: input.turnMeaning.speech_act as never,
            requested_facet: input.turnMeaning.requested_facet as never,
            answer_contract: input.turnMeaning.answer_contract as never,
            answer_mode: null,
            primary_subject: input.turnMeaning.primary_subject,
            entity_set: input.turnMeaning.entity_set,
            slots: input.turnMeaning.dynamic_slots ?? EMPTY_RELATIONAL_DYNAMIC_SLOTS,
            components: [],
            confidence: input.turnMeaning.confidence,
            reason: "trace state update from turn meaning",
          }),
          validation: input.answerContractValidation ?? null,
          rejectedHandlers: input.turnMeaning.rejected_domain_handlers.map((decision) => ({
            handler: decision.handler,
            reason: decision.reason,
          })),
        })
      : null;
  return {
    turn_meaning: input.turnMeaning,
    planned_move: input.plannedMove,
    semantic_owned: semanticOwned,
    semantic_owner_id:
      semanticOwned
        ? `semantic_planner:${input.plannedMove.content_key}`
        : null,
    winning_subsystem: input.winningSubsystem,
    content_source: input.contentSource ?? input.winningSubsystem,
    content_source_before_gate: input.contentSourceBeforeGate ?? null,
    content_source_after_gate: input.contentSource ?? input.winningSubsystem,
    style_wrapper_applied: input.styleWrapperApplied,
    guard_intervention: input.guardIntervention,
    gate_replaced_output: input.gateReplacedOutput ?? input.guardIntervention,
    replacement_source: input.replacementSource ?? null,
    scaffold_source: input.scaffoldSource ?? null,
    device_command_channel_used: input.deviceCommandChannelUsed ?? false,
    visible_text_contains_tool_command: input.visibleTextContainsToolCommand ?? false,
    final_visible_source: input.finalVisibleSource ?? input.winningSubsystem,
    commit_owner_id: input.commitOwnerId ?? null,
    legacy_override_attempted: input.legacyOverrideAttempted ?? false,
    previous_semantic_plan_id: input.previousSemanticPlanId ?? null,
    continuation_attached_to_plan_id: input.continuationAttachedToPlanId ?? null,
    continuation_attachment_reason: input.continuationAttachmentReason ?? null,
    stale_scaffold_rejected: input.staleScaffoldRejected ?? false,
    stale_game_scaffold_rejected: input.staleGameScaffoldRejected ?? false,
    previous_substantive_ask_id: input.turnMeaning.dynamic_slots?.previous_ask_id ?? null,
    clarification_attached_to_ask_id:
      input.turnMeaning.requested_facet === "clarification_recovery"
        ? input.turnMeaning.dynamic_slots?.previous_ask_id ?? null
        : null,
    clarification_recovery_used: Boolean(input.turnMeaning.dynamic_slots?.clarification_recovery_used),
    raw_echo_lint_rejected: input.rawEchoLintRejected ?? false,
    compound_relational_slots:
      input.turnMeaning.current_domain_handler === "relational_dynamics" && input.turnMeaning.dynamic_slots
        ? {
            desired_service_lanes: input.turnMeaning.dynamic_slots.desired_service_lanes,
            intensity_preferences: input.turnMeaning.dynamic_slots.intensity_preferences,
            training_goals: input.turnMeaning.dynamic_slots.training_goals,
            hard_limits: input.turnMeaning.dynamic_slots.hard_limits,
            boundary_preferences: input.turnMeaning.dynamic_slots.boundary_preferences,
            dynamic_goals: input.turnMeaning.dynamic_slots.dynamic_goals,
          }
        : null,
    equipment_disclosure_detected: Boolean(
      input.turnMeaning.dynamic_slots?.disclosed_object ||
        (input.turnMeaning.dynamic_slots?.disclosed_objects.length ?? 0) > 0,
    ),
    equipment_rejection_reason:
      input.turnMeaning.requested_facet === "compound_relational_disclosure"
        ? "relational_goals_are_not_equipment"
        : null,
    eligible_handlers_considered: input.turnMeaning.eligible_domain_handlers,
    chosen_handler: input.turnMeaning.current_domain_handler,
    rejected_handlers: input.turnMeaning.rejected_domain_handlers,
    answer_contract_validation: input.answerContractValidation ?? null,
    visible_lint_result: input.visibleLintResult ?? null,
    answer_intent: input.answerIntent ?? null,
    semantic_arbitration: input.semanticArbitration ?? null,
    required_answer_slots: input.turnMeaning.required_answer_slots,
    relational_dynamic_trace: input.relationalDynamicTrace ?? defaultRelationalTrace,
  };
}
