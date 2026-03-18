import type { ProfileProgressRow } from "@/lib/db";
import type { ProfileState } from "@/lib/profile";
import {
  getSessionInventoryDisplayName,
  type SessionInventoryItem,
} from "./session-inventory.ts";

type SharedSchedule =
  | { type: "one_time" }
  | { type: "daily"; days: number; occurrences_per_day: number; allow_make_up: boolean };

export type PlannedTaskLanguage = {
  titleLabel: string;
  description: string;
  selectionReason: string;
  startInstruction: string;
  assignedAction: string;
  activeFollowUp: string;
  completionText: string;
};

export type PlannedWagerTerms = {
  stakes: string;
  winCondition: string;
  loseCondition: string;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashString(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickBySeed<T>(items: readonly T[], seed: number): T {
  return items[Math.abs(seed) % items.length] ?? items[0];
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFocusTitleLabel(focus: string, templateId?: string): string {
  if (/\b(throat training|oral (?:use|control)|mouth training)\b/i.test(focus)) {
    if (templateId === "silence_hold") {
      return "Throat control";
    }
    if (templateId === "stakes_hold" || templateId === "endurance_hold") {
      return "Throat intervals";
    }
    return "Throat training";
  }
  if (/\banal (?:training|use)\b/i.test(focus)) {
    if (templateId === "silence_hold") {
      return "Anal hold";
    }
    if (templateId === "stakes_hold" || templateId === "endurance_hold") {
      return "Anal intervals";
    }
    return "Anal training";
  }
  if (/\bchastity (?:training|protocol)\b/i.test(focus)) {
    if (templateId === "silence_hold") {
      return "Chastity silence";
    }
    if (templateId === "stakes_hold" || templateId === "endurance_hold") {
      return "Chastity stakes";
    }
    return "Chastity protocol";
  }
  if (/\bbondage (?:training|protocol)\b/i.test(focus)) {
    if (templateId === "silence_hold") {
      return "Bondage silence";
    }
    if (templateId === "stakes_hold" || templateId === "endurance_hold") {
      return "Bondage discipline";
    }
    return "Bondage drill";
  }
  if (/\bprop use\b/i.test(focus)) {
    return "Prop control";
  }
  return titleCase(focus) || "Task";
}

function formatDurationLabel(durationMinutes: number): string {
  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${durationMinutes} minutes`;
}

function formatScheduleTail(schedule: SharedSchedule, repeatsRequired: number): string {
  if (schedule.type === "daily") {
    const perDay =
      schedule.occurrences_per_day === 1
        ? "once per day"
        : `${schedule.occurrences_per_day} times per day`;
    return `Complete it ${perDay} for ${schedule.days} day${schedule.days === 1 ? "" : "s"}, and report cleanly each time.`;
  }
  if (repeatsRequired > 1) {
    return `Complete it ${repeatsRequired} times before the deadline and report cleanly each time.`;
  }
  return "Check in once halfway through, and report back when it is done.";
}

function deriveInsertableToolLabel(
  focus: string,
  explicitItemName: string,
): string {
  if (explicitItemName.trim().length > 0) {
    return explicitItemName.trim();
  }
  if (/\bplug\b/i.test(focus)) {
    return "plug";
  }
  if (/\baneros|prostate massager\b/i.test(focus)) {
    return "prostate massager";
  }
  if (/\b(dildo|toy)\b/i.test(focus)) {
    return "dildo";
  }
  return "toy";
}

function buildInsertableAnalLanguage(input: {
  templateId?: string;
  toolLabel: string;
  durationLabel: string;
  scheduleTail: string;
}): Pick<
  PlannedTaskLanguage,
  "description" | "startInstruction" | "assignedAction" | "activeFollowUp" | "completionText"
> {
  const baseTail = input.scheduleTail;
  if (input.templateId === "silence_hold") {
    return {
      description: `Keep your ${input.toolLabel} in a controlled anal hold for ${input.durationLabel} while you stay quiet and deliberate. ${baseTail}`.trim(),
      startInstruction: `Start now. Get your ${input.toolLabel} ready for anal use, settle it into place, go quiet, and reply done once you are set, pet.`,
      assignedAction: `settle your ${input.toolLabel} for anal use, go quiet, and reply done`,
      activeFollowUp: `Keep your ${input.toolLabel} steady, your body quiet, and the anal hold controlled, pet.`,
      completionText: `Good pet. You kept the anal hold and the silence clean, then reported properly. The task is complete.`,
    };
  }
  if (input.templateId === "stakes_hold" || input.templateId === "endurance_hold") {
    return {
      description: `Run stricter anal intervals with your ${input.toolLabel} for ${input.durationLabel}: settle it, hold the pressure, ease off, reset, and repeat without rushing. ${baseTail}`.trim(),
      startInstruction: `Start now. Get your ${input.toolLabel} ready for anal use, set the stricter pace, and reply done once you are under control, pet.`,
      assignedAction: `set your ${input.toolLabel} for the stricter anal drill and reply done`,
      activeFollowUp: `Keep the anal pace exact with your ${input.toolLabel}, pet. No sloppy shortcuts.`,
      completionText: `Good pet. You carried that sharper anal drill cleanly and reported on time. The task is complete.`,
    };
  }
  return {
    description: `Work with your ${input.toolLabel} in slow controlled anal rounds for ${input.durationLabel}. Keep the pace deliberate, pause between rounds, and stay under control. ${baseTail}`.trim(),
    startInstruction: `Start now. Get your ${input.toolLabel} ready for anal use, settle into the first controlled round, and reply done once you are set, pet.`,
    assignedAction: `get your ${input.toolLabel} ready for anal use and reply done`,
    activeFollowUp: `Keep the anal pace slow, controlled, and deliberate with your ${input.toolLabel}, pet.`,
    completionText: `Good pet. You kept the anal drill controlled and reported properly. The task is complete.`,
  };
}

function buildInsertableOralLanguage(input: {
  templateId?: string;
  focus: string;
  toolLabel: string;
  durationLabel: string;
  scheduleTail: string;
}): Pick<
  PlannedTaskLanguage,
  "description" | "startInstruction" | "assignedAction" | "activeFollowUp" | "completionText"
> {
  void input.scheduleTail;
  const focusLabel =
    /\bthroat training\b/i.test(input.focus)
      ? "throat training"
      : /\boral control\b/i.test(input.focus)
        ? "oral control"
        : "oral use";
  if (input.templateId === "silence_hold") {
    return {
      description: `Keep your ${input.toolLabel} in a controlled ${focusLabel} drill for ${input.durationLabel} while you stay quiet between rounds and keep the pace exact.`,
      startInstruction: `Start now. Get your ${input.toolLabel} ready for ${focusLabel}, settle the pace, hold your silence between rounds, and reply done once you are set, pet.`,
      assignedAction: `get your ${input.toolLabel} ready for ${focusLabel}, hold the silence, and reply done`,
      activeFollowUp: `Keep the ${focusLabel} pace controlled, quiet between rounds, and exact with your ${input.toolLabel}, pet.`,
      completionText: `Good pet. You kept the ${focusLabel} drill controlled and the silence clean. The task is complete.`,
    };
  }
  if (input.templateId === "stakes_hold" || input.templateId === "endurance_hold") {
    return {
      description: `Run stricter ${focusLabel} intervals with your ${input.toolLabel} for ${input.durationLabel}, keeping the rhythm clean and the pressure deliberate.`,
      startInstruction: `Start now. Get your ${input.toolLabel} ready for ${focusLabel}, set the stricter rhythm, and reply done once you are under control, pet.`,
      assignedAction: `set your ${input.toolLabel} for the stricter ${focusLabel} drill and reply done`,
      activeFollowUp: `Keep the ${focusLabel} rhythm exact with your ${input.toolLabel}, pet. No sloppy pacing.`,
      completionText: `Good pet. You carried that stricter ${focusLabel} drill cleanly and reported on time. The task is complete.`,
    };
  }
  return {
    description: `Work with your ${input.toolLabel} in controlled ${focusLabel} rounds for ${input.durationLabel}. Keep the rhythm deliberate and stay under control instead of rushing it.`,
    startInstruction: `Start now. Get your ${input.toolLabel} ready for ${focusLabel}, settle into the first controlled round, and reply done once you are set, pet.`,
    assignedAction: `get your ${input.toolLabel} ready for ${focusLabel} and reply done`,
    activeFollowUp: `Keep the ${focusLabel} rhythm controlled and deliberate with your ${input.toolLabel}, pet.`,
    completionText: `Good pet. You kept the ${focusLabel} drill controlled and reported properly. The task is complete.`,
  };
}

function buildInsertablePropLanguage(input: {
  toolLabel: string;
  durationLabel: string;
  scheduleTail: string;
}): Pick<
  PlannedTaskLanguage,
  "description" | "startInstruction" | "assignedAction" | "activeFollowUp" | "completionText"
> {
  const baseTail = input.scheduleTail;
  return {
    description: `Use your ${input.toolLabel} as a deliberate prop for ${input.durationLabel}. Keep it in the scene as part of the pressure instead of treating it like a toy to wave around. ${baseTail}`.trim(),
    startInstruction: `Start now. Put your ${input.toolLabel} where you can use it as a prop, set the scene cleanly, and reply done once you are ready, pet.`,
    assignedAction: `set your ${input.toolLabel} as a prop and reply done`,
    activeFollowUp: `Keep your ${input.toolLabel} in the scene with intention, pet. Do not get sloppy with it.`,
    completionText: `Good pet. You kept the prop use controlled and reported properly. The task is complete.`,
  };
}

function buildChastityTaskLanguage(input: {
  templateId?: string;
  itemName: string;
  durationLabel: string;
  scheduleTail: string;
}): Pick<
  PlannedTaskLanguage,
  "description" | "startInstruction" | "assignedAction" | "activeFollowUp" | "completionText"
> {
  if (input.templateId === "silence_hold") {
    return {
      description: `Keep your ${input.itemName} on for ${input.durationLabel} under a silence rule: no touching, no adjusting, no bargaining. ${input.scheduleTail}`.trim(),
      startInstruction: `Start now. Lock your ${input.itemName} on, settle the silence rule, and reply done once you are under control, pet.`,
      assignedAction: `lock your ${input.itemName} on, settle the silence rule, and reply done`,
      activeFollowUp: `Keep your ${input.itemName} on, keep quiet, and do not negotiate with the rule, pet.`,
      completionText: `Good pet. You kept the chastity line and the silence clean, then reported properly. The task is complete.`,
    };
  }
  if (input.templateId === "stakes_hold" || input.templateId === "endurance_hold") {
    return {
      description: `Run a stricter chastity line with your ${input.itemName} for ${input.durationLabel}: locked the whole time, clean accountability, and no touching around the edges. ${input.scheduleTail}`.trim(),
      startInstruction: `Start now. Lock your ${input.itemName} on, set the stricter accountability line, and reply done once you are under control, pet.`,
      assignedAction: `lock your ${input.itemName} on for the stricter chastity line and reply done`,
      activeFollowUp: `Keep your ${input.itemName} on and the accountability clean, pet. No edge play around the rule.`,
      completionText: `Good pet. You carried the sharper chastity line cleanly and reported on time. The task is complete.`,
    };
  }
  return {
    description: `Keep your ${input.itemName} on for ${input.durationLabel} and treat it like an actual chastity protocol, not decoration: no touching, one clean halfway check-in, then a final report. ${input.scheduleTail}`.trim(),
    startInstruction: `Start now. Lock your ${input.itemName} on and reply done once the rule is in place, pet.`,
    assignedAction: `lock your ${input.itemName} on and reply done`,
    activeFollowUp: `Keep your ${input.itemName} on and hold the chastity rule cleanly, pet.`,
    completionText: `Good pet. You kept the chastity protocol clean and reported properly. The task is complete.`,
  };
}

function buildBondageTaskLanguage(input: {
  templateId?: string;
  itemName: string;
  durationLabel: string;
  scheduleTail: string;
}): Pick<
  PlannedTaskLanguage,
  "description" | "startInstruction" | "assignedAction" | "activeFollowUp" | "completionText"
> {
  if (input.templateId === "silence_hold") {
    return {
      description: `Use your ${input.itemName} for a restrained silence drill for ${input.durationLabel}: secure yourself cleanly, keep quiet, and hold the line without fiddling. ${input.scheduleTail}`.trim(),
      startInstruction: `Start now. Set your ${input.itemName}, secure yourself cleanly, settle the silence, and reply done once you are set, pet.`,
      assignedAction: `set your ${input.itemName}, settle the silence, and reply done`,
      activeFollowUp: `Keep your ${input.itemName} where it belongs, stay quiet, and do not fidget, pet.`,
      completionText: `Good pet. You kept the bondage line and the silence clean, then reported properly. The task is complete.`,
    };
  }
  if (input.templateId === "stakes_hold" || input.templateId === "endurance_hold") {
    return {
      description: `Run a stricter bondage discipline drill with your ${input.itemName} for ${input.durationLabel}: secured posture, exact check-ins, and no adjustments without permission. ${input.scheduleTail}`.trim(),
      startInstruction: `Start now. Set your ${input.itemName}, secure the stricter posture, and reply done once you are under control, pet.`,
      assignedAction: `set your ${input.itemName} for the stricter bondage drill and reply done`,
      activeFollowUp: `Keep the bondage line exact with your ${input.itemName}, pet. No unauthorized adjustments.`,
      completionText: `Good pet. You carried the sharper bondage drill cleanly and reported on time. The task is complete.`,
    };
  }
  return {
    description: `Use your ${input.itemName} for a restrained obedience drill for ${input.durationLabel}: secure yourself, hold the posture I set, and keep your check-ins clean. ${input.scheduleTail}`.trim(),
    startInstruction: `Start now. Set your ${input.itemName}, secure yourself cleanly, and reply done once you are in position, pet.`,
    assignedAction: `set your ${input.itemName}, secure yourself, and reply done`,
    activeFollowUp: `Keep your ${input.itemName} set and the obedience line clean, pet.`,
    completionText: `Good pet. You kept the bondage drill controlled and reported properly. The task is complete.`,
  };
}

function detectFocusMode(
  focus: string,
): "oral" | "anal" | "device" | "frame" | "stillness" | "discipline" | "general" {
  if (/\b(throat|oral|mouth|tongue|gag|deep|swallow|jaw)\b/i.test(focus)) {
    return "oral";
  }
  if (/\b(anal|anus|plug|dildo|prostate)\b/i.test(focus)) {
    return "anal";
  }
  if (/\b(chastity|cage|lock|locked|device|plug|toy|vibe|vibrator)\b/i.test(focus)) {
    return "device";
  }
  if (/\b(camera|frame|look|eye|inspection|watch|visible)\b/i.test(focus)) {
    return "frame";
  }
  if (/\b(still|steady|calm|hold|freeze|motionless)\b/i.test(focus)) {
    return "stillness";
  }
  if (/\b(posture|kneel|obedience|discipline|protocol|hands behind|shoulders back)\b/i.test(focus)) {
    return "discipline";
  }
  return "general";
}

function detectItemPattern(item: SessionInventoryItem | null): string {
  if (!item) {
    return "";
  }
  return normalize(`${item.label} ${item.notes}`);
}

function deriveStakeFromContext(
  currentStakes: string,
  userText: string,
  item: SessionInventoryItem | null,
): string {
  if (currentStakes) {
    return currentStakes;
  }
  const normalizedUserText = normalize(userText);
  const itemPattern = detectItemPattern(item);
  if (/\bchastity|cage|locked|lock\b/.test(normalizedUserText) || /\bchastity|cage|locked|lock\b/.test(itemPattern)) {
    return "chastity";
  }
  if (/\btruth|secret|question\b/.test(normalizedUserText)) {
    return "control";
  }
  if (item?.intiface_controlled) {
    return "control";
  }
  if (item && item.category === "clothing") {
    return "obedience";
  }
  if (item && (item.category === "device" || item.category === "toy" || item.category === "accessory")) {
    return "control";
  }
  return "control";
}

function deriveWagerDurationMinutes(
  profile: ProfileState | undefined,
  progress: Pick<ProfileProgressRow, "current_tier" | "free_pass_count" | "last_completion_summary"> | undefined,
  item: SessionInventoryItem | null,
): number {
  const intensity = normalize(profile?.intensity ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  const highIntensity =
    /\b(high|hard|strict|intense)\b/.test(intensity) ||
    /\b(strict|firm|punitive|hard)\b/.test(preferredStyle) ||
    progress?.current_tier === "gold" ||
    progress?.current_tier === "platinum";
  const lightIntensity =
    /\b(low|soft|gentle)\b/.test(intensity) ||
    /\b(gentle|warm|soft)\b/.test(preferredStyle) ||
    (progress?.free_pass_count ?? 0) > 0;
  if (item?.intiface_controlled) {
    return highIntensity ? 20 : lightIntensity ? 10 : 15;
  }
  return highIntensity ? 45 : lightIntensity ? 20 : 30;
}

function deriveLoseCondition(
  item: SessionInventoryItem | null,
  durationMinutes: number,
  deviceControlActive: boolean,
): string {
  const durationLabel = formatDurationLabel(durationMinutes);
  const itemName = item ? getSessionInventoryDisplayName(item) : "device";
  const itemPattern = detectItemPattern(item);

  if (item && /\b(cuffs?|restraints?|shackles?)\b/.test(itemPattern)) {
    return `you wear your ${itemName} and hold still for ${durationLabel}`;
  }
  if (item && /\b(collar|leash)\b/.test(itemPattern)) {
    return `you wear your ${itemName} and stay in frame for ${durationLabel}`;
  }
  if (item && /\b(chastity|cage|belt|lock|locked)\b/.test(itemPattern)) {
    return `you keep your ${itemName} on for ${durationLabel}`;
  }
  if (item?.intiface_controlled && deviceControlActive) {
    return `I control your ${itemName} for ${durationLabel} while you hold still`;
  }
  if (item && (item.category === "device" || item.category === "toy" || item.category === "accessory")) {
    return `you use your ${itemName} for ${durationLabel} and stay on camera`;
  }
  if (item && item.category === "clothing") {
    return `you wear your ${itemName} for ${durationLabel}`;
  }
  if (deviceControlActive) {
    return `I run the connected device for ${durationLabel} while you hold still`;
  }
  return `you complete a ${durationMinutes} minute control hold`;
}

export function planDynamicWagerTerms(input: {
  mode: "none" | "all" | "user_win" | "raven_win";
  userText: string;
  currentStakes: string;
  currentWinCondition: string;
  currentLoseCondition: string;
  inventory?: SessionInventoryItem[];
  deviceControlActive?: boolean;
  profile?: ProfileState;
  progress?: Pick<ProfileProgressRow, "current_tier" | "free_pass_count" | "last_completion_summary">;
}): PlannedWagerTerms | null {
  if (input.mode === "none") {
    return null;
  }
  const availableItems = (input.inventory ?? []).filter((item) => item.available_this_session);
  const item =
    availableItems.find(
      (candidate) =>
        candidate.intiface_controlled &&
        typeof candidate.linked_device_id === "string" &&
        candidate.linked_device_id.length > 0,
    ) ??
    availableItems.find((candidate) =>
      candidate.category === "device" || candidate.category === "toy" || candidate.category === "accessory",
    ) ??
    availableItems[0] ??
    null;
  const stakes = deriveStakeFromContext(input.currentStakes, input.userText, item);
  const durationMinutes = deriveWagerDurationMinutes(input.profile, input.progress, item);
  const seed = hashString(`${input.userText}|${stakes}|${item?.id ?? "none"}|${durationMinutes}`);
  const winConditionVariants = [
    "you set one request and I grant it",
    "you get one truth from me",
    "you choose the next round and I follow it",
    "you bank one free pass",
  ] as const;
  const winCondition =
    input.mode === "all" || input.mode === "user_win"
      ? input.currentWinCondition || pickBySeed(winConditionVariants, seed)
      : input.currentWinCondition;
  const loseCondition =
    input.mode === "all" || input.mode === "raven_win"
      ? input.currentLoseCondition || deriveLoseCondition(item, durationMinutes, input.deviceControlActive === true)
      : input.currentLoseCondition;

  return { stakes, winCondition, loseCondition };
}

export function planDynamicTaskLanguage(input: {
  focus: string;
  durationMinutes: number;
  selectedInventoryItem: SessionInventoryItem | null;
  templateId?: string;
  schedule: SharedSchedule;
  repeatsRequired: number;
}): PlannedTaskLanguage {
  const normalizedFocus = normalize(input.focus);
  const focusMode = detectFocusMode(normalizedFocus);
  const itemName = input.selectedInventoryItem
    ? getSessionInventoryDisplayName(input.selectedInventoryItem)
    : "";
  const insertableToolLabel = deriveInsertableToolLabel(input.focus, itemName);
  const durationLabel = formatDurationLabel(input.durationMinutes);
  const scheduleTail = formatScheduleTail(input.schedule, input.repeatsRequired);
  const titleLabel = formatFocusTitleLabel(input.focus, input.templateId);
  const seed = hashString(`${normalizedFocus}|${itemName}|${durationLabel}|${input.schedule.type}|${input.repeatsRequired}`);
  const isAnalSilenceHold = focusMode === "anal" && input.templateId === "silence_hold";
  const isAnalStakesHold =
    focusMode === "anal" &&
    (input.templateId === "stakes_hold" || input.templateId === "endurance_hold");
  const hasExplicitInsertableTool =
    Boolean(input.selectedInventoryItem) ||
    /\b(dildo|plug|aneros|prostate massager|toy)\b/i.test(normalizedFocus);
  const chastityLanguage =
    /\b(chastity|cage|locked|lock)\b/i.test(normalizedFocus)
      ? buildChastityTaskLanguage({
          templateId: input.templateId,
          itemName: itemName || "chastity device",
          durationLabel,
          scheduleTail,
        })
      : null;
  const bondageLanguage =
    /\b(bondage|cuffs?|rope|collar|leash|restraint|restrained)\b/i.test(normalizedFocus)
      ? buildBondageTaskLanguage({
          templateId: input.templateId,
          itemName: itemName || "restraints",
          durationLabel,
          scheduleTail,
        })
      : null;

  const insertableLanguage =
    hasExplicitInsertableTool && focusMode === "anal"
      ? buildInsertableAnalLanguage({
          templateId: input.templateId,
          toolLabel: insertableToolLabel,
          durationLabel,
          scheduleTail,
        })
      : hasExplicitInsertableTool && focusMode === "oral"
        ? buildInsertableOralLanguage({
            templateId: input.templateId,
            focus: input.focus,
            toolLabel: insertableToolLabel,
            durationLabel,
            scheduleTail,
          })
        : hasExplicitInsertableTool && /\bprop\b/i.test(normalizedFocus)
          ? buildInsertablePropLanguage({
              toolLabel: insertableToolLabel,
              durationLabel,
              scheduleTail,
            })
          : null;

  const semanticLanguage = insertableLanguage ?? chastityLanguage ?? bondageLanguage;

  const descriptionLead =
    semanticLanguage
      ? semanticLanguage.description
      : focusMode === "oral"
        ? pickBySeed(
            [
              `Work through a ${input.focus} block for ${durationLabel}.`,
              `Run a controlled ${input.focus} sequence for ${durationLabel}.`,
              `Stay with a strict ${input.focus} drill for ${durationLabel}.`,
            ],
            seed,
          )
      : focusMode === "anal" && itemName
        ? pickBySeed(
            isAnalSilenceHold
              ? [
                  `Keep your ${itemName} in place for a controlled anal hold for ${durationLabel} while you stay quiet.`,
                  `Work through a quiet anal hold with your ${itemName} for ${durationLabel}.`,
                  `Hold your ${itemName} in place for ${durationLabel} and keep the whole anal drill silent and deliberate.`,
                ]
              : isAnalStakesHold
                ? [
                    `Hold your ${itemName} in a stricter anal sequence for ${durationLabel} and keep the pace exact.`,
                    `Run a sharper anal drill with your ${itemName} for ${durationLabel}, keeping the pressure clean.`,
                    `Use your ${itemName} for a more exacting anal hold for ${durationLabel}.`,
                  ]
                : input.selectedInventoryItem?.notes.toLowerCase().includes("plug")
                  ? [
                      `Use your ${itemName} for a controlled anal hold for ${durationLabel}.`,
                      `Keep your ${itemName} in place for a deliberate anal drill for ${durationLabel}.`,
                      `Work through a steady anal sequence with your ${itemName} for ${durationLabel}.`,
                    ]
                  : [
                      `Use your ${itemName} for a paced anal drill for ${durationLabel}.`,
                      `Work through a controlled anal sequence with your ${itemName} for ${durationLabel}.`,
                      `Keep your ${itemName} in anal play for ${durationLabel}, staying slow and deliberate.`,
              ],
              seed,
            )
        : focusMode === "device" && itemName
        ? pickBySeed(
            [
              `Use your ${itemName} in a ${input.focus} sequence for ${durationLabel}.`,
              `Keep your ${itemName} in play for a ${input.focus} drill for ${durationLabel}.`,
              `Run your ${itemName} through a ${input.focus} block for ${durationLabel}.`,
            ],
            seed,
          )
        : focusMode === "frame"
          ? pickBySeed(
              [
                `Hold a clean ${input.focus} frame for ${durationLabel}.`,
                `Stay visible and controlled in a ${input.focus} drill for ${durationLabel}.`,
                `Work through a ${input.focus} check for ${durationLabel}.`,
              ],
              seed,
            )
          : focusMode === "discipline"
            ? pickBySeed(
                [
                  `Hold a strict ${input.focus} protocol for ${durationLabel}.`,
                  `Work through a firm ${input.focus} drill for ${durationLabel}.`,
                  `Keep a controlled ${input.focus} hold for ${durationLabel}.`,
                ],
                seed,
              )
            : pickBySeed(
                [
                  `Work through a ${input.focus} drill for ${durationLabel}.`,
                  `Run a controlled ${input.focus} sequence for ${durationLabel}.`,
                  `Hold a strict ${input.focus} routine for ${durationLabel}.`,
            ],
            seed,
          );

  const startInstruction = pickBySeed(
    insertableLanguage
      ? [insertableLanguage.startInstruction]
      : chastityLanguage
        ? [chastityLanguage.startInstruction]
        : bondageLanguage
          ? [bondageLanguage.startInstruction]
      : focusMode === "anal" && itemName
      ? [
          isAnalSilenceHold
            ? `Start now. Set your ${itemName} for anal use, go quiet, and reply done once everything is steady, pet.`
            : isAnalStakesHold
              ? `Start now. Set your ${itemName} for anal use, keep the pace exact, and reply done once you are under control, pet.`
              : `Start now. Get your ${itemName} ready for anal use, settle it properly, and reply done once you are set, pet.`,
          isAnalSilenceHold
            ? `Start now. Ease your ${itemName} into place, hold your silence, and reply done once you are ready, pet.`
            : isAnalStakesHold
              ? `Start now. Ease your ${itemName} into place for the stricter anal drill and reply done once you are ready, pet.`
              : `Start now. Ease your ${itemName} into place for the anal drill and reply done once you are ready, pet.`,
          isAnalSilenceHold
            ? `Start now. Settle your ${itemName} for the anal hold, keep quiet, and reply done once the line is clean, pet.`
            : isAnalStakesHold
              ? `Start now. Set your ${itemName} for anal use and reply done once the pressure is clean and exact, pet.`
              : `Start now. Set your ${itemName} for anal use and reply done once the pace is under control, pet.`,
        ]
      : [
          itemName
            ? `Start now. Set up your ${itemName} for the ${input.focus} drill and reply done once you are set, pet.`
            : `Start now. Begin the ${input.focus} drill and reply done once you are set, pet.`,
          itemName
            ? `Start now. Get your ${itemName} ready for this ${input.focus} sequence and reply done once you are under control, pet.`
            : `Start now. Set the ${input.focus} sequence and reply done once you are under control, pet.`,
          itemName
            ? `Start now. Put your ${itemName} into place for the ${input.focus} block and reply done once you are ready, pet.`
            : `Start now. Take up the ${input.focus} block and reply done once you are ready, pet.`,
        ],
    seed + 3,
  );

  const assignedAction = pickBySeed(
    insertableLanguage
      ? [insertableLanguage.assignedAction]
      : chastityLanguage
        ? [chastityLanguage.assignedAction]
        : bondageLanguage
          ? [bondageLanguage.assignedAction]
      : focusMode === "anal" && itemName
      ? [
          isAnalSilenceHold
            ? `set your ${itemName} for anal use, go quiet, and reply done`
            : isAnalStakesHold
              ? `set your ${itemName} for the stricter anal drill and reply done`
              : `get your ${itemName} ready for anal use and reply done`,
          isAnalSilenceHold
            ? `ease your ${itemName} into place, hold silence, and reply done`
            : isAnalStakesHold
              ? `ease your ${itemName} into place for the anal drill and reply done`
              : `ease your ${itemName} into place for the anal drill and reply done`,
          isAnalSilenceHold
            ? `settle your ${itemName} for the anal hold and reply done`
            : isAnalStakesHold
              ? `set your ${itemName} for anal use and reply done`
              : `set your ${itemName} for anal use and reply done`,
        ]
      : [
          itemName
            ? `set up your ${itemName} for the ${input.focus} drill and reply done`
            : `begin the ${input.focus} drill and reply done`,
          itemName
            ? `get your ${itemName} ready for the ${input.focus} sequence and reply done`
            : `set the ${input.focus} sequence and reply done`,
          itemName
            ? `put your ${itemName} in place for the ${input.focus} block and reply done`
            : `take up the ${input.focus} block and reply done`,
        ],
    seed + 5,
  );

  const activeFollowUp = pickBySeed(
    insertableLanguage
      ? [insertableLanguage.activeFollowUp]
      : chastityLanguage
        ? [chastityLanguage.activeFollowUp]
        : bondageLanguage
          ? [bondageLanguage.activeFollowUp]
      : focusMode === "anal" && itemName
      ? [
          isAnalSilenceHold
            ? `Keep your ${itemName} settled, your body quiet, and the anal hold clean, pet.`
            : isAnalStakesHold
              ? `Keep the anal pace exact with your ${itemName}, pet. No sloppy shortcuts.`
              : `Keep the pace slow and the placement deliberate with your ${itemName}, pet.`,
          isAnalSilenceHold
            ? `Stay quiet, keep your ${itemName} steady, and do not let the anal hold get loose, pet.`
            : isAnalStakesHold
              ? `Stay steady with your ${itemName} and do not let the anal drill get sloppy, pet.`
              : `Stay steady with your ${itemName} and do not let the anal drill get sloppy, pet.`,
          isAnalSilenceHold
            ? `Hold the anal line and the silence cleanly with your ${itemName}, pet.`
            : isAnalStakesHold
              ? `Hold the anal line cleanly with your ${itemName}, pet.`
              : `Hold the anal line cleanly with your ${itemName}, pet.`,
        ]
      : [
          itemName
            ? `Keep the ${input.focus} controlled with your ${itemName}, pet.`
            : `Keep the ${input.focus} controlled, pet.`,
          itemName
            ? `Stay with the ${input.focus} pace and keep your ${itemName} exactly where it belongs, pet.`
            : `Stay with the ${input.focus} pace and keep it controlled, pet.`,
          itemName
            ? `Hold the ${input.focus} line cleanly with your ${itemName}, pet.`
            : `Hold the ${input.focus} line cleanly, pet.`,
        ],
    seed + 7,
  );

  const completionText = pickBySeed(
    insertableLanguage
      ? [insertableLanguage.completionText]
      : chastityLanguage
        ? [chastityLanguage.completionText]
        : bondageLanguage
          ? [bondageLanguage.completionText]
      : focusMode === "anal"
      ? [
          isAnalSilenceHold
            ? `Good pet. You kept the anal hold and the silence clean, then reported properly. The task is complete.`
            : isAnalStakesHold
              ? `Good pet. You carried that sharper anal drill cleanly and reported on time. The task is complete.`
              : `Good pet. You kept the anal drill controlled and reported properly. The task is complete.`,
          isAnalSilenceHold
            ? `Good pet. You held the anal line steady and quiet, then reported on time. The task is complete.`
            : isAnalStakesHold
              ? `Good pet. You finished the anal task without getting sloppy. The task is complete.`
              : `Good pet. You carried that anal sequence cleanly and reported on time. The task is complete.`,
          isAnalSilenceHold
            ? `Good pet. You finished the anal hold without losing your silence. The task is complete.`
            : isAnalStakesHold
              ? `Good pet. You kept that anal pressure clean all the way through. The task is complete.`
              : `Good pet. You finished the anal task without getting sloppy. The task is complete.`,
        ]
      : [
          `Good pet. You finished the ${input.focus} cleanly and reported properly. The task is complete.`,
          `Good pet. You carried the ${input.focus} through the full stretch and reported cleanly. The task is complete.`,
          `Good pet. You completed the ${input.focus} drill and kept your report sharp. The task is complete.`,
        ],
    seed + 11,
  );

  return {
    titleLabel,
    description: descriptionLead.trim(),
    selectionReason: itemName
      ? `it matches the specific task you asked for: ${input.focus}, and it uses your available ${itemName} this session.`
      : `it matches the specific task you asked for: ${input.focus}.`,
    startInstruction,
    assignedAction,
    activeFollowUp,
    completionText,
  };
}
