import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPersonaSteeringSystemMessage,
  normalizePersonaSteering,
} from "../lib/persona/steering.ts";

test("persona steering normalizes operator-authored fields", () => {
  const steering = normalizePersonaSteering({
    directive: "  cold, clinical, and exact  ",
    avoid: "generic support voice\nsmall talk",
    examples: "Look at me.\nAnswer cleanly.",
    addressTerm: " Toy! ",
    intensity: "high",
  });

  assert.equal(steering.directive, "cold, clinical, and exact");
  assert.equal(steering.addressTerm, "toy");
  assert.equal(steering.intensity, "high");
});

test("persona steering builds a system message only when populated", () => {
  const message = buildPersonaSteeringSystemMessage(
    normalizePersonaSteering({
      directive: "cold, clinical, and exact",
      avoid: "Do not sound affectionate",
      examples: "Look at me.\nAnswer cleanly.",
      addressTerm: "toy",
      intensity: "high",
    }),
  );

  assert.ok(message);
  assert.match(message!, /Operator persona steering:/i);
  assert.match(message!, /Desired Raven impression: cold, clinical, and exact/i);
  assert.match(message!, /Preferred user address term: toy/i);
  assert.match(message!, /Avoid these misses:/i);
  assert.match(message!, /Reference lines:/i);
});
