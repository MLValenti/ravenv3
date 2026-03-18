import test from "node:test";
import assert from "node:assert/strict";

import { shouldBlockChatRoute } from "../lib/chat-route-guard.ts";
import { setEmergencyStopped } from "../lib/emergency-stop.ts";

test("emergency stop blocks /api/chat guard", async () => {
  await setEmergencyStopped(true, "test_engaged");

  try {
    assert.equal(await shouldBlockChatRoute(), true);
  } finally {
    await setEmergencyStopped(false, "test_released");
  }
});

test("chat guard allows /api/chat when emergency stop is disabled", async () => {
  await setEmergencyStopped(false, "test_clear");
  assert.equal(await shouldBlockChatRoute(), false);
});
