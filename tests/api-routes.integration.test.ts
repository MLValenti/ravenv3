import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const TEST_DB_FILE = path.join(process.cwd(), ".tmp-api-routes.sqlite");

let dbModulePromise: Promise<typeof import("../lib/db.ts")> | null = null;
let tasksRoutePromise: Promise<typeof import("../app/api/tasks/route.ts")> | null = null;

async function getDb() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!dbModulePromise) {
    dbModulePromise = import("../lib/db.ts");
  }
  return dbModulePromise;
}

async function getTasksRoute() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!tasksRoutePromise) {
    tasksRoutePromise = import("../app/api/tasks/route.ts");
  }
  return tasksRoutePromise;
}

function buildRequest(url: string, payload: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("tasks route create via assistant text persists and GET reflects review queue state", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const tasksRoute = await getTasksRoute();
  const createResponse = await tasksRoute.POST(
    buildRequest("http://127.0.0.1:3000/api/tasks", {
      action: "create",
      assistantText: `\`\`\`json
{
  "type": "create_habit",
  "title": "Chastity check-in",
  "description": "Stay secured and report in.",
  "schedule": { "type": "daily", "days": 2, "occurrences_per_day": 1, "allow_make_up": false },
  "window_seconds": 3600,
  "repeats_required": 1,
  "points_possible": 6,
  "evidence": {
    "required": true,
    "type": "manual",
    "checks": [],
    "max_attempts": 2,
    "deny_user_override": false
  },
  "reward_plan": { "catalog_id": "reward_positive_message", "params": {} },
  "consequence_plan": { "catalog_id": "penalty_points", "params": { "penalty_points": 1 } }
}
\`\`\``,
    }),
  );
  assert.equal(createResponse.status, 200);
  const createBody = (await createResponse.json()) as {
    created?: { id: string; program_kind?: string };
    occurrences?: Array<{ id: string; task_id: string }>;
    review_queue?: Array<{ task_id: string }>;
  };
  const taskId = createBody.created?.id ?? "";
  const occurrenceId =
    (createBody.occurrences ?? []).find((occurrence) => occurrence.task_id === taskId)?.id ?? "";
  assert.ok(taskId);
  assert.ok(occurrenceId);
  assert.equal(createBody.created?.program_kind, "habit");
  assert.equal((createBody.review_queue ?? []).length, 1);

  const submitResponse = await tasksRoute.POST(
    buildRequest("http://127.0.0.1:3000/api/tasks", {
      action: "submit_manual_evidence",
      taskId,
      occurrenceId,
      summary: "Secured and following the task.",
    }),
  );
  assert.equal(submitResponse.status, 200);

  const getResponse = await tasksRoute.GET();
  assert.equal(getResponse.status, 200);
  const stateBody = (await getResponse.json()) as {
    active?: Array<{ id: string; program_kind: string }>;
    review_queue?: Array<{ task_id: string; review_state: string }>;
  };
  assert.equal(stateBody.active?.some((task) => task.id === taskId), true);
  assert.equal(stateBody.active?.find((task) => task.id === taskId)?.program_kind, "habit");
  const reviewItem = (stateBody.review_queue ?? []).find((item) => item.task_id === taskId);
  assert.equal(reviewItem?.review_state, "submitted_for_review");

  await db.__resetDbForTests({ deleteFile: true });
});
