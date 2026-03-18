import { createServer, type IncomingMessage } from "node:http";

import { buildSceneScaffoldReply } from "../lib/session/scene-scaffolds.ts";
import { createSceneState, noteSceneStateAssistantTurn, noteSceneStateUserTurn } from "../lib/session/scene-state.ts";

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const BASELINE_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9VEWil8AAAAASUVORK5CYII=";
const UPLOAD_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AApMBgN7EzxQAAAAASUVORK5CYII=";

type SmokeMode = "core" | "upload" | "session" | "game";

function assertLocalBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid base URL: ${value}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error(`Smoke script only supports http URLs. Received: ${value}`);
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Smoke script must target localhost only. Received: ${value}`);
  }

  return parsed.origin;
}

function logStep(message: string) {
  process.stdout.write(`${message}\n`);
}

async function readNdjson(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return {};
  }
  try {
    return JSON.parse(firstLine) as JsonRecord;
  } catch {
    throw new Error(`Expected NDJSON response, received: ${text.slice(0, 300)}`);
  }
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

async function getJson(baseUrl: string, path: string): Promise<{ response: Response; body: JsonRecord }> {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await readJson(response);
  return { response, body };
}

async function postJson(
  baseUrl: string,
  path: string,
  payload: JsonRecord,
): Promise<{ response: Response; body: JsonRecord }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  return { response, body };
}

function parseArgs(): { baseUrl: string; mode: SmokeMode } {
  const arg = process.argv[2] ?? "";
  const envBaseUrl = process.env.RAVEN_SMOKE_BASE_URL;
  const envMode = process.env.RAVEN_SMOKE_MODE;
  const mode = (
    envMode === "upload" || arg === "upload"
      ? "upload"
      : envMode === "session" || arg === "session"
        ? "session"
        : envMode === "game" || arg === "game"
          ? "game"
        : "core"
  ) as SmokeMode;
  const rawBaseUrl =
    envBaseUrl ??
    (arg && arg !== "upload" && arg !== "session" && arg !== "game" ? arg : DEFAULT_BASE_URL);
  return { baseUrl: assertLocalBaseUrl(rawBaseUrl), mode };
}

async function readIncomingJson(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {};
  }
}

async function startMockOllamaServer(assistantText: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/chat") {
      const body = await readIncomingJson(request);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (messages.length === 0) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "messages required" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          message: {
            content: assistantText,
          },
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock Ollama server did not provide a numeric address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function resetTasks(baseUrl: string) {
  const resetTasks = await postJson(baseUrl, "/api/tasks", { action: "delete_all" });
  if (resetTasks.response.status !== 200) {
    throw new Error(`Task reset failed: ${resetTasks.response.status} ${JSON.stringify(resetTasks.body)}`);
  }
}

async function setEmergencyStop(baseUrl: string, stopped: boolean) {
  const result = await postJson(baseUrl, "/api/emergency-stop", { stopped });
  if (result.response.status !== 200 || result.body.stopped !== stopped) {
    throw new Error(
      `Emergency stop ${stopped ? "enable" : "disable"} failed: ${result.response.status} ${JSON.stringify(result.body)}`,
    );
  }
}

async function createChastityHabit(baseUrl: string): Promise<{ taskId: string; occurrenceId: string }> {
  const createTask = await postJson(baseUrl, "/api/tasks", {
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
  });
  if (createTask.response.status !== 200) {
    throw new Error(`Task create failed: ${createTask.response.status} ${JSON.stringify(createTask.body)}`);
  }

  const created = createTask.body.created as JsonRecord | undefined;
  const occurrences = Array.isArray(createTask.body.occurrences)
    ? (createTask.body.occurrences as JsonRecord[])
    : [];
  const taskId = typeof created?.id === "string" ? created.id : "";
  const occurrence = occurrences.find((item) => item.task_id === taskId);
  const occurrenceId = typeof occurrence?.id === "string" ? occurrence.id : "";
  if (!taskId || !occurrenceId) {
    throw new Error(`Task create did not return ids: ${JSON.stringify(createTask.body)}`);
  }
  return { taskId, occurrenceId };
}

async function runCoreSmoke(baseUrl: string) {
  logStep("2. Reset task state");
  await resetTasks(baseUrl);

  logStep("3. Create task through assistantText");
  const { taskId, occurrenceId } = await createChastityHabit(baseUrl);

  logStep("4. Submit manual evidence");
  const submitEvidence = await postJson(baseUrl, "/api/tasks", {
    action: "submit_manual_evidence",
    taskId,
    occurrenceId,
    summary: "Secured and following the task.",
  });
  if (submitEvidence.response.status !== 200) {
    throw new Error(
      `Manual evidence submit failed: ${submitEvidence.response.status} ${JSON.stringify(submitEvidence.body)}`,
    );
  }

  logStep("5. Verify review queue state");
  const tasksState = await getJson(baseUrl, "/api/tasks");
  if (tasksState.response.status !== 200) {
    throw new Error(`Tasks GET failed: ${tasksState.response.status} ${JSON.stringify(tasksState.body)}`);
  }
  const reviewQueue = Array.isArray(tasksState.body.review_queue)
    ? (tasksState.body.review_queue as JsonRecord[])
    : [];
  const reviewItem = reviewQueue.find((item) => item.task_id === taskId);
  if (!reviewItem) {
    throw new Error(`Expected task in review queue: ${JSON.stringify(tasksState.body)}`);
  }
  if (reviewItem.review_state !== "submitted_for_review") {
    throw new Error(`Unexpected review state: ${JSON.stringify(reviewItem)}`);
  }

  logStep("6. Enable emergency stop");
  const stopOn = await postJson(baseUrl, "/api/emergency-stop", { stopped: true });
  if (stopOn.response.status !== 200 || stopOn.body.stopped !== true) {
    throw new Error(`Emergency stop enable failed: ${stopOn.response.status} ${JSON.stringify(stopOn.body)}`);
  }

  logStep("7. Confirm chat is blocked over the live API");
  const blockedChat = await postJson(baseUrl, "/api/chat", {
    consent: {
      confirmedAdults: true,
      safeWord: "red",
      limits: "adult-only",
      preferredStyle: "direct",
    },
    messages: [{ role: "user", content: "Hello." }],
  });
  if (blockedChat.response.status !== 403) {
    throw new Error(`Expected chat 403 while stopped, got ${blockedChat.response.status}`);
  }

  logStep("8. Confirm health still responds while stopped");
  const healthWhileStopped = await getJson(baseUrl, "/api/health");
  if (healthWhileStopped.response.status !== 200) {
    throw new Error(
      `Health while stopped failed: ${healthWhileStopped.response.status} ${JSON.stringify(healthWhileStopped.body)}`,
    );
  }

  logStep("9. Reset emergency stop");
  const stopOff = await postJson(baseUrl, "/api/emergency-stop", { stopped: false });
  if (stopOff.response.status !== 200 || stopOff.body.stopped !== false) {
    throw new Error(`Emergency stop reset failed: ${stopOff.response.status} ${JSON.stringify(stopOff.body)}`);
  }

  logStep("10. Clean up task state");
  const cleanup = await postJson(baseUrl, "/api/tasks", { action: "delete_all" });
  if (cleanup.response.status !== 200) {
    throw new Error(`Cleanup failed: ${cleanup.response.status} ${JSON.stringify(cleanup.body)}`);
  }
}

async function runUploadSmoke(baseUrl: string) {
  logStep("2. Reset task state");
  await resetTasks(baseUrl);

  logStep("3. Create repeating upload-review task");
  const { taskId, occurrenceId } = await createChastityHabit(baseUrl);

  logStep("4. Set baseline for current occurrence");
  const setBaseline = await postJson(baseUrl, "/api/tasks", {
    action: "set_evidence_baseline",
    taskId,
    occurrenceId,
    imageDataUrl: BASELINE_IMAGE_DATA_URL,
  });
  if (setBaseline.response.status !== 200 || setBaseline.body.baselineSet !== true) {
    throw new Error(`Set baseline failed: ${setBaseline.response.status} ${JSON.stringify(setBaseline.body)}`);
  }

  logStep("5. Upload evidence with baseline-assisted analysis");
  const uploadEvidence = await postJson(baseUrl, "/api/tasks", {
    action: "submit_upload_evidence",
    taskId,
    occurrenceId,
    imageDataUrl: UPLOAD_IMAGE_DATA_URL,
    analysis: {
      provider_id: "safe_coverage_v1",
      status: "pass_candidate",
      confidence: 0.82,
      summary: "Coverage reduced against the saved baseline.",
      review_recommended: true,
      signals: [
        {
          id: "coverage_change_detected",
          state: "positive",
          score: 0.82,
          summary: "Coverage changed from the baseline.",
        },
      ],
      metadata: {
        baseline_used: "yes",
      },
    },
  });
  if (uploadEvidence.response.status !== 200 || uploadEvidence.body.reviewSubmitted !== true) {
    throw new Error(
      `Upload evidence failed: ${uploadEvidence.response.status} ${JSON.stringify(uploadEvidence.body)}`,
    );
  }

  logStep("6. Verify review queue shows baseline-assisted analysis");
  const tasksState = await getJson(baseUrl, "/api/tasks");
  if (tasksState.response.status !== 200) {
    throw new Error(`Tasks GET failed: ${tasksState.response.status} ${JSON.stringify(tasksState.body)}`);
  }
  const reviewQueue = Array.isArray(tasksState.body.review_queue)
    ? (tasksState.body.review_queue as JsonRecord[])
    : [];
  const reviewItem = reviewQueue.find((item) => item.task_id === taskId);
  if (!reviewItem) {
    throw new Error(`Expected upload task in review queue: ${JSON.stringify(tasksState.body)}`);
  }
  if (reviewItem.review_state !== "submitted_for_review") {
    throw new Error(`Unexpected review state: ${JSON.stringify(reviewItem)}`);
  }
  if (reviewItem.analysis_mode !== "baseline_assisted") {
    throw new Error(`Expected baseline-assisted analysis: ${JSON.stringify(reviewItem)}`);
  }
  if (reviewItem.baseline_source !== "manual") {
    throw new Error(`Expected manual baseline source: ${JSON.stringify(reviewItem)}`);
  }

  logStep("7. Approve evidence and seed the next baseline");
  const approveEvidence = await postJson(baseUrl, "/api/tasks", {
    action: "review_evidence",
    taskId,
    occurrenceId,
    status: "pass",
    useAsNextBaseline: true,
  });
  if (approveEvidence.response.status !== 200) {
    throw new Error(
      `Review approve failed: ${approveEvidence.response.status} ${JSON.stringify(approveEvidence.body)}`,
    );
  }

  logStep("8. Verify the next pending occurrence carries the new baseline");
  const nextState = await getJson(baseUrl, "/api/tasks");
  if (nextState.response.status !== 200) {
    throw new Error(`Tasks GET after approve failed: ${nextState.response.status} ${JSON.stringify(nextState.body)}`);
  }
  const nextQueue = Array.isArray(nextState.body.review_queue)
    ? (nextState.body.review_queue as JsonRecord[])
    : [];
  const nextItem = nextQueue.find((item) => item.task_id === taskId);
  if (!nextItem) {
    throw new Error(`Expected next occurrence in review queue: ${JSON.stringify(nextState.body)}`);
  }
  if (nextItem.baseline_source !== "carried_forward") {
    throw new Error(`Expected carried-forward baseline: ${JSON.stringify(nextItem)}`);
  }

  logStep("9. Clean up task state");
  const cleanup = await postJson(baseUrl, "/api/tasks", { action: "delete_all" });
  if (cleanup.response.status !== 200) {
    throw new Error(`Cleanup failed: ${cleanup.response.status} ${JSON.stringify(cleanup.body)}`);
  }
}

async function runSessionSmoke(baseUrl: string) {
  logStep("2. Reset task state");
  await resetTasks(baseUrl);

  logStep("3. Ensure emergency stop is off");
  await setEmergencyStop(baseUrl, false);

  logStep("4. Start mock local Ollama upstream");
  const mockAssistantText = [
    "Listen carefully, pet. Here is your chastity task. Stay secured for 2 hours and report in once each day for 2 days.",
    "```json",
    "{",
    '  "type": "create_habit",',
    '  "title": "Chastity daily check-in",',
    '  "description": "Stay secured for 2 hours, once per day, and report in.",',
    '  "schedule": { "type": "daily", "days": 2, "occurrences_per_day": 1, "allow_make_up": false },',
    '  "window_seconds": 7200,',
    '  "repeats_required": 1,',
    '  "points_possible": 6,',
    '  "evidence": {',
    '    "required": true,',
    '    "type": "manual",',
    '    "checks": [],',
    '    "max_attempts": 2,',
    '    "deny_user_override": false',
    "  },",
    '  "reward_plan": { "catalog_id": "reward_positive_message", "params": {} },',
    '  "consequence_plan": { "catalog_id": "penalty_points", "params": { "penalty_points": 1 } }',
    "}",
    "```",
  ].join("\n");
  const mockServer = await startMockOllamaServer(mockAssistantText);

  try {
    logStep("5. Request a task through /api/chat");
    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionMode: true,
        sessionId: "live-smoke-session",
        baseUrl: mockServer.baseUrl,
        model: "raven",
        toneProfile: "dominant",
        consent: {
          confirmedAdults: true,
          safeWord: "red",
          limits: "adult-only",
          preferredStyle: "direct",
        },
        messages: [
          {
            role: "user",
            content: "Give me a chastity task for 2 hours, once a day for 2 days.",
          },
        ],
      }),
    });
    const chatBody = await readNdjson(chatResponse);
    if (chatResponse.status !== 200) {
      throw new Error(`Session chat failed: ${chatResponse.status} ${JSON.stringify(chatBody)}`);
    }
    const responseText = typeof chatBody.response === "string" ? chatBody.response : "";
    if (!responseText.includes("chastity task")) {
      throw new Error(`Unexpected chat response: ${JSON.stringify(chatBody)}`);
    }

    logStep("6. Verify the task appears through /api/tasks");
    const tasksState = await getJson(baseUrl, "/api/tasks");
    if (tasksState.response.status !== 200) {
      throw new Error(`Tasks GET failed: ${tasksState.response.status} ${JSON.stringify(tasksState.body)}`);
    }
    const activeTasks = Array.isArray(tasksState.body.active_tasks)
      ? (tasksState.body.active_tasks as JsonRecord[])
      : Array.isArray(tasksState.body.active)
        ? (tasksState.body.active as JsonRecord[])
        : [];
    const task = activeTasks.find((item) => item.title === "Chastity daily check-in");
    if (!task) {
      throw new Error(`Expected task created from /api/chat: ${JSON.stringify(tasksState.body)}`);
    }
    const taskId = typeof task.id === "string" ? task.id : "";
    const occurrences = Array.isArray(tasksState.body.occurrences)
      ? (tasksState.body.occurrences as JsonRecord[])
      : [];
    const currentOccurrence = occurrences.find(
      (item) => item.task_id === taskId && item.status === "pending",
    );
    const occurrenceId = typeof currentOccurrence?.id === "string" ? currentOccurrence.id : "";
    if (!taskId || !occurrenceId) {
      throw new Error(`Expected task occurrence ids after /api/chat: ${JSON.stringify(task)}`);
    }

    logStep("7. Upload evidence for the created task");
    const submitEvidence = await postJson(baseUrl, "/api/tasks", {
      action: "submit_upload_evidence",
      taskId,
      occurrenceId,
      imageDataUrl: UPLOAD_IMAGE_DATA_URL,
      analysis: {
        provider_id: "safe_coverage_v1",
        status: "pass_candidate",
        confidence: 0.78,
        summary: "Coverage changed enough to count as a valid check-in.",
        review_recommended: true,
        signals: [
          {
            id: "coverage_change_detected",
            state: "positive",
            score: 0.78,
            summary: "The uploaded image differs from the prior state.",
          },
        ],
        metadata: {
          baseline_used: "no",
        },
      },
    });
    if (submitEvidence.response.status !== 200 || submitEvidence.body.reviewSubmitted !== true) {
      throw new Error(
        `Upload evidence failed: ${submitEvidence.response.status} ${JSON.stringify(submitEvidence.body)}`,
      );
    }

    logStep("8. Approve the review item");
    const approveEvidence = await postJson(baseUrl, "/api/tasks", {
      action: "review_evidence",
      taskId,
      occurrenceId,
      status: "pass",
    });
    if (approveEvidence.response.status !== 200) {
      throw new Error(
        `Review approve failed: ${approveEvidence.response.status} ${JSON.stringify(approveEvidence.body)}`,
      );
    }

    logStep("9. Verify the review cycle completed and the next occurrence is pending");
    const finalState = await getJson(baseUrl, "/api/tasks");
    if (finalState.response.status !== 200) {
      throw new Error(`Tasks GET after review failed: ${finalState.response.status} ${JSON.stringify(finalState.body)}`);
    }
    const finalTasks = Array.isArray(finalState.body.active_tasks)
      ? (finalState.body.active_tasks as JsonRecord[])
      : Array.isArray(finalState.body.active)
        ? (finalState.body.active as JsonRecord[])
        : [];
    const finalTask = finalTasks.find((item) => item.id === taskId);
    if (!finalTask) {
      throw new Error(`Expected active task after first review cycle: ${JSON.stringify(finalState.body)}`);
    }
    if (finalTask.repeats_completed !== 1) {
      throw new Error(`Expected one completed repeat after review cycle: ${JSON.stringify(finalTask)}`);
    }
    const reviewQueue = Array.isArray(finalState.body.review_queue)
      ? (finalState.body.review_queue as JsonRecord[])
      : [];
    const nextReviewItem = reviewQueue.find((item) => item.task_id === taskId);
    if (!nextReviewItem || nextReviewItem.review_state !== "awaiting_submission") {
      throw new Error(`Expected next occurrence awaiting submission: ${JSON.stringify(finalState.body)}`);
    }
  } finally {
    await mockServer.close();
    logStep("10. Clean up task state");
    await resetTasks(baseUrl);
  }
}

async function runGameSmoke(baseUrl: string) {
  logStep("2. Confirm health before deterministic game transcript");
  const health = await getJson(baseUrl, "/api/health");
  if (health.response.status !== 200) {
    throw new Error(`Health check failed: ${health.response.status} ${JSON.stringify(health.body)}`);
  }

  logStep("3. Run deterministic game transcript against the live client-side rail");
  let scene = noteSceneStateUserTurn(createSceneState(), {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: {
      topic_type: "game_selection",
      topic_state: "open",
      summary: "game setup",
      created_at: Date.now(),
    },
  });

  const startReply = buildSceneScaffoldReply({
    act: "answer_activity_choice",
    userText: "you pick",
    sceneState: scene,
  });
  if (
    !startReply ||
    !/I pick\./i.test(startReply) ||
    !/First throw now|First guess now|First prompt: 7 \+ 4|Riddle one:|Pick one number from 1 to 10/i.test(startReply)
  ) {
    throw new Error(`Game start did not emit a real first prompt: ${startReply ?? "<empty>"}`);
  }
  scene = noteSceneStateAssistantTurn(scene, { text: startReply });

  logStep("4. Confirm filler input does not advance the game");
  let fillerReply = buildSceneScaffoldReply({
    act: "acknowledgement",
    userText: "ok",
    sceneState: noteSceneStateUserTurn(scene, {
      text: "ok",
      act: "acknowledgement",
      sessionTopic: null,
    }),
  });
  if (!fillerReply || !/No stalling, pet\./i.test(fillerReply)) {
    throw new Error(`Game filler handling failed: ${fillerReply ?? "<empty>"}`);
  }

  logStep("5. Confirm a valid answer advances the game");
  const validAnswer =
    scene.game_template_id === "rps_streak"
      ? "paper"
      : scene.game_template_id === "number_hunt"
        ? "5"
        : scene.game_template_id === "math_duel"
          ? "11"
          : scene.game_template_id === "riddle_lock"
            ? "echo"
            : scene.game_template_id === "number_command"
              ? "7"
              : "paper";
  const afterValidUser = noteSceneStateUserTurn(scene, {
    text: validAnswer,
    act: "other",
    sessionTopic: null,
  });
  const progressedReply = buildSceneScaffoldReply({
    act: "other",
    userText: validAnswer,
    sceneState: afterValidUser,
  });
  if (!progressedReply) {
    throw new Error("Game did not produce a follow-up after a valid answer.");
  }
  if (
    !/Second throw now|Second and final guess now|Second prompt: 9 \+ 6|Riddle two:|Number locked\. Complete the command/i.test(progressedReply) &&
    !/That round is complete\./i.test(progressedReply)
  ) {
    throw new Error(`Game did not advance coherently: ${progressedReply}`);
  }
}

async function main() {
  const parsed = parseArgs();
  const baseUrl = parsed.baseUrl;
  const mode = parsed.mode;

  logStep(`Live smoke target: ${baseUrl} | mode=${mode}`);

  logStep("1. Health check");
  const health = await getJson(baseUrl, "/api/health");
  if (health.response.status !== 200) {
    throw new Error(`Health failed: ${health.response.status} ${JSON.stringify(health.body)}`);
  }
  if (health.body.name !== "Raven") {
    throw new Error(`Unexpected health payload: ${JSON.stringify(health.body)}`);
  }

    if (mode === "upload") {
      await runUploadSmoke(baseUrl);
    } else if (mode === "session") {
      await runSessionSmoke(baseUrl);
    } else if (mode === "game") {
      await runGameSmoke(baseUrl);
    } else {
      await runCoreSmoke(baseUrl);
    }

  logStep("Live API smoke passed.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Live API smoke failed: ${message}\n`);
  process.exit(1);
});
