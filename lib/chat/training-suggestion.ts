import {
  describeInventorySemantics,
  getSessionInventoryDisplayName,
  type SessionInventoryItem,
} from "../session/session-inventory.ts";

type TrainingSubject = "general" | "throat" | "anal" | "chastity" | "bondage";

type TrainingSuggestionInput = {
  question: string;
  inventory?: SessionInventoryItem[] | null;
  previousAssistantText?: string | null;
};

type TrainingVariant = {
  marker: string;
  text: string;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function availableInventory(items: SessionInventoryItem[] | null | undefined): SessionInventoryItem[] {
  return (items ?? []).filter((item) => item.available_this_session);
}

function detectTrainingSubject(text: string): TrainingSubject | null {
  const normalized = normalize(text);
  if (!/\btraining\b/.test(normalized)) {
    return null;
  }
  if (/\b(throat|oral|mouth|jaw|gag)\b/.test(normalized)) {
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
  return "general";
}

function pickInsertableItem(items: SessionInventoryItem[], preferOral: boolean): SessionInventoryItem | null {
  const matching = items.filter((item) => describeInventorySemantics(item).isInsertableToy);
  if (matching.length === 0) {
    return null;
  }
  if (preferOral) {
    return (
      matching.find((item) => /\b(dildo|silicone dildo)\b/i.test(`${item.label} ${item.notes}`)) ??
      matching[0] ??
      null
    );
  }
  return matching[0] ?? null;
}

function pickChastityItem(items: SessionInventoryItem[]): SessionInventoryItem | null {
  return items.find((item) => describeInventorySemantics(item).isChastity) ?? null;
}

function pickBondageItems(items: SessionInventoryItem[]): SessionInventoryItem[] {
  return items.filter((item) => {
    const semantics = describeInventorySemantics(item);
    return semantics.isRestraint || /\b(collar|leash)\b/i.test(`${item.label} ${item.notes}`);
  });
}

function chooseVariant(variants: TrainingVariant[], previousAssistantText?: string | null): TrainingVariant {
  const previous = normalize(previousAssistantText ?? "");
  if (!previous) {
    return variants[0]!;
  }
  const matchedIndex = variants.findIndex((variant) => previous.includes(variant.marker));
  if (matchedIndex === -1) {
    return variants[0]!;
  }
  return variants[(matchedIndex + 1) % variants.length]!;
}

function buildSubjectReply(
  subject: Exclude<TrainingSubject, "general">,
  item: SessionInventoryItem,
  previousAssistantText?: string | null,
): string {
  const itemName = getSessionInventoryDisplayName(item);
  const itemText = normalize(`${item.label} ${item.notes}`);
  let variants: TrainingVariant[] = [];
  let label = subject;

  if (subject === "throat") {
    label = "throat";
    variants = [
      {
        marker: "paced throat-control drill",
        text: `a paced throat-control drill with your ${itemName}: short controlled dips, a clean reset each time, and no rushing just to impress me`,
      },
      {
        marker: "oral endurance line",
        text: `an oral endurance line with your ${itemName}: steady depth, controlled breathing, and deliberate pauses instead of sloppy bravado`,
      },
    ];
  } else if (subject === "anal") {
    label = "anal";
    variants = [
      {
        marker: "slow anal hold",
        text: `a slow anal hold with your ${itemName}: settle it, hold the pressure on a timer, ease off cleanly, and repeat without getting sloppy`,
      },
      {
        marker: "paced anal intervals",
        text: `paced anal intervals with your ${itemName}: work in, pause, reset, and keep the whole line deliberate instead of greedy`,
      },
    ];
  } else if (subject === "chastity") {
    label = "chastity";
    variants = [
      {
        marker: "timed chastity protocol",
        text: `a timed chastity protocol with your ${itemName}: lock it on, keep clean check-ins, and do not bargain with the rule once it is set`,
      },
      {
        marker: "denial-and-report line",
        text: `a denial-and-report line with your ${itemName}: wear it, stay accountable, and answer cleanly at each check-in without padding`,
      },
    ];
  } else if (/\b(collar|leash)\b/.test(itemText)) {
    label = "bondage";
    variants = [
      {
        marker: "collar-led obedience drill",
        text: `a collar-led obedience drill with your ${itemName}: posture, clean answers, and no shifting the subject without permission`,
      },
      {
        marker: "bondage patience line",
        text: `a bondage patience line with your ${itemName}: keep the collar on, hold the posture I give you, and stay precise instead of performative`,
      },
    ];
  } else {
    label = "bondage";
    variants = [
      {
        marker: "restrained obedience protocol",
        text: `a restrained obedience protocol with your ${itemName}: hands secured, clean answers, and no adjusting yourself unless I allow it`,
      },
      {
        marker: "bondage discipline drill",
        text: `a bondage discipline drill with your ${itemName}: timed holds, deliberate stillness only when I ask for it, and exact check-ins`,
      },
    ];
  }

  const primary = chooseVariant(variants, previousAssistantText);
  const alternate = variants.find((variant) => variant.marker !== primary.marker) ?? primary;
  return `For ${label} training, I would start with ${primary.text}. If you want the other angle, I could also make it ${alternate.text}.`;
}

function buildGenericSubjectReply(
  subject: Exclude<TrainingSubject, "general">,
  previousAssistantText?: string | null,
): string {
  let variants: TrainingVariant[] = [];
  let label = subject;

  if (subject === "throat") {
    label = "throat";
    variants = [
      {
        marker: "paced throat-control drill",
        text: "a paced throat-control drill: short controlled depth, steady breathing, and clean resets instead of rushing for effect",
      },
      {
        marker: "oral endurance line",
        text: "an oral endurance line: controlled depth, timed holds, and deliberate pauses so the whole thing stays exact instead of sloppy",
      },
    ];
  } else if (subject === "anal") {
    label = "anal";
    variants = [
      {
        marker: "slow anal hold",
        text: "a slow anal hold: settle into the pressure, hold it on a timer, ease off cleanly, and repeat without rushing",
      },
      {
        marker: "paced anal intervals",
        text: "paced anal intervals: work in, pause, reset, and repeat on a timer so the whole line stays deliberate instead of greedy",
      },
    ];
  } else if (subject === "chastity") {
    label = "chastity";
    variants = [
      {
        marker: "timed chastity protocol",
        text: "a timed chastity protocol: lock up, keep one clean halfway check-in, and do not bargain with the rule once it is set",
      },
      {
        marker: "denial-and-report line",
        text: "a denial-and-report line: wear the device, stay accountable, and answer cleanly at each check-in without padding",
      },
    ];
  } else {
    label = "bondage";
    variants = [
      {
        marker: "restrained obedience protocol",
        text: "a restrained obedience protocol: wrists secured, posture held, and clean answers at each check-in instead of decorative posing",
      },
      {
        marker: "bondage discipline drill",
        text: "a bondage discipline drill: timed holds, exact check-ins, and no adjusting unless the rule allows it",
      },
    ];
  }

  const primary = chooseVariant(variants, previousAssistantText);
  const alternate = variants.find((variant) => variant.marker !== primary.marker) ?? primary;
  return `For ${label} training, I would start with ${primary.text}. If you want the other angle, I could also make it ${alternate.text}.`;
}

function buildGeneralReply(
  items: SessionInventoryItem[],
  previousAssistantText?: string | null,
): string | null {
  const options: string[] = [];
  const throatItem = pickInsertableItem(items, true);
  const analItem = pickInsertableItem(items, false);
  const chastityItem = pickChastityItem(items);
  const bondageItems = pickBondageItems(items);

  if (throatItem) {
    const reply = buildSubjectReply("throat", throatItem, previousAssistantText);
    options.push(reply.replace(/^For throat training, I would start with /i, "").replace(/\.\s*If you want.*$/i, ""));
  }
  if (analItem) {
    const reply = buildSubjectReply("anal", analItem, previousAssistantText);
    options.push(reply.replace(/^For anal training, I would start with /i, "").replace(/\.\s*If you want.*$/i, ""));
  }
  if (chastityItem) {
    const reply = buildSubjectReply("chastity", chastityItem, previousAssistantText);
    options.push(reply.replace(/^For chastity training, I would start with /i, "").replace(/\.\s*If you want.*$/i, ""));
  }
  if (bondageItems[0]) {
    const reply = buildSubjectReply("bondage", bondageItems[0], previousAssistantText);
    options.push(reply.replace(/^For bondage training, I would start with /i, "").replace(/\.\s*If you want.*$/i, ""));
  }

  const uniqueOptions = options.filter((value, index, array) => array.indexOf(value) === index).slice(0, 3);
  if (uniqueOptions.length === 0) {
    return null;
  }
  return `Today I would keep it concrete. I could make it ${uniqueOptions.join(" Or I could make it ")}. Tell me whether you want throat, anal, chastity, or bondage pressure first.`;
}

export function buildInventoryAwareTrainingReply(
  input: TrainingSuggestionInput,
): string | null {
  const subject = detectTrainingSubject(input.question);
  if (!subject) {
    return null;
  }
  const items = availableInventory(input.inventory);
  if (items.length === 0) {
    if (subject === "general") {
      return null;
    }
    return buildGenericSubjectReply(subject, input.previousAssistantText);
  }

  if (subject === "general") {
    return buildGeneralReply(items, input.previousAssistantText);
  }
  if (subject === "throat") {
    const item = pickInsertableItem(items, true);
    return item ? buildSubjectReply("throat", item, input.previousAssistantText) : null;
  }
  if (subject === "anal") {
    const item = pickInsertableItem(items, false);
    return item ? buildSubjectReply("anal", item, input.previousAssistantText) : null;
  }
  if (subject === "chastity") {
    const item = pickChastityItem(items);
    return item ? buildSubjectReply("chastity", item, input.previousAssistantText) : null;
  }
  const item = pickBondageItems(items)[0];
  return item ? buildSubjectReply("bondage", item, input.previousAssistantText) : null;
}
