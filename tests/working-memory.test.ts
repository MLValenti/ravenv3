import test from "node:test";
import assert from "node:assert/strict";

import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import {
  buildWorkingMemoryBlock,
  createWorkingMemory,
  noteWorkingMemoryAssistantTurn,
  noteWorkingMemoryUserTurn,
} from "../lib/session/working-memory.ts";

test("working memory tracks unresolved topic and commitment", () => {
  let memory = createWorkingMemory();
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  memory = noteWorkingMemoryUserTurn(memory, {
    text: "lets play a game",
    act: routed.act,
    nextTopic: routed.nextTopic,
  });
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "resolve the game choice before changing topics",
    topicResolved: false,
  });

  const block = buildWorkingMemoryBlock(memory);
  assert.match(block, /Topic: game_selection:open/i);
  assert.match(block, /Last user request: lets play a game/i);
  assert.match(block, /Next commitment: resolve the game choice/i);
});

test("working memory rolling summary updates over user turns", () => {
  let memory = createWorkingMemory();
  for (let index = 0; index < 4; index += 1) {
    memory = noteWorkingMemoryUserTurn(memory, {
      text: `request ${index + 1}`,
      act: "other",
      nextTopic: null,
    });
  }

  assert.doesNotMatch(memory.rolling_summary, /No recent summary yet/i);
  assert.match(memory.rolling_summary, /User asked:/i);
});
