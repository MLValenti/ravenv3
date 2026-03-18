import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClientChatMessages,
  stripClientPromptScaffolding,
} from "../lib/chat/request-messages.ts";

test("client chat message builder sends dialogue turns plus the latest user message without system scaffolding", () => {
  const messages = buildClientChatMessages(
    [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi." },
      { role: "user", content: "Let's plan my week." },
    ],
    "Let's plan my week.",
    6,
  );

  assert.deepEqual(messages, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "Hi." },
    { role: "user", content: "Let's plan my week." },
  ]);
  assert.equal(
    messages.some((message) => message.role === "system"),
    false,
  );
});

test("server-side message sanitizer removes client prompt scaffolding", () => {
  const stripped = stripClientPromptScaffolding([
    { role: "system", content: "Conversation contract: ..." },
    { role: "assistant", content: "What do you want to do?" },
    { role: "system", content: "Turn routing: ..." },
    { role: "user", content: "You pick." },
  ]);

  assert.deepEqual(stripped, [
    { role: "assistant", content: "What do you want to do?" },
    { role: "user", content: "You pick." },
  ]);
});
