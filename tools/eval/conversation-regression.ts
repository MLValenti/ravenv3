import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getPromptDebugEntry } from "../../lib/chat/prompt-debug.ts";
import {
  runRegressionScenario,
  summarizeRegressionResults,
  type RegressionScenarioResult,
} from "../../lib/chat/regression-harness.ts";
import { CONVERSATIONAL_REGRESSION_SCENARIOS } from "../../lib/chat/regression-scenarios.ts";
import type { ConversationStateSnapshot } from "../../lib/chat/conversation-state.ts";

type LiveMessage = {
  role: "user" | "assistant";
  content: string;
};

type PromptDebugSnapshot = ReturnType<typeof getPromptDebugEntry>;

type LiveScenarioReport = RegressionScenarioResult & {
  responseHeaders: Array<Record<string, string>>;
  promptDebug: Array<PromptDebugSnapshot>;
};

type StoredReport = {
  generated_at: string;
  direct_route: boolean;
  model: string;
  scenario_count: number;
  summary: ReturnType<typeof summarizeRegressionResults>;
  comparison_to_baseline: null | {
    continuity_delta: number;
    topical_relevance_delta: number;
    repetition_rate_delta: number;
    memory_recall_delta: number;
    coherence_delta: number;
    humanlike_flow_delta: number;
    assertion_pass_rate_delta: number;
    failed_assertion_delta: number;
  };
  scenarios: LiveScenarioReport[];
};

const DEFAULT_APP_CHAT_URL = "http://127.0.0.1:3000/api/chat";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "dolphin-llama3:8b";
const DEFAULT_REPORT_PATH = path.join(process.cwd(), ".tmp-conversation-regression-report.json");

function assertLocalHttpUrl(raw: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is invalid: ${raw}`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(`${label} must use http: ${raw}`);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`${label} must be localhost only: ${raw}`);
  }
  return parsed.toString();
}

function parseNdjsonText(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) {
    return "";
  }
  try {
    const parsed = JSON.parse(line) as { response?: unknown };
    return typeof parsed.response === "string" ? parsed.response.trim() : raw.trim();
  } catch {
    return raw.trim();
  }
}

function selectScenarioIds(defaultIds: string[]): string[] {
  const raw = process.env.RAVEN_REGRESSION_SCENARIOS?.trim();
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

async function callRavenTurn(input: {
  appChatUrl: string;
  ollamaUrl: string;
  model: string;
  messages: LiveMessage[];
  sessionId: string;
  conversationState: ConversationStateSnapshot;
  directRoute: boolean;
}): Promise<{ text: string; headers: Record<string, string>; promptDebug: PromptDebugSnapshot }> {
  const payload = {
    baseUrl: input.ollamaUrl,
    model: input.model,
    sessionMode: true,
    toneProfile: "dominant" as const,
    awaitingUser: false,
    userAnswered: true,
    verificationJustCompleted: false,
    sessionPhase: "build",
    sessionId: input.sessionId,
    memoryAutoSave: false,
    conversationState: input.conversationState,
    consent: {
      confirmedAdults: true,
      safeWord: "red",
      limits: "none",
      preferredStyle: "direct",
    },
    messages: input.messages,
  };

  const response = input.directRoute
    ? await (await import("../../app/api/chat/route.ts")).POST(
        new Request(input.appChatUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      )
    : await fetch(input.appChatUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

  if (!response.ok) {
    const details = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`/api/chat failed for ${input.sessionId} (${response.status}): ${details}`);
  }

  const rawText = await response.text();
  const headers = Object.fromEntries(response.headers.entries());
  const promptDebug = getPromptDebugEntry(input.sessionId);
  return {
    text: parseNdjsonText(rawText),
    headers,
    promptDebug,
  };
}

async function maybeLoadBaseline(
  baselinePath: string | null,
): Promise<StoredReport | null> {
  if (!baselinePath) {
    return null;
  }
  try {
    const raw = await readFile(baselinePath, "utf8");
    return JSON.parse(raw) as StoredReport;
  } catch {
    return null;
  }
}

function buildComparison(
  current: ReturnType<typeof summarizeRegressionResults>,
  baseline: StoredReport | null,
): StoredReport["comparison_to_baseline"] {
  if (!baseline) {
    return null;
  }
  return {
    continuity_delta: Number((current.averages.continuity - baseline.summary.averages.continuity).toFixed(3)),
    topical_relevance_delta: Number(
      (current.averages.topical_relevance - baseline.summary.averages.topical_relevance).toFixed(3),
    ),
    repetition_rate_delta: Number(
      (current.averages.repetition_rate - baseline.summary.averages.repetition_rate).toFixed(3),
    ),
    memory_recall_delta: Number(
      (current.averages.memory_recall_accuracy - baseline.summary.averages.memory_recall_accuracy).toFixed(3),
    ),
    coherence_delta: Number((current.averages.coherence - baseline.summary.averages.coherence).toFixed(3)),
    humanlike_flow_delta: Number(
      (current.averages.humanlike_flow - baseline.summary.averages.humanlike_flow).toFixed(3),
    ),
    assertion_pass_rate_delta: Number(
      (current.averages.assertion_pass_rate - baseline.summary.averages.assertion_pass_rate).toFixed(3),
    ),
    failed_assertion_delta: current.failedAssertionCount - baseline.summary.failedAssertionCount,
  };
}

function printScenario(result: LiveScenarioReport): void {
  process.stdout.write(`\n=== ${result.scenarioId} ===\n`);
  process.stdout.write(`${result.title}\n`);
  process.stdout.write(`${result.description}\n`);
  process.stdout.write(
    `metrics continuity=${result.report.continuity} relevance=${result.report.topical_relevance} repetition=${result.report.repetition_rate} recall=${result.report.memory_recall_accuracy} coherence=${result.report.coherence} flow=${result.report.humanlike_flow} pass_rate=${result.assertionPassRate}\n`,
  );
  if (result.failedAssertions.length > 0) {
    process.stdout.write("failures:\n");
    for (const assertion of result.failedAssertions) {
      process.stdout.write(`- ${assertion.label}: ${assertion.detail}\n`);
    }
  }
  for (const turn of result.turnLogs) {
    process.stdout.write(`turn ${turn.turnNumber} user: ${turn.user}\n`);
    process.stdout.write(`turn ${turn.turnNumber} raven: ${turn.assistant}\n`);
    const turnFailures = turn.assertions.filter((assertion) => !assertion.pass);
    if (turnFailures.length > 0) {
      for (const failure of turnFailures) {
        process.stdout.write(`  fail ${failure.label}: ${failure.detail}\n`);
      }
    }
  }
}

async function main(): Promise<void> {
  const appChatUrl = assertLocalHttpUrl(
    process.env.RAVEN_REGRESSION_APP_CHAT_URL ?? DEFAULT_APP_CHAT_URL,
    "RAVEN_REGRESSION_APP_CHAT_URL",
  );
  const ollamaUrl = assertLocalHttpUrl(
    process.env.RAVEN_REGRESSION_OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    "RAVEN_REGRESSION_OLLAMA_URL",
  );
  const model = process.env.RAVEN_REGRESSION_MODEL ?? DEFAULT_MODEL;
  const directRoute = process.env.RAVEN_REGRESSION_DIRECT_ROUTE !== "false";
  const useScripted = process.env.RAVEN_REGRESSION_USE_SCRIPTED === "true";
  const reportPath = process.env.RAVEN_REGRESSION_REPORT_PATH ?? DEFAULT_REPORT_PATH;
  const baselinePath = process.env.RAVEN_REGRESSION_BASELINE ?? null;
  const scenarioIds = selectScenarioIds(CONVERSATIONAL_REGRESSION_SCENARIOS.map((scenario) => scenario.id));
  const scenarios = CONVERSATIONAL_REGRESSION_SCENARIOS.filter((scenario) =>
    scenarioIds.includes(scenario.id),
  );

  const liveReports: LiveScenarioReport[] = [];
  for (const scenario of scenarios) {
    const messages: LiveMessage[] = [];
    const responseHeaders: Array<Record<string, string>> = [];
    const promptDebug: Array<PromptDebugSnapshot> = [];

    const result = await runRegressionScenario({
      scenario,
      sessionId: `regression-${scenario.id}`,
      generateAssistant: async (turn, state) => {
        if (useScripted) {
          return turn.scriptedAssistant ?? "";
        }
        messages.push({ role: "user", content: turn.user });
        const response = await callRavenTurn({
          appChatUrl,
          ollamaUrl,
          model,
          messages,
          sessionId: `regression-${scenario.id}`,
          conversationState: state,
          directRoute,
        });
        messages.push({ role: "assistant", content: response.text });
        responseHeaders.push(response.headers);
        promptDebug.push(response.promptDebug);
        return response.text;
      },
    });

    const liveReport: LiveScenarioReport = {
      ...result,
      responseHeaders,
      promptDebug,
    };
    printScenario(liveReport);
    liveReports.push(liveReport);
  }

  const summary = summarizeRegressionResults(liveReports);
  const baseline = await maybeLoadBaseline(baselinePath);
  const comparison = buildComparison(summary, baseline);
  const report: StoredReport = {
    generated_at: new Date().toISOString(),
    direct_route: directRoute && !useScripted,
    model,
    scenario_count: liveReports.length,
    summary,
    comparison_to_baseline: comparison,
    scenarios: liveReports,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  process.stdout.write("\n=== Regression Summary ===\n");
  process.stdout.write(`report_path=${reportPath}\n`);
  process.stdout.write(
    `averages continuity=${summary.averages.continuity} relevance=${summary.averages.topical_relevance} repetition=${summary.averages.repetition_rate} recall=${summary.averages.memory_recall_accuracy} coherence=${summary.averages.coherence} flow=${summary.averages.humanlike_flow} pass_rate=${summary.averages.assertion_pass_rate}\n`,
  );
  process.stdout.write(
    `counts scenarios=${summary.scenarioCount} turns=${summary.turnCount} assertions=${summary.assertionCount} failed=${summary.failedAssertionCount}\n`,
  );
  if (comparison) {
    process.stdout.write(
      `delta continuity=${comparison.continuity_delta} relevance=${comparison.topical_relevance_delta} repetition=${comparison.repetition_rate_delta} recall=${comparison.memory_recall_delta} coherence=${comparison.coherence_delta} flow=${comparison.humanlike_flow_delta} pass_rate=${comparison.assertion_pass_rate_delta} failed=${comparison.failed_assertion_delta}\n`,
    );
  }

  if (summary.failedAssertionCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
