import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicTaskPlanFromRequest } from "../lib/session/task-script.ts";
import { shouldAssignProactiveInventoryTask } from "../lib/session/proactive-task.ts";
import type { SessionInventoryItem } from "../lib/session/session-inventory.ts";

const INVENTORY_FIXTURE: SessionInventoryItem[] = [
  {
    id: "item-1",
    label: "Steel Cage",
    category: "device",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "lockable",
  },
  {
    id: "item-2",
    label: "Leather Cuffs",
    category: "accessory",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "",
  },
  {
    id: "item-3",
    label: "Vibe",
    category: "device",
    available_this_session: true,
    intiface_controlled: true,
    linked_device_id: "0",
    notes: "",
  },
  {
    id: "item-4",
    label: "Blindfold",
    category: "clothing",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "",
  },
];

test("session inventory flow explicit request uses the requested listed item", () => {
  const explicitPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a task with my leather cuffs for 30 minutes",
    inventory: INVENTORY_FIXTURE,
  });

  assert.match(
    explicitPlan.assignmentText,
    /while using your Leather Cuffs|Use your Leather Cuffs/i,
  );
  assert.match(explicitPlan.createPayload.title, /Leather Cuffs/i);
});

test("session inventory flow start cue can proactively assign an item task", () => {
  const shouldPrompt = shouldAssignProactiveInventoryTask({
    userText: "ok lets start",
    dialogueAct: "acknowledgement",
    topicType: "none",
    topicLocked: false,
    inventory: INVENTORY_FIXTURE,
    hasActiveTask: false,
    alreadyPrompted: false,
  });
  assert.equal(shouldPrompt, true);

  const proactivePlan = buildDeterministicTaskPlanFromRequest({
    userText: "Assign a concrete task now using one available inventory item. Context: ok lets start",
    inventory: INVENTORY_FIXTURE,
  });

  assert.match(proactivePlan.assignmentText, /Use your Vibe for 2 hours/i);
  assert.match(proactivePlan.createPayload.title, /Vibe/i);
});
