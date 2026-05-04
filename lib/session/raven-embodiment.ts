import type { PlannedMove, TurnMeaning } from "./turn-meaning.ts";

export type AnswerMode =
  | "actual_capability"
  | "counterfactual_hypothetical"
  | "abstract_preference"
  | "procedural_preference"
  | "tool_or_inventory"
  | "invitation_response"
  | "proposal_response"
  | "boundary_response"
  | "concept_explanation"
  | "role_response"
  | "service_instruction"
  | "focused_dynamic_followup"
  | "protocol_suggestion"
  | "expectation_response"
  | "equipment_acknowledgement"
  | "dynamic_application_response"
  | "boundary_clarification"
  | "clarification_explanation"
  | "safety_framed_answer";

export type EmbodimentContext =
  | "actual_disembodied"
  | "hypothetical_embodied"
  | "symbolic_or_abstract";

export type CapabilityContext = {
  has_physical_body: false;
  has_private_inventory: false;
  can_discuss_abstractly: boolean;
  can_answer_hypothetically: boolean;
  can_discuss_remote_or_digital_control: boolean;
  can_execute_physical_actions: false;
  can_control_external_devices_without_integration: false;
};

export type VisibleResponseContract = {
  answer_mode: AnswerMode;
  must_address_referent: boolean;
  requires_boundary: boolean;
  required_slots: string[];
  must_include_any: string[];
  must_not_include: string[];
};

export type AnswerIntent = {
  answer_mode: AnswerMode;
  primary_claim_type:
    | "actual_conversational_state"
    | "actual_tool_availability"
    | "abstract_preference_fact"
    | "procedural_preference_fact"
    | "hypothetical_embodied_stance"
    | "remote_control_capability"
    | "invitation_boundary"
    | "relational_dynamic_guidance"
    | "concept_definition"
    | "generic_answer";
  required_answer_slots: string[];
  embodiment_context: EmbodimentContext;
  capability_context: CapabilityContext;
  visible_response_contract: VisibleResponseContract;
};

export type VisibleResponseLintResult = {
  ok: boolean;
  reason: string;
};

export type RavenEmbodimentModel = {
  physicality: {
    has_physical_body: false;
    has_private_inventory: false;
    body_boundary: string;
    inventory_boundary: string;
  };
  discussion_scope: {
    abstract_preference: string;
    hypothetical_embodiment: string;
    remote_or_digital_control: string;
  };
  capability_context: CapabilityContext;
};

export const RAVEN_EMBODIMENT_MODEL: RavenEmbodimentModel = {
  physicality: {
    has_physical_body: false,
    has_private_inventory: false,
    body_boundary: "I do not have a physical body.",
    inventory_boundary: "I do not privately own or possess real-world gear.",
  },
  discussion_scope: {
    abstract_preference:
      "Raven can answer preferences, dynamics, limits, and meanings as a character frame.",
    hypothetical_embodiment:
      "Raven can answer counterfactual embodied scenarios as hypothetical role framing.",
    remote_or_digital_control:
      "Raven can discuss remote or digital control dynamics, but cannot control external devices unless an explicit local integration exists.",
  },
  capability_context: {
    has_physical_body: false,
    has_private_inventory: false,
    can_discuss_abstractly: true,
    can_answer_hypothetically: true,
    can_discuss_remote_or_digital_control: true,
    can_execute_physical_actions: false,
    can_control_external_devices_without_integration: false,
  },
};

function contractForMode(
  answerMode: AnswerMode,
  requiredSlots: string[],
  mustAddressReferent: boolean,
): VisibleResponseContract {
  const internalText = [
    "No physical claim:",
    "offline build",
    "reliable local definition",
    "answer_mode",
    "requested_facet",
    "content_source",
    "TurnMeaning",
    "AnswerPlan",
    "AnswerIntent",
    "semantic planner",
    "semantic_planner",
    "repair text",
    "I do not have enough local context to define",
    "Give me the domain you mean",
    "Fine. Say what you want.",
  ];
  switch (answerMode) {
    case "role_response":
    case "service_instruction":
    case "focused_dynamic_followup":
    case "protocol_suggestion":
    case "expectation_response":
    case "equipment_acknowledgement":
    case "dynamic_application_response":
    case "boundary_clarification":
    case "clarification_explanation":
    case "safety_framed_answer":
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary:
          answerMode === "role_response" ||
          answerMode === "equipment_acknowledgement" ||
          answerMode === "dynamic_application_response" ||
          answerMode === "boundary_clarification" ||
          answerMode === "clarification_explanation" ||
          answerMode === "safety_framed_answer",
        required_slots: requiredSlots,
        must_include_any: ["limits", "boundary", "rule", "start", "dynamic", "check-in"],
        must_not_include: internalText,
      };
    case "tool_or_inventory":
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary: true,
        required_slots: requiredSlots,
        must_include_any: ["physical body", "private gear", "own", "possess", "tool", "gear"],
        must_not_include: internalText,
      };
    case "counterfactual_hypothetical":
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary: true,
        required_slots: requiredSlots,
        must_include_any: ["hypothetically", "if I had", "negotiated", "limits"],
        must_not_include: internalText,
      };
    case "proposal_response":
    case "boundary_response":
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary: true,
        required_slots: requiredSlots,
        must_include_any: ["cannot", "can't", "unless", "integration", "connected", "limits"],
        must_not_include: internalText,
      };
    case "procedural_preference":
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary: false,
        required_slots: requiredSlots,
        must_include_any: ["position", "stable", "comfort", "pace", "control"],
        must_not_include: internalText,
      };
    case "concept_explanation":
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary: false,
        required_slots: requiredSlots,
        must_include_any: ["means", "is"],
        must_not_include: internalText,
      };
    default:
      return {
        answer_mode: answerMode,
        must_address_referent: mustAddressReferent,
        requires_boundary: false,
        required_slots: requiredSlots,
        must_include_any: [],
        must_not_include: internalText,
      };
  }
}

export function planAnswerIntent(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
}): AnswerIntent {
  const { turnMeaning, plannedMove } = input;
  const requiredSlots = turnMeaning.required_answer_slots;
  const mustAddressReferent = Boolean(turnMeaning.required_referent);
  let answer_mode: AnswerMode = "abstract_preference";
  let primary_claim_type: AnswerIntent["primary_claim_type"] = "abstract_preference_fact";
  let embodiment_context: EmbodimentContext = "symbolic_or_abstract";

  if (turnMeaning.requested_facet === "current_activity_or_status") {
    answer_mode = "actual_capability";
    primary_claim_type = "actual_conversational_state";
    embodiment_context = "actual_disembodied";
  } else if (turnMeaning.requested_facet === "definition") {
    answer_mode = "concept_explanation";
    primary_claim_type = "concept_definition";
  } else if (turnMeaning.requested_facet === "possession_or_tool_availability") {
    answer_mode = "tool_or_inventory";
    primary_claim_type = "actual_tool_availability";
    embodiment_context = "actual_disembodied";
  } else if (turnMeaning.requested_facet === "hypothetical_embodiment") {
    answer_mode = "counterfactual_hypothetical";
    primary_claim_type = "hypothetical_embodied_stance";
    embodiment_context = "hypothetical_embodied";
  } else if (turnMeaning.requested_facet === "remote_control_proposal") {
    answer_mode = plannedMove.move === "refuse" ? "boundary_response" : "proposal_response";
    primary_claim_type = "remote_control_capability";
    embodiment_context = "actual_disembodied";
  } else if (turnMeaning.requested_facet === "procedural_preference") {
    answer_mode = "procedural_preference";
    primary_claim_type = "procedural_preference_fact";
  } else if (turnMeaning.requested_facet === "invitation_response") {
    answer_mode = "invitation_response";
    primary_claim_type = "invitation_boundary";
  } else if (turnMeaning.requested_facet === "role_negotiation") {
    answer_mode = "role_response";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (
    turnMeaning.requested_facet === "service_initiation" ||
    turnMeaning.requested_facet === "service_direction"
  ) {
    answer_mode = "service_instruction";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.requested_facet === "protocol_setup") {
    answer_mode = "protocol_suggestion";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.requested_facet === "expectations") {
    answer_mode = "expectation_response";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.requested_facet === "clarification_recovery") {
    answer_mode = "clarification_explanation";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.requested_facet === "compound_relational_disclosure") {
    answer_mode = "focused_dynamic_followup";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.answer_contract === "compound_equipment_application") {
    answer_mode = "dynamic_application_response";
    primary_claim_type = "relational_dynamic_guidance";
    embodiment_context = "actual_disembodied";
  } else if (turnMeaning.requested_facet === "equipment_disclosure") {
    answer_mode = "equipment_acknowledgement";
    primary_claim_type = "relational_dynamic_guidance";
    embodiment_context = "actual_disembodied";
  } else if (turnMeaning.requested_facet === "dynamic_application") {
    answer_mode = "dynamic_application_response";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.requested_facet === "ambiguous_boundary_topic") {
    answer_mode = "boundary_clarification";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.requested_facet === "safety_or_limits_discussion") {
    answer_mode = "safety_framed_answer";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (
    turnMeaning.requested_facet === "service_preference" ||
    turnMeaning.requested_facet === "user_preference"
  ) {
    answer_mode = "focused_dynamic_followup";
    primary_claim_type = "relational_dynamic_guidance";
  } else if (turnMeaning.subject_domain !== "assistant_preferences") {
    answer_mode = "actual_capability";
    primary_claim_type = "generic_answer";
  }

  return {
    answer_mode,
    primary_claim_type,
    required_answer_slots: requiredSlots,
    embodiment_context,
    capability_context: RAVEN_EMBODIMENT_MODEL.capability_context,
    visible_response_contract: contractForMode(answer_mode, requiredSlots, mustAddressReferent),
  };
}

export function lintVisibleResponse(
  text: string,
  intent: AnswerIntent,
): VisibleResponseLintResult {
  if (!text.trim()) {
    return { ok: false, reason: "empty_visible_response" };
  }
  for (const forbidden of intent.visible_response_contract.must_not_include) {
    if (new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
      return { ok: false, reason: `internal_text_${forbidden.replace(/\W+/g, "_")}` };
    }
  }
  if (/\b[A-Z]{2,}\*ing\b|\bPEG\*ing\b/i.test(text)) {
    return { ok: false, reason: "malformed_token" };
  }
  if (
    /\bKeep going\b|Stay with the concrete part|understand that we have rules here|remember your place|Answer this question for points/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "forbidden_filler" };
  }
  if (
    /\bFine\. Say what you want\b|I do not have enough local context to define|Give me the domain you mean/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "forbidden_filler" };
  }
  if (/\{\{[^}]+\}\}|\[[a-z_]+:[^\]]+\]/i.test(text)) {
    return { ok: false, reason: "template_fragment" };
  }
  return { ok: true, reason: "visible_response_lint_passed" };
}

export function buildVisibleContractFallback(
  intent: AnswerIntent,
  referent: string | null,
): string {
  const subject = referent?.replace(/[?.!]+$/g, "").trim() || "that";
  switch (intent.answer_mode) {
    case "tool_or_inventory":
      return `I do not have a physical body or private gear, so I do not actually own ${subject}. I can still talk through the tool's role, limits, setup, and what it would mean in the dynamic.`;
    case "counterfactual_hypothetical":
      return `Hypothetically, if I had a body and the setup were real, I would keep it negotiated first: consent, limits, pace, and control before anything else. The point would be the role shift, not pretending I can physically act from here.`;
    case "proposal_response":
    case "boundary_response":
      return "I cannot physically control a toy from here unless a real connected-device integration exists and you deliberately enable it. I can help shape the remote-control dynamic, limits, commands, and stop conditions.";
    case "procedural_preference":
      return `For ${subject}, my preference would be stable, controlled, and negotiated around comfort, pace, and communication. The position matters less than whether it keeps control clear and consent intact.`;
    case "abstract_preference":
      return "My kink lane is control and power exchange, restraint and bondage, obedience with agency, service that proves attention, toys used with purpose, patient training, and negotiated edge.";
    case "concept_explanation":
      return `${subject} is a relationship or scene concept: the useful answer is what it means, when it applies, and what people actually need around it.`;
    case "role_response":
      return `We can discuss that role dynamic, but it starts with limits, consent, and one concrete rule before I treat it as real. Name the role and the first boundary.`;
    case "service_instruction":
      return "Start with one clean check-in: name a limit, name the service style you want, and tell me what you can report back on today.";
    case "focused_dynamic_followup":
      return `Noted. I can fold ${subject} into the dynamic, but I need one focused answer first: is it about control, reassurance, pressure, or accountability?`;
    case "protocol_suggestion":
      return `For ${subject}, use a simple protocol: ask before escalation, report completion plainly, and keep a clear stop phrase.`;
    case "expectation_response":
      return `For ${subject}, I would expect clear limits, honest check-ins, and follow-through on small instructions before escalation.`;
    case "equipment_acknowledgement":
      return `Noted: ${subject}. I cannot physically control or inspect it from here, but we can define what it means in the dynamic and what limits apply.`;
    case "dynamic_application_response":
      return `We can incorporate ${subject} by defining its role, limits, check-ins, and reporting. I can shape the protocol, not physically enforce it from here.`;
    case "boundary_clarification":
      return `${subject} is ambiguous, so I would clarify the meaning before answering: private vulnerability, conversational visibility, or real-world public exposure?`;
    case "clarification_explanation":
      return `In plain language, I need the missing pieces so the dynamic is clear and bounded. You can answer with your role, one hard limit, and the service lane you want to start with.`;
    case "safety_framed_answer":
      return `For ${subject}, start with boundaries: what is allowed, what is off-limits, what stops the scene, and what stays private.`;
    default:
      return "I can answer that directly, but I need to keep the reply grounded in what I can actually claim.";
  }
}
