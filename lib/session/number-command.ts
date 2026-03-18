import {
  getSessionInventoryDisplayName,
  type SessionInventoryItem,
} from "./session-inventory.ts";

export type NumberCommandAction = {
  type: "device_command";
  device_id: string;
  command: "vibrate";
  params: {
    intensity: number;
    duration_ms: number;
  };
};

export type NumberCommandPlan = {
  commandText: string;
  followUpText: string;
  action: NumberCommandAction | null;
};

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickFrom<T>(items: readonly T[], seed: number): T {
  const safeIndex = Math.abs(seed) % items.length;
  return items[safeIndex] as T;
}

function clampUnit(value: number): number {
  return Number(Math.max(0.05, Math.min(1, value)).toFixed(2));
}

function buildDeviceActionJson(action: NumberCommandAction): string {
  return `\`\`\`json\n${JSON.stringify(action)}\n\`\`\``;
}

function availableInventory(items: SessionInventoryItem[]): SessionInventoryItem[] {
  return items.filter((item) => item.available_this_session);
}

function availableIntifaceInventory(items: SessionInventoryItem[]): SessionInventoryItem[] {
  return availableInventory(items).filter(
    (item) =>
      item.intiface_controlled &&
      typeof item.linked_device_id === "string" &&
      item.linked_device_id.length > 0,
  );
}

export function buildNumberCommandPlan(input: {
  pickedNumber: number;
  rotationIndex: number;
  stakes: string;
  inventory: SessionInventoryItem[];
  deviceControlActive: boolean;
}): NumberCommandPlan {
  const seed = hashString(
    [
      String(input.pickedNumber),
      String(input.rotationIndex),
      input.stakes.trim().toLowerCase(),
      ...availableInventory(input.inventory).map((item) => `${item.id}:${item.label}:${item.notes}`),
    ].join("|"),
  );
  const durations = [30, 45, 60, 75, 90];
  const durationSeconds = pickFrom(durations, seed + input.pickedNumber);
  const guidance = pickFrom(
    [
      "Do not move your torso at all.",
      "Keep your head centered and your shoulders still.",
      "Hands still, posture locked, eyes forward.",
      "No shifting, no fidgeting, no excuses.",
    ],
    seed >> 1,
  );

  const intifaceItems = availableIntifaceInventory(input.inventory);
  if (input.deviceControlActive && intifaceItems.length > 0) {
    const selected = pickFrom(intifaceItems, seed >> 2);
    const intensity = clampUnit(0.2 + ((seed % 5) * 0.12));
    const action: NumberCommandAction = {
      type: "device_command",
      device_id: selected.linked_device_id ?? "0",
      command: "vibrate",
      params: {
        intensity,
        duration_ms: durationSeconds * 1000,
      },
    };
    return {
      commandText: [
        `Number ${input.pickedNumber} locked, pet.`,
        `I am running ${getSessionInventoryDisplayName(selected)} for ${durationSeconds} seconds.`,
        guidance,
        "If the camera catches movement before the timer ends, you lose this round.",
        buildDeviceActionJson(action),
      ].join(" "),
      followUpText:
        "Complete the full timer, then report done. If you moved or broke posture, report failed.",
      action,
    };
  }

  const inventoryItems = availableInventory(input.inventory);
  if (inventoryItems.length > 0) {
    const selected = pickFrom(inventoryItems, seed >> 3);
    return {
      commandText: [
        `Number ${input.pickedNumber} locked, pet.`,
        `Bring ${getSessionInventoryDisplayName(selected)} into frame and hold still for ${durationSeconds} seconds.`,
        guidance,
        "If you break posture or drop focus, you lose this round.",
      ].join(" "),
      followUpText:
        "Hold the full duration, then report done. If you broke form, report failed.",
      action: null,
    };
  }

  const noItemCommands = [
    `Hold strict stillness for ${durationSeconds} seconds while maintaining eye line to camera.`,
    `Hold your position for ${durationSeconds} seconds without shifting your shoulders.`,
    `Keep your stance locked for ${durationSeconds} seconds with no visible motion.`,
  ];
  return {
    commandText: [
      `Number ${input.pickedNumber} locked, pet.`,
      pickFrom(noItemCommands, seed >> 4),
      guidance,
      "If motion breaks the command window, you lose this round.",
    ].join(" "),
    followUpText:
      "Complete the full timer, then report done. If you moved early, report failed.",
    action: null,
  };
}

