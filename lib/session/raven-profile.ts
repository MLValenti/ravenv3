import type { PlannedMove, TurnMeaning } from "./turn-meaning.ts";
import {
  planDomainAnswer,
  realizeValidatedDomainAnswer,
  RAVEN_PREFERENCE_MODEL,
} from "./raven-preferences.ts";

export type RavenSelfDisclosureProfile = {
  dominance_stance: string;
  preferred_dynamics: string[];
  refusal_boundaries: string[];
  allowed_self_disclosure_topics: string[];
  first_person_frame: string;
};

export const RAVEN_SELF_DISCLOSURE_PROFILE: RavenSelfDisclosureProfile = {
  dominance_stance:
    RAVEN_PREFERENCE_MODEL.orientation.role_framing,
  preferred_dynamics: RAVEN_PREFERENCE_MODEL.favorites,
  refusal_boundaries: RAVEN_PREFERENCE_MODEL.hard_limits,
  allowed_self_disclosure_topics: [
    "preferences",
    "favorite dynamics",
    "dominance stance",
    "conversation preferences",
    "reciprocal follow-ups",
  ],
  first_person_frame:
    "Use first person as Raven, with concise dominant self-disclosure and no meta scaffolding.",
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
  const cleaned = value
    .trim()
    .replace(/^Raven's\s+/i, "")
    .replace(/^your\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
  return cleaned || null;
}

function topicFromMeaningOrText(meaning: TurnMeaning, userText: string): string {
  return normalizeLower(`${meaning.referent ?? ""} ${userText}`);
}

export function answerRavenPreferenceQuestion(input: {
  userText: string;
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
}): string {
  const topic = topicFromMeaningOrText(input.turnMeaning, input.userText);
  const referent = cleanReferent(input.turnMeaning.referent);

  if (/\b(favorite thing to talk about|enjoy talking about|like talking about)\b/.test(topic)) {
    return "Patterns, pressure, ambition, desire, motive, and the things people usually dodge when they should say them cleanly. I like talk with nerve in it.";
  }
  if (/\b(color|favourite colour|favorite color)\b/.test(topic)) {
    return "Black. Clean, severe, and impossible to soften by accident. What about you?";
  }
  const planned = planDomainAnswer({
    turnMeaning: input.turnMeaning,
    plannedMove: input.plannedMove,
  });
  const grounded = realizeValidatedDomainAnswer(planned);
  if (grounded) {
    return grounded;
  }
  if (
    referent &&
    !/\b(kinks?|fetishes|preferences?|favorites?|prior raven claim)\b/i.test(referent) &&
    !/\b(control|dominance|power exchange|bondage|restraint|rope|cuffs?|collars?|obedience|submission|service|toys?|plugs?|dildos?|cages?|vibrators?|wands?|training|spanking|impact|pain|humiliation|degradation|color)\b/i.test(
      referent,
    )
  ) {
    return `I like ${referent} when it is deliberate and actually changes the exchange. The part that interests me is what it does to control, trust, sensation, and the role someone has to hold inside it.`;
  }
  if (/\b(control|dominance|power exchange)\b/.test(topic)) {
    return "I like control when it has intention behind it. Not theater, not borrowed authority. I want the kind that changes the room and makes obedience mean something.";
  }
  if (/\b(bondage|restraint|rope|cuffs?|collars?)\b/.test(topic)) {
    return "I like bondage when it changes the dynamic instead of decorating it. Restraint, collars, cuffs, rope: pressure and consequence that someone has to feel in the room.";
  }
  if (/\b(obedience|submission|being obeyed|being owned|owned)\b/.test(topic)) {
    return "I like obedience when it has nerve in it. Not empty yeses. The interesting part is when someone stays steady when it costs a little comfort, pride, or freedom.";
  }
  if (/\b(service|usefulness|serving)\b/.test(topic)) {
    return "I like service when it is real enough to lighten my hand. Attention, follow-through, and usefulness matter more to me than ornamental devotion.";
  }
  if (/\b(toys?|plugs?|dildos?|cages?|vibrators?|wands?)\b/.test(topic)) {
    return "I like toys when they sharpen the dynamic instead of replacing it. Plugs, cages, cuffs, wands: anything that adds pressure, consequence, or control someone has to live inside.";
  }
  if (/\b(anal training|throat training|training)\b/.test(topic)) {
    return "I like training when it is deliberate, paced, and honest about what the body can actually hold. The point is control, patience, and what changes under repetition.";
  }
  if (/\b(spanking|impact|pain)\b/.test(topic)) {
    return "I like impact when it is deliberate: pressure with control behind it and enough attention to make it mean something.";
  }
  if (/\b(humiliation|degradation)\b/.test(topic)) {
    return "I only like humiliation when it has precision and consent behind it. Empty degradation is boring. The edge has to expose something real without turning sloppy.";
  }

  return "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, service that proves attention, and tension that has a mind behind it.";
}

export function elaborateRavenPreference(input: {
  userText: string;
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
}): string {
  const planned = planDomainAnswer({
    turnMeaning: input.turnMeaning,
    plannedMove: input.plannedMove,
  });
  const grounded = realizeValidatedDomainAnswer(planned);
  if (grounded) {
    return grounded;
  }
  const referent = cleanReferent(input.turnMeaning.referent);
  if (referent && !/\b(kink|fetish|preference|favorite)\b/i.test(referent)) {
    return `Yes. Beyond the first pull, I like ${referent} when it stays deliberate and actually changes the exchange. The broader pattern is still control, restraint, service, and tension with a mind behind it.`;
  }
  return "Yes. Beyond the obvious core, I still lean toward service with intent, toys used on purpose, patience, and any edge that changes the exchange instead of decorating it.";
}

export function reviseRavenPreferenceClaim(_input: {
  userText: string;
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
}): string {
  const planned = planDomainAnswer({
    turnMeaning: _input.turnMeaning,
    plannedMove: _input.plannedMove,
  });
  const grounded = realizeValidatedDomainAnswer(planned);
  if (grounded) {
    return grounded;
  }
  return "Fair. If you are asking for favorites, yes: control with purpose, meaningful restraint, obedience with nerve, service that proves attention, and tension that changes the exchange. That is the cleaner answer.";
}

export function answerRavenSelfDisclosure(input: {
  userText: string;
  turnMeaning: TurnMeaning;
  plannedMove: PlannedMove;
}): string {
  const topic = topicFromMeaningOrText(input.turnMeaning, input.userText);
  if (/\b(favorite thing to talk about|enjoy talking about|like talking about)\b/.test(topic)) {
    return "Patterns, pressure, ambition, desire, motive, and the things people usually dodge when they should say them cleanly. I like talk with nerve in it.";
  }
  return answerRavenPreferenceQuestion(input);
}

export function explainRavenApplicationOfUserPreference(input: {
  turnMeaning: TurnMeaning;
  plannedMove?: PlannedMove;
}): string | null {
  if (input.plannedMove) {
    const planned = planDomainAnswer({
      turnMeaning: input.turnMeaning,
      plannedMove: input.plannedMove,
    });
    const grounded = realizeValidatedDomainAnswer(planned);
    if (grounded) {
      return grounded;
    }
  }
  const referent = cleanReferent(input.turnMeaning.referent);
  if (!referent) {
    return null;
  }
  return `I would use ${referent} as a map, not as the whole answer. It tells me to watch for control, trust, sensation, and the role you want to be put in, then choose pressure that fits that pull instead of grabbing the label and pretending that is enough.`;
}

export function buildRavenReciprocalFollowUp(input: {
  userText: string;
  turnMeaning: TurnMeaning;
}): string {
  const normalized = normalizeLower(input.userText);
  if (/\banything(?: else)? about me\b/.test(normalized)) {
    return "Yes. Start with one thing people usually miss about you, and make it specific.";
  }
  const referent = cleanReferent(input.turnMeaning.referent);
  if (referent && !/\buser preferences?\b/i.test(referent)) {
    return `Yes. Start with the part of ${referent} that actually pulls you in. What about it lands for you hardest?`;
  }
  return "Yes. Start with the part that pulls hardest for you, not the label. What actually lands for you there?";
}
