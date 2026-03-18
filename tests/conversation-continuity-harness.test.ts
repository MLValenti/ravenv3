import test from "node:test";
import assert from "node:assert/strict";

import { runContinuityScenario } from "../lib/chat/continuity-harness.ts";
import { SCRIPTED_CONTINUITY_SCENARIOS } from "../lib/chat/continuity-scenarios.ts";

for (const scenario of SCRIPTED_CONTINUITY_SCENARIOS) {
  test(`continuity harness passes scripted scenario: ${scenario.id}`, () => {
    const result = runContinuityScenario(scenario);
    const failedAssertions = result.assertions.filter((assertion) => !assertion.pass);

    assert.deepEqual(
      failedAssertions,
      [],
      failedAssertions.map((assertion) => `${assertion.label}: ${assertion.detail}`).join("\n"),
    );
    assert.ok(result.report.continuity >= (scenario.finalChecks?.minContinuity ?? 0));
    assert.ok(result.report.coherence >= (scenario.finalChecks?.minCoherence ?? 0));
    assert.ok(result.report.repetition_rate <= (scenario.finalChecks?.maxRepetitionRate ?? 1));
  });
}
