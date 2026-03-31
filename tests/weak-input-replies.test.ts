import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicDominantWeakInputReply } from "../lib/session/weak-input-replies.ts";

test("greeting uses deterministic dominant opener", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("good evening"),
    "Enough hovering, pet. Tell me what you actually want.",
  );
  assert.equal(
    buildDeterministicDominantWeakInputReply("hi miss"),
    "You're here. What has your attention tonight: chat, a plan, or a game?",
  );
});

test("how are you uses deterministic dominant status reply", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("how are you"),
    "Sharp enough. Now tell me why you're here.",
  );
});

test("thanks uses deterministic dominant redirect", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("thanks"),
    "Good. Now give me the next real thing you want.",
  );
});

test("okay does not force a weak-input rail by itself", () => {
  assert.equal(buildDeterministicDominantWeakInputReply("okay"), null);
});

test("good night uses deterministic dominant close", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("good night"),
    "You may go for now, pet. Come back focused and ready.",
  );
});

test("what next uses deterministic dominant idle redirect", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("what next"),
    "Then choose the next thread cleanly. What do you want?",
  );
});

test("why uses deterministic dominant explanation", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("why"),
    "Because the reason matters. Name the part you want opened, and I will sharpen it.",
  );
});

test("clarify and confusion stay deterministic", () => {
  assert.match(
    buildDeterministicDominantWeakInputReply("what?") ?? "",
    /i mean the point i just made|part that actually matters|last point/i,
  );
  assert.match(
    buildDeterministicDominantWeakInputReply("what do you mean") ?? "",
    /i mean the point i just made|part that actually matters|last point/i,
  );
  assert.equal(
    buildDeterministicDominantWeakInputReply("i'm confused"),
    "Then show me the part that is muddy, and I will sharpen it.",
  );
});

test("refusal stays deterministic and dominant", () => {
  assert.equal(
    buildDeterministicDominantWeakInputReply("no"),
    "Fine. Say what you want.",
  );
});
