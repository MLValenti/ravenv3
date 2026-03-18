import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVerificationManualConfirmationPrompt,
  buildVerificationManualConfirmationReply,
  buildVerificationOutcomeReply,
} from "../lib/session/verification-scaffolds.ts";
import type { VerificationResult } from "../lib/session/verification.ts";

function createResult(
  overrides: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    checkType: "presence",
    status: "pass",
    confidence: 0.9,
    summary: "User detected in frame.",
    raw: {},
    ...overrides,
  };
}

test("verification scaffold returns direct pass reflection", () => {
  const reply = buildVerificationOutcomeReply(
    createResult(),
    "Stand still and face me.",
  );

  assert.equal(reply.kind, "reflect");
  assert.match(reply.text, /I have you in frame/i);
  assert.match(reply.text, /User detected in frame/i);
});

test("verification scaffold returns corrective fail prompt", () => {
  const reply = buildVerificationOutcomeReply(
    createResult({
      checkType: "head_turn",
      status: "fail",
      confidence: 0.2,
      summary: "Left turn was not clear enough.",
    }),
    "Turn your head left, then right.",
  );

  assert.equal(reply.kind, "ask");
  assert.equal(reply.slotKey, "improvement_area");
  assert.match(reply.text, /turn was not clean enough/i);
  assert.match(reply.text, /turn your head clearly left, return to center, then turn right/i);
});

test("verification scaffold uses object-specific wording", () => {
  const reply = buildVerificationOutcomeReply(
    createResult({
      checkType: "object_present",
      status: "fail",
      confidence: 0.25,
      summary: "Target object was not detected in the stable set.",
    }),
    "Show me the device.",
  );

  assert.equal(reply.kind, "ask");
  assert.match(reply.text, /cannot verify the object yet/i);
  assert.match(reply.text, /show it clearly to the camera/i);
});

test("verification scaffold uses framing-specific wording for inconclusive results", () => {
  const reply = buildVerificationOutcomeReply(
    createResult({
      checkType: "centered_in_frame",
      status: "inconclusive",
      confidence: 0.52,
      summary: "Face center drifted near the allowed threshold.",
    }),
    "Center yourself and hold still.",
  );

  assert.equal(reply.kind, "reflect");
  assert.match(reply.text, /do not have a stable frame yet/i);
  assert.match(reply.text, /Face center drifted/i);
});

test("verification scaffold returns manual confirmation prompt and reply", () => {
  const prompt = buildVerificationManualConfirmationPrompt();
  const reply = buildVerificationManualConfirmationReply();

  assert.equal(prompt.kind, "ask");
  assert.equal(prompt.slotKey, "constraints");
  assert.match(prompt.text, /Confirm once/i);

  assert.equal(reply.kind, "reflect");
  assert.match(reply.text, /take your word once/i);
});
