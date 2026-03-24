import test from "node:test";
import assert from "node:assert/strict";

import { replaySceneFromMessages } from "../lib/session/replay-route-state.ts";

test("chat route replay normalizes session memory for answer turns", async () => {
  const replayed = replaySceneFromMessages({
    messages: [{ role: "user", content: "good evening" }],
    inventory: [],
    deviceControlActive: false,
    profile: {},
    progress: {
      current_tier: "bronze",
      free_pass_count: 0,
      last_completion_summary: null,
    },
  });

  assert.ok(replayed.sessionMemory);
  assert.equal(replayed.sessionMemory.last_user_answer?.value, "good evening");
  assert.equal(replayed.sessionMemory.last_user_question, null);
});

test("chat route replay normalizes session memory for question turns", async () => {
  const replayed = replaySceneFromMessages({
    messages: [{ role: "user", content: "what do you want?" }],
    inventory: [],
    deviceControlActive: false,
    profile: {},
    progress: {
      current_tier: "bronze",
      free_pass_count: 0,
      last_completion_summary: null,
    },
  });

  assert.ok(replayed.sessionMemory);
  assert.equal(replayed.sessionMemory.last_user_question?.value, "what do you want?");
});
