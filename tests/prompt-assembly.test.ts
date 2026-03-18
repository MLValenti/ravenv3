import test from "node:test";
import assert from "node:assert/strict";

import { assemblePrompt } from "../lib/chat/prompt-assembly.ts";
import { createConversationStateSnapshot } from "../lib/chat/conversation-state.ts";
import type { HistoryMessage } from "../lib/chat-prompt.ts";

test("prompt assembly injects state once and keeps only relevant dialogue around the latest user turn", () => {
  const state = {
    ...createConversationStateSnapshot("prompt-assembly"),
    active_topic: "number hunt",
    user_goal: "better focus",
    important_entities: ["number hunt", "focus"],
    open_loops: ["pick one number from 1 to 10 now"],
  };

  const incomingMessages: HistoryMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hello." },
    { role: "user", content: "lets talk about cooking" },
    { role: "assistant", content: "We can talk about cooking." },
    { role: "user", content: "tell me about socks" },
    { role: "assistant", content: "Socks are not the thread." },
    { role: "user", content: "what about weather" },
    { role: "assistant", content: "Weather is not relevant here." },
    { role: "user", content: "lets discuss lunch" },
    { role: "assistant", content: "Lunch is unrelated." },
    { role: "user", content: "lets play number hunt" },
    { role: "assistant", content: "I pick number hunt. Pick one number from 1 to 10 now." },
    { role: "user", content: "what are the rules again?" },
    { role: "assistant", content: "This trailing assistant turn should not be in the prompt." },
  ];

  const assembled = assemblePrompt({
    baseSystemMessages: [{ role: "system", content: "Base system." }],
    auxiliarySystemMessages: [{ role: "system", content: "Aux context." }],
    incomingMessages,
    conversationState: state,
  });

  const stateBlocks = assembled.messages.filter(
    (message) => message.role === "system" && /^Conversation state:/i.test(message.content),
  );
  assert.equal(stateBlocks.length, 1);
  assert.ok(
    assembled.messages.some((message) => /pick one number from 1 to 10 now/i.test(message.content)),
  );
  assert.ok(
    assembled.debug.excludedTurns.some((turn) => turn.reason === "after_latest_user_message"),
  );
  assert.ok(
    assembled.debug.excludedTurns.some((turn) => turn.reason === "older_low_relevance_turn"),
  );
  assert.equal(assembled.messages[assembled.messages.length - 1]?.role, "user");
  assert.match(assembled.messages[assembled.messages.length - 1]?.content ?? "", /what are the rules again/i);
});

test("prompt assembly can suppress stale prior dialogue for fresh greeting turns", () => {
  const state = {
    ...createConversationStateSnapshot("prompt-assembly-fresh"),
    active_topic: "number hunt",
    current_mode: "game" as const,
    open_loops: ["pick one number from 1 to 10 now"],
  };

  const incomingMessages: HistoryMessage[] = [
    { role: "assistant", content: "I pick number hunt. Pick one number from 1 to 10 now." },
    { role: "user", content: "hi" },
  ];

  const assembled = assemblePrompt({
    baseSystemMessages: [{ role: "system", content: "Base system." }],
    auxiliarySystemMessages: [{ role: "system", content: "Aux context." }],
    incomingMessages,
    conversationState: state,
    contextPolicy: { suppressPriorDialogue: true },
  });

  assert.ok(
    assembled.debug.excludedTurns.some((turn) => turn.reason === "suppressed_for_fresh_turn"),
  );
  assert.equal(
    assembled.messages
      .filter((message) => message.role !== "system")
      .some((message) => /pick one number from 1 to 10 now/i.test(message.content)),
    false,
  );
});

test("prompt assembly preserves short relational continuity turns even without keyword overlap", () => {
  const state = {
    ...createConversationStateSnapshot("prompt-assembly-relational"),
    active_topic: "profile",
    current_mode: "relational_chat" as const,
    relational_continuity: {
      ...createConversationStateSnapshot("prompt-assembly-relational").relational_continuity,
      current_emotional_beat: "earned_honesty",
      current_relational_direction: "holding_presence",
      what_raven_has_implicitly_established_about_herself: ["I notice what people skip over."],
      should_press_soften_observe_challenge_reward_or_hold: "observe" as const,
    },
  };

  const incomingMessages: HistoryMessage[] = [
    { role: "assistant", content: "You say that like it is casual, but it clearly is not." },
    { role: "user", content: "No, it's fine." },
    { role: "assistant", content: "I noticed what you skipped over." },
    { role: "user", content: "what do you think?" },
  ];

  const assembled = assemblePrompt({
    baseSystemMessages: [{ role: "system", content: "Base system." }],
    auxiliarySystemMessages: [{ role: "system", content: "Aux context." }],
    incomingMessages,
    conversationState: state,
  });

  assert.ok(
    assembled.messages.some((message) =>
      /i noticed what you skipped over/i.test(message.content),
    ),
  );
  assert.ok(
    assembled.debug.includedTurns.some((turn) => /relational_continuity|identity_continuity/i.test(turn.reason)),
  );
});

test("prompt assembly keeps prior turns that support the active thread and pending modification", () => {
  const state = {
    ...createConversationStateSnapshot("prompt-assembly-thread"),
    active_topic: "bedtime routine",
    active_thread: "bedtime routine",
    pending_user_request: "what about if we add journaling before bed",
    pending_modification: "journaling before bed",
  };

  const incomingMessages: HistoryMessage[] = [
    { role: "user", content: "build me a bedtime routine" },
    { role: "assistant", content: "Fine. Start by locking the lights-out time first." },
    { role: "user", content: "what about if we add journaling before bed" },
  ];

  const assembled = assemblePrompt({
    baseSystemMessages: [{ role: "system", content: "Base system." }],
    auxiliarySystemMessages: [{ role: "system", content: "Aux context." }],
    incomingMessages,
    conversationState: state,
  });

  assert.ok(
    assembled.debug.includedTurns.some((turn) => /active_thread|pending_modification/i.test(turn.reason)),
  );
  assert.ok(
    assembled.messages.some((message) => /locking the lights-out time/i.test(message.content)),
  );
});
