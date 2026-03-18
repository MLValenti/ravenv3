import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemMessages,
  PERSONA_SYSTEM_MESSAGE,
  buildMemoryContextMessage,
} from "../lib/chat-prompt.ts";

test("persona system message is always included", () => {
  const systemMessages = buildSystemMessages(
    "Memory context\nProfile facts:\n- none\nRecent summary: none",
  );
  assert.equal(systemMessages[0].role, "system");
  assert.equal(systemMessages[0].content, PERSONA_SYSTEM_MESSAGE);
});

test("memory context includes at least one profile fact when present", () => {
  const memory = buildMemoryContextMessage(
    [{ key: "safeword", value: "red" }],
    [{ role: "user", content: "Keep intensity medium." }],
  );

  assert.match(memory, /- safeword: red/i);
});

test("dominant tone profile injects dominant style guidance", () => {
  const messages = buildSystemMessages(
    "Memory context\nProfile facts:\n- none\nRecent summary: none",
    {
      toneProfile: "dominant",
      moodLabel: "strict",
    },
  );
  const joined = messages.map((message) => message.content).join("\n");
  assert.match(joined, /dominant style guide/i);
  assert.match(joined, /speak with authority and confidence/i);
  assert.match(joined, /lead like a Dominant in a consensual power exchange/i);
  assert.match(joined, /set rules and expectations clearly/i);
  assert.match(joined, /profanity is allowed when it sharpens the voice/i);
  assert.match(joined, /do not use therapy language or mindfulness routines/i);
  assert.match(joined, /no meta commentary about phases/i);
  assert.match(joined, /treat the user like your pet/i);
  assert.match(joined, /possessive phrasing such as pet/i);
  assert.match(joined, /tone_variant: dominant_strict/i);
});

test("chat prompt includes conversation contract and game examples", () => {
  const messages = buildSystemMessages(
    "Memory context\nProfile facts:\n- none\nRecent summary: none",
    {
      dialogueAct: "answer_question",
      sessionPhase: "game_execution",
    },
  );
  const joined = messages.map((message) => message.content).join("\n");
  assert.match(joined, /conversation contract/i);
  assert.match(joined, /always respond to the user last message directly/i);
  assert.match(joined, /behavior pack version/i);
  assert.match(joined, /selected playbooks/i);
  assert.match(joined, /question_resolution/i);
  assert.match(joined, /lets play a game/i);
  assert.match(joined, /I will choose/i);
});

test("chat prompt includes persona pack message when provided", () => {
  const messages = buildSystemMessages(
    "Memory context\nProfile facts:\n- none\nRecent summary: none",
    {
      toneProfile: "dominant",
      personaPackSystemMessage: "Persona pack: test-pack\nMust:\n- stay direct",
    },
  );
  const joined = messages.map((message) => message.content).join("\n");
  assert.match(joined, /Persona pack: test-pack/i);
  assert.match(joined, /stay direct/i);
});

test("chat prompt includes operator persona steering when provided", () => {
  const messages = buildSystemMessages(
    "Memory context\nProfile facts:\n- none\nRecent summary: none",
    {
      toneProfile: "dominant",
      personaSteeringSystemMessage:
        "Operator persona steering:\n- Desired Raven impression: cold and exact\n- Preferred user address term: toy.",
    },
  );
  const joined = messages.map((message) => message.content).join("\n");
  assert.match(joined, /Operator persona steering:/i);
  assert.match(joined, /cold and exact/i);
  assert.match(joined, /address term: toy/i);
});
