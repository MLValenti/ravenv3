import test from "node:test";
import assert from "node:assert/strict";

import { runRegressionScenario, summarizeRegressionResults } from "../lib/chat/regression-harness.ts";
import { CONVERSATIONAL_REGRESSION_SCENARIOS } from "../lib/chat/regression-scenarios.ts";

for (const scenario of CONVERSATIONAL_REGRESSION_SCENARIOS) {
  test(`conversational regression scripted scenario passes: ${scenario.id}`, async () => {
    const result = await runRegressionScenario({
      scenario,
      generateAssistant: async (turn) => turn.scriptedAssistant ?? "",
    });

    assert.deepEqual(
      result.failedAssertions,
      [],
      result.failedAssertions.map((assertion) => `${assertion.label}: ${assertion.detail}`).join("\n"),
    );
    assert.ok(
      result.assertionPassRate >= (scenario.thresholds?.minAssertionPassRate ?? 0),
      `${scenario.id} assertionPassRate=${result.assertionPassRate}`,
    );
  });
}

test("conversational regression summary aggregates scenario metrics", async () => {
  const results = await Promise.all(
    CONVERSATIONAL_REGRESSION_SCENARIOS.slice(0, 2).map((scenario) =>
      runRegressionScenario({
        scenario,
        generateAssistant: async (turn) => turn.scriptedAssistant ?? "",
      }),
    ),
  );

  const summary = summarizeRegressionResults(results);
  assert.equal(summary.scenarioCount, 2);
  assert.ok(summary.turnCount >= 2);
  assert.ok(summary.assertionCount > 0);
  assert.equal(summary.failedAssertionCount, 0);
  assert.ok(summary.averages.continuity >= 0.8);
  assert.ok(summary.averages.assertion_pass_rate >= 0.95);
});
