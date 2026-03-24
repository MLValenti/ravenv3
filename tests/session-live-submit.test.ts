import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

const TEST_BASE_URL = process.env.RAVEN_UI_BASE_URL?.trim() || "";

async function bootstrapSessionPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "raven.consent",
      JSON.stringify({
        confirmedAdults: true,
        safeWord: "red",
        limits: "local test only",
        preferredStyle: "direct",
      }),
    );
    window.localStorage.setItem(
      "raven.settings",
      JSON.stringify({
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaModel: "dolphin-llama3:8b",
        personaPackId: "default",
        toneProfile: "neutral",
        llmTemperature: 0.9,
        llmTopP: 0.9,
        llmTopK: 40,
        llmRepeatPenalty: 1.12,
        llmStopSequences: ["<|assistant_end|>"],
        visionBaseUrl: "http://127.0.0.1:7001",
        intifaceWsUrl: "ws://localhost:12345",
        ttsProvider: "browser",
        piperUrl: "http://127.0.0.1:7002",
        piperVoiceModelPath:
          "tools/tts/models/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx",
        pace: "slow",
        speechPauseMs: 500,
      }),
    );
    window.localStorage.setItem("raven.session.testHooks", "1");
  });

  await page.goto(`${TEST_BASE_URL}/session`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "User Response" }).waitFor({ state: "visible" });
  await page.waitForTimeout(1500);

  const userCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "User Response" }),
  }).first();
  const ravenCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Raven Output" }),
  }).first();
  const memoryCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Session Memory" }),
  }).first();

  return { browser, page, userCard, ravenCard, memoryCard };
}

async function bootstrapDynamicSessionPage() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "raven.consent",
      JSON.stringify({
        confirmedAdults: true,
        safeWord: "red",
        limits: "local test only",
        preferredStyle: "direct",
      }),
    );
    window.localStorage.setItem(
      "raven.settings",
      JSON.stringify({
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaModel: "dolphin-llama3:8b",
        personaPackId: "default",
        toneProfile: "neutral",
        llmTemperature: 0.9,
        llmTopP: 0.9,
        llmTopK: 40,
        llmRepeatPenalty: 1.12,
        llmStopSequences: ["<|assistant_end|>"],
        visionBaseUrl: "http://127.0.0.1:7001",
        intifaceWsUrl: "ws://localhost:12345",
        ttsProvider: "browser",
        piperUrl: "http://127.0.0.1:7002",
        piperVoiceModelPath:
          "tools/tts/models/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx",
        pace: "slow",
        speechPauseMs: 500,
      }),
    );
    window.localStorage.setItem("raven.session.testHooks", "1");
    window.localStorage.setItem("raven.session.debug", "1");
  });

  await page.goto(`${TEST_BASE_URL}/session`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "User Response" }).waitFor({ state: "visible" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Start Session" }).click();
  await page.waitForTimeout(1500);

  const userCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "User Response" }),
  }).first();
  const ravenCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Raven Output" }),
  }).first();
  const memoryCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Session Memory" }),
  }).first();
  const stepCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Current Step" }),
  }).first();

  return { browser, context, page, userCard, ravenCard, memoryCard, stepCard };
}

async function submitAndWaitForReply(
  page: import("playwright").Page,
  userCard: import("playwright").Locator,
  ravenCard: import("playwright").Locator,
  text: string,
  previousTopLine: string | null,
  previousCount: number,
): Promise<{ topLine: string; count: number }> {
  const input = userCard.getByPlaceholder("Type a response for dynamic planning...");
  await input.fill(text);
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Type a response for dynamic planning..."]',
      );
      return input?.value === expected;
    },
    text,
  );

  await Promise.all([
    page.waitForResponse((response) => {
      return response.url().includes("/api/chat") && response.request().method() === "POST";
    }),
    userCard.getByRole("button", { name: "Save Response" }).click(),
  ]);

  const lines = ravenCard.locator(".debug-line");
  const firstLine = lines.first();
  await firstLine.waitFor({ state: "visible" });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const count = await lines.count();
    const topLine = (await firstLine.textContent())?.trim() ?? "";
    if (topLine && (topLine !== previousTopLine || count > previousCount)) {
      return { topLine, count };
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for Raven output after user turn: ${text}`);
}

async function submitAndWaitForDynamicReply(
  page: import("playwright").Page,
  userCard: import("playwright").Locator,
  ravenCard: import("playwright").Locator,
  memoryCard: import("playwright").Locator,
  text: string,
  previousTopLine: string | null,
  previousLineCount: number,
): Promise<{ topLine: string; lineCount: number; memoryText: string }> {
  const input = userCard.getByPlaceholder("Type a response for dynamic planning...");
  await input.fill(text);
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Type a response for dynamic planning..."]',
      );
      return input?.value === expected;
    },
    text,
  );

  await userCard.getByRole("button", { name: "Save Response" }).click();

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const lines = await ravenCard.locator(".debug-line").allTextContents();
    const trimmed = lines.map((line) => line.trim()).filter(Boolean);
    const lineCount = trimmed.length;
    const topLine = trimmed[0] ?? "";
    const memoryText = (await memoryCard.textContent()) ?? "";
    if (topLine && (topLine !== previousTopLine || lineCount > previousLineCount)) {
      return { topLine, lineCount, memoryText };
    }
    await page.waitForTimeout(200);
  }

  const stepText = ((await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "Current Step" }),
    })
    .first()
    .textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  throw new Error(
    `Timed out waiting for dynamic Raven output after user turn: ${text}\nCurrent Step: ${stepText}`,
  );
}

test("successful /api/chat response renders in /session and updates session memory", async (t) => {
  if (!TEST_BASE_URL) {
    t.skip("Set RAVEN_UI_BASE_URL to run the live /session submit smoke test.");
    return;
  }

  const { browser, page, userCard, ravenCard, memoryCard } = await bootstrapSessionPage();

  try {
    const input = userCard.getByPlaceholder("Type a response for dynamic planning...");
    await input.fill("hello");
    await page.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Type a response for dynamic planning..."]');
      return input?.value === "hello";
    });

    const [chatResponse] = await Promise.all([
      page.waitForResponse((response) => {
        return response.url().includes("/api/chat") && response.request().method() === "POST";
      }),
      userCard.getByRole("button", { name: "Save Response" }).click(),
    ]);
    assert.equal(chatResponse.status(), 200);

    await page.waitForFunction(() => {
      const ravenCardHeading = Array.from(document.querySelectorAll("h2")).find(
        (node) => node.textContent?.trim() === "Raven Output",
      );
      const ravenCard = ravenCardHeading?.closest(".card");
      return Boolean(ravenCard && !/No output yet\./i.test(ravenCard.textContent ?? ""));
    });

    await page.waitForFunction(() => {
      const memoryHeading = Array.from(document.querySelectorAll("h2")).find(
        (node) => node.textContent?.trim() === "Session Memory",
      );
      const memoryCard = memoryHeading?.closest(".card");
      return Boolean(memoryCard && !/Session Memory\\s*- none/i.test(memoryCard.textContent ?? ""));
    });

    const ravenText = (await ravenCard.textContent()) ?? "";
    const memoryText = (await memoryCard.textContent()) ?? "";

    assert.match(ravenText, /Raven Output/i);
    assert.doesNotMatch(ravenText, /No output yet\./i);
    assert.match(memoryText, /conversation_mode/i);
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
});

test("session accepts five consecutive user turns and renders five consecutive replies", async (t) => {
  if (!TEST_BASE_URL) {
    t.skip("Set RAVEN_UI_BASE_URL to run the live /session conversation smoke test.");
    return;
  }

  const { browser, page, userCard, ravenCard, memoryCard } = await bootstrapSessionPage();
  const transcript = [
    "hi",
    "how are you?",
    "what do you want?",
    "say something real",
    "what do you mean?",
  ];
  const replies: { user: string; raven: string }[] = [];
  let previousTopLine: string | null = null;
  let previousCount = 0;

  try {
    for (const userText of transcript) {
      const update = await submitAndWaitForReply(
        page,
        userCard,
        ravenCard,
        userText,
        previousTopLine,
        previousCount,
      );
      previousTopLine = update.topLine;
      previousCount = update.count;
      replies.push({ user: userText, raven: update.topLine });
    }

    const ravenText = (await ravenCard.textContent()) ?? "";
    const memoryText = (await memoryCard.textContent()) ?? "";
    assert.equal(replies.length, 5);
    assert.doesNotMatch(ravenText, /No output yet\./i);
    assert.match(memoryText, /conversation_mode/i);

    for (const turn of replies) {
      assert.ok(turn.raven.trim().length > 0, `Missing Raven reply for user turn: ${turn.user}`);
    }
  } finally {
    console.log("session-live-submit transcript", JSON.stringify(replies, null, 2));
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
});

test("dynamic session accepts five consecutive user turns and renders five consecutive replies", async (t) => {
  if (!TEST_BASE_URL) {
    t.skip("Set RAVEN_UI_BASE_URL to run the live /session dynamic conversation smoke test.");
    return;
  }

  const { browser, context, page, userCard, ravenCard, memoryCard } =
    await bootstrapDynamicSessionPage();
  const transcript = ["hi", "how are you?", "i need training", "say something real", "what do you mean?"];
  const replies: { user: string; raven: string }[] = [];
  let previousTopLine: string | null = null;
  let previousLineCount = 0;

  try {
    for (const userText of transcript) {
      const update = await submitAndWaitForDynamicReply(
        page,
        userCard,
        ravenCard,
        memoryCard,
        userText,
        previousTopLine,
        previousLineCount,
      );
      previousTopLine = update.topLine;
      previousLineCount = update.lineCount;
      replies.push({ user: userText, raven: update.topLine });
      assert.match(update.memoryText, /conversation_mode/i);
    }

    const ravenText = (await ravenCard.textContent()) ?? "";
    assert.equal(replies.length, 5);
    assert.doesNotMatch(ravenText, /No output yet\./i);
    for (const turn of replies) {
      assert.ok(turn.raven.trim().length > 0, `Missing Raven reply for user turn: ${turn.user}`);
    }
  } finally {
    console.log("session-live-dynamic transcript", JSON.stringify(replies, null, 2));
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
});
