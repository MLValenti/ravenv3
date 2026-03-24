import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseDeliveredAssistantText,
  sanitizeSessionVisibleAssistantText,
  shouldAllowVisibleAssistantCommit,
  shouldPreserveQueuedUserTurnOnSessionStart,
  shouldRecoverSkippedAssistantRender,
} from "../lib/session/live-turn-integrity.ts";

test("forced response-gate repairs are preserved instead of degrading to scene fallback", () => {
  const delivered = chooseDeliveredAssistantText({
    responseText:
      "Good. We can play it both ways. Put a real question on me first, then I may put one back on you.",
    sceneFallback: "Keep going. Tell me more about know about me.",
    responseGateForced: true,
    responseGateReason: "dialogue_act_misaligned",
    dialogueAct: "user_question",
    userText: "what do you want to know about me?",
    dialogueAligned: false,
  });

  assert.match(delivered, /play it both ways|question on me first/i);
  assert.doesNotMatch(delivered, /tell me more about know about me/i);
});

test("non-forced misaligned responses still fall back to scene text when needed", () => {
  const delivered = chooseDeliveredAssistantText({
    responseText: "generic unrelated answer",
    sceneFallback: "Then start with what actually holds your attention, and I will stay with that.",
    responseGateForced: false,
    responseGateReason: "accepted",
    dialogueAct: "other",
    userText: "i want to talk",
    dialogueAligned: false,
  });

  assert.match(delivered, /holds your attention/i);
});

test("skipped assistant render is recovered when no reply has been emitted for the turn yet", () => {
  assert.equal(
    shouldRecoverSkippedAssistantRender({
      appendCommitted: false,
      appendReason: "commit_blocked:second_authoritative_reply_same_turn",
      hasRenderableText: true,
      sourceUserMessageId: 12,
      lastAssistantUserMessageId: 11,
      visibleAssistantAlreadyCommitted: false,
    }),
    true,
  );
});

test("skipped assistant render is not recovered when a reply was already emitted for that turn", () => {
  assert.equal(
    shouldRecoverSkippedAssistantRender({
      appendCommitted: false,
      appendReason: "commit_blocked:duplicate_commit_same_request",
      hasRenderableText: true,
      sourceUserMessageId: 12,
      lastAssistantUserMessageId: 12,
      visibleAssistantAlreadyCommitted: true,
    }),
    false,
  );
});

test("visible commit guard blocks later opener fallback after a substantive answer for the same turn", () => {
  const result = shouldAllowVisibleAssistantCommit({
    sourceUserMessageId: 18,
    normalizedText: "there you are. you have my attention.",
    existingVisibleNormalizedText:
      "exactly. usefulness is not a pose. it shows up in honesty, steadiness, and follow through.",
  });

  assert.equal(result.allow, false);
  assert.equal(result.reason, "second_visible_reply_same_turn");
});

test("visible commit guard still allows the first visible reply for a turn", () => {
  const result = shouldAllowVisibleAssistantCommit({
    sourceUserMessageId: 18,
    normalizedText: "exactly. usefulness is not a pose.",
    existingVisibleNormalizedText: null,
  });

  assert.equal(result.allow, true);
  assert.equal(result.reason, "first_visible_commit_for_turn");
});

test("visible commit guard blocks engine recovery duplicates for the same turn", () => {
  const result = shouldAllowVisibleAssistantCommit({
    sourceUserMessageId: 18,
    normalizedText: "you have my attention.",
    existingVisibleNormalizedText: "you have my attention.",
  });

  assert.equal(result.allow, false);
  assert.equal(result.reason, "duplicate_visible_commit_same_turn");
});

test("queued user turn is preserved when session start happens before it is handled", () => {
  assert.equal(
    shouldPreserveQueuedUserTurnOnSessionStart({
      pendingTurnMessageId: 3,
      lastHandledUserMessageId: 2,
    }),
    true,
  );
});

test("session start does not preserve already-handled user turns", () => {
  assert.equal(
    shouldPreserveQueuedUserTurnOnSessionStart({
      pendingTurnMessageId: 3,
      lastHandledUserMessageId: 3,
    }),
    false,
  );
});

test("session visible output scrub removes internal thread labels before display", () => {
  const result = sanitizeSessionVisibleAssistantText(
    "Keep going. Tell me more about open_chat.",
  );

  assert.equal(result.changed, true);
  assert.equal(result.blocked, false);
  assert.equal(result.text, "Keep going.");
  assert.doesNotMatch(result.text, /open_chat/i);
});

test("session visible output scrub preserves normal coherent replies", () => {
  const result = sanitizeSessionVisibleAssistantText(
    "There you are. You have my attention.",
  );

  assert.equal(result.changed, false);
  assert.equal(result.blocked, false);
  assert.equal(result.text, "There you are. You have my attention.");
});

test("session visible output scrub keeps coherent natural text after removing prompt echo", () => {
  const result = sanitizeSessionVisibleAssistantText(
    "You have my attention. Response strategy: answer_direct. Active thread: open_chat.",
  );

  assert.equal(result.changed, true);
  assert.equal(result.blocked, false);
  assert.equal(result.text, "You have my attention.");
});
