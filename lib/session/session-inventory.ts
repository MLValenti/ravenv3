export type SessionInventoryCategory = "device" | "clothing" | "accessory" | "toy" | "other";

export type SessionInventoryItem = {
  id: string;
  label: string;
  category: SessionInventoryCategory;
  available_this_session: boolean;
  intiface_controlled: boolean;
  linked_device_id: string | null;
  notes: string;
};

export type InventorySemantics = {
  descriptor: string;
  isWearable: boolean;
  isRestraint: boolean;
  isChastity: boolean;
  isVisualGear: boolean;
  isInsertableToy: boolean;
  isClothingLike: boolean;
  supportsPostureTask: boolean;
  supportsFrameTask: boolean;
};

export type InventoryGroundingConfidence = "high" | "medium" | "low";

export type InventoryGroundingLookupDecision = {
  shouldUseFallbackLookup: boolean;
  confidence: InventoryGroundingConfidence;
  reason: string;
  source: "local_metadata" | "fallback_catalog" | "unresolved";
};

export type ResolvedInventoryGrounding = {
  semantics: InventorySemantics;
  lookup: InventoryGroundingLookupDecision;
  allowedUseModes: string[];
};

export const SESSION_INVENTORY_STORAGE_KEY = "raven.session.inventory";

type InventoryFallbackKnowledge = {
  patterns: RegExp[];
  semantics: Partial<InventorySemantics> & { descriptor: string };
  allowedUseModes?: string[];
};

const VALID_CATEGORIES = new Set<SessionInventoryCategory>([
  "device",
  "clothing",
  "accessory",
  "toy",
  "other",
]);

function normalizeCategory(value: unknown): SessionInventoryCategory {
  if (typeof value === "string" && VALID_CATEGORIES.has(value as SessionInventoryCategory)) {
    return value as SessionInventoryCategory;
  }
  return "other";
}

function sanitizeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function sanitizeNotes(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

function sanitizeLinkedDeviceId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function semanticsText(item: SessionInventoryItem): string {
  return normalizeForMatch(`${item.label} ${item.notes}`);
}

const INVENTORY_FALLBACK_KNOWLEDGE: InventoryFallbackKnowledge[] = [
  {
    patterns: [/\baneros\b/i, /\bhelix\b/i, /\bprostate massager\b/i],
    semantics: {
      descriptor: "prostate massager anal toy",
      isInsertableToy: true,
      isWearable: false,
      isRestraint: false,
      isChastity: false,
      isVisualGear: false,
      isClothingLike: false,
      supportsPostureTask: false,
      supportsFrameTask: false,
    },
    allowedUseModes: ["anal", "prop"],
  },
  {
    patterns: [/\bhitachi\b/i, /\bmagic wand\b/i],
    semantics: {
      descriptor: "wand vibrator external toy",
      isInsertableToy: false,
      isWearable: false,
      isRestraint: false,
      isChastity: false,
      isVisualGear: false,
      isClothingLike: false,
      supportsPostureTask: false,
      supportsFrameTask: false,
    },
    allowedUseModes: ["external", "prop"],
  },
];

function userTextMentionsExplicitUseMode(userText: string): boolean {
  const normalized = normalizeForMatch(userText);
  return /\b(oral|mouth|throat|anal|anus|wear|wearing|locked|lock it|in frame|visible|inspection|hands behind|restrain|restraint|cuffs?)\b/.test(
    normalized,
  );
}

function isGenericInventoryLabel(label: string): boolean {
  return GENERIC_INVENTORY_LABELS.includes(normalizeForMatch(label));
}

function hasSpecificInventoryNotes(item: SessionInventoryItem): boolean {
  const notes = item.notes.trim();
  if (!notes) {
    return false;
  }
  const normalizedNotes = normalizeForMatch(notes);
  if (GENERIC_INVENTORY_LABELS.includes(normalizedNotes)) {
    return false;
  }
  const noteWords = normalizedNotes.split(/\s+/).filter(Boolean);
  if (noteWords.length >= 2) {
    return true;
  }
  return normalizedNotes.length > 8;
}

export function normalizeSessionInventory(value: unknown): SessionInventoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const items: SessionInventoryItem[] = [];
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }
    const candidate = rawItem as Partial<SessionInventoryItem>;
    const label = sanitizeLabel(candidate.label);
    if (!label) {
      continue;
    }
    const id = sanitizeLabel(candidate.id) || `inv-${items.length + 1}`;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    items.push({
      id,
      label,
      category: normalizeCategory(candidate.category),
      available_this_session: candidate.available_this_session !== false,
      intiface_controlled: candidate.intiface_controlled === true,
      linked_device_id: sanitizeLinkedDeviceId(candidate.linked_device_id),
      notes: sanitizeNotes(candidate.notes),
    });
  }
  return items;
}

function describeLocalInventorySemantics(item: SessionInventoryItem): InventorySemantics {
  const descriptor = semanticsText(item);
  const isChastity = /\b(chastity|cage|belt|locked|lock)\b/.test(descriptor);
  const isRestraint = /\b(cuffs?|restraints?|shackles?|rope|ties?|binder|collar|leash)\b/.test(
    descriptor,
  );
  const isVisualGear = /\b(blindfold|hood|mask|collar|leash|frame|inspection)\b/.test(descriptor);
  const isInsertableToy = /\b(dildo|plug|vibe|vibrator|wand|anal toy|insertable)\b/.test(descriptor);
  const isClothingLike =
    item.category === "clothing" ||
    /\b(dress|skirt|heels?|stockings|corset|bra|panties|underwear|shirt)\b/.test(descriptor);
  const isWearable =
    isChastity ||
    isRestraint ||
    isVisualGear ||
    isClothingLike ||
    /\b(wearable|worn|wear)\b/.test(descriptor);
  return {
    descriptor,
    isWearable,
    isRestraint,
    isChastity,
    isVisualGear,
    isInsertableToy,
    isClothingLike,
    supportsPostureTask: isRestraint || isClothingLike || /\b(collar|leash)\b/.test(descriptor),
    supportsFrameTask: isVisualGear || isClothingLike || /\b(collar|leash)\b/.test(descriptor),
  };
}

function findInventoryFallbackKnowledge(item: SessionInventoryItem): InventoryFallbackKnowledge | null {
  const descriptor = `${item.label} ${item.notes}`;
  return (
    INVENTORY_FALLBACK_KNOWLEDGE.find((entry) =>
      entry.patterns.some((pattern) => pattern.test(descriptor)),
    ) ?? null
  );
}

function mergeInventorySemantics(
  base: InventorySemantics,
  fallback: InventoryFallbackKnowledge | null,
): InventorySemantics {
  if (!fallback) {
    return base;
  }
  return {
    descriptor: fallback.semantics.descriptor || base.descriptor,
    isWearable: fallback.semantics.isWearable ?? base.isWearable,
    isRestraint: fallback.semantics.isRestraint ?? base.isRestraint,
    isChastity: fallback.semantics.isChastity ?? base.isChastity,
    isVisualGear: fallback.semantics.isVisualGear ?? base.isVisualGear,
    isInsertableToy: fallback.semantics.isInsertableToy ?? base.isInsertableToy,
    isClothingLike: fallback.semantics.isClothingLike ?? base.isClothingLike,
    supportsPostureTask: fallback.semantics.supportsPostureTask ?? base.supportsPostureTask,
    supportsFrameTask: fallback.semantics.supportsFrameTask ?? base.supportsFrameTask,
  };
}

function defaultUseModesForSemantics(semantics: InventorySemantics): string[] {
  if (semantics.isInsertableToy) {
    return ["oral", "anal", "prop"];
  }
  if (semantics.isChastity) {
    return ["wear", "lock"];
  }
  return [];
}

export function decideInventoryGroundingLookup(
  item: SessionInventoryItem,
): InventoryGroundingLookupDecision {
  const localSemantics = describeLocalInventorySemantics(item);
  const hasLocalSpecifics =
    localSemantics.isChastity ||
    localSemantics.isRestraint ||
    localSemantics.isVisualGear ||
    localSemantics.isInsertableToy ||
    localSemantics.isClothingLike ||
    hasSpecificInventoryNotes(item);
  if (hasLocalSpecifics) {
    return {
      shouldUseFallbackLookup: false,
      confidence: "high",
      reason: "local_metadata_is_specific",
      source: "local_metadata",
    };
  }
  const fallback = findInventoryFallbackKnowledge(item);
  if (fallback) {
    return {
      shouldUseFallbackLookup: true,
      confidence: "medium",
      reason: "local_metadata_is_weak_but_fallback_catalog_matches",
      source: "fallback_catalog",
    };
  }
  return {
    shouldUseFallbackLookup: true,
    confidence: "low",
    reason: "local_metadata_is_weak_and_item_remains_unresolved",
    source: "unresolved",
  };
}

export function resolveInventoryGrounding(item: SessionInventoryItem): ResolvedInventoryGrounding {
  const localSemantics = describeLocalInventorySemantics(item);
  const lookup = decideInventoryGroundingLookup(item);
  const fallback =
    lookup.shouldUseFallbackLookup && lookup.source === "fallback_catalog"
      ? findInventoryFallbackKnowledge(item)
      : null;
  const semantics = mergeInventorySemantics(localSemantics, fallback);
  return {
    semantics,
    lookup,
    allowedUseModes: fallback?.allowedUseModes ?? defaultUseModesForSemantics(semantics),
  };
}

export function describeInventorySemantics(item: SessionInventoryItem): InventorySemantics {
  return resolveInventoryGrounding(item).semantics;
}

export function assessInventoryTaskCompatibility(
  item: SessionInventoryItem,
  taskKind: "device_hold" | "frame_hold" | "stillness_hold" | "posture_hold",
  userText = "",
): { compatible: boolean; needsClarification: boolean; reason: string } {
  const { semantics } = resolveInventoryGrounding(item);
  const explicitUseMode = userTextMentionsExplicitUseMode(userText);

  if (semantics.isInsertableToy && !explicitUseMode) {
    return {
      compatible: false,
      needsClarification: true,
      reason: "insertable_item_requires_use_mode",
    };
  }

  if (taskKind === "device_hold") {
    if (
      semantics.isChastity ||
      semantics.isInsertableToy ||
      item.intiface_controlled ||
      item.category === "device" ||
      item.category === "toy" ||
      item.category === "accessory"
    ) {
      return { compatible: true, needsClarification: false, reason: "device_compatible" };
    }
    return { compatible: false, needsClarification: false, reason: "not_device_compatible" };
  }

  if (taskKind === "posture_hold") {
    if (semantics.supportsPostureTask) {
      return { compatible: true, needsClarification: false, reason: "posture_compatible" };
    }
    if (semantics.isInsertableToy) {
      return { compatible: false, needsClarification: false, reason: "insertable_not_posture_grounded" };
    }
    return { compatible: semantics.isWearable, needsClarification: false, reason: "wearable_posture_fallback" };
  }

  if (taskKind === "frame_hold") {
    if (semantics.supportsFrameTask) {
      return { compatible: true, needsClarification: false, reason: "frame_compatible" };
    }
    if (semantics.isInsertableToy) {
      return { compatible: false, needsClarification: false, reason: "insertable_not_frame_grounded" };
    }
    return { compatible: semantics.isWearable, needsClarification: false, reason: "wearable_frame_fallback" };
  }

  if (taskKind === "stillness_hold") {
    if (semantics.isInsertableToy) {
      return { compatible: false, needsClarification: false, reason: "insertable_not_stillness_grounded" };
    }
    return {
      compatible: semantics.isWearable || semantics.isChastity || semantics.isVisualGear,
      needsClarification: false,
      reason: "stillness_compatibility_checked",
    };
  }

  return { compatible: true, needsClarification: false, reason: "compatible" };
}

export function loadSessionInventoryFromStorage(storage: Pick<Storage, "getItem">): SessionInventoryItem[] {
  const raw = storage.getItem(SESSION_INVENTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    return normalizeSessionInventory(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveSessionInventoryToStorage(
  storage: Pick<Storage, "setItem">,
  items: SessionInventoryItem[],
): void {
  storage.setItem(
    SESSION_INVENTORY_STORAGE_KEY,
    JSON.stringify(normalizeSessionInventory(items)),
  );
}

export function buildSessionInventoryContextMessage(items: SessionInventoryItem[]): string {
  const normalized = normalizeSessionInventory(items);
  const lines = normalized
    .map((item) => {
      const displayName = getSessionInventoryDisplayName(item);
      const detail = [
        `${displayName}`,
        `[${item.category}]`,
        `available=${item.available_this_session ? "yes" : "no"}`,
        `intiface=${item.intiface_controlled ? "yes" : "no"}`,
        item.linked_device_id ? `control_device_id=${item.linked_device_id}` : "",
        item.notes ? `description=${item.notes}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `- ${detail}`;
    })
    .slice(0, 24);

  return [
    "Session inventory:",
    "- Only instruct the user to use items marked available=yes.",
    "- Only request device actions for items marked intiface=yes and only when a control_device_id is listed.",
    ...(lines.length > 0 ? lines : ["- No session inventory listed."]),
  ].join("\n");
}

export function findInventoryItemForTask(
  items: SessionInventoryItem[],
  userText: string,
  taskKind: "device_hold" | "frame_hold" | "stillness_hold" | "posture_hold",
): SessionInventoryItem | null {
  const availableItems = normalizeSessionInventory(items).filter((item) => item.available_this_session);
  if (availableItems.length === 0) {
    return null;
  }

  const normalizedUserText = normalizeForMatch(userText);
  const userSignalsChastity = /\b(chastity|cage|belt|locked|lock)\b/.test(normalizedUserText);
  const userSignalsInsertable = /\b(dildo|plug|vibe|vibrator|wand|anal toy|insertable)\b/.test(normalizedUserText);
  const explicitMatch = availableItems.find((item) => {
    const labelMatch = normalizedUserText.includes(normalizeForMatch(item.label));
    const notesMatch = hasSpecificInventoryNotes(item)
      ? normalizedUserText.includes(normalizeForMatch(item.notes))
      : false;
    return labelMatch || notesMatch;
  });
  if (explicitMatch) {
    return explicitMatch;
  }

  const scored = availableItems
    .map((item) => {
      const compatibility = assessInventoryTaskCompatibility(item, taskKind, userText);
      let score = compatibility.compatible ? 4 : 0;
      if (compatibility.needsClarification) {
        score += 3;
      }
      const semantics = describeInventorySemantics(item);
      if (taskKind === "device_hold") {
        if (item.intiface_controlled) {
          score += 3;
        }
        if (semantics.isChastity) {
          score += userSignalsChastity ? 3 : 0.5;
        }
        if (semantics.isInsertableToy) {
          score += userSignalsInsertable ? 3 : 1;
        }
      }
      if (taskKind === "posture_hold" && semantics.supportsPostureTask) {
        score += 3;
      }
      if (taskKind === "frame_hold" && semantics.supportsFrameTask) {
        score += 3;
      }
      if (taskKind === "stillness_hold" && semantics.isVisualGear) {
        score += 1;
      }
      return { item, score };
    })
    .sort((left, right) => right.score - left.score);

  if ((scored[0]?.score ?? 0) > 0) {
    return scored[0]?.item ?? null;
  }

  if (taskKind === "device_hold") {
    const intifaceMatch = availableItems.find(
      (item) => item.intiface_controlled && typeof item.linked_device_id === "string" && item.linked_device_id.length > 0,
    );
    if (intifaceMatch) {
      return intifaceMatch;
    }
    const deviceLikeMatch = availableItems.find((item) =>
      item.category === "device" || item.category === "toy" || item.category === "accessory",
    );
    if (deviceLikeMatch) {
      return deviceLikeMatch;
    }
  }

  return null;
}

export function getSessionInventoryDisplayName(item: SessionInventoryItem): string {
  if (isGenericInventoryLabel(item.label) && hasSpecificInventoryNotes(item)) {
    return item.notes.trim().slice(0, 40);
  }
  return item.label.trim().slice(0, 40);
}

export function formatInventoryTitleSuffix(item: SessionInventoryItem | null): string {
  if (!item) {
    return "";
  }
  return ` (${getSessionInventoryDisplayName(item).slice(0, 28)})`;
}

const GENERIC_INVENTORY_LABELS = [
  "device",
  "toy",
  "clothes",
  "clothing",
  "gear",
  "item",
  "stuff",
  "thing",
  "accessory",
  "tool",
];

export function needsInventoryClarification(
  item: SessionInventoryItem | null,
  userText = "",
): boolean {
  if (!item) {
    return false;
  }
  const { semantics, lookup } = resolveInventoryGrounding(item);
  const normalizedLabel = normalizeForMatch(item.label);
  if (!normalizedLabel) {
    return true;
  }
  if (lookup.source === "unresolved") {
    return true;
  }
  if (semantics.isInsertableToy && !userTextMentionsExplicitUseMode(userText)) {
    return true;
  }
  if (isGenericInventoryLabel(item.label) && !hasSpecificInventoryNotes(item)) {
    return true;
  }
  if (item.category === "other" && !hasSpecificInventoryNotes(item)) {
    return true;
  }
  if (normalizedLabel.split(/\s+/).length === 1 && normalizedLabel.length <= 4 && !hasSpecificInventoryNotes(item)) {
    return true;
  }
  return false;
}

export function buildInventoryClarificationQuestion(item: SessionInventoryItem): string {
  const label = item.label.trim();
  const grounding = resolveInventoryGrounding(item);
  const semantics = grounding.semantics;
  if (grounding.lookup.source === "unresolved") {
    return `Be specific, pet. I do not have a clean read on what "${label}" is. Tell me exactly what it is and how it is realistically used this session.`;
  }
  if (grounding.allowedUseModes.length > 0 && semantics.isInsertableToy) {
    const modeList = grounding.allowedUseModes;
    const renderedModes =
      modeList.length === 1
        ? modeList[0]
        : modeList.length === 2
          ? `${modeList[0]} or ${modeList[1]}`
          : `${modeList.slice(0, -1).join(", ")}, or ${modeList[modeList.length - 1]}`;
    return `Be specific, pet. Tell me whether "${label}" is meant for ${renderedModes} for this task.`;
  }
  if (item.category === "clothing") {
    return `Be specific, pet. Tell me exactly what "${label}" is and how you want it used this session.`;
  }
  if (item.intiface_controlled && item.linked_device_id) {
    return `Be specific, pet. Tell me exactly what "${label}" is and what that linked device is meant to control.`;
  }
  return `Be specific, pet. Tell me exactly what "${label}" is and how it should be used this session.`;
}
