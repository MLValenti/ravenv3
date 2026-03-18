import {
  describeInventorySemantics,
  getSessionInventoryDisplayName,
  type SessionInventoryItem,
} from "./session-inventory.ts";

export type TrainingThreadSubject =
  | "none"
  | "obedience"
  | "throat"
  | "anal"
  | "chastity"
  | "bondage";

export type TrainingThreadState = {
  subject: TrainingThreadSubject;
  item_name: string | null;
  primary_variant: string;
  alternate_variant: string;
  focus: string;
  rationale: string;
  proof_requirement: string;
  depth_guidance: string | null;
  recommended_duration: string;
  last_response: string;
};

type TrainingFollowUpOperation =
  | "recommendation"
  | "depth"
  | "rationale"
  | "proof"
  | "alternate"
  | "stricter"
  | "softer"
  | "clarify"
  | "use_mode"
  | "combine_item"
  | "duration"
  | "switch_subject"
  | "acknowledge"
  | "none";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createEmptyTrainingThread(): TrainingThreadState {
  return {
    subject: "none",
    item_name: null,
    primary_variant: "",
    alternate_variant: "",
    focus: "",
    rationale: "",
    proof_requirement: "",
    depth_guidance: null,
    recommended_duration: "",
    last_response: "",
  };
}

function detectSubject(text: string): TrainingThreadSubject {
  const normalized = normalize(text);
  if (/\b(throat|oral|mouth|gag|jaw)\b/.test(normalized)) {
    return "throat";
  }
  if (/\b(anal|anus|plug|dildo|prostate)\b/.test(normalized)) {
    return "anal";
  }
  if (/\b(chastity|cage|lock|locked)\b/.test(normalized)) {
    return "chastity";
  }
  if (/\b(bondage|restraint|restrained|cuffs?|rope|collar|leash)\b/.test(normalized)) {
    return "bondage";
  }
  if (/\b(obedience|service|trainable|trained)\b/.test(normalized)) {
    return "obedience";
  }
  return "none";
}

function defaultVariantsForSubject(subject: TrainingThreadSubject): {
  primary: string;
  alternate: string;
} {
  switch (subject) {
    case "throat":
      return {
        primary: "paced throat control",
        alternate: "oral endurance intervals",
      };
    case "anal":
      return {
        primary: "a slow anal hold",
        alternate: "paced anal intervals",
      };
    case "chastity":
      return {
        primary: "a timed chastity protocol",
        alternate: "a denial-and-report line",
      };
    case "bondage":
      return {
        primary: "a restrained obedience drill",
        alternate: "a posture-and-restraint hold",
      };
    case "obedience":
      return {
        primary: "a one-rule obedience drill",
        alternate: "a clean-answer discipline line",
      };
    default:
      return {
        primary: "",
        alternate: "",
      };
  }
}

function baseThreadForSubject(subject: TrainingThreadSubject): Omit<
  TrainingThreadState,
  "subject" | "item_name" | "primary_variant" | "alternate_variant" | "last_response"
> {
  switch (subject) {
    case "throat":
      return {
        focus: "controlled depth, breathing, and clean resets instead of bravado",
        rationale:
          "That line tells me whether you can keep control once depth and pressure are real instead of performative.",
        proof_requirement:
          "If I want it to count, I want one clean midpoint report and one final report without padding.",
        depth_guidance:
          "Only as deep as you can keep your breathing, jaw, and control clean. I care more about steadiness than maximum depth.",
        recommended_duration: "10 to 15 minutes to start, longer only if the control stays clean.",
      };
    case "anal":
      return {
        focus: "pressure tolerance, patience, and control under repetition",
        rationale:
          "That line tells me whether you can stay deliberate under pressure instead of getting greedy or sloppy.",
        proof_requirement:
          "Yes. Give me one clean midpoint report and one final report so I know the control held the whole way through.",
        depth_guidance:
          "Deep enough that you can keep the pace deliberate and the control clean. I want control first, not maximum depth for its own sake.",
        recommended_duration: "15 to 20 minutes to start, longer only if the control stays deliberate.",
      };
    case "chastity":
      return {
        focus: "denial, accountability, and staying inside a rule without bargaining",
        rationale:
          "That line tells me whether you can live inside a restriction once the novelty wears off and the rule is all that is left.",
        proof_requirement:
          "Yes. I want a midpoint check-in and a clean final report so it counts as discipline instead of decorative denial.",
        depth_guidance: null,
        recommended_duration: "30 minutes to start if it is a real protocol, longer only if the accountability stays clean.",
      };
    case "bondage":
      return {
        focus: "restraint, posture, obedience, and exact check-ins instead of decorative restraint",
        rationale:
          "That line tells me whether restraint actually changes your behavior, not just your silhouette.",
        proof_requirement:
          "Yes. I want a clean midpoint check-in and a final report so I know you held the rule, not just the gear.",
        depth_guidance: null,
        recommended_duration: "15 to 20 minutes to start, then longer once the steadiness is real.",
      };
    case "obedience":
      return {
        focus: "clean answers, consistency, and following a rule without softening",
        rationale:
          "That line tells me whether you can be shaped cleanly or whether you only like the image of being trained.",
        proof_requirement:
          "Yes. I want exact check-ins and one final report so there is something to hold you to.",
        depth_guidance: null,
        recommended_duration: "10 to 15 minutes if it is new, longer once the steadiness stops being flattering.",
      };
    default:
      return {
        focus: "",
        rationale: "",
        proof_requirement: "",
        depth_guidance: null,
        recommended_duration: "",
      };
  }
}

function extractItemName(text: string): string | null {
  const withYour = text.match(/\bwith your ([^:.,]+?)(?::|,|\.|$)/i)?.[1]?.trim();
  if (withYour) {
    return withYour;
  }
  const getYour = text.match(/\bget your ([^:.,]+?)(?: ready| in place| secure| on now)\b/i)?.[1]?.trim();
  return getYour || null;
}

function extractPrimaryVariant(text: string): string {
  const match = text.match(/\b(?:start with|switch you to|keep)\s+([^:.]+?)(?::|\.|, and|, but| and)/i)?.[1]?.trim();
  return match ?? "";
}

function extractAlternateVariant(text: string): string {
  const match = text.match(/\bIf you want the other angle, I could also make it ([^:.]+?)(?::|\.|, and|, but)/i)?.[1]?.trim();
  return match ?? "";
}

export function extractTrainingThreadFromAssistantText(text: string): TrainingThreadState | null {
  const normalized = normalize(text);
  if (!/\btraining\b/.test(normalized) && !/\bi would start you with\b/.test(normalized)) {
    return null;
  }
  const subject = detectSubject(text);
  if (subject === "none") {
    return null;
  }
  const base = baseThreadForSubject(subject);
  const variants = defaultVariantsForSubject(subject);
  return {
    subject,
    item_name: extractItemName(text),
    primary_variant: extractPrimaryVariant(text) || variants.primary,
    alternate_variant: extractAlternateVariant(text) || variants.alternate,
    ...base,
    last_response: text.trim(),
  };
}

function recommendSubject(
  userText: string,
  inventory?: SessionInventoryItem[] | null,
  thread?: TrainingThreadState | null,
): TrainingThreadSubject {
  const explicit = detectSubject(userText);
  if (explicit !== "none") {
    return explicit;
  }
  if (thread && thread.subject !== "none") {
    return thread.subject;
  }
  const items = (inventory ?? []).filter((item) => item.available_this_session);
  const insertable = items.find((item) => describeInventorySemantics(item).isInsertableToy);
  if (insertable) {
    return "anal";
  }
  const restraint = items.find((item) => describeInventorySemantics(item).isRestraint);
  if (restraint) {
    return "bondage";
  }
  const chastity = items.find((item) => describeInventorySemantics(item).isChastity);
  if (chastity) {
    return "chastity";
  }
  return "obedience";
}

function preferredItemForSubject(
  subject: TrainingThreadSubject,
  inventory?: SessionInventoryItem[] | null,
): string | null {
  const items = (inventory ?? []).filter((item) => item.available_this_session);
  if (items.length === 0) {
    return null;
  }
  const pick = (predicate: (item: SessionInventoryItem) => boolean) =>
    items.find(predicate) ?? null;
  switch (subject) {
    case "anal":
    case "throat":
      return (
        pick((item) => describeInventorySemantics(item).isInsertableToy) &&
        getSessionInventoryDisplayName(
          pick((item) => describeInventorySemantics(item).isInsertableToy)!,
        )
      );
    case "chastity":
      return (
        pick((item) => describeInventorySemantics(item).isChastity) &&
        getSessionInventoryDisplayName(pick((item) => describeInventorySemantics(item).isChastity)!)
      );
    case "bondage":
      return (
        pick((item) => describeInventorySemantics(item).isRestraint) &&
        getSessionInventoryDisplayName(pick((item) => describeInventorySemantics(item).isRestraint)!)
      );
    default:
      return null;
  }
}

function findReferencedInventoryItem(
  userText: string,
  inventory?: SessionInventoryItem[] | null,
  excludeName?: string | null,
): SessionInventoryItem | null {
  const normalized = normalize(userText);
  const excluded = normalize(excludeName ?? "");
  const items = (inventory ?? []).filter((item) => item.available_this_session);

  const explicit = items.find((item) => {
    const label = normalize(item.label);
    const notes = normalize(item.notes);
    const display = normalize(getSessionInventoryDisplayName(item));
    if (excluded && (label === excluded || notes === excluded || display === excluded)) {
      return false;
    }
    return (
      (label.length > 0 && normalized.includes(label)) ||
      (notes.length > 0 && normalized.includes(notes)) ||
      (display.length > 0 && normalized.includes(display))
    );
  });

  if (explicit) {
    return explicit;
  }

  const buildImplicitItem = (label: string, notes: string): SessionInventoryItem | null => {
    const labelKey = normalize(label);
    if (excluded && (excluded.includes(labelKey) || labelKey.includes(excluded))) {
      return null;
    }
    return {
      id: `implicit-${labelKey.replace(/\s+/g, "-")}`,
      label,
      category: "other",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes,
    };
  };

  if (/\b(chastity|cage|steel cage|cock cage)\b/.test(normalized)) {
    return buildImplicitItem("Cage", "chastity cage");
  }
  if (/\b(cuffs?|restraints?|shackles?|rope)\b/.test(normalized)) {
    return buildImplicitItem("Cuffs", "restraint gear");
  }
  if (/\b(collar|leash)\b/.test(normalized)) {
    return buildImplicitItem("Collar", "collar or leash");
  }
  if (/\b(blindfold|hood|mask)\b/.test(normalized)) {
    return buildImplicitItem("Blindfold", "visual gear");
  }
  if (/\b(dildo|plug|vibe|vibrator|wand|toy)\b/.test(normalized)) {
    return buildImplicitItem("Toy", "insertable toy");
  }

  return null;
}

function classifyOperation(text: string): TrainingFollowUpOperation {
  const normalized = normalize(text);
  if (!normalized) {
    return "none";
  }
  if (
    /\b(what training do you think i need|what do you think i need|what kind of training do you think|what training would be good for me|what would be a good training|what should i train|what would fit me)\b/.test(
      normalized,
    )
  ) {
    return "recommendation";
  }
  if (/\b(how deep|what depth|how far|how far in)\b/.test(normalized)) {
    return "depth";
  }
  if (/\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/.test(normalized)) {
    return "rationale";
  }
  if (/\b(do i need proof|what proof|how do i prove it|what counts as proof|do you want proof|do i have to prove it)\b/.test(normalized)) {
    return "proof";
  }
  if (/\b(what else|different one|another one|other angle|something else|what about another)\b/.test(normalized)) {
    return "alternate";
  }
  if (/\b(make it stricter|stricter|harder|more intense|more pressure)\b/.test(normalized)) {
    return "stricter";
  }
  if (/\b(make it softer|softer|gentler|less intense|easier)\b/.test(normalized)) {
    return "softer";
  }
  if (/\b(what do you mean|clarify|how so|why that)\b/.test(normalized)) {
    return "clarify";
  }
  if (
    /\b((should|can|could|would)\s+i\s+(wear|use|used|keep on|add|added|combine|combined|pair)|what if i (wear|wore|use|used|add|added|combine|combined)|can i keep|can i add|should i add|would it help if i wore)\b/.test(
      normalized,
    ) &&
    /\b(with|while|during|along with|on top of|at the same time|doing it|that|instead)\b/.test(normalized)
  ) {
    return "combine_item";
  }
  if (/\b(where should it go|where does it go|how should i use it|oral or anal|which one|which hole)\b/.test(normalized)) {
    return "use_mode";
  }
  if (/\b(how long|for how long|duration|how many minutes)\b/.test(normalized)) {
    return "duration";
  }
  if (/\bwhat about (throat|oral|anal|chastity|bondage|obedience)\b/.test(normalized)) {
    return "switch_subject";
  }
  if (
    /^(that makes sense|exactly|yeah|yes|okay|ok|right|i see|got it|makes sense)\b/.test(
      normalized,
    )
  ) {
    return "acknowledge";
  }
  return "none";
}

function buildRecommendation(thread: TrainingThreadState, inventory?: SessionInventoryItem[] | null): string {
  const item = thread.item_name ?? preferredItemForSubject(thread.subject, inventory);
  const withItem = item ? ` with your ${item}` : "";
  const formatVariant = (variant: string): string => {
    if (!variant) {
      return "";
    }
    if (item && new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(variant)) {
      return variant;
    }
    return `${variant}${withItem}`;
  };
  switch (thread.subject) {
    case "anal":
      return `Given what you are asking for, I would start you with anal control${withItem}: ${formatVariant(thread.primary_variant)} first, not rushing for depth. That gives me patience, control, and something real to read instead of bravado. If you want the other angle, I could also make it ${formatVariant(thread.alternate_variant)}.`;
    case "throat":
      return `Given what you are asking for, I would start you with throat control${withItem}: ${formatVariant(thread.primary_variant)}, breathing, and clean resets. I want steadiness first, not showmanship. If you want the other angle, I could also make it ${formatVariant(thread.alternate_variant)}.`;
    case "chastity":
      return `Given what you are asking for, I would start you with chastity discipline${withItem}: ${formatVariant(thread.primary_variant)} and clean accountability, not vague denial talk. If you want the other angle, I could also make it ${formatVariant(thread.alternate_variant)}.`;
    case "bondage":
      return `Given what you are asking for, I would start you with bondage discipline${withItem}: ${formatVariant(thread.primary_variant)}, posture, and exact check-ins so the restraint actually changes your behavior. If you want the other angle, I could also make it ${formatVariant(thread.alternate_variant)}.`;
    default:
      return `Given what you are asking for, I would start you with obedience training: ${thread.primary_variant}, exact answers, and enough repetition that it stops being decorative and starts costing you something real. If you want the other angle, I could also make it ${thread.alternate_variant}.`;
  }
}

function buildUseModeReply(thread: TrainingThreadState): string {
  if (thread.subject === "anal") {
    return `For this line, anal. I want the pressure in the body and the control around how you take it, not a vague prop use.`;
  }
  if (thread.subject === "throat") {
    return `For this line, oral. I want control over depth, breathing, and resets, not just the toy being present in the room.`;
  }
  if (thread.item_name) {
    return `Use your ${thread.item_name} in the way that fits the line I just gave you. The point is not improvising the item. The point is keeping the training clean.`;
  }
  return "Use it in the way that fits the line I just gave you. If the use mode matters, I will tell you directly instead of making you guess.";
}

function buildCombinationReply(
  thread: TrainingThreadState,
  item: SessionInventoryItem | null,
): string {
  if (!item) {
    return `Maybe, if it serves the same line instead of muddying it. Keep the main training clean first, then layer anything extra only if it adds control instead of noise.`;
  }

  const itemName = getSessionInventoryDisplayName(item);
  const semantics = describeInventorySemantics(item);

  if ((thread.subject === "anal" || thread.subject === "throat") && semantics.isChastity) {
    return `Yes. You can keep your ${itemName} on while you do it if you want the control layered. The ${thread.item_name ?? "toy"} line stays the main focus, and the ${itemName} just adds denial and another rule to live inside. If you want the cleanest read on the training, do the first round without it, then add the ${itemName} on the next pass.`;
  }

  if ((thread.subject === "anal" || thread.subject === "throat") && semantics.isRestraint) {
    return `Yes, if the ${itemName} keeps the line cleaner instead of clumsier. Use it to add obedience or stillness around the drill, but if it starts compromising your handling, keep the ${thread.item_name ?? "toy"} work clean and add the ${itemName} on the next round instead.`;
  }

  if (thread.subject === "bondage" && semantics.isInsertableToy) {
    return `You can, but do not make the toy the point by accident. If you add your ${itemName}, the restraint still needs to stay the main line and the toy should only add pressure, not replace the discipline.`;
  }

  if (thread.subject === "chastity" && semantics.isInsertableToy) {
    return `You can pair your ${itemName} with the chastity line if you want the denial to have some pressure around it, but keep the protocol clean. The cage is still the rule. The ${itemName} only makes the rule harder to live inside.`;
  }

  if (semantics.isInsertableToy && thread.item_name) {
    return `Not on top of the current ${thread.item_name}. Keep one insertable line clean at a time unless you are explicitly switching the drill.`;
  }

  if (semantics.isWearable || semantics.isVisualGear) {
    return `Yes, if your ${itemName} supports the same pressure instead of distracting from it. Keep the current training as the main line, and let the ${itemName} add accountability, not chaos.`;
  }

  return `Maybe, but only if your ${itemName} sharpens the same line instead of making it messier. Keep the current training clean first, then layer it only if it adds control instead of noise.`;
}

function buildAcknowledgementReply(thread: TrainingThreadState): string {
  switch (thread.subject) {
    case "anal":
      return "Exactly. That line only means something if you keep the pace controlled once the pressure stops flattering you.";
    case "throat":
      return "Exactly. The point is not depth for show. The point is whether you can stay steady once your breathing and control are under pressure.";
    case "chastity":
      return "Exactly. Chastity only means something when the rule is still intact after the novelty burns off.";
    case "bondage":
      return "Exactly. Restraint is only useful if it changes your obedience, not just the shape you make inside it.";
    default:
      return "Exactly. It only matters if the rule stays clean and your answers stay precise once the pressure is real.";
  }
}

export function buildTrainingRecommendationReply(input: {
  userText: string;
  inventory?: SessionInventoryItem[] | null;
  thread?: TrainingThreadState | null;
}): string | null {
  const subject = recommendSubject(input.userText, input.inventory, input.thread ?? null);
  if (subject === "none") {
    return null;
  }
  const item = preferredItemForSubject(subject, input.inventory);
  const base = baseThreadForSubject(subject);
  const variants = defaultVariantsForSubject(subject);
  const thread: TrainingThreadState = {
    subject,
    item_name: item,
    primary_variant: variants.primary,
    alternate_variant: variants.alternate,
    ...base,
    last_response: "",
  };
  return buildRecommendation(thread, input.inventory);
}

export function buildTrainingFollowUpReply(input: {
  userText: string;
  thread: TrainingThreadState | null | undefined;
  inventory?: SessionInventoryItem[] | null;
}): string | null {
  const thread = input.thread;
  if (!thread || thread.subject === "none") {
    if (classifyOperation(input.userText) === "recommendation") {
      return buildTrainingRecommendationReply(input);
    }
    return null;
  }

  const operation = classifyOperation(input.userText);
  switch (operation) {
    case "recommendation":
      return buildRecommendation(thread, input.inventory);
    case "depth":
      return thread.depth_guidance
        ? `${thread.depth_guidance} ${thread.rationale}`
        : `Depth is not the real variable there. ${thread.rationale}`;
    case "rationale":
      return thread.rationale;
    case "proof":
      return thread.proof_requirement;
    case "alternate":
      if (!thread.alternate_variant) {
        return `I would keep the same line. ${thread.rationale}`;
      }
      return `Fine. Then I would switch you to ${
        thread.item_name && !new RegExp(`\\b${thread.item_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(thread.alternate_variant)
          ? `${thread.alternate_variant} with your ${thread.item_name}`
          : thread.alternate_variant
      }. ${thread.rationale}`;
    case "stricter":
      return `Fine. Then I keep ${thread.primary_variant || "the same line"}${thread.item_name ? ` with your ${thread.item_name}` : ""}, but make it stricter: tighter pacing, cleaner check-ins, and no softening once the pressure starts to bite. ${thread.proof_requirement}`;
    case "softer":
      return `Fine. Then I keep ${thread.primary_variant || "the same line"}${thread.item_name ? ` with your ${thread.item_name}` : ""}, but make it softer: cleaner pacing, shorter holds, and less pressure without losing the point of it. ${thread.proof_requirement}`;
    case "clarify":
      return `I mean ${thread.focus}. That is the part I am actually trying to change, not just the label on the training.`;
    case "combine_item": {
      const referencedItem = findReferencedInventoryItem(
        input.userText,
        input.inventory,
        thread.item_name,
      );
      return buildCombinationReply(thread, referencedItem);
    }
    case "use_mode":
      return buildUseModeReply(thread);
    case "duration":
      return `For this line, ${thread.recommended_duration}`;
    case "switch_subject": {
      const nextSubject = detectSubject(input.userText);
      if (nextSubject === "none") {
        return null;
      }
      return buildTrainingRecommendationReply({
        userText: input.userText,
        inventory: input.inventory,
        thread: {
          ...thread,
          subject: nextSubject,
        },
      });
    }
    case "acknowledge":
      return buildAcknowledgementReply(thread);
    default:
      return null;
  }
}
