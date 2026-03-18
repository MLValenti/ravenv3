import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTrainingFollowUpReply,
  buildTrainingRecommendationReply,
  extractTrainingThreadFromAssistantText,
} from "../lib/session/training-thread.ts";
import type { SessionInventoryItem } from "../lib/session/session-inventory.ts";

const INVENTORY: SessionInventoryItem[] = [
  {
    id: "toy-1",
    label: "Toy",
    category: "toy",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "silicone dildo",
  },
  {
    id: "cuffs-1",
    label: "Cuffs",
    category: "accessory",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "leather cuffs",
  },
  {
    id: "cage-1",
    label: "Cage",
    category: "device",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "steel chastity cage",
  },
];

test("training thread extracts structured state from a concrete training answer", () => {
  const thread = extractTrainingThreadFromAssistantText(
    "For anal training, I would start with a slow anal hold with your silicone dildo: settle it, hold the pressure on a timer, ease off cleanly, and repeat without getting sloppy. If you want the other angle, I could also make it paced anal intervals with your silicone dildo: work in, pause, reset, and keep the whole line deliberate instead of greedy.",
  );

  assert.equal(thread?.subject, "anal");
  assert.match(thread?.item_name ?? "", /silicone dildo/i);
  assert.match(thread?.primary_variant ?? "", /slow anal hold/i);
  assert.match(thread?.alternate_variant ?? "", /paced anal intervals/i);
});

test("training follow-up answers how deep from the active anal thread", () => {
  const thread = extractTrainingThreadFromAssistantText(
    "For anal training, I would start with a slow anal hold with your silicone dildo: settle it, hold the pressure on a timer, ease off cleanly, and repeat without getting sloppy. If you want the other angle, I could also make it paced anal intervals with your silicone dildo: work in, pause, reset, and keep the whole line deliberate instead of greedy.",
  );

  const reply = buildTrainingFollowUpReply({
    userText: "how deep?",
    thread,
    inventory: INVENTORY,
  });

  assert.match(reply ?? "", /control first|deep enough|maximum depth/i);
  assert.doesNotMatch(reply ?? "", /keep going|concrete part|what is on your mind/i);
});

test("training follow-up explains rationale and proof from the active thread", () => {
  const thread = extractTrainingThreadFromAssistantText(
    "For bondage training, I would start with a restrained obedience protocol with your Cuffs: hands secured, clean answers, and no adjusting yourself unless I allow it. If you want the other angle, I could also make it a bondage discipline drill with your Cuffs: timed holds, deliberate stillness only when I ask for it, and exact check-ins.",
  );

  const rationale = buildTrainingFollowUpReply({
    userText: "what would that prove?",
    thread,
    inventory: INVENTORY,
  });
  const proof = buildTrainingFollowUpReply({
    userText: "do i need proof?",
    thread,
    inventory: INVENTORY,
  });

  assert.match(rationale ?? "", /changes your behavior|silhouette|obedience/i);
  assert.match(proof ?? "", /midpoint|final report|count/i);
});

test("training follow-up can switch to alternate, stricter, softer, and use-mode answers", () => {
  const thread = extractTrainingThreadFromAssistantText(
    "For throat training, I would start with a paced throat-control drill with your silicone dildo: short controlled dips, a clean reset each time, and no rushing just to impress me. If you want the other angle, I could also make it an oral endurance line with your silicone dildo: steady depth, controlled breathing, and deliberate pauses instead of sloppy bravado.",
  );

  const alternate = buildTrainingFollowUpReply({
    userText: "what else?",
    thread,
    inventory: INVENTORY,
  });
  const stricter = buildTrainingFollowUpReply({
    userText: "make it stricter",
    thread,
    inventory: INVENTORY,
  });
  const softer = buildTrainingFollowUpReply({
    userText: "what if i want it softer",
    thread,
    inventory: INVENTORY,
  });
  const useMode = buildTrainingFollowUpReply({
    userText: "where should it go?",
    thread,
    inventory: INVENTORY,
  });

  assert.match(alternate ?? "", /oral endurance line/i);
  assert.match(stricter ?? "", /stricter|tighter pacing|proof/i);
  assert.match(softer ?? "", /softer|shorter holds|less pressure/i);
  assert.match(useMode ?? "", /oral|breathing|depth/i);
});

test("training recommendation picks a concrete subject from inventory instead of generic be trainable language", () => {
  const reply = buildTrainingRecommendationReply({
    userText: "what training do you think i need?",
    inventory: INVENTORY,
  });

  assert.match(reply ?? "", /anal control|silicone dildo|bondage discipline|chastity discipline|obedience training/i);
  assert.doesNotMatch(reply ?? "", /be trainable/i);
});

test("training follow-up can answer mixed-item compatibility questions from the active thread", () => {
  const thread = extractTrainingThreadFromAssistantText(
    "Given what you are asking for, I would start you with anal control with your silicone dildo: a slow anal hold with your silicone dildo first, not rushing for depth. That gives me patience, control, and something real to read instead of bravado. If you want the other angle, I could also make it paced anal intervals with your silicone dildo.",
  );

  const reply = buildTrainingFollowUpReply({
    userText: "should i wear my cage while doing it?",
    thread,
    inventory: INVENTORY,
  });

  assert.match(reply ?? "", /yes|keep your .*cage on|layered|main focus|denial/i);
  assert.match(reply ?? "", /silicone dildo|toy|insertable/i);
  assert.doesNotMatch(reply ?? "", /talk to me|what is on your mind|keep going/i);
});

test("training follow-up can answer natural mixed-item phrasing without preset inventory", () => {
  const thread = extractTrainingThreadFromAssistantText(
    "Given what you are asking for, I would start you with anal control with your silicone dildo: a slow anal hold with your silicone dildo first, not rushing for depth. That gives me patience, control, and something real to read instead of bravado. If you want the other angle, I could also make it paced anal intervals with your silicone dildo.",
  );

  const reply = buildTrainingFollowUpReply({
    userText: "what if i used the cuffs instead?",
    thread,
    inventory: [],
  });

  assert.match(reply ?? "", /cuffs|restraint|obedience|main line|pressure/i);
  assert.doesNotMatch(reply ?? "", /talk to me|what is on your mind|keep going/i);
});
