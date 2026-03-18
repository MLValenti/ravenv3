import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseMemoryCommand } from "../lib/memory/commands.ts";
import { extractMemorySuggestions } from "../lib/memory/extract.ts";
import {
  buildLearnedUserProfileBlock,
  buildMemoryInjectionBlock,
  buildPinnedMemoryBlock,
  selectRelevantMemories,
} from "../lib/memory/retrieval.ts";

const TEST_DB_FILE = path.join(process.cwd(), ".tmp-memory-system.sqlite");

let dbModulePromise: Promise<typeof import("../lib/db.ts")> | null = null;

async function getDb() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!dbModulePromise) {
    dbModulePromise = import("../lib/db.ts");
  }
  return dbModulePromise;
}

test("Save and load memory persists across restart", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal", "consistency"],
    confidence: 0.9,
    sourceSessionId: "test-session-1",
    sourceTurnId: "turn-1",
  });

  const firstRead = await db.listLongTermMemories(10);
  assert.equal(firstRead.length, 1);
  assert.equal(firstRead[0]?.value, "consistency");

  await db.__resetDbForTests({ deleteFile: false });
  const secondRead = await db.listLongTermMemories(10);
  assert.equal(secondRead.length, 1);
  assert.equal(secondRead[0]?.key, "goal");
  assert.equal(secondRead[0]?.value, "consistency");

  await db.__resetDbForTests({ deleteFile: true });
});

test("Extraction produces suggestion from remember goal phrase", () => {
  const candidates = extractMemorySuggestions("remember that my goal is consistency");
  assert.equal(candidates.length > 0, true);
  assert.equal(
    candidates.some((candidate) => candidate.key === "goal"),
    true,
  );
  assert.equal(
    candidates.some((candidate) => /consistency/i.test(candidate.value)),
    true,
  );
});

test("Extraction learns simple user facts from natural phrasing", () => {
  const candidates = extractMemorySuggestions(
    "Call me Mara. I prefer short direct answers. My safeword is amber. I struggle with consistency.",
  );

  assert.equal(
    candidates.some((candidate) => candidate.key === "name"),
    true,
  );
  assert.equal(
    candidates.some(
      (candidate) =>
        candidate.key === "preference" && /short direct answers/i.test(candidate.value),
    ),
    true,
  );
  assert.equal(
    candidates.some((candidate) => candidate.key === "safeword"),
    true,
  );
  assert.equal(
    candidates.some((candidate) => candidate.key === "improvement_area"),
    true,
  );
});

test("Approval moves suggestion into active memories", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const created = await db.createMemorySuggestion({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal"],
    importance: 0.8,
    stability: 0.8,
    confidence: 0.9,
    sourceSessionId: "approval-session",
    sourceTurnId: "turn-5",
  });
  assert.ok(created);

  const approved = await db.approveMemorySuggestion(created!.id);
  assert.ok(approved);

  const active = await db.listLongTermMemories(20);
  assert.equal(
    active.some((row) => row.key === "goal" && row.value === "consistency"),
    true,
  );

  await db.__resetDbForTests({ deleteFile: true });
});

test("Retrieval returns relevant memory in later session and injection contains it", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal", "consistency"],
    confidence: 0.9,
    sourceSessionId: "session-one",
    sourceTurnId: "turn-1",
  });
  await db.upsertSessionSummary({
    sessionId: "session-one",
    summary: "User wants more consistency in follow through.",
    turnCount: 8,
  });

  const allMemories = await db.listLongTermMemories(50);
  const relevant = selectRelevantMemories(allMemories, "what is my goal?", 10);
  assert.equal(
    relevant.some((memory) => memory.key === "goal"),
    true,
  );

  const block = buildMemoryInjectionBlock({
    memories: relevant,
    lastSessionSummary: "User wants more consistency in follow through.",
    maxLines: 10,
  });
  assert.match(block, /Memory:/);
  assert.match(block, /consistency/i);

  await db.__resetDbForTests({ deleteFile: true });
});

test("Pinned memories outrank ordinary retrieval and render in a fixed memory block", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "name",
    value: "Mara",
    type: "misc",
    tags: ["identity"],
    confidence: 0.95,
    isPinned: true,
    sourceSessionId: "session-pinned",
    sourceTurnId: "turn-1",
  });
  await db.createLongTermMemory({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal"],
    confidence: 0.9,
    sourceSessionId: "session-pinned",
    sourceTurnId: "turn-2",
  });

  const memories = await db.listLongTermMemories(20);
  const relevant = selectRelevantMemories(memories, "what is my goal?", 5);
  assert.equal(relevant[0]?.key, "name");
  assert.equal(relevant[0]?.is_pinned, true);

  const fixedBlock = buildPinnedMemoryBlock({
    memories,
    maxLines: 4,
  });
  const memoryBlock = buildMemoryInjectionBlock({
    memories: relevant,
    lastSessionSummary: null,
    maxLines: 8,
  });

  assert.match(fixedBlock ?? "", /Fixed memory:/);
  assert.match(fixedBlock ?? "", /name: Mara/i);
  assert.doesNotMatch(memoryBlock, /name: Mara/i);

  await db.__resetDbForTests({ deleteFile: true });
});

test("Learned user profile block synthesizes stable preference cues", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal", "consistency"],
    confidence: 0.9,
    sourceSessionId: "session-two",
    sourceTurnId: "turn-1",
  });
  await db.createLongTermMemory({
    key: "preferred_style",
    value: "strict dominant control",
    type: "preference",
    tags: ["style", "strict", "dominant"],
    confidence: 0.9,
    sourceSessionId: "session-two",
    sourceTurnId: "turn-2",
  });
  await db.createLongTermMemory({
    key: "limits",
    value: "no public tasks",
    type: "constraint",
    tags: ["limits", "privacy"],
    confidence: 0.85,
    sourceSessionId: "session-two",
    sourceTurnId: "turn-3",
  });

  const memories = await db.listLongTermMemories(20);
  const block = buildLearnedUserProfileBlock({
    memories,
    lastSessionSummary: "User handled strict direction well and wants more control.",
    maxLines: 8,
  });

  assert.match(block, /Learned user profile:/);
  assert.match(block, /focus: goal: consistency/i);
  assert.match(block, /wants: preferred_style: strict dominant control/i);
  assert.match(block, /avoid: limits: no public tasks/i);
  assert.match(block, /power dynamic: User responds best to firm control/i);
  assert.match(block, /recent arc:/i);

  await db.__resetDbForTests({ deleteFile: true });
});

test("session summary persists structured continuity fields beyond the old flat summary limit", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const structuredSummary = {
    active_topic: "week planning",
    recent_topic_history: ["week planning", "number hunt", "week planning"],
    user_goals: ["better focus", "protect mornings"],
    commitments_or_assigned_tasks: [
      "start with one stable morning block before messages",
      "return to the plan after one game round",
    ],
    unresolved_questions: ["why that order?", "what about the evening?"],
    open_loops: ["finish the morning block plan", "return to the plan after the game round"],
    important_user_facts: ["call me Mara", "I prefer short direct replies"],
    current_tone_or_emotional_context: "steady",
    recent_mode_shifts: ["normal_chat -> game", "game -> question_answering"],
    important_entities: ["Mara", "week planning", "morning block", "number hunt"],
    relational_direction: "holding_presence",
    emotional_beat_history: [],
    unresolved_relational_moves: [],
    raven_identity_notes: [],
  };

  await db.upsertSessionSummary({
    sessionId: "session-one",
    summary: "structured continuity summary",
    structuredSummary,
    turnCount: 42,
  });

  const saved = await db.getSessionSummary("session-one");
  assert.ok(saved);
  assert.equal(saved?.summary_json ? saved.summary_json.length > 0 : false, true);
  assert.deepEqual(saved?.structured_summary, {
    ...structuredSummary,
    recent_topic_history: ["week planning", "number hunt"],
  });

  await db.__resetDbForTests({ deleteFile: true });
});

test("Reject prevents repeated suggestion for same key and value", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const first = await db.createMemorySuggestion({
    key: "constraint",
    value: "no calls after 10pm",
    type: "constraint",
    tags: ["constraint", "privacy"],
    importance: 0.8,
    stability: 0.8,
    confidence: 0.85,
    sourceSessionId: "session-two",
    sourceTurnId: "turn-2",
  });
  assert.ok(first);

  const rejected = await db.rejectMemorySuggestion(first!.id, "not needed");
  assert.equal(rejected, true);

  const second = await db.createMemorySuggestion({
    key: "constraint",
    value: "no calls after 10pm",
    type: "constraint",
    tags: ["constraint", "privacy"],
    importance: 0.9,
    stability: 0.9,
    confidence: 0.9,
    sourceSessionId: "session-three",
    sourceTurnId: "turn-1",
  });
  assert.equal(second, null);

  await db.__resetDbForTests({ deleteFile: true });
});

test("Same key with new value creates update suggestion", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal"],
    confidence: 0.8,
    sourceSessionId: "session-base",
    sourceTurnId: "turn-1",
  });

  const suggestion = await db.createMemorySuggestion({
    key: "goal",
    value: "confidence",
    type: "goal",
    tags: ["goal"],
    importance: 0.8,
    stability: 0.8,
    confidence: 0.8,
    sourceSessionId: "session-base",
    sourceTurnId: "turn-2",
  });
  assert.ok(suggestion);
  assert.equal(suggestion?.suggestion_kind, "update");

  await db.__resetDbForTests({ deleteFile: true });
});

test("Forget command deletes matching memory", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "goal",
    value: "consistency",
    type: "goal",
    tags: ["goal"],
    confidence: 0.9,
    sourceSessionId: "test-session-2",
    sourceTurnId: "turn-1",
  });
  await db.createLongTermMemory({
    key: "likes",
    value: "coffee",
    type: "preference",
    tags: ["likes"],
    confidence: 0.7,
    sourceSessionId: "test-session-2",
    sourceTurnId: "turn-2",
  });

  const command = parseMemoryCommand("forget my goal");
  assert.deepEqual(command, { type: "forget", text: "goal" });

  const deleted = await db.forgetLongTermMemories(command?.type === "forget" ? command.text : "");
  assert.equal(deleted >= 1, true);

  const remaining = await db.listLongTermMemories(10);
  assert.equal(
    remaining.some((row) => row.key === "goal"),
    false,
  );
  assert.equal(
    remaining.some((row) => row.key === "likes"),
    true,
  );

  await db.__resetDbForTests({ deleteFile: true });
});

test("Memory injection block is capped and stable", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  for (let index = 0; index < 20; index += 1) {
    await db.createLongTermMemory({
      key: `key_${index + 1}`,
      value: `value_${index + 1}`,
      type: "misc",
      tags: [`tag_${index + 1}`],
      confidence: 0.7,
      sourceSessionId: "stable-session",
      sourceTurnId: `turn-${index + 1}`,
    });
  }

  const memories = await db.listLongTermMemories(50);
  const first = buildMemoryInjectionBlock({
    memories,
    lastSessionSummary: "Previous session covered posture and movement.",
    maxLines: 12,
  });
  const second = buildMemoryInjectionBlock({
    memories,
    lastSessionSummary: "Previous session covered posture and movement.",
    maxLines: 12,
  });

  assert.equal(first, second);
  assert.equal(first.split("\n").length <= 12, true);

  await db.__resetDbForTests({ deleteFile: true });
});

test("Repeated recall reinforces existing memories without duplicating them", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const saved = await db.createLongTermMemory({
    key: "name",
    value: "Mara",
    type: "misc",
    tags: ["identity"],
    confidence: 0.9,
    isPinned: true,
    sourceSessionId: "session-recall",
    sourceTurnId: "turn-1",
  });

  await db.markMemoriesRecalled([saved.id, saved.id]);
  await db.createLongTermMemory({
    key: "name",
    value: "Mara",
    type: "misc",
    tags: ["identity", "preferred_name"],
    confidence: 0.95,
    isPinned: true,
    sourceSessionId: "session-recall",
    sourceTurnId: "turn-2",
  });

  const memories = await db.listLongTermMemories(10);
  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.is_pinned, true);
  assert.equal((memories[0]?.reinforcement_count ?? 0) >= 3, true);
  assert.equal(memories[0]?.last_recalled_at !== null, true);
  assert.equal(memories[0]?.tags.includes("preferred_name"), true);

  await db.__resetDbForTests({ deleteFile: true });
});

test("Retrieval uses expanded query tokens for related memory keys", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.createLongTermMemory({
    key: "preferred_pace",
    value: "slow and controlled",
    type: "preference",
    tags: ["pace"],
    confidence: 0.9,
    sourceSessionId: "session-speed",
    sourceTurnId: "turn-1",
  });
  await db.createLongTermMemory({
    key: "likes",
    value: "word games",
    type: "preference",
    tags: ["games"],
    confidence: 0.8,
    sourceSessionId: "session-speed",
    sourceTurnId: "turn-2",
  });

  const memories = await db.listLongTermMemories(20);
  const relevant = selectRelevantMemories(memories, "can we go faster speed", 5);
  assert.equal(relevant.length > 0, true);
  assert.equal(relevant[0]?.key, "preferred_pace");

  await db.__resetDbForTests({ deleteFile: true });
});
