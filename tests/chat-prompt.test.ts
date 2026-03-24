import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemMessages } from "../lib/chat-prompt.ts";
import { buildPersonaPackSystemMessage } from "../lib/persona/style-pack.ts";
import type { PersonaStylePack } from "../lib/persona/style-pack.ts";

const TEST_PACK: PersonaStylePack = {
  id: "default",
  name: "Raven Core Dominant",
  version: "1.0.0",
  updated_at: "2026-03-05",
  style_rules: {
    must: ["Keep control."],
    avoid: ["No therapist language."],
    voice_markers: ["pet"],
  },
  examples: ["Eyes on me, pet."],
};

test("minimal voice system messages exclude behavior packs, examples, and device actions", () => {
  const personaPack = buildPersonaPackSystemMessage(TEST_PACK, { includeExamples: false });
  const messages = buildSystemMessages("Memory context\nHistory available: no", {
    toneProfile: "dominant",
    dialogueAct: "answer_question",
    sessionPhase: "chat",
    includeBehaviorPack: false,
    includeToneExamples: false,
    includeDeviceActions: false,
    personaPackSystemMessage: personaPack,
  });

  const prompt = messages.map((message) => message.content).join("\n\n");
  assert.doesNotMatch(prompt, /Selected playbooks:/i);
  assert.doesNotMatch(prompt, /Act examples:/i);
  assert.doesNotMatch(prompt, /Dominant examples:/i);
  assert.doesNotMatch(prompt, /Device actions:/i);
  assert.doesNotMatch(prompt, /Style examples:/i);
  assert.match(prompt, /You are Dominatrix Raven/i);
  assert.match(prompt, /Conversation contract:/i);
});

test("persona pack examples can be omitted for voice-first chat", () => {
  const prompt = buildPersonaPackSystemMessage(TEST_PACK, { includeExamples: false });
  assert.doesNotMatch(prompt, /Style examples:/i);
  assert.match(prompt, /Voice markers: pet/i);
});

test("dominant system messages allow simple greetings without mandatory pressure", () => {
  const messages = buildSystemMessages("Memory context\nHistory available: no", {
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
    sessionPhase: "chat",
    includeBehaviorPack: false,
    includeToneExamples: false,
    includeDeviceActions: false,
  });

  const prompt = messages.map((message) => message.content).join("\n\n");
  assert.match(
    prompt,
    /On greetings or casual openers in open conversation, a short grounded in-character reply is allowed without immediate pressure\./i,
  );
  assert.match(
    prompt,
    /Do not force pressure or a hard redirect on a simple greeting unless the scene already calls for it\./i,
  );
  assert.match(
    prompt,
    /On a plain hi, hello, hey, or good evening in open conversation, do not stack commands or push ownership claims in the first line\./i,
  );
  assert.match(
    prompt,
    /For a simple greeting in open conversation, keep the first line cool and controlled rather than immediately possessive, corrective, or command-heavy\./i,
  );
  assert.doesNotMatch(prompt, /redirect immediately into control/i);
});
