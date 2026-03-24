import test from "node:test";
import assert from "node:assert/strict";

import { createSessionMemory } from "../lib/session/session-memory.ts";
import { finalizeTurnResponse } from "../lib/session/turn-response.ts";

test("fallback-selected turn does not append reflection or mix response families", () => {
  const result = finalizeTurnResponse({
    text: "Good. Tell me what that actually means to you.",
    userText: "I want to be trained",
    nextTurnId: 5,
    phase: "build",
    memory: createSessionMemory(),
    interactionMode: "normal_chat",
    selectedFamily: "model",
    availableFamilies: ["model", "deterministic_scene"],
    responseGateForced: true,
  });

  assert.equal(
    result.text,
    "Good. Tell me what that actually means to you.",
  );
  assert.equal(result.finalOutputSource, "response_gate_fallback");
  assert.equal(result.reflectionAppended, false);
  assert.equal(result.multipleGeneratorsFired, true);
});

test("open-chat model turn does not append task-style reflection", () => {
  const result = finalizeTurnResponse({
    text: "You're here. What do you want to talk about?",
    userText: "hi",
    nextTurnId: 5,
    phase: "build",
    memory: createSessionMemory(),
    interactionMode: "normal_chat",
    selectedFamily: "model",
    availableFamilies: ["model"],
    responseGateForced: false,
  });

  assert.equal(result.text, "Enough hovering, pet. Tell me what you actually want.");
  assert.equal(result.finalOutputSource, "model");
  assert.equal(result.reflectionAppended, false);
});

test("locked task turn can still append reflection from the selected family only", () => {
  const result = finalizeTurnResponse({
    text: "Start now. Put it on now and reply done once it is secure.",
    userText: "done",
    nextTurnId: 5,
    phase: "build",
    memory: createSessionMemory(),
    interactionMode: "locked_task_execution",
    selectedFamily: "deterministic_task",
    availableFamilies: ["deterministic_task"],
    responseGateForced: false,
  });

  assert.match(result.text, /start now/i);
  assert.match(result.text, /keep steady pressure on the current goal/i);
  assert.equal(result.finalOutputSource, "deterministic_task");
  assert.equal(result.reflectionAppended, true);
});

test("profile-building finalization keeps at most one question in a turn", () => {
  const result = finalizeTurnResponse({
    text: "Good. I have that. What should I call you? What do you enjoy doing most? What should I know about your boundaries?",
    userText: "I want you to get to know me better",
    nextTurnId: 5,
    phase: "build",
    memory: createSessionMemory(),
    interactionMode: "profile_building",
    selectedFamily: "deterministic_scene",
    availableFamilies: ["deterministic_scene"],
    responseGateForced: false,
  });

  assert.equal((result.text.match(/[?]/g) ?? []).length, 1);
  assert.match(result.text, /good\. that tells me where to press\.|good\. i have that\./i);
  assert.match(result.text, /what should i call you/i);
  assert.doesNotMatch(result.text, /what do you enjoy doing most/i);
});

test("normal chat finalization strips canned control lead-ins", () => {
  const result = finalizeTurnResponse({
    text: "Listen carefully, pet. Ask the exact question you want answered, and I will answer it plainly.",
    userText: "what is aftercare",
    nextTurnId: 6,
    phase: "build",
    memory: createSessionMemory(),
    interactionMode: "normal_chat",
    selectedFamily: "scene_fallback",
    availableFamilies: ["scene_fallback"],
    responseGateForced: false,
  });

  assert.doesNotMatch(result.text, /listen carefully|ask the exact question/i);
});

test("short clarification finalization keeps one winning clarification family", () => {
  const result = finalizeTurnResponse({
    text: "Name the part that lost you, and I will strip it down. We can break it down properly. Do you want the first move, the pacing, or the end point first? My little pet returns?",
    userText: "what?",
    nextTurnId: 6,
    phase: "build",
    memory: createSessionMemory(),
    interactionMode: "question_answering",
    selectedFamily: "scene_fallback",
    availableFamilies: ["scene_fallback"],
    responseGateForced: false,
    responseMode: "short_follow_up",
  });

  assert.equal(result.finalOutputSource, "scene_fallback");
  assert.equal(result.multipleGeneratorsFired, false);
  assert.doesNotMatch(result.text, /first move|pacing|end point first/i);
  assert.doesNotMatch(result.text, /my little pet returns/i);
  assert.match(result.text, /i mean|point i just made|last point/i);
});
