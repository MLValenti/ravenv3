import path from "node:path";
import { writeFile } from "node:fs/promises";

import {
  runRavenSystemEvaluation,
  validateSystemEvalMatrix,
} from "../../lib/session/system-eval.ts";
import type { ReplayExecutor } from "../../lib/session/conversation-replay.ts";

const DEFAULT_REPORT_PATH = path.join(process.cwd(), ".tmp-raven-system-eval-report.json");

async function main(): Promise<void> {
  const validation = validateSystemEvalMatrix();
  if (validation.missingScenarioIds.length > 0) {
    throw new Error(`System eval matrix references missing scenarios: ${validation.missingScenarioIds.join(", ")}`);
  }

  const executor = (process.env.RAVEN_REPLAY_EXECUTOR?.trim() === "browser_live"
    ? "browser_live"
    : "synthetic") as ReplayExecutor;
  const baseUrl = process.env.RAVEN_REPLAY_BASE_URL;
  const reportPath = process.env.RAVEN_SYSTEM_EVAL_REPORT_PATH ?? DEFAULT_REPORT_PATH;
  const evaluation = await runRavenSystemEvaluation({
    executor,
    baseUrl,
  });

  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        executor,
        summary: evaluation.summary,
        failures_by_section: evaluation.failuresBySection,
        failures_by_cluster: evaluation.failuresByCluster.map((entry) => ({
          cluster: entry.cluster,
          count: entry.count,
          sample: entry.violations.slice(0, 12),
        })),
        scenarios: evaluation.results,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("=== Raven System Evaluation ===\n");
  process.stdout.write(`report_path=${reportPath}\n`);
  process.stdout.write(
    `summary scenarios=${evaluation.summary.scenarioCount} turns=${evaluation.summary.turnCount} violations=${evaluation.summary.violationCount}\n`,
  );
  for (const section of evaluation.failuresBySection) {
    process.stdout.write(
      `section ${section.sectionId} scenarios=${section.scenarioCount} violations=${section.violationCount}\n`,
    );
  }
  if (evaluation.failuresByCluster.length > 0) {
    process.stdout.write("clusters:\n");
    for (const cluster of evaluation.failuresByCluster) {
      process.stdout.write(`- ${cluster.cluster}: ${cluster.count}\n`);
    }
  }
  if (evaluation.summary.violationCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
