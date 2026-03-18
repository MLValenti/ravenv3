import test from "node:test";
import assert from "node:assert/strict";

import {
  assessInventoryTaskCompatibility,
  buildSessionInventoryContextMessage,
  buildInventoryClarificationQuestion,
  decideInventoryGroundingLookup,
  describeInventorySemantics,
  findInventoryItemForTask,
  getSessionInventoryDisplayName,
  needsInventoryClarification,
  normalizeSessionInventory,
  resolveInventoryGrounding,
  saveSessionInventoryToStorage,
  loadSessionInventoryFromStorage,
} from "../lib/session/session-inventory.ts";

test("session inventory normalizes items and builds a usable prompt block", () => {
  const items = normalizeSessionInventory([
    {
      id: "cage-1",
      label: "Steel Cage",
      category: "device",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "metal",
    },
    {
      id: "dress-1",
      label: "Black Dress",
      category: "clothing",
      available_this_session: false,
      intiface_controlled: false,
    },
  ]);

  assert.equal(items.length, 2);
  const prompt = buildSessionInventoryContextMessage(items);
  assert.match(prompt, /Session inventory:/i);
  assert.match(prompt, /Steel Cage \[device\] available=yes intiface=no description=metal/i);
  assert.match(prompt, /Black Dress \[clothing\] available=no intiface=no/i);
});

test("session inventory selects an explicit or device-ready item for device tasks", () => {
  const items = normalizeSessionInventory([
    {
      id: "plug-1",
      label: "Hush Plug",
      category: "toy",
      available_this_session: true,
      intiface_controlled: true,
      linked_device_id: "0",
      notes: "",
    },
    {
      id: "dress-1",
      label: "Black Dress",
      category: "clothing",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "",
    },
  ]);

  assert.equal(
    findInventoryItemForTask(items, "use the black dress for a posture task", "posture_hold")?.label,
    "Black Dress",
  );
  assert.equal(
    findInventoryItemForTask(items, "give me a device task", "device_hold")?.label,
    "Hush Plug",
  );
});

test("session inventory uses notes to understand a generic item and skips clarification when notes are specific", () => {
  const items = normalizeSessionInventory([
    {
      id: "toy-1",
      label: "Toy",
      category: "other",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "steel chastity cage",
    },
  ]);

  const selected = findInventoryItemForTask(items, "give me a chastity task with my steel chastity cage", "device_hold");
  assert.equal(selected?.label, "Toy");
  assert.equal(needsInventoryClarification(selected ?? null), false);
});

test("session inventory asks for clarification when the item is still too vague", () => {
  const items = normalizeSessionInventory([
    {
      id: "thing-1",
      label: "Thing",
      category: "other",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "",
    },
  ]);

  assert.equal(needsInventoryClarification(items[0]), true);
  assert.match(
    buildInventoryClarificationQuestion(items[0]),
    /clean read on what "Thing" is|tell me exactly what it is and how it is realistically used this session/i,
  );
});

test("session inventory treats insertable toys as semantically specific instead of generic device memory", () => {
  const items = normalizeSessionInventory([
    {
      id: "toy-1",
      label: "Toy",
      category: "toy",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "silicone dildo",
    },
  ]);

  const semantics = describeInventorySemantics(items[0]!);
  assert.equal(semantics.isInsertableToy, true);
  assert.equal(needsInventoryClarification(items[0]), true);
  assert.match(
    buildInventoryClarificationQuestion(items[0]!),
    /oral(?: use)?, anal(?: use)?, or (?:just as )?a? ?prop/i,
  );
});

test("session inventory compatibility rejects posture tasks for insertable toys and allows restraint posture use", () => {
  const dildo = normalizeSessionInventory([
    {
      id: "toy-1",
      label: "Toy",
      category: "toy",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "silicone dildo",
    },
  ])[0]!;
  const cuffs = normalizeSessionInventory([
    {
      id: "cuffs-1",
      label: "Leather Cuffs",
      category: "accessory",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "wrist restraints",
    },
  ])[0]!;

  assert.equal(
    assessInventoryTaskCompatibility(dildo, "posture_hold", "make it a posture task").compatible,
    false,
  );
  assert.equal(
    assessInventoryTaskCompatibility(cuffs, "posture_hold", "make it a restraint posture task").compatible,
    true,
  );
});

test("session inventory suppresses fallback lookup when local metadata is already clear", () => {
  const item = normalizeSessionInventory([
    {
      id: "cuffs-1",
      label: "Leather Cuffs",
      category: "accessory",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "wrist restraints",
    },
  ])[0]!;

  const decision = decideInventoryGroundingLookup(item);

  assert.equal(decision.shouldUseFallbackLookup, false);
  assert.equal(decision.source, "local_metadata");
  assert.equal(decision.confidence, "high");
});

test("session inventory uses fallback grounding only when local item understanding is weak", () => {
  const item = normalizeSessionInventory([
    {
      id: "aneros-1",
      label: "Aneros Helix",
      category: "toy",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "",
    },
  ])[0]!;

  const decision = decideInventoryGroundingLookup(item);
  const resolved = resolveInventoryGrounding(item);

  assert.equal(decision.shouldUseFallbackLookup, true);
  assert.equal(decision.source, "fallback_catalog");
  assert.equal(decision.confidence, "medium");
  assert.equal(resolved.semantics.isInsertableToy, true);
  assert.deepEqual(resolved.allowedUseModes, ["anal", "prop"]);
  assert.match(
    buildInventoryClarificationQuestion(item),
    /anal or prop/i,
  );
});

test("session inventory display name uses descriptive notes for generic labels", () => {
  const items = normalizeSessionInventory([
    {
      id: "toy-1",
      label: "Toy",
      category: "other",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "steel chastity cage",
    },
    {
      id: "dress-1",
      label: "Black Dress",
      category: "clothing",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "",
    },
  ]);

  assert.equal(getSessionInventoryDisplayName(items[0]), "steel chastity cage");
  assert.equal(getSessionInventoryDisplayName(items[1]), "Black Dress");
});

test("session inventory saves and reloads through the shared local storage helpers", () => {
  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  saveSessionInventoryToStorage(fakeStorage, [
    {
      id: "cage-1",
      label: "Steel Cage",
      category: "device",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "metal",
    },
  ]);

  const loaded = loadSessionInventoryFromStorage(fakeStorage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.label, "Steel Cage");
  assert.equal(loaded[0]?.notes, "metal");
});
