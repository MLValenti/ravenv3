import type {
  TurnAlternativeInterpretation,
  TurnContinuityAttachment,
  TurnDomainHandler,
  TurnMeaning,
  TurnQuestionShape,
  TurnRequestedFacet,
  TurnRequestedOperation,
  TurnRequiredScope,
  TurnSpeechAct,
  TurnSubjectDomain,
  TurnTarget,
} from "./turn-meaning.ts";

export type SemanticCandidateSource = "deterministic" | "llm";

export type SemanticCandidate = {
  source: SemanticCandidateSource;
  speech_act: TurnSpeechAct;
  target: TurnTarget;
  subject_domain: TurnSubjectDomain;
  requested_operation: TurnRequestedOperation;
  question_shape: TurnQuestionShape;
  requested_facet: TurnRequestedFacet;
  primary_subject: string | null;
  secondary_subjects: string[];
  entity_set: string[];
  required_referent: string | null;
  required_scope: TurnRequiredScope;
  current_domain_handler: TurnDomainHandler;
  continuity_attachment: TurnContinuityAttachment;
  confidence: number;
  rationale: string;
  alternative_interpretations: TurnAlternativeInterpretation[];
};

export type RejectedSemanticCandidate = {
  source: SemanticCandidateSource;
  index: number;
  reason: string;
  candidate: SemanticCandidate | null;
};

export type SemanticCandidateArbitrationTrace = {
  deterministic_candidate: SemanticCandidate;
  llm_candidates: SemanticCandidate[];
  chosen_candidate: SemanticCandidate;
  chosen_source: SemanticCandidateSource;
  rejected_candidates: RejectedSemanticCandidate[];
  arbitration_reason: string;
};

export type SemanticCandidateGeneratorInput = {
  userText: string;
  previousAssistantText?: string | null;
  previousUserText?: string | null;
  currentTopic?: string | null;
};

export type LlmSemanticCandidateProvider = (prompt: string) => Promise<string>;

const SPEECH_ACTS: TurnSpeechAct[] = [
  "greeting",
  "direct_question",
  "self_disclosure",
  "challenge",
  "clarification",
  "correction",
  "preference_statement",
  "reciprocal_offer",
  "request_for_advice",
  "request_for_examples",
  "request_for_elaboration",
  "continuation",
  "role_proposal",
  "service_request",
  "request_for_direction",
  "compound_relational_disclosure",
  "user_confusion",
  "expectation_request",
  "protocol_setup_request",
  "service_preference_disclosure",
  "user_preference_disclosure",
  "user_capability_disclosure",
  "user_equipment_disclosure",
  "dynamic_application_request",
  "boundary_or_safety_topic",
  "ambiguous_dynamic_topic",
  "next_step_request",
  "progress_report",
  "readiness_confirmation",
  "active_step_confusion",
  "continue_current_step",
  "pause_or_stop_request",
  "correction_to_active_interaction",
  "boundary_update",
  "unknown",
];

const TARGETS: TurnTarget[] = [
  "assistant",
  "user",
  "shared_topic",
  "prior_assistant_answer",
  "prior_user_answer",
];

const SUBJECT_DOMAINS: TurnSubjectDomain[] = [
  "assistant_preferences",
  "user_preferences",
  "definition",
  "factual_question",
  "relational_exchange",
  "planning",
  "game",
  "task",
  "general",
];

const OPERATIONS: TurnRequestedOperation[] = [
  "answer",
  "elaborate",
  "clarify",
  "revise",
  "ask_follow_up",
  "compare",
  "explain_application",
  "acknowledge_and_probe",
  "continue",
];

const QUESTION_SHAPES: TurnQuestionShape[] = [
  "yes_no_about_item",
  "binary_compare_or_choice",
  "favorites_request",
  "list_expansion",
  "topic_drilldown",
  "invitation_or_proposal",
  "application_request",
  "challenge_or_correction",
  "clarification_request",
  "definition_request",
  "current_status_request",
  "hypothetical_request",
  "factual_request",
  "greeting_or_opener",
  "statement_or_disclosure",
  "open_question",
  "unknown",
];

const REQUESTED_FACETS: TurnRequestedFacet[] = [
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
  "correction_to_prior_plan",
  "service_task",
  "training_guidance",
  "active_next_step",
  "active_progress_report",
  "active_readiness_confirmation",
  "active_step_confusion",
  "pause_or_stop",
  "correction_to_active_interaction",
  "boundary_update",
  "dynamic_application",
  "ambiguous_boundary_topic",
  "safety_or_limits_discussion",
  "compound_equipment_application",
  "current_activity_or_status",
  "definition",
  "clarifying_enumeration",
  "invitation_response",
  "application_explanation",
  "challenge_response",
  "clarification",
  "factual_answer",
  "reciprocal_probe",
  "continuation",
  "unknown",
];

const SCOPES: TurnRequiredScope[] = [
  "direct_answer_only",
  "answer_plus_explanation",
  "answer_plus_follow_up_question",
];

const HANDLERS: TurnDomainHandler[] = [
  "raven_preferences",
  "definitions",
  "relational_dynamics",
  "generic_qa",
  "conversation",
  "planning",
  "game",
  "task",
];

const ATTACHMENTS: TurnContinuityAttachment[] = [
  "immediate_prior_answer",
  "active_thread",
  "fresh_topic",
  "none",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAlternative(value: unknown): value is TurnAlternativeInterpretation {
  return (
    isRecord(value) &&
    SPEECH_ACTS.includes(value.speech_act as TurnSpeechAct) &&
    OPERATIONS.includes(value.requested_operation as TurnRequestedOperation) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    typeof value.reason === "string"
  );
}

export function semanticCandidateFromTurnMeaning(
  turnMeaning: TurnMeaning,
  source: SemanticCandidateSource = "deterministic",
  rationale = "local deterministic interpretation",
): SemanticCandidate {
  return {
    source,
    speech_act: turnMeaning.speech_act,
    target: turnMeaning.target,
    subject_domain: turnMeaning.subject_domain,
    requested_operation: turnMeaning.requested_operation,
    question_shape: turnMeaning.question_shape,
    requested_facet: turnMeaning.requested_facet,
    primary_subject: turnMeaning.primary_subject,
    secondary_subjects: turnMeaning.secondary_subjects,
    entity_set: turnMeaning.entity_set,
    required_referent: turnMeaning.required_referent,
    required_scope: turnMeaning.required_scope,
    current_domain_handler: turnMeaning.current_domain_handler,
    continuity_attachment: turnMeaning.continuity_attachment,
    confidence: turnMeaning.confidence,
    rationale,
    alternative_interpretations: turnMeaning.alternative_interpretations,
  };
}

export function validateSemanticCandidateSchema(
  candidate: unknown,
): { ok: true; candidate: SemanticCandidate } | { ok: false; reason: string } {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "candidate_not_object" };
  }
  if ("visible_reply" in candidate || "reply" in candidate || "text" in candidate) {
    return { ok: false, reason: "candidate_contains_visible_text" };
  }
  if (!SPEECH_ACTS.includes(candidate.speech_act as TurnSpeechAct)) {
    return { ok: false, reason: "invalid_speech_act" };
  }
  if (!TARGETS.includes(candidate.target as TurnTarget)) {
    return { ok: false, reason: "invalid_target" };
  }
  if (!SUBJECT_DOMAINS.includes(candidate.subject_domain as TurnSubjectDomain)) {
    return { ok: false, reason: "invalid_subject_domain" };
  }
  if (!OPERATIONS.includes(candidate.requested_operation as TurnRequestedOperation)) {
    return { ok: false, reason: "invalid_requested_operation" };
  }
  if (!QUESTION_SHAPES.includes(candidate.question_shape as TurnQuestionShape)) {
    return { ok: false, reason: "invalid_question_shape" };
  }
  if (!REQUESTED_FACETS.includes(candidate.requested_facet as TurnRequestedFacet)) {
    return { ok: false, reason: "invalid_requested_facet" };
  }
  if (!SCOPES.includes(candidate.required_scope as TurnRequiredScope)) {
    return { ok: false, reason: "invalid_required_scope" };
  }
  if (!HANDLERS.includes(candidate.current_domain_handler as TurnDomainHandler)) {
    return { ok: false, reason: "invalid_domain_handler" };
  }
  if (!ATTACHMENTS.includes(candidate.continuity_attachment as TurnContinuityAttachment)) {
    return { ok: false, reason: "invalid_continuity_attachment" };
  }
  if (!isStringArray(candidate.secondary_subjects)) {
    return { ok: false, reason: "invalid_secondary_subjects" };
  }
  if (!isStringArray(candidate.entity_set)) {
    return { ok: false, reason: "invalid_entity_set" };
  }
  if (
    candidate.primary_subject !== null &&
    typeof candidate.primary_subject !== "string"
  ) {
    return { ok: false, reason: "invalid_primary_subject" };
  }
  if (
    candidate.required_referent !== null &&
    typeof candidate.required_referent !== "string"
  ) {
    return { ok: false, reason: "invalid_required_referent" };
  }
  if (
    typeof candidate.confidence !== "number" ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return { ok: false, reason: "invalid_confidence" };
  }
  if (typeof candidate.rationale !== "string") {
    return { ok: false, reason: "invalid_rationale" };
  }
  if (
    !Array.isArray(candidate.alternative_interpretations) ||
    !candidate.alternative_interpretations.every(isAlternative)
  ) {
    return { ok: false, reason: "invalid_alternative_interpretations" };
  }
  return {
    ok: true,
    candidate: {
      source: candidate.source === "deterministic" ? "deterministic" : "llm",
      speech_act: candidate.speech_act as TurnSpeechAct,
      target: candidate.target as TurnTarget,
      subject_domain: candidate.subject_domain as TurnSubjectDomain,
      requested_operation: candidate.requested_operation as TurnRequestedOperation,
      question_shape: candidate.question_shape as TurnQuestionShape,
      requested_facet: candidate.requested_facet as TurnRequestedFacet,
      primary_subject: candidate.primary_subject,
      secondary_subjects: candidate.secondary_subjects,
      entity_set: candidate.entity_set,
      required_referent: candidate.required_referent,
      required_scope: candidate.required_scope as TurnRequiredScope,
      current_domain_handler: candidate.current_domain_handler as TurnDomainHandler,
      continuity_attachment: candidate.continuity_attachment as TurnContinuityAttachment,
      confidence: candidate.confidence,
      rationale: candidate.rationale,
      alternative_interpretations: candidate.alternative_interpretations,
    },
  };
}

export function parseLlmSemanticCandidateResponse(raw: string): {
  candidates: SemanticCandidate[];
  rejected: RejectedSemanticCandidate[];
} {
  const parsed = JSON.parse(raw) as unknown;
  const rawCandidates = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.candidates)
      ? parsed.candidates
      : [];
  const candidates: SemanticCandidate[] = [];
  const rejected: RejectedSemanticCandidate[] = [];
  rawCandidates.slice(0, 3).forEach((rawCandidate, index) => {
    const validation = validateSemanticCandidateSchema(rawCandidate);
    if (validation.ok) {
      candidates.push({ ...validation.candidate, source: "llm" });
    } else {
      rejected.push({
        source: "llm",
        index,
        reason: validation.reason,
        candidate: null,
      });
    }
  });
  return { candidates, rejected };
}

export function buildSemanticCandidatePrompt(input: SemanticCandidateGeneratorInput): string {
  return [
    "You are Raven's semantic normalizer. Return JSON only.",
    "Do not write visible user-facing reply text.",
    "Return an object: {\"candidates\":[...]} with 1 to 3 semantic candidates.",
    "Use only the enum values already present in the schema.",
    "Required fields: speech_act,target,subject_domain,requested_operation,question_shape,requested_facet,primary_subject,secondary_subjects,entity_set,required_referent,required_scope,current_domain_handler,continuity_attachment,confidence,rationale,alternative_interpretations.",
    `User turn: ${JSON.stringify(input.userText)}`,
    `Previous assistant: ${JSON.stringify(input.previousAssistantText ?? null)}`,
    `Previous user: ${JSON.stringify(input.previousUserText ?? null)}`,
    `Current topic: ${JSON.stringify(input.currentTopic ?? null)}`,
  ].join("\n");
}

export async function generateLlmSemanticCandidates(
  input: SemanticCandidateGeneratorInput,
  provider: LlmSemanticCandidateProvider,
): Promise<{ candidates: SemanticCandidate[]; rejected: RejectedSemanticCandidate[] }> {
  const raw = await provider(buildSemanticCandidatePrompt(input));
  try {
    return parseLlmSemanticCandidateResponse(raw);
  } catch {
    return {
      candidates: [],
      rejected: [
        {
          source: "llm",
          index: -1,
          reason: "invalid_json",
          candidate: null,
        },
      ],
    };
  }
}
