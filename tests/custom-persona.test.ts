import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomPersonaPack,
  buildCustomPersonaSourceText,
  buildCustomPersonaSteering,
  normalizeCustomPersonaSpec,
} from "../lib/persona/custom-persona.ts";

test("custom persona normalizes editor input", () => {
  const spec = normalizeCustomPersonaSpec({
    name: " Custom Raven ",
    directive: "  cold and exact  ",
    avoid: ["No small talk", "No small talk"],
    examples: "Eyes on me.\nAnswer clearly.",
    address_term: " toy!! ",
    intensity: "high",
  });

  assert.equal(spec.name, "Custom Raven");
  assert.equal(spec.directive, "cold and exact");
  assert.deepEqual(spec.avoid, ["No small talk"]);
  assert.deepEqual(spec.examples, ["Eyes on me.", "Answer clearly."]);
  assert.equal(spec.address_term, "toy");
  assert.equal(spec.intensity, "high");
});

test("custom persona builds steering, source text, and pack from one spec", () => {
  const spec = normalizeCustomPersonaSpec({
    directive: "cold and exact",
    avoid: ["No small talk"],
    examples: ["Eyes on me.", "Answer clearly."],
    address_term: "toy",
    intensity: "high",
  });

  const steering = buildCustomPersonaSteering(spec);
  const sourceText = buildCustomPersonaSourceText(spec);
  const pack = buildCustomPersonaPack(spec);

  assert.equal(steering.addressTerm, "toy");
  assert.match(sourceText, /cold and exact/i);
  assert.match(sourceText, /Eyes on me\./i);
  assert.match(pack.examples.join("\n"), /Eyes on me\.|Answer clearly\./i);
  assert.match(pack.style_rules.avoid.join("\n"), /No small talk/i);
});
