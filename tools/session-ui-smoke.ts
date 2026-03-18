import { chromium, type Page } from "playwright";
type JsonRecord = Record<string, unknown>;
type UiSmokeMode = "task" | "game";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const TEST_HOOK_STORAGE_KEY = "raven.session.testHooks";
const CONSENT_STORAGE_KEY = "raven.consent";

function assertLocalBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid base URL: ${value}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error(`UI smoke only supports http URLs. Received: ${value}`);
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`UI smoke must target localhost only. Received: ${value}`);
  }

  return parsed.origin;
}

function logStep(message: string) {
  process.stdout.write(`${message}\n`);
}

async function readJson(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`Expected JSON response, received: ${text.slice(0, 300)}`);
  }
}

async function postJson(baseUrl: string, path: string, payload: JsonRecord): Promise<{ response: Response; body: JsonRecord }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  return { response, body };
}

async function resetTasks(baseUrl: string) {
  const result = await postJson(baseUrl, "/api/tasks", { action: "delete_all" });
  if (result.response.status !== 200) {
    throw new Error(`Task reset failed: ${result.response.status} ${JSON.stringify(result.body)}`);
  }
}

function parseArgs(): { baseUrl: string; mode: UiSmokeMode } {
  const arg = process.argv[2] ?? "";
  const envBaseUrl = process.env.RAVEN_SMOKE_BASE_URL;
  const envMode = process.env.RAVEN_UI_SMOKE_MODE;
  const mode = (envMode === "game" || arg === "game" ? "game" : "task") as UiSmokeMode;
  const rawBaseUrl = envBaseUrl ?? (arg && arg !== "game" ? arg : DEFAULT_BASE_URL);
  return { baseUrl: assertLocalBaseUrl(rawBaseUrl), mode };
}

async function submitUserResponse(page: Page, text: string) {
  const userResponseCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "User Response" }),
  }).first();
  await userResponseCard.waitFor({ state: "visible" });
  const input = userResponseCard.getByPlaceholder("Type a response for dynamic planning...");
  await input.fill(text);
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if ((await input.inputValue()) === text) {
      break;
    }
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(75);
  await userResponseCard.getByRole("button", { name: "Save Response" }).click();
}

function fieldStack(page: Page, label: string) {
  return page.locator("label.field-stack").filter({ has: page.getByText(label, { exact: true }) }).first();
}

async function waitForLatestRavenLine(
  page: Page,
  previousTopLine: string | null = null,
  previousCount = 0,
): Promise<{ text: string; count: number }> {
  const ravenOutputCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Raven Output" }),
  }).first();
  await ravenOutputCard.waitFor({ state: "visible" });
  const lines = ravenOutputCard.locator(".debug-line");
  const firstLine = lines.first();
  await firstLine.waitFor({ state: "visible" });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const count = await lines.count();
    const text = (await firstLine.textContent())?.trim() ?? "";
    if (text && (text !== previousTopLine || count > previousCount)) {
      return { text, count };
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Timed out waiting for Raven output to update.");
}

function deriveValidGameAnswers(text: string): { round1: string; round2: string } {
  const normalized = text.toLowerCase();
  if (normalized.includes("rock paper scissors")) {
    return { round1: "paper", round2: "rock" };
  }
  if (normalized.includes("number hunt")) {
    return { round1: "5", round2: "7" };
  }
  if (normalized.includes("number command")) {
    return { round1: "7", round2: "done" };
  }
  if (normalized.includes("math duel")) {
    return { round1: "11", round2: "15" };
  }
  if (normalized.includes("riddle lock")) {
    return { round1: "echo", round2: "map" };
  }
  return { round1: "paper", round2: "rock" };
}

async function runTaskUiSmoke(baseUrl: string) {
  const taskTitle = `UI Smoke Habit ${Date.now()}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.addInitScript(
      ([testHookKey, consentKey]) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem(testHookKey, "1");
        window.localStorage.setItem(
          consentKey,
          JSON.stringify({
            confirmedAdults: true,
            safeWord: "red",
            limits: "local test only",
            preferredStyle: "direct",
          }),
        );
      },
      [TEST_HOOK_STORAGE_KEY, CONSENT_STORAGE_KEY],
    );

    logStep("Resetting tasks");
    await resetTasks(baseUrl);

    logStep("Opening /session");
    await page.goto(`${baseUrl}/session`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Tasks and Progress" }).waitFor({ state: "visible" });

    logStep("Opening tasks page");
    await page.getByRole("link", { name: "Open Tasks Page" }).click();
    await page.waitForURL(/\/tasks(?:\?|$)/);
    await page.getByRole("heading", { name: "Homework Tasks" }).waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");

    logStep("Creating a habit through the UI");
    await page.getByLabel("Type").selectOption("habit");
    await page.getByLabel("Title").fill(taskTitle);
    await page.getByLabel("Description").fill("UI smoke review path");
    await page.getByLabel("Window minutes").fill("2");
    await page.getByLabel("Repeats").fill("1");
    await fieldStack(page, "Points").getByRole("textbox").fill("3");
    const scheduleSelect = page.locator("#task-schedule");
    await scheduleSelect.selectOption("daily");
    await page.waitForFunction(() => {
      const schedule = document.querySelector<HTMLSelectElement>("#task-schedule");
      const days = document.querySelector<HTMLInputElement>("#task-days");
      return schedule?.value === "daily" && Boolean(days) && days.offsetParent !== null;
    });
    await page.locator("#task-days").fill("1");
    await page.locator("#task-occurrences-per-day").fill("1");
    await page.getByRole("button", { name: "Create task" }).click();

    const taskCard = page.locator(".task-card").filter({
      has: page.getByText(taskTitle, { exact: true }),
      has: page.getByRole("button", { name: "Submit progress" }),
    }).first();
    await taskCard.waitFor({ state: "visible" });

    logStep("Submitting manual evidence");
    await taskCard.getByRole("button", { name: "Submit progress" }).click();

    logStep("Opening review page");
    await page.getByRole("link", { name: "Open Review Queue" }).click();
    await page.getByRole("heading", { name: "Evidence Review" }).waitFor({ state: "visible" });

    const pendingReviewItem = page
      .locator(".task-card")
      .filter({ has: page.getByText(taskTitle, { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Approve" }) })
      .first();
    await pendingReviewItem.waitFor({ state: "visible" });

    logStep("Approving evidence");
    await pendingReviewItem.getByRole("button", { name: "Approve" }).click();
    await pendingReviewItem.waitFor({ state: "detached" });

    logStep("Verifying occurrence moves to approved review state");
    const approvedOccurrence = page
      .locator(".task-card")
      .filter({ has: page.getByText(taskTitle, { exact: true }) })
      .filter({ hasText: "review=approved" })
      .first();
    await approvedOccurrence.waitFor({ state: "visible" });

    logStep("UI smoke passed.");
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await resetTasks(baseUrl).catch(() => undefined);
  }
}

async function runGameUiSmoke(baseUrl: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.addInitScript(
      ([testHookKey, consentKey]) => {
        window.localStorage.setItem(testHookKey, "1");
        window.localStorage.setItem(
          consentKey,
          JSON.stringify({
            confirmedAdults: true,
            safeWord: "red",
            limits: "local test only",
            preferredStyle: "direct",
          }),
        );
      },
      [TEST_HOOK_STORAGE_KEY, CONSENT_STORAGE_KEY],
    );

    logStep("Opening /session");
    await page.goto(`${baseUrl}/session`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "User Response" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Raven Output" }).waitFor({ state: "visible" });
    await page.waitForTimeout(1500);

    let lastLine: string | null = null;
    let lastLineCount = 0;

    logStep("Requesting a game");
    await submitUserResponse(page, "lets play a game");
    ({ text: lastLine, count: lastLineCount } = await waitForLatestRavenLine(
      page,
      lastLine,
      lastLineCount,
    ));

    if (!/\bi pick\b/i.test(lastLine) || !/listen carefully, pet|repeat this sequence exactly|first choice:/i.test(lastLine)) {
      logStep("Forcing Raven to choose the game");
      await submitUserResponse(page, "you pick");
      ({ text: lastLine, count: lastLineCount } = await waitForLatestRavenLine(
        page,
        lastLine,
        lastLineCount,
      ));
    }

    if (!/\bi pick\b/i.test(lastLine)) {
      throw new Error(`Expected Raven to choose a game. Received: ${lastLine}`);
    }
    if (!/listen carefully, pet|repeat this sequence exactly|first choice:/i.test(lastLine)) {
      throw new Error(`Expected first real game prompt in the same reply. Received: ${lastLine}`);
    }

    const answers = deriveValidGameAnswers(lastLine);

    logStep("Verifying filler does not advance the game");
    await submitUserResponse(page, "ok");
    const fillerUpdate = await waitForLatestRavenLine(page, lastLine, lastLineCount);
    const fillerReply = fillerUpdate.text;
    if (!/no stalling, pet/i.test(fillerReply)) {
      throw new Error(`Expected no-stalling correction. Received: ${fillerReply}`);
    }
    lastLine = fillerReply;
    lastLineCount = fillerUpdate.count;

    logStep("Submitting a valid first answer");
    await submitUserResponse(page, answers.round1);
    const secondPromptUpdate = await waitForLatestRavenLine(page, lastLine, lastLineCount);
    const secondPromptReply = secondPromptUpdate.text;
    if (!/keep up, pet|next word: chain|next choice: silence or focus|repeat this sequence exactly: lock, breath, line/i.test(secondPromptReply)) {
      throw new Error(`Expected second game prompt. Received: ${secondPromptReply}`);
    }
    lastLine = secondPromptReply;
    lastLineCount = secondPromptUpdate.count;

    logStep("Submitting a valid second answer");
    await submitUserResponse(page, answers.round2);
    const completionUpdate = await waitForLatestRavenLine(page, lastLine, lastLineCount);
    const completionReply = completionUpdate.text;
    if (!/that round is complete/i.test(completionReply)) {
      throw new Error(`Expected completion reply. Received: ${completionReply}`);
    }

    logStep("UI game smoke passed.");
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

const { baseUrl, mode } = parseArgs();
if (mode === "game") {
  await runGameUiSmoke(baseUrl);
} else {
  await runTaskUiSmoke(baseUrl);
}
