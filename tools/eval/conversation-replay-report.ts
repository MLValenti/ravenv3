import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  replayConversationScenarios,
  summarizeReplayResults,
  type ReplayExecutor,
  type ReplayScenarioResult,
} from "../../lib/session/conversation-replay.ts";
import {
  BROWSER_LIVE_REPLAY_SCENARIO_IDS,
  CONVERSATION_REPLAY_SCENARIOS,
} from "../../lib/session/conversation-replay-scenarios.ts";

type StoredReplayReport = {
  generated_at: string;
  executor: ReplayExecutor;
  scenario_count: number;
  summary: ReturnType<typeof summarizeReplayResults>;
  scenarios: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    executor: ReplayExecutor;
    violation_count: number;
    style: ReplayScenarioResult["style"];
    transcript_metrics: ReplayScenarioResult["transcriptMetrics"];
    traces: ReplayScenarioResult["traces"];
    violations: ReplayScenarioResult["violations"];
  }>;
};

const DEFAULT_REPORT_PATH = path.join(process.cwd(), ".tmp-conversation-replay-report.json");

function selectScenarioIds(defaultIds: string[]): string[] {
  const scenarioSet = process.env.RAVEN_REPLAY_SCENARIO_SET?.trim();
  if (scenarioSet === "browser_live_core") {
    return defaultIds.filter((id) =>
      BROWSER_LIVE_REPLAY_SCENARIO_IDS.includes(
        id as (typeof BROWSER_LIVE_REPLAY_SCENARIO_IDS)[number],
      ),
    );
  }
  const raw = process.env.RAVEN_REPLAY_SCENARIOS?.trim();
  if (!raw) {
    return defaultIds;
  }
  const allowed = new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return defaultIds.filter((id) => allowed.has(id));
}

function printScenario(result: ReplayScenarioResult): void {
  process.stdout.write(`\n=== ${result.scenario.id} ===\n`);
  process.stdout.write(`${result.scenario.title}\n`);
  process.stdout.write(`${result.scenario.description}\n`);
  process.stdout.write(`executor=${result.executor}\n`);
  process.stdout.write(
    `style persona=${result.style.personaConsistency} confidence=${result.style.confidence} directness=${result.style.directness} naturalness=${result.style.naturalness} repetition=${result.style.cannedRepetition}\n`,
  );
  process.stdout.write(
    `transcript continuity=${result.transcriptMetrics.continuity} relevance=${result.transcriptMetrics.topical_relevance} repetition=${result.transcriptMetrics.repetition_rate} recall=${result.transcriptMetrics.memory_recall_accuracy} coherence=${result.transcriptMetrics.coherence} flow=${result.transcriptMetrics.humanlike_flow}\n`,
  );
  for (const trace of result.traces) {
    process.stdout.write(
      `turn ${trace.turnNumber} mode=${trace.interactionMode}/${trace.conversationMode} family=${trace.finalOutputSource} fallback=${trace.fallbackUsed ? trace.fallbackReason : "no"}\n`,
    );
    process.stdout.write(`  user: ${trace.userInput}\n`);
    process.stdout.write(`  raven: ${trace.finalText}\n`);
    process.stdout.write(
      `  memory attempted=${trace.memoryWritesAttempted.map((write) => `${write.key}:${write.value}`).join(" | ") || "none"}\n`,
    );
    process.stdout.write(
      `  memory committed=${trace.memoryWritesCommitted.map((write) => `${write.key}:${write.value}`).join(" | ") || "none"}\n`,
    );
  }
  if (result.violations.length > 0) {
    process.stdout.write("violations:\n");
    for (const violation of result.violations) {
      process.stdout.write(
        `- turn ${violation.turnNumber} ${violation.invariant} expected=${violation.expected} actual=${violation.actual}${violation.likelyCodePath ? ` path=${violation.likelyCodePath}` : ""}\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  const reportPath = process.env.RAVEN_REPLAY_REPORT_PATH ?? DEFAULT_REPORT_PATH;
  const executor = (process.env.RAVEN_REPLAY_EXECUTOR?.trim() === "browser_live"
    ? "browser_live"
    : "synthetic") as ReplayExecutor;
  const baseUrl = process.env.RAVEN_REPLAY_BASE_URL;
  const scenarioIds = selectScenarioIds(CONVERSATION_REPLAY_SCENARIOS.map((scenario) => scenario.id));
  const scenarios = CONVERSATION_REPLAY_SCENARIOS.filter((scenario) =>
    scenarioIds.includes(scenario.id),
  );
  const results = await replayConversationScenarios(scenarios, {
    executor,
    baseUrl,
  });
  const summary = summarizeReplayResults(results);

  const report: StoredReplayReport = {
    generated_at: new Date().toISOString(),
    executor,
    scenario_count: results.length,
    summary,
    scenarios: results.map((result) => ({
      id: result.scenario.id,
      category: result.scenario.category,
      title: result.scenario.title,
      description: result.scenario.description,
      executor: result.executor,
      violation_count: result.violations.length,
      style: result.style,
      transcript_metrics: result.transcriptMetrics,
      traces: result.traces,
      violations: result.violations,
    })),
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  process.stdout.write("=== Conversation Replay Summary ===\n");
  process.stdout.write(`report_path=${reportPath}\n`);
  process.stdout.write(`executor=${executor}${baseUrl ? ` base_url=${baseUrl}` : ""}\n`);
  process.stdout.write(
    `counts scenarios=${summary.scenarioCount} turns=${summary.turnCount} violations=${summary.violationCount}\n`,
  );
  process.stdout.write(
    `style persona=${summary.styles.personaConsistency} confidence=${summary.styles.confidence} directness=${summary.styles.directness} naturalness=${summary.styles.naturalness} repetition=${summary.styles.cannedRepetition}\n`,
  );

  for (const result of results) {
    printScenario(result);
  }

  if (summary.violationCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
