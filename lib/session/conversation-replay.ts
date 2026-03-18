import { chromium, type Page } from "playwright";
import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  createConversationStateSnapshot,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
  type ConversationStateSnapshot,
} from "../chat/conversation-state.ts";
import { buildHumanQuestionFallback } from "../chat/open-question.ts";
import {
  classifyCoreConversationMove,
  isStableCoreConversationMove,
} from "../chat/core-turn-move.ts";
import { buildTurnPlan } from "../chat/turn-plan.ts";
import { evaluateConversationTranscript } from "../chat/conversation-eval.ts";
import { evaluateTranscriptStyle, type TranscriptStyleEvaluation } from "./mode-style.ts";
import { shouldBypassModelForSceneTurn } from "./deterministic-scene-routing.ts";
import type { UserIntent } from "./intent-router.ts";
import {
  isAssistantSelfQuestion,
  isAssistantTrainingRequest,
  isChatSwitchRequest,
  isGoalOrIntentStatement,
  isMutualGettingToKnowRequest,
  isProfileSummaryRequest,
  type InteractionMode,
} from "./interaction-mode.ts";
import { applyResponseGate } from "./response-gate.ts";
import { buildSceneScaffoldReply } from "./scene-scaffolds.ts";
import {
  buildSceneFallback,
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
  type SceneState,
} from "./scene-state.ts";
import {
  createSessionMemory,
  traceWriteUserAnswer,
  traceWriteUserQuestion,
  type SessionMemory,
  type SessionMemoryWriteRecord,
} from "./session-memory.ts";
import { SESSION_INVENTORY_STORAGE_KEY, type SessionInventoryItem } from "./session-inventory.ts";
import {
  canCommitAnchoredAssistantTurn,
  canCommitAssistantReplay,
  markAssistantReplay,
  markAssistantTurnCommitted,
  normalizeAssistantCommitText,
  type AssistantCommitRecord,
  type AssistantReplayRecord,
} from "./assistant-turn-guard.ts";
import {
  canEmitAssistant,
  type TurnGateDecision,
} from "./turn-gate.ts";
import {
  createSessionStateContract,
  reduceAssistantEmission,
  reduceUserTurn,
  type SessionStateContract,
} from "./session-state-contract.ts";
import { createCommitmentState } from "./commitment-engine.ts";
import { buildShortClarificationReply } from "./short-follow-up.ts";
import { buildTopicFallback } from "./topic-fallback.ts";
import { finalizeTurnResponse, type TurnResponseFamily } from "./turn-response.ts";
import { resetDeterministicTaskVariantCursor } from "./task-script.ts";

export type ReplayScenarioCategory =
  | "greeting"
  | "open_chat"
  | "relational_meta"
  | "kink_chat"
  | "dominant_chat"
  | "toy_chat"
  | "creative_scenarios"
  | "profile_building"
  | "profile_summary"
  | "chat_switch"
  | "task"
  | "short_follow_up"
  | "mode_return";

export type ReplayExecutor = "synthetic" | "browser_live";

export type ReplayRunOptions = {
  executor?: ReplayExecutor;
  baseUrl?: string;
  headless?: boolean;
};

export type ReplayExpectedMemoryWrite = {
  key: SessionMemoryWriteRecord["key"];
  valueIncludes?: string;
  category?: SessionMemoryWriteRecord["category"];
};

export type ReplayTurnExpectation = {
  expectedInteractionMode?: InteractionMode;
  expectedConversationMode?: InteractionMode | "none";
  expectedWinningFamily?: TurnResponseFamily | "scene_fallback";
  blockedPhrases?: string[];
  requiredPhrasesAny?: string[];
  requiredPhrasesAll?: string[];
  expectedCommittedWrites?: ReplayExpectedMemoryWrite[];
  blockedCommittedWrites?: ReplayExpectedMemoryWrite[];
  expectedTaskPaused?: boolean;
  expectedLockActive?: boolean;
  requireSummaryBehavior?: boolean;
  requireSingleWinner?: boolean;
  requireContextTieBack?: boolean;
};

export type ReplayTurnDefinition = {
  user: string;
  simulatedModelReply?: string;
  expect?: ReplayTurnExpectation;
};

export type ReplayScenarioDefinition = {
  id: string;
  category: ReplayScenarioCategory;
  title: string;
  description: string;
  inventory?: SessionInventoryItem[];
  turns: ReplayTurnDefinition[];
};

export type ReplayCandidateTrace = {
  family: TurnResponseFamily | "scene_fallback";
  sourceFunction:
    | "buildShortClarificationReply"
    | "buildSceneScaffoldReply"
    | "buildSceneFallback"
    | "buildTopicFallback"
    | "simulatedModelReply"
    | "browserLiveTrace";
  text: string;
};

export type ReplayTurnTrace = {
  turnNumber: number;
  userInput: string;
  detectedIntent: UserIntent;
  dialogueAct: DialogueRouteAct;
  conversationMode: InteractionMode | "none";
  interactionMode: InteractionMode;
  memoryWritesAttempted: SessionMemoryWriteRecord[];
  memoryWritesCommitted: SessionMemoryWriteRecord[];
  candidateResponseFamilies: ReplayCandidateTrace[];
  winningResponseFamily: TurnResponseFamily | "scene_fallback";
  finalOutputSource: TurnResponseFamily | "scene_fallback";
  moreThanOneGeneratorFired: boolean;
  postProcessingModifiedOutput: boolean;
  fallbackUsed: boolean;
  fallbackReason: string;
  taskStatePaused: boolean;
  taskStateResumed: boolean;
  lockActive: boolean;
  summaryRouteSelected: boolean;
  profileQuestionRouteSelected: boolean;
  chatSwitchRouteSelected: boolean;
  shortFollowUpRouteSelected: boolean;
  oneOutputCommitted: boolean;
  duplicateReplayBlocked: boolean;
  turnGateDecision: TurnGateDecision;
  finalText: string;
};

export type ReplayViolation = {
  scenarioId: string;
  turnNumber: number;
  invariant: string;
  expected: string;
  actual: string;
  likelyCodePath: string | null;
};

export type ReplayScenarioResult = {
  executor: ReplayExecutor;
  scenario: ReplayScenarioDefinition;
  traces: ReplayTurnTrace[];
  conversationState: ConversationStateSnapshot;
  sceneState: SceneState;
  sessionMemory: SessionMemory;
  style: TranscriptStyleEvaluation;
  transcriptMetrics: ReturnType<typeof evaluateConversationTranscript>;
  violations: ReplayViolation[];
};

export type ReplayRunSummary = {
  scenarioCount: number;
  turnCount: number;
  violationCount: number;
  styles: {
    personaConsistency: number;
    confidence: number;
    directness: number;
    naturalness: number;
    cannedRepetition: number;
  };
};

type ReplayHarnessState = {
  contract: SessionStateContract;
  sceneState: SceneState;
  sessionMemory: SessionMemory;
  conversationState: ConversationStateSnapshot;
  outputs: string[];
  committedAssistantTurns: Map<number, AssistantCommitRecord>;
  lastAssistantReplay: AssistantReplayRecord | null;
};

type BrowserReplayEvent = {
  raw: string;
  label: string;
  detail: Record<string, unknown>;
};

const DEFAULT_REPLAY_BASE_URL = "http://127.0.0.1:3000";

function normalizeReplayText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function shouldDeterministicallyAnswerOpenQuestion(
  userText: string,
  sceneState: SceneState,
  dialogueAct: DialogueRouteAct,
): boolean {
  if (dialogueAct !== "user_question" || sceneState.task_hard_lock_active) {
    return false;
  }
  if (
    sceneState.interaction_mode === "profile_building" ||
    sceneState.active_training_thread.subject !== "none" ||
    sceneState.topic_type === "task_negotiation" ||
    sceneState.topic_type === "task_execution" ||
    sceneState.topic_type === "duration_negotiation" ||
    sceneState.topic_type === "task_terms_negotiation" ||
    sceneState.topic_type === "reward_negotiation" ||
    sceneState.topic_type === "reward_window" ||
    sceneState.topic_type === "game_setup" ||
    sceneState.topic_type === "game_execution" ||
    sceneState.topic_type === "verification_in_progress"
  ) {
    return false;
  }
  if (
    isAssistantTrainingRequest(userText) ||
    /\b(where should i put it|where does it go|where should it go|how should i use it|how would you use it|what would you do with it|what do i do with it|how do i use it|is it oral or anal|can i use it orally|can i use it anally)\b/i.test(
      userText,
    )
  ) {
    return false;
  }
  const wordCount = normalizeReplayText(userText).split(/\s+/).filter(Boolean).length;
  return wordCount <= 12;
}

function pushUniqueCandidate(
  candidates: ReplayCandidateTrace[],
  candidate: ReplayCandidateTrace | null,
): void {
  if (!candidate) {
    return;
  }
  const normalized = normalizeReplayText(candidate.text);
  if (candidates.some((existing) => normalizeReplayText(existing.text) === normalized)) {
    return;
  }
  candidates.push(candidate);
}
const SESSION_TEST_HOOK_STORAGE_KEY = "raven.session.testHooks";
const SESSION_DEBUG_STORAGE_KEY = "raven.session.debug";
const CONSENT_STORAGE_KEY = "raven.consent";

function resolveReplayExecutor(options?: ReplayRunOptions): ReplayExecutor {
  const requested = options?.executor ?? (process.env.RAVEN_REPLAY_EXECUTOR?.trim() as ReplayExecutor | "");
  return requested === "browser_live" ? "browser_live" : "synthetic";
}

function assertLocalReplayBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid replay base URL: ${value}`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(`Replay harness only supports http URLs. Received: ${value}`);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Replay harness must target localhost only. Received: ${value}`);
  }
  return parsed.origin;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function parseReplayEventLine(raw: string): BrowserReplayEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const closingBracketIndex = trimmed.indexOf("] ");
  const body = closingBracketIndex >= 0 ? trimmed.slice(closingBracketIndex + 2) : trimmed;
  const separatorIndex = body.indexOf(" - ");
  if (separatorIndex <= 0) {
    return null;
  }
  const label = body.slice(0, separatorIndex).trim();
  const detailText = body.slice(separatorIndex + 3).trim();
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(detailText) as Record<string, unknown>;
  } catch {
    detail = { raw_detail: detailText };
  }
  return {
    raw: trimmed,
    label,
    detail,
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asMemoryWrites(value: unknown): SessionMemoryWriteRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Partial<SessionMemoryWriteRecord>;
      if (typeof row.key !== "string" || typeof row.value !== "string") {
        return null;
      }
      return {
        key: row.key,
        value: row.value,
        kind: typeof row.kind === "string" ? row.kind : undefined,
        category: typeof row.category === "string" ? row.category : undefined,
      } satisfies SessionMemoryWriteRecord;
    })
    .filter((entry): entry is SessionMemoryWriteRecord => entry !== null);
}

async function readEventFeedEntries(page: Page): Promise<BrowserReplayEvent[]> {
  const feedCard = page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "Event Feed (last 50)" }) })
    .first();
  await feedCard.waitFor({ state: "visible" });
  const lines = await feedCard.locator(".debug-line").allTextContents();
  return lines
    .map((line) => parseReplayEventLine(line))
    .filter((entry): entry is BrowserReplayEvent => entry !== null);
}

async function submitReplayUserResponse(page: Page, text: string): Promise<void> {
  const userResponseCard = page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "User Response" }) })
    .first();
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

async function prepareBrowserReplayPage(
  baseUrl: string,
  headless: boolean,
  inventory?: SessionInventoryItem[],
): Promise<Page> {
  const browser = await chromium.launch({
    headless,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  await page.addInitScript(
    ([testHookKey, debugKey, consentKey, inventoryStorageKey, initialInventory]) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(testHookKey, "1");
      window.localStorage.setItem(debugKey, "1");
      window.localStorage.setItem(inventoryStorageKey, JSON.stringify(initialInventory ?? []));
      window.localStorage.setItem(
        consentKey,
        JSON.stringify({
          confirmedAdults: true,
          safeWord: "red",
          limits: "local replay only",
          preferredStyle: "direct",
        }),
      );
    },
    [
      SESSION_TEST_HOOK_STORAGE_KEY,
      SESSION_DEBUG_STORAGE_KEY,
      CONSENT_STORAGE_KEY,
      SESSION_INVENTORY_STORAGE_KEY,
      inventory ?? [],
    ],
  );
  await page.goto(`${baseUrl}/session`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([inventoryStorageKey, initialInventory]) => {
      window.localStorage.setItem(inventoryStorageKey, JSON.stringify(initialInventory ?? []));
    },
    [SESSION_INVENTORY_STORAGE_KEY, inventory ?? []],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "User Response" }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Raven Output" }).waitFor({ state: "visible" });
  if ((inventory?.length ?? 0) > 0) {
    const inventoryCard = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Session Inventory" }) })
      .first();
    await inventoryCard.waitFor({ state: "visible" });
    await page.waitForFunction(
      (expectedInventory) => {
        const cards = Array.from(document.querySelectorAll(".card"));
        const inventoryCardElement = cards.find((card) =>
          card.textContent?.includes("Session Inventory"),
        );
        if (!inventoryCardElement) {
          return false;
        }
        const text = inventoryCardElement.textContent ?? "";
        return expectedInventory.every((item) => {
          const label = typeof item.label === "string" ? item.label : "";
          const notes = typeof item.notes === "string" ? item.notes : "";
          return (label && text.includes(label)) || (notes && text.includes(notes));
        });
      },
      inventory,
    );
  }
  await page.waitForTimeout(1500);
  return page;
}

async function collectBrowserTurnEvents(
  page: Page,
  beforeEntries: BrowserReplayEvent[],
): Promise<BrowserReplayEvent[]> {
  const seen = new Set(beforeEntries.map((entry) => entry.raw));
  const deadline = Date.now() + 20_000;
  let matched: BrowserReplayEvent[] = [];
  let acceptedUserMessageId: number | null = null;
  let acceptedRequestId: string | null = null;
  let retainedAcceptedEntry: BrowserReplayEvent | null = null;
  let stableSinceMs: number | null = null;

  while (Date.now() < deadline) {
    const allEntries = await readEventFeedEntries(page);
    const fresh = allEntries.filter((entry) => !seen.has(entry.raw));
    const acceptedEntry =
      fresh.find((entry) => entry.label === "turn.accepted") ?? null;
    if (acceptedEntry) {
      retainedAcceptedEntry = acceptedEntry;
      acceptedUserMessageId = asNumber(acceptedEntry.detail.user_message_id);
      acceptedRequestId = asString(acceptedEntry.detail.request_id, "");
    }
    if (acceptedUserMessageId !== null || acceptedRequestId) {
      matched = fresh.filter((entry) => {
        const eventUserMessageId = asNumber(entry.detail.user_message_id);
        const eventRequestId = asString(entry.detail.request_id, "");
        return (
          (acceptedUserMessageId !== null && eventUserMessageId === acceptedUserMessageId) ||
          (acceptedRequestId.length > 0 && eventRequestId === acceptedRequestId)
        );
      });
      const hasCommitted = matched.some((entry) => entry.label === "turn.append.committed");
      const hasSelected = matched.some((entry) => entry.label === "turn.response.selected");
      if (hasCommitted && hasSelected) {
        if (retainedAcceptedEntry && !matched.some((entry) => entry.raw === retainedAcceptedEntry.raw)) {
          matched = [...matched, retainedAcceptedEntry];
        }
        if (stableSinceMs === null) {
          stableSinceMs = Date.now();
        }
        if (Date.now() - stableSinceMs >= 900) {
          return matched;
        }
      } else {
        stableSinceMs = null;
      }
    }
    await page.waitForTimeout(100);
  }

  return matched;
}

function includesNeedle(haystack: string, needle: string): boolean {
  return normalize(haystack).toLowerCase().includes(normalize(needle).toLowerCase());
}

function matchesExpectedMemoryWrite(
  write: SessionMemoryWriteRecord,
  expected: ReplayExpectedMemoryWrite,
): boolean {
  if (write.key !== expected.key) {
    return false;
  }
  if (expected.category && write.category !== expected.category) {
    return false;
  }
  if (expected.valueIncludes && !includesNeedle(write.value, expected.valueIncludes)) {
    return false;
  }
  return true;
}

function buildLikelyCodePath(trace: ReplayTurnTrace, invariant: string): string | null {
  if (invariant.startsWith("memory.")) {
    return "lib/session/session-memory.ts";
  }
  if (trace.finalOutputSource === "response_gate_fallback" || trace.fallbackUsed) {
    return "lib/session/response-gate.ts";
  }
  if (trace.winningResponseFamily === "scene_fallback") {
    const fallbackCandidate = trace.candidateResponseFamilies.find((candidate) => candidate.family === "scene_fallback");
    if (fallbackCandidate?.sourceFunction === "buildSceneFallback") {
      return "lib/session/scene-state.ts";
    }
    if (fallbackCandidate?.sourceFunction === "buildTopicFallback") {
      return "lib/session/topic-fallback.ts";
    }
  }
  if (trace.winningResponseFamily === "deterministic_scene") {
    return "lib/session/scene-scaffolds.ts";
  }
  if (trace.postProcessingModifiedOutput) {
    return "lib/session/turn-response.ts";
  }
  return null;
}

function addViolation(
  violations: ReplayViolation[],
  scenario: ReplayScenarioDefinition,
  trace: ReplayTurnTrace,
  invariant: string,
  expected: string,
  actual: string,
): void {
  violations.push({
    scenarioId: scenario.id,
    turnNumber: trace.turnNumber,
    invariant,
    expected,
    actual,
    likelyCodePath: buildLikelyCodePath(trace, invariant),
  });
}

function evaluateGlobalInvariants(
  scenario: ReplayScenarioDefinition,
  trace: ReplayTurnTrace,
  violations: ReplayViolation[],
): void {
  if (!trace.finalOutputSource) {
    addViolation(violations, scenario, trace, "final_output_source", "a singular final output source", "missing");
  }
  if (trace.moreThanOneGeneratorFired) {
    addViolation(
      violations,
      scenario,
      trace,
      "one_winning_response_family",
      "one winning response family",
      trace.candidateResponseFamilies.map((candidate) => `${candidate.family}:${candidate.sourceFunction}`).join(", "),
    );
  }
  if (!trace.oneOutputCommitted) {
    addViolation(
      violations,
      scenario,
      trace,
      "single_output_commit",
      "exactly one committed assistant output",
      trace.turnGateDecision.reason,
    );
  }
  if (
    trace.interactionMode === "profile_building" &&
    !trace.lockActive &&
    /\b(here is your task|task:|start now|put it on now|reply done|check in once halfway through)\b/i.test(
      trace.finalText,
    )
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "profile_mode_no_task_language",
      "no task language in profile_building without a lock",
      trace.finalText,
    );
  }
  if (
    trace.summaryRouteSelected &&
    /\b(what should i call you|what do you enjoy|what should i know about you|what boundaries)\b/i.test(
      trace.finalText,
    )
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "summary_turn_no_profile_questions",
      "profile summary instead of a profile question",
      trace.finalText,
    );
  }
  if (
    trace.shortFollowUpRouteSelected &&
    /\b(what do you actually want from this|you're here\. speak plainly\. what do you want|my little pet returns|stay with the current thread)\b/i.test(
      trace.finalText,
    )
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "short_follow_up_no_reset",
      "short clarification without reset lines",
      trace.finalText,
    );
  }
  if (
    isChatSwitchRequest(trace.userInput) &&
    trace.memoryWritesCommitted.some((write) => write.key === "user_profile_facts")
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "memory.chat_switch_not_profile_fact",
      "chat-switch request should not write user_profile_facts",
      trace.memoryWritesCommitted.map((write) => `${write.key}:${write.value}`).join(" | "),
    );
  }
  if (
    isGoalOrIntentStatement(trace.userInput) &&
    trace.memoryWritesCommitted.some(
      (write) => write.key === "user_profile_facts" && write.category === "other",
    )
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "memory.intent_not_generic_profile_fact",
      "session intent should not be stored as generic other profile fact",
      trace.memoryWritesCommitted.map((write) => `${write.key}:${write.value}`).join(" | "),
    );
  }
}

function evaluateTurnExpectation(
  scenario: ReplayScenarioDefinition,
  trace: ReplayTurnTrace,
  expectation: ReplayTurnExpectation | undefined,
  violations: ReplayViolation[],
): void {
  if (!expectation) {
    return;
  }

  if (
    expectation.expectedInteractionMode &&
    trace.interactionMode !== expectation.expectedInteractionMode
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "mode.interaction",
      expectation.expectedInteractionMode,
      trace.interactionMode,
    );
  }

  if (
    expectation.expectedConversationMode &&
    trace.conversationMode !== expectation.expectedConversationMode
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "mode.conversation",
      expectation.expectedConversationMode,
      trace.conversationMode,
    );
  }

  if (
    expectation.expectedWinningFamily &&
    trace.finalOutputSource !== expectation.expectedWinningFamily
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "response_family",
      expectation.expectedWinningFamily,
      trace.finalOutputSource,
    );
  }

  for (const phrase of expectation.blockedPhrases ?? []) {
    if (includesNeedle(trace.finalText, phrase)) {
      addViolation(
        violations,
        scenario,
        trace,
        "blocked_phrase",
        `not to include "${phrase}"`,
        trace.finalText,
      );
    }
  }

  if (
    expectation.requiredPhrasesAny &&
    expectation.requiredPhrasesAny.length > 0 &&
    !expectation.requiredPhrasesAny.some((phrase) => includesNeedle(trace.finalText, phrase))
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "required_phrase_any",
      expectation.requiredPhrasesAny.join(" | "),
      trace.finalText,
    );
  }

  for (const phrase of expectation.requiredPhrasesAll ?? []) {
    if (!includesNeedle(trace.finalText, phrase)) {
      addViolation(
        violations,
        scenario,
        trace,
        "required_phrase_all",
        phrase,
        trace.finalText,
      );
    }
  }

  for (const expectedWrite of expectation.expectedCommittedWrites ?? []) {
    if (!trace.memoryWritesCommitted.some((write) => matchesExpectedMemoryWrite(write, expectedWrite))) {
      addViolation(
        violations,
        scenario,
        trace,
        "memory.expected_write",
        `${expectedWrite.key}:${expectedWrite.valueIncludes ?? expectedWrite.category ?? "present"}`,
        trace.memoryWritesCommitted.map((write) => `${write.key}:${write.value}`).join(" | ") || "none",
      );
    }
  }

  for (const blockedWrite of expectation.blockedCommittedWrites ?? []) {
    if (trace.memoryWritesCommitted.some((write) => matchesExpectedMemoryWrite(write, blockedWrite))) {
      addViolation(
        violations,
        scenario,
        trace,
        "memory.blocked_write",
        `no ${blockedWrite.key}:${blockedWrite.valueIncludes ?? blockedWrite.category ?? "match"}`,
        trace.memoryWritesCommitted.map((write) => `${write.key}:${write.value}`).join(" | "),
      );
    }
  }

  if (
    typeof expectation.expectedTaskPaused === "boolean" &&
    trace.taskStatePaused !== expectation.expectedTaskPaused
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "task.pause_state",
      String(expectation.expectedTaskPaused),
      String(trace.taskStatePaused),
    );
  }

  if (
    typeof expectation.expectedLockActive === "boolean" &&
    trace.lockActive !== expectation.expectedLockActive
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "task.lock_state",
      String(expectation.expectedLockActive),
      String(trace.lockActive),
    );
  }

  if (expectation.requireSummaryBehavior && !trace.summaryRouteSelected) {
    addViolation(
      violations,
      scenario,
      trace,
      "summary.route_selected",
      "summary route to be selected",
      trace.finalOutputSource,
    );
  }

  if (expectation.requireSingleWinner && trace.moreThanOneGeneratorFired) {
    addViolation(
      violations,
      scenario,
      trace,
      "single_winner",
      "one response family",
      trace.candidateResponseFamilies.map((candidate) => `${candidate.family}:${candidate.sourceFunction}`).join(", "),
    );
  }

  if (
    expectation.requireContextTieBack &&
    !/\b(that|it|part|name|aftercare|morning|game|task|device|golf|useful|miss about you|you can do for me|you can actually do for me)\b/i.test(
      trace.finalText,
    )
  ) {
    addViolation(
      violations,
      scenario,
      trace,
      "context.tie_back",
      "clarification tied to recent context",
      trace.finalText,
    );
  }
}

function buildFallbackCandidate(
  sceneState: SceneState,
  routeAct: DialogueRouteAct,
  userText: string,
  sessionMemory: SessionMemory,
  inventory: SessionInventoryItem[] | undefined,
  contract: SessionStateContract,
): ReplayCandidateTrace {
  const sceneFallback = buildSceneFallback(sceneState, userText, sessionMemory, inventory);
  if (sceneFallback) {
    return {
      family: "scene_fallback",
      sourceFunction: "buildSceneFallback",
      text: sceneFallback,
    };
  }
  return {
    family: "scene_fallback",
    sourceFunction: "buildTopicFallback",
    text: buildTopicFallback(routeAct, userText, contract.workingMemory, sceneState),
  };
}

function buildWinningTrace(input: {
  turnNumber: number;
  userInput: string;
  detectedIntent: UserIntent;
  dialogueAct: DialogueRouteAct;
  sessionMemory: SessionMemory;
  previousSceneState: SceneState;
  sceneState: SceneState;
  memoryWritesAttempted: SessionMemoryWriteRecord[];
  memoryWritesCommitted: SessionMemoryWriteRecord[];
  candidates: ReplayCandidateTrace[];
  winningResponseFamily: TurnResponseFamily | "scene_fallback";
  responseGateForced: boolean;
  responseGateReason: string;
  finalOutputSource: TurnResponseFamily | "scene_fallback";
  moreThanOneGeneratorFired: boolean;
  postProcessingModifiedOutput: boolean;
  summaryRouteSelected: boolean;
  profileQuestionRouteSelected: boolean;
  chatSwitchRouteSelected: boolean;
  shortFollowUpRouteSelected: boolean;
  oneOutputCommitted: boolean;
  duplicateReplayBlocked: boolean;
  turnGateDecision: TurnGateDecision;
  finalText: string;
}): ReplayTurnTrace {
  return {
    turnNumber: input.turnNumber,
    userInput: input.userInput,
    detectedIntent: input.detectedIntent,
    dialogueAct: input.dialogueAct,
    conversationMode: (input.sessionMemory.conversation_mode?.value as InteractionMode | undefined) ?? "none",
    interactionMode: input.sceneState.interaction_mode,
    memoryWritesAttempted: input.memoryWritesAttempted,
    memoryWritesCommitted: input.memoryWritesCommitted,
    candidateResponseFamilies: input.candidates,
    winningResponseFamily: input.winningResponseFamily,
    finalOutputSource: input.finalOutputSource,
    moreThanOneGeneratorFired: input.moreThanOneGeneratorFired,
    postProcessingModifiedOutput: input.postProcessingModifiedOutput,
    fallbackUsed: input.responseGateForced || input.winningResponseFamily === "scene_fallback",
    fallbackReason: input.responseGateReason,
    taskStatePaused: !input.previousSceneState.task_paused && input.sceneState.task_paused,
    taskStateResumed: input.previousSceneState.task_paused && !input.sceneState.task_paused,
    lockActive:
      input.sceneState.task_hard_lock_active &&
      input.sceneState.topic_type === "task_execution" &&
      input.sceneState.task_progress !== "completed",
    summaryRouteSelected: input.summaryRouteSelected,
    profileQuestionRouteSelected: input.profileQuestionRouteSelected,
    chatSwitchRouteSelected: input.chatSwitchRouteSelected,
    shortFollowUpRouteSelected: input.shortFollowUpRouteSelected,
    oneOutputCommitted: input.oneOutputCommitted,
    duplicateReplayBlocked: input.duplicateReplayBlocked,
    turnGateDecision: input.turnGateDecision,
    finalText: input.finalText,
  };
}

async function replayConversationScenarioSynthetic(
  scenario: ReplayScenarioDefinition,
): Promise<ReplayScenarioResult> {
  const state: ReplayHarnessState = {
    contract: createSessionStateContract(`replay-${scenario.id}`),
    sceneState: createSceneState(),
    sessionMemory: createSessionMemory(),
    conversationState: createConversationStateSnapshot(`replay-${scenario.id}`),
    outputs: [],
    committedAssistantTurns: new Map<number, AssistantCommitRecord>(),
    lastAssistantReplay: null,
  };
  const traces: ReplayTurnTrace[] = [];
  const violations: ReplayViolation[] = [];

  for (const [index, turn] of scenario.turns.entries()) {
    const turnNumber = index + 1;
    const previousSceneState = state.sceneState;
    const reduced = reduceUserTurn(state.contract, {
      text: turn.user,
      nowMs: turnNumber * 1000,
    });
    state.contract = reduced.next;

    const memoryTrace =
      reduced.intent === "user_question" ||
      reduced.intent === "user_short_follow_up" ||
      reduced.intent === "user_refusal_or_confusion"
        ? traceWriteUserQuestion(state.sessionMemory, turn.user, turnNumber * 1000, 0.9)
        : reduced.intent === "user_answer"
          ? traceWriteUserAnswer(state.sessionMemory, turn.user, turnNumber * 1000, null, 0.88)
          : { memory: state.sessionMemory, attempted: [], committed: [] };
    state.sessionMemory = memoryTrace.memory;
    state.conversationState = noteConversationUserTurn(state.conversationState, {
      text: turn.user,
      userIntent: reduced.intent,
      routeAct: reduced.route.act,
      nowMs: turnNumber * 1000,
    });
    state.sceneState = noteSceneStateUserTurn(state.sceneState, {
      text: turn.user,
      act: reduced.route.act,
      sessionTopic: reduced.route.nextTopic,
      inventory: scenario.inventory,
    });

    const summaryRouteSelected = isProfileSummaryRequest(turn.user);
    const chatSwitchRouteSelected =
      isChatSwitchRequest(turn.user) && !state.sceneState.task_hard_lock_active;
    const shortFollowUpRouteSelected = reduced.route.act === "short_follow_up";
    const relationalRouteSelected =
      (isAssistantSelfQuestion(turn.user) || isMutualGettingToKnowRequest(turn.user)) &&
      !state.sceneState.task_hard_lock_active;
    const conversationMove = classifyCoreConversationMove({
      userText: turn.user,
      previousAssistantText: state.outputs[state.outputs.length - 1] ?? null,
      currentTopic:
        state.contract.workingMemory.current_topic !== "none"
          ? state.contract.workingMemory.current_topic
          : null,
    });

    const candidates: ReplayCandidateTrace[] = [];
    const deterministicQuestionReply =
      !relationalRouteSelected &&
      shouldDeterministicallyAnswerOpenQuestion(
        turn.user,
        state.sceneState,
        reduced.route.act,
      )
        ? buildHumanQuestionFallback(turn.user, "neutral", {
            previousAssistantText: state.outputs[state.outputs.length - 1] ?? null,
            currentTopic:
              state.contract.workingMemory.current_topic !== "none"
                ? state.contract.workingMemory.current_topic
                : state.sceneState.agreed_goal || null,
          })
        : null;
    if (deterministicQuestionReply) {
      pushUniqueCandidate(candidates, {
        family: "deterministic_scene",
        sourceFunction: "buildHumanQuestionFallback",
        text: deterministicQuestionReply,
      });
    }

    const scaffolded = relationalRouteSelected
      ? null
      : buildSceneScaffoldReply({
          act: reduced.route.act,
          userText: turn.user,
          sceneState: state.sceneState,
          sessionMemory: state.sessionMemory,
          inventory: scenario.inventory,
          recentTaskTemplates:
            state.sceneState.task_progress !== "none"
              ? [state.sceneState.task_template_id]
              : [],
        });
    if (scaffolded) {
      pushUniqueCandidate(candidates, {
        family: "deterministic_scene",
        sourceFunction: "buildSceneScaffoldReply",
        text: scaffolded,
      });
    }

    const shortFollowUpReply =
      shortFollowUpRouteSelected && !scaffolded
        ? buildShortClarificationReply({
            userText: turn.user,
            interactionMode: previousSceneState.interaction_mode,
            topicType: previousSceneState.topic_type,
            lastQuestion: state.sessionMemory.last_user_question?.value ?? null,
            lastAssistantText:
              state.outputs[state.outputs.length - 1] ??
              previousSceneState.last_profile_prompt ??
              null,
            lastUserAnswer: state.sessionMemory.last_user_answer?.value ?? null,
            currentTopic:
              state.contract.workingMemory.current_topic !== "none"
                ? state.contract.workingMemory.current_topic
                : state.sceneState.agreed_goal || null,
          })
        : null;
    if (shortFollowUpReply) {
      pushUniqueCandidate(candidates, {
        family: "deterministic_scene",
        sourceFunction: "buildShortClarificationReply",
        text: shortFollowUpReply,
      });
    }

    const fallbackCandidate = buildFallbackCandidate(
      state.sceneState,
      reduced.route.act,
      turn.user,
      state.sessionMemory,
      scenario.inventory,
      state.contract,
    );
    pushUniqueCandidate(candidates, fallbackCandidate);

    if (turn.simulatedModelReply) {
      pushUniqueCandidate(candidates, {
        family: "model",
        sourceFunction: "simulatedModelReply",
        text: turn.simulatedModelReply,
      });
    }

    const deterministicCandidate = scaffolded ?? shortFollowUpReply ?? deterministicQuestionReply;
    const forceDeterministicConversationReply =
      summaryRouteSelected ||
      chatSwitchRouteSelected ||
      shortFollowUpRouteSelected ||
      Boolean(deterministicQuestionReply) ||
      isStableCoreConversationMove(conversationMove);
    const bypassModel =
      forceDeterministicConversationReply ||
      shouldBypassModelForSceneTurn({
        sceneState: state.sceneState,
        dialogueAct: reduced.route.act,
        hasDeterministicCandidate: Boolean(deterministicCandidate),
      });

    const selectedCandidate =
      !bypassModel && turn.simulatedModelReply
        ? candidates.find((candidate) => candidate.sourceFunction === "simulatedModelReply") ?? fallbackCandidate
        : deterministicCandidate
          ? candidates.find((candidate) => candidate.text === deterministicCandidate) ?? fallbackCandidate
          : fallbackCandidate;

    const availableFamilies: TurnResponseFamily[] = [];
    if (shortFollowUpReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (deterministicQuestionReply) {
      availableFamilies.push("deterministic_scene");
    }
    if (scaffolded) {
      availableFamilies.push("deterministic_scene");
    }
    if (!bypassModel && turn.simulatedModelReply) {
      availableFamilies.push("model");
    }
    if (!deterministicCandidate && (!turn.simulatedModelReply || bypassModel)) {
      availableFamilies.push("scene_fallback");
    }
    const turnPlan = buildTurnPlan(
      state.conversationState.recent_window.map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
      {
        conversationState: state.conversationState,
      },
    );

    const responseGate = applyResponseGate({
      text: selectedCandidate.text,
      userText: turn.user,
      dialogueAct: reduced.route.act,
      lastAssistantText: state.outputs[state.outputs.length - 1] ?? null,
      turnPlan,
      sceneState: state.sceneState,
      commitmentState: createCommitmentState(),
      sessionMemory: state.sessionMemory,
      inventory: scenario.inventory ?? [],
    });

    const selectedFamily: TurnResponseFamily | "scene_fallback" =
      !bypassModel && turn.simulatedModelReply
        ? "model"
        : deterministicCandidate
          ? "deterministic_scene"
          : "scene_fallback";

    const profileQuestionRouteSelected =
      !summaryRouteSelected &&
      !chatSwitchRouteSelected &&
      !shortFollowUpRouteSelected &&
      state.sceneState.interaction_mode === "profile_building" &&
      selectedFamily !== "model" &&
      /\?/.test(responseGate.text);

    const finalized = finalizeTurnResponse({
      text: responseGate.text,
      userText: turn.user,
      nextTurnId: state.contract.turnGate.lastAssistantTurnId + 1,
      phase: "build",
      memory: state.sessionMemory,
      interactionMode: state.sceneState.interaction_mode,
      selectedFamily: selectedFamily === "scene_fallback" ? "scene_fallback" : selectedFamily,
      availableFamilies,
      responseGateForced: responseGate.forced,
      responseMode: shortFollowUpRouteSelected ? "short_follow_up" : "default",
    });

    const anchorUserMessageId = state.contract.turnGate.lastUserMessageId;
    const replayDecision = canCommitAssistantReplay(
      state.lastAssistantReplay,
      anchorUserMessageId,
      finalized.text,
    );
    const commitDecision = canCommitAnchoredAssistantTurn(
      state.committedAssistantTurns,
      anchorUserMessageId,
      `replay-${scenario.id}-${turnNumber}`,
      finalized.text,
    );
    const turnGateDecision = canEmitAssistant(
      state.contract.turnGate,
      `replay-${scenario.id}-${turnNumber}`,
      finalized.text,
    );

    const oneOutputCommitted =
      replayDecision.allow && commitDecision.allow && turnGateDecision.allow;
    if (oneOutputCommitted) {
      markAssistantTurnCommitted(
        state.committedAssistantTurns,
        {
          requestId: `replay-${scenario.id}-${turnNumber}`,
          sourceUserMessageId: anchorUserMessageId,
        },
        normalizeAssistantCommitText(finalized.text),
      );
      state.lastAssistantReplay = markAssistantReplay(
        anchorUserMessageId,
        normalizeAssistantCommitText(finalized.text),
      );
      state.contract = reduceAssistantEmission(state.contract, {
        stepId: `replay-${scenario.id}-${turnNumber}`,
        content: finalized.text,
        isQuestion: finalized.text.includes("?"),
      });
      const resolvesTopic =
        state.contract.sessionTopic?.topic_type === "game_selection" &&
        /(here is the game|we are doing|i pick\b|i will choose\b)/i.test(finalized.text);
      state.sceneState = noteSceneStateAssistantTurn(state.sceneState, {
        text: finalized.text,
        commitment: finalized.text,
        topicResolved: resolvesTopic,
      });
      state.conversationState = noteConversationAssistantTurn(state.conversationState, {
        text: finalized.text,
        ravenIntent: reduced.route.act,
        nowMs: turnNumber * 1000 + 1,
      });
      state.outputs.push(finalized.text);
    }

    const trace = buildWinningTrace({
      turnNumber,
      userInput: turn.user,
      detectedIntent: reduced.intent,
      dialogueAct: reduced.route.act,
      sessionMemory: state.sessionMemory,
      previousSceneState,
      sceneState: state.sceneState,
      memoryWritesAttempted: memoryTrace.attempted,
      memoryWritesCommitted: memoryTrace.committed,
      candidates,
      winningResponseFamily: selectedFamily,
      responseGateForced: responseGate.forced,
      responseGateReason: responseGate.reason,
      finalOutputSource: finalized.finalOutputSource,
      moreThanOneGeneratorFired: finalized.multipleGeneratorsFired,
      postProcessingModifiedOutput: normalize(finalized.text) !== normalize(responseGate.text),
      summaryRouteSelected,
      profileQuestionRouteSelected,
      chatSwitchRouteSelected,
      shortFollowUpRouteSelected,
      oneOutputCommitted,
      duplicateReplayBlocked: !replayDecision.allow || !commitDecision.allow,
      turnGateDecision,
      finalText: finalized.text,
    });
    traces.push(trace);
    evaluateGlobalInvariants(scenario, trace, violations);
    evaluateTurnExpectation(scenario, trace, turn.expect, violations);
  }

  const transcriptTurns = traces.map((trace) => ({
    user: trace.userInput,
    raven: trace.finalText,
  }));
  const style = evaluateTranscriptStyle({
    mode: state.sceneState.interaction_mode,
    assistantTurns: traces.map((trace) => trace.finalText),
  });
  const transcriptMetrics = evaluateConversationTranscript({
    turns: transcriptTurns,
    state: state.conversationState,
  });

  return {
    executor: "synthetic",
    scenario,
    traces,
    conversationState: state.conversationState,
    sceneState: state.sceneState,
    sessionMemory: state.sessionMemory,
    style,
    transcriptMetrics,
    violations,
  };
}

async function replayConversationScenarioBrowserLive(
  scenario: ReplayScenarioDefinition,
  options?: ReplayRunOptions,
): Promise<ReplayScenarioResult> {
  const baseUrl = assertLocalReplayBaseUrl(options?.baseUrl ?? process.env.RAVEN_REPLAY_BASE_URL ?? DEFAULT_REPLAY_BASE_URL);
  const page = await prepareBrowserReplayPage(baseUrl, options?.headless ?? true, scenario.inventory);
  const traces: ReplayTurnTrace[] = [];
  const violations: ReplayViolation[] = [];
  const placeholderConversationState = createConversationStateSnapshot(`browser-replay-${scenario.id}`);
  const placeholderSceneState = createSceneState();
  const placeholderSessionMemory = createSessionMemory();

  try {
    for (const [index, turn] of scenario.turns.entries()) {
      const beforeEntries = await readEventFeedEntries(page);
      await submitReplayUserResponse(page, turn.user);
      const turnEvents = await collectBrowserTurnEvents(page, beforeEntries);
      const acceptedEvent =
        turnEvents.find((entry) => entry.label === "turn.accepted") ?? null;
      const selectedEvents = turnEvents.filter((entry) => entry.label === "turn.response.selected");
      const committedEvents = turnEvents.filter((entry) => entry.label === "turn.append.committed");
      const blockedEvents = turnEvents.filter((entry) => entry.label === "turn.append.blocked");
      const selectedEvent = selectedEvents[0] ?? null;
      const userMessageId = asNumber(acceptedEvent?.detail.user_message_id) ?? index + 1;
      const outputFamilies = asStringArray(selectedEvent?.detail.output_generator_families);
      const committedTexts = [...committedEvents]
        .reverse()
        .map((entry) => asString(entry.detail.committed_text, ""))
        .filter((text) => text.length > 0);
      const finalText = committedTexts.join("\n");
      const finalOutputSource = asString(
        selectedEvent?.detail.final_output_source ?? committedEvents[0]?.detail.final_output_source,
        "scene_fallback",
      ) as TurnResponseFamily | "scene_fallback";
      const winningResponseFamily = asString(
        selectedEvent?.detail.task_or_persona_path ?? finalOutputSource,
        finalOutputSource,
      ) as TurnResponseFamily | "scene_fallback";
      const trace: ReplayTurnTrace = {
        turnNumber: index + 1,
        userInput: turn.user,
        detectedIntent: asString(
          selectedEvent?.detail.detected_intent ?? acceptedEvent?.detail.user_intent,
          "user_question",
        ) as UserIntent,
        dialogueAct: asString(
          selectedEvent?.detail.dialogue_act ?? acceptedEvent?.detail.route_act,
          "user_question",
        ) as DialogueRouteAct,
        conversationMode: asString(selectedEvent?.detail.conversation_mode, "none") as InteractionMode | "none",
        interactionMode: asString(selectedEvent?.detail.interaction_mode, "normal_chat") as InteractionMode,
        memoryWritesAttempted: asMemoryWrites(selectedEvent?.detail.memory_writes_attempted),
        memoryWritesCommitted: asMemoryWrites(selectedEvent?.detail.memory_writes_committed),
        candidateResponseFamilies: outputFamilies.map((family) => ({
          family: family as TurnResponseFamily | "scene_fallback",
          sourceFunction: "browserLiveTrace",
          text: finalText,
        })),
        winningResponseFamily,
        finalOutputSource,
        moreThanOneGeneratorFired: asBoolean(selectedEvent?.detail.more_than_one_output_generator_fired, outputFamilies.length > 1),
        postProcessingModifiedOutput: asBoolean(selectedEvent?.detail.post_processing_modified_output),
        fallbackUsed: asBoolean(selectedEvent?.detail.fallback_chosen),
        fallbackReason: asString(selectedEvent?.detail.fallback_reason, "accepted"),
        taskStatePaused: asBoolean(selectedEvent?.detail.task_paused),
        taskStateResumed: false,
        lockActive: asBoolean(selectedEvent?.detail.lock_active),
        summaryRouteSelected: asBoolean(selectedEvent?.detail.summary_route_selected),
        profileQuestionRouteSelected: asBoolean(selectedEvent?.detail.profile_question_route_selected),
        chatSwitchRouteSelected: asBoolean(selectedEvent?.detail.chat_switch_route_selected),
        shortFollowUpRouteSelected: asBoolean(selectedEvent?.detail.short_follow_up_route_selected),
        oneOutputCommitted: committedEvents.length === 1,
        duplicateReplayBlocked: blockedEvents.length > 0,
        turnGateDecision: {
          allow: committedEvents.length === 1,
          reason:
            committedEvents.length === 1
              ? "committed"
              : blockedEvents[0]
                ? asString(blockedEvents[0].detail.reason, "blocked")
                : "missing_commit",
        },
        finalText,
      };
      traces.push(trace);
      evaluateGlobalInvariants(scenario, trace, violations);
      evaluateTurnExpectation(scenario, trace, turn.expect, violations);

      if (!acceptedEvent || !selectedEvent || committedEvents.length === 0) {
        addViolation(
          violations,
          scenario,
          trace,
          "browser_live_trace",
          "accepted, selected, and committed events",
          turnEvents.map((entry) => entry.label).join(", ") || "no turn events captured",
        );
      }
      if (acceptedEvent && committedEvents.some((entry) => {
        const committedUserMessageId = asNumber(entry.detail.user_message_id);
        return committedUserMessageId !== null && committedUserMessageId !== userMessageId;
      })) {
        addViolation(
          violations,
          scenario,
          trace,
          "browser_live_user_message_alignment",
          String(userMessageId),
          committedEvents
            .map((entry) => String(asNumber(entry.detail.user_message_id)))
            .join(", "),
        );
      }
    }

    const transcriptTurns = traces.map((trace) => ({
      user: trace.userInput,
      raven: trace.finalText,
    }));
    const style = evaluateTranscriptStyle({
      mode: traces[traces.length - 1]?.interactionMode ?? "normal_chat",
      assistantTurns: traces.map((trace) => trace.finalText),
    });
    const transcriptMetrics = evaluateConversationTranscript({
      turns: transcriptTurns,
      state: placeholderConversationState,
    });

    return {
      executor: "browser_live",
      scenario,
      traces,
      conversationState: placeholderConversationState,
      sceneState: placeholderSceneState,
      sessionMemory: placeholderSessionMemory,
      style,
      transcriptMetrics,
      violations,
    };
  } finally {
    await page.context().close().catch(() => undefined);
    await page.context().browser()?.close().catch(() => undefined);
  }
}

export async function replayConversationScenario(
  scenario: ReplayScenarioDefinition,
  options?: ReplayRunOptions,
): Promise<ReplayScenarioResult> {
  resetDeterministicTaskVariantCursor();
  if (resolveReplayExecutor(options) === "browser_live") {
    return await replayConversationScenarioBrowserLive(scenario, options);
  }
  return await replayConversationScenarioSynthetic(scenario);
}

export async function replayConversationScenarios(
  scenarios: ReplayScenarioDefinition[],
  options?: ReplayRunOptions,
): Promise<ReplayScenarioResult[]> {
  const results: ReplayScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await replayConversationScenario(scenario, options));
  }
  return results;
}

export function summarizeReplayResults(results: ReplayScenarioResult[]): ReplayRunSummary {
  const scenarioCount = results.length;
  const turnCount = results.reduce((sum, result) => sum + result.traces.length, 0);
  const violationCount = results.reduce((sum, result) => sum + result.violations.length, 0);
  const totals = results.reduce(
    (sum, result) => {
      sum.personaConsistency += result.style.personaConsistency;
      sum.confidence += result.style.confidence;
      sum.directness += result.style.directness;
      sum.naturalness += result.style.naturalness;
      sum.cannedRepetition += result.style.cannedRepetition;
      return sum;
    },
    {
      personaConsistency: 0,
      confidence: 0,
      directness: 0,
      naturalness: 0,
      cannedRepetition: 0,
    },
  );
  const divisor = Math.max(1, scenarioCount);
  return {
    scenarioCount,
    turnCount,
    violationCount,
    styles: {
      personaConsistency: Number((totals.personaConsistency / divisor).toFixed(3)),
      confidence: Number((totals.confidence / divisor).toFixed(3)),
      directness: Number((totals.directness / divisor).toFixed(3)),
      naturalness: Number((totals.naturalness / divisor).toFixed(3)),
      cannedRepetition: Number((totals.cannedRepetition / divisor).toFixed(3)),
    },
  };
}
