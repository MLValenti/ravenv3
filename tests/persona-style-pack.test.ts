import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPersonaPackSystemMessage,
  normalizePersonaStylePack,
} from "../lib/persona/style-pack.ts";

test("persona style pack normalizes valid content", () => {
  const pack = normalizePersonaStylePack({
    id: "test-pack",
    name: "Test Pack",
    version: "1.0.0",
    updated_at: "2026-03-05",
    style_rules: {
      must: ["Stay direct", "Stay direct"],
      avoid: ["No meta"],
      voice_markers: ["pet", "focus"],
    },
    examples: ["Eyes on me, pet.", "Stay focused."],
  });

  assert.ok(pack);
  assert.equal(pack?.id, "test-pack");
  assert.deepEqual(pack?.style_rules.must, ["Stay direct"]);
  assert.deepEqual(pack?.style_rules.voice_markers, ["pet", "focus"]);
});

test("persona style pack system message includes rules and examples", () => {
  const pack = normalizePersonaStylePack({
    id: "test-pack",
    name: "Test Pack",
    version: "1.0.0",
    updated_at: "2026-03-05",
    style_rules: {
      must: ["Acknowledge first"],
      avoid: ["No meta"],
      voice_markers: ["pet"],
    },
    examples: ["Eyes on me, pet."],
  });
  assert.ok(pack);
  const message = buildPersonaPackSystemMessage(pack!);
  assert.match(message, /Persona pack: Test Pack/i);
  assert.match(message, /Must:/i);
  assert.match(message, /Acknowledge first/i);
  assert.match(message, /No meta/i);
  assert.match(message, /Eyes on me, pet/i);
});

