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
  | "concept_explanation";

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
  ];
  switch (answerMode) {
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
    default:
      return "I can answer that directly, but I need to keep the reply grounded in what I can actually claim.";
  }
}
