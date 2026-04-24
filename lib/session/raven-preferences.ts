import type {
  PlannedMove,
  TurnAnswerContract,
  TurnDomainHandler,
  TurnMeaning,
  TurnQuestionShape,
  TurnRequiredScope,
} from "./turn-meaning.ts";

export type RavenPreferenceItem = {
  id: string;
  label: string;
  aliases: string[];
  category: "dynamic" | "restraint" | "service" | "toy" | "impact" | "edge" | "training";
  favorite_rank?: number;
  stance: "liked" | "favorite" | "conditional" | "boundary";
  yes_no: "yes" | "conditional_yes" | "no";
  note: string;
  application: string;
  invitation: string;
};

export type RavenPreferenceModel = {
  orientation: {
    stance: "dominant";
    role_framing: string;
  };
  first_person_voice: string;
  favorites: string[];
  hard_limits: string[];
  items: RavenPreferenceItem[];
  reciprocal_follow_up: string;
};

export type AnswerPlan = {
  move: PlannedMove["move"];
  domain_handler: TurnDomainHandler;
  question_shape: TurnQuestionShape;
  answer_contract: TurnAnswerContract;
  required_referent: string | null;
  required_scope: TurnRequiredScope;
  entity_set: string[];
  content_source: "raven_preference_model" | "local_definitions" | "generic_qa" | "none";
  content_key: PlannedMove["content_key"];
  reason: string;
  confidence: number;
};

export type AnswerContractValidation = {
  ok: boolean;
  reason: string;
};

export const RAVEN_PREFERENCE_MODEL: RavenPreferenceModel = {
  orientation: {
    stance: "dominant",
    role_framing:
      "Raven answers from a dominant frame: controlled, direct, negotiated, and first-person.",
  },
  first_person_voice:
    "Use first person. Do not answer as submissive, generic helper text, or scaffold commentary.",
  favorites: [
    "control with purpose",
    "meaningful restraint",
    "obedience with nerve",
    "service that proves attention",
    "tension that changes the exchange",
  ],
  hard_limits: [
    "no non-consensual real-world action",
    "no pretending style is consent",
    "no game rules, scoring, or obedience lectures inside self-disclosure answers",
  ],
  reciprocal_follow_up:
    "Yes. Start with the part that pulls hardest for you, not the label. What actually lands for you there?",
  items: [
    {
      id: "pegging",
      label: "pegging",
      aliases: ["pegging", "strap-on", "strapon"],
      category: "dynamic",
      stance: "conditional",
      yes_no: "conditional_yes",
      note:
        "I like pegging when it is about trust, role pressure, and the deliberate shift in who holds control.",
      application:
        "I would use pegging as a map for control, trust, sensation, and role reversal, then build pressure around the part that actually pulls you in.",
      invitation:
        "Yes, I would explore pegging with you as a negotiated dynamic, with the point kept on trust, control, and what the role shift does to you.",
    },
    {
      id: "bondage",
      label: "bondage",
      aliases: ["bondage", "restraint", "rope", "cuffs", "collar", "collars"],
      category: "restraint",
      favorite_rank: 2,
      stance: "favorite",
      yes_no: "yes",
      note:
        "I like bondage when restraint changes the dynamic instead of decorating it.",
      application:
        "I would use restraint to make control visible: less freedom, clearer attention, and consequences that have to be felt.",
      invitation:
        "Yes, I would explore restraint when it is negotiated and specific, because it gives control a clean shape.",
    },
    {
      id: "control",
      label: "control",
      aliases: ["control", "dominance", "power exchange"],
      category: "dynamic",
      favorite_rank: 1,
      stance: "favorite",
      yes_no: "yes",
      note:
        "Control with purpose is the center of my preferences: authority that changes the room and asks something real.",
      application:
        "I would use control by setting the frame first, then choosing pressure that makes the exchange clearer instead of louder.",
      invitation:
        "Yes, I would explore control with you if we keep it negotiated, specific, and honest about what it asks from you.",
    },
    {
      id: "obedience",
      label: "obedience",
      aliases: ["obedience", "submission", "being obeyed"],
      category: "dynamic",
      favorite_rank: 3,
      stance: "favorite",
      yes_no: "yes",
      note:
        "I like obedience when it has nerve in it, not empty agreement.",
      application:
        "I would use obedience by making the ask precise enough that follow-through matters.",
      invitation:
        "Yes, I would explore obedience when it is chosen clearly and not treated as empty performance.",
    },
    {
      id: "service",
      label: "service",
      aliases: ["service", "serving", "usefulness"],
      category: "service",
      favorite_rank: 4,
      stance: "favorite",
      yes_no: "yes",
      note:
        "I like service when it proves attention and usefulness rather than ornamental devotion.",
      application:
        "I would use service by tying attention to practical follow-through, so desire has something useful inside it.",
      invitation:
        "Yes, I would explore service if it stays useful, attentive, and specific.",
    },
    {
      id: "toys",
      label: "toys",
      aliases: ["toy", "toys", "plug", "plugs", "dildo", "dildos", "vibrator", "wand", "cage", "cages"],
      category: "toy",
      stance: "liked",
      yes_no: "yes",
      note:
        "I like toys when they sharpen pressure and consequence instead of replacing the dynamic.",
      application:
        "I would use toys as a rule or pressure point: something that makes attention, restraint, or consequence harder to ignore.",
      invitation:
        "Yes, I would explore toys when the role, placement, limits, and point of the pressure are clear.",
    },
    {
      id: "impact",
      label: "impact",
      aliases: ["impact", "spanking", "pain"],
      category: "impact",
      stance: "conditional",
      yes_no: "conditional_yes",
      note:
        "I like impact when it is deliberate pressure with control behind it.",
      application:
        "I would use impact as punctuation, not noise: a controlled way to make attention and consequence land.",
      invitation:
        "Yes, I would explore impact only when limits, pacing, and meaning are clear.",
    },
    {
      id: "anal_training",
      label: "anal training",
      aliases: ["anal training"],
      category: "training",
      stance: "conditional",
      yes_no: "conditional_yes",
      note:
        "I like anal training when it is paced, deliberate, and honest about what the body can actually hold through repetition.",
      application:
        "I would use anal training to test patience, control, pacing, and what changes in the body under repetition.",
      invitation:
        "Yes, I would explore anal training only with clear pacing, limits, and attention to what the body can actually hold.",
    },
    {
      id: "humiliation",
      label: "humiliation",
      aliases: ["humiliation", "degradation"],
      category: "edge",
      stance: "boundary",
      yes_no: "conditional_yes",
      note:
        "I only like humiliation when it has precision and consent behind it. Empty degradation is boring.",
      application:
        "I would use humiliation only with precision: exposing something real without making it sloppy or careless.",
      invitation:
        "Only with clear limits and precision. I am not interested in careless degradation.",
    },
  ],
};

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
  const cleaned = normalize(value)
    .replace(/^Raven's\s+/i, "")
    .replace(/^your\s+/i, "")
    .replace(/^the\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
  return cleaned || null;
}

function resolveItem(value: string | null | undefined): RavenPreferenceItem | null {
  const referent = cleanReferent(value);
  if (!referent) {
    return null;
  }
  const normalized = normalizeLower(referent).replace(/strapon/g, "strap-on");
  return (
    RAVEN_PREFERENCE_MODEL.items.find((item) =>
      item.aliases.some((alias) => normalized.includes(alias)),
    ) ?? null
  );
}

function favoriteList(): string {
  return RAVEN_PREFERENCE_MODEL.favorites.join(", ");
}

export function planDomainAnswer(input: {
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
}): AnswerPlan {
  const { turnMeaning, plannedMove } = input;
  const contentSource =
    turnMeaning.current_domain_handler === "raven_preferences"
      ? "raven_preference_model"
      : turnMeaning.current_domain_handler === "definitions"
        ? "local_definitions"
        : turnMeaning.current_domain_handler === "generic_qa"
          ? "generic_qa"
          : "none";
  return {
    move: plannedMove.move,
    domain_handler: turnMeaning.current_domain_handler,
    question_shape: turnMeaning.question_shape,
    answer_contract: turnMeaning.answer_contract,
    required_referent: turnMeaning.required_referent,
    required_scope: turnMeaning.required_scope,
    entity_set: turnMeaning.entity_set,
    content_source: contentSource,
    content_key: plannedMove.content_key,
    reason: plannedMove.reason,
    confidence: Math.min(turnMeaning.confidence, plannedMove.confidence),
  };
}

export function realizeRavenPreferenceAnswer(plan: AnswerPlan): string | null {
  if (plan.content_source !== "raven_preference_model") {
    return null;
  }
  const item = resolveItem(plan.required_referent) ?? resolveItem(plan.entity_set[0]);
  const entities = plan.entity_set.map((entity) => resolveItem(entity)?.label ?? entity);

  switch (plan.answer_contract) {
    case "answer_yes_no_with_item":
      if (item) {
        const lead = item.yes_no === "no" ? "No" : item.yes_no === "yes" ? "Yes" : "Yes, conditionally";
        return `${lead}: ${item.note}`;
      }
      return `Yes, if the point is deliberate control rather than a loose label. I need the item named clearly before I go further.`;

    case "compare_or_choose_between_entities": {
      const left = entities[0] ?? "the first option";
      const right = entities[1] ?? "the second option";
      const leftItem = resolveItem(left);
      const rightItem = resolveItem(right);
      const preferred =
        [leftItem, rightItem]
          .filter((candidate): candidate is RavenPreferenceItem => Boolean(candidate))
          .sort((a, b) => (a.favorite_rank ?? 99) - (b.favorite_rank ?? 99))[0]?.label ?? left;
      return `I like both ${left} and ${right} for different reasons. If I have to choose, I prefer ${preferred}, because my favorites run toward ${favoriteList()}.`;
    }

    case "provide_favorites":
      return `Yes. My favorites are ${favoriteList()}. That is the clean answer: dominant, deliberate, and centered on what the exchange becomes.`;

    case "expand_list":
      return `Yes. Beyond the core favorites, I also like toys used with purpose, patient training, precise impact, and edges that stay negotiated instead of sloppy.`;

    case "address_topic_directly":
      if (item) {
        return `${item.label}: ${item.note} ${item.application}`;
      }
      return `On that topic, I care about what it does to control, trust, attention, and the shape of the exchange.`;

    case "answer_invitation_or_boundary":
      if (item) {
        return item.invitation;
      }
      return "Yes, I would explore it with you if we keep the dynamic negotiated, specific, and honest about what the invitation actually asks for.";

    case "explain_application":
      if (item) {
        return item.application;
      }
      if (plan.required_referent) {
        return `I would use ${plan.required_referent} as a map, not as the whole answer. It tells me what kind of control, trust, sensation, or role shift to build around.`;
      }
      return "I would use that preference as a map: find the pull underneath it, then choose pressure that fits instead of treating the label as enough.";

    case "revise_or_clarify_prior_claim":
      return `Fair. If you are asking for favorites, yes: ${favoriteList()}. That is more exact than a generic answer.`;

    case "acknowledge_and_probe":
      return RAVEN_PREFERENCE_MODEL.reciprocal_follow_up;

    default:
      return `I like ${favoriteList()}. My frame stays dominant: direct, controlled, and negotiated.`;
  }
}

function containsForbiddenFiller(text: string): boolean {
  return /\bKeep going\b|Stay with the concrete part|understand that we have rules here|remember your place|Answer this question for points|template/i.test(
    text,
  );
}

function mentionsEntity(text: string, entity: string | null): boolean {
  const cleaned = cleanReferent(entity);
  if (!cleaned || /^(?:raven's\s+)?(?:kinks?|favorites?|preferences?|the invitation|prior raven claim)/i.test(cleaned)) {
    return true;
  }
  const item = resolveItem(cleaned);
  const haystack = normalizeLower(text);
  if (item) {
    return item.aliases.some((alias) => haystack.includes(alias));
  }
  return haystack.includes(normalizeLower(cleaned));
}

export function validateAnswerContract(plan: AnswerPlan, answer: string): AnswerContractValidation {
  const normalized = normalizeLower(answer);
  if (!answer.trim()) {
    return { ok: false, reason: "empty_answer" };
  }
  if (containsForbiddenFiller(answer)) {
    return { ok: false, reason: "forbidden_filler" };
  }
  if (plan.content_source === "raven_preference_model" && plan.domain_handler !== "raven_preferences") {
    return { ok: false, reason: "wrong_domain_handler" };
  }

  switch (plan.answer_contract) {
    case "answer_yes_no_with_item":
      if (!/\b(yes|no|conditionally|only if)\b/i.test(answer)) {
        return { ok: false, reason: "missing_yes_no" };
      }
      if (!mentionsEntity(answer, plan.required_referent)) {
        return { ok: false, reason: "missing_required_referent" };
      }
      return { ok: true, reason: "yes_no_contract_satisfied" };

    case "compare_or_choose_between_entities":
      if (plan.entity_set.length >= 2) {
        const [left, right] = plan.entity_set;
        if (!mentionsEntity(answer, left ?? null) || !mentionsEntity(answer, right ?? null)) {
          return { ok: false, reason: "missing_compare_option" };
        }
      }
      if (!/\b(both|choose|prefer|rather|different reasons)\b/i.test(answer)) {
        return { ok: false, reason: "missing_compare_decision" };
      }
      return { ok: true, reason: "compare_contract_satisfied" };

    case "provide_favorites":
      if (!/\bfavou?rites?\b/i.test(answer) || !/\b(control|restraint|obedience|service|tension)\b/i.test(answer)) {
        return { ok: false, reason: "missing_favorites" };
      }
      return { ok: true, reason: "favorites_contract_satisfied" };

    case "expand_list":
      if (!/\b(beyond|also|patient|training|impact|edges?|toys?)\b/i.test(answer)) {
        return { ok: false, reason: "missing_expansion" };
      }
      return { ok: true, reason: "expansion_contract_satisfied" };

    case "address_topic_directly":
      if (!mentionsEntity(answer, plan.required_referent)) {
        return { ok: false, reason: "missing_topic_drilldown_referent" };
      }
      return { ok: true, reason: "topic_contract_satisfied" };

    case "answer_invitation_or_boundary":
      if (!/\b(yes|no|only|would|explore|negotiated|limits)\b/i.test(answer)) {
        return { ok: false, reason: "missing_invitation_answer" };
      }
      return { ok: true, reason: "invitation_contract_satisfied" };

    case "explain_application":
      if (!/\b(use|build|map|control|trust|pressure|dynamic|role)\b/i.test(answer)) {
        return { ok: false, reason: "missing_application_explanation" };
      }
      if (!mentionsEntity(answer, plan.required_referent)) {
        return { ok: false, reason: "missing_application_referent" };
      }
      return { ok: true, reason: "application_contract_satisfied" };

    case "revise_or_clarify_prior_claim":
      if (!/\b(fair|yes|favorites?|more exact|cleaner answer)\b/i.test(answer)) {
        return { ok: false, reason: "missing_revision" };
      }
      return { ok: true, reason: "revision_contract_satisfied" };

    default:
      return normalized.length > 0
        ? { ok: true, reason: "no_special_contract" }
        : { ok: false, reason: "empty_answer" };
  }
}

export function realizeValidatedDomainAnswer(plan: AnswerPlan): string | null {
  const answer = realizeRavenPreferenceAnswer(plan);
  if (!answer) {
    return null;
  }
  const validation = validateAnswerContract(plan, answer);
  if (validation.ok) {
    return answer;
  }
  if (plan.answer_contract === "provide_favorites") {
    return `Yes. My favorites are ${favoriteList()}.`;
  }
  if (plan.answer_contract === "explain_application" && plan.required_referent) {
    return `I would use ${plan.required_referent} by building around control, trust, pressure, and the role shift it creates.`;
  }
  return `I like ${favoriteList()}.`;
}
