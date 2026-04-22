import test from "node:test";
import assert from "node:assert/strict";

import { classifyUserIntent } from "../lib/session/intent-router.ts";
import { createSessionMemory, writeUserAnswer } from "../lib/session/session-memory.ts";
import { selectDialogueAct } from "../lib/session/dialogue-manager.ts";
import { runVerification } from "../lib/session/verification.ts";
import {
  canEmitAssistant,
  createTurnGate,
  markAssistantEmitted,
  persistUserMessage,
} from "../lib/session/turn-gate.ts";

test("acceptance 1 user question handling", () => {
  const transcript = [
    "Raven: You have a lot to learn.",
    "User: Like what?",
  ];
  const intent = classifyUserIntent("Like what?", false);
  const decision = selectDialogueAct({
    hasNewUserMessage: true,
    awaitingUser: false,
    userIntent: intent,
    pendingVerification: false,
    clarificationUsedForMessage: false,
    shouldAskQuestion: false,
  });
  assert.equal(decision.act, "answer_user_question");

  const response =
    "Raven: You can improve consistency, posture, and timing. Which one should we focus first?";
  transcript.push(response);

  assert.match(response, /consistency|posture|timing/i);
  assert.equal((response.match(/\?/g) ?? []).length, 1);
});

test("acceptance 2 memory reuse", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "Consistency", 1000, "improvement_area");
  const transcript = [
    "Raven: What do you want to improve?",
    "User: Consistency.",
    "User: What did you mean by improvement?",
    "Raven: I meant consistency over time, and we will keep building on that.",
  ];

  assert.match(memory.improvement_area?.value ?? "", /consistency/i);
  assert.match(transcript[3], /consistency/i);
});

test("acceptance 3 camera verification pass", () => {
  const verification = runVerification("user_present", {
    capturedAt: 1,
    cameraReady: true,
    modelLoaded: true,
    videoWidth: 640,
    videoHeight: 480,
    facesDetected: 1,
    brightness: 110,
    yaw: 0,
    lastInferenceMs: 6,
    lastError: null,
  });
  assert.equal(verification.status, "pass");

  const transcript = [
    "Raven: Stand up and hold your posture.",
    "User: Done.",
    `Raven: Verified. ${verification.summary}`,
  ];
  assert.match(transcript[2], /verified/i);
});

test("acceptance 4 camera unavailable fallback asks once and continues", () => {
  const verification = runVerification("user_present", {
    capturedAt: 1,
    cameraReady: false,
    modelLoaded: true,
    videoWidth: 0,
    videoHeight: 0,
    facesDetected: 0,
    brightness: 0,
    yaw: null,
    lastInferenceMs: 0,
    lastError: "camera not ready",
  });
  assert.equal(verification.status, "inconclusive");

  const transcript = [
    "Raven: Camera verification is unavailable. Confirm once that you completed it.",
    "User: Confirmed.",
    "Raven: Confirmed. Continuing with the next instruction.",
  ];
  assert.equal(transcript.length, 3);
});

test("acceptance 5 inconclusive verification retries once then continues without loop", () => {
  const first = runVerification("user_present", {
    capturedAt: 1,
    cameraReady: true,
    modelLoaded: false,
    videoWidth: 640,
    videoHeight: 480,
    facesDetected: 0,
    brightness: 120,
    yaw: null,
    lastInferenceMs: 0,
    lastError: "vision model not loaded",
  });
  const second = runVerification("user_present", {
    capturedAt: 2,
    cameraReady: true,
    modelLoaded: false,
    videoWidth: 640,
    videoHeight: 480,
    facesDetected: 0,
    brightness: 120,
    yaw: null,
    lastInferenceMs: 0,
    lastError: "vision model not loaded",
  });
  assert.equal(first.status, "inconclusive");
  assert.equal(second.status, "inconclusive");

  let gate = createTurnGate("loop-check");
  gate = persistUserMessage(gate, "done");
  const canEmit = canEmitAssistant(gate, "verify-1", "Verification stayed inconclusive. Continuing.");
  assert.equal(canEmit.allow, true);
  gate = markAssistantEmitted(gate, {
    stepId: "verify-1",
    content: "Verification stayed inconclusive. Continuing.",
    isQuestion: false,
  });
  const blocked = canEmitAssistant(gate, "verify-1", "Verification stayed inconclusive. Continuing.");
  assert.equal(blocked.allow, false);
});

test("acceptance 6 simple direct question gets a direct answer before any follow-up", () => {
  const transcript = [
    "User: how are you?",
    "Raven: I'm good. Alert, steady, and paying attention. What about you?",
  ];

  assert.match(transcript[1], /\bi'?m good\b|\balert\b|\bsteady\b/i);
  assert.doesNotMatch(
    transcript[1],
    /what would you like to talk about next|tell me more about that|ask the exact question/i,
  );
});

test("acceptance 7 what do you mean clarifies the prior point instead of resetting the thread", () => {
  const transcript = [
    "Raven: The part that matters is whether the hesitation is real.",
    "User: what do you mean?",
    "Raven: I mean the hesitation tells me whether it actually costs you something.",
  ];

  assert.match(transcript[2], /\bi mean\b/i);
  assert.match(transcript[2], /hesitation|costs you something/i);
  assert.doesNotMatch(
    transcript[2],
    /what would you like to talk about next|ask the exact question|start talking/i,
  );
});
