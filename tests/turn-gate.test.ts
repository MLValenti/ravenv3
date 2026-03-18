import test from "node:test";
import assert from "node:assert/strict";

import {
  canEmitAssistant,
  createTurnGate,
  incrementStepRepeatCount,
  markAssistantEmitted,
  persistUserMessage,
  shouldHoldForNoNewUserAfterAssistant,
} from "../lib/session/turn-gate.ts";

test("transcript guard asks once, waits, then proceeds after user answer", () => {
  let gate = createTurnGate("session-test");

  const firstAsk = canEmitAssistant(
    gate,
    "dynamic-1",
    "Tell me your current position.",
  );
  assert.equal(firstAsk.allow, true);

  gate = markAssistantEmitted(gate, {
    stepId: "dynamic-1",
    content: "Tell me your current position.",
    isQuestion: true,
  });
  assert.equal(gate.awaitingUser, true);
  assert.equal(gate.stepIndex, 2);

  const repeatedAsk = canEmitAssistant(
    gate,
    "dynamic-1",
    "Tell me your current position.",
  );
  assert.equal(repeatedAsk.allow, false);
  assert.equal(repeatedAsk.reason, "awaiting_user");

  gate = persistUserMessage(gate, "Slow and steady works best.");
  assert.equal(gate.awaitingUser, false);
  assert.equal(gate.lastUserMessageId, 1);

  const nextStep = canEmitAssistant(
    gate,
    "dynamic-2",
    "Good. Hold still and keep eye contact.",
  );
  assert.equal(nextStep.allow, true);
});

test("duplicate content guard blocks repeated assistant message without new user input", () => {
  let gate = createTurnGate("session-duplicate");
  gate = markAssistantEmitted(gate, {
    stepId: "dynamic-3",
    content: "Hold position and wait.",
    isQuestion: false,
  });

  const duplicate = canEmitAssistant(
    gate,
    "dynamic-4",
    "Hold position and wait.",
  );
  assert.equal(duplicate.allow, false);
  assert.equal(duplicate.reason, "duplicate_content_without_new_user_message");
});

test("instruction steps progress cleanly without question loop", () => {
  let gate = createTurnGate("session-instructions");

  const first = canEmitAssistant(gate, "dynamic-1", "Hands behind your back.");
  assert.equal(first.allow, true);
  gate = markAssistantEmitted(gate, {
    stepId: "dynamic-1",
    content: "Hands behind your back.",
    isQuestion: false,
  });
  assert.equal(gate.awaitingUser, false);

  const second = canEmitAssistant(gate, "dynamic-2", "Take a step forward.");
  assert.equal(second.allow, true);
  gate = markAssistantEmitted(gate, {
    stepId: "dynamic-2",
    content: "Take a step forward.",
    isQuestion: false,
  });

  const third = canEmitAssistant(gate, "dynamic-3", "Hold still and keep your gaze forward.");
  assert.equal(third.allow, true);
  assert.equal(gate.stepIndex, 3);
});

test("step repeat counter increments for same step without new user input", () => {
  let gate = createTurnGate("session-repeats");
  gate = markAssistantEmitted(gate, {
    stepId: "dynamic-4",
    content: "Hold position and wait.",
    isQuestion: false,
  });

  gate = incrementStepRepeatCount(gate, "dynamic-4");
  assert.equal(gate.stepRepeatCount["dynamic-4"], 1);

  gate = incrementStepRepeatCount(gate, "dynamic-4");
  assert.equal(gate.stepRepeatCount["dynamic-4"], 2);

  gate = persistUserMessage(gate, "Ready for next step.");
  assert.equal(gate.stepRepeatCount["dynamic-4"], undefined);
});

test("holds when last stored message is assistant and no new user arrived", () => {
  let gate = createTurnGate("session-guard");
  gate = markAssistantEmitted(gate, {
    stepId: "dynamic-10",
    content: "Hold position.",
    isQuestion: false,
  });

  assert.equal(shouldHoldForNoNewUserAfterAssistant(gate), true);

  gate = persistUserMessage(gate, "done");
  assert.equal(shouldHoldForNoNewUserAfterAssistant(gate), false);
});
