import type { ProfileProgressRow, TaskRow } from "@/lib/db";
import type { ProfileState } from "@/lib/profile";
import {
  buildDeterministicTaskPlanFromRequest,
  detectTaskDomainFromUserText,
  formatTaskDomainLabel,
  taskDomainFromTemplateId,
  type DeterministicTaskPlan,
  type DeterministicTaskTemplateId,
  type TaskDomain,
} from "./task-script.ts";
import {
  assessInventoryTaskCompatibility,
  buildInventoryClarificationQuestion,
  describeInventorySemantics,
  findInventoryItemForTask,
  getSessionInventoryDisplayName,
  needsInventoryClarification,
  type SessionInventoryItem,
} from "./session-inventory.ts";

export type TaskSpecDifficulty = "unspecified" | "easy" | "moderate" | "hard";

export type TaskSpecProofType =
  | "unspecified"
  | "none"
  | "halfway_checkin"
  | "final_proof"
  | "halfway_and_final";

export type TaskSpecMissingSlot =
  | "requested_domain"
  | "available_items"
  | "duration_minutes"
  | "inventory_details"
  | "difficulty"
  | "combine_mode"
  | "proof_or_checkin_type";

export type TaskRequestStage =
  | "idle"
  | "collecting_blockers"
  | "presenting_options"
  | "awaiting_selection"
  | "ready_to_fulfill"
  | "fulfilled";

export type TaskNextRequiredAction =
  | "none"
  | "ask_blocker"
  | "present_options"
  | "await_selection"
  | "fulfill_request";

export type TaskSelectionMode =
  | "direct_assignment"
  | "curated_options"
  | "collaborative_narrowing";

export type TaskRequestKind =
  | "fresh_assignment"
  | "replacement"
  | "revision"
  | "reroll";

export type TaskNoveltyPressure = "normal" | "high";

type TaskKind = "device_hold" | "frame_hold" | "stillness_hold" | "posture_hold";

export type TaskPresentedOption = {
  title: string;
  family: string;
  domain: TaskDomain;
  template_id: DeterministicTaskTemplateId;
  variant_index: number;
};

export type TaskSpec = {
  requested_domain: TaskDomain | "none";
  user_goal: string;
  available_items: string[];
  duration_minutes: number | null;
  difficulty: TaskSpecDifficulty;
  repeat_count: number | null;
  proof_or_checkin_type: TaskSpecProofType;
  modifiers: string[];
  active_constraints: string[];
  missing_slots: TaskSpecMissingSlot[];
  current_task_domain: TaskDomain;
  locked_task_domain: TaskDomain | "none";
  can_replan_task: boolean;
  reason_for_lock: string;
  asked_question_slots: TaskSpecMissingSlot[];
  unresolved_blockers: TaskSpecMissingSlot[];
  resolved_blockers: TaskSpecMissingSlot[];
  request_stage: TaskRequestStage;
  next_required_action: TaskNextRequiredAction;
  fulfillment_locked: boolean;
  request_fulfilled: boolean;
  last_asked_blocker: TaskSpecMissingSlot | null;
  last_resolved_blocker: TaskSpecMissingSlot | null;
  relevant_inventory_item: string;
  inventory_clarification_question: string;
  selection_mode: TaskSelectionMode;
  request_kind: TaskRequestKind;
  allow_raven_to_choose_alone: boolean;
  excluded_task_categories: TaskDomain[];
  preferred_task_categories: TaskDomain[];
  available_task_categories: TaskDomain[];
  current_task_family: string;
  avoid_task_families: string[];
  recent_task_families: string[];
  novelty_pressure: TaskNoveltyPressure;
  presented_options: TaskPresentedOption[];
  selected_option_title: string;
  requires_bondage_compatibility: boolean;
  preserve_current_family: boolean;
};

export type TaskHistoryFingerprint = {
  title: string;
  description: string;
  repeats_required: number;
  domain: TaskDomain | "general";
};

export type TaskNoveltyBreakdown = {
  total_similarity: number;
  title_similarity: number;
  structure_similarity: number;
  modifier_similarity: number;
  domain_penalty: number;
  duration_penalty: number;
};

export type TaskCandidate = {
  catalog_entry_id: string;
  title: string;
  domain: TaskDomain;
  family: string;
  summary: string;
  steps: string[];
  duration: string;
  difficulty: TaskSpecDifficulty;
  checkin_or_proof_requirement: string;
  why_it_fits: string;
  novelty_check: string;
  strategy: string;
  plan: DeterministicTaskPlan;
  validation: {
    matches_request: boolean;
    novel_enough: boolean;
    respects_lock: boolean;
    actionable: boolean;
    plausible_with_inventory: boolean;
    respects_latest_correction: boolean;
    novelty_score: number;
    novelty_breakdown: TaskNoveltyBreakdown;
    rejection_reasons: string[];
  };
};

type TaskSpecUpdateInput = {
  userText: string;
  inventory?: SessionInventoryItem[];
  currentTaskDomain: TaskDomain;
  lockedTaskDomain: TaskDomain | "none";
  canReplanTask: boolean;
  reasonForLock: string;
  currentUserGoal?: string;
};

type TaskCandidateBuildInput = {
  taskSpec: TaskSpec;
  userText: string;
  sceneType?: string;
  hasStakes?: boolean;
  hasTaskTerms?: boolean;
  allowSilenceHold?: boolean;
  profile?: ProfileState;
  inventory?: SessionInventoryItem[];
  progress?: Pick<
    ProfileProgressRow,
    "current_tier" | "free_pass_count" | "last_completion_summary"
  >;
  currentTemplateId?: DeterministicTaskTemplateId;
  rewardLine?: string;
  consequenceLine?: string;
  stakesLine?: string;
  recentTaskTemplates?: DeterministicTaskTemplateId[];
  taskHistory?: Array<Pick<TaskRow, "title" | "description" | "repeats_required">>;
};

type TaskQuestionDecision = { slot: TaskSpecMissingSlot; question: string };

type TaskCatalogStructure = "hold" | "protocol" | "check";

type TaskCatalogIntensity = "low" | "moderate" | "high";

type TaskCatalogEntry = {
  id: string;
  templateId: DeterministicTaskTemplateId;
  variantIndex: number;
  title: string;
  domain: TaskDomain;
  family: string;
  tags: string[];
  requiredInventory: boolean;
  optionalInventory: boolean;
  durationFit: {
    min: number;
    max: number;
  };
  intensity: TaskCatalogIntensity;
  structureType: TaskCatalogStructure;
  requiresSetup: boolean;
  immediateAssignment: boolean;
  planningOnly: boolean;
  leadInLine: string;
  optionLine: string;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function truncate(text: string, max = 140): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function dedupeList(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(value.trim());
  }
  return next;
}

function dedupeSlots(values: TaskSpecMissingSlot[]): TaskSpecMissingSlot[] {
  return dedupeList(values) as TaskSpecMissingSlot[];
}

function tokenize(text: string): string[] {
  return dedupeList(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function extractGoal(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }
  const patterns = [
    /\b(?:for|to help with|to work on|around|focused on)\s+([^.?!,]+)$/i,
    /\bgoal(?: is|:)?\s+([^.?!,]+)$/i,
    /\b(?:i want|i need)\s+(?:a task|something)\s+(?:for|to)\s+([^.?!,]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const candidate = truncate(match[1], 80);
      if (/^\d+\s*(minute|minutes|hour|hours|min|mins|hr|hrs)$/i.test(candidate)) {
        return "";
      }
      return candidate;
    }
  }
  return "";
}

function extractDifficulty(text: string): TaskSpecDifficulty {
  const normalized = normalize(text);
  if (/\b(easy|light|gentle|simple)\b/.test(normalized)) {
    return "easy";
  }
  if (/\b(medium|moderate|balanced)\b/.test(normalized)) {
    return "moderate";
  }
  if (/\b(hard|strict|intense|difficult|challenging)\b/.test(normalized)) {
    return "hard";
  }
  return "unspecified";
}

function extractRepeatCount(text: string): number | null {
  const normalized = normalize(text);
  const digitMatch = normalized.match(/\b(\d+)\s*(?:reps?|rounds?|times?)\b/);
  if (digitMatch?.[1]) {
    const parsed = Number(digitMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (/\bonce\b/.test(normalized)) {
    return 1;
  }
  if (/\btwice\b/.test(normalized)) {
    return 2;
  }
  return null;
}

function extractDurationMinutes(text: string): number | null {
  const normalized = normalize(text);
  const hourMatch = normalized.match(/\b(\d+)\s*(hour|hours|hr|hrs)\b/);
  if (hourMatch?.[1]) {
    const parsed = Number(hourMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 60 : null;
  }
  const minuteMatch = normalized.match(/\b(\d+)\s*(minute|minutes|min|mins)\b/);
  if (minuteMatch?.[1]) {
    const parsed = Number(minuteMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (/\bhalf an hour\b/.test(normalized)) {
    return 30;
  }
  if (/\bquick\b/.test(normalized)) {
    return 15;
  }
  return null;
}

function extractProofType(text: string): TaskSpecProofType {
  const normalized = normalize(text);
  const asksHalfway = /\b(halfway|half way|check in|check-in)\b/.test(normalized);
  const asksFinal = /\b(proof|verify|verification|show me|final check|in frame)\b/.test(normalized);
  if (asksHalfway && asksFinal) {
    return "halfway_and_final";
  }
  if (asksHalfway) {
    return "halfway_checkin";
  }
  if (asksFinal) {
    return "final_proof";
  }
  if (/\bno proof|no check in|no check-in\b/.test(normalized)) {
    return "none";
  }
  return "unspecified";
}

function extractModifiers(text: string): string[] {
  const normalized = normalize(text);
  const modifiers: string[] = [];
  if (/\bstandalone\b/.test(normalized)) {
    modifiers.push("standalone");
  }
  if (/\b(combine|combined|pair it|pair this|with something else|along with)\b/.test(normalized)) {
    modifiers.push("combined");
  }
  if (/\b(silent|quiet)\b/.test(normalized)) {
    modifiers.push("silence");
  }
  if (/\b(in frame|camera|visible)\b/.test(normalized)) {
    modifiers.push("in_frame");
  }
  if (/\b(interval|checkpoint|staggered|stages)\b/.test(normalized)) {
    modifiers.push("interval");
  }
  return dedupeList(modifiers);
}

function extractConstraints(text: string): string[] {
  const normalized = normalize(text);
  const constraints: string[] = [];
  if (/\b(no public|private only|not in public)\b/.test(normalized)) {
    constraints.push("private_only");
  }
  if (/\b(no device|without a device|no cage)\b/.test(normalized)) {
    constraints.push("no_device");
  }
  if (/\b(no camera|without camera)\b/.test(normalized)) {
    constraints.push("no_camera");
  }
  if (/\b(quiet|silent)\b/.test(normalized)) {
    constraints.push("quiet");
  }
  return dedupeList(constraints);
}

function requestsBondageCompatibleTask(text: string): boolean {
  return /\b(bondage|bound|tied up|tied down|restraint|restrained)\b/i.test(text);
}

function isTaskGroundingCorrection(text: string): boolean {
  const normalized = normalize(text);
  return /\b(doesn'?t make sense|does not make sense|won'?t work|will not work|can'?t do that|cannot do that|wrong item|wrong fit|that item doesn'?t fit|that does not fit|use .* instead)\b/.test(
    normalized,
  );
}

function requestsDifferentItemUse(text: string): boolean {
  return /\b(use .* instead|with my |for my |not for (?:my|the))\b/i.test(text);
}

function isDurationRevisionRequest(text: string): boolean {
  const normalized = normalize(text);
  return (
    /\b(change|revise|adjust|make)\b[^.?!]{0,30}\b(duration|time|how long|minutes?|hours?)\b/.test(
      normalized,
    ) ||
    /\bmake it (?:shorter|longer)\b/.test(normalized) ||
    /\bcan we change how long\b/.test(normalized)
  );
}

function listAvailableItems(inventory: SessionInventoryItem[] | undefined): string[] {
  if (!inventory || inventory.length === 0) {
    return [];
  }
  return dedupeList(
    inventory
      .filter((item) => item.available_this_session)
      .map((item) => getSessionInventoryDisplayName(item)),
  );
}

function taskKindForDomain(domain: TaskDomain | "none"): TaskKind {
  switch (domain) {
    case "device":
      return "device_hold";
    case "frame":
      return "frame_hold";
    case "posture":
    case "hands":
    case "kneeling":
    case "shoulders":
      return "posture_hold";
    case "stillness":
    case "general":
    case "none":
    default:
      return "stillness_hold";
  }
}

function normalizeTaskCategory(domain: TaskDomain): TaskDomain {
  if (domain === "hands" || domain === "kneeling" || domain === "shoulders") {
    return "posture";
  }
  return domain;
}

function taskFamilyForTemplateId(templateId: DeterministicTaskTemplateId): string {
  switch (templateId) {
    case "quick_check":
      return "frame_quick";
    case "eye_contact_check":
      return "frame_eye_contact";
    case "inspection_check":
      return "frame_inspection";
    case "focus_hold":
      return "stillness_focus";
    case "silence_hold":
      return "device_silence";
    case "steady_hold":
      return "device_endurance";
    case "discipline_hold":
      return "posture_discipline";
    case "hands_protocol":
      return "posture_hands";
    case "kneel_protocol":
      return "posture_kneeling";
    case "shoulders_back_protocol":
      return "posture_shoulders";
    case "stakes_hold":
      return "device_stakes";
    case "endurance_hold":
      return "device_long_endurance";
    default:
      return "general_control";
  }
}

function buildTaskCatalog(): TaskCatalogEntry[] {
  return [
    {
      id: "device-endurance-0",
      templateId: "steady_hold",
      variantIndex: 0,
      title: "Session hold task",
      domain: "device",
      family: "device_endurance",
      tags: ["device", "endurance", "control"],
      requiredInventory: false,
      optionalInventory: true,
      durationFit: { min: 20, max: 150 },
      intensity: "moderate",
      structureType: "hold",
      requiresSetup: true,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. I have a clean control task for this.",
      optionLine: "A device endurance hold that stays clean and sustainable.",
    },
    {
      id: "device-endurance-1",
      templateId: "steady_hold",
      variantIndex: 1,
      title: "Locked device hold task",
      domain: "device",
      family: "device_endurance",
      tags: ["device", "lock", "discipline"],
      requiredInventory: false,
      optionalInventory: true,
      durationFit: { min: 30, max: 180 },
      intensity: "high",
      structureType: "hold",
      requiresSetup: true,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one keeps the pressure cleaner and tighter.",
      optionLine: "A stricter locked device hold with discipline on top of it.",
    },
    {
      id: "device-silence-0",
      templateId: "silence_hold",
      variantIndex: 0,
      title: "Silence hold task",
      domain: "device",
      family: "device_silence",
      tags: ["device", "silence", "control"],
      requiredInventory: false,
      optionalInventory: true,
      durationFit: { min: 15, max: 90 },
      intensity: "moderate",
      structureType: "hold",
      requiresSetup: true,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one keeps your mouth and body under the same rule.",
      optionLine: "A device task with silence layered cleanly over it.",
    },
    {
      id: "device-stakes-0",
      templateId: "stakes_hold",
      variantIndex: 1,
      title: "Stakes hold task",
      domain: "device",
      family: "device_stakes",
      tags: ["device", "stakes", "pressure"],
      requiredInventory: false,
      optionalInventory: true,
      durationFit: { min: 60, max: 240 },
      intensity: "high",
      structureType: "hold",
      requiresSetup: true,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one has a harder edge to it.",
      optionLine: "A longer device task with sharper stake pressure.",
    },
    {
      id: "frame-inspection-0",
      templateId: "inspection_check",
      variantIndex: 0,
      title: "Inspection check task",
      domain: "frame",
      family: "frame_inspection",
      tags: ["frame", "inspection", "visibility"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 10, max: 45 },
      intensity: "moderate",
      structureType: "check",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This keeps you visible and easy to read.",
      optionLine: "An inspection-frame task with visible control instead of passive waiting.",
    },
    {
      id: "frame-eye-0",
      templateId: "eye_contact_check",
      variantIndex: 1,
      title: "Eye contact check task",
      domain: "frame",
      family: "frame_eye_contact",
      tags: ["frame", "eyes", "focus"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 10, max: 30 },
      intensity: "moderate",
      structureType: "check",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one is narrower and more exacting.",
      optionLine: "An eye-contact frame task with cleaner attentional pressure.",
    },
    {
      id: "frame-quick-0",
      templateId: "quick_check",
      variantIndex: 0,
      title: "Quick check task",
      domain: "frame",
      family: "frame_quick",
      tags: ["frame", "quick", "check"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 10, max: 40 },
      intensity: "low",
      structureType: "check",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This keeps it simple and visible.",
      optionLine: "A shorter frame check if you want something cleaner and lighter.",
    },
    {
      id: "posture-discipline-0",
      templateId: "discipline_hold",
      variantIndex: 0,
      title: "Discipline hold task",
      domain: "posture",
      family: "posture_discipline",
      tags: ["posture", "upright", "discipline"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 30, max: 120 },
      intensity: "high",
      structureType: "hold",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This is the clean posture version.",
      optionLine: "A strict upright posture hold with steady pressure.",
    },
    {
      id: "posture-hands-0",
      templateId: "hands_protocol",
      variantIndex: 0,
      title: "Hands-back protocol task",
      domain: "hands",
      family: "posture_hands",
      tags: ["posture", "hands", "protocol"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 15, max: 75 },
      intensity: "moderate",
      structureType: "protocol",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one changes the activity without losing control.",
      optionLine: "A hands-back protocol instead of another upright hold.",
    },
    {
      id: "posture-kneeling-0",
      templateId: "kneel_protocol",
      variantIndex: 0,
      title: "Kneel protocol task",
      domain: "kneeling",
      family: "posture_kneeling",
      tags: ["kneeling", "posture", "protocol"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 10, max: 60 },
      intensity: "moderate",
      structureType: "protocol",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one changes the shape of the pressure completely.",
      optionLine: "A kneeling protocol if you want a different posture family entirely.",
    },
    {
      id: "posture-shoulders-0",
      templateId: "shoulders_back_protocol",
      variantIndex: 0,
      title: "Shoulders-back protocol task",
      domain: "shoulders",
      family: "posture_shoulders",
      tags: ["shoulders", "posture", "precision"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 10, max: 60 },
      intensity: "moderate",
      structureType: "protocol",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one is more precise than brute-force strictness.",
      optionLine: "A shoulders-back protocol with cleaner form pressure.",
    },
    {
      id: "stillness-focus-0",
      templateId: "focus_hold",
      variantIndex: 0,
      title: "Focus hold task",
      domain: "stillness",
      family: "stillness_focus",
      tags: ["stillness", "focus", "quiet"],
      requiredInventory: false,
      optionalInventory: false,
      durationFit: { min: 20, max: 90 },
      intensity: "low",
      structureType: "hold",
      requiresSetup: false,
      immediateAssignment: true,
      planningOnly: false,
      leadInLine: "Fine. This one only works if stillness is actually what you want.",
      optionLine: "A stillness hold if you want quiet control rather than activity.",
    },
  ];
}

const TASK_CATALOG = buildTaskCatalog();

function taskCatalogEntryForId(id: string): TaskCatalogEntry | null {
  return TASK_CATALOG.find((entry) => entry.id === id) ?? null;
}

function taskOptionTitleForCandidate(candidate: Pick<TaskCandidate, "catalog_entry_id" | "title">): string {
  return candidate.title || taskCatalogEntryForId(candidate.catalog_entry_id)?.title || "Task option";
}

function taskOptionSummaryForCandidate(
  candidate: Pick<TaskCandidate, "catalog_entry_id" | "summary">,
): string {
  return taskCatalogEntryForId(candidate.catalog_entry_id)?.optionLine ?? candidate.summary;
}

function parseOrdinal(value: string): number | null {
  const normalized = normalize(value);
  const digitMatch = normalized.match(/\b([123])\b/);
  if (digitMatch?.[1]) {
    return Number(digitMatch[1]) - 1;
  }
  if (/\bfirst\b/.test(normalized)) {
    return 0;
  }
  if (/\bsecond\b/.test(normalized)) {
    return 1;
  }
  if (/\bthird\b/.test(normalized)) {
    return 2;
  }
  return null;
}

function inferAvailableTaskCategories(spec: TaskSpec): TaskDomain[] {
  const categories = TASK_CATALOG
    .map((entry) => normalizeTaskCategory(entry.domain))
    .filter((domain, index, values) => values.indexOf(domain) === index)
    .filter((domain) => !spec.excluded_task_categories.includes(domain));
  return categories.length > 0 ? categories : ["device", "frame", "posture"];
}

function matchesRequestedDomain(
  requestedDomain: TaskDomain | "none",
  candidateDomain: TaskDomain,
): boolean {
  if (requestedDomain === "none" || requestedDomain === "general") {
    return true;
  }
  if (requestedDomain === "posture") {
    return normalizeTaskCategory(candidateDomain) === "posture";
  }
  return requestedDomain === candidateDomain;
}

function resolveInventoryContext(
  inventory: SessionInventoryItem[] | undefined,
  userText: string,
  domain: TaskDomain | "none",
): { itemLabel: string; clarificationQuestion: string } {
  const selectedItem = findInventoryItemForTask(
    inventory ?? [],
    userText,
    taskKindForDomain(domain),
  );
  if (!selectedItem) {
    const normalized = normalize(userText);
    if (/\b(dildo|plug|aneros|prostate massager)\b/.test(normalized)) {
      return {
        itemLabel: /\bplug\b/.test(normalized)
          ? "plug"
          : /\baneros|prostate massager\b/.test(normalized)
            ? "prostate massager"
            : "dildo",
        clarificationQuestion: /\b(oral|anal|prop)\b/.test(normalized)
          ? ""
          : "Be specific, pet. Tell me whether that item is meant for oral, anal, or prop for this task.",
      };
    }
    if (/\b(vibe|vibrator|wand|magic wand|hitachi)\b/.test(normalized)) {
      return {
        itemLabel: /\bwand|magic wand|hitachi\b/.test(normalized) ? "wand" : "vibrator",
        clarificationQuestion:
          "Be specific, pet. Tell me whether that item is staying external, working as a prop, or aimed at a specific body area.",
      };
    }
    return {
      itemLabel: "",
      clarificationQuestion: "",
    };
  }
  return {
    itemLabel: getSessionInventoryDisplayName(selectedItem),
    clarificationQuestion: needsInventoryClarification(selectedItem, userText)
      ? buildInventoryClarificationQuestion(selectedItem)
      : "",
  };
}

function requestedInventorySemanticsMismatch(
  userText: string,
  selectedInventoryItem: SessionInventoryItem | null,
  currentFamily: string,
): boolean {
  if (!selectedInventoryItem) {
    return false;
  }
  if (!isTaskGroundingCorrection(userText) && !requestsDifferentItemUse(userText)) {
    return false;
  }
  const semantics = describeInventorySemantics(selectedInventoryItem);
  if (semantics.isInsertableToy) {
    return true;
  }
  if (
    semantics.isRestraint &&
    currentFamily !== "posture_hands" &&
    currentFamily !== "posture_kneeling"
  ) {
    return true;
  }
  if (semantics.isChastity && !/device/.test(currentFamily)) {
    return true;
  }
  return false;
}

function suggestedDomainFromInventoryItem(
  item: SessionInventoryItem | null,
): TaskDomain | null {
  if (!item) {
    return null;
  }
  const semantics = describeInventorySemantics(item);
  if (semantics.isChastity || semantics.isInsertableToy) {
    return "device";
  }
  if (semantics.isRestraint) {
    return "hands";
  }
  if (semantics.isVisualGear) {
    return "frame";
  }
  if (semantics.isClothingLike) {
    return "posture";
  }
  return null;
}

function extractAvailableItemsFromText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const explicitMatch = normalized.match(
    /\b(?:i have|available(?: items| tools)? are|using|with)\s+([^.?!]+)$/i,
  );
  if (explicitMatch?.[1]) {
    return dedupeList(
      explicitMatch[1]
        .split(/,| and /i)
        .map((item) => item.replace(/\b(a|an|the)\b/gi, "").trim())
        .filter((item) => item.length > 1),
    );
  }
  return [];
}

function findCurrentRelevantInventoryItem(
  inventory: SessionInventoryItem[] | undefined,
  label: string,
): SessionInventoryItem | null {
  if (!inventory || !label) {
    return null;
  }
  const normalizedLabel = normalize(label);
  return (
    inventory.find(
      (item) =>
        normalize(item.label) === normalizedLabel ||
        normalize(getSessionInventoryDisplayName(item)) === normalizedLabel,
    ) ?? null
  );
}

function extractInventoryUseGoal(
  userText: string,
  item: SessionInventoryItem | null,
  fallbackLabel = "",
): string {
  const itemName = item
    ? getSessionInventoryDisplayName(item)
    : fallbackLabel.trim();
  if (!itemName) {
    return "";
  }
  const insertableFromLabel = /\b(dildo|plug|aneros|prostate massager)\b/i.test(itemName);
  const semantics = item ? describeInventorySemantics(item) : null;
  if (!(semantics?.isInsertableToy ?? insertableFromLabel)) {
    return "";
  }
  const normalized = normalize(userText);
  if (/\banal|anus\b/.test(normalized)) {
    return `anal use with ${itemName}`;
  }
  if (/\boral|mouth|throat\b/.test(normalized)) {
    return `oral use with ${itemName}`;
  }
  if (/\bprop\b/.test(normalized)) {
    return `prop use with ${itemName}`;
  }
  return "";
}

function extractTaskCategoryExclusions(text: string): TaskDomain[] {
  const normalized = normalize(text);
  const entries: Array<{ domain: TaskDomain; patterns: RegExp[] }> = [
    { domain: "stillness", patterns: [/\b(no|not|avoid|anything but|except)\s+still(?:ness)?\b/, /\bstillness\s+(?:is\s+)?(?:off|out|excluded|disabled)\b/] },
    { domain: "posture", patterns: [/\b(no|not|avoid|anything but|except)\s+posture\b/] },
    { domain: "frame", patterns: [/\b(no|not|avoid|anything but|except)\s+frame\b/] },
    { domain: "device", patterns: [/\b(no|not|avoid|anything but|except)\s+device\b/] },
    { domain: "kneeling", patterns: [/\b(no|not|avoid|anything but|except)\s+kneel(?:ing)?\b/] },
    { domain: "hands", patterns: [/\b(no|not|avoid|anything but|except)\s+hands\b/] },
    { domain: "shoulders", patterns: [/\b(no|not|avoid|anything but|except)\s+shoulders\b/] },
  ];
  return entries
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(normalized)))
    .map((entry) => normalizeTaskCategory(entry.domain));
}

function extractTaskCategoryPreferences(text: string): TaskDomain[] {
  const requestedDomain = detectTaskDomainFromUserText(text);
  const categories: TaskDomain[] = [];
  if (requestedDomain !== "general") {
    categories.push(normalizeTaskCategory(requestedDomain));
  }
  if (/\bhands behind|hands-back\b/.test(normalize(text))) {
    categories.push("posture");
  }
  return dedupeList(categories) as TaskDomain[];
}

function hasExplicitTaskDomainRequest(text: string, domain: TaskDomain): boolean {
  const normalized = normalize(text);
  if (domain === "device") {
    return /\bdevice task\b|\bchastity task\b/.test(normalized);
  }
  if (domain === "stillness") {
    return /\bstillness task\b|\bhold still task\b/.test(normalized);
  }
  if (domain === "posture") {
    return /\bposture task\b/.test(normalized);
  }
  if (domain === "frame") {
    return /\bframe task\b|\binspection task\b/.test(normalized);
  }
  if (domain === "hands") {
    return /\bhands(?:-back)? task\b/.test(normalized);
  }
  if (domain === "kneeling") {
    return /\bkneeling task\b|\bkneel(?:ing)? task\b/.test(normalized);
  }
  if (domain === "shoulders") {
    return /\bshoulders(?:-back)? task\b/.test(normalized);
  }
  return false;
}

function detectTaskSelectionMode(text: string, current: TaskSpec): TaskSelectionMode {
  const normalized = normalize(text);
  if (
    /\b(options|choices|let me choose|let me pick|give me a couple|give me a few|show me a few|help me decide)\b/.test(
      normalized,
    )
  ) {
    return "curated_options";
  }
  if (/\b(help me narrow|narrow it|talk me through the type|collaborative)\b/.test(normalized)) {
    return "collaborative_narrowing";
  }
  if (/\b(you choose|you pick|pick for me|choose for me|assign it yourself)\b/.test(normalized)) {
    return "direct_assignment";
  }
  if (
    /\b(task|training)\b/.test(normalized) &&
    /\b(what kind of|what sort of|what would be a good|what do you think would be a good|what should we do|what could we do|what would work well)\b/.test(
      normalized,
    )
  ) {
    return "curated_options";
  }
  if (
    current.presented_options.length > 0 &&
    !/\b(options|choices|let me choose|help me decide)\b/.test(normalized)
  ) {
    return "direct_assignment";
  }
  return current.selection_mode;
}

function detectTaskRequestKind(text: string, current: TaskSpec): TaskRequestKind {
  const normalized = normalize(text);
  if (
    /\b(revise|adjust|alter|make it stricter|make it softer|less intense|more intense|keep the structure)\b/.test(
      normalized,
    ) ||
    isDurationRevisionRequest(normalized)
  ) {
    return "revision";
  }
  if (isTaskGroundingCorrection(text)) {
    return "replacement";
  }
  if (/\b(reroll)\b/.test(normalized)) {
    return "reroll";
  }
  if (/\b(different task|different kind of task|another one|not that|something else|different one)\b/.test(normalized)) {
    return "replacement";
  }
  return current.request_kind;
}

function wantsRavenToChoose(text: string): boolean {
  return /\b(you choose|you pick|pick for me|choose for me|assign it yourself)\b/i.test(text);
}

function wantsCuratedOptions(text: string): boolean {
  return /\b(options|choices|let me choose|let me pick|help me decide|show me a few|give me a couple|give me a few)\b/i.test(
    text,
  );
}

function keepsSameStructure(text: string): boolean {
  return /\b(keep the structure|same structure|same setup|same duration just|keep the current structure)\b/i.test(
    text,
  );
}

function resolvePresentedOptionSelection(
  text: string,
  options: TaskPresentedOption[],
): TaskPresentedOption | null {
  if (options.length === 0) {
    return null;
  }
  const ordinal = parseOrdinal(text);
  if (ordinal !== null) {
    return options[ordinal] ?? null;
  }
  const normalized = normalize(text);
  if (/\b(that one|this one|that|the other one)\b/.test(normalized)) {
    return options[0] ?? null;
  }
  return (
    options.find((option) => normalized.includes(normalize(option.title))) ??
    options.find((option) => normalized.includes(normalize(option.family.replace(/_/g, " ")))) ??
    null
  );
}

function parsePresentedOptionsFromAssistantText(text: string): TaskPresentedOption[] {
  const matches = [...text.matchAll(/(?:^|\s)([123])\.\s*([A-Za-z][^:.\n]+):\s*([\s\S]*?)(?=(?:\s[123]\.\s*[A-Za-z][^:.\n]+:|$))/g)];
  const options: TaskPresentedOption[] = [];
  for (const match of matches) {
    const title = match[2]?.trim() ?? "";
    const body = match[3]?.trim() ?? "";
    if (!title) {
      continue;
    }
    const catalogEntry = TASK_CATALOG.find((entry) => normalize(entry.title) === normalize(title));
    const inferredEntry = catalogEntry ?? inferCatalogEntryForPresentedOption(title, body);
    if (!inferredEntry) {
      continue;
    }
    options.push({
      title,
      family: inferredEntry.family,
      domain: inferredEntry.domain,
      template_id: inferredEntry.templateId,
      variant_index: inferredEntry.variantIndex,
    });
  }
  return options;
}

function inferCatalogEntryForPresentedOption(title: string, body: string): TaskCatalogEntry | null {
  const normalized = normalize(`${title} ${body}`);
  if (/\b(anal|throat|oral|chastity|bondage)\b/.test(normalized)) {
    if (/\b(silence|silent|quiet)\b/.test(normalized)) {
      return taskCatalogEntryForId("device-silence-0");
    }
    if (/\b(stakes|stricter|intervals|harder edge|longer)\b/.test(normalized)) {
      return taskCatalogEntryForId("device-stakes-0");
    }
    return taskCatalogEntryForId("device-endurance-0");
  }
  if (/\bhands-back|hands behind|hands back\b/.test(normalized)) {
    return taskCatalogEntryForId("posture-hands-0");
  }
  if (/\bkneel|kneeling|on your knees\b/.test(normalized)) {
    return taskCatalogEntryForId("posture-kneeling-0");
  }
  if (/\bshoulders-back|shoulders back|chin up\b/.test(normalized)) {
    return taskCatalogEntryForId("posture-shoulders-0");
  }
  if (/\binspection\b/.test(normalized)) {
    return taskCatalogEntryForId("frame-inspection-0");
  }
  if (/\beye contact\b/.test(normalized)) {
    return taskCatalogEntryForId("frame-eye-0");
  }
  if (/\bquick check\b/.test(normalized)) {
    return taskCatalogEntryForId("frame-quick-0");
  }
  if (/\bposture\b/.test(normalized)) {
    return taskCatalogEntryForId("posture-discipline-0");
  }
  return null;
}

function needsAvailableItems(spec: TaskSpec, userText: string): boolean {
  if (spec.requested_domain !== "device") {
    return false;
  }
  if (spec.active_constraints.includes("no_device")) {
    return false;
  }
  return (
    spec.available_items.length === 0 &&
    !spec.relevant_inventory_item &&
    !hasGroundedDeviceContext(userText)
  );
}

function needsDomain(spec: TaskSpec): boolean {
  if (spec.requested_domain === "none") {
    return true;
  }
  if (spec.requested_domain !== "general") {
    return false;
  }
  return (
    spec.duration_minutes === null &&
    spec.repeat_count === null &&
    spec.proof_or_checkin_type === "unspecified" &&
    !spec.user_goal &&
    spec.modifiers.length === 0
  );
}

function needsDuration(spec: TaskSpec): boolean {
  return spec.duration_minutes === null;
}

function needsCombineQuestion(spec: TaskSpec, userText: string): boolean {
  const normalized = normalize(userText);
  if (!/\b(combine|combined|pair it|pair this|with something else|along with)\b/.test(normalized)) {
    return false;
  }
  return !spec.modifiers.includes("standalone");
}

function needsDifficulty(spec: TaskSpec, userText: string): boolean {
  const normalized = normalize(userText);
  if (spec.difficulty !== "unspecified") {
    return false;
  }
  return /\b(challenge|challenging|push me|make it count|harder|easier|difficulty)\b/.test(normalized);
}

function needsProof(spec: TaskSpec, userText: string): boolean {
  const normalized = normalize(userText);
  if (spec.proof_or_checkin_type !== "unspecified") {
    return false;
  }
  return /\b(keep me honest|proof|verify|check in|check-in|accountability)\b/.test(normalized);
}

function deriveMissingSlots(
  spec: TaskSpec,
  userText: string,
  inventoryClarificationQuestion = "",
): TaskSpecMissingSlot[] {
  const missing: TaskSpecMissingSlot[] = [];
  if (needsDomain(spec)) {
    missing.push("requested_domain");
  }
  if (needsAvailableItems(spec, userText)) {
    missing.push("available_items");
  }
  if (needsDuration(spec)) {
    missing.push("duration_minutes");
  }
  if (inventoryClarificationQuestion) {
    missing.push("inventory_details");
  }
  if (needsCombineQuestion(spec, userText)) {
    missing.push("combine_mode");
  }
  if (needsDifficulty(spec, userText)) {
    missing.push("difficulty");
  }
  if (needsProof(spec, userText)) {
    missing.push("proof_or_checkin_type");
  }
  return missing;
}

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) {
    return "default length";
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

function buildCandidateUserText(taskSpec: TaskSpec, userText: string): string {
  const normalizedUserText = normalize(userText);
  const genericTaskDirective =
    /\b(different task|different kind of task|another one|not that|something else|options|choices|pick for me|you choose|let me choose)\b/.test(
      normalizedUserText,
    );
  const parts = genericTaskDirective ? [] : [userText.trim()];
  if (genericTaskDirective) {
    const domainLabel =
      taskSpec.requested_domain !== "none" && taskSpec.requested_domain !== "general"
        ? formatTaskDomainLabel(taskSpec.requested_domain)
        : "task";
    parts.push(`${domainLabel} task`);
  }
  if (taskSpec.user_goal) {
    parts.push(`goal ${taskSpec.user_goal}`);
  }
  if (taskSpec.relevant_inventory_item) {
    parts.push(`use ${taskSpec.relevant_inventory_item}`);
  }
  if (taskSpec.duration_minutes) {
    parts.push(`${taskSpec.duration_minutes} minutes`);
  }
  if (taskSpec.difficulty !== "unspecified") {
    parts.push(taskSpec.difficulty);
  }
  if (taskSpec.repeat_count) {
    parts.push(`${taskSpec.repeat_count} reps`);
  }
  if (taskSpec.proof_or_checkin_type === "halfway_checkin") {
    parts.push("halfway check in");
  } else if (taskSpec.proof_or_checkin_type === "final_proof") {
    parts.push("final proof");
  } else if (taskSpec.proof_or_checkin_type === "halfway_and_final") {
    parts.push("halfway check in and final proof");
  }
  if (taskSpec.modifiers.includes("combined")) {
    parts.push("combined task");
  }
  if (taskSpec.modifiers.includes("standalone")) {
    parts.push("standalone");
  }
  if (taskSpec.modifiers.includes("interval")) {
    parts.push("checkpointed pacing");
  }
  if (taskSpec.available_items.length > 0 && !taskSpec.relevant_inventory_item) {
    parts.push(`available items ${taskSpec.available_items.join(", ")}`);
  }
  if (taskSpec.excluded_task_categories.length > 0) {
    parts.push(`avoid ${taskSpec.excluded_task_categories.join(", ")}`);
  }
  if (taskSpec.selected_option_title) {
    parts.push(`selected option ${taskSpec.selected_option_title}`);
  }
  return parts.filter((part) => part.length > 0).join(". ");
}

function matchesCandidateIntensity(
  requestedDifficulty: TaskSpecDifficulty,
  intensity: TaskCatalogIntensity,
): boolean {
  if (requestedDifficulty === "unspecified") {
    return true;
  }
  if (requestedDifficulty === "easy") {
    return intensity === "low" || intensity === "moderate";
  }
  if (requestedDifficulty === "moderate") {
    return intensity === "moderate";
  }
  return intensity === "high" || intensity === "moderate";
}

function scoreCatalogEntry(
  entry: TaskCatalogEntry,
  taskSpec: TaskSpec,
  currentTemplateId: DeterministicTaskTemplateId | undefined,
  recentTaskTemplates: DeterministicTaskTemplateId[],
  taskHistory: TaskHistoryFingerprint[],
): number {
  let score = 0;
  const isBondageCompatible =
    entry.domain === "hands" || entry.domain === "kneeling" || entry.domain === "shoulders";
  if (taskSpec.requires_bondage_compatibility && !isBondageCompatible) {
    return -100;
  }
  if (matchesRequestedDomain(taskSpec.requested_domain, entry.domain)) {
    score += 4;
  } else if (taskSpec.requested_domain !== "none" && taskSpec.requested_domain !== "general") {
    return -100;
  }
  if (taskSpec.excluded_task_categories.includes(normalizeTaskCategory(entry.domain))) {
    return -100;
  }
  if (taskSpec.request_kind === "replacement" && taskSpec.current_task_family) {
    if (taskSpec.current_task_family === entry.family && !keepsSameStructure(taskSpec.user_goal)) {
      return -100;
    }
  }
  if (taskSpec.preserve_current_family && taskSpec.current_task_family) {
    if (entry.family !== taskSpec.current_task_family) {
      return -100;
    }
    score += 3;
  }
  if (taskSpec.avoid_task_families.includes(entry.family)) {
    return -100;
  }
  if (taskSpec.preferred_task_categories.includes(normalizeTaskCategory(entry.domain))) {
    score += 2.5;
  }
  if (taskSpec.duration_minutes !== null) {
    if (
      taskSpec.duration_minutes >= entry.durationFit.min &&
      taskSpec.duration_minutes <= entry.durationFit.max
    ) {
      score += 2.5;
    } else {
      const distance = Math.min(
        Math.abs(taskSpec.duration_minutes - entry.durationFit.min),
        Math.abs(taskSpec.duration_minutes - entry.durationFit.max),
      );
      score += Math.max(0, 2 - distance / 30);
    }
  }
  if (matchesCandidateIntensity(taskSpec.difficulty, entry.intensity)) {
    score += 1.5;
  }
  if (taskSpec.relevant_inventory_item) {
    if (entry.domain === "device") {
      score += 1.7;
    } else if (entry.optionalInventory) {
      score += 0.8;
    }
  }
  if (entry.domain === "stillness") {
    score -= 0.9;
  }
  if (taskSpec.request_kind === "replacement") {
    score += taskSpec.novelty_pressure === "high" ? 1.3 : 0.6;
  }
  const novelty = scoreCandidateNovelty(
    {
      title: entry.title,
      summary: entry.optionLine,
      steps: [entry.optionLine],
      domain: entry.domain,
      difficulty: taskSpec.difficulty,
      duration: formatDuration(taskSpec.duration_minutes),
      modifiers: taskSpec.modifiers,
      repeatsRequired: taskSpec.repeat_count ?? 1,
    },
    taskHistory,
    currentTemplateId,
    recentTaskTemplates,
    entry.templateId,
  );
  score += novelty.score * 2.8;
  if (!novelty.novelEnough && taskSpec.request_kind === "replacement") {
    score -= 3;
  }
  return Number(score.toFixed(3));
}

function buildCatalogEntriesForSpec(
  taskSpec: TaskSpec,
  currentTemplateId: DeterministicTaskTemplateId | undefined,
  recentTaskTemplates: DeterministicTaskTemplateId[],
  taskHistory: TaskHistoryFingerprint[],
): Array<{ entry: TaskCatalogEntry; score: number }> {
  return TASK_CATALOG
    .filter((entry) => entry.immediateAssignment)
    .map((entry) => ({
      entry,
      score: scoreCatalogEntry(entry, taskSpec, currentTemplateId, recentTaskTemplates, taskHistory),
    }))
    .filter(({ score }) => score > -50)
    .sort((left, right) => right.score - left.score);
}

function buildCandidateWhyFits(taskSpec: TaskSpec, plan: DeterministicTaskPlan): string {
  const reasons = [
    taskSpec.user_goal ? `it pushes ${taskSpec.user_goal}` : "",
    taskSpec.duration_minutes ? `it fits a ${formatDuration(taskSpec.duration_minutes)} window` : "",
    taskSpec.difficulty !== "unspecified" ? `it lands at a ${taskSpec.difficulty} difficulty` : "",
    taskSpec.proof_or_checkin_type !== "unspecified"
      ? `it matches the ${taskSpec.proof_or_checkin_type.replace(/_/g, " ")} check style`
      : "",
    taskSpec.request_kind === "replacement" && taskSpec.current_task_family
      ? "it changes the family instead of handing you a near clone"
      : "",
    taskSpec.modifiers.includes("combined") ? "it pairs the task instead of leaving it flat" : "",
    plan.selectedInventoryItem ? `it uses ${getSessionInventoryDisplayName(plan.selectedInventoryItem)}` : "",
  ].filter((reason) => reason.length > 0);
  if (reasons.length === 0) {
    return "it fits the current request without drifting off-topic";
  }
  return reasons.join(", ");
}

function buildCandidateCheckRequirement(taskSpec: TaskSpec, plan: DeterministicTaskPlan): string {
  if (taskSpec.proof_or_checkin_type === "halfway_and_final") {
    return "halfway check-in and final proof";
  }
  if (taskSpec.proof_or_checkin_type === "halfway_checkin") {
    return "halfway check-in";
  }
  if (taskSpec.proof_or_checkin_type === "final_proof") {
    return "final proof";
  }
  if (plan.durationMinutes >= 60) {
    return "halfway check-in";
  }
  return "final report back";
}

function buildTaskOptionSummary(candidate: TaskCandidate): string {
  const summary = candidate.summary
    .replace(/^Here is your task:\s*/i, "")
    .replace(/\s+Start now\..*$/i, "")
    .trim();
  const conciseSummary = summary.endsWith(".") ? summary.slice(0, -1) : summary;
  return `${conciseSummary}. ${candidate.duration}. ${candidate.checkin_or_proof_requirement}.`;
}

function buildCandidateSteps(taskSpec: TaskSpec, plan: DeterministicTaskPlan): string[] {
  const steps = [
    plan.assignmentText
      .replace(/^.*?Here is your task:\s*/i, "")
      .replace(/\s+Reward:.*$/i, "")
      .trim(),
    buildCandidateCheckRequirement(taskSpec, plan),
  ];
  if (taskSpec.modifiers.includes("combined")) {
    steps.push("keep the secondary paired condition clean through the full task");
  }
  return dedupeList(steps);
}

function inferHistoryDomain(entry: Pick<TaskRow, "title" | "description">): TaskDomain | "general" {
  const domain = detectTaskDomainFromUserText(`${entry.title} ${entry.description}`);
  return domain === "general" ? "general" : domain;
}

function fingerprintTaskHistoryEntry(
  entry: Pick<TaskRow, "title" | "description" | "repeats_required">,
): TaskHistoryFingerprint {
  return {
    title: entry.title,
    description: entry.description,
    repeats_required: entry.repeats_required,
    domain: inferHistoryDomain(entry),
  };
}

function buildCandidateFingerprints(candidate: {
  title: string;
  summary: string;
  steps: string[];
  domain: TaskDomain;
  difficulty: TaskSpecDifficulty;
  duration: string;
  modifiers: string[];
}): {
  titleTokens: string[];
  structureTokens: string[];
  modifierTokens: string[];
} {
  return {
    titleTokens: tokenize(`${candidate.title} ${candidate.domain}`),
    structureTokens: tokenize(
      `${candidate.summary} ${candidate.steps.join(" ")} ${candidate.duration} ${candidate.difficulty}`,
    ),
    modifierTokens: tokenize(candidate.modifiers.join(" ")),
  };
}

function scoreCandidateNovelty(
  candidate: {
    title: string;
    summary: string;
    steps: string[];
    domain: TaskDomain;
    difficulty: TaskSpecDifficulty;
    duration: string;
    modifiers: string[];
    repeatsRequired: number;
  },
  history: TaskHistoryFingerprint[],
  currentTemplateId: DeterministicTaskTemplateId | undefined,
  recentTaskTemplates: DeterministicTaskTemplateId[],
  templateId: DeterministicTaskTemplateId,
): { novelEnough: boolean; score: number; breakdown: TaskNoveltyBreakdown } {
  const currentPenalty = currentTemplateId && currentTemplateId === templateId ? 0.2 : 0;
  const recentPenalty = recentTaskTemplates.includes(templateId) ? 0.18 : 0;
  const candidatePrint = buildCandidateFingerprints(candidate);
  let strongest: TaskNoveltyBreakdown = {
    total_similarity: currentPenalty + recentPenalty,
    title_similarity: 0,
    structure_similarity: 0,
    modifier_similarity: 0,
    domain_penalty: 0,
    duration_penalty: 0,
  };
  for (const entry of history) {
    const entryTitleTokens = tokenize(entry.title);
    const entryStructureTokens = tokenize(
      `${entry.description} ${formatDuration(entry.repeats_required > 1 ? candidate.repeatsRequired : null)}`,
    );
    const titleSimilarity = jaccardSimilarity(candidatePrint.titleTokens, entryTitleTokens);
    const structureSimilarity = jaccardSimilarity(candidatePrint.structureTokens, entryStructureTokens);
    const modifierSimilarity = jaccardSimilarity(
      candidatePrint.modifierTokens,
      tokenize(entry.description),
    );
    const domainPenalty = entry.domain === candidate.domain ? 0.15 : 0;
    const durationPenalty =
      entry.repeats_required === candidate.repeatsRequired ? 0.05 : 0;
    const totalSimilarity =
      currentPenalty +
      recentPenalty +
      titleSimilarity * 0.34 +
      structureSimilarity * 0.31 +
      modifierSimilarity * 0.12 +
      domainPenalty +
      durationPenalty;
    if (totalSimilarity > strongest.total_similarity) {
      strongest = {
        total_similarity: Number(totalSimilarity.toFixed(3)),
        title_similarity: Number(titleSimilarity.toFixed(3)),
        structure_similarity: Number(structureSimilarity.toFixed(3)),
        modifier_similarity: Number(modifierSimilarity.toFixed(3)),
        domain_penalty: Number(domainPenalty.toFixed(3)),
        duration_penalty: Number(durationPenalty.toFixed(3)),
      };
    }
  }
  const score = Number(Math.max(0, 1 - strongest.total_similarity).toFixed(3));
  return {
    novelEnough: score >= 0.34,
    score,
    breakdown: strongest,
  };
}

function buildNoveltyCheckLabel(
  novelty: { novelEnough: boolean; score: number; breakdown: TaskNoveltyBreakdown },
): string {
  if (novelty.novelEnough) {
    return `novel enough (score ${novelty.score})`;
  }
  return `too close to prior task structure (score ${novelty.score})`;
}

function askedCount(taskSpec: TaskSpec, slot: TaskSpecMissingSlot): number {
  return taskSpec.asked_question_slots.filter((asked) => asked === slot).length;
}

function choosePhrase(options: string[], index: number): string {
  return options[index % options.length] ?? options[0] ?? "";
}

function buildQuestionVariants(taskSpec: TaskSpec, slot: TaskSpecMissingSlot): string[] {
  if (slot === "requested_domain") {
    const availableCategories =
      taskSpec.available_task_categories.length > 0
        ? taskSpec.available_task_categories
        : ["posture", "frame", "hands", "device"];
    const renderedCategories = availableCategories.join(", ");
    return [
      `What kind of task do you want this to be: ${renderedCategories}?`,
      `Where do you want the pressure: ${renderedCategories}?`,
      `Pick the lane for this one: ${renderedCategories}?`,
    ];
  }
  if (slot === "available_items") {
    return [
      "What items are actually available right now so I do not build the wrong task?",
      "What can you actually use for this one right now?",
      "Tell me what gear or tools you have on hand first.",
    ];
  }
  if (slot === "duration_minutes") {
    const hasGoal = taskSpec.user_goal.length > 0;
    return hasGoal
      ? [
          `How long should I make it if the aim is ${taskSpec.user_goal}?`,
          `What time window do you want for ${taskSpec.user_goal}?`,
          "Give me the time window and I will shape the pressure around it.",
        ]
      : [
          "How long should I make it run?",
          "What time window do you want for it?",
          "Give me the length and I will tighten the shape around that.",
      ];
  }
  if (slot === "inventory_details" && taskSpec.inventory_clarification_question) {
    return [taskSpec.inventory_clarification_question];
  }
  if (slot === "combine_mode") {
    return [
      "Do you want this standalone, or paired with something else too?",
      "Should I leave it clean and standalone, or combine it with another hold or check-in?",
      "Do you want a single-lane task here, or one paired with a second condition?",
    ];
  }
  if (slot === "difficulty") {
    return [
      "How hard do you want it: easy, moderate, or hard?",
      "Set the pressure for me: easy, moderate, or hard?",
      "Do you want this light, balanced, or hard?",
    ];
  }
  return [
    "Do you want a halfway check-in, a final proof step, or just a final report?",
    "How should I hold you to it: halfway check-in, final proof, or a clean report at the end?",
    "Pick the accountability style: halfway check-in, final proof, or end report?",
  ];
}

function chooseDistinctTaskCandidates(
  candidates: TaskCandidate[],
  count: number,
  taskSpec: TaskSpec,
): TaskCandidate[] {
  const previousFirstFamily = taskSpec.presented_options[0]?.family ?? "";
  const rotatedCandidates =
    previousFirstFamily.length > 0
      ? (() => {
          const matchingIndexes = candidates
            .map((candidate, index) => ({ family: candidate.family, index }))
            .filter((entry) => entry.family === previousFirstFamily)
            .map((entry) => entry.index);
          const startIndex = matchingIndexes.length > 0 ? matchingIndexes[matchingIndexes.length - 1]! : -1;
          if (startIndex < 0) {
            return candidates;
          }
          return [...candidates.slice(startIndex + 1), ...candidates.slice(0, startIndex + 1)];
        })()
      : candidates;
  const selected: TaskCandidate[] = [];
  for (const candidate of rotatedCandidates) {
    if (
      taskSpec.excluded_task_categories.includes(normalizeTaskCategory(candidate.domain)) ||
      taskSpec.avoid_task_families.includes(candidate.family)
    ) {
      continue;
    }
    if (selected.some((item) => item.family === candidate.family)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= count) {
      break;
    }
  }
  return selected;
}

function hasGroundedDeviceContext(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return /\b(with my|using my|i have my)\b/.test(normalized) ||
    /\b(chastity|cage|belt|plug|dildo|vibrator|vibe|wand|aneros|cuffs?|restraints?|rope|collar|leash|blindfold|hood|mask|anal|anus|oral|throat|mouth|gag|prostate)\b/.test(
      normalized,
    );
}

function validateCandidate(
  taskSpec: TaskSpec,
  plan: DeterministicTaskPlan,
  sourceUserText: string,
  candidateMeta: {
    title: string;
    summary: string;
    steps: string[];
    difficulty: TaskSpecDifficulty;
    duration: string;
    modifiers: string[];
    repeatsRequired: number;
  },
  taskHistory: TaskHistoryFingerprint[],
  currentTemplateId: DeterministicTaskTemplateId | undefined,
  recentTaskTemplates: DeterministicTaskTemplateId[],
): TaskCandidate["validation"] {
  const planDomain = taskDomainFromTemplateId(plan.template.id);
  const requestedDomain = taskSpec.requested_domain;
  const matchesRequest =
    requestedDomain === "none" ||
    requestedDomain === "general" ||
    matchesRequestedDomain(requestedDomain, planDomain);
  const novelty = scoreCandidateNovelty(
    {
      title: candidateMeta.title,
      summary: candidateMeta.summary,
      steps: candidateMeta.steps,
      domain: planDomain,
      difficulty: candidateMeta.difficulty,
      duration: candidateMeta.duration,
      modifiers: candidateMeta.modifiers,
      repeatsRequired: candidateMeta.repeatsRequired,
    },
    taskHistory,
    currentTemplateId,
    recentTaskTemplates,
    plan.template.id,
  );
  const respectsLock =
    taskSpec.can_replan_task || taskSpec.locked_task_domain === "none" || planDomain === taskSpec.locked_task_domain;
  const family = taskFamilyForTemplateId(plan.template.id);
  const actionable =
    Boolean(plan.assignmentText && plan.description) && !plan.needsInventoryClarification;
  const inventoryCompatibility = plan.selectedInventoryItem
    ? assessInventoryTaskCompatibility(
        plan.selectedInventoryItem,
        plan.template.taskKind,
        `${taskSpec.user_goal} ${candidateMeta.summary}`.trim(),
      )
    : { compatible: true, needsClarification: false, reason: "no_item" };
  const requiresGroundedDeviceContext =
    planDomain === "device" &&
    !plan.selectedInventoryItem &&
    taskSpec.available_items.length === 0 &&
    !taskSpec.relevant_inventory_item &&
    !hasGroundedDeviceContext(sourceUserText);
  const respectsLatestCorrection =
    taskSpec.request_kind !== "replacement" ||
    taskSpec.current_task_family.length === 0 ||
    family !== taskSpec.current_task_family;
  const rejectionReasons: string[] = [];
  if (!matchesRequest) {
    rejectionReasons.push(
      `domain_mismatch requested=${requestedDomain} selected=${planDomain}`,
    );
  }
  if (!novelty.novelEnough) {
    rejectionReasons.push(`novelty_too_low score=${novelty.score}`);
  }
  if (!respectsLock) {
    rejectionReasons.push(
      `lock_mismatch locked=${taskSpec.locked_task_domain} selected=${planDomain}`,
    );
  }
  if (taskSpec.excluded_task_categories.includes(normalizeTaskCategory(planDomain))) {
    rejectionReasons.push(`excluded_category ${normalizeTaskCategory(planDomain)}`);
  }
  if (
    taskSpec.request_kind === "replacement" &&
    taskSpec.current_task_family &&
    family === taskSpec.current_task_family
  ) {
    rejectionReasons.push(`replacement_family_repeat family=${family}`);
  }
  if (!inventoryCompatibility.compatible) {
    rejectionReasons.push(`inventory_semantics_mismatch ${inventoryCompatibility.reason}`);
  }
  if (requiresGroundedDeviceContext) {
    rejectionReasons.push("device_context_missing");
  }
  if (!respectsLatestCorrection) {
    rejectionReasons.push(`stale_family_after_correction family=${family}`);
  }
  if (!actionable) {
    rejectionReasons.push(
      plan.needsInventoryClarification ? "inventory_clarification_required" : "not_actionable",
    );
  }
  return {
    matches_request: matchesRequest,
    novel_enough: novelty.novelEnough,
    respects_lock: respectsLock,
    actionable:
      actionable &&
      inventoryCompatibility.compatible &&
      !requiresGroundedDeviceContext &&
      respectsLatestCorrection,
    plausible_with_inventory: inventoryCompatibility.compatible && !requiresGroundedDeviceContext,
    respects_latest_correction: respectsLatestCorrection,
    novelty_score: novelty.score,
    novelty_breakdown: novelty.breakdown,
    rejection_reasons: rejectionReasons,
  };
}

export function createTaskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    requested_domain: "none",
    user_goal: "",
    available_items: [],
    duration_minutes: null,
    difficulty: "unspecified",
    repeat_count: null,
    proof_or_checkin_type: "unspecified",
    modifiers: [],
    active_constraints: [],
    missing_slots: [],
    current_task_domain: "general",
    locked_task_domain: "none",
    can_replan_task: true,
    reason_for_lock: "",
    asked_question_slots: [],
    unresolved_blockers: [],
    resolved_blockers: [],
    request_stage: "idle",
    next_required_action: "none",
    fulfillment_locked: false,
    request_fulfilled: false,
    last_asked_blocker: null,
    last_resolved_blocker: null,
    relevant_inventory_item: "",
    inventory_clarification_question: "",
    selection_mode: "direct_assignment",
    request_kind: "fresh_assignment",
    allow_raven_to_choose_alone: true,
    excluded_task_categories: [],
    preferred_task_categories: [],
    available_task_categories: ["device", "frame", "posture", "stillness"],
    current_task_family: "",
    avoid_task_families: [],
    recent_task_families: [],
    novelty_pressure: "normal",
    presented_options: [],
    selected_option_title: "",
    requires_bondage_compatibility: false,
    preserve_current_family: false,
    ...overrides,
  };
}

export function syncTaskSpecSceneFields(
  taskSpec: TaskSpec,
  fields: Pick<
    TaskSpec,
    "current_task_domain" | "locked_task_domain" | "can_replan_task" | "reason_for_lock"
  >,
): TaskSpec {
  return {
    ...taskSpec,
    current_task_domain: fields.current_task_domain,
    locked_task_domain: fields.locked_task_domain,
    can_replan_task: fields.can_replan_task,
    reason_for_lock: fields.reason_for_lock,
  };
}

export function noteTaskSpecUserTurn(current: TaskSpec, input: TaskSpecUpdateInput): TaskSpec {
  const normalizedUserText = normalize(input.userText);
  const detectedRequestedDomain = detectTaskDomainFromUserText(input.userText);
  const selectedOption = resolvePresentedOptionSelection(input.userText, current.presented_options);
  const explicitDurationMinutes = extractDurationMinutes(input.userText);
  const durationRevisionRequest = isDurationRevisionRequest(input.userText);
  const inferredRequestKind =
    /\b(task|challenge|assignment|drill)\b/.test(normalizedUserText) &&
      !/\b(different task|different kind of task|another one|not that|something else|different one|revise|adjust|alter|reroll)\b/.test(
        normalizedUserText,
      )
      ? "fresh_assignment"
      : detectTaskRequestKind(input.userText, current);
  const nextSelectionMode =
    selectedOption
      ? "direct_assignment"
      : detectTaskSelectionMode(input.userText, current);
  const nextExcludedCategories = dedupeList([
    ...current.excluded_task_categories,
    ...extractTaskCategoryExclusions(input.userText),
  ]) as TaskDomain[];
  const nextPreferredCategories = dedupeList(
    extractTaskCategoryPreferences(input.userText).filter(
      (domain) => !nextExcludedCategories.includes(domain),
    ),
  ) as TaskDomain[];
  const requestedDomain =
    detectedRequestedDomain !== "general" &&
    !hasExplicitTaskDomainRequest(input.userText, detectedRequestedDomain) &&
    nextExcludedCategories.includes(normalizeTaskCategory(detectedRequestedDomain))
      ? "general"
      : detectedRequestedDomain;
  const explicitDomainRequested =
    requestedDomain !== "general" && hasExplicitTaskDomainRequest(input.userText, requestedDomain);
  const bondageCompatibleRequest = requestsBondageCompatibleTask(input.userText);
  const nextRequestedDomain =
    selectedOption
      ? selectedOption.domain
      : requestedDomain !== "general"
      ? requestedDomain
      : bondageCompatibleRequest
        ? "hands"
      : inferredRequestKind === "replacement" && current.requested_domain !== "none"
        ? current.requested_domain
      : current.requested_domain !== "none"
        ? current.requested_domain
        : requestedDomain;
  const explicitGoal = extractGoal(input.userText);
  const availableItems = listAvailableItems(input.inventory);
  const explicitAvailableItems = extractAvailableItemsFromText(input.userText);
  const correctionRequested =
    isTaskGroundingCorrection(input.userText) || requestsDifferentItemUse(input.userText);
  const inventoryContextSourceText = dedupeList([
    input.userText,
    ...(correctionRequested ? [] : [current.user_goal, current.relevant_inventory_item]),
  ]).join(". ");
  const inventoryContext = resolveInventoryContext(
    input.inventory,
    inventoryContextSourceText,
    nextRequestedDomain,
  );
  const selectedInventoryItem = findInventoryItemForTask(
    input.inventory ?? [],
    inventoryContextSourceText,
    taskKindForDomain(nextRequestedDomain),
  );
  const inventorySuggestedDomain = suggestedDomainFromInventoryItem(selectedInventoryItem);
  const correctedRequestedDomain =
    correctionRequested &&
    inventorySuggestedDomain &&
    !explicitDomainRequested
      ? inventorySuggestedDomain
      : nextRequestedDomain;
  const shouldAvoidCurrentFamily =
    (inferredRequestKind === "replacement" ||
      requestedInventorySemanticsMismatch(
        input.userText,
        selectedInventoryItem,
        current.current_task_family,
      )) &&
    !keepsSameStructure(input.userText) &&
    current.current_task_family.length > 0;
  const nextAvoidFamilies = dedupeList([
    ...current.avoid_task_families,
    ...(shouldAvoidCurrentFamily ? [current.current_task_family] : []),
  ]);
  const preserveCurrentFamily =
    inferredRequestKind === "revision" &&
    current.current_task_family.length > 0 &&
    !explicitDomainRequested;
  const preserveResolvedInventoryDetails =
    current.resolved_blockers.includes("inventory_details") &&
    (inferredRequestKind === "replacement" || inferredRequestKind === "revision") &&
    current.relevant_inventory_item.length > 0 &&
    (
      !inventoryContext.itemLabel ||
      normalize(inventoryContext.itemLabel) === normalize(current.relevant_inventory_item)
    );
  const inferredRelevantInventoryItem = selectedInventoryItem
    ? getSessionInventoryDisplayName(selectedInventoryItem)
    : "";
  const nextRelevantInventoryItem =
    inventoryContext.itemLabel ||
    (preserveResolvedInventoryDetails ? current.relevant_inventory_item : "") ||
    current.relevant_inventory_item ||
    inferredRelevantInventoryItem;
  const currentRelevantInventoryItem = findCurrentRelevantInventoryItem(
    input.inventory,
    nextRelevantInventoryItem || current.relevant_inventory_item,
  );
  const inventoryUseGoal = extractInventoryUseGoal(
    input.userText,
    currentRelevantInventoryItem,
    nextRelevantInventoryItem || current.relevant_inventory_item,
  );
  const nextInventoryClarificationQuestion = preserveResolvedInventoryDetails
    ? ""
    : inventoryContext.clarificationQuestion;
  const next: TaskSpec = {
    ...current,
    requested_domain: correctedRequestedDomain,
    user_goal:
      explicitGoal ||
      inventoryUseGoal ||
      (correctionRequested ? "" : current.user_goal || truncate(input.currentUserGoal ?? "", 80)),
    available_items:
      availableItems.length > 0
        ? availableItems
        : explicitAvailableItems.length > 0
          ? explicitAvailableItems
          : current.available_items,
    duration_minutes:
      explicitDurationMinutes ??
      (durationRevisionRequest && !explicitDurationMinutes ? null : current.duration_minutes),
    difficulty:
      extractDifficulty(input.userText) !== "unspecified"
        ? extractDifficulty(input.userText)
        : current.difficulty,
    repeat_count: extractRepeatCount(input.userText) ?? current.repeat_count,
    proof_or_checkin_type:
      extractProofType(input.userText) !== "unspecified"
        ? extractProofType(input.userText)
        : current.proof_or_checkin_type,
    modifiers: dedupeList([...current.modifiers, ...extractModifiers(input.userText)]),
    active_constraints: dedupeList([...current.active_constraints, ...extractConstraints(input.userText)]),
    current_task_domain: input.currentTaskDomain,
    locked_task_domain: input.lockedTaskDomain,
    can_replan_task: input.canReplanTask,
    reason_for_lock: input.reasonForLock,
    asked_question_slots: current.asked_question_slots,
    relevant_inventory_item: nextRelevantInventoryItem,
    inventory_clarification_question: nextInventoryClarificationQuestion,
    selection_mode: nextSelectionMode,
    request_kind: inferredRequestKind,
    allow_raven_to_choose_alone: wantsRavenToChoose(input.userText)
      ? true
      : nextSelectionMode !== "direct_assignment"
        ? false
        : current.allow_raven_to_choose_alone,
    excluded_task_categories: nextExcludedCategories,
    preferred_task_categories:
      nextPreferredCategories.length > 0 ? nextPreferredCategories : current.preferred_task_categories,
    available_task_categories: current.available_task_categories,
    avoid_task_families: nextAvoidFamilies,
    novelty_pressure:
      inferredRequestKind === "replacement" || inferredRequestKind === "reroll" ? "high" : "normal",
    presented_options:
      selectedOption || inferredRequestKind !== current.request_kind
        ? []
        : current.presented_options,
    selected_option_title: selectedOption?.title ?? "",
    requires_bondage_compatibility: requestsBondageCompatibleTask(input.userText)
      ? true
      : inferredRequestKind === "fresh_assignment"
        ? false
        : current.requires_bondage_compatibility,
    preserve_current_family: preserveCurrentFamily,
  };
  const nextMissingSlots = deriveMissingSlots(
    next,
    input.userText,
    nextInventoryClarificationQuestion,
  );
  const previousBlockers = current.unresolved_blockers.length > 0
    ? current.unresolved_blockers
    : current.missing_slots;
  const resolvedThisTurn = dedupeSlots(
    previousBlockers.filter((slot) => !nextMissingSlots.includes(slot)),
  );
  const lastResolvedBlocker =
    resolvedThisTurn.find((slot) => slot === current.last_asked_blocker) ??
    resolvedThisTurn[resolvedThisTurn.length - 1] ??
    null;
  const requestHasPendingWork = nextMissingSlots.length > 0 || Boolean(input.userText.trim());
  const shouldPresentOptions =
    nextMissingSlots.length === 0 &&
    !selectedOption &&
    (nextSelectionMode === "curated_options" || nextSelectionMode === "collaborative_narrowing");
  const shouldAwaitSelection =
    nextMissingSlots.length === 0 &&
    !selectedOption &&
    nextSelectionMode !== "direct_assignment" &&
    current.presented_options.length > 0 &&
    !wantsCuratedOptions(input.userText);
  const fulfillmentLocked =
    nextMissingSlots.length === 0 &&
    requestHasPendingWork &&
    !shouldPresentOptions &&
    !shouldAwaitSelection;
  const nextRequestStage: TaskRequestStage =
    nextMissingSlots.length > 0
      ? "collecting_blockers"
      : shouldPresentOptions
        ? "presenting_options"
        : shouldAwaitSelection
          ? "awaiting_selection"
          : requestHasPendingWork
            ? "ready_to_fulfill"
            : current.request_stage;
  const nextRequiredAction: TaskNextRequiredAction =
    nextMissingSlots.length > 0
      ? "ask_blocker"
      : shouldPresentOptions
        ? "present_options"
        : shouldAwaitSelection
          ? "await_selection"
          : "fulfill_request";
  const nextWithDerivedCategories = {
    ...next,
    available_task_categories: inferAvailableTaskCategories({
      ...next,
      available_task_categories: current.available_task_categories,
    } as TaskSpec),
  };
  return {
    ...nextWithDerivedCategories,
    missing_slots: nextMissingSlots,
    unresolved_blockers: nextMissingSlots,
    resolved_blockers: dedupeSlots([
      ...current.resolved_blockers.filter((slot) => !nextMissingSlots.includes(slot)),
      ...resolvedThisTurn,
    ]).slice(-8),
    request_stage: nextRequestStage,
    next_required_action: nextRequiredAction,
    fulfillment_locked: fulfillmentLocked,
    request_fulfilled: false,
    last_asked_blocker:
      current.last_asked_blocker && nextMissingSlots.includes(current.last_asked_blocker)
        ? current.last_asked_blocker
        : null,
    last_resolved_blocker: lastResolvedBlocker,
  };
}

export function noteTaskSpecAssistantAssignment(
  taskSpec: TaskSpec,
  domain: TaskDomain,
  options?: {
    templateId?: DeterministicTaskTemplateId;
  },
): TaskSpec {
  const currentFamily = options?.templateId ? taskFamilyForTemplateId(options.templateId) : taskSpec.current_task_family;
  return {
    ...taskSpec,
    requested_domain: domain,
    current_task_domain: domain,
    missing_slots: [],
    unresolved_blockers: [],
    request_stage: "fulfilled",
    next_required_action: "none",
    fulfillment_locked: false,
    request_fulfilled: true,
    last_asked_blocker: null,
    last_resolved_blocker: null,
    selection_mode: "direct_assignment",
    request_kind: "fresh_assignment",
    current_task_family: currentFamily,
    recent_task_families: dedupeList([...taskSpec.recent_task_families, currentFamily]).slice(-6),
    avoid_task_families: [],
    novelty_pressure: "normal",
    presented_options: [],
    selected_option_title: "",
    preserve_current_family: false,
  };
}

export function noteTaskSpecQuestionAsked(
  taskSpec: TaskSpec,
  slot: TaskSpecMissingSlot,
): TaskSpec {
  return {
    ...taskSpec,
    asked_question_slots: [...taskSpec.asked_question_slots, slot].slice(-6),
    request_stage: "collecting_blockers",
    next_required_action: "ask_blocker",
    fulfillment_locked: false,
    request_fulfilled: false,
    last_asked_blocker: slot,
  };
}

export function noteTaskSpecAssistantText(taskSpec: TaskSpec, text: string): TaskSpec {
  const normalized = normalize(text);
  const presentedOptions = parsePresentedOptionsFromAssistantText(text);
  if (presentedOptions.length > 0) {
    return {
      ...taskSpec,
      request_stage: "awaiting_selection",
      next_required_action: "await_selection",
      fulfillment_locked: false,
      request_fulfilled: false,
      presented_options: presentedOptions,
      selected_option_title: "",
    };
  }
  if (!normalized.includes("?")) {
    return taskSpec;
  }
  const slot: TaskSpecMissingSlot | null =
    /\bposture\b|\bstillness\b|\bframe\b|\bhands\b|\bdevice\b/.test(normalized)
      ? "requested_domain"
      : /\bavailable\b|\bgear\b|\btools\b|\bon hand\b/.test(normalized)
        ? "available_items"
        : /\bexactly what\b|\bhow it should be used\b|\blinked device is meant to control\b/.test(normalized)
          ? "inventory_details"
        : /\bhow long\b|\btime window\b|\blength\b/.test(normalized)
          ? "duration_minutes"
          : /\bstandalone\b|\bpaired\b|\bcombine\b|\bsecond condition\b/.test(normalized)
            ? "combine_mode"
            : /\beasy\b|\bmoderate\b|\bhard\b|\blight\b|\bbalanced\b/.test(normalized)
              ? "difficulty"
              : /\bhalfway\b|\bproof\b|\breport\b|\baccountability\b/.test(normalized)
                ? "proof_or_checkin_type"
                : null;
  return slot ? noteTaskSpecQuestionAsked(taskSpec, slot) : taskSpec;
}

export function chooseNextTaskSpecQuestion(taskSpec: TaskSpec): TaskQuestionDecision | null {
  if (
    taskSpec.fulfillment_locked ||
    taskSpec.next_required_action === "fulfill_request" ||
    taskSpec.request_stage === "ready_to_fulfill" ||
    taskSpec.next_required_action === "present_options" ||
    taskSpec.next_required_action === "await_selection"
  ) {
    return null;
  }
  const nextSlot = taskSpec.missing_slots[0];
  if (!nextSlot) {
    return null;
  }
  const variants = buildQuestionVariants(taskSpec, nextSlot);
  return {
    slot: nextSlot,
    question: choosePhrase(variants, askedCount(taskSpec, nextSlot)),
  };
}

export function isTaskSpecReady(taskSpec: TaskSpec): boolean {
  return taskSpec.missing_slots.length === 0;
}

export function buildTaskCandidatesFromSpec(input: TaskCandidateBuildInput): TaskCandidate[] {
  const recentTaskTemplates = dedupeList(
    (input.recentTaskTemplates ?? []).map((templateId) => templateId),
  ) as DeterministicTaskTemplateId[];
  const taskHistory = (input.taskHistory ?? []).map((entry) => fingerprintTaskHistoryEntry(entry));
  const userText = buildCandidateUserText(input.taskSpec, input.userText);
  const rankedCatalogEntries = buildCatalogEntriesForSpec(
    input.taskSpec,
    input.currentTemplateId,
    recentTaskTemplates,
    taskHistory,
  );
  const candidates = rankedCatalogEntries.map(({ entry }) => {
    const candidateUserText = dedupeList([
      userText,
      ...entry.tags,
      input.taskSpec.selected_option_title ? `chosen ${input.taskSpec.selected_option_title}` : "",
    ]).join(". ");
    const plan = buildDeterministicTaskPlanFromRequest({
      userText: candidateUserText,
      sceneType: input.sceneType,
      hasStakes: input.hasStakes,
      hasTaskTerms: input.hasTaskTerms,
      allowSilenceHold: input.allowSilenceHold,
      profile: input.profile,
      inventory: input.inventory,
      progress: input.progress,
      templateId: entry.templateId,
      variantIndex: entry.variantIndex,
      rewardLine: input.rewardLine,
      consequenceLine: input.consequenceLine,
      stakesLine: input.stakesLine,
      leadInLine: entry.leadInLine,
    });
    const domain = taskDomainFromTemplateId(plan.template.id);
    const summary = plan.description;
    const steps = buildCandidateSteps(input.taskSpec, plan);
    const duration = formatDuration(plan.durationMinutes);
    const validation = validateCandidate(input.taskSpec, plan, userText, {
      title: plan.createPayload.title,
      summary,
      steps,
      difficulty: input.taskSpec.difficulty,
      duration,
      modifiers: input.taskSpec.modifiers,
      repeatsRequired: plan.repeatsRequired,
    }, taskHistory, input.currentTemplateId, recentTaskTemplates);
    return {
      catalog_entry_id: entry.id,
      title: plan.createPayload.title,
      domain,
      family: entry.family,
      summary,
      steps,
      duration,
      difficulty: input.taskSpec.difficulty,
      checkin_or_proof_requirement: buildCandidateCheckRequirement(input.taskSpec, plan),
      why_it_fits: buildCandidateWhyFits(input.taskSpec, plan),
      novelty_check: buildNoveltyCheckLabel({
        novelEnough: validation.novel_enough,
        score: validation.novelty_score,
        breakdown: validation.novelty_breakdown,
      }),
      strategy:
        entry.intensity === "high"
          ? "precision"
          : entry.structureType === "protocol"
            ? "paired"
            : "anchor",
      plan,
      validation,
    };
  });
  return candidates;
}

export function selectTaskCandidate(
  candidates: TaskCandidate[],
  requestedDomain: TaskDomain | "none" = "none",
  taskSpec?: Pick<TaskSpec, "selected_option_title" | "excluded_task_categories" | "current_task_family">,
): TaskCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  if (taskSpec?.selected_option_title) {
    const selectedOptionMatch = candidates.find(
      (candidate) =>
        (
          normalize(candidate.title) === normalize(taskSpec.selected_option_title) ||
          normalize(taskOptionTitleForCandidate(candidate)) === normalize(taskSpec.selected_option_title)
        ) &&
        candidate.validation.actionable,
    );
    if (selectedOptionMatch) {
      return selectedOptionMatch;
    }
  }
  const exact = candidates.find(
    (candidate) =>
      candidate.validation.matches_request &&
      candidate.validation.respects_lock &&
      candidate.validation.novel_enough &&
      candidate.validation.actionable,
  );
  if (exact) {
    return exact;
  }
  const aligned = candidates.find(
    (candidate) =>
      candidate.validation.matches_request &&
      candidate.validation.respects_lock &&
      candidate.validation.actionable,
  );
  if (aligned) {
    return aligned;
  }
  if (requestedDomain !== "none" && requestedDomain !== "general") {
    return null;
  }
  return candidates.find((candidate) => candidate.validation.actionable) ?? candidates[0] ?? null;
}

export function buildTaskCandidateDebugSummary(
  taskSpec: TaskSpec,
  candidates: TaskCandidate[],
  selectedCandidate: TaskCandidate | null,
): string {
  const candidateDomains = candidates
    .map((candidate) => `${candidate.domain}/${candidate.family}:${candidate.validation.rejection_reasons.join("|") || "accepted"}`)
    .join("; ");
  return [
    `requested_domain=${taskSpec.requested_domain}`,
    `selection_mode=${taskSpec.selection_mode}`,
    `request_kind=${taskSpec.request_kind}`,
    `candidate_domains=${candidateDomains || "none"}`,
    `selected_domain=${selectedCandidate?.domain ?? "none"}`,
    `selected_title=${selectedCandidate?.title ?? "none"}`,
  ].join(" ");
}

export function buildTaskCandidateReply(
  candidate: TaskCandidate,
  alternativesCount: number,
  taskSpec?: Pick<TaskSpec, "user_goal" | "relevant_inventory_item">,
): string {
  void alternativesCount;
  const selectedItem = candidate.plan.selectedInventoryItem;
  if (
    selectedItem &&
    describeInventorySemantics(selectedItem).isInsertableToy &&
    /\b(keep the device on|put the device on|secure the device|lock the device|keep it locked)\b/i.test(
      candidate.plan.assignmentText,
    )
  ) {
    const catalogEntry = taskCatalogEntryForId(candidate.catalog_entry_id);
    const itemName = getSessionInventoryDisplayName(selectedItem);
    const repairedUserText = [
      taskSpec?.user_goal || candidate.summary,
      `use ${itemName}`,
      `${candidate.plan.durationMinutes} minutes`,
    ]
      .filter((part) => part.length > 0)
      .join(". ");
    return buildDeterministicTaskPlanFromRequest({
      userText: repairedUserText,
      inventory: [selectedItem],
      templateId: candidate.plan.template.id,
      variantIndex: candidate.plan.variantIndex,
      leadInLine: catalogEntry?.leadInLine,
    }).assignmentText;
  }
  return candidate.plan.assignmentText;
}

export function selectTaskOptions(
  candidates: TaskCandidate[],
  taskSpec: TaskSpec,
  count = 3,
): TaskCandidate[] {
  const actionable = candidates.filter(
    (candidate) =>
      candidate.validation.actionable &&
      candidate.validation.matches_request &&
      candidate.validation.respects_lock,
  );
  const distinct = chooseDistinctTaskCandidates(actionable, count, taskSpec);
  if (distinct.length > 0) {
    return distinct;
  }
  return chooseDistinctTaskCandidates(candidates, count, taskSpec);
}

export function buildTaskOptionsReply(options: TaskCandidate[], taskSpec: TaskSpec): string {
  const opener =
    taskSpec.request_kind === "replacement"
      ? "Fine. You asked for a different task, not the same thing in a new wrapper."
      : taskSpec.selection_mode === "collaborative_narrowing"
        ? "Fine. I will narrow it properly instead of forcing one stale default."
        : "Fine. I can give you a few concrete ways to do it, and each one comes with a real accountability line.";
  const list = options
    .slice(0, 3)
    .map(
      (option, index) =>
        `${index + 1}. ${taskOptionTitleForCandidate(option)}: ${buildTaskOptionSummary(option)}`,
    );
  return [
    opener,
    ...list,
    "Pick one cleanly, or tell me to choose.",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

export function buildTaskSpecPromptBlock(taskSpec: TaskSpec): string {
  return [
    "Task Spec:",
    `Requested domain: ${taskSpec.requested_domain}`,
    `User goal: ${taskSpec.user_goal || "none"}`,
    `Available items: ${taskSpec.available_items.join(", ") || "none"}`,
    `Duration minutes: ${taskSpec.duration_minutes ?? "none"}`,
    `Difficulty: ${taskSpec.difficulty}`,
    `Repeat count: ${taskSpec.repeat_count ?? "none"}`,
    `Proof or check-in: ${taskSpec.proof_or_checkin_type}`,
    `Modifiers: ${taskSpec.modifiers.join(", ") || "none"}`,
    `Constraints: ${taskSpec.active_constraints.join(", ") || "none"}`,
    `Missing slots: ${taskSpec.missing_slots.join(", ") || "none"}`,
    `Unresolved blockers: ${taskSpec.unresolved_blockers.join(", ") || "none"}`,
    `Resolved blockers: ${taskSpec.resolved_blockers.join(", ") || "none"}`,
    `Request stage: ${taskSpec.request_stage}`,
    `Next required action: ${taskSpec.next_required_action}`,
    `Fulfillment locked: ${taskSpec.fulfillment_locked ? "yes" : "no"}`,
    `Request fulfilled: ${taskSpec.request_fulfilled ? "yes" : "no"}`,
    `Last asked blocker: ${taskSpec.last_asked_blocker ?? "none"}`,
    `Last resolved blocker: ${taskSpec.last_resolved_blocker ?? "none"}`,
    `Relevant inventory item: ${taskSpec.relevant_inventory_item || "none"}`,
    `Inventory clarification question: ${taskSpec.inventory_clarification_question || "none"}`,
    `Selection mode: ${taskSpec.selection_mode}`,
    `Request kind: ${taskSpec.request_kind}`,
    `Allow Raven to choose alone: ${taskSpec.allow_raven_to_choose_alone ? "yes" : "no"}`,
    `Excluded task categories: ${taskSpec.excluded_task_categories.join(", ") || "none"}`,
    `Preferred task categories: ${taskSpec.preferred_task_categories.join(", ") || "none"}`,
    `Available task categories: ${taskSpec.available_task_categories.join(", ") || "none"}`,
    `Current task family: ${taskSpec.current_task_family || "none"}`,
    `Avoid task families: ${taskSpec.avoid_task_families.join(", ") || "none"}`,
    `Recent task families: ${taskSpec.recent_task_families.join(", ") || "none"}`,
    `Novelty pressure: ${taskSpec.novelty_pressure}`,
    `Presented options: ${taskSpec.presented_options.map((option) => option.title).join(", ") || "none"}`,
    `Selected option title: ${taskSpec.selected_option_title || "none"}`,
    `Bondage compatibility required: ${taskSpec.requires_bondage_compatibility ? "yes" : "no"}`,
    `Preserve current family: ${taskSpec.preserve_current_family ? "yes" : "no"}`,
    `Current task domain: ${taskSpec.current_task_domain}`,
    `Locked task domain: ${taskSpec.locked_task_domain}`,
    `Can replan task: ${taskSpec.can_replan_task ? "yes" : "no"}`,
    `Reason for lock: ${taskSpec.reason_for_lock || "none"}`,
  ].join("\n");
}

export function buildLockedTaskSpecReply(taskSpec: TaskSpec): string {
  const domainLabel = formatTaskDomainLabel(
    taskSpec.requested_domain !== "none" ? taskSpec.requested_domain : taskSpec.current_task_domain,
  );
  return [
    `I heard the request for a ${domainLabel} task.`,
    taskSpec.reason_for_lock || "The current flow stays locked first.",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}
