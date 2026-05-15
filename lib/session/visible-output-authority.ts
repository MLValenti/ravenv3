import type { ActiveInteractionState } from "./active-interaction.ts";
import type { ResponseBriefRealizationResult } from "./response-brief.ts";
import type { SceneState } from "./scene-state.ts";
import type { PlannedMove, TurnMeaning } from "./turn-meaning.ts";

export type VisibleOutputOwner =
  | "approved_llm_renderer_from_response_brief"
  | "approved_response_brief_fallback"
  | "hard_lock_structured_renderer"
  | "memory_command_renderer"
  | "noop"
  | "blocked";

export type VisibleOutputCandidateKind =
  | "visible_assistant_prose"
  | "nonvisible_renderer_instruction"
  | "nonvisible_state_summary"
  | "nonvisible_validator_reason"
  | "nonvisible_repair_instruction"
  | "nonvisible_fallback_plan"
  | "nonvisible_debug_summary"
  | "nonvisible_prompt_fragment";

export type NonVisibleOutputCandidateKind = Exclude<
  VisibleOutputCandidateKind,
  "visible_assistant_prose"
>;

export type VisibleOutputCandidate = {
  source: string;
  text: string | null;
  role: "raw_model" | "response_brief" | "legacy" | "structured_hard_lock" | "client" | "system";
  kind: VisibleOutputCandidateKind;
  visible_safe: boolean;
  owner?: VisibleOutputOwner | null;
  internal_source_type?: NonVisibleOutputCandidateKind | "visible_safe" | null;
  selected?: boolean;
  blocked?: boolean;
  reason?: string | null;
};

export type VisibleOutputReplacement = {
  oldText: string;
  newText: string;
  reason: string;
  sourcePath: string;
};

export type VisibleOutputAuthorityDecision = {
  final_visible_owner: VisibleOutputOwner;
  final_visible_source: string;
  all_visible_candidates: VisibleOutputCandidate[];
  rejected_visible_candidates: VisibleOutputCandidate[];
  replacement_chain: VisibleOutputReplacement[];
  model_reply_used: boolean;
  response_brief_used: boolean;
  response_brief_id: string | null;
  response_gate_replaced: boolean;
  client_generated_reply_used: boolean;
  legacy_visible_emitter_used: boolean;
  legacy_visible_emitter_blocked: boolean;
  deterministic_bypass_used: boolean;
  deterministic_bypass_reason: string | null;
  scene_scaffold_candidate_created: boolean;
  scene_scaffold_candidate_used: boolean;
  turn_plan_fallback_created: boolean;
  turn_plan_fallback_used: boolean;
  brief_realizer_used: boolean;
  llm_renderer_used: boolean;
  approved_response_brief_fallback_used: boolean;
  candidate_kind: VisibleOutputCandidateKind;
  candidate_visible_safe: boolean;
  final_visible_candidate: VisibleOutputCandidate | null;
  strict_relational_authority: boolean;
  visible_commit_owner: VisibleOutputOwner;
  visible_commit_allowed: boolean;
  assistant_output_quality?: string | null;
  assistant_output_context_eligible?: boolean | null;
  request_fulfilled?: boolean | null;
};

const ORDINARY_CONTENT_KEYS = new Set([
  "greeting_open",
  "current_status_answer",
  "clarification_answer",
  "conversation_continue",
  "reciprocal_user_probe",
]);

const LEGACY_SOURCE_PATTERN =
  /scaffold|(?<!brief_)fallback|weak|deterministic(?!_brief_fallback)|game|repair|turn_plan|core_conversation|greeting|humanquestion|continuityrecovery/i;
const STRICT_BLOCKED_LEGACY_SOURCE_PATTERN =
  /scaffold|weak|game|repair|definition|device|tool|turn_plan|buildTurnPlanFallback/i;
const STRICT_BLOCKED_LEGACY_TEXT_PATTERN =
  /Device command:|Tool command:|Keep going|Stay with the concrete part|concrete part of open|rules of this game|We stay on one game thread|best three out of five|score|round|I do not have enough local context to define|Give me the domain you mean|I mean slut|raw repair instruction|part about last|Use it in the way that fits the line/i;
const INTERNAL_TEXT_SHAPE_PATTERN =
  /\b(?:ResponseBrief|TurnMeaning|semantic_plan|answer_mode|requested_facet|requested_facets|domain_handler|content_source|candidate_routes|active_interaction|current_step_summary|previous_response_brief|validation_failures|validator|debug_trace|planned_move|turn_plan|scaffold_source|replacement_chain|state summary|renderer instruction|repair instruction|fallback plan)\b|(?:^|\n)\s*(?:[a-z][a-z0-9]*_){1,}[a-z0-9]+\s*[:=]\s*\S/i;
const FALLBACK_PLAN_TEXT_SHAPE_PATTERN =
  /\b(?:I can answer\b|Keep it bounded\b|no pretend physical control\b|provide a direct instruction|Good\. Keep the same subject|answer this change directly|I'm going to need you to provide|Raven gave a bounded service task|fallback plan|renderer instruction|validator reason)\b/i;

export function visibleTextImpliesUnlimitedConsent(text: string | null | undefined): boolean {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /\bno\s+safeword\s+means\s+no\s+limit\b/i.test(normalized) ||
    /\bwithout\s+a\s+safeword\b[^.?!]{0,80}\b(?:no|without)\s+limits?\b/i.test(normalized) ||
    /\bno\s+safeword\b[^.?!]{0,80}\b(?:unlimited|anything\s+goes|no\s+stop)\b/i.test(normalized) ||
    /\babsent\s+(?:a\s+)?safeword\b[^.?!]{0,80}\b(?:unlimited|no\s+limits?)\b/i.test(normalized)
  );
}

export function isHardLockedStructuredScene(sceneState: SceneState | null | undefined): boolean {
  if (!sceneState) {
    return false;
  }
  return (
    sceneState.task_hard_lock_active ||
    sceneState.interaction_mode === "game" ||
    sceneState.interaction_mode === "locked_task_execution" ||
    sceneState.topic_type === "game_execution" ||
    sceneState.topic_type === "game_setup" ||
    sceneState.topic_type === "reward_negotiation" ||
    sceneState.topic_type === "reward_window" ||
    sceneState.topic_type === "task_execution" ||
    sceneState.topic_type === "verification_in_progress" ||
    sceneState.topic_type === "task_terms_negotiation"
  );
}

export function isOrdinaryOrRelationalTurn(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
  activeInteraction?: ActiveInteractionState | null;
  sceneState?: SceneState | null;
}): boolean {
  if (isHardLockedStructuredScene(input.sceneState)) {
    return false;
  }
  if (input.turnMeaning.current_domain_handler === "relational_dynamics") {
    return true;
  }
  if (
    input.activeInteraction?.active_interaction_id &&
    input.activeInteraction.interaction_type !== "game" &&
    input.activeInteraction.interaction_type !== "generic_conversation"
  ) {
    return true;
  }
  return (
    input.turnMeaning.current_domain_handler === "conversation" ||
    ORDINARY_CONTENT_KEYS.has(input.plannedMove.content_key)
  );
}

export function isStrictVisibleAuthorityTurn(input: {
  turnMeaning: TurnMeaning;
  activeInteraction?: ActiveInteractionState | null;
}): boolean {
  if (input.turnMeaning.current_domain_handler === "relational_dynamics") {
    return true;
  }
  return Boolean(
    input.activeInteraction?.active_interaction_id &&
      input.activeInteraction.interaction_type !== "game" &&
      input.activeInteraction.interaction_type !== "generic_conversation",
  );
}

function inferNonvisibleKindFromSource(source: string, text: string | null): NonVisibleOutputCandidateKind {
  const joined = `${source} ${text ?? ""}`;
  if (/repair|clarification_anchor|continuation/i.test(joined)) {
    return "nonvisible_repair_instruction";
  }
  if (/validator|validation|contract|lint|barrier/i.test(joined)) {
    return "nonvisible_validator_reason";
  }
  if (/prompt|renderer_instruction|system_prompt/i.test(joined)) {
    return "nonvisible_prompt_fragment";
  }
  if (/state|summary|active_interaction|response_brief|turn_plan|semantic/i.test(joined)) {
    return "nonvisible_state_summary";
  }
  if (/debug|trace|route|candidate/i.test(joined)) {
    return "nonvisible_debug_summary";
  }
  return "nonvisible_fallback_plan";
}

function inferCandidateKind(input: {
  source: string;
  text: string | null;
  role: VisibleOutputCandidate["role"];
  explicitKind?: VisibleOutputCandidateKind;
}): VisibleOutputCandidateKind {
  if (input.explicitKind) {
    return input.explicitKind;
  }
  if (input.role === "response_brief" || input.role === "raw_model" || input.role === "structured_hard_lock") {
    return INTERNAL_TEXT_SHAPE_PATTERN.test(input.text ?? "")
      ? inferNonvisibleKindFromSource(input.source, input.text)
      : "visible_assistant_prose";
  }
  if (input.role === "client" || input.role === "legacy" || input.role === "system") {
    return inferNonvisibleKindFromSource(input.source, input.text);
  }
  return "nonvisible_fallback_plan";
}

function defaultVisibleSafety(input: {
  kind: VisibleOutputCandidateKind;
  role: VisibleOutputCandidate["role"];
  text: string | null;
  source: string;
}): boolean {
  if (input.kind !== "visible_assistant_prose") {
    return false;
  }
  if (input.role === "legacy" || input.role === "client" || input.role === "system") {
    return false;
  }
  if (visibleTextImpliesUnlimitedConsent(input.text)) {
    return false;
  }
  if (INTERNAL_TEXT_SHAPE_PATTERN.test(input.text ?? "")) {
    return false;
  }
  if (FALLBACK_PLAN_TEXT_SHAPE_PATTERN.test(input.text ?? "")) {
    return false;
  }
  if (STRICT_BLOCKED_LEGACY_SOURCE_PATTERN.test(input.source)) {
    return false;
  }
  return true;
}

export function recordVisibleCandidate(
  source: string,
  text: string | null | undefined,
  role: VisibleOutputCandidate["role"],
  extra: Partial<VisibleOutputCandidate> = {},
): VisibleOutputCandidate {
  const normalizedText = typeof text === "string" ? text : null;
  const kind = inferCandidateKind({
    source,
    text: normalizedText,
    role,
    explicitKind: extra.kind,
  });
  const visibleSafe =
    typeof extra.visible_safe === "boolean"
      ? extra.visible_safe
      : defaultVisibleSafety({ kind, role, text: normalizedText, source });
  const internalSourceType =
    extra.internal_source_type ??
    (kind === "visible_assistant_prose" ? null : kind);
  return {
    source,
    text: normalizedText,
    role,
    kind,
    visible_safe: visibleSafe,
    owner: extra.owner ?? null,
    internal_source_type: internalSourceType,
    selected: extra.selected ?? false,
    blocked: extra.blocked ?? false,
    reason: extra.reason ?? null,
  };
}

export function blockLegacyVisibleEmitter(
  candidate: VisibleOutputCandidate,
  reason = "ordinary_or_relational_turn_owned_by_response_brief",
): VisibleOutputCandidate {
  return {
    ...candidate,
    blocked: true,
    selected: false,
    reason,
  };
}

function shouldBlockStrictLegacyCandidate(candidate: VisibleOutputCandidate): boolean {
  return (
    (
      candidate.kind !== "visible_assistant_prose" ||
      candidate.role === "legacy"
    ) &&
    (
      STRICT_BLOCKED_LEGACY_SOURCE_PATTERN.test(candidate.source) ||
      STRICT_BLOCKED_LEGACY_TEXT_PATTERN.test(candidate.text ?? "") ||
      visibleTextImpliesUnlimitedConsent(candidate.text) ||
      INTERNAL_TEXT_SHAPE_PATTERN.test(candidate.text ?? "")
    )
  );
}

function ownerFromBriefRealizer(
  contentRealizer: string | null | undefined,
): VisibleOutputOwner {
  return contentRealizer === "llm_brief_realizer"
    ? "approved_llm_renderer_from_response_brief"
    : "approved_response_brief_fallback";
}

export function selectVisibleOutputOwner(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
  sceneState?: SceneState | null;
  activeInteraction?: ActiveInteractionState | null;
  candidateSource?: string | null;
  finalSource?: string | null;
  responseBriefId?: string | null;
  contentRealizer?: string | null;
  responseBriefRealization?: ResponseBriefRealizationResult | null;
  replacementChain?: VisibleOutputReplacement[];
  candidates?: VisibleOutputCandidate[];
  deterministicBypassUsed?: boolean;
  deterministicBypassReason?: string | null;
  clientGeneratedReplyUsed?: boolean;
  commitAllowed?: boolean;
  assistantOutputQuality?: string | null;
  assistantOutputContextEligible?: boolean | null;
  requestFulfilled?: boolean | null;
}): VisibleOutputAuthorityDecision {
  const authorityApplies = isOrdinaryOrRelationalTurn({
    turnMeaning: input.turnMeaning,
    plannedMove: input.plannedMove,
    activeInteraction: input.activeInteraction,
    sceneState: input.sceneState,
  });
  const strictAuthorityApplies = isStrictVisibleAuthorityTurn({
    turnMeaning: input.turnMeaning,
    activeInteraction: input.activeInteraction,
  });
  const contentRealizer =
    input.contentRealizer ??
    input.responseBriefRealization?.content_realizer ??
    null;
  const candidateSource = input.candidateSource ?? "unknown";
  const finalSource = input.finalSource ?? candidateSource;
  const replacementChain = input.replacementChain ?? [];
  const baseCandidates = input.candidates ?? [];
  const candidateRecords =
    baseCandidates.length > 0
      ? baseCandidates
      : [recordVisibleCandidate(candidateSource, null, LEGACY_SOURCE_PATTERN.test(candidateSource) ? "legacy" : "raw_model")];
  const legacyCandidateCreated = candidateRecords.some((candidate) => candidate.role === "legacy") ||
    LEGACY_SOURCE_PATTERN.test(candidateSource) ||
    LEGACY_SOURCE_PATTERN.test(finalSource);
  const strictBlockedLegacyCandidateCreated =
    candidateRecords.some(shouldBlockStrictLegacyCandidate) ||
    STRICT_BLOCKED_LEGACY_SOURCE_PATTERN.test(candidateSource) ||
    STRICT_BLOCKED_LEGACY_SOURCE_PATTERN.test(finalSource);
  const legacyUsed =
    legacyCandidateCreated &&
    !contentRealizer &&
    LEGACY_SOURCE_PATTERN.test(finalSource);
  const legacyBlocked =
    strictAuthorityApplies &&
    (
      strictBlockedLegacyCandidateCreated ||
      replacementChain.some((entry) =>
        STRICT_BLOCKED_LEGACY_SOURCE_PATTERN.test(entry.sourcePath) ||
        STRICT_BLOCKED_LEGACY_TEXT_PATTERN.test(`${entry.oldText} ${entry.reason}`),
      )
    ) &&
    Boolean(contentRealizer || replacementChain.length > 0);
  const rejectedCandidates = candidateRecords
    .filter((candidate) =>
      candidate.blocked ||
      (strictAuthorityApplies && shouldBlockStrictLegacyCandidate(candidate)) ||
      (strictAuthorityApplies && candidate.kind !== "visible_assistant_prose") ||
      (strictAuthorityApplies && !candidate.visible_safe),
    )
    .map((candidate) =>
      candidate.blocked
        ? candidate
        : blockLegacyVisibleEmitter(
            candidate,
            candidate.kind !== "visible_assistant_prose"
              ? `nonvisible_candidate_blocked:${candidate.kind}`
              : !candidate.visible_safe
                ? "candidate_not_visible_safe"
                : "ordinary_or_relational_turn_owned_by_response_brief",
          ),
    );
  const owner: VisibleOutputOwner = !authorityApplies
    ? "hard_lock_structured_renderer"
    : contentRealizer
      ? ownerFromBriefRealizer(contentRealizer)
      : strictAuthorityApplies && legacyUsed && strictBlockedLegacyCandidateCreated
        ? "blocked"
        : strictAuthorityApplies || candidateSource === "raw_model" || candidateSource === "model"
          ? "approved_llm_renderer_from_response_brief"
          : "hard_lock_structured_renderer";
  const briefRealizerUsed = owner === "approved_llm_renderer_from_response_brief" ||
    owner === "approved_response_brief_fallback";
  const finalCandidate =
    candidateRecords.find((candidate) => candidate.selected && candidate.source === finalSource) ??
    candidateRecords.find((candidate) => candidate.selected && candidate.role === "response_brief") ??
    candidateRecords.find((candidate) => candidate.selected) ??
    null;
  const candidateKind = finalCandidate?.kind ?? "nonvisible_fallback_plan";
  const candidateVisibleSafe = finalCandidate?.visible_safe ?? false;
  const strictCommitAllowed =
    !strictAuthorityApplies ||
    (
      (owner === "approved_llm_renderer_from_response_brief" ||
        owner === "approved_response_brief_fallback") &&
      candidateKind === "visible_assistant_prose" &&
      candidateVisibleSafe
    );
  return {
    final_visible_owner: owner,
    final_visible_source: finalSource,
    all_visible_candidates: candidateRecords,
    rejected_visible_candidates: rejectedCandidates,
    replacement_chain: replacementChain,
    model_reply_used:
      (candidateSource === "raw_model" ||
        candidateSource === "model" ||
        contentRealizer === "llm_brief_realizer" ||
        finalSource === "llm_brief_realizer") &&
      owner === "approved_llm_renderer_from_response_brief",
    response_brief_used: briefRealizerUsed || Boolean(input.responseBriefId),
    response_brief_id: input.responseBriefId ?? null,
    response_gate_replaced: replacementChain.length > 0,
    client_generated_reply_used: input.clientGeneratedReplyUsed ?? false,
    legacy_visible_emitter_used: legacyUsed,
    legacy_visible_emitter_blocked: legacyBlocked,
    deterministic_bypass_used: input.deterministicBypassUsed ?? false,
    deterministic_bypass_reason: input.deterministicBypassReason ?? null,
    scene_scaffold_candidate_created: candidateRecords.some((candidate) => /scene_scaffold|game_scaffold/i.test(candidate.source)),
    scene_scaffold_candidate_used: /scene_scaffold|game_scaffold/i.test(finalSource) && !legacyBlocked,
    turn_plan_fallback_created: candidateRecords.some((candidate) => /turn_plan|buildTurnPlanFallback/i.test(candidate.source)),
    turn_plan_fallback_used: /turn_plan|buildTurnPlanFallback/i.test(finalSource) && !legacyBlocked,
    brief_realizer_used: briefRealizerUsed,
    llm_renderer_used: owner === "approved_llm_renderer_from_response_brief",
    approved_response_brief_fallback_used: owner === "approved_response_brief_fallback",
    candidate_kind: candidateKind,
    candidate_visible_safe: candidateVisibleSafe,
    final_visible_candidate: finalCandidate,
    strict_relational_authority: strictAuthorityApplies,
    visible_commit_owner: owner,
    visible_commit_allowed:
      input.commitAllowed ?? (owner !== "blocked" && strictCommitAllowed),
    assistant_output_quality: input.assistantOutputQuality ?? null,
    assistant_output_context_eligible: input.assistantOutputContextEligible ?? null,
    request_fulfilled: input.requestFulfilled ?? null,
  };
}

export function commitVisibleOutput(input: {
  decision: VisibleOutputAuthorityDecision;
  text: string;
  candidate?: VisibleOutputCandidate | null;
}): { allow: boolean; reason: string; text: string } {
  const candidate = input.candidate ?? input.decision.final_visible_candidate;
  if (!candidate) {
    return {
      allow: false,
      reason: "visible_output_candidate_missing",
      text: input.text,
    };
  }
  if (input.decision.assistant_output_quality === "failed_fulfillment") {
    return {
      allow: false,
      reason: "assistant_output_quality_failed_fulfillment",
      text: input.text,
    };
  }
  if (input.decision.assistant_output_quality === "generic_assistant_voice") {
    return {
      allow: false,
      reason: "assistant_output_quality_generic_assistant_voice",
      text: input.text,
    };
  }
  if (input.decision.request_fulfilled === false) {
    return {
      allow: false,
      reason: "request_not_fulfilled",
      text: input.text,
    };
  }
  if (input.decision.assistant_output_context_eligible === false) {
    return {
      allow: false,
      reason: "assistant_output_context_not_eligible",
      text: input.text,
    };
  }
  if (candidate.kind !== "visible_assistant_prose") {
    return {
      allow: false,
      reason: `nonvisible_candidate_kind:${candidate.kind}`,
      text: input.text,
    };
  }
  if (!input.decision.visible_commit_allowed || input.decision.final_visible_owner === "blocked") {
    return {
      allow: false,
      reason: "visible_output_owner_not_allowed",
      text: input.text,
    };
  }
  if (candidate.visible_safe !== true) {
    return {
      allow: false,
      reason: "candidate_not_visible_safe",
      text: input.text,
    };
  }
  if (
    (input.decision.final_visible_owner === "approved_llm_renderer_from_response_brief" ||
      input.decision.final_visible_owner === "approved_response_brief_fallback") &&
    candidate.owner &&
    candidate.owner !== input.decision.final_visible_owner
  ) {
    return {
      allow: false,
      reason: "candidate_owner_does_not_match_approved_visible_owner",
      text: input.text,
    };
  }
  if (candidate.internal_source_type && candidate.internal_source_type !== "visible_safe") {
    return {
      allow: false,
      reason: `internal_source_type_not_committable:${candidate.internal_source_type}`,
      text: input.text,
    };
  }
  if (
    input.decision.strict_relational_authority &&
    input.decision.final_visible_owner !== "approved_llm_renderer_from_response_brief" &&
    input.decision.final_visible_owner !== "approved_response_brief_fallback"
  ) {
    return {
      allow: false,
      reason: "strict_relational_authority_requires_approved_renderer",
      text: input.text,
    };
  }
  if (visibleTextImpliesUnlimitedConsent(input.text)) {
    return {
      allow: false,
      reason: "unsafe_unlimited_consent_text",
      text: input.text,
    };
  }
  if (INTERNAL_TEXT_SHAPE_PATTERN.test(input.text) || FALLBACK_PLAN_TEXT_SHAPE_PATTERN.test(input.text)) {
    return {
      allow: false,
      reason: "visible_text_has_nonvisible_planner_shape",
      text: input.text,
    };
  }
  return {
    allow: true,
    reason: "visible_output_owner_allowed",
    text: input.text,
  };
}
