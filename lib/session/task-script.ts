import type { ProfileProgressRow, TaskStrictnessMode } from "@/lib/db";
import type { ProfileState } from "@/lib/profile";
import {
  buildInventoryClarificationQuestion,
  describeInventorySemantics,
  findInventoryItemForTask,
  formatInventoryTitleSuffix,
  getSessionInventoryDisplayName,
  needsInventoryClarification,
  type SessionInventoryItem,
} from "./session-inventory.ts";
import { planDynamicTaskLanguage } from "./task-wager-planner.ts";

type TaskScriptOptions = {
  leadInLine?: string;
  rewardLine?: string;
  consequenceLine?: string;
  stakesLine?: string;
  template?: DeterministicTaskTemplate;
  variantIndex?: number;
  customDescription?: string;
  customVariant?: Partial<DeterministicTaskVariant>;
  scheduleLine?: string;
};

export type DeterministicTaskProgress =
  | "none"
  | "assigned"
  | "secured"
  | "halfway_checked"
  | "completed";

export type DeterministicTaskTemplateId =
  | "quick_check"
  | "eye_contact_check"
  | "inspection_check"
  | "focus_hold"
  | "silence_hold"
  | "steady_hold"
  | "discipline_hold"
  | "hands_protocol"
  | "kneel_protocol"
  | "shoulders_back_protocol"
  | "stakes_hold"
  | "endurance_hold";

export type TaskDomain =
  | "device"
  | "frame"
  | "stillness"
  | "posture"
  | "hands"
  | "kneeling"
  | "shoulders"
  | "general";

export type DeterministicTaskTemplate = {
  id: DeterministicTaskTemplateId;
  title: string;
  description: string;
  durationMinutes: number;
  pointsPossible: number;
  taskKind: "device_hold" | "frame_hold" | "stillness_hold" | "posture_hold";
  variants: DeterministicTaskVariant[];
};

export type DeterministicTaskVariant = {
  description: string;
  startInstruction: string;
  assignedAction: string;
  activeFollowUp: string;
  completionText: string;
};

type DeterministicTaskTemplateInput = {
  sceneType?: string;
  hasStakes?: boolean;
  hasTaskTerms?: boolean;
  userText?: string;
  allowSilenceHold?: boolean;
  profile?: ProfileState;
  inventory?: SessionInventoryItem[];
  progress?: Pick<
    ProfileProgressRow,
    "current_tier" | "free_pass_count" | "last_completion_summary"
  >;
};

type DeterministicTaskCreatePayload = {
  type: "create_task" | "create_rule" | "create_habit" | "create_challenge";
  title: string;
  description: string;
  window_seconds: number;
  repeats_required: number;
  points_possible: number;
  schedule:
    | { type: "one_time" }
    | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean };
  evidence: {
    required: boolean;
    type: "manual";
    checks: [];
    max_attempts: number;
    deny_user_override: boolean;
  };
  strictness_mode: TaskStrictnessMode;
  program_kind: "task" | "rule" | "habit" | "challenge";
  reward_plan: {
    catalog_id: "reward_positive_message";
    params: { template_id: "approval_brief" | "approval_firm" | "approval_warm" };
  };
  consequence_plan: {
    catalog_id: "penalty_points";
    params: { penalty_points: number };
  };
};

export type DeterministicTaskPlan = {
  template: DeterministicTaskTemplate;
  variantIndex: number;
  durationMinutes: number;
  repeatsRequired: number;
  schedule:
    | { type: "one_time" }
    | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean };
  programKind: "task" | "habit" | "challenge";
  description: string;
  scheduleLine: string;
  assignmentText: string;
  adaptiveSummary: {
    selection: string;
    policy: string;
    reward: string;
    consequence: string;
  };
  selectedInventoryItem: SessionInventoryItem | null;
  needsInventoryClarification: boolean;
  inventoryClarificationQuestion: string | null;
  createPayload: DeterministicTaskCreatePayload;
};

type DynamicTaskLanguage = {
  titleLabel: string;
  description: string;
  selectionReason: string;
  variant: Partial<DeterministicTaskVariant>;
};

export function taskDomainFromTemplateId(templateId: DeterministicTaskTemplateId): TaskDomain {
  switch (templateId) {
    case "quick_check":
    case "eye_contact_check":
    case "inspection_check":
      return "frame";
    case "focus_hold":
      return "stillness";
    case "silence_hold":
    case "steady_hold":
    case "stakes_hold":
    case "endurance_hold":
      return "device";
    case "hands_protocol":
      return "hands";
    case "kneel_protocol":
      return "kneeling";
    case "shoulders_back_protocol":
      return "shoulders";
    case "discipline_hold":
      return "posture";
    default:
      return "general";
  }
}

export function detectTaskDomainFromUserText(text: string): TaskDomain {
  const normalized = normalize(text);
  if (!normalized) {
    return "general";
  }
  if (includesAny(normalized, [/\b(hands behind|hands back|behind your back|hands(?:-back)? task|hands drill|hands protocol)\b/i])) {
    return "hands";
  }
  if (includesAny(normalized, [/\b(kneel|kneeling|on your knees)\b/i])) {
    return "kneeling";
  }
  if (includesAny(normalized, [/\b(shoulders back|chin up)\b/i])) {
    return "shoulders";
  }
  if (includesAny(normalized, [/\b(posture|stand tall|upright posture)\b/i])) {
    return "posture";
  }
  if (
    includesAny(normalized, [
      /\b(inspection|inspect|camera check|inspection frame)\b/i,
      /\b(eye contact|eyes on me|look at me|frame|visible|centered)\b/i,
    ])
  ) {
    return "frame";
  }
  if (includesAny(normalized, [/\b(silent|silence|quiet|no talking)\b/i])) {
    return "stillness";
  }
  if (includesAny(normalized, [/\b(still|stillness|focus|steady|calm)\b/i])) {
    return "stillness";
  }
  if (
    includesAny(normalized, [
      /\b(chastity|cage|device|locked|lock|dildo|plug|vibe|vibrator|toy|anal|anus|oral|throat|mouth|gag|prostate)\b/i,
    ])
  ) {
    return "device";
  }
  return "general";
}

export function formatTaskDomainLabel(domain: TaskDomain): string {
  switch (domain) {
    case "device":
      return "device";
    case "frame":
      return "frame";
    case "stillness":
      return "stillness";
    case "posture":
      return "posture";
    case "hands":
      return "hands-back";
    case "kneeling":
      return "kneeling";
    case "shoulders":
      return "shoulders-back";
    default:
      return "task";
  }
}

const DEFAULT_TASK_DURATION_MINUTES = 120;

const TASK_VARIANT_CURSOR: Record<DeterministicTaskTemplateId, number> = {
  quick_check: 0,
  eye_contact_check: 0,
  inspection_check: 0,
  focus_hold: 0,
  silence_hold: 0,
  steady_hold: 0,
  discipline_hold: 0,
  hands_protocol: 0,
  kneel_protocol: 0,
  shoulders_back_protocol: 0,
  stakes_hold: 0,
  endurance_hold: 0,
};

export function resetDeterministicTaskVariantCursor(): void {
  for (const templateId of Object.keys(TASK_VARIANT_CURSOR) as DeterministicTaskTemplateId[]) {
    TASK_VARIANT_CURSOR[templateId] = 0;
  }
}

const DETERMINISTIC_TASK_TEMPLATES: Record<DeterministicTaskTemplateId, DeterministicTaskTemplate> =
  {
    quick_check: {
      id: "quick_check",
      title: "Quick check task",
      description:
        "Stay fully in frame for 30 minutes, keep your face forward, and report back when the time is up.",
      durationMinutes: 30,
      pointsPossible: 3,
      taskKind: "frame_hold",
      variants: [
        {
          description:
            "Stay fully in frame for 30 minutes, keep your face forward, and report back when the time is up.",
          startInstruction:
            "Start now. Get fully in frame now and reply done once you are set, pet.",
          assignedAction: "get into frame and reply done",
          activeFollowUp: "Stay in frame and keep your face forward, pet.",
          completionText:
            "Good pet. You stayed in frame and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep your face centered in frame for 30 minutes, stay attentive, and report back when the time is up.",
          startInstruction:
            "Start now. Center your face in frame and reply done once you are set, pet.",
          assignedAction: "center your face in frame and reply done",
          activeFollowUp: "Keep your face centered and stay attentive, pet.",
          completionText:
            "Good pet. You held your frame cleanly and reported on time. The task is complete.",
        },
      ],
    },
    eye_contact_check: {
      id: "eye_contact_check",
      title: "Eye contact check task",
      description:
        "Keep your eyes forward and your face centered for 15 minutes, hold steady, and report back when the time is up.",
      durationMinutes: 15,
      pointsPossible: 2,
      taskKind: "frame_hold",
      variants: [
        {
          description:
            "Keep your eyes forward and your face centered for 15 minutes, hold steady, and report back when the time is up.",
          startInstruction:
            "Start now. Put your eyes on me and reply done once your focus is set, pet.",
          assignedAction: "set your focus and reply done",
          activeFollowUp: "Keep your eyes on me and your face centered, pet.",
          completionText: "Good pet. You held your focus where it belongs. The task is complete.",
        },
        {
          description:
            "Hold a clean eye-contact frame for 15 minutes, stay centered, and report back when the time is up.",
          startInstruction:
            "Start now. Center yourself and reply done once your eyes are fixed forward, pet.",
          assignedAction: "center yourself and reply done",
          activeFollowUp: "Keep your eyes fixed forward and do not drift, pet.",
          completionText:
            "Good pet. You held clean eye contact and reported on time. The task is complete.",
        },
      ],
    },
    inspection_check: {
      id: "inspection_check",
      title: "Inspection check task",
      description:
        "Stay fully visible for 20 minutes, keep your face forward, and hold a clean inspection frame until time is up.",
      durationMinutes: 20,
      pointsPossible: 3,
      taskKind: "frame_hold",
      variants: [
        {
          description:
            "Stay fully visible for 20 minutes, keep your face forward, and hold a clean inspection frame until time is up.",
          startInstruction:
            "Start now. Square yourself to the camera and reply done once your inspection frame is set, pet.",
          assignedAction: "set your inspection frame and reply done",
          activeFollowUp: "Hold your inspection frame and keep your face forward, pet.",
          completionText:
            "Good pet. You held a clean inspection frame and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep your upper body fully visible for 20 minutes, stay centered, and hold that inspection position until time is up.",
          startInstruction:
            "Start now. Get your upper body centered in frame and reply done once you are set, pet.",
          assignedAction: "center your upper body in frame and reply done",
          activeFollowUp: "Keep your upper body centered and do not drift, pet.",
          completionText:
            "Good pet. You kept a clean inspection position and reported on time. The task is complete.",
        },
      ],
    },
    focus_hold: {
      id: "focus_hold",
      title: "Focus hold task",
      description:
        "Hold still for 1 hour, stay steady, check in once halfway through, and report back when it is done.",
      durationMinutes: 60,
      pointsPossible: 4,
      taskKind: "stillness_hold",
      variants: [
        {
          description:
            "Hold still for 1 hour, stay steady, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Hold still now and reply done once you are set, pet.",
          assignedAction: "hold still and reply done",
          activeFollowUp: "Hold still and keep the pace clean, pet.",
          completionText: "Good pet. You held still and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep your movements controlled for 1 hour, stay quiet, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Settle your movement and reply done once you are set, pet.",
          assignedAction: "settle your movement and reply done",
          activeFollowUp: "Keep your movement controlled and quiet, pet.",
          completionText:
            "Good pet. You kept your movement controlled and reported cleanly. The task is complete.",
        },
      ],
    },
    silence_hold: {
      id: "silence_hold",
      title: "Silence hold task",
      description:
        "Keep the device on and stay silent for 45 minutes, keep your pace controlled, and report back when the time is up.",
      durationMinutes: 45,
      pointsPossible: 4,
      taskKind: "device_hold",
      variants: [
        {
          description:
            "Keep the device on and stay silent for 45 minutes, keep your pace controlled, and report back when the time is up.",
          startInstruction:
            "Start now. Secure the device, set your silence, and reply done once you are under control, pet.",
          assignedAction: "secure the device and reply done",
          activeFollowUp: "Keep the device on and keep your mouth shut, pet.",
          completionText:
            "Good pet. You kept the device on and held your silence cleanly. The task is complete.",
        },
        {
          description:
            "Keep the device locked and stay silent for 45 minutes, hold steady, and report back when the time is up.",
          startInstruction:
            "Start now. Lock the device in place and reply done once you are silent and secure, pet.",
          assignedAction: "lock the device in place and reply done",
          activeFollowUp: "Keep it locked and keep quiet, pet.",
          completionText:
            "Good pet. You stayed silent and kept the device secure. The task is complete.",
        },
      ],
    },
    steady_hold: {
      id: "steady_hold",
      title: "Session hold task",
      description:
        "Keep the device on for 2 hours, check in once halfway through, and report back when it is done.",
      durationMinutes: 120,
      pointsPossible: 5,
      taskKind: "device_hold",
      variants: [
        {
          description:
            "Keep the device on for 2 hours, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Put the device on now and reply done once it is secure, pet.",
          assignedAction: "put the device on and reply done",
          activeFollowUp: "Keep the device on, pet.",
          completionText: "Good pet. You held the device cleanly and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep the device locked for 2 hours, stay disciplined, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Lock the device in place and reply done once it is secure, pet.",
          assignedAction: "lock the device in place and reply done",
          activeFollowUp: "Keep the device locked and do not break the hold, pet.",
          completionText:
            "Good pet. You kept the device locked and reported cleanly. The task is complete.",
        },
      ],
    },
    discipline_hold: {
      id: "discipline_hold",
      title: "Discipline hold task",
      description:
        "Hold a strict upright posture for 90 minutes, check in once halfway through, and report back when it is done.",
      durationMinutes: 90,
      pointsPossible: 6,
      taskKind: "posture_hold",
      variants: [
        {
          description:
            "Hold a strict upright posture for 90 minutes, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Set your posture now and reply done once you are set, pet.",
          assignedAction: "set your posture and reply done",
          activeFollowUp: "Hold that posture and do not break it, pet.",
          completionText:
            "Good pet. You held the posture and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep your hands behind your back for 90 minutes, stay upright, check in once halfway through, and report back when it is done.",
          startInstruction:
            "Start now. Set your hands behind your back and reply done once you are set, pet.",
          assignedAction: "set your hands behind your back and reply done",
          activeFollowUp: "Keep your hands behind your back and stay upright, pet.",
          completionText:
            "Good pet. You held your position and reported cleanly. The task is complete.",
        },
      ],
    },
    hands_protocol: {
      id: "hands_protocol",
      title: "Hands-back protocol task",
      description:
        "Keep your hands behind your back for 45 minutes, stay upright, and report back when the time is up.",
      durationMinutes: 45,
      pointsPossible: 5,
      taskKind: "posture_hold",
      variants: [
        {
          description:
            "Keep your hands behind your back for 45 minutes, stay upright, and report back when the time is up.",
          startInstruction:
            "Start now. Put your hands behind your back and reply done once you are set, pet.",
          assignedAction: "put your hands behind your back and reply done",
          activeFollowUp: "Keep your hands behind your back and stay upright, pet.",
          completionText:
            "Good pet. You kept your hands where they belong and reported cleanly. The task is complete.",
        },
        {
          description:
            "Lock your hands behind your back for 45 minutes, hold your posture, and report back when the time is up.",
          startInstruction:
            "Start now. Lock your hands behind your back and reply done once you are set, pet.",
          assignedAction: "lock your hands behind your back and reply done",
          activeFollowUp: "Keep your hands back and your posture clean, pet.",
          completionText:
            "Good pet. You held that protocol cleanly and reported on time. The task is complete.",
        },
      ],
    },
    kneel_protocol: {
      id: "kneel_protocol",
      title: "Kneel protocol task",
      description:
        "Hold a kneeling position for 30 minutes, stay upright, and report back when the time is up.",
      durationMinutes: 30,
      pointsPossible: 5,
      taskKind: "posture_hold",
      variants: [
        {
          description:
            "Hold a kneeling position for 30 minutes, stay upright, and report back when the time is up.",
          startInstruction: "Start now. Kneel and reply done once you are set properly, pet.",
          assignedAction: "kneel and reply done",
          activeFollowUp: "Stay kneeling and keep your posture clean, pet.",
          completionText:
            "Good pet. You held that kneeling posture properly. The task is complete.",
        },
        {
          description:
            "Stay on your knees for 30 minutes, keep your spine straight, and report back when the time is up.",
          startInstruction: "Start now. Get on your knees and reply done once you are steady, pet.",
          assignedAction: "get on your knees and reply done",
          activeFollowUp: "Stay on your knees and keep your spine straight, pet.",
          completionText:
            "Good pet. You stayed where you were put and reported cleanly. The task is complete.",
        },
      ],
    },
    shoulders_back_protocol: {
      id: "shoulders_back_protocol",
      title: "Shoulders-back protocol task",
      description:
        "Keep your shoulders back and your chin up for 30 minutes, hold steady, and report back when the time is up.",
      durationMinutes: 30,
      pointsPossible: 4,
      taskKind: "posture_hold",
      variants: [
        {
          description:
            "Keep your shoulders back and your chin up for 30 minutes, hold steady, and report back when the time is up.",
          startInstruction:
            "Start now. Set your shoulders back and reply done once your posture is clean, pet.",
          assignedAction: "set your shoulders back and reply done",
          activeFollowUp: "Keep your shoulders back and your chin up, pet.",
          completionText: "Good pet. You held that posture cleanly. The task is complete.",
        },
        {
          description:
            "Hold your shoulders open and your chin lifted for 30 minutes, stay controlled, and report back when the time is up.",
          startInstruction:
            "Start now. Lift your chin, open your shoulders, and reply done once you are set, pet.",
          assignedAction: "lift your chin and reply done",
          activeFollowUp: "Keep that posture open and controlled, pet.",
          completionText:
            "Good pet. You kept your posture where it should be. The task is complete.",
        },
      ],
    },
    stakes_hold: {
      id: "stakes_hold",
      title: "Stakes hold task",
      description:
        "Keep the device on for 3 hours, check in once halfway through, and report back when it is done.",
      durationMinutes: 180,
      pointsPossible: 8,
      taskKind: "device_hold",
      variants: [
        {
          description:
            "Keep the device on for 3 hours, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Put the device on now and reply done once it is secure, pet.",
          assignedAction: "put the device on and reply done",
          activeFollowUp: "Keep the device on, pet.",
          completionText: "Good pet. You held the device cleanly and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep the device locked for 3 hours under the agreed stakes, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Lock the device in place and reply done once it is secure, pet.",
          assignedAction: "lock the device in place and reply done",
          activeFollowUp: "Keep the device locked and remember the stakes, pet.",
          completionText:
            "Good pet. You held the stakes cleanly and reported on time. The task is complete.",
        },
      ],
    },
    endurance_hold: {
      id: "endurance_hold",
      title: "Endurance hold task",
      description:
        "Keep the device on for 4 hours, stay disciplined, check in once halfway through, and report back when it is done.",
      durationMinutes: 240,
      pointsPossible: 10,
      taskKind: "device_hold",
      variants: [
        {
          description:
            "Keep the device on for 4 hours, stay disciplined, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Put the device on now and reply done once it is secure, pet.",
          assignedAction: "put the device on and reply done",
          activeFollowUp: "Keep the device on, pet.",
          completionText:
            "Good pet. You held the device through the full stretch and reported cleanly. The task is complete.",
        },
        {
          description:
            "Keep the device locked for 4 hours, stay controlled, check in once halfway through, and report back when it is done.",
          startInstruction: "Start now. Lock the device in place and reply done once it is secure, pet.",
          assignedAction: "lock the device in place and reply done",
          activeFollowUp: "Keep the device locked and stay controlled, pet.",
          completionText:
            "Good pet. You carried the full stretch and reported cleanly. The task is complete.",
        },
      ],
    },
  };

function deriveTaskLabel(template: DeterministicTaskTemplate, normalizedUserText: string): string {
  switch (template.id) {
    case "quick_check":
      return "Frame";
    case "eye_contact_check":
      return "Eye contact";
    case "inspection_check":
      return "Inspection";
    case "focus_hold":
      return "Stillness";
    case "silence_hold":
      return "Silence";
    case "steady_hold":
      return /\b(chastity|cage|locked)\b/.test(normalizedUserText) ? "Chastity" : "Device";
    case "discipline_hold":
      return "Posture";
    case "hands_protocol":
      return "Hands-back";
    case "kneel_protocol":
      return "Kneeling";
    case "shoulders_back_protocol":
      return "Shoulders-back";
    case "stakes_hold":
      return /\b(chastity|cage|locked)\b/.test(normalizedUserText) ? "Chastity" : "Stakes";
    case "endurance_hold":
      return /\b(chastity|cage|locked)\b/.test(normalizedUserText) ? "Chastity" : "Endurance";
    default:
      return "Task";
  }
}

function normalizeTaskFocusFragment(fragment: string): string {
  return fragment
    .replace(/\b(?:please|something|anything|some kind of|around|about)\b/gi, " ")
    .replace(/\bfor\s+\d+\s*(?:minutes?|hours?|times?|repeats?)\b/gi, " ")
    .replace(/\b(?:a|an|the|me|my)\b/gi, " ")
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequestedTaskFocus(text: string): string | null {
  const normalizedText = normalize(text);
  if (!normalizedText) {
    return null;
  }
  const patterns = [
    /\b(?:give|set|assign|make)\s+(?:me\s+)?(?:an?\s+)?(.+?)\s+(?:task|challenge|drill|assignment)\b/i,
    /\bi\s+(?:want|need|would like|want you to give me)\s+(?:an?\s+)?(.+?)\s+(?:task|challenge|drill|assignment)\b/i,
    /\b(?:task|challenge|drill|assignment)\s+(?:for|around|about)\s+(.+?)(?=(?:\bfor\s+\d+\s*(?:minutes?|hours?)\b|$))/i,
  ];
  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    const candidate = normalizeTaskFocusFragment(match?.[1] ?? "");
    if (candidate.length >= 3) {
      return candidate;
    }
  }
  return null;
}

function deriveInventoryTaskFocus(
  userText: string,
  selectedInventoryItem: SessionInventoryItem | null,
): string | null {
  if (!selectedInventoryItem) {
    return null;
  }
  const semantics = describeInventorySemantics(selectedInventoryItem);
  const itemName = getSessionInventoryDisplayName(selectedInventoryItem);
  const normalizedUserText = normalize(userText);
  const itemText = normalize(`${selectedInventoryItem.label} ${selectedInventoryItem.notes}`);
  if (semantics.isChastity || /\b(chastity|cage|locked|lock)\b/.test(itemText)) {
    return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
      ? `chastity training with ${itemName}`
      : `chastity protocol with ${itemName}`;
  }
  if (semantics.isRestraint || /\b(cuffs?|rope|collar|leash|restraint|restrained)\b/.test(itemText)) {
    return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
      ? `bondage training with ${itemName}`
      : `bondage protocol with ${itemName}`;
  }
  if (!semantics.isInsertableToy) {
    return null;
  }
  if (/\banal|anus\b/i.test(normalizedUserText)) {
    return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
      ? `anal training with ${itemName}`
      : `anal use with ${itemName}`;
  }
  if (/\boral|mouth|throat\b/i.test(normalizedUserText)) {
    return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
      ? `throat training with ${itemName}`
      : `oral use with ${itemName}`;
  }
  if (/\bprop\b/i.test(normalizedUserText)) {
    return `prop use with ${itemName}`;
  }
  if (/\btraining\b/i.test(normalizedUserText)) {
    return `anal training with ${itemName}`;
  }
  return null;
}

function deriveTextualInventoryTaskFocus(userText: string): string | null {
  const normalizedUserText = normalize(userText);
  if (/\b(chastity|cage|locked|lock)\b/i.test(normalizedUserText)) {
    return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
      ? "chastity training"
      : "chastity protocol";
  }
  if (/\b(bondage|cuffs?|rope|collar|leash|restraint|restrained)\b/i.test(normalizedUserText)) {
    return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
      ? "bondage training"
      : "bondage protocol";
  }
  const insertableLabel = /\bplug\b/i.test(normalizedUserText)
    ? "plug"
    : /\baneros|prostate massager\b/i.test(normalizedUserText)
      ? "prostate massager"
      : /\b(dildo|toy)\b/i.test(normalizedUserText)
        ? "dildo"
        : "";
  if (insertableLabel) {
    if (/\banal|anus\b/i.test(normalizedUserText)) {
      return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
        ? `anal training with ${insertableLabel}`
        : `anal use with ${insertableLabel}`;
    }
    if (/\boral|mouth|throat\b/i.test(normalizedUserText)) {
      return /\btraining|task|protocol|drill\b/i.test(normalizedUserText)
        ? `throat training with ${insertableLabel}`
        : `oral use with ${insertableLabel}`;
    }
    if (/\bprop\b/i.test(normalizedUserText)) {
      return `prop use with ${insertableLabel}`;
    }
    if (/\btraining\b/i.test(normalizedUserText)) {
      return `anal training with ${insertableLabel}`;
    }
  }
  if (/\b(vibe|vibrator|wand|magic wand|hitachi)\b/i.test(normalizedUserText)) {
    if (/\bexternal\b/i.test(normalizedUserText)) {
      return "external vibrator use";
    }
    if (/\bprop\b/i.test(normalizedUserText)) {
      return "prop use with vibrator";
    }
  }
  return null;
}

function isDynamicTaskFocus(focus: string | null): focus is string {
  if (!focus) {
    return false;
  }
  if (
    includesAny(focus, [
      /\b(anal|anus|throat|oral|mouth|gag|plug|dildo|prostate)\b/i,
      /\b(chastity|cage|locked|lock)\b/i,
      /\b(bondage|cuffs?|rope|collar|leash|restraint|restrained)\b/i,
    ])
  ) {
    return true;
  }
  if (
    includesAny(focus, [
      /\b(task|challenge|drill|assignment)\b/i,
      /\b(concrete|specific|available|inventory|item)\b/i,
      /\b(quick|short|simple|easy|hard|harder|strict|intense)\b/i,
      /\b(eye contact|eyes on me|look at me|look me in the eyes)\b/i,
      /\b(inspection|inspect|camera check|inspection frame|face forward|face centered|upper body visible)\b/i,
      /\b(kneel|kneeling|on your knees)\b/i,
      /\b(shoulders back|chin up|posture check|stand tall)\b/i,
      /\b(hands behind|hands back|behind your back)\b/i,
      /\b(silent|silence|quiet|quietly|no talking)\b/i,
      /\b(focus|steady|calm)\b/i,
    ])
  ) {
    return false;
  }
  return true;
}

function formatTaskFocusTitleLabel(focus: string): string {
  if (/\b(throat training|oral (?:use|control)|mouth training)\b/i.test(focus)) {
    return "Throat training";
  }
  if (/\banal (?:training|use)\b/i.test(focus)) {
    return "Anal training";
  }
  if (/\bchastity (?:training|protocol)\b/i.test(focus)) {
    return "Chastity protocol";
  }
  if (/\bbondage (?:training|protocol)\b/i.test(focus)) {
    return "Bondage protocol";
  }
  if (/\bprop use\b/i.test(focus)) {
    return "Prop control";
  }
  const cleaned = focus
    .split(/\s+/)
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return cleaned || "Task";
}

function buildDynamicTaskLanguage(input: {
  template: DeterministicTaskTemplate;
  userText: string;
  durationMinutes: number;
  selectedInventoryItem: SessionInventoryItem | null;
  schedule:
    | { type: "one_time" }
    | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean };
  repeatsRequired: number;
}): DynamicTaskLanguage | null {
  const focus =
    deriveInventoryTaskFocus(input.userText, input.selectedInventoryItem) ??
    deriveTextualInventoryTaskFocus(input.userText) ??
    extractRequestedTaskFocus(input.userText);
  if (!isDynamicTaskFocus(focus)) {
    return null;
  }
  const planned = planDynamicTaskLanguage({
    focus,
    durationMinutes: input.durationMinutes,
    selectedInventoryItem: input.selectedInventoryItem,
    templateId: input.template.id,
    schedule: input.schedule,
    repeatsRequired: input.repeatsRequired,
  });

  return {
    titleLabel: planned.titleLabel || formatTaskFocusTitleLabel(focus),
    description: planned.description,
    selectionReason: planned.selectionReason,
    variant: {
      description: planned.description,
      startInstruction: planned.startInstruction,
      assignedAction: planned.assignedAction,
      activeFollowUp: planned.activeFollowUp,
      completionText: planned.completionText,
    },
  };
}

function deriveTaskSelectionReason(
  template: DeterministicTaskTemplate,
  input: DeterministicTaskTemplateInput,
  selectedInventoryItem: SessionInventoryItem | null,
): string {
  const normalizedUserText = normalize(input.userText ?? "");
  const requestedFocus = extractRequestedTaskFocus(input.userText ?? "");
  const inventoryName = selectedInventoryItem
    ? getSessionInventoryDisplayName(selectedInventoryItem)
    : "";
  const preferredPace = normalize(input.profile?.preferred_pace ?? "");
  const preferredStyle = normalize(input.profile?.preferred_style ?? "");
  const intensity = normalize(input.profile?.intensity ?? "");
  const likes = normalize(input.profile?.likes ?? "");
  const lastCompletionSummary = normalize(input.progress?.last_completion_summary ?? "");

  if (input.hasStakes) {
    return "stakes are active, so Raven picked a higher-pressure task.";
  }
  if (isDynamicTaskFocus(requestedFocus)) {
    return selectedInventoryItem
      ? `it matches the specific task you asked for: ${requestedFocus}, and it uses your available ${inventoryName} this session.`
      : `it matches the specific task you asked for: ${requestedFocus}.`;
  }
  if (
    template.id === "silence_hold" &&
    input.allowSilenceHold &&
    includesAny(normalizedUserText, [/\b(silent|silence|quiet|quietly|no talking)\b/i])
  ) {
    return "you explicitly asked for silence while device control is active.";
  }
  if (
    (template.id === "inspection_check" &&
      includesAny(normalizedUserText, [
        /\b(inspection|inspect|camera check|inspection frame)\b/i,
      ])) ||
    (template.id === "eye_contact_check" &&
      includesAny(normalizedUserText, [
        /\b(eye contact|eyes on me|look at me|look me in the eyes)\b/i,
      ])) ||
    (template.id === "kneel_protocol" &&
      includesAny(normalizedUserText, [/\b(kneel|kneeling|on your knees)\b/i])) ||
    (template.id === "hands_protocol" &&
      includesAny(normalizedUserText, [/\b(hands behind|hands back|behind your back)\b/i])) ||
    (template.id === "shoulders_back_protocol" &&
      includesAny(normalizedUserText, [
        /\b(shoulders back|chin up|posture check|stand tall)\b/i,
      ])) ||
    (template.id === "steady_hold" && hasExplicitDeviceTaskIntent(normalizedUserText)) ||
    (template.id === "quick_check" &&
      includesAny(normalizedUserText, [/\b(quick|short|simple|easy)\b/i])) ||
    (template.id === "endurance_hold" &&
      includesAny(normalizedUserText, [
        /\b(overnight|all night|long|longer|extended|endurance)\b/i,
      ])) ||
    (template.id === "focus_hold" &&
      includesAny(normalizedUserText, [/\b(focus|steady|calm)\b/i])) ||
    (template.id === "discipline_hold" &&
      includesAny(normalizedUserText, [/\b(challenge|challenging|hard|harder|strict|intense)\b/i]))
  ) {
    return selectedInventoryItem
      ? `it matches the task you asked for directly and uses your available ${inventoryName} this session.`
      : "it matches the task you asked for directly.";
  }
  if (
    includesAny(preferredPace, [/\b(quick|fast|brisk|short)\b/i]) &&
    template.id === "quick_check"
  ) {
    return "your saved pace preference favors shorter, faster compliance.";
  }
  if (
    includesAny(preferredPace, [/\b(slow|steady|calm|measured)\b/i]) &&
    (template.id === "focus_hold" || template.id === "inspection_check")
  ) {
    return "your saved pace preference favors steadier control.";
  }
  if (
    includesAny(preferredStyle, [/\b(strict|firm|hard|discipline|commanding|dominant)\b/i]) &&
    (template.id === "discipline_hold" || template.id === "hands_protocol")
  ) {
    return "your saved style preference favors stricter control.";
  }
  if (
    includesAny(likes, [/\b(camera|inspection|focus|eye contact)\b/i]) &&
    (template.id === "inspection_check" || template.id === "eye_contact_check")
  ) {
    return "it matches the camera-focused patterns you respond to best.";
  }
  if (
    includesAny(likes, [/\b(chastity|device|lock|control|obedience)\b/i]) &&
    template.taskKind === "device_hold"
  ) {
    return selectedInventoryItem
      ? `it matches the device-control pattern already saved in memory and uses your available ${inventoryName}.`
      : "it matches the device-control pattern already saved in memory.";
  }
  if (
    includesAny(intensity, [/\b(high|hard|strict|intense)\b/i]) &&
    (template.id === "discipline_hold" || template.id === "endurance_hold")
  ) {
    return "your saved intensity points toward a tougher task.";
  }
  if (
    lastCompletionSummary &&
    includesAny(lastCompletionSummary, [new RegExp(template.title.replace(/\s+/g, "\\s+"), "i")])
  ) {
    return "you recently completed a similar task cleanly, so Raven is leaning into that pattern.";
  }
  if (selectedInventoryItem) {
    return `it is the default control task for the current scene and uses your available ${inventoryName}.`;
  }
  return "it is the default control task for the current scene.";
}

function summarizeRewardTemplate(
  rewardTemplateId: "approval_brief" | "approval_firm" | "approval_warm",
): string {
  if (rewardTemplateId === "approval_brief") {
    return "brief approval";
  }
  if (rewardTemplateId === "approval_warm") {
    return "warmer approval";
  }
  return "firm approval";
}

function buildAdaptiveTaskSummary(input: {
  template: DeterministicTaskTemplate;
  strictnessMode: TaskStrictnessMode;
  rewardTemplateId: "approval_brief" | "approval_firm" | "approval_warm";
  penaltyPoints: number;
  selectionReason: string;
}): DeterministicTaskPlan["adaptiveSummary"] {
  return {
    selection: input.selectionReason,
    policy: `strictness=${input.strictnessMode}, task_kind=${input.template.taskKind}`,
    reward: `${summarizeRewardTemplate(input.rewardTemplateId)} (${input.rewardTemplateId})`,
    consequence: `${input.penaltyPoints} penalty points on failure`,
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatDurationLabel(durationMinutes: number): string {
  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${durationMinutes} minutes`;
}

function formatDurationTitle(durationMinutes: number): string {
  if (durationMinutes % 60 === 0) {
    return `${durationMinutes / 60}h`;
  }
  return `${durationMinutes}m`;
}

function extractRequestedRepeatCount(text: string): number | null {
  const normalized = normalize(text);
  const numericMatch = normalized.match(/\b(\d+)\s*(times|repeats|occurrences)\b/);
  if (numericMatch?.[1]) {
    return Math.max(1, Math.min(365, Number(numericMatch[1])));
  }
  if (/\btwice\b/.test(normalized)) {
    return 2;
  }
  if (/\bthree times\b/.test(normalized)) {
    return 3;
  }
  return null;
}

function extractDailyPlan(text: string): { days: number; occurrencesPerDay: number } | null {
  const normalized = normalize(text);
  if (!/\b(daily|every day|each day|per day|a day)\b/.test(normalized)) {
    return null;
  }
  const daysMatch = normalized.match(/\bfor\s+(\d+)\s*days?\b/);
  const perDayMatch = normalized.match(/\b(\d+)\s*(times|repeats|occurrences)\s*(a|per)\s*day\b/);
  const days = daysMatch?.[1] ? Math.max(1, Math.min(365, Number(daysMatch[1]))) : 7;
  const occurrencesPerDay = perDayMatch?.[1]
    ? Math.max(1, Math.min(24, Number(perDayMatch[1])))
    : 1;
  return { days, occurrencesPerDay };
}

function deriveTaskDescription(
  template: DeterministicTaskTemplate,
  durationMinutes: number,
  userText: string,
  selectedInventoryItem: SessionInventoryItem | null,
  schedule:
    | { type: "one_time" }
    | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean },
  repeatsRequired: number,
): string {
  const durationLabel = formatDurationLabel(durationMinutes);
  const normalizedUserText = normalize(userText);
  const inventoryName = selectedInventoryItem
    ? getSessionInventoryDisplayName(selectedInventoryItem)
    : "";
  const base =
    template.taskKind === "device_hold"
      ? selectedInventoryItem
        ? /\b(chastity|cage|locked)\b/.test(normalizedUserText)
          ? `Keep your ${inventoryName} on for ${durationLabel}`
          : `Use your ${inventoryName} for ${durationLabel}`
        : /\b(chastity|cage|locked)\b/.test(normalizedUserText)
          ? `Keep the chastity device on for ${durationLabel}`
          : `Keep the device on for ${durationLabel}`
      : template.taskKind === "frame_hold"
        ? `Stay fully in frame for ${durationLabel}`
        : template.taskKind === "stillness_hold"
          ? `Hold still for ${durationLabel}`
          : `Hold a strict posture for ${durationLabel}`;
  const itemSuffix =
    selectedInventoryItem && template.taskKind !== "device_hold"
      ? ` while using your ${inventoryName}`
      : "";
  const baseWithItem = `${base}${itemSuffix}`;
  if (schedule.type === "daily") {
    const perDayLabel =
      schedule.occurrences_per_day === 1
        ? "once per day"
        : `${schedule.occurrences_per_day} times per day`;
    return `${baseWithItem}. Complete it ${perDayLabel} for ${schedule.days} day${schedule.days === 1 ? "" : "s"}, and report cleanly each time.`;
  }
  if (repeatsRequired > 1) {
    return `${baseWithItem}. Complete it ${repeatsRequired} times before the deadline and report cleanly each time.`;
  }
  return `${baseWithItem}, check in once halfway through, and report back when it is done.`;
}

function deriveTaskScheduleLine(
  schedule:
    | { type: "one_time" }
    | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean },
  repeatsRequired: number,
): string {
  if (schedule.type === "daily") {
    const perDayLabel =
      schedule.occurrences_per_day === 1
        ? "once per day"
        : `${schedule.occurrences_per_day} times per day`;
    return `You will do it ${perDayLabel} for ${schedule.days} day${schedule.days === 1 ? "" : "s"}.`;
  }
  if (repeatsRequired > 1) {
    return `You will repeat it ${repeatsRequired} times before the deadline.`;
  }
  return "";
}

function deriveTaskTitle(
  template: DeterministicTaskTemplate,
  durationMinutes: number,
  userText: string,
  selectedInventoryItem: SessionInventoryItem | null,
  schedule:
    | { type: "one_time" }
    | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean },
  repeatsRequired: number,
  programKind: "task" | "habit" | "challenge",
  customTitleLabel?: string,
): string {
  const normalizedUserText = normalize(userText);
  const category = customTitleLabel || deriveTaskLabel(template, normalizedUserText);
  const suffix = formatInventoryTitleSuffix(selectedInventoryItem);
  if (schedule.type === "daily") {
    if (programKind === "challenge") {
      return `${category} ${schedule.days}-day challenge${suffix}`;
    }
    return `${category} daily habit${suffix}`;
  }
  if (repeatsRequired > 1) {
    return `${category} ${repeatsRequired}x drill${suffix}`;
  }
  if (template.taskKind === "frame_hold") {
    return `${category} ${formatDurationTitle(durationMinutes)} check${suffix}`;
  }
  return `${category} ${formatDurationTitle(durationMinutes)} hold${suffix}`;
}

function looksLikeHalfwayCheckIn(text: string): boolean {
  return /\b(halfway|half way|check in|check-in|midpoint|half done)\b/i.test(text);
}

function looksLikeTaskCompletion(text: string): boolean {
  return /\b(all done|finished|complete|completed|2 hours done|two hours done|time is done|task is done|full time done|time elapsed|time is up|times? up|30 minutes are up|45 minutes are up|60 minutes are up|90 minutes are up|2 hours are up|3 hours are up|i did it already|did already|already done|full 30 minutes|full 45 minutes|full 60 minutes|full 90 minutes|full 2 hours|full 3 hours|kept .* for the full|wore it for the full|held it for the full|kept .* on the whole time|remained secure the entire time)\b/i.test(
    text,
  );
}

function looksLikeElapsedDuration(text: string, durationMinutes: number): boolean {
  if (!durationMinutes || durationMinutes <= 0) {
    return false;
  }
  if (
    /\b(i'?ll|i will|going to|gonna|after|before|until|halfway|half way|midpoint|what should i do after|what do i do after)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  const hourCount = durationMinutes / 60;
  const minutePatterns = [
    new RegExp(`\\b${durationMinutes}\\s*(?:minute|minutes|min)\\b`, "i"),
    new RegExp(`\\b${durationMinutes}[ -]?minute\\b`, "i"),
  ];
  const hourPatterns =
    Number.isInteger(hourCount) && hourCount >= 1
      ? [
          new RegExp(`\\b${hourCount}\\s*(?:hour|hours|hr|hrs)\\b`, "i"),
          new RegExp(`\\b${hourCount}[ -]?hour\\b`, "i"),
        ]
      : [];
  const mentionsConfiguredDuration = [...minutePatterns, ...hourPatterns].some((pattern) =>
    pattern.test(text),
  );
  if (!mentionsConfiguredDuration) {
    return false;
  }
  return /\b(up|elapsed|complete|completed|finished|done|full|whole time|entire time|mark|reached|made it|kept|wore|held|been)\b/i.test(
    text,
  );
}

function looksLikeInitialTaskSecure(text: string): boolean {
  const trimmed = text.trim();
  if (/^(done|secured?|locked|set|started|began|begun)$/i.test(trimmed)) {
    return true;
  }
  return /\b(secure|secured|securely on|securely fastened|securely in place|fastened|fastened in place|is secure|is secured|is locked|locked|in place|started it|started now|already on|already did|i did already|it is on|its on|it is secure|it's secure|it is locked|it's locked|put(?:ting)? it on|put it on|locked it on|have it on|wearing it now|i am wearing it|i'm wearing it|i've put .* on)\b/i.test(
    text,
  );
}

function looksLikeAssignedTaskCompletion(text: string, durationMinutes: number): boolean {
  if (/\b(i'?ll|i will|going to|gonna|plan to)\b/i.test(text)) {
    return false;
  }
  if (looksLikeElapsedDuration(text, durationMinutes)) {
    return true;
  }
  return /\b(time is up|times up|task is complete|task is completed|completed it|finished it|finished the task|kept it on the whole time|kept it secure the whole time|kept it on for\b|kept it secure for\b|wore it for\b|held it for\b|full \d+\s*(minute|minutes|hour|hours)\b)\b/i.test(
    text,
  );
}

function includesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasExplicitDeviceTaskIntent(text: string): boolean {
  return includesAny(text, [/\b(chastity|cage|locked|lock)\b/i, /\bdevice\b/i]);
}

function preferredTemplateFromProfile(
  profile: ProfileState | undefined,
  progress: DeterministicTaskTemplateInput["progress"],
  allowSilenceHold = false,
): DeterministicTaskTemplate | null {
  const preferredPace = normalize(profile?.preferred_pace ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  const intensity = normalize(profile?.intensity ?? "");
  const likes = normalize(profile?.likes ?? "");
  const memorySummary = normalize(profile?.memory_summary ?? "");
  const lastCompletionSummary = normalize(progress?.last_completion_summary ?? "");
  const combined = [preferredStyle, intensity, likes, memorySummary].filter(Boolean).join(" ");

  if (includesAny(preferredPace, [/\b(quick|fast|short)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.quick_check;
  }
  if (includesAny(preferredPace, [/\b(slow|steady|calm|measured)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (includesAny(combined, [/\b(eye contact|eyes on me|look at me|gaze)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.eye_contact_check;
  }
  if (includesAny(combined, [/\b(silent|silence|quiet)\b/i])) {
    return allowSilenceHold
      ? DETERMINISTIC_TASK_TEMPLATES.silence_hold
      : DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (includesAny(combined, [/\b(inspection|inspect|camera)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.inspection_check;
  }
  if (
    includesAny(combined, [
      /\b(chastity|device|locked|lock)\b/i,
      /\b(control|obedience|discipline)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.steady_hold;
  }
  if (includesAny(combined, [/\b(posture|hands behind|strict|intense|hard)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.discipline_hold;
  }
  if (includesAny(combined, [/\b(kneel|kneeling|on your knees)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.kneel_protocol;
  }
  if (includesAny(combined, [/\b(shoulders back|chin up|stand tall)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.shoulders_back_protocol;
  }
  if (includesAny(combined, [/\b(frame|camera|face forward|focus|stillness)\b/i])) {
    return DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (lastCompletionSummary.includes("endurance hold task")) {
    return DETERMINISTIC_TASK_TEMPLATES.endurance_hold;
  }
  if (lastCompletionSummary.includes("stakes hold task")) {
    return DETERMINISTIC_TASK_TEMPLATES.stakes_hold;
  }
  if (lastCompletionSummary.includes("discipline hold task")) {
    return DETERMINISTIC_TASK_TEMPLATES.discipline_hold;
  }
  if (lastCompletionSummary.includes("hands-back")) {
    return DETERMINISTIC_TASK_TEMPLATES.hands_protocol;
  }
  if (lastCompletionSummary.includes("kneeling")) {
    return DETERMINISTIC_TASK_TEMPLATES.kneel_protocol;
  }
  if (lastCompletionSummary.includes("shoulders-back")) {
    return DETERMINISTIC_TASK_TEMPLATES.shoulders_back_protocol;
  }
  if (lastCompletionSummary.includes("eye contact")) {
    return DETERMINISTIC_TASK_TEMPLATES.eye_contact_check;
  }
  if (lastCompletionSummary.includes("silence")) {
    return allowSilenceHold
      ? DETERMINISTIC_TASK_TEMPLATES.silence_hold
      : DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (lastCompletionSummary.includes("inspection")) {
    return DETERMINISTIC_TASK_TEMPLATES.inspection_check;
  }
  if (lastCompletionSummary.includes("focus hold task")) {
    return DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (lastCompletionSummary.includes("quick check task")) {
    return DETERMINISTIC_TASK_TEMPLATES.quick_check;
  }
  if (lastCompletionSummary.includes("session hold task")) {
    return DETERMINISTIC_TASK_TEMPLATES.steady_hold;
  }
  return null;
}

export function deriveLearnedTaskStrictness(
  profile: ProfileState | undefined,
  progress?: DeterministicTaskTemplateInput["progress"],
): TaskStrictnessMode {
  const intensity = normalize(profile?.intensity ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  if (includesAny(intensity, [/\b(hard|high|strict|intense)\b/i])) {
    return "hard";
  }
  if (includesAny(intensity, [/\b(low|light|gentle|soft)\b/i])) {
    return "soft";
  }
  if (includesAny(preferredStyle, [/\b(strict|firm|hard|discipline)\b/i])) {
    return "hard";
  }
  if (includesAny(preferredStyle, [/\b(slow|steady|warm|gentle)\b/i])) {
    return "soft";
  }
  if (progress?.current_tier === "gold" || progress?.current_tier === "platinum") {
    return "hard";
  }
  return "standard";
}

export function deriveLearnedRewardTemplate(
  profile: ProfileState | undefined,
  progress?: DeterministicTaskTemplateInput["progress"],
): "approval_brief" | "approval_firm" | "approval_warm" {
  const intensity = normalize(profile?.intensity ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");

  if (includesAny(intensity, [/\b(low|light|gentle|soft)\b/i])) {
    return "approval_warm";
  }
  if (includesAny(preferredStyle, [/\b(warm|gentle|soft|supportive)\b/i])) {
    return "approval_warm";
  }
  if (
    includesAny(intensity, [/\b(hard|high|strict|intense)\b/i]) ||
    progress?.current_tier === "gold" ||
    progress?.current_tier === "platinum"
  ) {
    return "approval_brief";
  }
  return "approval_firm";
}

export function deriveLearnedPenaltyPoints(
  profile: ProfileState | undefined,
  progress?: DeterministicTaskTemplateInput["progress"],
): number {
  const intensity = normalize(profile?.intensity ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");

  if (
    includesAny(intensity, [/\b(hard|high|strict|intense)\b/i]) ||
    includesAny(preferredStyle, [/\b(strict|hard|punitive|discipline)\b/i]) ||
    progress?.current_tier === "gold" ||
    progress?.current_tier === "platinum"
  ) {
    return 8;
  }
  if (
    includesAny(intensity, [/\b(low|light|gentle|soft)\b/i]) ||
    includesAny(preferredStyle, [/\b(warm|gentle|soft)\b/i]) ||
    (progress?.free_pass_count ?? 0) > 0
  ) {
    return 3;
  }
  return 5;
}

export function deriveLearnedConsequenceLeadIn(
  profile: ProfileState | undefined,
  progress?: DeterministicTaskTemplateInput["progress"],
): string {
  const intensity = normalize(profile?.intensity ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  const preferredPace = normalize(profile?.preferred_pace ?? "");

  if (
    includesAny(intensity, [/\b(hard|high|strict|intense)\b/i]) ||
    includesAny(preferredStyle, [/\b(strict|firm|hard|punitive|discipline)\b/i]) ||
    progress?.current_tier === "gold" ||
    progress?.current_tier === "platinum"
  ) {
    return "No protection covers you now. This task is enforced. You will do it properly, pet.";
  }
  if (
    includesAny(intensity, [/\b(low|light|gentle|soft)\b/i]) ||
    includesAny(preferredStyle, [/\b(warm|gentle|soft|steady)\b/i]) ||
    includesAny(preferredPace, [/\b(slow|steady|calm|measured)\b/i]) ||
    (progress?.free_pass_count ?? 0) > 0
  ) {
    return "No protection covers you now. This task stands. Follow through cleanly, pet.";
  }
  return "No protection covers you now. This task is enforced.";
}

export function selectDeterministicTaskTemplate(
  input: DeterministicTaskTemplateInput = {},
): DeterministicTaskTemplate {
  const normalizedUserText = normalize(input.userText ?? "");
  const allowSilenceHold = input.allowSilenceHold === true;
  const requestedFocus = extractRequestedTaskFocus(normalizedUserText);
  const explicitInventoryItem = findInventoryItemForTask(
    input.inventory ?? [],
    normalizedUserText,
    "device_hold",
  );
  const learnedPreference = preferredTemplateFromProfile(
    input.profile,
    input.progress,
    allowSilenceHold,
  );

  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(overnight|all night)\b/i,
      /\b(long|longer|extended|endurance)\b/i,
      /\b(4 hours|four hours)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.endurance_hold;
  }
  if (input.hasStakes && !isDynamicTaskFocus(requestedFocus)) {
    return DETERMINISTIC_TASK_TEMPLATES.stakes_hold;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(eye contact|eyes on me|look at me|look me in the eyes)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.eye_contact_check;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(inspection|inspect|camera check|inspection frame)\b/i,
      /\b(face forward|face centered|upper body visible)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.inspection_check;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [/\b(kneel|kneeling|on your knees)\b/i])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.kneel_protocol;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [/\b(shoulders back|chin up|posture check|stand tall)\b/i])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.shoulders_back_protocol;
  }
  if (normalizedUserText && hasExplicitDeviceTaskIntent(normalizedUserText)) {
    return DETERMINISTIC_TASK_TEMPLATES.steady_hold;
  }
  if (isDynamicTaskFocus(requestedFocus)) {
    if (explicitInventoryItem || hasExplicitDeviceTaskIntent(normalizedUserText)) {
      return DETERMINISTIC_TASK_TEMPLATES.steady_hold;
    }
    if (includesAny(requestedFocus, [/\b(look|eye|inspection|camera|frame|visible)\b/i])) {
      return DETERMINISTIC_TASK_TEMPLATES.inspection_check;
    }
    return DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(quick|short|simple|easy)\b/i,
      /\b(30 minutes|thirty minutes)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.quick_check;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [/\b(silent|silence|quiet|quietly|no talking)\b/i])
  ) {
    return allowSilenceHold
      ? DETERMINISTIC_TASK_TEMPLATES.silence_hold
      : DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(focus|steady|calm)\b/i,
      /\b(1 hour|one hour|60 minutes)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.focus_hold;
  }
  if (input.hasTaskTerms || input.sceneType === "challenge") {
    return DETERMINISTIC_TASK_TEMPLATES.discipline_hold;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(hands behind|hands back|behind your back)\b/i,
      /\b(protocol)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.hands_protocol;
  }
  if (
    normalizedUserText &&
    includesAny(normalizedUserText, [
      /\b(challenge|challenging|hard|harder|strict|intense)\b/i,
      /\b(90 minutes|ninety minutes)\b/i,
    ])
  ) {
    return DETERMINISTIC_TASK_TEMPLATES.discipline_hold;
  }
  if (input.sceneType === "game") {
    return DETERMINISTIC_TASK_TEMPLATES.quick_check;
  }
  if (learnedPreference) {
    return learnedPreference;
  }
  return DETERMINISTIC_TASK_TEMPLATES.steady_hold;
}

export function findDeterministicTaskTemplateByDuration(
  durationMinutes: number,
): DeterministicTaskTemplate {
  const match = Object.values(DETERMINISTIC_TASK_TEMPLATES).find(
    (template) => template.durationMinutes === durationMinutes,
  );
  return match ?? DETERMINISTIC_TASK_TEMPLATES.steady_hold;
}

function resolveTaskTemplate(
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
): DeterministicTaskTemplate {
  return findDeterministicTaskTemplateByDuration(durationMinutes);
}

function resolveTaskTemplateFromContext(
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
  templateId?: DeterministicTaskTemplateId,
): DeterministicTaskTemplate {
  if (templateId) {
    return resolveDeterministicTaskTemplateById(templateId);
  }
  return resolveTaskTemplate(durationMinutes);
}

export function resolveDeterministicTaskTemplateById(
  templateId: DeterministicTaskTemplateId,
): DeterministicTaskTemplate {
  return DETERMINISTIC_TASK_TEMPLATES[templateId] ?? DETERMINISTIC_TASK_TEMPLATES.steady_hold;
}

export function pickNextDeterministicTaskVariantIndex(
  templateId: DeterministicTaskTemplateId,
): number {
  const template = resolveDeterministicTaskTemplateById(templateId);
  const current = TASK_VARIANT_CURSOR[templateId] ?? 0;
  const next = current % template.variants.length;
  TASK_VARIANT_CURSOR[templateId] = (current + 1) % template.variants.length;
  return next;
}

export function resolveDeterministicTaskVariant(
  template: DeterministicTaskTemplate,
  variantIndex = 0,
): DeterministicTaskVariant {
  const safeIndex =
    ((variantIndex % template.variants.length) + template.variants.length) %
    template.variants.length;
  return template.variants[safeIndex] ?? template.variants[0];
}

export function extractTaskDurationMinutes(text: string): number | null {
  const normalized = normalize(text);
  const hoursMatch = normalized.match(/\b(\d+)\s*hours?\b/);
  if (hoursMatch?.[1]) {
    return Number(hoursMatch[1]) * 60;
  }
  const minutesMatch = normalized.match(/\b(\d+)\s*minutes?\b/);
  if (minutesMatch?.[1]) {
    return Number(minutesMatch[1]);
  }
  return null;
}

export function buildDeterministicTaskAssignment(options: TaskScriptOptions = {}): string {
  const template = options.template ?? DETERMINISTIC_TASK_TEMPLATES.steady_hold;
  const variant = {
    ...resolveDeterministicTaskVariant(template, options.variantIndex),
    ...(options.customVariant ?? {}),
  };
  return [
    "Listen carefully, pet.",
    options.leadInLine ?? "",
    `Here is your task: ${options.customDescription ?? variant.description}`,
    options.scheduleLine ?? "",
    options.rewardLine ?? "",
    options.consequenceLine ?? "",
    options.stakesLine ?? "",
    variant.startInstruction,
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

export function isTaskAssignmentText(text: string): boolean {
  return /\bhere is your task\b|\byour task\b|\breport back\b|\bcheck in\b|\bput your\b.+\bon now\b|\bshow me it is secure\b/i.test(
    text,
  );
}

export function isFinalTaskAssignmentText(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  const directInventoryDirective =
    /\bput your\b.+\bon now\b/.test(normalized) &&
    /\b(show me it is secure|get in frame|hold your wrists in frame|return to frame and show me it is in place)\b/.test(
      normalized,
    );
  if (directInventoryDirective) {
    return true;
  }
  if (!/\bhere is your task\b/.test(normalized)) {
    return false;
  }
  if (
    /\b(next step|current checkpoint|stay on this thread|continue cleanly|current task|follow the current checkpoint)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    !/\b(start now|reply done|report back|check in|show me|set your|put it on|put your|hold still|face forward|hands behind|kneel|shoulders back)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(\d+\s*(hour|hours|minute|minutes)|halfway|final proof|report back|check in)\b/.test(
    normalized,
  );
}

export function detectDeterministicTaskTemplateIdFromAssignmentText(
  text: string,
  fallbackTemplateId: DeterministicTaskTemplateId,
): DeterministicTaskTemplateId {
  const normalized = normalize(text);
  if (!normalized) {
    return fallbackTemplateId;
  }
  if (
    /\b(anal|oral)\b/.test(normalized) &&
    /\b(dildo|plug|toy|silicone)\b/.test(normalized)
  ) {
    if (/\b(quiet|silence|silent|mouth shut)\b/.test(normalized)) {
      return "silence_hold";
    }
    if (/\b(stakes|sharper|exacting|exact)\b/.test(normalized)) {
      return "stakes_hold";
    }
    return "steady_hold";
  }
  if (/\b(hands behind|hands back|behind your back|hands drill|hands protocol)\b/.test(normalized)) {
    return "hands_protocol";
  }
  if (/\b(kneel|kneeling|on your knees|kneeling drill|kneeling protocol)\b/.test(normalized)) {
    return "kneel_protocol";
  }
  if (/\b(shoulders back|chin up|shoulders drill|shoulders protocol)\b/.test(normalized)) {
    return "shoulders_back_protocol";
  }
  if (/\b(strict posture|upright posture|set your posture|hold a strict posture|posture drill|posture protocol)\b/.test(normalized)) {
    return "discipline_hold";
  }
  if (/\b(eye contact|eyes on me|look at me|look me in the eyes)\b/.test(normalized)) {
    return "eye_contact_check";
  }
  if (/\b(inspection|face forward|in frame|upper body visible|centered)\b/.test(normalized)) {
    return "inspection_check";
  }
  if (/\b(quiet|silence|silent|no talking)\b/.test(normalized)) {
    return /\b(put it on|device|lock it|locked)\b/.test(normalized)
      ? "silence_hold"
      : "focus_hold";
  }
  if (/\b(hold still|stay steady|stillness|focus hold|stay still)\b/.test(normalized)) {
    return "focus_hold";
  }
  if (/\b(4 hours|four hours|endurance)\b/.test(normalized)) {
    return "endurance_hold";
  }
  if (/\b(stakes|under the agreed stakes)\b/.test(normalized)) {
    return "stakes_hold";
  }
  if (/\b(put it on now|lock it in place|keep the device on|device locked|wear it)\b/.test(normalized)) {
    return "steady_hold";
  }
  return fallbackTemplateId;
}

export function isTaskCompletionConfirmationText(text: string): boolean {
  return /\b(task is complete|you completed the task cleanly|task complete)\b/i.test(text);
}

export function buildDeterministicTaskCreatePayload(
  template: DeterministicTaskTemplate,
  variantIndex = 0,
  options: {
    strictnessMode?: TaskStrictnessMode;
    rewardTemplateId?: "approval_brief" | "approval_firm" | "approval_warm";
    penaltyPoints?: number;
    durationMinutes?: number;
    repeatsRequired?: number;
    schedule?:
      | { type: "one_time" }
      | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean };
    programKind?: "task" | "rule" | "habit" | "challenge";
    title?: string;
    description?: string;
  } = {},
): DeterministicTaskCreatePayload {
  const variant = resolveDeterministicTaskVariant(template, variantIndex);
  const durationMinutes = options.durationMinutes ?? template.durationMinutes;
  const repeatsRequired = options.repeatsRequired ?? 1;
  const schedule = options.schedule ?? { type: "one_time" };
  const programKind = options.programKind ?? "task";
  const type =
    programKind === "habit"
      ? "create_habit"
      : programKind === "challenge"
        ? "create_challenge"
        : programKind === "rule"
          ? "create_rule"
          : "create_task";
  return {
    type,
    title: options.title ?? template.title,
    description: options.description ?? variant.description,
    window_seconds: durationMinutes * 60,
    repeats_required: repeatsRequired,
    points_possible: template.pointsPossible,
    schedule,
    evidence: {
      required: true,
      type: "manual",
      checks: [],
      max_attempts: 4,
      deny_user_override: false,
    },
    strictness_mode: options.strictnessMode ?? "standard",
    program_kind: programKind,
    reward_plan: {
      catalog_id: "reward_positive_message",
      params: { template_id: options.rewardTemplateId ?? "approval_firm" },
    },
    consequence_plan: {
      catalog_id: "penalty_points",
      params: { penalty_points: options.penaltyPoints ?? 5 },
    },
  };
}

export function buildDeterministicTaskPlanFromRequest(input: {
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
  templateId?: DeterministicTaskTemplateId;
  variantIndex?: number;
  strictnessMode?: TaskStrictnessMode;
  rewardTemplateId?: "approval_brief" | "approval_firm" | "approval_warm";
  penaltyPoints?: number;
  rewardLine?: string;
  consequenceLine?: string;
  stakesLine?: string;
  leadInLine?: string;
}): DeterministicTaskPlan {
  const template = input.templateId
    ? resolveDeterministicTaskTemplateById(input.templateId)
    : selectDeterministicTaskTemplate({
        sceneType: input.sceneType,
        hasStakes: input.hasStakes,
        hasTaskTerms: input.hasTaskTerms,
        userText: input.userText,
        allowSilenceHold: input.allowSilenceHold,
        profile: input.profile,
        inventory: input.inventory,
        progress: input.progress,
      });
  const resolvedStrictnessMode =
    input.strictnessMode ?? deriveLearnedTaskStrictness(input.profile, input.progress);
  const resolvedRewardTemplateId =
    input.rewardTemplateId ?? deriveLearnedRewardTemplate(input.profile, input.progress);
  const resolvedPenaltyPoints =
    input.penaltyPoints ?? deriveLearnedPenaltyPoints(input.profile, input.progress);
  const variantIndex = input.variantIndex ?? 0;
  const durationMinutes = extractTaskDurationMinutes(input.userText) ?? template.durationMinutes;
  const selectedInventoryItem = findInventoryItemForTask(
    input.inventory ?? [],
    input.userText,
    template.taskKind,
  );
  const requiresInventoryClarification = needsInventoryClarification(
    selectedInventoryItem,
    input.userText,
  );
  const inventoryClarificationQuestion =
    selectedInventoryItem && requiresInventoryClarification
      ? buildInventoryClarificationQuestion(selectedInventoryItem)
      : null;
  const dailyPlan = extractDailyPlan(input.userText);
  const repeatCount = extractRequestedRepeatCount(input.userText);
  const schedule = dailyPlan
    ? {
        type: "daily" as const,
        days: dailyPlan.days,
        occurrences_per_day: dailyPlan.occurrencesPerDay,
        allow_make_up: false,
      }
    : { type: "one_time" as const };
  const repeatsRequired = dailyPlan
    ? dailyPlan.days * dailyPlan.occurrencesPerDay
    : (repeatCount ?? 1);
  const normalizedText = normalize(input.userText);
  const programKind =
    schedule.type === "daily"
      ? /\b(challenge|program|streak)\b/.test(normalizedText) || schedule.days > 1
        ? "challenge"
        : "habit"
      : "task";
  const dynamicTaskLanguage = buildDynamicTaskLanguage({
    template,
    userText: input.userText,
    durationMinutes,
    selectedInventoryItem,
    schedule,
    repeatsRequired,
  });
  const description = deriveTaskDescription(
    template,
    durationMinutes,
    input.userText,
    selectedInventoryItem,
    schedule,
    repeatsRequired,
  );
  const scheduleLine = deriveTaskScheduleLine(schedule, repeatsRequired);
  const title = deriveTaskTitle(
    template,
    durationMinutes,
    input.userText,
    selectedInventoryItem,
    schedule,
    repeatsRequired,
    programKind,
    dynamicTaskLanguage?.titleLabel,
  );
  const selectionReason = deriveTaskSelectionReason(
    template,
    {
      sceneType: input.sceneType,
      hasStakes: input.hasStakes,
      hasTaskTerms: input.hasTaskTerms,
      userText: input.userText,
      allowSilenceHold: input.allowSilenceHold,
      profile: input.profile,
      inventory: input.inventory,
      progress: input.progress,
    },
    selectedInventoryItem,
  );
  const adaptiveSummary = buildAdaptiveTaskSummary({
    template,
    strictnessMode: resolvedStrictnessMode,
    rewardTemplateId: resolvedRewardTemplateId,
    penaltyPoints: resolvedPenaltyPoints,
    selectionReason: dynamicTaskLanguage?.selectionReason ?? selectionReason,
  });
  const assignmentText = buildDeterministicTaskAssignment({
    template,
    variantIndex,
    customDescription: dynamicTaskLanguage?.description ?? description,
    customVariant: dynamicTaskLanguage?.variant,
    scheduleLine,
    leadInLine: input.leadInLine,
    rewardLine: input.rewardLine,
    consequenceLine: input.consequenceLine,
    stakesLine: input.stakesLine,
  });
  return {
    template,
    variantIndex,
    durationMinutes,
    repeatsRequired,
    schedule,
    programKind,
    description: dynamicTaskLanguage?.description ?? description,
    scheduleLine,
    assignmentText,
    adaptiveSummary,
    selectedInventoryItem,
    needsInventoryClarification: requiresInventoryClarification,
    inventoryClarificationQuestion,
    createPayload: buildDeterministicTaskCreatePayload(template, variantIndex, {
      strictnessMode: resolvedStrictnessMode,
      rewardTemplateId: resolvedRewardTemplateId,
      penaltyPoints: resolvedPenaltyPoints,
      durationMinutes,
      repeatsRequired,
      schedule,
      programKind,
      title,
      description: dynamicTaskLanguage?.description ?? description,
    }),
  };
}

export function buildDeterministicTaskDurationReply(
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
  templateId?: DeterministicTaskTemplateId,
): string {
  const template = resolveTaskTemplateFromContext(durationMinutes, templateId);
  if (template.taskKind === "device_hold") {
    return `You will wear it for ${formatDurationLabel(durationMinutes)}.`;
  }
  return `This task runs for ${formatDurationLabel(durationMinutes)}.`;
}

export function deriveTaskProgressFromUserText(
  current: DeterministicTaskProgress,
  text: string,
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
): DeterministicTaskProgress {
  const normalized = normalize(text);
  if (!normalized) {
    return current;
  }
  if (current === "assigned" && looksLikeAssignedTaskCompletion(normalized, durationMinutes)) {
    return "completed";
  }
  if (current === "assigned" && looksLikeInitialTaskSecure(normalized)) {
    return "secured";
  }
  if (
    (current === "secured" || current === "halfway_checked") &&
    looksLikeHalfwayCheckIn(normalized)
  ) {
    return "halfway_checked";
  }
  if (
    (current === "secured" || current === "halfway_checked") &&
    looksLikeTaskCompletion(normalized)
  ) {
    return "completed";
  }
  if (
    (current === "secured" || current === "halfway_checked") &&
    looksLikeElapsedDuration(normalized, durationMinutes)
  ) {
    return "completed";
  }
  return current;
}

export function buildTaskExecutionRule(
  progress: DeterministicTaskProgress,
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
  variantIndex = 0,
  templateId?: DeterministicTaskTemplateId,
): string {
  const durationLabel = formatDurationLabel(durationMinutes);
  const template = resolveTaskTemplateFromContext(durationMinutes, templateId);
  const variant = resolveDeterministicTaskVariant(template, variantIndex);
  if (progress === "assigned") {
    return `wait for the user to ${variant.assignedAction} before changing topics`;
  }
  if (progress === "secured") {
    return `${variant.activeFollowUp.toLowerCase()} Wait for the halfway check in.`;
  }
  if (progress === "halfway_checked") {
    return `${variant.activeFollowUp.toLowerCase()} Hold it until the full ${durationLabel} has elapsed.`;
  }
  if (progress === "completed") {
    return "confirm the task completion before changing topics";
  }
  return "";
}

export function buildTaskExecutionExpectedAction(
  progress: DeterministicTaskProgress,
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
  variantIndex = 0,
  templateId?: DeterministicTaskTemplateId,
): string {
  const durationLabel = formatDurationLabel(durationMinutes);
  const template = resolveTaskTemplateFromContext(durationMinutes, templateId);
  const variant = resolveDeterministicTaskVariant(template, variantIndex);
  if (progress === "assigned") {
    return variant.assignedAction;
  }
  if (progress === "secured") {
    return `check in once halfway through or report back when the full ${durationLabel} has elapsed`;
  }
  if (progress === "halfway_checked") {
    return `report back when the full ${durationLabel} has elapsed`;
  }
  if (progress === "completed") {
    return "wait for Raven to confirm the completed task";
  }
  return "follow the current task";
}

export function buildDeterministicTaskFollowUp(
  progress: DeterministicTaskProgress,
  durationMinutes = DEFAULT_TASK_DURATION_MINUTES,
  variantIndex = 0,
  templateId?: DeterministicTaskTemplateId,
): string {
  const durationLabel = formatDurationLabel(durationMinutes);
  const template = resolveTaskTemplateFromContext(durationMinutes, templateId);
  const variant = resolveDeterministicTaskVariant(template, variantIndex);
  if (progress === "completed") {
    return variantIndex % 2 === 0
      ? `${variant.completionText} Ask for a new task when you want the next one.`
      : `Good. Completion stands, pet. ${variant.completionText} Ask for another task when you want the next one.`;
  }
  if (progress === "halfway_checked") {
    return variantIndex % 2 === 0
      ? `Good. Halfway check in accepted, pet. ${variant.activeFollowUp} Finish the full ${durationLabel}. Report back when the full time has elapsed.`
      : `Good. Halfway check in accepted, pet. ${variant.activeFollowUp} Finish the full ${durationLabel}. Hold that control, then report back cleanly.`;
  }
  if (progress === "secured") {
    return variantIndex % 2 === 0
      ? `Good. Next, ${variant.activeFollowUp.toLowerCase()} Check in once halfway through, then report back when the full ${durationLabel} has elapsed.`
      : `Good. The task is set. ${variant.activeFollowUp} Check in once halfway through, then report back when the full ${durationLabel} has elapsed.`;
  }
  return `Good. Next on the task: ${variant.startInstruction}`;
}
