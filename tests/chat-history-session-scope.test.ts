import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildMemoryContextMessage } from "../lib/chat-prompt.ts";

const TEST_DB_FILE = path.join(process.cwd(), ".tmp-chat-history-session-scope.sqlite");

let dbModulePromise: Promise<typeof import("../lib/db.ts")> | null = null;

async function getDb() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!dbModulePromise) {
    dbModulePromise = import("../lib/db.ts");
  }
  return dbModulePromise;
}

test("recent chat history reads are scoped to the active session", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.appendChatHistory("user", "session a user turn", "session-a");
  await db.appendChatHistory("assistant", "session a reply", "session-a");
  await db.appendChatHistory("user", "session b user turn", "session-b");
  await db.appendChatHistory("assistant", "session b reply", "session-b");

  const sessionAHistory = await db.getRecentChatHistory("session-a", 10);
  const sessionBHistory = await db.getRecentChatHistory("session-b", 10);

  assert.equal(sessionAHistory.length, 2);
  assert.equal(
    sessionAHistory.every((row) => row.session_id === "session-a"),
    true,
  );
  assert.equal(
    sessionAHistory.some((row) => /session b/i.test(row.content)),
    false,
  );

  assert.equal(sessionBHistory.length, 2);
  assert.equal(
    sessionBHistory.every((row) => row.session_id === "session-b"),
    true,
  );
  assert.equal(
    sessionBHistory.some((row) => /session a/i.test(row.content)),
    false,
  );

  await db.__resetDbForTests({ deleteFile: true });
});

test("memory context block only reflects history for the active session", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.appendChatHistory("user", "this belongs to another session", "session-b");
  await db.appendChatHistory("assistant", "other session reply", "session-b");
  const activeSessionHistory = await db.getRecentChatHistory("session-a", 12);
  const otherSessionHistory = await db.getRecentChatHistory("session-b", 12);

  const activeSessionMemoryContext = buildMemoryContextMessage([], activeSessionHistory);
  const otherSessionMemoryContext = buildMemoryContextMessage([], otherSessionHistory);

  assert.match(activeSessionMemoryContext, /History available: no/i);
  assert.match(otherSessionMemoryContext, /History available: yes/i);

  await db.__resetDbForTests({ deleteFile: true });
});
