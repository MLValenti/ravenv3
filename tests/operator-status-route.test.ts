import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const TEST_DB_FILE = path.join(process.cwd(), ".tmp-operator-status.sqlite");

let dbModulePromise: Promise<typeof import("../lib/db.ts")> | null = null;
let emergencyStopRoutePromise: Promise<typeof import("../app/api/emergency-stop/route.ts")> | null =
  null;
let statusRoutePromise: Promise<typeof import("../app/api/status/route.ts")> | null = null;

async function getDb() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!dbModulePromise) {
    dbModulePromise = import("../lib/db.ts");
  }
  return dbModulePromise;
}

async function getEmergencyStopRoute() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!emergencyStopRoutePromise) {
    emergencyStopRoutePromise = import("../app/api/emergency-stop/route.ts");
  }
  return emergencyStopRoutePromise;
}

async function getStatusRoute() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!statusRoutePromise) {
    statusRoutePromise = import("../app/api/status/route.ts");
  }
  return statusRoutePromise;
}

function buildJsonRequest(url: string, payload: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("emergency stop route persists server-side state", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });
  const emergencyStopRoute = await getEmergencyStopRoute();

  const engageResponse = await emergencyStopRoute.POST(
    buildJsonRequest("http://127.0.0.1:3000/api/emergency-stop", {
      stopped: true,
    }),
  );
  assert.equal(engageResponse.status, 200);
  const engageBody = (await engageResponse.json()) as {
    stopped: boolean;
    reason: string | null;
  };
  assert.equal(engageBody.stopped, true);
  assert.equal(engageBody.reason, "manual_engaged");

  const getResponse = await emergencyStopRoute.GET();
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as {
    stopped: boolean;
    reason: string | null;
  };
  assert.equal(getBody.stopped, true);
  assert.equal(getBody.reason, "manual_engaged");

  const runtimeState = await db.getRuntimeStateFromDb();
  assert.equal(runtimeState.emergency_stop, true);
  assert.equal(runtimeState.emergency_stop_reason, "manual_engaged");

  await db.__resetDbForTests({ deleteFile: true });
});

test("operator status route returns local runtime summary without network probes when skipped", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });
  const statusRoute = await getStatusRoute();

  const response = await statusRoute.GET(
    new Request("http://127.0.0.1:3000/api/status?skipChecks=true&ttsProvider=browser"),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    app?: { name: string; version: string };
    emergencyStop?: { stopped: boolean };
    services?: {
      ollama?: { state: string };
      piper?: { state: string };
    };
    tasks?: { activeCount: number; pendingReviewCount: number };
    memory?: { pendingSuggestionCount: number };
  };

  assert.equal(body.app?.name, "Raven");
  assert.equal(typeof body.app?.version, "string");
  assert.equal(body.emergencyStop?.stopped, false);
  assert.equal(body.services?.ollama?.state, "skipped");
  assert.equal(body.services?.piper?.state, "disabled");
  assert.equal(body.tasks?.activeCount, 0);
  assert.equal(body.tasks?.pendingReviewCount, 0);
  assert.equal(body.memory?.pendingSuggestionCount, 0);

  await db.__resetDbForTests({ deleteFile: true });
});
