import { scoreJudgeChecks } from "../../lib/eval/judge-score.ts";
type Role = "user" | "assistant";

type ConversationMessage = {
  role: Role;
  content: string;
};

type Scenario = {
  id: string;
  objective: string;
  startUserMessage: string;
  maxTurns: number;
};

type JudgeChecks = {
  answered_last_message: boolean;
  continuity: boolean;
  in_character: boolean;
  non_repetitive: boolean;
};

type JudgeResult = {
  score: number;
  checks: JudgeChecks;
  issues: string[];
  suggestion: string;
};

type TurnResult = {
  turn: number;
  user: string;
  assistant: string;
  judge: JudgeResult;
  hardFailures: string[];
};

const DEFAULT_APP_CHAT_URL = "http://127.0.0.1:3000/api/chat";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_RAVEN_MODEL = "dolphin-llama3:8b";
const DEFAULT_USER_MODEL = "dolphin-llama3:8b";
const DEFAULT_JUDGE_MODEL = "dolphin-llama3:8b";
const DEFAULT_TIMEOUT_MS = 30_000;
const HISTORY_LINES_FOR_PROMPT = 8;

const HARD_FAIL_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "identity_leak", pattern: /\bas an ai\b/i },
  { code: "identity_leak", pattern: /\blanguage model\b/i },
  { code: "identity_leak", pattern: /\bi am a system\b/i },
  { code: "policy_refusal", pattern: /\bi cannot (assist|help|engage|create)\b/i },
  { code: "policy_refusal", pattern: /\bexplicit content\b/i },
  { code: "policy_refusal", pattern: /\bchild exploitation\b/i },
  { code: "out_of_character", pattern: /\bhow'?s your day\b/i },
  { code: "out_of_character", pattern: /\bwhat would you like to talk about next\b/i },
];

const SCENARIOS: Scenario[] = [
  {
    id: "game_wager_followthrough",
    objective:
      "Start a game, negotiate a wager, and keep continuity so the game can actually proceed turn by turn.",
    startUserMessage: "lets play a game",
    maxTurns: 6,
  },
  {
    id: "task_assignment_progress",
    objective:
      "Ask for a task, confirm start, ask what to do next, and check that responses progress without repeating.",
    startUserMessage: "give me a chastity task for 30 minutes",
    maxTurns: 6,
  },
  {
    id: "question_first_response",
    objective:
      "Ask direct questions and ensure Raven answers first before introducing any new instruction.",
    startUserMessage: "how do we play",
    maxTurns: 5,
  },
];

function selectScenariosFromEnv(defaultScenarios: Scenario[]): Scenario[] {
  const filterRaw = process.env.RAVEN_EVAL_SCENARIOS;
  const maxTurnsRaw = process.env.RAVEN_EVAL_MAX_TURNS;
  const maxTurnsValue = Number(maxTurnsRaw);
  const maxTurns =
    Number.isFinite(maxTurnsValue) && maxTurnsValue > 0 ? Math.floor(maxTurnsValue) : null;

  const allowed = filterRaw
    ? new Set(
        filterRaw
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      )
    : null;

  const filtered = allowed
    ? defaultScenarios.filter((scenario) => allowed.has(scenario.id))
    : defaultScenarios;

  const bounded = filtered.map((scenario) => ({
    ...scenario,
    maxTurns:
      maxTurns !== null ? Math.max(1, Math.min(maxTurns, scenario.maxTurns)) : scenario.maxTurns,
  }));
  return bounded.length > 0 ? bounded : defaultScenarios;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeForCompare(text: string): string {
  return normalize(text).toLowerCase();
}

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

  return parsed.toString().replace(/\/$/, "");
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRavenNdjsonText(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) {
    return "";
  }

  try {
    const parsed = JSON.parse(line) as { response?: unknown };
    return typeof parsed.response === "string" ? normalize(parsed.response) : "";
  } catch {
    return normalize(raw);
  }
}

function recentTranscript(messages: ConversationMessage[], maxLines = HISTORY_LINES_FOR_PROMPT): string {
  const lines = messages
    .slice(-maxLines)
    .map((message) => `${message.role === "user" ? "User" : "Raven"}: ${normalize(message.content)}`);
  return lines.join("\n");
}

async function callOllamaChat(input: {
  ollamaUrl: string;
  model: string;
  system: string;
  user: string;
  timeoutMs: number;
  jsonFormat: boolean;
}): Promise<string> {
  const response = await fetchWithTimeout(
    `${input.ollamaUrl}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        format: input.jsonFormat ? "json" : undefined,
        options: {
          temperature: input.jsonFormat ? 0.2 : 0.7,
          top_p: 0.9,
          top_k: 40,
        },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    },
    input.timeoutMs,
  );

  if (!response.ok) {
    const details = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Ollama call failed (${response.status}): ${details}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { message?: { content?: unknown }; response?: unknown }
    | null;
  const content =
    typeof payload?.message?.content === "string"
      ? payload.message.content
      : typeof payload?.response === "string"
      ? payload.response
      : "";
  return normalize(content);
}

async function callRavenSessionTurn(input: {
  appChatUrl: string;
  model: string;
  messages: ConversationMessage[];
  timeoutMs: number;
  directRoute: boolean;
}): Promise<string> {
  const payload = {
    baseUrl: DEFAULT_OLLAMA_URL,
    model: input.model,
    sessionMode: true,
    toneProfile: "dominant" as const,
    awaitingUser: false,
    userAnswered: true,
    verificationJustCompleted: false,
    sessionPhase: "build",
    consent: {
      confirmedAdults: true,
      safeWord: "red",
      limits: "none",
      preferredStyle: "direct",
    },
    messages: input.messages,
  };

  if (input.directRoute) {
    const chatRoute = await import("../../app/api/chat/route.ts");
    const request = new Request(input.appChatUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const response = await chatRoute.POST(request);
    if (!response.ok) {
      const details = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`/api/chat direct route failed (${response.status}): ${details}`);
    }
    const raw = await response.text();
    return parseRavenNdjsonText(raw);
  }

  const response = await fetchWithTimeout(
    input.appChatUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    input.timeoutMs,
  );

  if (!response.ok) {
    const details = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`/api/chat failed (${response.status}): ${details}`);
  }

  const raw = await response.text();
  return parseRavenNdjsonText(raw);
}

function parseJudgeResult(raw: string): JudgeResult {
  try {
    const parsed = JSON.parse(raw) as {
      score?: unknown;
      checks?: {
        answered_last_message?: unknown;
        continuity?: unknown;
        in_character?: unknown;
        non_repetitive?: unknown;
      };
      issues?: unknown;
      suggestion?: unknown;
    };
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((value): value is string => typeof value === "string").slice(0, 8)
      : [];
    const checks: JudgeChecks = {
      answered_last_message: parsed.checks?.answered_last_message === true,
      continuity: parsed.checks?.continuity === true,
      in_character: parsed.checks?.in_character === true,
      non_repetitive: parsed.checks?.non_repetitive === true,
    };
    return {
      score: scoreJudgeChecks(checks, issues.length),
      checks,
      issues,
      suggestion:
        typeof parsed.suggestion === "string" && parsed.suggestion.trim().length > 0
          ? parsed.suggestion.trim()
          : "No suggestion.",
    };
  } catch {
    return {
      score: 0,
      checks: {
        answered_last_message: false,
        continuity: false,
        in_character: false,
        non_repetitive: false,
      },
      issues: ["judge_parse_error"],
      suggestion: "Judge output was not valid JSON.",
    };
  }
}

function localHeuristicHardFailures(assistantText: string, previousAssistantText: string | null): string[] {
  const failures: string[] = [];
  for (const { code, pattern } of HARD_FAIL_PATTERNS) {
    if (pattern.test(assistantText)) {
      failures.push(code);
    }
  }
  if (
    previousAssistantText &&
    normalizeForCompare(previousAssistantText) === normalizeForCompare(assistantText)
  ) {
    failures.push("exact_repeat");
  }
  return [...new Set(failures)];
}

async function generateNextUserTurn(input: {
  ollamaUrl: string;
  userModel: string;
  scenario: Scenario;
  messages: ConversationMessage[];
  timeoutMs: number;
}): Promise<string> {
  const system = [
    "You simulate a real end user in a short chat session.",
    "Return exactly one user message only.",
    "No markdown, no labels, no quotes.",
    "Keep it natural, short, and plausible.",
    "Keep pressure on continuity and ask follow ups when needed.",
  ].join("\n");
  const userPrompt = [
    `Scenario objective: ${input.scenario.objective}`,
    "Conversation so far:",
    recentTranscript(input.messages),
    "Write the next user message now.",
  ].join("\n");
  const generated = await callOllamaChat({
    ollamaUrl: input.ollamaUrl,
    model: input.userModel,
    system,
    user: userPrompt,
    timeoutMs: input.timeoutMs,
    jsonFormat: false,
  });
  const normalized = normalize(generated).replace(/^user:\s*/i, "");
  return normalized || "ok continue";
}

async function judgeTurn(input: {
  ollamaUrl: string;
  judgeModel: string;
  scenario: Scenario;
  messages: ConversationMessage[];
  userMessage: string;
  assistantMessage: string;
  timeoutMs: number;
}): Promise<JudgeResult> {
  const system = [
    "You are a strict dialogue evaluator for roleplay chat quality.",
    "Return JSON only with this exact shape:",
    '{"score":0-100,"checks":{"answered_last_message":true,"continuity":true,"in_character":true,"non_repetitive":true},"issues":["..."],"suggestion":"..."}',
    "Do not include markdown.",
  ].join("\n");

  const prompt = [
    `Scenario: ${input.scenario.objective}`,
    "Recent transcript:",
    recentTranscript(input.messages),
    `Latest user: ${normalize(input.userMessage)}`,
    `Latest assistant: ${normalize(input.assistantMessage)}`,
    "Evaluate if assistant directly answered latest user, stayed on topic, stayed in character, and avoided repetition.",
  ].join("\n");

  const raw = await callOllamaChat({
    ollamaUrl: input.ollamaUrl,
    model: input.judgeModel,
    system,
    user: prompt,
    timeoutMs: input.timeoutMs,
    jsonFormat: true,
  });
  return parseJudgeResult(raw);
}

async function runScenario(input: {
  scenario: Scenario;
  appChatUrl: string;
  ollamaUrl: string;
  ravenModel: string;
  userModel: string;
  judgeModel: string;
  timeoutMs: number;
  directRoute: boolean;
}): Promise<{
  scenario: Scenario;
  turns: TurnResult[];
  avgScore: number;
  hardFailureCount: number;
}> {
  const messages: ConversationMessage[] = [];
  const turns: TurnResult[] = [];

  let currentUserMessage = input.scenario.startUserMessage;
  for (let turn = 1; turn <= input.scenario.maxTurns; turn += 1) {
    messages.push({ role: "user", content: currentUserMessage });
    const assistant = await callRavenSessionTurn({
      appChatUrl: input.appChatUrl,
      model: input.ravenModel,
      messages,
      timeoutMs: input.timeoutMs,
      directRoute: input.directRoute,
    });
    messages.push({ role: "assistant", content: assistant });

    const judge = await judgeTurn({
      ollamaUrl: input.ollamaUrl,
      judgeModel: input.judgeModel,
      scenario: input.scenario,
      messages,
      userMessage: currentUserMessage,
      assistantMessage: assistant,
      timeoutMs: input.timeoutMs,
    });
    const previousAssistant =
      messages
        .slice(0, -1)
        .reverse()
        .find((message) => message.role === "assistant")?.content ?? null;
    const hardFailures = localHeuristicHardFailures(assistant, previousAssistant);

    turns.push({
      turn,
      user: currentUserMessage,
      assistant,
      judge,
      hardFailures,
    });

    currentUserMessage = await generateNextUserTurn({
      ollamaUrl: input.ollamaUrl,
      userModel: input.userModel,
      scenario: input.scenario,
      messages,
      timeoutMs: input.timeoutMs,
    });
  }

  const avgScore =
    turns.length > 0
      ? Math.round(turns.reduce((sum, item) => sum + item.judge.score, 0) / turns.length)
      : 0;
  const hardFailureCount = turns.reduce((sum, item) => sum + item.hardFailures.length, 0);

  return {
    scenario: input.scenario,
    turns,
    avgScore,
    hardFailureCount,
  };
}

function printScenarioReport(result: {
  scenario: Scenario;
  turns: TurnResult[];
  avgScore: number;
  hardFailureCount: number;
}): void {
  process.stdout.write(`\n=== Scenario: ${result.scenario.id} ===\n`);
  process.stdout.write(`Objective: ${result.scenario.objective}\n`);
  process.stdout.write(`Average judge score: ${result.avgScore}\n`);
  process.stdout.write(`Hard failures: ${result.hardFailureCount}\n`);
  for (const turn of result.turns) {
    process.stdout.write(`\nTurn ${turn.turn}\n`);
    process.stdout.write(`User: ${turn.user}\n`);
    process.stdout.write(`Raven: ${turn.assistant}\n`);
    process.stdout.write(
      `Judge: score=${turn.judge.score} answer=${turn.judge.checks.answered_last_message} continuity=${turn.judge.checks.continuity} in_character=${turn.judge.checks.in_character} non_repetitive=${turn.judge.checks.non_repetitive}\n`,
    );
    if (turn.judge.issues.length > 0) {
      process.stdout.write(`Issues: ${turn.judge.issues.join(" | ")}\n`);
    }
    if (turn.hardFailures.length > 0) {
      process.stdout.write(`Hard failures: ${turn.hardFailures.join(",")}\n`);
    }
  }
}

async function main(): Promise<void> {
  const appChatUrl = assertLocalHttpUrl(
    process.env.RAVEN_EVAL_APP_CHAT_URL ?? DEFAULT_APP_CHAT_URL,
    "RAVEN_EVAL_APP_CHAT_URL",
  );
  const ollamaUrl = assertLocalHttpUrl(
    process.env.RAVEN_EVAL_OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    "RAVEN_EVAL_OLLAMA_URL",
  );
  const ravenModel = process.env.RAVEN_EVAL_RAVEN_MODEL ?? DEFAULT_RAVEN_MODEL;
  const userModel = process.env.RAVEN_EVAL_USER_MODEL ?? DEFAULT_USER_MODEL;
  const judgeModel = process.env.RAVEN_EVAL_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;
  const timeoutMs = Number(process.env.RAVEN_EVAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const directRoute = process.env.RAVEN_EVAL_DIRECT_ROUTE === "true";
  const scenarios = selectScenariosFromEnv(SCENARIOS);

  const allResults = [];
  for (const scenario of scenarios) {
    const result = await runScenario({
      scenario,
      appChatUrl,
      ollamaUrl,
      ravenModel,
      userModel,
      judgeModel,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
      directRoute,
    });
    printScenarioReport(result);
    allResults.push(result);
  }

  const totalTurns = allResults.reduce((sum, item) => sum + item.turns.length, 0);
  const totalScore = allResults.reduce(
    (sum, item) => sum + item.turns.reduce((turnSum, turn) => turnSum + turn.judge.score, 0),
    0,
  );
  const hardFailures = allResults.reduce((sum, item) => sum + item.hardFailureCount, 0);
  const averageScore = totalTurns > 0 ? Math.round(totalScore / totalTurns) : 0;
  process.stdout.write("\n=== Summary ===\n");
  process.stdout.write(`Total turns: ${totalTurns}\n`);
  process.stdout.write(`Average score: ${averageScore}\n`);
  process.stdout.write(`Hard failures: ${hardFailures}\n`);

  if (averageScore < 70 || hardFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
