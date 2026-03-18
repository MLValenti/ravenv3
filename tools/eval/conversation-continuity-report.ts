import { runContinuityScenario } from "../../lib/chat/continuity-harness.ts";
import { SCRIPTED_CONTINUITY_SCENARIOS } from "../../lib/chat/continuity-scenarios.ts";

const results = SCRIPTED_CONTINUITY_SCENARIOS.map((scenario) => runContinuityScenario(scenario));
const reportTotals = results.reduce(
  (totals, result) => {
    totals.continuity += result.report.continuity;
    totals.topical_relevance += result.report.topical_relevance;
    totals.repetition_rate += result.report.repetition_rate;
    totals.memory_recall_accuracy += result.report.memory_recall_accuracy;
    totals.coherence += result.report.coherence;
    totals.humanlike_flow += result.report.humanlike_flow;
    totals.assertion_count += result.assertions.length;
    totals.failed_assertions += result.assertions.filter((assertion) => !assertion.pass).length;
    return totals;
  },
  {
    continuity: 0,
    topical_relevance: 0,
    repetition_rate: 0,
    memory_recall_accuracy: 0,
    coherence: 0,
    humanlike_flow: 0,
    assertion_count: 0,
    failed_assertions: 0,
  },
);

const scenarioCount = Math.max(1, results.length);
const averageReport = {
  continuity: Number((reportTotals.continuity / scenarioCount).toFixed(3)),
  topical_relevance: Number((reportTotals.topical_relevance / scenarioCount).toFixed(3)),
  repetition_rate: Number((reportTotals.repetition_rate / scenarioCount).toFixed(3)),
  memory_recall_accuracy: Number((reportTotals.memory_recall_accuracy / scenarioCount).toFixed(3)),
  coherence: Number((reportTotals.coherence / scenarioCount).toFixed(3)),
  humanlike_flow: Number((reportTotals.humanlike_flow / scenarioCount).toFixed(3)),
};

console.log(
  JSON.stringify(
    {
      scenarios: results.map((result) => ({
        id: result.scenarioId,
        title: result.title,
        report: result.report,
        failed_assertions: result.assertions.filter((assertion) => !assertion.pass),
      })),
      summary: {
        scenario_count: results.length,
        assertion_count: reportTotals.assertion_count,
        failed_assertions: reportTotals.failed_assertions,
        averages: averageReport,
      },
    },
    null,
    2,
  ),
);
