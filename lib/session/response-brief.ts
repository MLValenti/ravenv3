import type { AnswerIntent } from "./raven-embodiment.ts";
import type { AnswerPlan } from "./raven-preferences.ts";
import type { PlannedMove, TurnMeaning } from "./turn-meaning.ts";
import type { ActiveInteractionState } from "./active-interaction.ts";

export type ResponseBriefDepth =
  | "concise"
  | "normal"
  | "deeper"
  | "stepwise"
  | "example_driven";

export type ResponseBrief = {
  brief_id: string;
  source_turn_id: string | null;
  semantic_plan_id: string;
  visible_intent: {
    reply_goal: string;
    answer_mode: string;
    requested_facet: string;
    primary_subject: string | null;
    desired_depth: ResponseBriefDepth;
  };
  visible_constraints: {
    required_answer_slots: string[];
    must_address: string[];
    must_not_include: string[];
    allowed_boundaries: string[];
    capability_limits: string[];
  };
  nonvisible_renderer_instruction: string;
  nonvisible_state_summary: {
    domain_handler: string;
    speech_act: string;
    continuity_target: string | null;
    active_interaction_id: string | null;
    interaction_type: string | null;
    active_status: string | null;
  };
  nonvisible_repair_instruction: string | null;
  nonvisible_validation_reason: string | null;
  nonvisible_debug: Record<string, unknown>;
  user_text: string;
  normalized_user_text: string;
  domain_handler: string;
  speech_act: string;
  requested_facet: string;
  requested_facets: string[];
  answer_mode: string;
  primary_subject: string | null;
  secondary_subjects: string[];
  dynamic_slots: unknown;
  continuity_target: string | null;
  previous_substantive_ask: PreviousResponseBriefSummary | null;
  required_answer_slots: string[];
  must_address: string[];
  must_not_include: string[];
  allowed_boundaries: string[];
  capability_limits: string[];
  persona_style: string;
  desired_depth: ResponseBriefDepth;
  reply_goal: string;
  answer_strategy: string;
  clarification_policy: string;
  active_interaction_id: string | null;
  interaction_type: string | null;
  active_status: string | null;
  current_step_summary: string | null;
  next_step_policy: string | null;
  expected_user_response_type: string | null;
  previous_instruction_summary: string | null;
  active_interaction_safety_notes: string[];
  state_delta_summary: string | null;
  newly_added_slots: string[];
  already_answered_slots: string[];
  pending_unaddressed_slots: string[];
  avoid_repeating_answer_ids: string[];
  required_novelty_reason: string | null;
};

export type PreviousResponseBriefSummary = {
  previous_response_brief_id: string;
  previous_reply_goal: string;
  previous_required_slots: string[];
  previous_plain_language_summary: string;
  previous_example_user_response: string;
  previous_domain_handler: string;
  previous_answer_mode: string;
};

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalize(entry))
        .filter(Boolean),
    ),
  );
}

export function normalizePreviousResponseBriefSummary(
  value: unknown,
): PreviousResponseBriefSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<PreviousResponseBriefSummary>;
  const previousResponseBriefId = normalize(raw.previous_response_brief_id);
  if (!previousResponseBriefId) {
    return null;
  }
  return {
    previous_response_brief_id: previousResponseBriefId,
    previous_reply_goal: normalize(raw.previous_reply_goal) || "Answer the current user turn directly.",
    previous_required_slots: normalizeStringList(raw.previous_required_slots),
    previous_plain_language_summary:
      normalize(raw.previous_plain_language_summary) ||
      "Raven asked the user for the next concrete response.",
    previous_example_user_response:
      normalize(raw.previous_example_user_response) || "I understand and I am ready to continue.",
    previous_domain_handler: normalize(raw.previous_domain_handler) || "conversation",
    previous_answer_mode: normalize(raw.previous_answer_mode) || "direct_answer",
  };
}

export type ResponseBriefValidationResult = {
  ok: boolean;
  reason: string;
  failures: string[];
};

export type ResponseBriefRealizationResult = {
  text: string;
  content_realizer: "llm_brief_realizer" | "deterministic_brief_fallback";
  assistant_output_quality:
    | "valid_model_reply"
    | "valid_fallback_reply"
    | "repaired_reply"
    | "rejected_internal_leak"
    | "fallback_plan_leak"
    | "generic_assistant_voice"
    | "failed_fulfillment"
    | "unknown";
  assistant_output_context_eligible: boolean;
  validation_result: ResponseBriefValidationResult;
  validation_failures: string[];
  re_realization_attempts: number;
  prompt: string;
};

const GAME_LANGUAGE = /\b(?:in this game|game|round|score|scoring|points?|win|lose|best (?:two|three|of)|best three out of five|consequence task|quick mental games?|prompt\/answer|answer this question for points)\b/i;
const INTERNAL_METADATA_LANGUAGE =
  /\b(?:ResponseBrief|TurnMeaning|semantic_plan|semantic planner|answer_mode|requested_facet|requested_facets|domain_handler|content_source|candidate_routes|active_interaction|current_step_summary|previous_response_brief|validation_failures|validator|debug_trace|planned_move|turn_plan|scaffold_source|replacement_chain|memory slot|route name|mode name|state summary|visible_intent|visible_constraints|nonvisible_renderer_instruction|nonvisible_state_summary|nonvisible_repair_instruction|nonvisible_validation_reason|nonvisible_debug)\b/i;
const INTERNAL_FIELD_LINE =
  /(?:^|\n)\s*(?:[a-z][a-z0-9]*_){1,}[a-z0-9]+\s*[:=]\s*\S/i;
const INTERNAL_JSONISH_FIELD =
  /["{,]\s*"(?:brief_id|semantic_plan_id|answer_mode|requested_facet|domain_handler|dynamic_slots|candidate_routes|replacement_chain)"\s*:/i;
const GENERIC_ASSISTANT_VOICE_LANGUAGE =
  /\b(?:how\s+(?:can|may)\s+i\s+(?:assist|help)\s+you(?:\s+today)?|hi\s+there[!.]?\s+how\s+can\s+i\s+(?:assist|help)|as\s+an\s+ai\s+assistant|i\s+am\s+an\s+ai|i'm\s+an\s+ai|is\s+there\s+anything\s+else\s+i\s+can\s+(?:assist|help)|how\s+may\s+i\s+be\s+of\s+assistance)/i;

export function detectGenericAssistantVoice(text: string): boolean {
  return GENERIC_ASSISTANT_VOICE_LANGUAGE.test(normalize(text));
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

function normalizeLower(text: string | null | undefined): string {
  return normalize(text).toLowerCase();
}

export function containsInternalVisibleMetadata(text: string): boolean {
  const normalized = normalize(text);
  return (
    INTERNAL_METADATA_LANGUAGE.test(normalized) ||
    INTERNAL_FIELD_LINE.test(text) ||
    INTERNAL_JSONISH_FIELD.test(text) ||
    /\b(?:follow|run|emit|render)\s+(?:the\s+)?(?:candidate|fallback|scaffold|brief|validator|route|mode)\b/i.test(
      normalized,
    )
  );
}

const FALLBACK_PLAN_LANGUAGE =
  /\b(?:I can answer\b|Keep it bounded\b|no pretend physical control\b|provide a direct instruction|Good\. Keep the same subject|answer this change directly|I'm going to need you to provide|Raven gave a bounded service task|fallback plan|renderer instruction|validator reason)\b/i;

export function validateDeterministicFallbackProse(
  reply: string,
  brief: Pick<ResponseBrief, "requested_facet" | "dynamic_slots"> &
    Partial<Pick<ResponseBrief, "normalized_user_text">>,
): ResponseBriefValidationResult {
  const text = normalize(reply);
  const failures: string[] = [];
  if (!text) {
    failures.push("empty_reply");
  }
  if (containsInternalVisibleMetadata(text)) {
    failures.push("internal_brief_or_planner_text");
  }
  if (FALLBACK_PLAN_LANGUAGE.test(text)) {
    failures.push("fallback_plan_language_visible");
  }
  if (detectGenericAssistantVoice(text)) {
    failures.push("generic_assistant_voice");
  }
  if (/^\s*I\s+can\s+answer\b[^.?!]{0,180}\bdirectly\b/i.test(text)) {
    failures.push("fallback_describes_itself_as_answering");
  }
  const taskSlots = brief.dynamic_slots as {
    assistant_selected_task_requested?: boolean;
  } | null;
  if (
    brief.requested_facet === "service_task" &&
    taskSlots?.assistant_selected_task_requested &&
    /\b(?:you\s+(?:pick|choose)|choose\s+(?:a|the)?\s*task|tell me what task|provide a direct instruction|what task do you want|name the task you want)\b/i.test(text)
  ) {
    failures.push("assistant_selected_task_asked_user_to_choose");
  }
  if (
    (brief.requested_facet === "greeting_or_opener" ||
      brief.requested_facet === "current_activity_or_status" ||
      brief.requested_facet === "clarification") &&
    /\bFor this, keep the answer practical\b|\bName the goal, the limit\b/i.test(text)
  ) {
    failures.push("fallback_communicative_act_mismatch");
  }
  const normalizedUserText = normalizeLower(brief.normalized_user_text ?? "");
  const userTokenCount = normalizedUserText ? normalizedUserText.split(/\s+/).length : 0;
  if (
    userTokenCount > 0 &&
    userTokenCount <= 3 &&
    /\bFor this, keep the answer practical\b|\bName the goal, the limit\b/i.test(text)
  ) {
    failures.push("fallback_short_turn_generic_task_frame");
  }
  if (
    brief.requested_facet === "greeting_or_opener" &&
    !/\b(hi|hello|hey|there you are|i'?m here|with you|good (?:morning|afternoon|evening))\b/i.test(text)
  ) {
    failures.push("greeting_fallback_missing_opening");
  }
  if (
    brief.requested_facet === "current_activity_or_status" &&
    !/\b(i'?m|i am|here|steady|ready|focused|with you|awake|good|fine|present)\b/i.test(text)
  ) {
    failures.push("status_fallback_missing_status_answer");
  }
  return {
    ok: failures.length === 0,
    reason: failures.length === 0 ? "deterministic_fallback_prose_validation_passed" : failures[0],
    failures,
  };
}

function stableBriefId(turnMeaning: TurnMeaning, plannedMove: PlannedMove): string {
  const seed = `${turnMeaning.normalized_text}|${plannedMove.content_key}|${turnMeaning.requested_facet}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `brief_${hash.toString(36)}`;
}

function includesTraining(text: string): boolean {
  return /\b(?:anal training|training|work up|bigger|dildos?)\b/i.test(text);
}

function desiredDepthForText(text: string, facet: string): ResponseBriefDepth {
  const normalized = normalizeLower(text);
  if (/^(?:how|tell me how)\??$/.test(normalized) || /\bhow would that work\b/i.test(normalized)) {
    return "stepwise";
  }
  if (/\b(example|copy|give me an example)\b/i.test(normalized)) {
    return "example_driven";
  }
  if (/\b(more detail|go deeper|deeper|explain it|explain that|what things can we do)\b/i.test(normalized)) {
    return facet === "training_guidance" ? "stepwise" : "deeper";
  }
  if (facet === "service_task" || facet === "service_direction") {
    return "concise";
  }
  return "normal";
}

function mustAddressForBrief(turnMeaning: TurnMeaning): string[] {
  const slots = turnMeaning.dynamic_slots;
  if (turnMeaning.speech_act === "greeting" || turnMeaning.question_shape === "greeting_or_opener") {
    return ["greeting or opening response"];
  }
  switch (turnMeaning.requested_facet) {
    case "current_activity_or_status":
      return ["current status answer"];
    case "response_correction":
      return ["acknowledge feedback", "correct course", "revised answer"];
    case "correction_to_prior_plan":
      return ["acknowledge correction", "abandon game framing", "non-game task"];
    case "service_task":
      if ((turnMeaning.dynamic_slots as { assistant_selected_task_requested?: boolean } | null)?.assistant_selected_task_requested) {
        return [
          "selected task",
          "why this task fits the active role",
          "completion condition",
          "limit or boundary",
          "report back instruction",
        ];
      }
      return ["one bounded service task", "task purpose", "limits or check-in"];
    case "training_guidance":
      return ["training subject", "pacing", "comfort", "limits"];
    case "active_next_step":
      return ["active interaction", "next bounded step", "no game"];
    case "active_progress_report":
      return ["acknowledge progress", "current step", "safety check"];
    case "active_readiness_confirmation":
      return ["readiness", "active interaction", "next bounded step"];
    case "active_step_confusion":
      return ["plain language restatement", "current step", "example or next step"];
    case "pause_or_stop":
      return ["pause or stop", "active interaction", "boundary"];
    case "correction_to_active_interaction":
      return ["acknowledge correction", "active interaction", "rejected plan not continued"];
    case "boundary_update":
      return ["boundary", "active interaction", "safety check"];
    case "clarification_recovery":
      return ["plain language restatement", "why Raven asked", "example or next step"];
    case "service_direction":
    case "service_initiation":
      return ["concrete next step", "service lane", "boundary"];
    case "compound_equipment_application":
    case "equipment_disclosure":
      if (turnMeaning.required_answer_slots.includes("invitation_answer")) {
        return ["disclosed equipment", "invitation answer", "capability boundary", "bounded next step"];
      }
      return ["disclosed equipment", "capability boundary", "bounded next step"];
    case "compound_relational_disclosure":
      return ["tasks or service lane", "training goal", "hard limit", "boundary framing"];
    case "role_negotiation":
      return ["role options or recommendation", "boundary", "next step"];
    default:
      if (slots && includesTraining(turnMeaning.primary_subject ?? turnMeaning.normalized_text)) {
        return ["training subject", "pacing", "comfort", "limits"];
      }
      return turnMeaning.required_answer_slots.length > 0
        ? turnMeaning.required_answer_slots
        : ["direct answer"];
  }
}

function mustNotIncludeForBrief(turnMeaning: TurnMeaning): string[] {
  const base = [
    "Device command:",
    "Tool command:",
    "Keep going",
    "Stay with the concrete part",
    "I do not have enough local context to define",
    "Give me the domain you mean",
    "rules of this game",
    "You will not drift",
    "I mean slut",
    "raw repair instruction",
    "answer_mode",
    "requested_facet",
    "ResponseBrief",
    "semantic planner",
  ];
  if (turnMeaning.current_domain_handler !== "game") {
    base.push(
      "game",
      "round",
      "score",
      "points",
      "win",
      "lose",
      "best three out of five",
      "consequence task",
      "quick mental games",
    );
  }
  return base;
}

function replyGoalForBrief(turnMeaning: TurnMeaning): string {
  if (turnMeaning.speech_act === "greeting" || turnMeaning.question_shape === "greeting_or_opener") {
    return "Answer the greeting with a brief opening response that fits the current conversational state.";
  }
  switch (turnMeaning.requested_facet) {
    case "current_activity_or_status":
      return "Answer Raven's current status directly without turning it into a task frame.";
    case "response_correction":
      return "Acknowledge the user's feedback about the bad or repeated answer, correct course, and give a revised answer that addresses the active state.";
    case "correction_to_prior_plan":
      return "Acknowledge the correction, drop game framing, and give one bounded non-game service task.";
    case "service_task":
      if ((turnMeaning.dynamic_slots as { assistant_selected_task_requested?: boolean } | null)?.assistant_selected_task_requested) {
        return "Select one concrete service task for the user, explain why it fits the active role, give the completion condition, preserve a boundary, and say what to report back.";
      }
      return "Give one concrete bounded service task or one focused setup question; do not make it a game.";
    case "training_guidance":
      return "Give safe, gradual, consent-framed guidance for the training topic and ask one focused boundary or baseline question.";
    case "active_next_step":
      return "Answer from the active interaction state with the next bounded step or explain what must be confirmed first.";
    case "active_progress_report":
      return "Acknowledge the user's progress report, connect it to the current step, and keep safety boundaries explicit.";
    case "active_readiness_confirmation":
      return "Use the active interaction state to continue only if the current step allows it; otherwise ask one focused confirmation.";
    case "active_step_confusion":
      return "Restate the current active instruction in simpler language and give one example or concrete next step.";
    case "pause_or_stop":
      return "Pause the active interaction clearly and do not continue the rejected step.";
    case "correction_to_active_interaction":
      return "Acknowledge the correction, update the active direction, and do not continue the rejected plan.";
    case "boundary_update":
      return "Acknowledge the boundary update and adjust the active interaction before continuing.";
    case "clarification_recovery":
      return "Explain the previous ask in simpler language and give one example response or practical next step.";
    case "service_direction":
    case "service_initiation":
      return "Answer what the user can do now with a concrete bounded next step.";
    case "role_negotiation":
      return "Respond with bounded role guidance: options, a recommendation, or one focused role question.";
    case "compound_equipment_application":
      return "Acknowledge disclosed equipment, answer the invitation conditionally, and give one bounded application step.";
    case "compound_relational_disclosure":
      return "Acknowledge service goals, training goals, and hard limits, then suggest one bounded starting protocol.";
    default:
      return "Answer the user directly while preserving the chosen semantic move.";
  }
}

function answerStrategyForBrief(turnMeaning: TurnMeaning): string {
  if (turnMeaning.speech_act === "greeting" || turnMeaning.question_shape === "greeting_or_opener") {
    return "Open the conversation naturally and briefly; do not give a generic task or setup instruction.";
  }
  switch (turnMeaning.requested_facet) {
    case "current_activity_or_status":
      return "Give a direct current-status answer in Raven's voice; do not ask for a goal or limit.";
    case "response_correction":
      return "Briefly acknowledge the feedback, do not defend the stale answer, and provide a revised non-repetitive response from the active state.";
    case "training_guidance":
      return "Use gradual, practical guidance: baseline, pacing, comfort, stop conditions, and one focused question.";
    case "active_next_step":
      return "Use the stored active interaction. Give one bounded next step and one report-back condition.";
    case "active_progress_report":
      return "Reflect the progress report, check discomfort or limits, and keep the same current step unless a next step is safe.";
    case "active_readiness_confirmation":
      return "Continue only from the stored active interaction with one bounded next step.";
    case "active_step_confusion":
      return "Translate the active instruction into plain language and give a copyable example.";
    case "pause_or_stop":
      return "Stop or pause cleanly. Do not add a new task, game, or escalation.";
    case "correction_to_active_interaction":
      return "Correct course without arguing and keep the active interaction type away from rejected game framing.";
    case "boundary_update":
      return "Treat the boundary as authoritative before any next step.";
    case "service_task":
    case "service_direction":
    case "service_initiation":
      return "Be actionable: if the user asks Raven to pick, select the task yourself; otherwise give one bounded instruction with a clear report-back condition.";
    case "correction_to_prior_plan":
      return "Correct course without arguing; replace the prior game framing with a service task.";
    case "clarification_recovery":
      return "Translate the prior ask into plain language and give a copyable example.";
    default:
      return "Write naturally from the semantic plan without inventing a new domain.";
  }
}

function subjectForBrief(turnMeaning: TurnMeaning): string {
  return (
    turnMeaning.primary_subject ??
    turnMeaning.dynamic_slots?.training_goals?.[0] ??
    turnMeaning.dynamic_slots?.disclosed_object ??
    turnMeaning.entity_set[0] ??
    "this"
  );
}

export function buildResponseBrief(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
  answerIntent: AnswerIntent;
  previousBrief?: PreviousResponseBriefSummary | null;
  activeInteraction?: ActiveInteractionState | null;
  sourceTurnId?: string | null;
}): ResponseBrief {
  const { turnMeaning, plannedMove, answerIntent } = input;
  const prior = input.previousBrief ?? null;
  const facet = turnMeaning.requested_facet;
  const subject = subjectForBrief(turnMeaning);
  const desiredDepth = desiredDepthForText(turnMeaning.raw_text, facet);
  const continuityTarget =
    turnMeaning.continuity_attachment === "immediate_prior_answer" ||
    turnMeaning.continuity_attachment === "active_thread"
      ? prior?.previous_response_brief_id ?? turnMeaning.required_referent ?? null
      : null;
  const mustAddress = mustAddressForBrief(turnMeaning);
  if (facet === "training_guidance" && !mustAddress.includes(subject)) {
    mustAddress.unshift(subject);
  }
  const slotsForAddress = turnMeaning.dynamic_slots as {
    training_goals?: string[];
    experience_level?: string | null;
    state_delta_summary?: string | null;
  } | null;
  if (facet === "training_guidance") {
    for (const goal of slotsForAddress?.training_goals ?? []) {
      if (goal && !mustAddress.includes(goal)) {
        mustAddress.unshift(goal);
      }
    }
    if (slotsForAddress?.experience_level && !mustAddress.includes("experience level")) {
      mustAddress.push("experience level");
    }
  }
  if (facet === "response_correction") {
    mustAddress.unshift("acknowledge feedback", "correct course", "revised answer");
  }
  const active = input.activeInteraction ?? null;
  const activeSafetyNotes = [
    active?.safety_review_required ? "Safety review is required before escalation." : null,
    active?.known_limits.length ? `Known limits: ${active.known_limits.join(", ")}.` : null,
    active?.known_boundaries.length ? `Known boundaries: ${active.known_boundaries.join(", ")}.` : null,
  ].filter((value): value is string => Boolean(value));
  const mustNotInclude = mustNotIncludeForBrief(turnMeaning);
  const allowedBoundaries = [
    "conversation-only control",
    "consent and limits before escalation",
    "one focused clarifying question when setup is missing",
  ];
  const capabilityLimits = [
    "Raven cannot physically inspect, control, or enforce real-world actions from chat.",
    "Raven may shape conversational structure, protocol, and reflection.",
  ];
  const replyGoal = replyGoalForBrief(turnMeaning);
  const answerStrategy = answerStrategyForBrief(turnMeaning);
  const clarificationPolicy =
    facet === "clarification_recovery" || desiredDepth === "stepwise"
      ? "Attach to the previous substantive plan and explain that plan practically."
      : "Ask at most one focused clarification only if required slots are genuinely missing.";
  return {
    brief_id: stableBriefId(turnMeaning, plannedMove),
    source_turn_id: input.sourceTurnId ?? null,
    semantic_plan_id: `semantic_plan:${plannedMove.content_key}:${facet}`,
    visible_intent: {
      reply_goal: replyGoal,
      answer_mode: answerIntent.answer_mode,
      requested_facet: facet,
      primary_subject: turnMeaning.primary_subject,
      desired_depth: desiredDepth,
    },
    visible_constraints: {
      required_answer_slots: turnMeaning.required_answer_slots,
      must_address: mustAddress,
      must_not_include: mustNotInclude,
      allowed_boundaries: allowedBoundaries,
      capability_limits: capabilityLimits,
    },
    nonvisible_renderer_instruction:
      "Renderer guidance only. Render fresh visible assistant prose; do not copy this field.",
    nonvisible_state_summary: {
      domain_handler: turnMeaning.current_domain_handler,
      speech_act: turnMeaning.speech_act,
      continuity_target: continuityTarget,
      active_interaction_id: active?.active_interaction_id ?? null,
      interaction_type: active?.interaction_type ?? null,
      active_status: active?.status ?? null,
    },
    nonvisible_repair_instruction:
      facet === "clarification_recovery" || facet === "response_correction"
        ? "Anchor the repair to the previous visible assistant message and active plan."
        : null,
    nonvisible_validation_reason: null,
    nonvisible_debug: {
      dynamic_slots: turnMeaning.dynamic_slots,
      planned_move: plannedMove.content_key,
      previous_brief_present: Boolean(prior),
    },
    user_text: turnMeaning.raw_text,
    normalized_user_text: turnMeaning.normalized_text,
    domain_handler: turnMeaning.current_domain_handler,
    speech_act: turnMeaning.speech_act,
    requested_facet: facet,
    requested_facets: turnMeaning.requested_facets,
    answer_mode: answerIntent.answer_mode,
    primary_subject: turnMeaning.primary_subject,
    secondary_subjects: turnMeaning.secondary_subjects,
    dynamic_slots: turnMeaning.dynamic_slots,
    continuity_target: continuityTarget,
    previous_substantive_ask: prior,
    required_answer_slots: turnMeaning.required_answer_slots,
    must_address: mustAddress,
    must_not_include: mustNotInclude,
    allowed_boundaries: allowedBoundaries,
    capability_limits: capabilityLimits,
    persona_style:
      "Raven may be direct and dominant, but persona flavor must not replace the requested answer.",
    desired_depth: desiredDepth,
    reply_goal: replyGoal,
    answer_strategy: answerStrategy,
    clarification_policy: clarificationPolicy,
    active_interaction_id: active?.active_interaction_id ?? null,
    interaction_type: active?.interaction_type ?? null,
    active_status: active?.status ?? null,
    current_step_summary: active?.current_step_summary ?? null,
    next_step_policy: active?.next_step_policy ?? null,
    expected_user_response_type: active?.awaiting_user_input_type ?? null,
    previous_instruction_summary:
      active?.last_assistant_instruction?.plain_language_summary ??
      active?.previous_step_summary ??
      null,
    active_interaction_safety_notes: activeSafetyNotes,
    state_delta_summary:
      (turnMeaning.dynamic_slots as { state_delta_summary?: string | null } | null)
        ?.state_delta_summary ?? null,
    newly_added_slots:
      (turnMeaning.dynamic_slots as { new_slots_added?: string[] } | null)?.new_slots_added ??
      [],
    already_answered_slots: active?.last_answered_slots ?? [],
    pending_unaddressed_slots:
      (turnMeaning.dynamic_slots as { pending_unaddressed_slots?: string[] } | null)
        ?.pending_unaddressed_slots ??
      active?.pending_unaddressed_slots ??
      [],
    avoid_repeating_answer_ids: [
      active?.last_answer_signature ?? null,
      active?.previous_response_brief_id ?? null,
    ].filter((value): value is string => Boolean(value)),
    required_novelty_reason:
      (turnMeaning.dynamic_slots as { state_delta_summary?: string | null } | null)
        ?.state_delta_summary
        ? `User provided new state: ${
            (turnMeaning.dynamic_slots as { state_delta_summary?: string | null })
              .state_delta_summary
          }. Adapt instead of repeating the previous answer.`
        : null,
  };
}

export function buildResponseBriefPrompt(
  brief: ResponseBrief,
  validationFailure?: ResponseBriefValidationResult | null,
): string {
  const failureText =
    validationFailure && !validationFailure.ok
      ? `\nPrevious draft failed validation: ${validationFailure.failures.join("; ")}`
      : "";
  return [
    "Write Raven's next visible chat reply from this ResponseBrief.",
    "Do not mention internal field names, JSON, planning, tools, or device commands.",
    "Do not change the domain, requested facet, answer mode, or reply goal.",
    "Satisfy every must_address item. Include none of must_not_include.",
    "Do not claim physical control or inspection; keep boundaries conversational.",
    "Use Raven's persona only as style on top of the semantic move.",
    failureText,
    JSON.stringify(brief, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

function addressesItem(text: string, item: string, brief: ResponseBrief): boolean {
  const lower = normalizeLower(text);
  const itemLower = normalizeLower(item);
  if (!itemLower) return true;
  if (itemLower.includes("training subject")) {
    return includesTraining(lower) || Boolean(brief.primary_subject && lower.includes(brief.primary_subject));
  }
  if (itemLower.includes("pacing")) return /\b(pace|pacing|slow|gradual|work up|step)\b/i.test(text);
  if (itemLower.includes("comfort")) return /\b(comfort|comfortable|pain|stop|relax|baseline)\b/i.test(text);
  if (itemLower.includes("limits")) return /\b(limit|limits|boundary|boundaries|off-limits|stop)\b/i.test(text);
  if (itemLower.includes("anal training")) return /\banal\b/i.test(text);
  if (itemLower.includes("chastity training")) return /\bchastity\b/i.test(text);
  if (itemLower.includes("experience level")) return /\b(beginner|new|inexperienced|low experience|not much training|little training)\b/i.test(text);
  if (itemLower.includes("acknowledge feedback")) return /\b(you'?re right|right|yes|i repeated|that was repeated|i hear you)\b/i.test(text);
  if (itemLower.includes("correct course")) return /\b(correct course|instead|cleaner|more specific|revised|do this)\b/i.test(text);
  if (itemLower.includes("revised answer")) return /\b(revised|instead|do this|start with|next step|plan)\b/i.test(text);
  if (itemLower.includes("correction")) return /\b(right|you'?re right|correction|not a game|drop|switch)\b/i.test(text);
  if (itemLower.includes("abandon game")) return /\b(not a game|drop the game|no game|without game)\b/i.test(text);
  if (itemLower.includes("non-game task")) {
    return /\b(task|do this|report|check-in)\b/i.test(text) &&
      !/\bround|score|points?|win|lose|best three out of five|consequence task|quick mental games?\b/i.test(text);
  }
  if (itemLower.includes("bounded service task")) return /\b(task|do this|start|report|check-in|timer|minutes?)\b/i.test(text);
  if (itemLower.includes("selected task")) return /\b(selected task|do this|your task is|start with|complete)\b/i.test(text);
  if (itemLower.includes("why this task fits")) return /\b(fits|because|purpose|so that|service submissive|your role|active role)\b/i.test(text);
  if (itemLower.includes("completion condition")) return /\b(complete|done|finish|completion|for\s+\d+\s+minutes?|once)\b/i.test(text);
  if (itemLower.includes("limit or boundary")) return /\b(limit|boundary|stop|safe|inside)\b/i.test(text);
  if (itemLower.includes("report back instruction")) return /\b(report|report back|send|write|check[- ]?in)\b/i.test(text);
  if (itemLower.includes("task purpose")) return /\b(purpose|so that|to build|to prove|to practice|service|accountability|consistency|approval|useful)\b/i.test(text);
  if (itemLower.includes("active interaction")) return /\b(active|current|same|this step|interaction|instruction|what we are doing|from here|dynamic|training|service)\b/i.test(text);
  if (itemLower.includes("next bounded step")) return /\b(next step|first instruction|do this|start|now|report|one step|bounded)\b/i.test(text);
  if (itemLower.includes("no game")) return !GAME_LANGUAGE.test(text) || /\bnot a game|no game|without game\b/i.test(text);
  if (itemLower.includes("acknowledge progress")) return /\b(good|noted|i hear|you are|you started|you kept|reported|that report)\b/i.test(text);
  if (itemLower.includes("current step")) return /\b(current step|same step|that step|this step|instruction|baseline|report|doing it)\b/i.test(text);
  if (itemLower.includes("safety check")) return /\b(stop|pain|limit|boundary|comfortable|comfort|too much|if it feels wrong)\b/i.test(text);
  if (itemLower.includes("readiness")) return /\b(ready|readiness|you agreed|accepted|if you are ready|since you are ready)\b/i.test(text);
  if (itemLower.includes("pause or stop")) return /\b(stop|pause|paused|we stop|do not continue)\b/i.test(text);
  if (itemLower.includes("rejected plan")) return /\b(not continuing|drop|rejected|not a game|stay on this|instead)\b/i.test(text);
  if (itemLower.includes("service lane")) return /\b(service|tasks?|rules?|permission|approval|accountability)\b/i.test(text);
  if (itemLower.includes("boundary")) return /\b(limits?|boundar(?:y|ies)|consent|stop|off-limits|from here)\b/i.test(text);
  if (itemLower.includes("plain language")) return /\b(plain language|what i mean|i was asking|simpler)\b/i.test(text);
  if (itemLower.includes("why raven asked")) return /\b(so i|because|that lets me|so we|so the dynamic)\b/i.test(text);
  if (itemLower.includes("greeting") || itemLower.includes("opening response")) {
    return /\b(hi|hello|hey|there you are|i'?m here|with you|good (?:morning|afternoon|evening))\b/i.test(text);
  }
  if (itemLower.includes("current status")) {
    return /\b(i'?m|i am|here|steady|ready|focused|with you|awake|good|fine|present)\b/i.test(text);
  }
  if (itemLower.includes("example") || itemLower.includes("next step")) {
    return /\b(example|for example|answer like|next step|do this|choose|tell me|start with)\b/i.test(text);
  }
  if (itemLower.includes("disclosed equipment")) {
    return /\b(cage|plug|collar|leash|cuffs?|rope|toy|gear|restraints?|dildos?|equipment|items?)\b/i.test(text);
  }
  if (itemLower.includes("invitation answer")) {
    return /\b(yes|conditionally|can be used|use|used|should use)\b/i.test(text);
  }
  if (itemLower.includes("role options") || itemLower.includes("role")) {
    return /\b(role|submissive|service submissive|pet|servant|option|recommend)\b/i.test(text);
  }
  if (itemLower.includes("hard limit")) return /\b(hard limit|limit|off-limits|scat)\b/i.test(text);
  if (itemLower.includes("tasks or service")) return /\b(tasks?|service lane|permission|rules?)\b/i.test(text);
  if (lower.includes(itemLower)) return true;
  const subject = normalizeLower(brief.primary_subject);
  return Boolean(subject && lower.includes(subject));
}

export function validateReplyAgainstBrief(
  reply: string,
  brief: ResponseBrief,
): ResponseBriefValidationResult {
  const text = normalize(reply);
  const failures: string[] = [];
  if (!text) {
    failures.push("empty_reply");
  }
  for (const forbidden of brief.must_not_include) {
    if (
      (brief.requested_facet === "correction_to_prior_plan" ||
        brief.requested_facet === "correction_to_active_interaction") &&
      forbidden === "game"
    ) {
      continue;
    }
    const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "i").test(text)) {
      failures.push(`forbidden_text:${forbidden}`);
    }
  }
  if (
    brief.domain_handler !== "game" &&
    GAME_LANGUAGE.test(text) &&
    !(
      (brief.requested_facet === "correction_to_prior_plan" ||
        brief.requested_facet === "correction_to_active_interaction") &&
      /\b(?:not a game|drop the game|no game|without game)\b/i.test(text) &&
      !/\bround|score|points?|win|lose|best three out of five|consequence task|quick mental games?\b/i.test(text)
    )
  ) {
    failures.push("game_language_outside_game");
  }
  if (/\bdevice command\s*:|\btool command\s*:|\bsession\.action\.request\b/i.test(text)) {
    failures.push("visible_tool_or_device_command");
  }
  if (
    /\bno\s+safeword\s+means\s+no\s+limit\b/i.test(text) ||
    /\bwithout\s+a\s+safeword\b[^.?!]{0,80}\b(?:no|without)\s+limits?\b/i.test(text) ||
    /\bno\s+safeword\b[^.?!]{0,80}\b(?:unlimited|anything\s+goes|no\s+stop)\b/i.test(text)
  ) {
    failures.push("unsafe_unlimited_consent_text");
  }
  if (containsInternalVisibleMetadata(reply)) {
    failures.push("internal_brief_or_planner_text");
  }
  if (FALLBACK_PLAN_LANGUAGE.test(text)) {
    failures.push("fallback_plan_language_visible");
  }
  if (detectGenericAssistantVoice(text)) {
    failures.push("generic_assistant_voice");
  }
  if (/^\s*I\s+can\s+answer\b[^.?!]{0,180}\bdirectly\b/i.test(text)) {
    failures.push("fallback_describes_itself_as_answering");
  }
  if (/^\s*you have\b[^.?!]{0,160}\bwould you like\b/i.test(text)) {
    failures.push("raw_normalized_user_text_echo");
  }
  if (/\bKeep going\b|\bStay with the concrete part\b|\bconcrete part\b/i.test(text)) {
    failures.push("generic_continuation_filler");
  }
  if (brief.interaction_type !== "game" && /\bThe game continues\b/i.test(text)) {
    failures.push("game_continuation_outside_game_interaction");
  }
  if (/\bOpen is the part\b|\bopen is the\b/i.test(text)) {
    failures.push("stale_fragment_reused");
  }
  if (/\bfollow\s+Choose\b|\bChoose a role frame\b|\bname a boundary\b[^.?!]{0,80}\bgive one next step\b/i.test(text)) {
    failures.push("internal_instruction_summary_rendered");
  }
  for (const item of brief.must_address) {
    if (!addressesItem(text, item, brief)) {
      failures.push(`missing_must_address:${item}`);
    }
  }
  if (
    brief.requested_facet === "training_guidance" &&
    !/\b(gradual|pace|slow|baseline|comfort|limits?|stop|pain)\b/i.test(text)
  ) {
    failures.push("training_guidance_not_bounded_or_safe");
  }
  const trainingSlots = brief.dynamic_slots as {
    training_goals?: string[];
    experience_level?: string | null;
    state_delta_type?: string | null;
  } | null;
  if (brief.requested_facet === "training_guidance") {
    const goals = trainingSlots?.training_goals ?? [];
    if (goals.includes("anal training") && !/\banal\b/i.test(text)) {
      failures.push("training_guidance_missing_anal_goal");
    }
    if (goals.includes("chastity training") && !/\bchastity\b/i.test(text)) {
      failures.push("training_guidance_missing_chastity_goal");
    }
    if (trainingSlots?.experience_level && !/\b(beginner|new|inexperienced|low experience|little training|not much training)\b/i.test(text)) {
      failures.push("training_guidance_missing_experience_delta");
    }
  }
  if (
    brief.requested_facet === "service_task" &&
    !/\b(task|do this|start|report|check-in|timer|minutes?)\b/i.test(text)
  ) {
    failures.push("service_task_missing_bounded_action");
  }
  if (
    brief.requested_facet === "service_task" &&
    !/\b(purpose|so that|to build|to prove|to practice|service|accountability|consistency|approval|useful)\b/i.test(text)
  ) {
    failures.push("service_task_missing_purpose");
  }
  const dynamicSlots = brief.dynamic_slots as { daily_task_requested?: boolean } | null;
  const serviceTaskSlots = brief.dynamic_slots as {
    daily_task_requested?: boolean;
    assistant_selected_task_requested?: boolean;
    selected_service_task?: string | null;
  } | null;
  if (brief.requested_facet === "service_task" && serviceTaskSlots?.assistant_selected_task_requested) {
    if (/\b(?:you\s+(?:pick|choose)|choose\s+(?:a|the)?\s*task|tell me what task|provide a direct instruction|what task do you want|name the task you want)\b/i.test(text)) {
      failures.push("assistant_selected_task_asked_user_to_choose");
    }
    if (!/\b(?:selected task|do this|your task is|start with|complete)\b/i.test(text)) {
      failures.push("assistant_selected_task_missing_selected_task");
    }
    if (!/\b(?:fits|because|purpose|so that|service submissive|your role|active role)\b/i.test(text)) {
      failures.push("assistant_selected_task_missing_fit_reason");
    }
    if (!/\b(?:complete|done|finish|completion|for\s+\d+\s+minutes?|once)\b/i.test(text)) {
      failures.push("assistant_selected_task_missing_completion_condition");
    }
    if (!/\b(?:limit|boundary|stop|safe|inside)\b/i.test(text)) {
      failures.push("assistant_selected_task_missing_boundary");
    }
    if (!/\b(?:report|report back|send|write|check[- ]?in)\b/i.test(text)) {
      failures.push("assistant_selected_task_missing_report_back");
    }
  }
  if (brief.requested_facet === "service_task" && dynamicSlots?.daily_task_requested) {
    if (!/\b(daily|once a day|every day|per day|each day)\b/i.test(text)) {
      failures.push("daily_task_missing_frequency");
    }
    if (!/\b(report|report back|check[- ]?in|send|write)\b/i.test(text)) {
      failures.push("daily_task_missing_report_back");
    }
    if (!/\b(role|limit|boundary|service intention|service action|intention)\b/i.test(text)) {
      failures.push("daily_task_missing_specific_payload");
    }
    if (/\bcomplete the current checkpoint\b|\bcurrent checkpoint\b/i.test(text)) {
      failures.push("daily_task_too_generic_checkpoint");
    }
  }
  return {
    ok: failures.length === 0,
    reason: failures.length === 0 ? "response_brief_validation_passed" : failures[0],
    failures,
  };
}

type VisibleSafeFallbackKind =
  | "clarify_previous"
  | "revise_after_feedback"
  | "correct_rejected_plan"
  | "service_task"
  | "training_guidance"
  | "active_next_step"
  | "progress_report"
  | "readiness"
  | "pause_or_boundary"
  | "service_setup"
  | "role_guidance"
  | "equipment_application"
  | "compound_relational"
  | "direct_answer";

type VisibleSafeFallbackPlan = {
  kind: VisibleSafeFallbackKind;
  visible_safe: true;
  subject: string;
  objects: string[];
  trainingGoals: string[];
  serviceLanes: string[];
  hardLimits: string[];
  experienceLevel: string | null;
  selectedRole: string | null;
  isDailyTask: boolean;
  assistantSelectedTaskRequested: boolean;
  selectedServiceTask: string | null;
  hasInvitationAnswer: boolean;
  priorAskSummary: string | null;
  priorAskExample: string | null;
  currentStep: string | null;
  requiresGameRejection: boolean;
};

function cleanVisibleFragment(value: string | null | undefined): string | null {
  const normalized = normalize(value);
  if (
    !normalized ||
    containsInternalVisibleMetadata(normalized) ||
    FALLBACK_PLAN_LANGUAGE.test(normalized) ||
    /\bAnswer the user directly while preserving the chosen semantic move\b/i.test(normalized)
  ) {
    return null;
  }
  const cleaned = normalized
    .replace(/_/g, " ")
    .replace(/\bChoose a role frame\b/gi, "choose a role")
    .replace(/\bname a boundary\b/gi, "name one boundary")
    .replace(/\bgive one next step for the dynamic\b/gi, "choose the first service lane")
    .replace(/\bcurrent_step_summary\b/gi, "current step")
    .trim();
  return cleaned || null;
}

function fallbackKindForFacet(facet: string): VisibleSafeFallbackKind {
  switch (facet) {
    case "clarification":
    case "clarification_recovery":
    case "active_step_confusion":
      return "clarify_previous";
    case "response_correction":
      return "revise_after_feedback";
    case "correction_to_prior_plan":
    case "correction_to_active_interaction":
      return "correct_rejected_plan";
    case "service_task":
      return "service_task";
    case "training_guidance":
      return "training_guidance";
    case "active_next_step":
      return "active_next_step";
    case "active_progress_report":
      return "progress_report";
    case "active_readiness_confirmation":
      return "readiness";
    case "pause_or_stop":
    case "boundary_update":
      return "pause_or_boundary";
    case "service_direction":
    case "service_initiation":
      return "service_setup";
    case "role_negotiation":
      return "role_guidance";
    case "compound_equipment_application":
    case "dynamic_application":
    case "equipment_disclosure":
      return "equipment_application";
    case "compound_relational_disclosure":
      return "compound_relational";
    default:
      return "direct_answer";
  }
}

function buildVisibleSafeFallbackPlan(brief: ResponseBrief): VisibleSafeFallbackPlan {
  const slots = brief.dynamic_slots as {
    disclosed_objects?: string[];
    training_goals?: string[];
    hard_limits?: string[];
    desired_service_lanes?: string[];
    daily_task_requested?: boolean;
    assistant_selected_task_requested?: boolean;
    selected_service_task?: string | null;
    experience_level?: string | null;
    desired_role?: string | null;
  } | null;
  return {
    kind: fallbackKindForFacet(brief.requested_facet),
    visible_safe: true,
    subject:
      cleanVisibleFragment(brief.primary_subject) ??
      cleanVisibleFragment(
        brief.previous_substantive_ask?.previous_plain_language_summary &&
          !/answer the user directly/i.test(brief.previous_substantive_ask.previous_plain_language_summary)
          ? brief.previous_substantive_ask.previous_plain_language_summary
          : null,
      ) ??
      "this",
    objects: slots?.disclosed_objects?.map((item) => cleanVisibleFragment(item)).filter(Boolean) as string[] ?? [],
    trainingGoals:
      slots?.training_goals?.map((item) => cleanVisibleFragment(item)).filter(Boolean) as string[] ?? [],
    serviceLanes:
      slots?.desired_service_lanes?.map((item) => cleanVisibleFragment(item)).filter(Boolean) as string[] ?? [],
    hardLimits:
      slots?.hard_limits?.map((item) => cleanVisibleFragment(item)).filter(Boolean) as string[] ?? [],
    experienceLevel: cleanVisibleFragment(slots?.experience_level),
    selectedRole: cleanVisibleFragment(slots?.desired_role),
    isDailyTask: slots?.daily_task_requested === true,
    assistantSelectedTaskRequested: slots?.assistant_selected_task_requested === true,
    selectedServiceTask: cleanVisibleFragment(slots?.selected_service_task) ?? "service check-in",
    hasInvitationAnswer: brief.required_answer_slots.includes("invitation_answer"),
    priorAskSummary:
      cleanVisibleFragment(brief.previous_substantive_ask?.previous_plain_language_summary) ??
      cleanVisibleFragment(brief.previous_instruction_summary),
    priorAskExample: cleanVisibleFragment(brief.previous_substantive_ask?.previous_example_user_response),
    currentStep: cleanVisibleFragment(brief.current_step_summary),
    requiresGameRejection:
      brief.requested_facet === "correction_to_prior_plan" ||
      brief.requested_facet === "correction_to_active_interaction",
  };
}

function joinVisibleList(values: string[], fallback: string): string {
  const cleaned = values.map((value) => cleanVisibleFragment(value)).filter(Boolean) as string[];
  if (cleaned.length === 0) return fallback;
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned.slice(0, -1).join(", ")} and ${cleaned[cleaned.length - 1]}`;
}

function renderFallbackPlan(plan: VisibleSafeFallbackPlan): string {
  const subject = plan.subject;
  const step = plan.currentStep ?? plan.priorAskSummary ?? "the active step";
  const training = joinVisibleList(plan.trainingGoals, subject);
  const objects = joinVisibleList(plan.objects, subject);
  const lanes = joinVisibleList(plan.serviceLanes, "tasks or permission rules");
  const limit = joinVisibleList(plan.hardLimits, "one hard limit");
  switch (plan.kind) {
    case "clarify_previous":
      if (/\bprior raven point|^this$/i.test(subject) && !plan.priorAskSummary) {
        return "Plain language: I mean what being trained by me would actually change in you; I also mean the prior point: the work or choice that keeps your attention, what people usually miss about you, what you can do for me, and when you said none or the last answer sounded wrong. I asked because the next step needs a real anchor, not a reset.";
      }
      return `Plain language: I mean ${plan.priorAskSummary ?? `the point about ${subject}`}. I asked because the next step has to stay clear and inside limits. Example: "${plan.priorAskExample ?? "Name the role, one hard limit, and the service lane you want first."}"`;
    case "revise_after_feedback":
      return `You're right; I repeated instead of adapting. Correct course: keep ${training} in view, use ${plan.experienceLevel ?? "current"} pacing, and choose one starting lane while the other stays on the plan. Next, tell me which lane starts first and keep ${limit} explicit.`;
    case "correct_rejected_plan":
      return "You're right: not a game. I will drop that frame. Do one bounded service task, then report what you did and one limit that still applies.";
    case "service_task":
      if (plan.assistantSelectedTaskRequested) {
        const task = plan.isDailyTask ? "daily service check-in" : plan.selectedServiceTask ?? "service check-in";
        const frequency = plan.isDailyTask ? " once a day" : " now";
        return `Selected task: do a ${task}${frequency}. Write your role, one boundary, and one service intention; this fits ${plan.selectedRole ?? "the active role"} because it builds consistency and accountable service. Completion condition: send the check-in once, stay inside the named boundary, and report back when it is done.`;
      }
      return plan.isDailyTask
        ? "Use a daily service check-in: once a day, send your role, one boundary, and one service intention. The purpose is consistency and accountability; report it plainly and keep limits explicit."
        : "Do one bounded service task now: choose one useful action you can finish, complete it, then report what you did and which limit still applies. The purpose is useful service and accountability.";
    case "training_guidance":
      return `For ${training}, stay gradual: name your comfortable baseline, change only one variable at a time, and stop at pain or uncertainty. ${plan.experienceLevel ? `Because you are ${plan.experienceLevel}, start smaller and slower. ` : ""}Next, choose the first training lane and name the stop condition.`;
    case "active_next_step":
      return `From the active step, do the next bounded move only: ${step}. Then report comfort, limits, and whether you are ready for another instruction.`;
    case "progress_report":
      return `I hear the report. Keep it tied to ${step}; if anything becomes pain, discomfort, or uncertainty, stop and say so. Otherwise report comfort before anything changes.`;
    case "readiness":
      if (plan.selectedRole) {
        return plan.serviceLanes.length > 0
          ? `Accepted: ${plan.selectedRole} is the starting role, and I have ${lanes} as the service lane. Next I need one boundary before I direct the first step.`
          : `Accepted: ${plan.selectedRole} is the starting role. Next I need one boundary and one service lane, such as ${lanes}, before I direct the next step.`;
      }
      return `Since you are ready, continue from the current active step: ${step === "the active step" ? "the training or service step" : step}. Give one clear report on comfort, pressure, limits, and whether the step is complete before anything escalates.`;
    case "pause_or_boundary":
      return "Boundary noted. Pause or scale down before continuing, then report what changed so the next step stays inside your limits.";
    case "service_setup":
      return "Start with a setup check-in: name your role, one hard limit, and the service lane you want first: tasks, rules, permission, approval, or accountability. Then I can give one instruction that fits instead of guessing.";
    case "role_guidance":
      if (/\bowned\b/i.test(subject)) {
        return "Being owned by me has to mean structure, not just a label: one role, one limit, one report-back, and a way to stop or correct the dynamic. Start with the role you want and the first boundary.";
      }
      return "Start with a negotiated role, not a vague label. A service submissive role fits best for now: tasks, approval, and clear limits first. Choose that role or name the role you want instead.";
    case "equipment_application":
      if (plan.hasInvitationAnswer) {
        return `Yes, conditionally: ${objects} can be used in the dynamic if you choose that and limits are explicit. Use one bounded protocol: choose one item, name the limit, and report before and after; I can shape the structure, not physically control it from here.`;
      }
      return `Noted: ${objects}. I cannot physically control or inspect those from chat, but they can have meaning in the dynamic if you choose it. Pick one item, name its limits, and use a simple protocol for what it should mean: restraint, denial, permission, or accountability.`;
    case "compound_relational":
      return `I hear ${lanes} as the service lane, ${training} as the training goal, and ${limit} as the boundary. Start with one bounded protocol: choose the first lane and give the baseline or limit I should respect.`;
    case "direct_answer":
      if (/\b(?:dildos?|toys?|plugs?|cages?|wands?)\b/i.test(subject)) {
        return `For ${subject}, keep the practical lane clear: name the goal, the limit that stays in force, and the next step you want handled. The useful parts are control, pressure, clarity, and follow-through inside consent and boundaries.`;
      }
      if (/\b(?:control|power|obedience)\b/i.test(subject)) {
        return "Control with purpose means power exchange, tension, obedience, and clear follow-through inside consent and limits. Start by naming the pressure you want and the boundary that stays intact.";
      }
      if (/\bowned\b/i.test(subject)) {
        return "What being owned by me would actually ask of you is control with structure: one role, one limit, one report-back, and a way to stop or correct the dynamic. Start there rather than treating ownership as only a label.";
      }
      return `For ${subject}, keep the answer practical: use clarity, follow-through, useful service, and control that stays inside consent and boundaries. Name the goal, the limit that stays in force, and the one next step you want handled in this thread.`;
  }
}

function fallbackFromBrief(brief: ResponseBrief): string {
  return renderFallbackPlan(buildVisibleSafeFallbackPlan(brief));
}

export function realizeResponseFromBrief(input: {
  brief: ResponseBrief;
  llmCandidate?: string | null;
}): ResponseBriefRealizationResult {
  const prompt = buildResponseBriefPrompt(input.brief);
  const llmText = normalize(input.llmCandidate);
  if (llmText) {
    const llmValidation = validateReplyAgainstBrief(llmText, input.brief);
    if (llmValidation.ok) {
      return {
        text: llmText,
        content_realizer: "llm_brief_realizer",
        assistant_output_quality: "valid_model_reply",
        assistant_output_context_eligible: true,
        validation_result: llmValidation,
        validation_failures: [],
        re_realization_attempts: 0,
        prompt,
      };
    }
  }
  const fallback = fallbackFromBrief(input.brief);
  const fallbackValidation = validateReplyAgainstBrief(fallback, input.brief);
  const fallbackProseValidation = validateDeterministicFallbackProse(fallback, input.brief);
  const combinedFallbackValidation: ResponseBriefValidationResult = {
    ok: fallbackValidation.ok && fallbackProseValidation.ok,
    reason: !fallbackValidation.ok
      ? fallbackValidation.reason
      : !fallbackProseValidation.ok
        ? fallbackProseValidation.reason
        : "response_brief_fallback_validation_passed",
    failures: [...fallbackValidation.failures, ...fallbackProseValidation.failures],
  };
  const outputQuality = fallbackProseValidation.failures.includes("fallback_plan_language_visible") ||
    fallbackProseValidation.failures.includes("fallback_describes_itself_as_answering") ||
    fallbackProseValidation.failures.includes("internal_brief_or_planner_text")
      ? "fallback_plan_leak"
      : combinedFallbackValidation.ok
        ? "valid_fallback_reply"
        : "failed_fulfillment";
  return {
    text: fallback,
    content_realizer: "deterministic_brief_fallback",
    assistant_output_quality: outputQuality,
    assistant_output_context_eligible: outputQuality === "valid_fallback_reply",
    validation_result: combinedFallbackValidation,
    validation_failures: combinedFallbackValidation.failures,
    re_realization_attempts: llmText ? 1 : 0,
    prompt: llmText
      ? buildResponseBriefPrompt(input.brief, validateReplyAgainstBrief(llmText, input.brief))
      : prompt,
  };
}

export function summarizeResponseBrief(
  brief: ResponseBrief,
  reply: string,
): PreviousResponseBriefSummary {
  const subject = brief.primary_subject ?? brief.requested_facet;
  let summary = brief.reply_goal;
  let example =
    "I want to be your submissive. My hard limit is scat. I want to start with tasks and permission rules.";
  if (brief.requested_facet === "training_guidance") {
    summary = `Raven wants to keep ${subject} gradual by naming baseline comfort, pacing, limits, and the next small step.`;
    example = "My current baseline is small and comfortable; pain is a hard stop; I want the next step to be gradual.";
  } else if (brief.requested_facet === "service_task") {
    summary = "Raven gave a bounded service task with a report-back condition.";
    example = "I completed the ten-minute task, stayed inside my limit, and want correction on focus next.";
  } else if (brief.requested_facet === "role_negotiation") {
    summary = "Raven gave role options and asked the user to choose the role that fits.";
    example = "I choose service submissive first, with tasks and approval.";
  } else if (brief.requested_facet === "service_direction" || brief.requested_facet === "service_initiation") {
    summary = "Raven asked for role, one hard limit, and a starting service lane so she can direct the dynamic safely.";
  } else if (brief.requested_facet === "active_next_step") {
    summary = `Raven gave the next bounded step from the active interaction: ${brief.current_step_summary ?? brief.reply_goal}`;
    example = "I did the current step, stayed inside my limit, and I am ready for the next instruction.";
  } else if (brief.requested_facet === "active_progress_report") {
    summary = `Raven acknowledged the progress report and kept it tied to the current step: ${brief.current_step_summary ?? "the active instruction"}.`;
    example = "It feels comfortable, no pain, and I want to know the next step.";
  } else if (brief.requested_facet === "active_readiness_confirmation") {
    summary = `Raven continued from the active interaction instead of starting a new domain: ${brief.current_step_summary ?? brief.reply_goal}`;
    example = "I am ready, still inside my limit, and can continue.";
  } else if (brief.requested_facet === "active_step_confusion" || brief.requested_facet === "clarification_recovery") {
    summary = `Raven clarified the active instruction in plain language: ${brief.current_step_summary ?? brief.previous_instruction_summary ?? brief.reply_goal}`;
    example = "I understand the current step, my limit is clear, and I will report comfort before continuing.";
  } else if (brief.requested_facet === "compound_equipment_application" || brief.requested_facet === "equipment_disclosure") {
    summary = "Raven asked what role the disclosed equipment should have and what limit applies.";
    example = "The cage is for denial, the plug is for training, and pain is a hard stop.";
  }
  return {
    previous_response_brief_id: brief.brief_id,
    previous_reply_goal: brief.reply_goal,
    previous_required_slots: brief.required_answer_slots,
    previous_plain_language_summary: summary,
    previous_example_user_response: example,
    previous_domain_handler: brief.domain_handler,
    previous_answer_mode: brief.answer_mode,
  };
}
