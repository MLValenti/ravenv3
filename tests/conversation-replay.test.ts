import test from "node:test";
import assert from "node:assert/strict";

import {
  replayConversationScenarios,
  replayConversationScenario,
  summarizeReplayResults,
} from "../lib/session/conversation-replay.ts";
import {
  BROWSER_LIVE_REPLAY_SCENARIO_IDS,
  CONVERSATION_REPLAY_SCENARIOS,
} from "../lib/session/conversation-replay-scenarios.ts";

test("conversation replay scenarios run with singular trace fields", async () => {
  const results = await replayConversationScenarios(CONVERSATION_REPLAY_SCENARIOS);
  for (const result of results) {
    for (const trace of result.traces) {
      assert.ok(trace.finalOutputSource.length > 0);
      assert.ok(trace.winningResponseFamily.length > 0);
      assert.equal(typeof trace.oneOutputCommitted, "boolean");
      assert.equal(Array.isArray(trace.memoryWritesAttempted), true);
      assert.equal(Array.isArray(trace.memoryWritesCommitted), true);
    }
  }
});

test("conversation replay scenarios are currently clean against replay invariants", async () => {
  const results = await replayConversationScenarios(CONVERSATION_REPLAY_SCENARIOS);
  const failures = results.flatMap((result) =>
    result.violations.map(
      (violation) =>
        `${violation.scenarioId}:${violation.turnNumber}:${violation.invariant}:${violation.actual}`,
    ),
  );
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("conversation replay summary aggregates scenario counts and style metrics", async () => {
  const results = await replayConversationScenarios(CONVERSATION_REPLAY_SCENARIOS.slice(0, 3));
  const summary = summarizeReplayResults(results);
  assert.equal(summary.scenarioCount, 3);
  assert.ok(summary.turnCount >= 3);
  assert.ok(summary.styles.personaConsistency >= 0);
  assert.ok(summary.styles.directness >= 0);
});

test("conversation replay traces the known greeting fallback failure as blocked", async () => {
  const scenario = CONVERSATION_REPLAY_SCENARIOS.find(
    (entry) => entry.id === "greeting_open_chat_blocked_clarification",
  );
  assert.ok(scenario);
  const result = await replayConversationScenario(scenario!);
  assert.equal(result.violations.length, 0);
  assert.equal(result.traces[0]?.finalOutputSource, "scene_fallback");
  assert.match(result.traces[0]?.finalText ?? "", /enough hovering|what you actually want/i);
  assert.doesNotMatch(
    result.traces[0]?.finalText ?? "",
    /ask the exact question you want answered|keep it specific|listen carefully/i,
  );
});

test("browser-live replay scenario ids are present in the scenario catalog", () => {
  const ids = new Set(CONVERSATION_REPLAY_SCENARIOS.map((scenario) => scenario.id));
  for (const id of BROWSER_LIVE_REPLAY_SCENARIO_IDS) {
    assert.equal(ids.has(id), true, `missing browser-live replay scenario: ${id}`);
  }
});
