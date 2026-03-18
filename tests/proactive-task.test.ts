import test from "node:test";
import assert from "node:assert/strict";

import { shouldAssignProactiveInventoryTask } from "../lib/session/proactive-task.ts";
import type { SessionInventoryItem } from "../lib/session/session-inventory.ts";

const INVENTORY: SessionInventoryItem[] = [
  {
    id: "inv-1",
    label: "Steel Cage",
    category: "device",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "lockable",
  },
  {
    id: "inv-2",
    label: "Collar",
    category: "accessory",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "",
  },
  {
    id: "inv-3",
    label: "Hoodie",
    category: "clothing",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "",
  },
];

test("proactive task gate allows start cue when inventory is available", () => {
  const allowed = shouldAssignProactiveInventoryTask({
    userText: "ok lets start",
    dialogueAct: "acknowledgement",
    topicType: "none",
    topicLocked: false,
    inventory: INVENTORY,
    hasActiveTask: false,
    alreadyPrompted: false,
  });

  assert.equal(allowed, true);
});

test("proactive task gate blocks when no available inventory exists", () => {
  const blocked = shouldAssignProactiveInventoryTask({
    userText: "ready",
    dialogueAct: "acknowledgement",
    topicType: "none",
    topicLocked: false,
    inventory: INVENTORY.map((item) => ({ ...item, available_this_session: false })),
    hasActiveTask: false,
    alreadyPrompted: false,
  });

  assert.equal(blocked, false);
});

test("proactive task gate blocks game cues and locked game topics", () => {
  const blockedByCue = shouldAssignProactiveInventoryTask({
    userText: "lets start the game",
    dialogueAct: "other",
    topicType: "none",
    topicLocked: false,
    inventory: INVENTORY,
    hasActiveTask: false,
    alreadyPrompted: false,
  });
  assert.equal(blockedByCue, false);

  const blockedByTopic = shouldAssignProactiveInventoryTask({
    userText: "ready",
    dialogueAct: "acknowledgement",
    topicType: "game_execution",
    topicLocked: true,
    inventory: INVENTORY,
    hasActiveTask: false,
    alreadyPrompted: false,
  });
  assert.equal(blockedByTopic, false);
});

test("proactive task gate blocks once already prompted or active task exists", () => {
  const blockedByPrompt = shouldAssignProactiveInventoryTask({
    userText: "what now",
    dialogueAct: "other",
    topicType: "none",
    topicLocked: false,
    inventory: INVENTORY,
    hasActiveTask: false,
    alreadyPrompted: true,
  });
  assert.equal(blockedByPrompt, false);

  const blockedByTask = shouldAssignProactiveInventoryTask({
    userText: "what now",
    dialogueAct: "other",
    topicType: "none",
    topicLocked: false,
    inventory: INVENTORY,
    hasActiveTask: true,
    alreadyPrompted: false,
  });
  assert.equal(blockedByTask, false);
});
