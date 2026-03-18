import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildTaskActionSchemaPromptBlock,
  buildProgressSummaryLines,
  buildTaskContextBlock,
  buildTaskReviewQueue,
  buildTaskRewardPolicyBlock,
  partitionTaskReviewQueue,
  validateTaskRequestAgainstCatalog,
} from "../lib/tasks/system.ts";

const TEST_DB_FILE = path.join(process.cwd(), ".tmp-task-system.sqlite");

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

function testSignalsStatus() {
  return {
    detectors: [
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["person_present", "face_present", "head_pose_yaw"],
      },
    ],
    signals_available: ["person_present", "face_present", "head_pose_yaw"],
  };
}

async function postTasks(payload: Record<string, unknown>) {
  const route = await getTasksRoute();
  const request = new Request("http://127.0.0.1:3000/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return route.POST(request);
}

test("daily schedule creates expected occurrences", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const response = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "20 pushups",
      description: "Complete 20 pushups.",
      schedule: {
        type: "daily",
        days: 3,
        occurrences_per_day: 3,
        allow_make_up: false,
      },
      window_seconds: 86_400,
      repeats_required: 1,
      points_possible: 30,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_points_bonus", params: { bonus_points: 10 } },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 5 } },
    },
    visionSignalsStatus: testSignalsStatus(),
    createdBy: "user",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    created?: {
      id: string;
      repeats_required?: number;
      program_kind?: string;
      strictness_mode?: string;
    };
    occurrences?: Array<{ task_id: string }>;
  };
  assert.ok(body.created?.id);
  assert.equal(body.created?.repeats_required, 9);
  assert.equal(body.created?.program_kind, "habit");
  assert.equal(body.created?.strictness_mode, "standard");
  const count = (body.occurrences ?? []).filter((occurrence) => occurrence.task_id === body.created?.id).length;
  assert.equal(count, 9);

  await db.__resetDbForTests({ deleteFile: true });
});

test("explicit create_habit preserves program kind and strictness", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const response = await postTasks({
    action: "create",
    task: {
      type: "create_habit",
      title: "Daily posture",
      description: "Hold posture once a day.",
      schedule: {
        type: "daily",
        days: 2,
        occurrences_per_day: 1,
        allow_make_up: true,
      },
      window_seconds: 86_400,
      repeats_required: 1,
      points_possible: 8,
      strictness_mode: "soft",
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 2 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    created?: { program_kind?: string; strictness_mode?: string };
  };
  assert.equal(body.created?.program_kind, "habit");
  assert.equal(body.created?.strictness_mode, "soft");

  await db.__resetDbForTests({ deleteFile: true });
});

test("validation upgrades a recurring create_task into create_habit", () => {
  const validation = validateTaskRequestAgainstCatalog(
    {
      type: "create_task",
      title: "Daily obedience routine",
      description: "Complete this every day as a recurring practice.",
      window_seconds: 86_400,
      repeats_required: 1,
      points_possible: 6,
      schedule: {
        type: "daily",
        days: 2,
        occurrences_per_day: 1,
        allow_make_up: false,
      },
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 2 } },
    },
    [],
    { requireRewardConsequenceApproval: false },
  );

  assert.equal(validation.request.type, "create_habit");
  assert.equal(validation.request.program_kind, "habit");
  assert.match(validation.notes.join(" | "), /Normalized task action type to create_habit/i);
});

test("validation upgrades a standing create_task into create_rule", () => {
  const validation = validateTaskRequestAgainstCatalog(
    {
      type: "create_task",
      title: "Standing rule",
      description: "Always ask before you touch anything. This is an ongoing protocol.",
      window_seconds: 3_600,
      repeats_required: 1,
      points_possible: 3,
      schedule: { type: "one_time" },
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    [],
    { requireRewardConsequenceApproval: false },
  );

  assert.equal(validation.request.type, "create_rule");
  assert.equal(validation.request.program_kind, "rule");
});

test("validation upgrades a multi-day create_task into create_challenge", () => {
  const validation = validateTaskRequestAgainstCatalog(
    {
      type: "create_task",
      title: "7 day control challenge",
      description: "A structured seven day challenge with daily check-ins.",
      window_seconds: 86_400,
      repeats_required: 1,
      points_possible: 20,
      schedule: {
        type: "daily",
        days: 7,
        occurrences_per_day: 1,
        allow_make_up: false,
      },
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_points_bonus", params: { bonus_points: 10 } },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 3 } },
    },
    [],
    { requireRewardConsequenceApproval: false },
  );

  assert.equal(validation.request.type, "create_challenge");
  assert.equal(validation.request.program_kind, "challenge");
});

test("habit manual evidence submits for review before completion", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_habit",
      title: "Daily report",
      description: "Submit one report.",
      schedule: { type: "daily", days: 1, occurrences_per_day: 1, allow_make_up: false },
      window_seconds: 86_400,
      repeats_required: 1,
      points_possible: 6,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string; review_state?: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrenceId =
    (createdBody.occurrences ?? []).find((row) => row.task_id === taskId)?.id ?? "";
  assert.ok(taskId);
  assert.ok(occurrenceId);

  const submitResponse = await postTasks({
    action: "submit_manual_evidence",
    taskId,
    occurrenceId,
    summary: "daily report submitted",
    confidence: 0.6,
  });
  assert.equal(submitResponse.status, 200);
  const submitBody = (await submitResponse.json()) as {
    reviewSubmitted?: boolean;
    task?: { status?: string; repeats_completed?: number };
    review_queue?: Array<{ occurrence_id: string; review_state: string }>;
    occurrences?: Array<{ id: string; status: string; review_state?: string }>;
  };
  assert.equal(submitBody.reviewSubmitted, true);
  assert.equal(submitBody.task?.status, "active");
  assert.equal(submitBody.task?.repeats_completed, 0);
  const queueItem = (submitBody.review_queue ?? []).find((item) => item.occurrence_id === occurrenceId);
  assert.equal(queueItem?.review_state, "submitted_for_review");
  const pendingOccurrence = (submitBody.occurrences ?? []).find((item) => item.id === occurrenceId);
  assert.equal(pendingOccurrence?.status, "pending");
  assert.equal(pendingOccurrence?.review_state, "pending_review");

  const reviewResponse = await postTasks({
    action: "review_evidence",
    taskId,
    occurrenceId,
    status: "pass",
    summary: "manual evidence approved",
  });
  assert.equal(reviewResponse.status, 200);
  const reviewBody = (await reviewResponse.json()) as {
    task?: { status?: string; repeats_completed?: number };
    occurrences?: Array<{ id: string; status: string; review_state?: string }>;
  };
  assert.equal(reviewBody.task?.status, "completed");
  assert.equal(reviewBody.task?.repeats_completed, 1);
  const reviewedOccurrence = (reviewBody.occurrences ?? []).find((item) => item.id === occurrenceId);
  assert.equal(reviewedOccurrence?.status, "completed");
  assert.equal(reviewedOccurrence?.review_state, "approved");

  await db.__resetDbForTests({ deleteFile: true });
});

test("submit_manual_evidence completes a one-time task immediately", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Single proof",
      description: "Submit one proof.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 5,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 1,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrenceId =
    (createdBody.occurrences ?? []).find((row) => row.task_id === taskId)?.id ?? "";
  assert.ok(taskId);
  assert.ok(occurrenceId);

  const response = await postTasks({
    action: "submit_manual_evidence",
    taskId,
    occurrenceId,
    summary: "one-time proof submitted",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    reviewSubmitted?: boolean;
    task?: { status?: string; repeats_completed?: number };
    occurrences?: Array<{ id: string; status: string; review_state?: string }>;
  };
  assert.equal(body.reviewSubmitted, undefined);
  assert.equal(body.task?.status, "completed");
  assert.equal(body.task?.repeats_completed, 1);
  const occurrence = (body.occurrences ?? []).find((item) => item.id === occurrenceId);
  assert.equal(occurrence?.status, "completed");
  assert.equal(occurrence?.review_state, "approved");

  await db.__resetDbForTests({ deleteFile: true });
});

test("approved consequence evidence can complete and a new task can be created afterward", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const createResponse = await postTasks({
    action: "create",
    task: {
      type: "create_habit",
      title: "Consequence hold",
      description: "Keep the chastity device on for 30 minutes.",
      schedule: {
        type: "daily",
        days: 1,
        occurrences_per_day: 1,
        allow_make_up: false,
      },
      window_seconds: 1_800,
      repeats_required: 1,
      points_possible: 6,
      strictness_mode: "hard",
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 2 } },
    },
    visionSignalsStatus: testSignalsStatus(),
    createdBy: "raven",
  });
  assert.equal(createResponse.status, 200);
  const createBody = (await createResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  assert.ok(createBody.created?.id);
  const currentOccurrence = (createBody.occurrences ?? []).find(
    (occurrence) => occurrence.task_id === createBody.created?.id,
  );
  assert.ok(currentOccurrence?.id);

  const submitResponse = await postTasks({
    action: "submit_manual_evidence",
    taskId: createBody.created?.id,
    occurrenceId: currentOccurrence?.id,
    summary: "I started the consequence task and kept it on.",
  });
  assert.equal(submitResponse.status, 200);
  const submitBody = (await submitResponse.json()) as {
    reviewSubmitted?: boolean;
  };
  assert.equal(submitBody.reviewSubmitted, true);

  const reviewResponse = await postTasks({
    action: "review_evidence",
    taskId: createBody.created?.id,
    occurrenceId: currentOccurrence?.id,
    status: "pass",
    summary: "Consequence task evidence approved",
  });
  assert.equal(reviewResponse.status, 200);

  const route = await getTasksRoute();
  const stateAfterReviewResponse = await route.GET();
  assert.equal(stateAfterReviewResponse.status, 200);
  const stateAfterReview = (await stateAfterReviewResponse.json()) as {
    occurrences: Array<{ id: string; status: string; review_state: string }>;
    active: Array<{ title: string }>;
  };
  const completedOccurrence = stateAfterReview.occurrences.find(
    (occurrence) => occurrence.id === currentOccurrence?.id,
  );
  assert.equal(completedOccurrence?.status, "completed");
  assert.equal(completedOccurrence?.review_state, "approved");

  const followUpCreate = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Chastity 30m hold",
      description:
        "Keep the chastity device on for 30 minutes, check in once halfway through, and report back when it is done.",
      window_seconds: 1_800,
      repeats_required: 1,
      points_possible: 6,
      schedule: { type: "one_time" },
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
    createdBy: "raven",
  });
  assert.equal(followUpCreate.status, 200);
  const followUpBody = (await followUpCreate.json()) as {
    created?: { id: string; title?: string };
  };
  assert.ok(followUpBody.created?.id);
  assert.match(followUpBody.created?.title ?? "", /Chastity 30m hold/i);

  const finalStateResponse = await route.GET();
  assert.equal(finalStateResponse.status, 200);
  const finalState = (await finalStateResponse.json()) as {
    active: Array<{ title: string }>;
    history: Array<{ title: string }>;
  };
  const activeTaskTitles = finalState.active.map((task) => task.title);
  const historyTaskTitles = finalState.history.map((task) => task.title);
  assert.equal(activeTaskTitles.length, 1);
  assert.ok(activeTaskTitles.some((title) => /Chastity 30m hold/i.test(title)));
  assert.ok(historyTaskTitles.some((title) => /Consequence hold/i.test(title)));

  await db.__resetDbForTests({ deleteFile: true });
});

test("create_challenge persists repeating daily occurrences", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_challenge",
      title: "Chastity block",
      description:
        "Keep the chastity device on for 2 hours. Complete it 3 times per day for 5 days, and report cleanly each time.",
      schedule: { type: "daily", days: 5, occurrences_per_day: 3, allow_make_up: false },
      window_seconds: 7200,
      repeats_required: 15,
      points_possible: 12,
      program_kind: "challenge",
      strictness_mode: "hard",
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 4,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 4 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  assert.equal(createdResponse.status, 200);
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string; program_kind?: string; strictness_mode?: string };
    occurrences?: Array<{ task_id: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const taskOccurrences = (createdBody.occurrences ?? []).filter((row) => row.task_id === taskId);
  assert.ok(taskId);
  assert.equal(createdBody.created?.program_kind, "challenge");
  assert.equal(createdBody.created?.strictness_mode, "hard");
  assert.equal(taskOccurrences.length, 15);

  await db.__resetDbForTests({ deleteFile: true });
});

test("evidence submission updates occurrence status", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Single check",
      description: "One occurrence.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 10,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_points_bonus", params: { bonus_points: 2 } },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 2 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string; status: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrence = (createdBody.occurrences ?? []).find(
    (row) => row.task_id === taskId && row.status === "pending",
  );
  assert.ok(taskId);
  assert.ok(occurrence?.id);

  const attempt = await postTasks({
    action: "record_attempt",
    taskId,
    occurrenceId: occurrence?.id,
    status: "pass_manual",
    evidenceType: "manual",
    summary: "done",
    confidence: 0.7,
  });
  assert.equal(attempt.status, 200);
  const attemptBody = (await attempt.json()) as {
    task?: { status?: string; repeats_completed?: number };
    occurrences?: Array<{ id: string; status: string }>;
  };
  assert.equal(attemptBody.task?.status, "completed");
  assert.equal(attemptBody.task?.repeats_completed, 1);
  const updatedOccurrence = (attemptBody.occurrences ?? []).find((row) => row.id === occurrence?.id);
  assert.equal(updatedOccurrence?.status, "completed");

  await db.__resetDbForTests({ deleteFile: true });
});

test("missed occurrence is marked missed", async () => {
  const db = await getDb();
  const route = await getTasksRoute();
  await db.__resetDbForTests({ deleteFile: true });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Short deadline",
      description: "Will miss this.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 5,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 1,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  const first = (createdBody.occurrences ?? [])[0];
  assert.ok(first?.id);

  await db.updateTaskOccurrenceInDb(first.id, {
    deadline_at: new Date(Date.now() - 60_000).toISOString(),
  });

  const stateResponse = await route.GET();
  assert.equal(stateResponse.status, 200);
  const stateBody = (await stateResponse.json()) as {
    occurrences?: Array<{ id: string; status: string }>;
  };
  const updated = (stateBody.occurrences ?? []).find((row) => row.id === first.id);
  assert.equal(updated?.status, "missed");

  await db.__resetDbForTests({ deleteFile: true });
});

test("task completion applies reward plan", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Reward run",
      description: "Complete once for reward.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 10,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 1,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_points_bonus", params: { bonus_points: 7 } },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 4 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrence = (createdBody.occurrences ?? []).find((row) => row.task_id === taskId);
  assert.ok(taskId);
  assert.ok(occurrence?.id);

  const result = await postTasks({
    action: "record_attempt",
    taskId,
    occurrenceId: occurrence?.id,
    status: "pass_manual",
    evidenceType: "manual",
    summary: "completed",
    confidence: 0.8,
  });
  assert.equal(result.status, 200);
  const resultBody = (await result.json()) as {
    task?: { status?: string };
    progress?: { total_points?: number };
    outcomes?: Array<{ task_id: string; outcome_type: string; catalog_id: string | null }>;
  };
  assert.equal(resultBody.task?.status, "completed");
  assert.equal((resultBody.progress?.total_points ?? 0) >= 17, true);
  const rewardOutcome = (resultBody.outcomes ?? []).find(
    (outcome) => outcome.task_id === taskId && outcome.outcome_type === "reward_applied",
  );
  assert.equal(rewardOutcome?.catalog_id, "reward_points_bonus");

  await db.__resetDbForTests({ deleteFile: true });
});

test("task failure applies consequence plan", async () => {
  const db = await getDb();
  const route = await getTasksRoute();
  await db.__resetDbForTests({ deleteFile: true });

  await db.upsertProfileProgressInDb({
    total_points: 20,
    current_tier: "bronze",
  });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Failure run",
      description: "Will fail by missing occurrence.",
      schedule: { type: "daily", days: 1, occurrences_per_day: 1, allow_make_up: false },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 10,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 1,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 9 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrence = (createdBody.occurrences ?? []).find((row) => row.task_id === taskId);
  assert.ok(taskId);
  assert.ok(occurrence?.id);

  await db.updateTaskOccurrenceInDb(occurrence!.id, {
    deadline_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await db.updateTaskInDb(taskId, {
    due_at: new Date(Date.now() - 60_000).toISOString(),
  });

  const stateResponse = await route.GET();
  assert.equal(stateResponse.status, 200);
  const stateBody = (await stateResponse.json()) as {
    history?: Array<{ id: string; status: string }>;
    outcomes?: Array<{ task_id: string; outcome_type: string; catalog_id: string | null }>;
    progress?: { total_points?: number };
  };
  const failedTask = (stateBody.history ?? []).find((task) => task.id === taskId);
  assert.equal(failedTask?.status, "failed");
  const consequenceOutcome = (stateBody.outcomes ?? []).find(
    (outcome) => outcome.task_id === taskId && outcome.outcome_type === "consequence_applied",
  );
  assert.equal(consequenceOutcome?.catalog_id, "penalty_points");
  assert.equal((stateBody.progress?.total_points ?? 0) <= 11, true);

  await db.__resetDbForTests({ deleteFile: true });
});

test("invalid catalog ids are replaced with defaults", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const response = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Invalid plans",
      description: "Validate defaults.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 5,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 1,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "unknown_reward", params: { points: 1000 } },
      consequence_plan: { catalog_id: "unknown_consequence", params: { penalty_points: 999 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    created?: { reward_plan?: { catalog_id?: string }; consequence_plan?: { catalog_id?: string } };
  };
  assert.equal(body.created?.reward_plan?.catalog_id, "reward_positive_message");
  assert.equal(body.created?.consequence_plan?.catalog_id, "penalty_points");

  await db.__resetDbForTests({ deleteFile: true });
});

test("record_game_result awards points for a user win", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const response = await postTasks({
    action: "record_game_result",
    winner: "user_win",
    templateId: "word_chain",
    stakesApplied: "you unlock it",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    progress?: { total_points?: number; free_pass_count?: number; last_completion_summary?: string | null };
    pointsAwarded?: number;
  };
  assert.equal(body.pointsAwarded, 2);
  assert.equal(body.progress?.total_points, 2);
  assert.equal(body.progress?.free_pass_count, 1);
  assert.match(body.progress?.last_completion_summary ?? "", /word_chain/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Winner: user_win/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Points: \+2/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Reward: free pass granted/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Stakes applied: you unlock it/i);

  await db.__resetDbForTests({ deleteFile: true });
});

test("record_game_result records a Raven win without awarding points", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await db.upsertProfileProgressInDb({
    total_points: 5,
    current_tier: "bronze",
    free_pass_count: 1,
  });

  const response = await postTasks({
    action: "record_game_result",
    winner: "raven_win",
    templateId: "rapid_choice",
    stakesApplied: "you wear it overnight",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    progress?: { total_points?: number; free_pass_count?: number; last_completion_summary?: string | null };
    pointsAwarded?: number;
  };
  assert.equal(body.pointsAwarded, 0);
  assert.equal(body.progress?.total_points, 5);
  assert.equal(body.progress?.free_pass_count, 0);
  assert.match(body.progress?.last_completion_summary ?? "", /rapid_choice/i);
  assert.match(body.progress?.last_completion_summary ?? "", /raven_win/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Points: \+0/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Reward: free pass used/i);
  assert.match(body.progress?.last_completion_summary ?? "", /Stakes applied: you wear it overnight/i);

  await db.__resetDbForTests({ deleteFile: true });
});

test("uploaded image evidence enters review queue and can be approved", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Upload review",
      description: "Submit one image for review.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 4,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 3,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrenceId =
    (createdBody.occurrences ?? []).find((row) => row.task_id === taskId)?.id ?? "";
  assert.ok(taskId);
  assert.ok(occurrenceId);

  const uploadResponse = await postTasks({
    action: "submit_upload_evidence",
    taskId,
    occurrenceId,
    imageDataUrl: "data:image/png;base64,AAAA",
    summary: "front proof",
  });
  assert.equal(uploadResponse.status, 200);
  const uploadBody = (await uploadResponse.json()) as {
    review_queue?: Array<{ occurrence_id: string; review_state: string; preview_image_data_url?: string | null }>;
  };
  const reviewItem = (uploadBody.review_queue ?? []).find((item) => item.occurrence_id === occurrenceId);
  assert.equal(reviewItem?.review_state, "submitted_for_review");
  assert.match(reviewItem?.preview_image_data_url ?? "", /^data:image\/png;base64,/i);

  const reviewResponse = await postTasks({
    action: "review_evidence",
    taskId,
    occurrenceId,
    status: "pass",
  });
  assert.equal(reviewResponse.status, 200);
  const reviewBody = (await reviewResponse.json()) as {
    task?: { status?: string; repeats_completed?: number };
    review_queue?: Array<{ occurrence_id: string }>;
  };
  assert.equal(reviewBody.task?.status, "completed");
  assert.equal(reviewBody.task?.repeats_completed, 1);
  assert.equal(
    (reviewBody.review_queue ?? []).some((item) => item.occurrence_id === occurrenceId),
    false,
  );

  await db.__resetDbForTests({ deleteFile: true });
});

test("approved uploaded evidence can seed the next pending occurrence baseline", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  await postTasks({
    action: "set_preferences",
    requireRewardConsequenceApproval: false,
  });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_habit",
      title: "Repeated upload review",
      description: "Submit one image each day.",
      schedule: { type: "daily", days: 2, occurrences_per_day: 1, allow_make_up: false },
      window_seconds: 600,
      repeats_required: 2,
      points_possible: 4,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 3,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string; occurrence_index: number }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const taskOccurrences = (createdBody.occurrences ?? [])
    .filter((row) => row.task_id === taskId)
    .sort((left, right) => left.occurrence_index - right.occurrence_index);
  const firstOccurrenceId = taskOccurrences[0]?.id ?? "";
  const secondOccurrenceId = taskOccurrences[1]?.id ?? "";
  assert.ok(taskId);
  assert.ok(firstOccurrenceId);
  assert.ok(secondOccurrenceId);

  const uploadResponse = await postTasks({
    action: "submit_upload_evidence",
    taskId,
    occurrenceId: firstOccurrenceId,
    imageDataUrl: "data:image/png;base64,BBBB",
    summary: "baseline source proof",
  });
  assert.equal(uploadResponse.status, 200);

  const reviewResponse = await postTasks({
    action: "review_evidence",
    taskId,
    occurrenceId: firstOccurrenceId,
    status: "pass",
    useAsNextBaseline: true,
  });
  assert.equal(reviewResponse.status, 200);
  const reviewBody = (await reviewResponse.json()) as {
    baselinePromoted?: boolean;
    occurrences?: Array<{ id: string; metadata?: Record<string, unknown> }>;
  };
  assert.equal(reviewBody.baselinePromoted, true);
  const nextOccurrence = (reviewBody.occurrences ?? []).find((row) => row.id === secondOccurrenceId);
  assert.match(
    String(nextOccurrence?.metadata?.evidence_baseline_image_data_url ?? ""),
    /^data:image\/png;base64,/i,
  );
});

test("set_evidence_baseline stores baseline data on the pending occurrence", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Baseline task",
      description: "Store a baseline first.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 2,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string; metadata?: Record<string, unknown> }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrenceId =
    (createdBody.occurrences ?? []).find((row) => row.task_id === taskId)?.id ?? "";
  assert.ok(taskId);
  assert.ok(occurrenceId);

  const baselineResponse = await postTasks({
    action: "set_evidence_baseline",
    taskId,
    occurrenceId,
    imageDataUrl: "data:image/png;base64,AAAA",
  });
  assert.equal(baselineResponse.status, 200);
  const baselineBody = (await baselineResponse.json()) as {
    baselineSet?: boolean;
    occurrences?: Array<{ id: string; metadata?: Record<string, unknown> }>;
  };
  assert.equal(baselineBody.baselineSet, true);
  const updatedOccurrence = (baselineBody.occurrences ?? []).find((row) => row.id === occurrenceId);
  assert.equal(
    typeof updatedOccurrence?.metadata?.evidence_baseline_image_data_url,
    "string",
  );
  assert.match(
    String(updatedOccurrence?.metadata?.evidence_baseline_image_data_url ?? ""),
    /^data:image\/png;base64,/i,
  );

  await db.__resetDbForTests({ deleteFile: true });
});

test("clear_evidence_baseline removes stored baseline metadata from the pending occurrence", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const createdResponse = await postTasks({
    action: "create",
    task: {
      type: "create_task",
      title: "Clear baseline task",
      description: "Clear a saved baseline.",
      schedule: { type: "one_time" },
      window_seconds: 600,
      repeats_required: 1,
      points_possible: 2,
      evidence: {
        required: true,
        type: "manual",
        checks: [],
        max_attempts: 2,
        deny_user_override: false,
      },
      reward_plan: { catalog_id: "reward_positive_message", params: {} },
      consequence_plan: { catalog_id: "penalty_points", params: { penalty_points: 1 } },
    },
    visionSignalsStatus: testSignalsStatus(),
  });
  const createdBody = (await createdResponse.json()) as {
    created?: { id: string };
    occurrences?: Array<{ id: string; task_id: string }>;
  };
  const taskId = createdBody.created?.id ?? "";
  const occurrenceId =
    (createdBody.occurrences ?? []).find((row) => row.task_id === taskId)?.id ?? "";
  assert.ok(taskId);
  assert.ok(occurrenceId);

  const baselineResponse = await postTasks({
    action: "set_evidence_baseline",
    taskId,
    occurrenceId,
    imageDataUrl: "data:image/png;base64,AAAA",
  });
  assert.equal(baselineResponse.status, 200);

  const clearResponse = await postTasks({
    action: "clear_evidence_baseline",
    taskId,
    occurrenceId,
  });
  assert.equal(clearResponse.status, 200);
  const clearBody = (await clearResponse.json()) as {
    baselineCleared?: boolean;
    occurrences?: Array<{ id: string; metadata?: Record<string, unknown> }>;
  };
  assert.equal(clearBody.baselineCleared, true);
  const updatedOccurrence = (clearBody.occurrences ?? []).find((row) => row.id === occurrenceId);
  assert.equal(
    updatedOccurrence?.metadata?.evidence_baseline_image_data_url,
    undefined,
  );
  assert.equal(updatedOccurrence?.metadata?.evidence_baseline_set_at, undefined);
  assert.equal(
    updatedOccurrence?.metadata?.evidence_baseline_source_occurrence_id,
    undefined,
  );

  await db.__resetDbForTests({ deleteFile: true });
});

test("injection includes active task summary and points", () => {
  const block = buildTaskContextBlock({
    activeTasks: [
      {
        id: "task-1",
        title: "Stand in frame",
        description: "Hold still in frame.",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        due_at: "2026-01-01T00:10:00.000Z",
        repeats_required: 3,
        repeats_completed: 1,
        points_awarded: 0,
        points_possible: 10,
        status: "active",
        evidence_policy: {
          required: true,
          type: "camera",
          camera_plan: [{ capability: "presence" }],
          max_attempts: 2,
          deny_user_override: true,
        },
        schedule_policy: {
          type: "one_time",
          window_seconds: 600,
          per_repeat_timeout_seconds: null,
          start_date: null,
          end_date: null,
          days: null,
          occurrences_per_day: 1,
          allow_make_up: false,
        },
        reward_plan: {
          catalog_id: "reward_positive_message",
          params: {},
          approval_status: "approved",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        consequence_plan: {
          catalog_id: "penalty_points",
          params: { penalty_points: 2 },
          approval_status: "approved",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        program_kind: "habit",
        strictness_mode: "hard",
        session_id: "session-a",
        turn_id: "turn-1",
        created_by: "raven",
      },
    ],
    progress: {
      total_points: 75,
      current_tier: "silver",
      free_pass_count: 2,
      streak_days: 0,
      last_task_completed_at: null,
      last_completion_summary: null,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    todayOccurrences: [{ task_id: "task-1", pending: 1, completed: 0, missed: 0 }],
  });
  assert.match(block, /Task context:/);
  assert.match(block, /Points: 75/);
  assert.match(block, /Tier: silver/);
  assert.match(block, /Free passes: 2/);
  assert.match(block, /Stand in frame/);
  assert.match(block, /kind=habit/);
  assert.match(block, /strictness=hard/);
  assert.match(block, /Today occurrences:/);
});

test("task review queue prioritizes retry items and exposes task structure", () => {
  const queue = buildTaskReviewQueue({
    activeTasks: [
      {
        id: "task-1",
        title: "Stand in frame",
        description: "Hold frame",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        due_at: "2026-01-02T00:00:00.000Z",
        repeats_required: 1,
        repeats_completed: 0,
        points_awarded: 0,
        points_possible: 5,
        status: "active",
        evidence_policy: {
          required: true,
          type: "camera",
          camera_plan: [],
          max_attempts: 3,
          deny_user_override: true,
        },
        schedule_policy: {
          type: "one_time",
          window_seconds: 600,
          per_repeat_timeout_seconds: null,
          start_date: null,
          end_date: null,
          days: null,
          occurrences_per_day: 1,
          allow_make_up: false,
        },
        reward_plan: null,
        consequence_plan: null,
        program_kind: "challenge",
        strictness_mode: "hard",
        session_id: null,
        turn_id: null,
        created_by: "raven",
      },
    ],
    occurrences: [
      {
        id: "occ-1",
        task_id: "task-1",
        occurrence_index: 1,
        scheduled_date: "2026-01-01",
        deadline_at: "2026-01-01T12:00:00.000Z",
        status: "pending",
        review_state: "not_required",
        reviewed_at: null,
        completed_at: null,
        metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [
      {
        id: "evt-1",
        task_id: "task-1",
        occurrence_id: "occ-1",
        repeat_index: 1,
        attempt_index: 1,
        evidence_type: "camera",
        status: "inconclusive",
        summary: "Need another pass.",
        confidence: 0.4,
        raw: {},
        created_at: "2026-01-01T01:00:00.000Z",
      },
    ],
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.review_state, "needs_retry");
  assert.equal(queue[0]?.program_kind, "challenge");
  assert.equal(queue[0]?.strictness_mode, "hard");
  assert.equal(queue[0]?.attempts_used, 1);
});

test("task review queue exposes upload analysis from evidence raw data", () => {
  const queue = buildTaskReviewQueue({
    activeTasks: [
      {
        id: "task-1",
        title: "Coverage review",
        description: "Upload proof.",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        due_at: "2026-01-02T00:00:00.000Z",
        repeats_required: 1,
        repeats_completed: 0,
        points_awarded: 0,
        points_possible: 5,
        status: "active",
        evidence_policy: {
          required: true,
          type: "manual",
          camera_plan: [],
          max_attempts: 2,
          deny_user_override: false,
        },
        schedule_policy: {
          type: "one_time",
          window_seconds: 600,
          per_repeat_timeout_seconds: null,
          start_date: null,
          end_date: null,
          days: null,
          occurrences_per_day: 1,
          allow_make_up: false,
        },
        reward_plan: null,
        consequence_plan: null,
        program_kind: "habit",
        strictness_mode: "soft",
        session_id: null,
        turn_id: null,
        created_by: "raven",
      },
    ],
    occurrences: [
      {
        id: "occ-1",
        task_id: "task-1",
        occurrence_index: 1,
        scheduled_date: "2026-01-01",
        deadline_at: "2026-01-01T12:00:00.000Z",
        status: "pending",
        review_state: "pending_review",
        reviewed_at: null,
        completed_at: null,
        metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [
      {
        id: "evt-1",
        task_id: "task-1",
        occurrence_id: "occ-1",
        repeat_index: 1,
        attempt_index: 1,
        evidence_type: "file_upload",
        status: "inconclusive",
        summary: "Uploaded image evidence.",
        confidence: 0,
        raw: {
          image_data_url: "data:image/png;base64,abcd",
          evidence_analysis: {
            provider_id: "safe_coverage_v1",
            status: "pass_candidate",
            confidence: 0.74,
            summary: "Coverage analysis suggests reduced upper-body coverage.",
            review_recommended: true,
            signals: [
              {
                id: "upper_body_coverage_reduced",
                state: "positive",
                score: 0.74,
                summary: "Upper body coverage signal 74%.",
              },
            ],
            metadata: { upper_skin_ratio: 0.21, baseline_used: "no" },
          },
        },
        created_at: "2026-01-01T01:00:00.000Z",
      },
    ],
  });

  assert.equal(queue[0]?.analysis_status, "pass_candidate");
  assert.equal(queue[0]?.analysis_mode, "baseline_free");
  assert.match(queue[0]?.analysis_summary ?? "", /reduced upper-body coverage/i);
  assert.equal(queue[0]?.analysis_provider_id, "safe_coverage_v1");
  assert.equal(queue[0]?.analysis_signals[0]?.id, "upper_body_coverage_reduced");
  assert.equal(queue[0]?.baseline_source, "none");
});

test("task review queue marks baseline-assisted analysis when the analyzer used a baseline", () => {
  const queue = buildTaskReviewQueue({
    activeTasks: [
      {
        id: "task-1",
        title: "Baseline assisted upload",
        description: "Compare against a saved baseline.",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        due_at: "2026-01-01T23:59:59.000Z",
        repeats_required: 1,
        repeats_completed: 0,
        points_awarded: 0,
        points_possible: 5,
        status: "active",
        evidence_policy: {
          required: true,
          type: "manual",
          camera_plan: [],
          max_attempts: 2,
          deny_user_override: false,
        },
        schedule_policy: {
          type: "one_time",
          window_seconds: 600,
          per_repeat_timeout_seconds: null,
          start_date: null,
          end_date: null,
          days: null,
          occurrences_per_day: 1,
          allow_make_up: false,
        },
        reward_plan: null,
        consequence_plan: null,
        program_kind: "habit",
        strictness_mode: "standard",
        session_id: null,
        turn_id: null,
        created_by: "raven",
      },
    ],
    occurrences: [
      {
        id: "occ-1",
        task_id: "task-1",
        occurrence_index: 1,
        scheduled_date: "2026-01-01",
        deadline_at: "2026-01-01T12:00:00.000Z",
        status: "pending",
        review_state: "pending_review",
        reviewed_at: null,
        completed_at: null,
        metadata: {
          evidence_baseline_image_data_url: "data:image/png;base64,abcd",
          evidence_baseline_set_at: "2026-01-01T09:00:00.000Z",
        },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [
      {
        id: "event-1",
        task_id: "task-1",
        occurrence_id: "occ-1",
        repeat_index: 1,
        attempt_index: 1,
        status: "inconclusive",
        summary: "Waiting on reviewed evidence.",
        confidence: 0.52,
        raw: {
          image_data_url: "data:image/png;base64,bbbb",
          evidence_analysis: {
            provider_id: "safe_coverage_v1",
            status: "inconclusive",
            confidence: 0.52,
            summary: "Coverage changed against the saved baseline.",
            review_recommended: true,
            signals: [],
            metadata: { baseline_used: "yes" },
          },
        },
        evidence_type: "file_upload",
        created_at: "2026-01-01T01:00:00.000Z",
      },
    ],
  });

  assert.equal(queue[0]?.analysis_mode, "baseline_assisted");
});

test("task review queue exposes carried-forward baseline source for the next pending occurrence", () => {
  const queue = buildTaskReviewQueue({
    activeTasks: [
      {
        id: "task-1",
        title: "Baseline carry",
        description: "Carry forward baseline.",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        due_at: "2026-01-02T00:00:00.000Z",
        repeats_required: 2,
        repeats_completed: 1,
        points_awarded: 0,
        points_possible: 5,
        status: "active",
        evidence_policy: {
          required: true,
          type: "manual",
          camera_plan: [],
          max_attempts: 2,
          deny_user_override: false,
        },
        schedule_policy: {
          type: "daily",
          window_seconds: 86_400,
          per_repeat_timeout_seconds: null,
          start_date: "2026-01-01",
          end_date: "2026-01-02",
          days: 2,
          occurrences_per_day: 1,
          allow_make_up: false,
        },
        reward_plan: null,
        consequence_plan: null,
        program_kind: "habit",
        strictness_mode: "standard",
        session_id: null,
        turn_id: null,
        created_by: "raven",
      },
    ],
    occurrences: [
      {
        id: "occ-2",
        task_id: "task-1",
        occurrence_index: 2,
        scheduled_date: "2026-01-02",
        deadline_at: "2026-01-02T12:00:00.000Z",
        status: "pending",
        review_state: "not_required",
        reviewed_at: null,
        completed_at: null,
        metadata: {
          evidence_baseline_image_data_url: "data:image/png;base64,abcd",
          evidence_baseline_set_at: "2026-01-01T10:00:00.000Z",
          evidence_baseline_source_occurrence_id: "occ-1",
        },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [],
  });

  assert.equal(queue[0]?.baseline_source, "carried_forward");
  assert.equal(queue[0]?.baseline_set_at, "2026-01-01T10:00:00.000Z");
});

test("task reward policy block explains free pass behavior", () => {
  const block = buildTaskRewardPolicyBlock(2);
  assert.match(block, /Task reward policy:/);
  assert.match(block, /Free passes available: 2/);
  assert.match(block, /cancels the next Raven win consequence task once/i);
  assert.match(block, /must not invent any extra free pass effect/i);
});

test("task action schema prompt lists explicit compliance item types", () => {
  const block = buildTaskActionSchemaPromptBlock();
  assert.match(block, /\bcreate_task\b/);
  assert.match(block, /\bcreate_rule\b/);
  assert.match(block, /\bcreate_habit\b/);
  assert.match(block, /\bcreate_challenge\b/);
  assert.match(block, /Use create_rule for an ongoing protocol or standing rule/i);
  assert.match(block, /program_kind\":\"task\|rule\|habit\|challenge/i);
});

test("task review queue partitions into pending review, retry, and awaiting submission", () => {
  const buckets = partitionTaskReviewQueue([
    {
      task_id: "task-1",
      occurrence_id: "occ-1",
      title: "Pending",
      program_kind: "habit",
      strictness_mode: "hard",
      scheduled_date: "2026-02-28",
      deadline_at: "2026-02-28T23:59:59.000Z",
      evidence_type: "manual",
      attempts_used: 1,
      max_attempts: 2,
      review_state: "submitted_for_review",
      last_status: "submitted_for_review",
      last_summary: "Waiting on review.",
      preview_image_data_url: null,
      analysis_status: null,
      analysis_mode: null,
      analysis_summary: null,
      analysis_confidence: null,
      analysis_provider_id: null,
      analysis_signals: [],
      baseline_source: "none",
      baseline_set_at: null,
    },
    {
      task_id: "task-2",
      occurrence_id: "occ-2",
      title: "Retry",
      program_kind: "challenge",
      strictness_mode: "soft",
      scheduled_date: "2026-02-28",
      deadline_at: "2026-02-28T23:59:59.000Z",
      evidence_type: "mixed",
      attempts_used: 1,
      max_attempts: 2,
      review_state: "needs_retry",
      last_status: "fail",
      last_summary: "Rejected.",
      preview_image_data_url: null,
      analysis_status: null,
      analysis_mode: null,
      analysis_summary: null,
      analysis_confidence: null,
      analysis_provider_id: null,
      analysis_signals: [],
      baseline_source: "none",
      baseline_set_at: null,
    },
    {
      task_id: "task-3",
      occurrence_id: "occ-3",
      title: "Awaiting",
      program_kind: "rule",
      strictness_mode: "standard",
      scheduled_date: "2026-02-28",
      deadline_at: "2026-02-28T23:59:59.000Z",
      evidence_type: "manual",
      attempts_used: 0,
      max_attempts: 2,
      review_state: "awaiting_submission",
      last_status: null,
      last_summary: "Awaiting proof.",
      preview_image_data_url: null,
      analysis_status: null,
      analysis_mode: null,
      analysis_summary: null,
      analysis_confidence: null,
      analysis_provider_id: null,
      analysis_signals: [],
      baseline_source: "none",
      baseline_set_at: null,
    },
  ]);

  assert.equal(buckets.pendingReview.length, 1);
  assert.equal(buckets.pendingReview[0]?.occurrence_id, "occ-1");
  assert.equal(buckets.needsRetry.length, 1);
  assert.equal(buckets.needsRetry[0]?.occurrence_id, "occ-2");
  assert.equal(buckets.awaitingSubmission.length, 1);
  assert.equal(buckets.awaitingSubmission[0]?.occurrence_id, "occ-3");
});

test("progress summary lines expose latest reward and stakes state cleanly", () => {
  const lines = buildProgressSummaryLines({
    total_points: 7,
    current_tier: "bronze",
    free_pass_count: 1,
    streak_days: 0,
    last_task_completed_at: null,
    last_completion_summary:
      "Game result: word_chain. Winner: user_win. Points: +2. Reward: free pass granted. Stakes applied: you unlock it.",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(lines[0], "bronze tier, 7 points, 1 free pass.");
  assert.match(lines.join(" | "), /Latest game: word_chain \(user_win\)\./);
  assert.match(lines.join(" | "), /Latest reward state: free pass granted\./);
  assert.match(lines.join(" | "), /Latest stakes effect: you unlock it\./);
});
