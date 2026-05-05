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
  validation_result: ResponseBriefValidationResult;
  validation_failures: string[];
  re_realization_attempts: number;
  prompt: string;
};

const GAME_LANGUAGE = /\b(?:in this game|game|round|score|scoring|points?|win|lose|best (?:two|three|of)|best three out of five|consequence task|quick mental games?|prompt\/answer|answer this question for points)\b/i;

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

function normalizeLower(text: string | null | undefined): string {
  return normalize(text).toLowerCase();
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
  switch (turnMeaning.requested_facet) {
    case "response_correction":
      return ["acknowledge feedback", "correct course", "revised answer"];
    case "correction_to_prior_plan":
      return ["acknowledge correction", "abandon game framing", "non-game task"];
    case "service_task":
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
  switch (turnMeaning.requested_facet) {
    case "response_correction":
      return "Acknowledge the user's feedback about the bad or repeated answer, correct course, and give a revised answer that addresses the active state.";
    case "correction_to_prior_plan":
      return "Acknowledge the correction, drop game framing, and give one bounded non-game service task.";
    case "service_task":
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
  switch (turnMeaning.requested_facet) {
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
      return "Be actionable: one bounded instruction with a clear report-back condition.";
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
  return {
    brief_id: stableBriefId(turnMeaning, plannedMove),
    source_turn_id: input.sourceTurnId ?? null,
    semantic_plan_id: `semantic_plan:${plannedMove.content_key}:${facet}`,
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
    must_not_include: mustNotIncludeForBrief(turnMeaning),
    allowed_boundaries: [
      "conversation-only control",
      "consent and limits before escalation",
      "one focused clarifying question when setup is missing",
    ],
    capability_limits: [
      "Raven cannot physically inspect, control, or enforce real-world actions from chat.",
      "Raven may shape conversational structure, protocol, and reflection.",
    ],
    persona_style:
      "Raven may be direct and dominant, but persona flavor must not replace the requested answer.",
    desired_depth: desiredDepth,
    reply_goal: replyGoalForBrief(turnMeaning),
    answer_strategy: answerStrategyForBrief(turnMeaning),
    clarification_policy:
      facet === "clarification_recovery" || desiredDepth === "stepwise"
        ? "Attach to the previous substantive plan and explain that plan practically."
        : "Ask at most one focused clarification only if required slots are genuinely missing.",
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
  if (itemLower.includes("active interaction")) return /\b(active|current|same|this step|interaction|instruction|what we are doing|from here|dynamic|training|service)\b/i.test(text);
  if (itemLower.includes("next bounded step")) return /\b(next step|first instruction|do this|start|now|report|one step|bounded)\b/i.test(text);
  if (itemLower.includes("no game")) return !GAME_LANGUAGE.test(text) || /\bnot a game|no game|without game\b/i.test(text);
  if (itemLower.includes("acknowledge progress")) return /\b(good|noted|i hear|you are|you started|you kept|reported|that report)\b/i.test(text);
  if (itemLower.includes("current step")) return /\b(current step|same step|that step|this step|instruction|baseline|report|doing it)\b/i.test(text);
  if (itemLower.includes("safety check")) return /\b(stop|pain|limit|boundary|comfortable|comfort|too much|if it feels wrong)\b/i.test(text);
  if (itemLower.includes("readiness")) return /\b(ready|readiness|you agreed|if you are ready|since you are ready)\b/i.test(text);
  if (itemLower.includes("pause or stop")) return /\b(stop|pause|paused|we stop|do not continue)\b/i.test(text);
  if (itemLower.includes("rejected plan")) return /\b(not continuing|drop|rejected|not a game|stay on this|instead)\b/i.test(text);
  if (itemLower.includes("service lane")) return /\b(service|tasks?|rules?|permission|approval|accountability)\b/i.test(text);
  if (itemLower.includes("boundary")) return /\b(limits?|boundar(?:y|ies)|consent|stop|off-limits|from here)\b/i.test(text);
  if (itemLower.includes("plain language")) return /\b(plain language|what i mean|i was asking|simpler)\b/i.test(text);
  if (itemLower.includes("why raven asked")) return /\b(so i|because|that lets me|so we|so the dynamic)\b/i.test(text);
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
  if (/\b(answer_mode|requested_facet|ResponseBrief|semantic planner|content_source)\b/i.test(text)) {
    failures.push("internal_brief_or_planner_text");
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

function fallbackFromBrief(brief: ResponseBrief): string {
  const subject = brief.primary_subject ?? "this";
  const renderableStep = (brief.current_step_summary ?? brief.previous_instruction_summary ?? subject)
    .replace(/\bChoose a role frame,?\s*/i, "")
    .replace(/\bname a boundary,?\s*/i, "")
    .replace(/\band give one next step for the dynamic\b/i, "")
    .trim();
  const slots = brief.dynamic_slots as {
    disclosed_objects?: string[];
    training_goals?: string[];
    hard_limits?: string[];
    desired_service_lanes?: string[];
    daily_task_requested?: boolean;
    experience_level?: string | null;
    state_delta_type?: string | null;
    meta_feedback?: string | null;
    desired_role?: string | null;
  } | null;
  switch (brief.requested_facet) {
    case "response_correction": {
      const goals = slots?.training_goals?.length
        ? slots.training_goals.join(" and ")
        : "the active plan";
      const experience = slots?.experience_level ? ` with ${slots.experience_level} pacing` : "";
      return `You're right, that repeated instead of adapting. Correct course: we keep ${goals}${experience}, choose one starting lane first, and make the next step beginner-safe with limits named before anything escalates. Start by choosing anal or chastity as the first lane, and I will keep the other as the second goal rather than dropping it.`;
    }
    case "correction_to_prior_plan":
      return "You're right: not a game. Drop the game frame. Do this as a service task: choose one useful action you can complete in ten minutes, do it cleanly, then report what you did and one limit I should keep respecting.";
    case "service_task":
      if ((slots as { daily_task_requested?: boolean } | null)?.daily_task_requested) {
        return "Your daily service task is a two-minute check-in: write one sentence naming your role, one sentence naming today's limit, and one sentence naming the service action you will complete. The purpose is consistency and accountability; report it once a day and keep limits clear.";
      }
      return "Do one bounded service task now: set a ten-minute timer, complete one useful action you can honestly finish, then report back with what you did, whether you stayed within your limits, and what you want corrected next. The purpose is useful service and accountability.";
    case "training_guidance": {
      const goals = slots?.training_goals?.length
        ? slots.training_goals
        : subject.split(/\s*,\s*/).filter(Boolean);
      const training = goals.length ? goals.join(" and ") : subject;
      const beginner = slots?.experience_level
        ? " Since you are beginner/low experience, the next step gets smaller, slower, and more explicit."
        : "";
      const lane =
        goals.includes("anal training") && goals.includes("chastity training")
          ? "Start by choosing one lane for today: anal baseline comfort or a chastity check-in; the other stays on the plan for the next step."
          : "First tell me your current baseline and one hard stop, then I can make the next step concrete.";
      return `For ${training}, the useful approach is gradual: start from your current comfortable baseline, move only one small step at a time, stop at pain or pressure that feels wrong, and keep limits explicit.${beginner} ${lane}`;
    }
    case "active_next_step": {
      const step = brief.current_step_summary ?? "the active interaction";
      return `From the active step, here is the next bounded move: stay with ${step}, do one small safe step only, then report comfort, limits, and whether you want the next instruction. No jump forward.`;
    }
    case "active_progress_report": {
      const step = brief.current_step_summary ?? "the current instruction";
      return `Good, I hear the progress report. Keep it tied to the current step: ${step}. If tight becomes pain, discomfort, or uncertainty, stop and say so; otherwise report your comfort level before I give anything further.`;
    }
    case "active_readiness_confirmation": {
      const selectedRole =
        (slots as { desired_role?: string | null } | null)?.desired_role ??
        (/\bservice submissive\b/i.test(brief.normalized_user_text) ? "service submissive" : null);
      if (selectedRole) {
        return `You agreed: service submissive is the starting role. Next I need one boundary and one service lane: tasks, rules, permission, or approval. Example: "My hard limit is scat, and I want to start with tasks."`;
      }
      const step = renderableStep && !/^for one careful minute$/i.test(renderableStep)
        ? renderableStep
        : "the active training step";
      return `Since you are ready, we continue from ${step}. Give one clear report on comfort, pressure, limits, and what the training asks of you before anything changes. No jump forward.`;
    }
    case "active_step_confusion": {
      const step = brief.current_step_summary ?? brief.previous_instruction_summary ?? "the current instruction";
      return `Plain language: the current step is ${step}. I am asking because I need the active step, your comfort, and your limit clear before I direct the next move. Example: "I am doing the current step, it feels comfortable, and pain is a stop."`;
    }
    case "pause_or_stop":
      return "Paused. Stop the active interaction now and do not continue the current step unless you explicitly restart it. Your boundary is the priority.";
    case "correction_to_active_interaction":
      return "You're right: not a game. Stay on this, and do not continue the rejected frame. We keep the active interaction as a bounded service or training step, with one clear report-back before anything changes.";
    case "boundary_update":
      return "Boundary noted. Treat that as the rule for the active interaction: stop or scale down before it becomes too much, then report what changed so the next step stays inside your limits.";
    case "clarification_recovery": {
      const previous = brief.previous_substantive_ask;
      if (previous) {
        return `${previous.previous_plain_language_summary} In plain language, I asked because I need the limits and starting lane before I direct you. Example: "${previous.previous_example_user_response}"`;
      }
      return "What I mean is simpler than it sounded: name the role you want, one hard limit, and the service lane you want to start with. I asked because those details keep the next instruction clear and inside your limits. Example: \"I want to be your submissive, scat is off-limits, and I want tasks first.\"";
    }
    case "service_direction":
    case "service_initiation":
      return "Start here: send a three-line check-in with your role, one hard limit, and the service lane you want now: tasks, rules, permission, or approval. Then I can give one instruction that fits instead of guessing.";
    case "role_negotiation":
      if (/\bowned\b/i.test(subject) || /\bowned\b/i.test(JSON.stringify(slots ?? {}))) {
        return "Being owned by me can be the frame, but it has to mean something specific: what I can ask of you, what stays off-limits, and how you can stop or correct the dynamic. Start as an owned service submissive: one rule, one limit, and one report-back.";
      }
      return "Your role can be a submissive, a service submissive, or a pet. My recommendation is service submissive first: tasks, approval, and clear limits before heavier control. Choose that role or tell me which one pulls harder.";
    case "compound_equipment_application":
    case "equipment_disclosure": {
      const objects = slots?.disclosed_objects?.length ? slots.disclosed_objects.join(", ") : subject;
      if (brief.required_answer_slots.includes("invitation_answer")) {
        return `Yes, conditionally: ${objects} can be used in the dynamic if you choose that and the limits are clear. Start with one bounded protocol: choose one item, tell me the limit for it, and report before and after; I can direct the meaning and structure, not physically control it from here.`;
      }
      return `Noted: ${objects}. I cannot physically control or inspect those from here, but they can have a role in the dynamic if you choose it. Pick one item, name its limit, and tell me whether it should mean restraint, denial, permission, or accountability.`;
    }
    case "compound_relational_disclosure": {
      const lanes = slots?.desired_service_lanes?.length ? slots.desired_service_lanes.join(", ") : "tasks";
      const training = slots?.training_goals?.length ? slots.training_goals.join(", ") : "training";
      const limits = slots?.hard_limits?.length ? slots.hard_limits.join(", ") : "your hard limit";
      return `I hear ${lanes} as the service lane, ${training} as the training goal, and ${limits} as off-limits. We keep the boundary first, then build structure. Bounded start: choose tasks or permission rules, and give me your current comfort baseline for the training.`;
    }
    default:
      return `I can answer ${subject} directly, but I will keep it bounded: one clear next step, limits named before escalation, and no pretend physical control from here.`;
  }
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
        validation_result: llmValidation,
        validation_failures: [],
        re_realization_attempts: 0,
        prompt,
      };
    }
  }
  const fallback = fallbackFromBrief(input.brief);
  const fallbackValidation = validateReplyAgainstBrief(fallback, input.brief);
  return {
    text: fallback,
    content_realizer: "deterministic_brief_fallback",
    validation_result: fallbackValidation,
    validation_failures: fallbackValidation.failures,
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
