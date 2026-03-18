import test from "node:test";
import assert from "node:assert/strict";

import { buildCoreConversationReply } from "../lib/chat/core-turn-move.ts";

test("core conversation builder declines explicit training requests", () => {
  const reply = buildCoreConversationReply({
    userText: "give me anal training",
    previousAssistantText: null,
    currentTopic: null,
  });

  assert.equal(reply, null);
});

test("core conversation builder declines assistant preference questions", () => {
  const reply = buildCoreConversationReply({
    userText: "do you like bondage",
    previousAssistantText: null,
    currentTopic: null,
  });

  assert.equal(reply, null);
});
