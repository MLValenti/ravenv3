import test from "node:test";
import assert from "node:assert/strict";

import {
  runRavenSystemEvaluation,
  validateSystemEvalMatrix,
  RAVEN_SYSTEM_EVAL_MATRIX,
} from "../lib/session/system-eval.ts";

test("system eval matrix references valid replay scenarios", () => {
  const validation = validateSystemEvalMatrix();
  assert.deepEqual(validation.missingScenarioIds, []);
  assert.ok(RAVEN_SYSTEM_EVAL_MATRIX.length >= 8);
});

test("system eval emits per-turn diagnostics needed for failure clustering", async () => {
  const evaluation = await runRavenSystemEvaluation(undefined, RAVEN_SYSTEM_EVAL_MATRIX.slice(0, 2));
  assert.ok(evaluation.results.length >= 1);
  const trace = evaluation.results[0]?.traces[0];
  assert.ok(trace);
  assert.equal(typeof trace.promptRouteMode, "string");
  assert.equal(typeof trace.promptProfile, "string");
  assert.equal(typeof trace.promptSummary, "string");
  assert.equal(Array.isArray(trace.sceneWrites), true);
  assert.equal(Array.isArray(trace.candidateResponseFamilies), true);
  assert.equal(typeof trace.selectedCandidateText, "string");
  assert.equal(typeof trace.responseGateText, "string");
  assert.equal(typeof trace.finalText, "string");
});
