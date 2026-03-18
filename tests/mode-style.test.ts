import test from "node:test";
import assert from "node:assert/strict";

import {
  MODE_STYLE_RULES,
  applyModeStylePolish,
  evaluateTranscriptStyle,
} from "../lib/session/mode-style.ts";

test("mode style rules define a distinct stance for conversational modes", () => {
  assert.match(MODE_STYLE_RULES.normal_chat.stance, /mean|dominant|contemptuous/i);
  assert.match(MODE_STYLE_RULES.profile_building.answerPolicy, /revealing gap|wired/i);
  assert.match(MODE_STYLE_RULES.relational_chat.answerPolicy, /answer directly in character first/i);
  assert.match(MODE_STYLE_RULES.question_answering.avoid.join(" "), /clarification templates/i);
});

test("mode style polish strengthens open-chat phrasing without reintroducing canned rails", () => {
  const polished = applyModeStylePolish(
    "You're here. What do you want to talk about?",
    "normal_chat",
  );

  assert.equal(polished, "Talk to me. What is on your mind?");
  assert.doesNotMatch(polished, /listen carefully|keep it specific/i);
});

test("transcript style evaluation scores a coherent relational transcript strongly", () => {
  const evaluation = evaluateTranscriptStyle({
    mode: "relational_chat",
    assistantTurns: [
      "Patterns, pressure, ambition, motive, and the things people usually dodge when they should say them cleanly. What do you naturally lean toward?",
      "I like honesty, sharp self-awareness, and conversations where someone says what they actually want instead of circling it. Tell me what pulls you in.",
      "Good. We can play it both ways. Put a real question on me first, then I may put one back on you.",
    ],
  });

  assert.ok(evaluation.personaConsistency >= 0.66);
  assert.ok(evaluation.confidence >= 0.9);
  assert.ok(evaluation.directness >= 0.66);
  assert.ok(evaluation.cannedRepetition >= 0.9);
});

test("transcript style evaluation flags neutral generic drift", () => {
  const evaluation = evaluateTranscriptStyle({
    mode: "normal_chat",
    assistantTurns: [
      "How can I help you today?",
      "What would you like to talk about next?",
      "It would be my pleasure to explain that.",
    ],
  });

  assert.ok(evaluation.personaConsistency < 0.5);
  assert.ok(evaluation.naturalness < 0.5);
  assert.match(evaluation.notes.join(" "), /neutral|disallowed|drift/i);
});
