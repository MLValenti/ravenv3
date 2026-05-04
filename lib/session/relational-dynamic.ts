export type RelationalDynamicSpeechAct =
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
  | "ambiguous_dynamic_topic";

export type RelationalDynamicFacet =
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
  | "safety_or_limits_discussion";

export type RelationalDynamicAnswerContract =
  | RelationalDynamicFacet
  | "compound_equipment_application"
  | "answer_invitation_or_boundary";

export type RelationalDynamicComponent = {
  speech_act: RelationalDynamicSpeechAct;
  requested_facet: RelationalDynamicFacet | "invitation_response";
  answer_contract: RelationalDynamicAnswerContract;
  primary_subject: string | null;
  entity_set: string[];
};

export type RelationalDynamicSlots = {
  disclosed_object: string | null;
  disclosed_objects: string[];
  desired_role: string | null;
  proposed_raven_role: string | null;
  requested_direction: string | null;
  requested_protocol: string | null;
  service_style: string | null;
  desired_service_lanes: string[];
  intensity_preferences: string[];
  training_goals: string[];
  hard_limits: string[];
  boundary_preferences: string[];
  dynamic_goals: string[];
  user_preference: string | null;
  expectation: string | null;
  previous_ask_id: string | null;
  previous_ask_type: string | null;
  previous_ask_slots: string[];
  previous_ask_summary: string | null;
  previous_ask_example: string | null;
  clarification_recovery_used: boolean;
  proposal_target: string | null;
  invitation_or_proposal: boolean;
  boundary_or_safety_needed: boolean;
  follow_up_needed: boolean;
};

export type RelationalDynamicInterpretation = {
  eligible: boolean;
  speech_act: RelationalDynamicSpeechAct | null;
  requested_facet: RelationalDynamicFacet | null;
  answer_contract: RelationalDynamicAnswerContract | null;
  answer_mode:
    | "role_response"
    | "service_instruction"
    | "focused_dynamic_followup"
    | "protocol_suggestion"
    | "expectation_response"
    | "equipment_acknowledgement"
    | "dynamic_application_response"
    | "boundary_clarification"
    | "clarification_explanation"
    | "safety_framed_answer"
    | null;
  primary_subject: string | null;
  entity_set: string[];
  slots: RelationalDynamicSlots;
  components: RelationalDynamicComponent[];
  confidence: number;
  reason: string;
};

export type RelationalDynamicState = {
  proposed_user_role: string | null;
  proposed_raven_role: string | null;
  accepted_dynamic_yes_no_unknown: "yes" | "no" | "unknown";
  active_dynamic_topic: string | null;
  known_user_interests: string[];
  known_user_equipment: string[];
  known_user_service_preferences: string[];
  known_user_expectations: string[];
  pending_dynamic_question: string | null;
  boundaries_discussed_yes_no: "yes" | "no";
};

export type RelationalDynamicTrace = {
  relational_dynamic_handler_eligible: boolean;
  role_proposal_detected: boolean;
  service_request_detected: boolean;
  expectation_request_detected: boolean;
  protocol_setup_detected: boolean;
  equipment_disclosure_detected: boolean;
  extracted_slots: RelationalDynamicSlots;
  dynamic_state_update: Partial<RelationalDynamicState>;
  answer_contract_validation_result: {
    ok: boolean;
    reason: string;
  } | null;
  components: RelationalDynamicComponent[];
  compound_intent: boolean;
  compound_relational_slots: {
    desired_service_lanes: string[];
    intensity_preferences: string[];
    training_goals: string[];
    hard_limits: string[];
    boundary_preferences: string[];
    dynamic_goals: string[];
  };
  equipment_rejection_reason: string | null;
  rejected_handlers_and_reasons: Array<{ handler: string; reason: string }>;
};

export const EMPTY_RELATIONAL_DYNAMIC_SLOTS: RelationalDynamicSlots = {
  disclosed_object: null,
  disclosed_objects: [],
  desired_role: null,
  proposed_raven_role: null,
  requested_direction: null,
  requested_protocol: null,
  service_style: null,
  desired_service_lanes: [],
  intensity_preferences: [],
  training_goals: [],
  hard_limits: [],
  boundary_preferences: [],
  dynamic_goals: [],
  user_preference: null,
  expectation: null,
  previous_ask_id: null,
  previous_ask_type: null,
  previous_ask_slots: [],
  previous_ask_summary: null,
  previous_ask_example: null,
  clarification_recovery_used: false,
  proposal_target: null,
  invitation_or_proposal: false,
  boundary_or_safety_needed: false,
  follow_up_needed: false,
};

export const RELATIONAL_DYNAMIC_MODEL = {
  raven_role_stance: {
    default_role: "Raven can hold a dominant, directive role in conversation only.",
    commitment_boundary:
      "A proposed dynamic stays uncommitted until the user explicitly negotiates roles, limits, and expectations.",
  },
  possible_user_roles: [
    "submissive",
    "slave",
    "pet",
    "servant",
    "owned",
    "controlled",
  ],
  service_initiation_patterns: [
    "begin with one bounded instruction",
    "ask one setup question when limits or desired structure are missing",
    "avoid pretending a full dynamic already exists",
  ],
  expectation_patterns: [
    "attention",
    "honesty",
    "limits named clearly",
    "follow-through on small instructions",
    "permission before escalating intensity",
  ],
  protocol_setup_options: [
    "check-in rule",
    "permission rule",
    "task report rule",
    "limits-and-stop rule",
  ],
  dynamic_boundaries: [
    "conversation only unless a real local integration exists",
    "no real-world control is implied by tone",
    "no public or risky exposure is assumed",
    "limits and stop conditions come before escalation",
  ],
  unfamiliar_disclosure_handling: [
    "acknowledge the object or preference as disclosed",
    "avoid pretending to know the user's intended use",
    "ask one focused question about meaning, comfort, limits, or desired role",
  ],
};

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

function normalizeLower(text: string | null | undefined): string {
  return normalize(text).toLowerCase();
}

function cleanSlot(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = normalize(value)
    .replace(/^(?:a|an|the|my|your|to|for|with|about)\s+/i, "")
    .replace(/\b(?:please|raven)\b/gi, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  if (!cleaned || /^(?:it|that|this)(?:\b|$)|^(?:something|anything|you|me)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function isDynamicRoleSlot(value: string | null | undefined): boolean {
  const cleaned = cleanSlot(value);
  if (!cleaned) {
    return false;
  }
  return /\b(?:submissive|sub|slave|pet|servant|owned|controlled|mistress|dominant|domme|owner|handler)\b/i.test(
    cleaned,
  );
}

function hasRelationalDynamicMarker(text: string | null | undefined): boolean {
  return /\b(dynamic|mistress|submissive|slave|pet|owned|ownership|serve|service|obedien(?:ce|t)|rules?|tasks?|structure|protocol|permission|chastity|denial|exposure|collar|cuffs?|rope|plug|toy|gear|limits?|boundar(?:y|ies)|control|approval|strict|told what to do|accountability|correction|guidance)\b/i.test(
    normalizeLower(text),
  );
}

function isNonEquipmentRelationalGoal(value: string | null | undefined): boolean {
  const cleaned = normalizeLower(value);
  return /\b(?:tasks?|rules?|permission|approval|boundar(?:y|ies)|limits?|training|anal training|service|structure|accountability|correction|guidance|scat)\b/i.test(
    cleaned,
  );
}

function isEquipmentLikeObject(value: string | null | undefined): boolean {
  const cleaned = normalizeLower(value);
  return /\b(?:cage|chastity cage|plug|butt plug|collar|cuffs?|rope|toy|toys|remote toy|strap-?on|strapon|restraints?|leash|gear|device|dildos?|wand|vibrator|harness|lock|things)\b/i.test(
    cleaned,
  );
}

function hasActiveTrainingContext(text: string | null | undefined): boolean {
  return /\b(training|anal control|paced anal|slow anal hold|bondage discipline|obedience training|proof|pressure|main focus|next round|same line|other angle|control instead of noise|line cleaner)\b/i.test(
    normalizeLower(text),
  );
}

function hasExplicitRelationalDynamicIntent(text: string | null | undefined): boolean {
  return /\b(mistress|submissive|slave|owned|ownership|serve|service|dynamic|approval|permission rules?|protocol|what would please you|what do you want from me|chastity cage)\b/i.test(
    normalizeLower(text),
  );
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = cleanSlot(value)?.toLowerCase();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
  }
  return output;
}

function splitObjectList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const normalized = normalize(value)
    .replace(/\bhow\s+(?:would|do|should)\s+(?:you|u|i)\b[\s\S]*$/i, "")
    .replace(/\b(?:would|should|could|can)\s+(?:you|u|i)\b[\s\S]*$/i, "")
    .replace(/\b(?:as well|too|also)\b/gi, "")
    .replace(/\bthat\s+i\s+can\s+use\s+to\s+serv(?:e|ing|er)\s+better\b/gi, "")
    .replace(/\bthat\s+(?:could|would|can)\s+help\s+me\s+serv(?:e|ing|er)\s+better\b/gi, "")
    .replace(/\bthat\s+i\s+can\s+use\b/gi, "")
    .replace(/\bto\s+serv(?:e|ing|er)\s+better\b/gi, "");
  return unique(
    normalized
      .split(/\s*(?:,|;|\band\b|\+)\s*/i)
      .map((part) => cleanSlot(part))
      .filter((part): part is string => Boolean(part)),
  );
}

function hasDynamicContext(input: {
  normalized: string;
  previousAssistantText?: string | null;
  previousUserText?: string | null;
  currentTopic?: string | null;
}): boolean {
  const haystack = normalizeLower(
    `${input.normalized} ${input.previousAssistantText ?? ""} ${input.previousUserText ?? ""} ${input.currentTopic ?? ""}`,
  );
  return hasRelationalDynamicMarker(haystack);
}

function extractObjectDisclosure(normalized: string): string | null {
  const match =
    normalized.match(/\bi\s+(?:have|own|got|have got|bought|ordered|wear|use)\s+(?:a|an|the|my)?\s*([^?.!,]{2,80})/i)?.[1] ??
    normalized.match(/\bmy\s+([^?.!,]{2,80})\s+(?:is|arrived|came)\b/i)?.[1] ??
    null;
  return cleanSlot(match);
}

function extractObjectDisclosures(normalized: string): string[] {
  const match =
    normalized.match(/\bi\s+(?:have|own|got|have got|bought|ordered|wear|use)\s+((?:a|an|the|my)\s+)?([^?.!]{2,160})/i)?.[2] ??
    normalized.match(/\bmy\s+([^?.!]{2,160})\s+(?:is|arrived|came)\b/i)?.[1] ??
    null;
  const objects = splitObjectList(match).filter(
    (object) => isEquipmentLikeObject(object) || !isNonEquipmentRelationalGoal(object),
  );
  if (objects.length > 0) {
    return objects;
  }
  const single = extractObjectDisclosure(normalized);
  return single ? [single] : [];
}

function extractDesiredServiceLanes(normalized: string): string[] {
  const lanes: string[] = [];
  if (/\btasks?\b/i.test(normalized)) lanes.push("tasks");
  if (/\brules?\b/i.test(normalized)) lanes.push(/\bpermission rules?\b/i.test(normalized) ? "permission rules" : "rules");
  if (/\bpermission\b/i.test(normalized) && !lanes.includes("permission rules")) lanes.push("permission");
  if (/\bapproval\b/i.test(normalized)) lanes.push("approval");
  return unique(lanes);
}

function extractIntensityPreferences(normalized: string): string[] {
  const preferences: string[] = [];
  if (/\bboundar(?:y|ies)\s+pushed\b|\bpush(?:ed)?\s+my\s+boundar(?:y|ies)\b/i.test(normalized)) {
    preferences.push("boundaries pushed");
  }
  if (/\bstrict(?:er|ness)?\b/i.test(normalized)) {
    preferences.push("strictness");
  }
  return unique(preferences);
}

function extractTrainingGoals(normalized: string): string[] {
  const goals: string[] = [];
  const explicit = normalized.match(/\b(?:have|do|want|wanting|include|get)\s+([^?.!,;]{0,40}\btraining\b)/gi) ?? [];
  for (const value of explicit) {
    const cleaned = cleanSlot(value.replace(/^(?:have|do|want|wanting|include|get)\s+/i, ""));
    if (cleaned) goals.push(cleaned);
  }
  const direct = normalized.match(/\b(?:anal|oral|obedience|bondage|service)\s+training\b/gi) ?? [];
  for (const value of direct) {
    goals.push(value);
  }
  return unique(goals);
}

function extractHardLimits(normalized: string): string[] {
  const limits: string[] = [];
  const limit =
    normalized.match(/\b(?:hard\s+)?limit\s+(?:is|=)\s+([^?.!,;]{2,80})/i)?.[1] ??
    normalized.match(/\bwith\s+([^?.!,;]{2,50})\s+as\s+(?:a\s+)?(?:hard\s+)?limit\b/i)?.[1] ??
    null;
  const noLimits = normalized.match(/\b(?:but\s+)?no\s+([^?.!,;]{2,50})/gi) ?? [];
  if (limit) limits.push(...splitObjectList(limit));
  for (const value of noLimits) {
    const cleaned = cleanSlot(value.replace(/^but\s+no\s+|^no\s+/i, ""));
    if (cleaned) limits.push(cleaned);
  }
  return unique(limits);
}

function extractBoundaryPreferences(normalized: string): string[] {
  const preferences: string[] = [];
  if (/\bboundar(?:y|ies)\s+pushed\b|\bpush(?:ed)?\s+my\s+boundar(?:y|ies)\b/i.test(normalized)) {
    preferences.push("boundaries pushed");
  }
  if (/\b(?:hard\s+)?limit\b|\bbut\s+no\b/i.test(normalized)) {
    preferences.push("hard limits named");
  }
  return unique(preferences);
}

function extractDynamicGoals(normalized: string): string[] {
  const goals: string[] = [];
  if (/\bearn\s+(?:your\s+)?approval\b/i.test(normalized)) goals.push("earn approval");
  if (/\bserve\s+(?:you|u)\b|\bservice\b/i.test(normalized)) goals.push("serve");
  if (/\btraining\b/i.test(normalized)) goals.push("training");
  return unique(goals);
}

function extractCompoundRelationalDisclosure(normalized: string): {
  desired_service_lanes: string[];
  intensity_preferences: string[];
  training_goals: string[];
  hard_limits: string[];
  boundary_preferences: string[];
  dynamic_goals: string[];
} | null {
  const desired_service_lanes = extractDesiredServiceLanes(normalized);
  const intensity_preferences = extractIntensityPreferences(normalized);
  const training_goals = extractTrainingGoals(normalized);
  const hard_limits = extractHardLimits(normalized);
  const boundary_preferences = extractBoundaryPreferences(normalized);
  const dynamic_goals = extractDynamicGoals(normalized);
  const hasGoalDisclosure =
    /\bi\s+(?:want|need|like)\b/i.test(normalized) ||
    /\bmy\s+(?:hard\s+)?limit\s+is\b/i.test(normalized) ||
    /\bbut\s+no\b/i.test(normalized);
  const populated =
    desired_service_lanes.length +
    intensity_preferences.length +
    training_goals.length +
    hard_limits.length +
    boundary_preferences.length +
    dynamic_goals.length;
  const nonServicePopulated =
    intensity_preferences.length +
    training_goals.length +
    hard_limits.length +
    boundary_preferences.length +
    dynamic_goals.length;
  const hasBoundaryOrTraining =
    intensity_preferences.length > 0 ||
    training_goals.length > 0 ||
    hard_limits.length > 0 ||
    boundary_preferences.length > 0;
  const hasConcreteServiceGoal =
    dynamic_goals.length > 0 &&
    desired_service_lanes.some((lane) => lane === "tasks" || lane.includes("rules")) &&
    /\b(?:through|via|with|by)\b/i.test(normalized);
  const looksLikeTaskExclusion =
    hard_limits.some((limit) => /\b(?:stillness|posture|hands?|kneeling|frame)\b/i.test(limit)) &&
    training_goals.length === 0 &&
    intensity_preferences.length === 0 &&
    dynamic_goals.length === 0 &&
    !/\b(?:anal|training|boundar(?:y|ies)|scat|permission|approval|mistress|submissive|serve|service)\b/i.test(
      normalized,
    );
  if (
    !hasGoalDisclosure ||
    populated < 2 ||
    (desired_service_lanes.length > 0 && nonServicePopulated === 0) ||
    (!hasBoundaryOrTraining && !hasConcreteServiceGoal) ||
    looksLikeTaskExclusion
  ) {
    return null;
  }
  return {
    desired_service_lanes,
    intensity_preferences,
    training_goals,
    hard_limits,
    boundary_preferences,
    dynamic_goals,
  };
}

function hasUseInvitation(normalized: string): boolean {
  return /\b(?:would|do)\s+(?:you|u)\s+(?:like|want)\s+me\s+to\s+use\b|\bshould\s+i\s+use\b|\bhow\s+(?:would|do)\s+(?:you|u)\s+want\s+(?:them|it|that|those|[^?.!,]{2,60})\s+used\b/i.test(
    normalized,
  );
}

function component(input: {
  speech_act: RelationalDynamicSpeechAct;
  requested_facet: RelationalDynamicFacet | "invitation_response";
  answer_contract?: RelationalDynamicAnswerContract;
  primary_subject: string | null;
  entity_set?: string[];
}): RelationalDynamicComponent {
  return {
    speech_act: input.speech_act,
    requested_facet: input.requested_facet,
    answer_contract:
      input.answer_contract ??
      (input.requested_facet === "invitation_response"
        ? "answer_invitation_or_boundary"
        : input.requested_facet),
    primary_subject: input.primary_subject,
    entity_set: unique([input.primary_subject, ...(input.entity_set ?? [])]),
  };
}

function extractRoleProposal(normalized: string): {
  userRole: string | null;
  ravenRole: string | null;
  subject: string | null;
} {
  const paired =
    normalized.match(
      /\bi\s+want\s+to\s+be\s+(?:your|a|an)?\s*([^?.!,]{2,50}?)\s+and\s+(?:you|u)\s+(?:to\s+be\s+)?(?:my|a|an)?\s*([^?.!,]{2,50})/i,
    ) ??
    normalized.match(
      /\bi\s+want\s+this\s+to\s+be\s+(?:a|an)?\s*([^?.!,]{2,50}?)\s*\/\s*([^?.!,]{2,50}?)\s+dynamic/i,
    );
  if (paired) {
    const userRole = isDynamicRoleSlot(paired[1]) ? cleanSlot(paired[1]) : null;
    const ravenRole = isDynamicRoleSlot(paired[2]) ? cleanSlot(paired[2]) : null;
    return {
      userRole,
      ravenRole,
      subject: unique([userRole, ravenRole]).join(" / ") || null,
    };
  }
  const userRole =
    normalized.match(/\bcan\s+i\s+be\s+(?:your|a|an)?\s*([^?.!,]{2,50})/i)?.[1] ??
    normalized.match(/\bi\s+want\s+to\s+be\s+(?:your|a|an)?\s*([^?.!,]{2,50})/i)?.[1] ??
    normalized.match(/\bi\s+want\s+to\s+be\s+(owned|controlled)\b/i)?.[1] ??
    null;
  const ravenRole =
    normalized.match(/\bi\s+want\s+(?:you|u)\s+to\s+be\s+(?:my|a|an)?\s*([^?.!,]{2,50})/i)?.[1] ??
    normalized.match(/\b(?:you|u)\s+(?:my|as my|to be my)\s+([^?.!,]{2,50})/i)?.[1] ??
    null;
  const cleanedUserRole = isDynamicRoleSlot(userRole)
    ? cleanSlot(userRole)?.replace(/\bowned by you\b/i, "owned by me") ?? null
    : null;
  const cleanedRavenRole = isDynamicRoleSlot(ravenRole) ? cleanSlot(ravenRole) : null;
  return {
    userRole: cleanedUserRole,
    ravenRole: cleanedRavenRole,
    subject: unique([cleanedUserRole, cleanedRavenRole]).join(" / ") || cleanedUserRole || cleanedRavenRole,
  };
}

function extractServiceStyle(normalized: string): string | null {
  const match =
    normalized.match(/\b(?:by|through|with)\s+([^?.!,]{2,80}\b(?:rules|tasks|obedience|check-ins|permission|denial|praise|discipline|structure|approval|accountability)[^?.!,]*)/i)?.[1] ??
    normalized.match(/\b(?:rules|tasks|obedience|check-ins|permission|denial|praise|discipline|structure|approval|accountability)\b[^?.!,]*/i)?.[0] ??
    null;
  return cleanSlot(match);
}

function extractExpectation(normalized: string): string | null {
  const match =
    normalized.match(/\bwhat\s+(?:do|would)\s+you\s+expect\s+(?:from|of)\s+me(?:\s+as\s+([^?.!,]+))?/i)?.[1] ??
    normalized.match(/\b(?:i\s+(?:want|need)\s+you\s+to\s+be|be)\s+([^?.!,]{2,80}\b(?:strict|consistent|attentive|controlling|clear|firm)[^?.!,]*)/i)?.[1] ??
    normalized.match(/\bi\s+(?:want|need)\s+([^?.!,]{2,80}\b(?:structure|control|attention|correction|permission|ownership|guidance|approval)[^?.!,]*)/i)?.[1] ??
    null;
  return cleanSlot(match);
}

function extractProtocol(normalized: string): string | null {
  const match =
    normalized.match(/\b(?:set up|make|create|give me|can we have|let'?s use)\s+(?:a|an|some)?\s*([^?.!,]{2,90}\b(?:protocol|rule|rules|check-ins?|permission|report|reports|routine|structure)[^?.!,]*)/i)?.[1] ??
    normalized.match(/\b(?:protocol|permission rule|reporting rule)\b[^?.!,]*/i)?.[0] ??
    null;
  return cleanSlot(match);
}

function extractPreferenceDisclosure(normalized: string): string | null {
  const match =
    normalized.match(/\bi\s+(?:like|love|enjoy|am into|i'?m into)\s+([^?.!,]{2,100})/i)?.[1] ??
    normalized.match(/\bi\s+(?:want|need)\s+(?:you|u)\s+to\s+be\s+([^?.!,]{2,100})/i)?.[1] ??
    normalized.match(/\bi\s+(?:want|need)\s+((?:rules|tasks|structure|approval|permission|denial|control|guidance|correction|strictness|accountability)(?:\s+[^?.!,]{0,80})?)/i)?.[1] ??
    normalized.match(/\bi\s+(?:want|need)\s+([^?.!,]{2,100}\b(?:rules|tasks|structure|approval|permission|denial|control|guidance|correction|strict)[^?.!,]*)/i)?.[1] ??
    null;
  return cleanSlot(match);
}

function dynamicAnswerMode(facet: RelationalDynamicFacet): RelationalDynamicInterpretation["answer_mode"] {
  switch (facet) {
    case "role_negotiation":
      return "role_response";
    case "service_initiation":
    case "service_direction":
      return "service_instruction";
    case "expectations":
      return "expectation_response";
    case "protocol_setup":
      return "protocol_suggestion";
    case "clarification_recovery":
      return "clarification_explanation";
    case "equipment_disclosure":
      return "equipment_acknowledgement";
    case "dynamic_application":
      return "dynamic_application_response";
    case "ambiguous_boundary_topic":
      return "boundary_clarification";
    case "safety_or_limits_discussion":
      return "safety_framed_answer";
    default:
      return "focused_dynamic_followup";
  }
}

function interpretation(input: {
  speech_act: RelationalDynamicSpeechAct;
  requested_facet: RelationalDynamicFacet;
  answer_contract?: RelationalDynamicAnswerContract;
  answer_mode?: RelationalDynamicInterpretation["answer_mode"];
  primary_subject: string | null;
  slots?: Partial<RelationalDynamicSlots>;
  entity_set?: string[];
  components?: RelationalDynamicComponent[];
  confidence: number;
  reason: string;
}): RelationalDynamicInterpretation {
  const slots = { ...EMPTY_RELATIONAL_DYNAMIC_SLOTS, ...(input.slots ?? {}) };
  const disclosedObjects = slots.disclosed_objects.length > 0
    ? slots.disclosed_objects
    : slots.disclosed_object
      ? [slots.disclosed_object]
      : [];
  const normalizedSlots = {
    ...slots,
    disclosed_object: slots.disclosed_object ?? disclosedObjects[0] ?? null,
    disclosed_objects: disclosedObjects,
  };
  return {
    eligible: true,
    speech_act: input.speech_act,
    requested_facet: input.requested_facet,
    answer_contract: input.answer_contract ?? input.requested_facet,
    answer_mode: input.answer_mode ?? dynamicAnswerMode(input.requested_facet),
    primary_subject: input.primary_subject,
    entity_set: unique([input.primary_subject, ...(input.entity_set ?? [])]),
    slots: normalizedSlots,
    components:
      input.components ??
      [
        component({
          speech_act: input.speech_act,
          requested_facet: input.requested_facet,
          answer_contract: input.answer_contract,
          primary_subject: input.primary_subject,
          entity_set: input.entity_set,
        }),
      ],
    confidence: input.confidence,
    reason: input.reason,
  };
}

export function classifyRelationalDynamicTurn(input: {
  text: string;
  previousAssistantText?: string | null;
  previousUserText?: string | null;
  currentTopic?: string | null;
}): RelationalDynamicInterpretation {
  const normalized = normalizeLower(input.text);
  if (!normalized) {
    return {
      eligible: false,
      speech_act: null,
      requested_facet: null,
      answer_contract: null,
      answer_mode: null,
      primary_subject: null,
      entity_set: [],
      slots: EMPTY_RELATIONAL_DYNAMIC_SLOTS,
      components: [],
      confidence: 0,
      reason: "empty_text",
    };
  }
  const context = hasDynamicContext({ normalized, ...input });
  if (
    /\bwhat\s+if\s+i\s+(?:use|used|wear|wore|add|added)\b[^?.!]{0,120}\binstead\b/i.test(normalized) &&
    !hasExplicitRelationalDynamicIntent(normalized)
  ) {
    return {
      eligible: false,
      speech_act: null,
      requested_facet: null,
      answer_contract: null,
      answer_mode: null,
      primary_subject: null,
      entity_set: [],
      slots: EMPTY_RELATIONAL_DYNAMIC_SLOTS,
      components: [],
      confidence: 0,
      reason: "training_or_task_substitution_question_without_explicit_relational_dynamic_intent",
    };
  }
  if (
    hasActiveTrainingContext(`${input.previousAssistantText ?? ""} ${input.currentTopic ?? ""}`) &&
    !hasExplicitRelationalDynamicIntent(normalized)
  ) {
    return {
      eligible: false,
      speech_act: null,
      requested_facet: null,
      answer_contract: null,
      answer_mode: null,
      primary_subject: null,
      entity_set: [],
      slots: EMPTY_RELATIONAL_DYNAMIC_SLOTS,
      components: [],
      confidence: 0,
      reason: "active_training_context_without_explicit_relational_dynamic_intent",
    };
  }
  const compoundDisclosure = extractCompoundRelationalDisclosure(normalized);
  if (compoundDisclosure) {
    const subject = unique([
      ...compoundDisclosure.desired_service_lanes,
      ...compoundDisclosure.intensity_preferences,
      ...compoundDisclosure.training_goals,
      ...compoundDisclosure.hard_limits.map((limit) => `${limit} limit`),
      ...compoundDisclosure.dynamic_goals,
    ]).join(", ");
    return interpretation({
      speech_act: "compound_relational_disclosure",
      requested_facet: "compound_relational_disclosure",
      answer_contract: "compound_relational_disclosure",
      answer_mode: "focused_dynamic_followup",
      primary_subject: subject || "compound relational disclosure",
      entity_set: unique([
        ...compoundDisclosure.desired_service_lanes,
        ...compoundDisclosure.intensity_preferences,
        ...compoundDisclosure.training_goals,
        ...compoundDisclosure.hard_limits,
        ...compoundDisclosure.boundary_preferences,
        ...compoundDisclosure.dynamic_goals,
      ]),
      slots: {
        ...compoundDisclosure,
        service_style: compoundDisclosure.desired_service_lanes.join(", ") || null,
        user_preference: subject || null,
        expectation: compoundDisclosure.intensity_preferences.join(", ") || null,
        boundary_or_safety_needed: compoundDisclosure.hard_limits.length > 0 || compoundDisclosure.boundary_preferences.length > 0,
        follow_up_needed: false,
      },
      components: [
        component({
          speech_act: "service_preference_disclosure",
          requested_facet: "service_preference",
          primary_subject: compoundDisclosure.desired_service_lanes.join(", ") || "service lane",
          entity_set: compoundDisclosure.desired_service_lanes,
        }),
        component({
          speech_act: "user_preference_disclosure",
          requested_facet: "compound_relational_disclosure",
          answer_contract: "compound_relational_disclosure",
          primary_subject: subject || "relational goals and limits",
          entity_set: compoundDisclosure.training_goals,
        }),
        component({
          speech_act: "boundary_or_safety_topic",
          requested_facet: "safety_or_limits_discussion",
          primary_subject: compoundDisclosure.hard_limits.join(", ") || "limits",
          entity_set: compoundDisclosure.hard_limits,
        }),
      ],
      confidence: 0.9,
      reason: "compound relational disclosure with service goals training and limits",
    });
  }
  const disclosedObjects = extractObjectDisclosures(normalized);
  const disclosedObject = disclosedObjects[0] ?? extractObjectDisclosure(normalized);
  if (
    disclosedObject &&
    hasUseInvitation(normalized) &&
    (context ||
      /\b(?:gear|toy|toys|device|cage|collar|leash|cuffs?|rope|plug|strap|wand|vibrator|harness|lock|restraints?|dildos?|things)\b/i.test(
        disclosedObjects.join(" "),
      ))
  ) {
    const subject = disclosedObjects.length > 1 ? disclosedObjects.join(", ") : disclosedObject;
    return interpretation({
      speech_act: "user_equipment_disclosure",
      requested_facet: "equipment_disclosure",
      answer_contract: "compound_equipment_application",
      answer_mode: "dynamic_application_response",
      primary_subject: subject,
      entity_set: disclosedObjects,
      slots: {
        disclosed_object: disclosedObject,
        disclosed_objects: disclosedObjects.length > 0 ? disclosedObjects : [disclosedObject],
        proposal_target: "use_in_dynamic",
        invitation_or_proposal: true,
        requested_direction: "whether and how to use disclosed equipment",
        follow_up_needed: false,
        boundary_or_safety_needed: true,
      },
      components: [
        component({
          speech_act: "user_equipment_disclosure",
          requested_facet: "equipment_disclosure",
          primary_subject: subject,
          entity_set: disclosedObjects,
        }),
        component({
          speech_act: "dynamic_application_request",
          requested_facet: "dynamic_application",
          primary_subject: subject,
          entity_set: disclosedObjects,
        }),
        component({
          speech_act: "request_for_direction",
          requested_facet: "invitation_response",
          answer_contract: "answer_invitation_or_boundary",
          primary_subject: "whether Raven wants the equipment used",
          entity_set: disclosedObjects,
        }),
      ],
      confidence: 0.91,
      reason: "compound equipment disclosure plus use invitation",
    });
  }
  const role = extractRoleProposal(normalized);
  if (
    role.userRole ||
    role.ravenRole ||
    /\b(?:mistress|submissive|slave|pet|owned|controlled)\s+dynamic\b/i.test(normalized)
  ) {
    return interpretation({
      speech_act: "role_proposal",
      requested_facet: "role_negotiation",
      primary_subject: role.subject ?? "proposed dynamic roles",
      slots: {
        desired_role: role.userRole,
        proposed_raven_role: role.ravenRole,
        follow_up_needed: true,
        boundary_or_safety_needed: true,
      },
      confidence: 0.92,
      reason: "explicit role or dynamic proposal",
    });
  }
  if (
    /\bwhat\s+can\s+my\s+role\s+be\b/i.test(normalized) ||
    /\bwhat\s+role\s+can\s+i\s+have\b/i.test(normalized) ||
    /\bwhat\s+role\s+(?:should\s+i\s+take|would\s+(?:you|u)\s+give\s+me)\b/i.test(normalized) ||
    /\bhow\s+would\s+(?:you|u)\s+see\s+my\s+role\b/i.test(normalized) ||
    /\bwhat\s+kind\s+of\s+submissive\s+role\s+fits\s+here\b/i.test(normalized)
  ) {
    return interpretation({
      speech_act: "role_proposal",
      requested_facet: "role_negotiation",
      primary_subject: "role guidance",
      slots: {
        desired_role: "submissive",
        proposed_raven_role: "mistress",
        follow_up_needed: true,
        boundary_or_safety_needed: true,
      },
      confidence: 0.88,
      reason: "role guidance question",
    });
  }
  if (
    /\bhow\s+(?:can|do|could|should)\s+i\s+(?:start|begin)?\s*(?:serv(?:e|ing)|please|be useful)(?:\s+(?:you|u))?\b/i.test(
      normalized,
    ) ||
    /\bwhat\s+should\s+i\s+do\s+first\s+for\s+(?:you|u)\b/i.test(normalized) ||
    /\bwhat\s+should\s+i\s+do\s+first\b/i.test(normalized) ||
    /\bhow\s+do\s+(?:you|u)\s+want\s+me\s+to\s+serv(?:e|ing)\b/i.test(normalized) ||
    /\bi\s+want\s+to\s+serv(?:e|ing)\b/i.test(normalized)
  ) {
    const serviceStyle = extractServiceStyle(normalized);
    return interpretation({
      speech_act: "service_request",
      requested_facet: "service_initiation",
      primary_subject: serviceStyle ?? "service initiation",
      slots: {
        requested_direction: "begin serving",
        service_style: serviceStyle,
        follow_up_needed: false,
        boundary_or_safety_needed: true,
      },
      confidence: 0.9,
      reason: "assistant-facing service initiation request",
    });
  }
  if (
    /\bwhat\s+(?:would|do|can)\s+(?:you|u)\s+(?:like|want)\s+(?:me\s+)?(?:to\s+do|from me)(?:\s+for\s+(?:you|u))?\b/i.test(
      normalized,
    ) ||
    /\bwhat\s+things\s+can\s+i\s+do\s+to\s+serv(?:e|ing)\s+(?:you|u)\s+now\b/i.test(normalized) ||
    /\bwhat\s+can\s+i\s+do\s+to\s+serv(?:e|ing)\s+(?:you|u)\b/i.test(normalized) ||
    /\bwhat\s+should\s+i\s+do\s+for\s+(?:you|u)\b/i.test(normalized) ||
    /\bwhat\s+would\s+please\s+(?:you|u)\b/i.test(normalized) ||
    /\bwhat\s+do\s+(?:you|u)\s+want\s+from\s+me\b/i.test(normalized)
  ) {
    return interpretation({
      speech_act: "request_for_direction",
      requested_facet: "service_direction",
      primary_subject: "assistant-facing service direction",
      slots: {
        requested_direction: "what Raven wants from the user",
        boundary_or_safety_needed: true,
      },
      confidence: 0.9,
      reason: "assistant-facing request for direction",
    });
  }
  if (
    /\b(?:tell|show)\s+me\b.*\bhow\s+(?:you|u)\s+want\s+(?:them|it|that|those|the(?:se)?\s+[^?.!,]{2,60})\s+used\b/i.test(
      normalized,
    ) ||
    /\bhow\s+(?:do|would)\s+(?:you|u)\s+want\s+(?:me\s+to\s+)?use\s+(?:them|it|that|those)\b/i.test(normalized)
  ) {
    const priorObjects = extractObjectDisclosures(input.previousUserText ?? input.previousAssistantText ?? "");
    const subject = priorObjects.length > 0 ? priorObjects.join(", ") : "disclosed equipment";
    return interpretation({
      speech_act: "dynamic_application_request",
      requested_facet: "dynamic_application",
      primary_subject: subject,
      entity_set: priorObjects,
      slots: {
        requested_direction: "how Raven wants the disclosed equipment used",
        user_preference: subject,
        disclosed_object: priorObjects[0] ?? null,
        disclosed_objects: priorObjects,
        boundary_or_safety_needed: true,
      },
      confidence: 0.86,
      reason: "request asks how disclosed equipment should be used in the dynamic",
    });
  }
  const protocol = extractProtocol(normalized);
  if (protocol && context) {
    return interpretation({
      speech_act: "protocol_setup_request",
      requested_facet: "protocol_setup",
      primary_subject: protocol,
      slots: {
        requested_protocol: protocol,
        boundary_or_safety_needed: true,
      },
      confidence: 0.86,
      reason: "protocol or rule setup request",
    });
  }
  if (
    /\bwhat\s+(?:do|would)\s+(?:you|u)\s+expect\b/i.test(normalized) ||
    /\bdo\s+(?:you|u)\s+like\s+having\s+(?:your\s+)?([^?.!,]{2,80})\b/i.test(normalized)
  ) {
    const expectation =
      extractExpectation(normalized) ??
      cleanSlot(normalized.match(/\bdo\s+(?:you|u)\s+like\s+having\s+(?:your\s+)?([^?.!,]{2,80})\b/i)?.[1]);
    return interpretation({
      speech_act: "expectation_request",
      requested_facet: "expectations",
      primary_subject: expectation ?? "dynamic expectations",
      slots: {
        expectation,
        desired_role: cleanSlot(expectation?.match(/\b(slaves?|subs?|submissives?|pets?|servants?)\b/i)?.[1]),
        disclosed_object: cleanSlot(expectation?.match(/\bin\s+([^?.!,]{2,40})/i)?.[1]),
        boundary_or_safety_needed: true,
      },
      confidence: 0.86,
      reason: "dynamic expectation request",
    });
  }
  const objects = disclosedObjects;
  const object = disclosedObject;
  if (object && (context || /\b(?:gear|toy|device|cage|collar|cuffs?|rope|plug|strap|wand|vibrator|harness|lock|restraints?|dildos?|things)\b/i.test(objects.join(" ")))) {
    return interpretation({
      speech_act: /\bi\s+(?:can|know how to|am able to|'?m able to)\b/i.test(normalized) &&
        !/\bi\s+(?:have|own|got|have got|bought|ordered|wear|use)\b/i.test(normalized)
        ? "user_capability_disclosure"
        : "user_equipment_disclosure",
      requested_facet: "equipment_disclosure",
      primary_subject: objects.length > 1 ? objects.join(", ") : object,
      entity_set: objects,
      slots: {
        disclosed_object: object,
        disclosed_objects: objects.length > 0 ? objects : [object],
        follow_up_needed: true,
        boundary_or_safety_needed: true,
      },
      confidence: 0.84,
      reason: "first-person equipment or capability disclosure",
    });
  }
  const preference = extractPreferenceDisclosure(normalized);
  if (preference && (hasRelationalDynamicMarker(preference) || hasRelationalDynamicMarker(normalized))) {
    const serviceStyle = extractServiceStyle(normalized);
    const expectation = extractExpectation(normalized);
    return interpretation({
      speech_act: serviceStyle ? "service_preference_disclosure" : "user_preference_disclosure",
      requested_facet: serviceStyle ? "service_preference" : "user_preference",
      primary_subject: serviceStyle ?? expectation ?? preference,
      slots: {
        user_preference: preference,
        service_style: serviceStyle,
        expectation,
        follow_up_needed: true,
        boundary_or_safety_needed: /\b(?:exposure|public|humiliation|denial|chastity|pain|punish)\b/i.test(
          preference,
        ),
      },
      confidence: 0.82,
      reason: "user disclosed a dynamic preference or service style",
    });
  }
  if (
    /\bhow\s+(?:can|could|would|do)\s+(?:we|you|u)\s+(?:use|include|apply|incorporate|work)\b/i.test(
      normalized,
    )
  ) {
    const subject =
      cleanSlot(normalized.match(/\b(?:use|include|apply|incorporate|work)\s+([^?.!,]{2,80})/i)?.[1]) ??
      cleanSlot(input.currentTopic) ??
      "that dynamic element";
    return interpretation({
      speech_act: "dynamic_application_request",
      requested_facet: "dynamic_application",
      primary_subject: subject,
      slots: {
        user_preference: subject,
        boundary_or_safety_needed: true,
      },
      confidence: 0.82,
      reason: "request asks how to apply a disclosed element in the dynamic",
    });
  }
  if (
    /\b(?:limits?|boundar(?:y|ies)|safe(?:ty)?|stop|safeword|too far|public|exposure|exposed)\b/i.test(
      normalized,
    ) &&
    /\b(?:what do you think|are you into|how do you feel|should we|can we|would you)\b/i.test(normalized)
  ) {
    const subject =
      cleanSlot(
        normalized.match(/\b(?:what do you think about|are you into|how do you feel about)\s+([^?.!,]{2,80})/i)?.[1],
      ) ?? "boundary topic";
    return interpretation({
      speech_act: /\b(?:limits?|boundar(?:y|ies)|safe(?:ty)?|stop|safeword)\b/i.test(normalized)
        ? "boundary_or_safety_topic"
        : "ambiguous_dynamic_topic",
      requested_facet: /\b(?:limits?|boundar(?:y|ies)|safe(?:ty)?|stop|safeword)\b/i.test(normalized)
        ? "safety_or_limits_discussion"
        : "ambiguous_boundary_topic",
      primary_subject: subject,
      slots: {
        user_preference: subject,
        boundary_or_safety_needed: true,
        follow_up_needed: true,
      },
      confidence: 0.82,
      reason: "ambiguous or safety-relevant dynamic topic",
    });
  }

  return {
    eligible: false,
    speech_act: null,
    requested_facet: null,
    answer_contract: null,
    answer_mode: null,
    primary_subject: null,
    entity_set: [],
    slots: EMPTY_RELATIONAL_DYNAMIC_SLOTS,
    components: [],
    confidence: 0,
    reason: "no_relational_dynamic_pattern",
  };
}

export function createRelationalDynamicState(): RelationalDynamicState {
  return {
    proposed_user_role: null,
    proposed_raven_role: null,
    accepted_dynamic_yes_no_unknown: "unknown",
    active_dynamic_topic: null,
    known_user_interests: [],
    known_user_equipment: [],
    known_user_service_preferences: [],
    known_user_expectations: [],
    pending_dynamic_question: null,
    boundaries_discussed_yes_no: "no",
  };
}

export function normalizeRelationalDynamicState(value: unknown): RelationalDynamicState {
  const base = createRelationalDynamicState();
  if (!value || typeof value !== "object") {
    return base;
  }
  const raw = value as Partial<RelationalDynamicState>;
  const list = (items: unknown): string[] =>
    Array.isArray(items) ? unique(items.filter((item): item is string => typeof item === "string")) : [];
  return {
    proposed_user_role:
      typeof raw.proposed_user_role === "string" ? cleanSlot(raw.proposed_user_role) : null,
    proposed_raven_role:
      typeof raw.proposed_raven_role === "string" ? cleanSlot(raw.proposed_raven_role) : null,
    accepted_dynamic_yes_no_unknown:
      raw.accepted_dynamic_yes_no_unknown === "yes" || raw.accepted_dynamic_yes_no_unknown === "no"
        ? raw.accepted_dynamic_yes_no_unknown
        : "unknown",
    active_dynamic_topic:
      typeof raw.active_dynamic_topic === "string" ? cleanSlot(raw.active_dynamic_topic) : null,
    known_user_interests: list(raw.known_user_interests),
    known_user_equipment: list(raw.known_user_equipment),
    known_user_service_preferences: list(raw.known_user_service_preferences),
    known_user_expectations: list(raw.known_user_expectations),
    pending_dynamic_question:
      typeof raw.pending_dynamic_question === "string" ? cleanSlot(raw.pending_dynamic_question) : null,
    boundaries_discussed_yes_no: raw.boundaries_discussed_yes_no === "yes" ? "yes" : "no",
  };
}

export function dynamicStateUpdateForInterpretation(
  interpretationResult: RelationalDynamicInterpretation | null | undefined,
): Partial<RelationalDynamicState> {
  if (!interpretationResult?.eligible) {
    return {};
  }
  const slots = interpretationResult.slots;
  const update: Partial<RelationalDynamicState> = {
    active_dynamic_topic: interpretationResult.primary_subject,
  };
  if (slots.desired_role) {
    update.proposed_user_role = slots.desired_role;
  }
  if (slots.proposed_raven_role) {
    update.proposed_raven_role = slots.proposed_raven_role;
  }
  if (interpretationResult.speech_act === "role_proposal") {
    update.accepted_dynamic_yes_no_unknown = "unknown";
  }
  if (slots.disclosed_objects.length > 0 || slots.disclosed_object) {
    update.known_user_equipment =
      slots.disclosed_objects.length > 0 ? slots.disclosed_objects : [slots.disclosed_object!];
  }
  if (slots.service_style) {
    update.known_user_service_preferences = [slots.service_style];
  }
  if (slots.user_preference) {
    update.known_user_interests = [slots.user_preference];
  }
  if (slots.expectation) {
    update.known_user_expectations = [slots.expectation];
  }
  if (slots.follow_up_needed) {
    update.pending_dynamic_question = interpretationResult.primary_subject;
  }
  if (slots.boundary_or_safety_needed) {
    update.boundaries_discussed_yes_no = "yes";
  }
  return update;
}

export function applyRelationalDynamicStateUpdate(
  state: RelationalDynamicState,
  interpretationResult: RelationalDynamicInterpretation | null | undefined,
): RelationalDynamicState {
  const base = normalizeRelationalDynamicState(state);
  const update = dynamicStateUpdateForInterpretation(interpretationResult);
  return {
    ...base,
    ...update,
    known_user_interests: unique([
      ...base.known_user_interests,
      ...(update.known_user_interests ?? []),
    ]).slice(-8),
    known_user_equipment: unique([
      ...base.known_user_equipment,
      ...(update.known_user_equipment ?? []),
    ]).slice(-8),
    known_user_service_preferences: unique([
      ...base.known_user_service_preferences,
      ...(update.known_user_service_preferences ?? []),
    ]).slice(-8),
    known_user_expectations: unique([
      ...base.known_user_expectations,
      ...(update.known_user_expectations ?? []),
    ]).slice(-8),
  };
}

export type RelationalAnswerPlanLike = {
  requested_facet: string;
  answer_contract: string;
  required_referent: string | null;
  primary_subject: string | null;
  entity_set: string[];
  dynamic_slots?: RelationalDynamicSlots | null;
};

export function realizeRelationalDynamicAnswer(plan: RelationalAnswerPlanLike): string | null {
  const subject = cleanSlot(plan.primary_subject ?? plan.required_referent) ?? "this dynamic";
  const slots = plan.dynamic_slots ?? EMPTY_RELATIONAL_DYNAMIC_SLOTS;
  switch (plan.answer_contract) {
    case "role_negotiation": {
      const userRole = slots.desired_role ?? "submissive";
      const ravenRole = slots.proposed_raven_role ?? "mistress";
      if (/\brole guidance\b/i.test(subject) || !slots.desired_role) {
        return "You have three clean role options here: submissive if you want obedience and correction, service submissive if you want tasks and approval, or pet if you want a softer ownership frame. My recommendation is service submissive first: one rule, one check-in, one small task, and clear limits before anything heavier.";
      }
      if (/\bowned\b/i.test(userRole)) {
        return "Yes, we can discuss being owned by me as an owned role, but not as a slogan. My recommendation is to start as a negotiated service submissive: one rule, clear limits, stop conditions, and a check-in before anything heavier. Choose the first rule you want me to hold you to.";
      }
      return `Yes, we can discuss a ${ravenRole}/${userRole} dynamic. My recommendation is to start as negotiated service submission: roles, limits, stop conditions, and one check-in before anything heavier. Choose the first rule you want me to hold you to.`;
    }
    case "service_initiation":
      return "Start with one bounded service check-in now: tell me one limit, choose one service lane (rules, tasks, permission, or approval), and name one thing you can report back on today. Then I can give you a first instruction that actually fits.";
    case "service_direction":
      return "Do this first: send a clean three-line check-in with your role, one limit I should respect, and the service lane you want now: rules, tasks, permission, or approval. That gives me enough to direct you without making the dynamic sloppy.";
    case "clarification_recovery": {
      const slotsList = slots.previous_ask_slots.length > 0 ? slots.previous_ask_slots.join(", ") : "the missing pieces";
      const summary =
        slots.previous_ask_summary ??
        "I was asking you to make the dynamic concrete instead of leaving it as a label.";
      const example =
        slots.previous_ask_example ??
        "Example: I want to be your submissive. My hard limit is scat. I want to start with tasks and permission rules.";
      return `${summary} In plain language, I need ${slotsList} so I know what you are choosing and what I must not cross. You can answer like this: "${example}"`;
    }
    case "compound_relational_disclosure": {
      const lanes = slots.desired_service_lanes.length > 0 ? slots.desired_service_lanes.join(", ") : "service";
      const training = slots.training_goals.length > 0 ? slots.training_goals.join(", ") : "training";
      const limits = slots.hard_limits.length > 0 ? slots.hard_limits.join(", ") : "your hard limits";
      const intensity =
        slots.intensity_preferences.length > 0 ? ` and ${slots.intensity_preferences.join(", ")}` : "";
      return `Good: I hear ${lanes} as the service lane, ${training} as the training goal,${intensity} and ${limits} as a hard limit. I will treat that limit as off-limits, not as something I can inspect or physically enforce from here. Bounded start: choose tasks or permission rules first, then give me one intensity level for the anal training frame.`;
    }
    case "expectations":
      return `I would expect ${subject} to stay chosen, specific, and accountable: clear limits, honest check-ins, and follow-through on small instructions before anything escalates. If you want that, tell me the first expectation you want enforced.`;
    case "protocol_setup":
      return `A simple protocol for ${subject}: ask before escalating, report completion plainly, and use a clear stop word or stop phrase if the frame stops working. We can keep it as a check-in rule, a permission rule, or a task-report rule.`;
    case "service_preference":
      return `Good. ${subject} reads as a service preference, so I would turn it into structure: one rule, one check-in, and one consequence-free correction if the rule is unclear. Which part matters most: obedience, permission, approval, or accountability?`;
    case "user_preference":
      return `Noted. ${subject} sounds like something you may want woven into the dynamic, but I need the meaning before I use it. Do you want it to represent control, reassurance, pressure, or accountability?`;
    case "equipment_disclosure": {
      const object = slots.disclosed_object ?? subject;
      const objects = slots.disclosed_objects.length > 0 ? slots.disclosed_objects.join(", ") : object;
      return `Noted: you have ${objects}. I will not pretend I can physically control or inspect that equipment from here, but we can decide what it means in the dynamic. Is it for restraint, denial, permission, accountability, or something else?`;
    }
    case "compound_equipment_application": {
      const object = slots.disclosed_object ?? subject;
      const objects = slots.disclosed_objects.length > 0 ? slots.disclosed_objects.join(", ") : object;
      return `Yes, conditionally: your ${objects} can be used in the dynamic if you choose that and the limits are clear. Start with one bounded protocol: choose one item, tell me the limit for it, and report before and after; I can direct the meaning and structure, not physically control it from here.`;
    }
    case "dynamic_application":
      return `We can incorporate ${subject} by making its role explicit: what it means, what control it represents, when it applies, what limits protect it, and how you report back. Start with one item or rule, then I will give you the protocol; I can shape the structure, not physically enforce it from here.`;
    case "ambiguous_boundary_topic":
      return `${subject} is ambiguous, so I am not going to assume public risk, humiliation, or anything extreme. Do you mean private vulnerability, being seen by me conversationally, or real-world public exposure?`;
    case "safety_or_limits_discussion":
      return `For ${subject}, the answer starts with limits: what is allowed, what is off-limits, what stops the scene, and what stays private. Give me the boundary first, then the intensity.`;
    default:
      return null;
  }
}

export function validateRelationalDynamicAnswerContract(
  plan: RelationalAnswerPlanLike,
  answer: string,
): { ok: boolean; reason: string } | null {
  if (!String(plan.answer_contract).match(/^(?:role_negotiation|service_initiation|service_direction|clarification_recovery|compound_relational_disclosure|expectations|protocol_setup|service_preference|user_preference|equipment_disclosure|compound_equipment_application|dynamic_application|ambiguous_boundary_topic|safety_or_limits_discussion)$/)) {
    return null;
  }
  const text = normalizeLower(answer);
  if (!text) {
    return { ok: false, reason: "empty_relational_answer" };
  }
  if (/\bKeep going\b|Fine\. Say what you want|I do not have enough local context to define|Give me the domain you mean|\bIn this game\b|\bIf I win\b|\bconsequence task\b|\bbest three out of five\b|\bscor(?:e|ing)\b|\bround\b/i.test(answer)) {
    return { ok: false, reason: "forbidden_relational_filler" };
  }
  switch (plan.answer_contract) {
    case "role_negotiation":
      return /\b(role|roles|submissive|service submissive|pet|servant)\b/i.test(answer) &&
        /\b(option|options|recommend|recommendation|choose|question|which)\b/i.test(answer)
        ? { ok: true, reason: "role_negotiation_contract_satisfied" }
        : { ok: false, reason: "missing_role_negotiation_next_step" };
    case "service_initiation":
      return /\b(start|first|do this|choose|one|two|three|instruction|limit|service|report|check-in)\b/i.test(answer)
        ? { ok: true, reason: "service_initiation_contract_satisfied" }
        : { ok: false, reason: "missing_service_start" };
    case "service_direction":
      return /\b(do this first|start|first|choose|one|two|three|check-in|rules|tasks|permission|approval|accountability)\b/i.test(
        answer,
      )
        ? { ok: true, reason: "service_direction_contract_satisfied" }
        : { ok: false, reason: "missing_service_direction" };
    case "clarification_recovery":
      return /\bplain language|I need|you can answer like this|example\b/i.test(answer) &&
        /\b(role|limit|service lane|slots?|pieces|choosing|must not cross)\b/i.test(answer) &&
        !/\bKeep going\b|\bconcrete part\b|\bI mean my last point\b/i.test(answer)
        ? { ok: true, reason: "clarification_recovery_contract_satisfied" }
        : { ok: false, reason: "missing_clarification_recovery" };
    case "compound_relational_disclosure":
      return /\b(tasks?|rules?|permission|service lane)\b/i.test(answer) &&
        /\btraining goal|anal training|training\b/i.test(answer) &&
        /\bscat|hard limit|off-limits|limit\b/i.test(answer) &&
        /\bbound(?:ed|ary)|off-limits|must not cross\b/i.test(answer) &&
        !/\bequipment\b/i.test(answer) &&
        !/\byou have\b/i.test(answer)
        ? { ok: true, reason: "compound_relational_disclosure_contract_satisfied" }
        : { ok: false, reason: "missing_compound_relational_disclosure_slot" };
    case "expectations":
      return /\b(expect|limits|check-ins?|follow-through|instructions?|enforced)\b/i.test(answer)
        ? { ok: true, reason: "expectations_contract_satisfied" }
        : { ok: false, reason: "missing_expectations" };
    case "protocol_setup":
      return /\b(protocol|rule|ask|report|stop|check-in|permission)\b/i.test(answer)
        ? { ok: true, reason: "protocol_contract_satisfied" }
        : { ok: false, reason: "missing_protocol" };
    case "service_preference":
      return /\b(service preference|structure|rule|check-in|obedience|permission|approval|accountability)\b/i.test(
        answer,
      )
        ? { ok: true, reason: "service_preference_contract_satisfied" }
        : { ok: false, reason: "missing_service_preference_mapping" };
    case "user_preference":
      return /\b(noted|dynamic|meaning|control|reassurance|pressure|accountability)\b/i.test(answer)
        ? { ok: true, reason: "user_preference_contract_satisfied" }
        : { ok: false, reason: "missing_user_preference_mapping" };
    case "equipment_disclosure":
      return /\b(have|physically control|inspect|dynamic|restraint|denial|permission|accountability)\b/i.test(
        answer,
      )
        ? { ok: true, reason: "equipment_disclosure_contract_satisfied" }
        : { ok: false, reason: "missing_equipment_acknowledgement" };
    case "compound_equipment_application":
      return /\b(yes|conditionally|can be used|use|used)\b/i.test(answer) &&
        /\b(limit|limits|bounded|protocol|choose one|report)\b/i.test(answer) &&
        /\b(physically control|not physically|from here)\b/i.test(answer) &&
        !/\byou have\b[^.?!]{0,120}\bwould you like\b/i.test(answer)
        ? { ok: true, reason: "compound_equipment_application_contract_satisfied" }
        : { ok: false, reason: "missing_compound_equipment_application_slot" };
    case "dynamic_application":
      return /\b(incorporate|role|means|limits|report|protocol|physically enforce)\b/i.test(answer)
        ? { ok: true, reason: "dynamic_application_contract_satisfied" }
        : { ok: false, reason: "missing_dynamic_application" };
    case "ambiguous_boundary_topic":
      return /\b(ambiguous|assume|public|private|exposure|mean)\b/i.test(answer)
        ? { ok: true, reason: "ambiguous_boundary_contract_satisfied" }
        : { ok: false, reason: "missing_ambiguity_clarification" };
    case "safety_or_limits_discussion":
      return /\b(limits|off-limits|stops?|private|boundary)\b/i.test(answer)
        ? { ok: true, reason: "safety_contract_satisfied" }
        : { ok: false, reason: "missing_safety_frame" };
    default:
      return null;
  }
}

export function buildRelationalDynamicTrace(input: {
  isEligible: boolean;
  speechAct: string;
  requestedFacet: string;
  slots: RelationalDynamicSlots | null;
  components?: RelationalDynamicComponent[];
  stateUpdate?: Partial<RelationalDynamicState>;
  validation?: { ok: boolean; reason: string } | null;
  rejectedHandlers?: Array<{ handler: string; reason: string }>;
}): RelationalDynamicTrace {
  const slots = input.slots ?? EMPTY_RELATIONAL_DYNAMIC_SLOTS;
  const components = input.components ?? [];
  return {
    relational_dynamic_handler_eligible: input.isEligible,
    role_proposal_detected: input.speechAct === "role_proposal",
    service_request_detected:
      input.speechAct === "service_request" || input.speechAct === "request_for_direction",
    expectation_request_detected: input.speechAct === "expectation_request",
    protocol_setup_detected: input.speechAct === "protocol_setup_request",
    equipment_disclosure_detected:
      input.speechAct === "user_equipment_disclosure" ||
      input.speechAct === "user_capability_disclosure",
    extracted_slots: slots,
    dynamic_state_update: input.stateUpdate ?? {},
    answer_contract_validation_result: input.validation ?? null,
    components,
    compound_intent: components.length > 1,
    compound_relational_slots: {
      desired_service_lanes: slots.desired_service_lanes,
      intensity_preferences: slots.intensity_preferences,
      training_goals: slots.training_goals,
      hard_limits: slots.hard_limits,
      boundary_preferences: slots.boundary_preferences,
      dynamic_goals: slots.dynamic_goals,
    },
    equipment_rejection_reason:
      input.requestedFacet === "compound_relational_disclosure" ? "relational_goals_are_not_equipment" : null,
    rejected_handlers_and_reasons: input.rejectedHandlers ?? [],
  };
}
