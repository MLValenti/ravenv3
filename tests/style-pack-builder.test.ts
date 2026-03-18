import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPersonaStylePackFromTexts,
  pickPersonaExamples,
  splitSourceSentences,
} from "../lib/persona/style-pack-builder.ts";

test("style pack builder prefers direct voice lines over narration", () => {
  const sentences = splitSourceSentences(
    [
      "I walked across the room and looked at the camera.",
      "'Eyes on me, pet,' she said.",
      "'Stand still and answer properly,' she ordered.",
      "The hotel room was quiet.",
    ].join(" "),
  );

  const examples = pickPersonaExamples(sentences);
  assert.ok(examples.length > 0);
  assert.match(examples[0]!, /eyes on me|stand still/i);
  assert.doesNotMatch(examples[0]!, /hotel room|walked across the room/i);
});

test("style pack builder produces normalized packs from source texts", () => {
  const pack = buildPersonaStylePackFromTexts({
    id: "custom",
    name: "Custom Raven",
    texts: [
      "'Eyes on me, pet.' 'Stand still and answer properly.' 'Good. Keep focus and report cleanly.'",
    ],
  });

  assert.equal(pack.id, "custom");
  assert.equal(pack.name, "Custom Raven");
  assert.ok(pack.examples.length > 0);
  assert.match(pack.examples.join("\n"), /eyes on me|stand still|keep focus/i);
});
