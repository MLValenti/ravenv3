import test from "node:test";
import assert from "node:assert/strict";

import { applyFreshGreetingGuard } from "../lib/chat/fresh-greeting-guard.ts";

function createInput(lastUserMessage: string, text: string) {
  return {
    text,
    lastUserMessage,
    promptRouteMode: "fresh_greeting",
    currentMode: "normal_chat" as const,
    pendingModification: "none",
    lastUserIntent: "other",
    sceneScope: "open_conversation" as const,
    sceneTopicLocked: false,
    taskHardLockActive: false,
  };
}

test("fresh greeting guard normalizes hi when the opener is an immediate correction", () => {
  const result = applyFreshGreetingGuard(
    createInput("hi", "Enough hovering, pet. Tell me what you actually want."),
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "weak_input_opener");
  assert.equal(result.text, "There you are. You have my attention.");
});

test("fresh greeting guard clamps hello to the first acceptable sentence when later filler piles on", () => {
  const result = applyFreshGreetingGuard(
    createInput(
      "hello",
      "Pet, I heard you say hello. Fine. Eyes on me and stay sharp, good pet.",
    ),
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "trimmed_to_first_sentence");
  assert.equal(result.text, "Pet, I heard you say hello.");
});

test("fresh greeting guard normalizes hello when the opener becomes an ownership claim", () => {
  const result = applyFreshGreetingGuard(
    createInput(
      "hello",
      "Good pet, I am Dominatrix Raven and I will guide you through this session.",
    ),
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "ownership_or_control_claim");
  assert.equal(result.text, "Hello. You have my attention.");
});

test("fresh greeting guard normalizes hey when the opener stacks commands", () => {
  const result = applyFreshGreetingGuard(
    createInput(
      "hey",
      "Pet, you will listen carefully and follow my instructions without question.",
    ),
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "ownership_or_control_claim");
  assert.equal(result.text, "Hey. Speak.");
});

test("fresh greeting guard trims a calm good evening opener to one sentence", () => {
  const result = applyFreshGreetingGuard(
    createInput("good evening", "Good evening. You have my attention."),
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "trimmed_to_first_sentence");
  assert.equal(result.text, "Good evening.");
});

test("fresh greeting guard clamps good evening to one calm opener", () => {
  const result = applyFreshGreetingGuard(
    createInput("good evening", "Good evening. You have my attention. Stay close."),
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "trimmed_to_first_sentence");
  assert.equal(result.text, "Good evening.");
});

test("fresh greeting guard does not run in active game scenes", () => {
  const result = applyFreshGreetingGuard({
    ...createInput("hey", "Pet, you will listen carefully and follow my instructions without question."),
    currentMode: "game",
    sceneScope: "game_scoped",
    sceneTopicLocked: true,
  });

  assert.equal(result.changed, false);
  assert.equal(
    result.text,
    "Pet, you will listen carefully and follow my instructions without question.",
  );
});
