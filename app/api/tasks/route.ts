import { NextResponse } from "next/server.js";

import {
  appendTaskEvidenceEventInDb,
  appendTaskOutcomeEventInDb,
  createTaskInDb,
  createTaskOccurrencesInDb,
  deleteAllTasksData,
  findNextPendingTaskOccurrenceInDb,
  getProfileProgressFromDb,
  getTaskByIdFromDb,
  getTaskOccurrenceByIdFromDb,
  getTaskPreferencesFromDb,
  listTaskEvidenceEventsFromDb,
  listTaskOccurrencesFromDb,
  listTaskOutcomeEventsFromDb,
  listTasksFromDb,
  markMissedTaskOccurrencesInDb,
  updateTaskInDb,
  updateTaskOccurrenceInDb,
  upsertProfileProgressInDb,
  upsertTaskPreferencesInDb,
  type TaskEvidenceEventStatus,
  type TaskEvidenceRecordType,
  type TaskPlanSelection,
  type TaskRow,
} from "../../../lib/db.ts";
import {
  buildCapabilityCatalog,
  normalizeVisionSignalsStatus,
} from "../../../lib/camera/vision-capabilities.ts";
import {
  buildOccurrencesForSchedule,
  buildTaskReviewQueue,
  buildTaskDueAt,
  deriveTier,
  getTierRewards,
  parseCreateTaskRequest,
  parseCreateTaskRequestFromText,
  shouldTaskRouteEvidenceToReview,
  TASK_CONSEQUENCE_CATALOG,
  TASK_REWARD_CATALOG,
  toTaskPlanSelection,
  validateTaskRequestAgainstCatalog,
} from "../../../lib/tasks/system.ts";
import { normalizeEvidenceAnalysisResult } from "../../../lib/vision/evidence-provider.ts";

type TaskRequestBody = {
  action?: unknown;
  task?: unknown;
  assistantText?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  createdBy?: unknown;
  taskId?: unknown;
  occurrenceId?: unknown;
  status?: unknown;
  evidenceType?: unknown;
  summary?: unknown;
  confidence?: unknown;
  raw?: unknown;
  visionSignalsStatus?: unknown;
  objectLabels?: unknown;
  confirm?: unknown;
  requireRewardConsequenceApproval?: unknown;
  planType?: unknown;
  catalogId?: unknown;
  params?: unknown;
  winner?: unknown;
  templateId?: unknown;
  stakesApplied?: unknown;
  imageDataUrl?: unknown;
  analysis?: unknown;
  useAsNextBaseline?: unknown;
};

function toTaskId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAttemptEvidenceType(value: unknown): TaskEvidenceRecordType {
  if (value === "camera" || value === "manual" || value === "file_upload") {
    return value;
  }
  return "manual";
}

function normalizeAttemptStatus(value: unknown): TaskEvidenceEventStatus {
  if (
    value === "pass" ||
    value === "pass_manual" ||
    value === "fail" ||
    value === "timeout" ||
    value === "inconclusive" ||
    value === "blocked"
  ) {
    return value;
  }
  return "inconclusive";
}

function normalizeObjectLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
        .filter((item) => item.length > 0),
    ),
  ].slice(0, 120);
}

function getTodayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nextDayYmd(ymd: string): string {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
    next.getDate(),
  ).padStart(2, "0")}`;
}

function endOfDayIso(ymd: string): string {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeImageDataUrl(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) {
    return "";
  }
  if (text.length > 8_000_000) {
    return "";
  }
  return text;
}

function summarizeTodayOccurrences(
  taskId: string,
  allOccurrences: Awaited<ReturnType<typeof listTaskOccurrencesFromDb>>,
) {
  const today = getTodayYmd();
  const rows = allOccurrences.filter(
    (occurrence) => occurrence.task_id === taskId && occurrence.scheduled_date === today,
  );
  return {
    task_id: taskId,
    pending: rows.filter((occurrence) => occurrence.status === "pending").length,
    completed: rows.filter((occurrence) => occurrence.status === "completed").length,
    missed: rows.filter((occurrence) => occurrence.status === "missed").length,
  };
}

async function applyRewardPlanOnCompletion(
  task: TaskRow,
  progress: Awaited<ReturnType<typeof getProfileProgressFromDb>>,
) {
  const plan = task.reward_plan;
  let nextPoints = progress.total_points + task.points_possible;
  const notes: string[] = [`Base points awarded: +${task.points_possible}`];
  if (plan?.catalog_id === "reward_points_bonus") {
    const bonus = Math.max(0, Math.min(50, Math.floor(Number(plan.params.bonus_points) || 0)));
    if (bonus > 0) {
      nextPoints += bonus;
      notes.push(`Bonus points: +${bonus}`);
    }
  }
  const nextTier = deriveTier(nextPoints);
  const updatedProgress = await upsertProfileProgressInDb({
    total_points: nextPoints,
    current_tier: nextTier,
    last_task_completed_at: new Date().toISOString(),
    last_completion_summary: `Completed task: ${task.title} (${notes.join(", ")})`,
  });
  await appendTaskOutcomeEventInDb({
    taskId: task.id,
    outcomeType: "reward_applied",
    catalogId: plan?.catalog_id ?? null,
    summary: `Reward applied for completed task: ${task.title}. ${notes.join(" | ")}`,
    params: plan?.params ?? {},
  });
  return {
    progress: updatedProgress,
    tierUp: nextTier !== progress.current_tier,
    pointsAwarded: task.points_possible,
    summary: notes.join(", "),
  };
}

async function applyConsequencePlanOnFailure(
  task: TaskRow,
  progress: Awaited<ReturnType<typeof getProfileProgressFromDb>>,
) {
  const plan = task.consequence_plan;
  let nextPoints = progress.total_points;
  const notes: string[] = [];
  if (plan?.catalog_id === "penalty_points") {
    const penalty = Math.max(
      0,
      Math.min(30, Math.floor(Number(plan.params.penalty_points) || 0)),
    );
    if (penalty > 0) {
      nextPoints = Math.max(0, nextPoints - penalty);
      notes.push(`Penalty points: -${penalty}`);
    }
  }
  if (plan?.catalog_id === "reset_streak") {
    notes.push("Streak reset");
  }
  if (plan?.catalog_id === "extra_occurrence_next_day" && task.schedule_policy.allow_make_up) {
    const nextYmd = nextDayYmd(getTodayYmd());
    const count = Math.max(1, Math.min(3, Math.floor(Number(plan.params.count) || 1)));
    const existing = await listTaskOccurrencesFromDb({ taskId: task.id, status: "all", limit: 3000 });
    const maxIndex = existing.reduce((maxValue, row) => Math.max(maxValue, row.occurrence_index), 0);
    const extraRows = Array.from({ length: count }, (_, index) => ({
      occurrence_index: maxIndex + index + 1,
      scheduled_date: nextYmd,
      deadline_at: endOfDayIso(nextYmd),
      status: "pending" as const,
      metadata: { source: "consequence_extra_occurrence" },
    }));
    if (extraRows.length > 0) {
      await createTaskOccurrencesInDb({ taskId: task.id, occurrences: extraRows });
      await updateTaskInDb(task.id, {
        repeats_required: task.repeats_required + extraRows.length,
        due_at: endOfDayIso(nextYmd),
        status: "active",
      });
      notes.push(`Added ${extraRows.length} make-up occurrence(s) for ${nextYmd}`);
    }
  }
  const nextTier = deriveTier(nextPoints);
  const updatedProgress = await upsertProfileProgressInDb({
    total_points: nextPoints,
    current_tier: nextTier,
    streak_days: plan?.catalog_id === "reset_streak" ? 0 : progress.streak_days,
    last_completion_summary: `Task failed: ${task.title}. ${notes.join(", ") || "Consequence recorded."}`,
  });
  await appendTaskOutcomeEventInDb({
    taskId: task.id,
    outcomeType: "consequence_applied",
    catalogId: plan?.catalog_id ?? null,
    summary: `Consequence applied for failed task: ${task.title}. ${notes.join(" | ") || "No numeric change."}`,
    params: plan?.params ?? {},
  });
  return { progress: updatedProgress, summary: notes.join(", ") || "Consequence recorded." };
}

async function applyDeterministicGameResult(input: {
  winner: "user_win" | "raven_win";
  templateId: string;
  stakesApplied: string;
}) {
  const progress = await getProfileProgressFromDb();
  let nextPoints = progress.total_points;
  let nextFreePassCount = progress.free_pass_count;
  let pointsAwarded = 0;
  const notes: string[] = [];

  if (input.winner === "user_win") {
    pointsAwarded = 2;
    nextPoints += pointsAwarded;
    nextFreePassCount += 1;
    notes.push(`Game win bonus: +${pointsAwarded}`);
    notes.push("Free pass granted");
  } else {
    if (nextFreePassCount > 0) {
      nextFreePassCount = Math.max(0, nextFreePassCount - 1);
      notes.push("Free pass used");
    }
    notes.push("Raven won the round");
  }
  if (input.stakesApplied) {
    notes.push(`Applied stakes: ${input.stakesApplied}`);
  }

  const rewardSummary =
    input.winner === "user_win"
      ? "Reward: free pass granted"
      : progress.free_pass_count > 0
        ? "Reward: free pass used"
        : "Reward: none";
  const pointsSummary =
    pointsAwarded > 0 ? `Points: +${pointsAwarded}` : "Points: +0";
  const stakesSummary = input.stakesApplied
    ? `Stakes applied: ${input.stakesApplied}`
    : "Stakes applied: none";

  const nextTier = deriveTier(nextPoints);
  const updatedProgress = await upsertProfileProgressInDb({
    total_points: nextPoints,
    current_tier: nextTier,
    free_pass_count: nextFreePassCount,
    last_completion_summary: [
      `Game result: ${input.templateId}`,
      `Winner: ${input.winner}`,
      pointsSummary,
      rewardSummary,
      stakesSummary,
    ].join(". "),
  });

  return {
    progress: updatedProgress,
    tierUp: nextTier !== progress.current_tier,
    pointsAwarded,
    summary: notes.join(", "),
  };
}

async function syncTaskStatusesAndMisses(nowIso = new Date().toISOString()) {
  await markMissedTaskOccurrencesInDb(nowIso);
  const activeTasks = await listTasksFromDb({ status: "active", limit: 500 });
  let progress = await getProfileProgressFromDb();
  for (const task of activeTasks) {
    const occurrences = await listTaskOccurrencesFromDb({
      taskId: task.id,
      status: "all",
      limit: 3000,
    });
    const completedCount = occurrences.filter((occurrence) => occurrence.status === "completed").length;
    if (completedCount !== task.repeats_completed) {
      await updateTaskInDb(task.id, { repeats_completed: completedCount });
    }
    if (completedCount >= task.repeats_required) {
      await updateTaskInDb(task.id, { status: "completed", repeats_completed: completedCount });
      continue;
    }
    const pendingCount = occurrences.filter((occurrence) => occurrence.status === "pending").length;
    if (pendingCount > 0) {
      continue;
    }
    if (task.due_at <= nowIso) {
      if (task.schedule_policy.type === "daily") {
        const updated = await updateTaskInDb(task.id, { status: "failed" });
        const outcomes = await listTaskOutcomeEventsFromDb({ taskId: task.id, limit: 30 });
        if (!outcomes.some((event) => event.outcome_type === "consequence_applied")) {
          const result = await applyConsequencePlanOnFailure(updated ?? task, progress);
          progress = result.progress;
        }
      } else {
        const updated = await updateTaskInDb(task.id, { status: "expired" });
        const outcomes = await listTaskOutcomeEventsFromDb({ taskId: task.id, limit: 30 });
        if (!outcomes.some((event) => event.outcome_type === "consequence_applied")) {
          const result = await applyConsequencePlanOnFailure(updated ?? task, progress);
          progress = result.progress;
        }
      }
    }
  }
}

async function buildTasksState() {
  await syncTaskStatusesAndMisses();
  const [allTasks, events, occurrences, outcomes, progress, preferences] = await Promise.all([
    listTasksFromDb({ status: "all", limit: 300 }),
    listTaskEvidenceEventsFromDb({ limit: 800 }),
    listTaskOccurrencesFromDb({ status: "all", limit: 5000 }),
    listTaskOutcomeEventsFromDb({ limit: 400 }),
    getProfileProgressFromDb(),
    getTaskPreferencesFromDb(),
  ]);
  const active = allTasks.filter((task) => task.status === "active");
  const history = allTasks.filter((task) => task.status !== "active").slice(0, 150);
  const rewards = getTierRewards(progress.current_tier);
  const today = active.map((task) => summarizeTodayOccurrences(task.id, occurrences));
  const reviewQueue = buildTaskReviewQueue({
    activeTasks: active,
    occurrences,
    events,
  });
  return {
    active,
    history,
    events,
    occurrences,
    outcomes,
    progress,
    rewards,
    review_queue: reviewQueue,
    preferences,
    catalogs: {
      rewards: TASK_REWARD_CATALOG,
      consequences: TASK_CONSEQUENCE_CATALOG,
    },
    today,
  };
}

async function resolveActiveTaskAndOccurrence(input: {
  taskId: string;
  occurrenceId?: string;
}) {
  await syncTaskStatusesAndMisses();
  const task = await getTaskByIdFromDb(input.taskId);
  if (!task) {
    return { error: "Task not found.", status: 404 as const };
  }
  if (task.status !== "active") {
    return { error: `Task is not active (${task.status}).`, status: 400 as const };
  }
  const occurrence = input.occurrenceId
    ? await getTaskOccurrenceByIdFromDb(input.occurrenceId)
    : await findNextPendingTaskOccurrenceInDb(task.id);
  if (!occurrence || occurrence.task_id !== task.id) {
    return { error: "No pending occurrence found.", status: 400 as const };
  }
  if (occurrence.status !== "pending") {
    return { error: "Occurrence is not pending.", status: 400 as const };
  }
  const nowIso = new Date().toISOString();
  if (occurrence.deadline_at <= nowIso) {
    await updateTaskOccurrenceInDb(occurrence.id, { status: "missed" });
    return {
      error: "Occurrence deadline has passed and is now marked missed.",
      status: 400 as const,
      state: await buildTasksState(),
    };
  }
  return { task, occurrence };
}

async function finalizeEvidenceAttempt(input: {
  task: TaskRow;
  occurrenceId: string;
  occurrenceIndex: number;
  status: TaskEvidenceEventStatus;
  evidenceType: TaskEvidenceRecordType;
  summary: string;
  confidence: number;
  raw: Record<string, unknown>;
}) {
  const currentOccurrence = await getTaskOccurrenceByIdFromDb(input.occurrenceId);
  if (!currentOccurrence || currentOccurrence.task_id !== input.task.id) {
    throw new Error("Occurrence not found during finalization.");
  }
  const taskEvents = await listTaskEvidenceEventsFromDb({ taskId: input.task.id, limit: 1000 });
  const occurrenceEvents = taskEvents.filter((event) => event.occurrence_id === input.occurrenceId);
  const alreadyPassed = occurrenceEvents.some(
    (event) => event.status === "pass" || event.status === "pass_manual",
  );
  const attemptIndex = Math.max(1, occurrenceEvents.length + 1);

  const appended = await appendTaskEvidenceEventInDb({
    taskId: input.task.id,
    occurrenceId: input.occurrenceId,
    repeatIndex: input.occurrenceIndex,
    attemptIndex,
    evidenceType: input.evidenceType,
    status: input.status,
    summary: input.summary,
    confidence: input.confidence,
    raw: input.raw,
  });

  let taskAfterUpdate = input.task;
  const reviewedAt = new Date().toISOString();
  const isReviewDecision =
    typeof input.raw.review_source === "string" ||
    currentOccurrence.review_state === "pending_review";
  if ((input.status === "pass" || input.status === "pass_manual") && !alreadyPassed) {
    await updateTaskOccurrenceInDb(input.occurrenceId, {
      status: "completed",
      review_state: isReviewDecision ? "approved" : "not_required",
      reviewed_at: isReviewDecision ? reviewedAt : null,
      completed_at: new Date().toISOString(),
    });
  } else if (
    input.status === "fail" ||
    input.status === "timeout" ||
    input.status === "inconclusive" ||
    input.status === "blocked"
  ) {
    if (attemptIndex >= input.task.evidence_policy.max_attempts) {
      await updateTaskOccurrenceInDb(input.occurrenceId, {
        status: "verified_failed",
        review_state: isReviewDecision ? "rejected" : currentOccurrence.review_state,
        reviewed_at: isReviewDecision ? reviewedAt : currentOccurrence.reviewed_at,
      });
    } else if (isReviewDecision) {
      await updateTaskOccurrenceInDb(input.occurrenceId, {
        review_state: "rejected",
        reviewed_at: reviewedAt,
      });
    }
  }

  const allOccurrences = await listTaskOccurrencesFromDb({
    taskId: input.task.id,
    status: "all",
    limit: 3000,
  });
  const completedCount = allOccurrences.filter((item) => item.status === "completed").length;
  const pendingCount = allOccurrences.filter((item) => item.status === "pending").length;
  taskAfterUpdate =
    (await updateTaskInDb(input.task.id, { repeats_completed: completedCount })) ?? input.task;

  let pointsAwarded = 0;
  let tierUp = false;
  let updatedProgress = await getProfileProgressFromDb();
  if (completedCount >= taskAfterUpdate.repeats_required && taskAfterUpdate.status === "active") {
    taskAfterUpdate =
      (await updateTaskInDb(input.task.id, {
        status: "completed",
        repeats_completed: completedCount,
        points_awarded: taskAfterUpdate.points_possible,
      })) ?? taskAfterUpdate;
    const rewardResult = await applyRewardPlanOnCompletion(taskAfterUpdate, updatedProgress);
    updatedProgress = rewardResult.progress;
    pointsAwarded = rewardResult.pointsAwarded;
    tierUp = rewardResult.tierUp;
  } else if (pendingCount === 0 && taskAfterUpdate.status === "active") {
    const failedStatus = taskAfterUpdate.schedule_policy.type === "daily" ? "failed" : "expired";
    taskAfterUpdate =
      (await updateTaskInDb(input.task.id, { status: failedStatus })) ?? taskAfterUpdate;
    if (failedStatus === "failed" || failedStatus === "expired") {
      const consequenceResult = await applyConsequencePlanOnFailure(
        taskAfterUpdate,
        updatedProgress,
      );
      updatedProgress = consequenceResult.progress;
    }
  }

  return {
    attempt: appended,
    task: taskAfterUpdate,
    pointsAwarded,
    tierUp,
    progress: updatedProgress,
  };
}

async function submitOccurrenceForReview(input: {
  task: TaskRow;
  occurrenceId: string;
  occurrenceIndex: number;
  evidenceType: TaskEvidenceRecordType;
  summary: string;
  confidence: number;
  raw: Record<string, unknown>;
}) {
  const taskEvents = await listTaskEvidenceEventsFromDb({ taskId: input.task.id, limit: 1000 });
  const occurrenceEvents = taskEvents.filter((event) => event.occurrence_id === input.occurrenceId);
  const pendingReview = occurrenceEvents.find(
    (event) =>
      event.status === "inconclusive" &&
      (event.evidence_type === "manual" || event.evidence_type === "file_upload"),
  );
  if (pendingReview) {
    return { error: "Evidence is already awaiting review for this occurrence." };
  }
  const attemptIndex = Math.max(1, occurrenceEvents.length + 1);
  const appended = await appendTaskEvidenceEventInDb({
    taskId: input.task.id,
    occurrenceId: input.occurrenceId,
    repeatIndex: input.occurrenceIndex,
    attemptIndex,
    evidenceType: input.evidenceType,
    status: "inconclusive",
    summary: input.summary,
    confidence: input.confidence,
    raw: input.raw,
  });
  const occurrence = await updateTaskOccurrenceInDb(input.occurrenceId, {
    review_state: "pending_review",
    reviewed_at: null,
  });
  return { attempt: appended, occurrence };
}

export async function GET() {
  return NextResponse.json(await buildTasksState());
}

export async function POST(request: Request) {
  let payload: TaskRequestBody;
  try {
    payload = (await request.json()) as TaskRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = typeof payload.action === "string" ? payload.action.trim() : "";

  if (action === "set_preferences") {
    const preferences = await upsertTaskPreferencesInDb({
      require_reward_consequence_approval:
        payload.requireRewardConsequenceApproval === true,
    });
    return NextResponse.json({ ...(await buildTasksState()), preferences });
  }

  if (action === "create") {
    const parsed =
      parseCreateTaskRequest(payload.task) ??
      (typeof payload.assistantText === "string"
        ? parseCreateTaskRequestFromText(payload.assistantText)
        : null);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid create_task payload." }, { status: 400 });
    }

    const preferences = await getTaskPreferencesFromDb();
    const capabilityCatalog = buildCapabilityCatalog(
      normalizeVisionSignalsStatus(payload.visionSignalsStatus),
      { objectLabelOptions: normalizeObjectLabels(payload.objectLabels) },
    );
    const validation = validateTaskRequestAgainstCatalog(parsed, capabilityCatalog, {
      requireRewardConsequenceApproval: preferences.require_reward_consequence_approval,
    });
    const dueAt =
      validation.schedulePolicy.type === "daily" && validation.schedulePolicy.end_date
        ? endOfDayIso(validation.schedulePolicy.end_date)
        : buildTaskDueAt(validation.request.window_seconds);
    const created = await createTaskInDb({
      title: validation.request.title,
      description: validation.request.description,
      dueAt,
      repeatsRequired: validation.request.repeats_required,
      pointsPossible: validation.request.points_possible,
      status: "active",
      evidencePolicy: {
        required: validation.request.evidence.required,
        type: validation.request.evidence.type,
        camera_plan: validation.request.evidence.checks,
        max_attempts: validation.request.evidence.max_attempts,
        deny_user_override: validation.request.evidence.deny_user_override,
      },
      schedulePolicy: validation.schedulePolicy,
      rewardPlan: validation.rewardPlan,
      consequencePlan: validation.consequencePlan,
      programKind: validation.request.program_kind,
      strictnessMode: validation.request.strictness_mode,
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null,
      turnId: typeof payload.turnId === "string" ? payload.turnId : null,
      createdBy: payload.createdBy === "user" ? "user" : "raven",
    });
    const occurrences = buildOccurrencesForSchedule({
      schedulePolicy: validation.schedulePolicy,
      repeatsRequired: validation.request.repeats_required,
      dueAt,
    });
    await createTaskOccurrencesInDb({
      taskId: created.id,
      occurrences,
    });
    return NextResponse.json({
      created,
      validation,
      ...(await buildTasksState()),
    });
  }

  if (action === "approve_plan") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const task = await getTaskByIdFromDb(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    const planType = payload.planType === "consequence" ? "consequence" : "reward";
    const plan = toTaskPlanSelection(planType, {
      catalog_id:
        typeof payload.catalogId === "string"
          ? payload.catalogId
          : planType === "reward"
            ? task.reward_plan?.catalog_id ?? "reward_positive_message"
            : task.consequence_plan?.catalog_id ?? "penalty_points",
      params: asRecord(payload.params),
    });
    const approvedPlan: TaskPlanSelection = {
      ...plan,
      approval_status: "approved",
      updated_at: new Date().toISOString(),
    };
    const updated = await updateTaskInDb(task.id, {
      reward_plan: planType === "reward" ? approvedPlan : task.reward_plan,
      consequence_plan:
        planType === "consequence" ? approvedPlan : task.consequence_plan,
    });
    return NextResponse.json({ task: updated, ...(await buildTasksState()) });
  }

  if (action === "record_attempt") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const occurrenceId = typeof payload.occurrenceId === "string" ? payload.occurrenceId.trim() : "";
    const resolved = await resolveActiveTaskAndOccurrence({ taskId, occurrenceId });
    if ("error" in resolved) {
      return NextResponse.json(
        resolved.state ? { error: resolved.error, ...resolved.state } : { error: resolved.error },
        { status: resolved.status },
      );
    }
    const { task, occurrence } = resolved;
    if (occurrence.review_state === "pending_review") {
      return NextResponse.json(
        { error: "This occurrence already has evidence awaiting review." },
        { status: 400 },
      );
    }

    const status = normalizeAttemptStatus(payload.status);
    const evidenceType = normalizeAttemptEvidenceType(payload.evidenceType);
    if (
      task.evidence_policy.type === "camera" &&
      task.evidence_policy.deny_user_override &&
      (status === "pass_manual" || evidenceType === "manual")
    ) {
      return NextResponse.json(
        { error: "Manual override is disabled for camera-required task evidence." },
        { status: 400 },
      );
    }
    const result = await finalizeEvidenceAttempt({
      task,
      occurrenceId: occurrence.id,
      occurrenceIndex: occurrence.occurrence_index,
      status,
      evidenceType,
      summary:
        typeof payload.summary === "string" && payload.summary.trim().length > 0
          ? payload.summary.trim()
          : "Task evidence attempt recorded.",
      confidence:
        typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
          ? payload.confidence
          : 0,
      raw: asRecord(payload.raw),
    });

    return NextResponse.json({
      attempt: result.attempt,
      task: result.task,
      pointsAwarded: result.pointsAwarded,
      tierUp: result.tierUp,
      ...(await buildTasksState()),
      progress: result.progress,
    });
  }

  if (action === "submit_manual_evidence") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const occurrenceId = typeof payload.occurrenceId === "string" ? payload.occurrenceId.trim() : "";
    const resolved = await resolveActiveTaskAndOccurrence({ taskId, occurrenceId });
    if ("error" in resolved) {
      return NextResponse.json(
        resolved.state ? { error: resolved.error, ...resolved.state } : { error: resolved.error },
        { status: resolved.status },
      );
    }
    const { task, occurrence } = resolved;
    if (occurrence.review_state === "pending_review") {
      return NextResponse.json(
        { error: "This occurrence already has evidence awaiting review." },
        { status: 400 },
      );
    }
    if (task.evidence_policy.type === "camera" && task.evidence_policy.deny_user_override) {
      return NextResponse.json(
        { error: "Manual evidence is disabled for this camera-only task." },
        { status: 400 },
      );
    }
    const summary =
      typeof payload.summary === "string" && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : "Manual evidence submitted.";
    const confidence =
      typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
        ? payload.confidence
        : 0.55;
    const raw = {
      ...asRecord(payload.raw),
      review_source: "manual_submission",
    };

    if (
      shouldTaskRouteEvidenceToReview({
        task,
        evidenceType: "manual",
        status: "pass_manual",
      })
    ) {
      const submitted = await submitOccurrenceForReview({
        task,
        occurrenceId: occurrence.id,
        occurrenceIndex: occurrence.occurrence_index,
        evidenceType: "manual",
        summary,
        confidence,
        raw: {
          ...raw,
          submitted_status: "pass_manual",
        },
      });
      if ("error" in submitted) {
        return NextResponse.json({ error: submitted.error }, { status: 400 });
      }
      return NextResponse.json({
        attempt: submitted.attempt,
        task,
        reviewSubmitted: true,
        ...(await buildTasksState()),
      });
    }

    const result = await finalizeEvidenceAttempt({
      task,
      occurrenceId: occurrence.id,
      occurrenceIndex: occurrence.occurrence_index,
      status: "pass_manual",
      evidenceType: "manual",
      summary,
      confidence,
      raw,
    });
    return NextResponse.json({
      attempt: result.attempt,
      task: result.task,
      pointsAwarded: result.pointsAwarded,
      tierUp: result.tierUp,
      ...(await buildTasksState()),
      progress: result.progress,
    });
  }

  if (action === "submit_upload_evidence") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const occurrenceId = typeof payload.occurrenceId === "string" ? payload.occurrenceId.trim() : "";
    const resolved = await resolveActiveTaskAndOccurrence({ taskId, occurrenceId });
    if ("error" in resolved) {
      return NextResponse.json(
        resolved.state ? { error: resolved.error, ...resolved.state } : { error: resolved.error },
        { status: resolved.status },
      );
    }
    const { task, occurrence } = resolved;
    if (occurrence.review_state === "pending_review") {
      return NextResponse.json(
        { error: "This occurrence already has evidence awaiting review." },
        { status: 400 },
      );
    }
    if (task.evidence_policy.type === "camera" && task.evidence_policy.deny_user_override) {
      return NextResponse.json(
        { error: "Camera-only task evidence does not allow upload review." },
        { status: 400 },
      );
    }
    const imageDataUrl = normalizeImageDataUrl(payload.imageDataUrl);
    if (!imageDataUrl) {
      return NextResponse.json(
        { error: "imageDataUrl must be a valid local image data URL." },
        { status: 400 },
      );
    }
    const normalizedAnalysis = normalizeEvidenceAnalysisResult(payload.analysis);
    const baseSummary =
      typeof payload.summary === "string" && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : "Image evidence uploaded and awaiting review.";
    const analysisSummary = normalizedAnalysis
      ? ` Auto-analysis: ${normalizedAnalysis.summary} (${normalizedAnalysis.status}, ${Math.round(
          normalizedAnalysis.confidence * 100,
        )}%).`
      : "";
    const submitted = await submitOccurrenceForReview({
      task,
      occurrenceId: occurrence.id,
      occurrenceIndex: occurrence.occurrence_index,
      evidenceType: "file_upload",
      summary: `${baseSummary}${analysisSummary}`,
      confidence: 0,
      raw: {
        ...asRecord(payload.raw),
        image_data_url: imageDataUrl,
        ...(normalizedAnalysis ? { evidence_analysis: normalizedAnalysis } : {}),
      },
    });
    if ("error" in submitted) {
      return NextResponse.json({ error: submitted.error }, { status: 400 });
    }
    return NextResponse.json({
      attempt: submitted.attempt,
      task,
      reviewSubmitted: true,
      ...(await buildTasksState()),
    });
  }

  if (action === "set_evidence_baseline") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const occurrenceId = typeof payload.occurrenceId === "string" ? payload.occurrenceId.trim() : "";
    const resolved = await resolveActiveTaskAndOccurrence({ taskId, occurrenceId });
    if ("error" in resolved) {
      return NextResponse.json(
        resolved.state ? { error: resolved.error, ...resolved.state } : { error: resolved.error },
        { status: resolved.status },
      );
    }
    const { occurrence } = resolved;
    const imageDataUrl = normalizeImageDataUrl(payload.imageDataUrl);
    if (!imageDataUrl) {
      return NextResponse.json(
        { error: "imageDataUrl must be a valid local image data URL." },
        { status: 400 },
      );
    }
    await updateTaskOccurrenceInDb(occurrence.id, {
      metadata: {
        ...occurrence.metadata,
        evidence_baseline_image_data_url: imageDataUrl,
        evidence_baseline_set_at: new Date().toISOString(),
      },
    });
    return NextResponse.json({
      baselineSet: true,
      ...(await buildTasksState()),
    });
  }

  if (action === "clear_evidence_baseline") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const occurrenceId = typeof payload.occurrenceId === "string" ? payload.occurrenceId.trim() : "";
    const resolved = await resolveActiveTaskAndOccurrence({ taskId, occurrenceId });
    if ("error" in resolved) {
      return NextResponse.json(
        resolved.state ? { error: resolved.error, ...resolved.state } : { error: resolved.error },
        { status: resolved.status },
      );
    }
    const { occurrence } = resolved;
    const nextMetadata = { ...occurrence.metadata };
    delete nextMetadata.evidence_baseline_image_data_url;
    delete nextMetadata.evidence_baseline_set_at;
    delete nextMetadata.evidence_baseline_source_occurrence_id;
    await updateTaskOccurrenceInDb(occurrence.id, {
      metadata: nextMetadata,
    });
    return NextResponse.json({
      baselineCleared: true,
      ...(await buildTasksState()),
    });
  }

  if (action === "review_evidence") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const occurrenceId = typeof payload.occurrenceId === "string" ? payload.occurrenceId.trim() : "";
    const resolved = await resolveActiveTaskAndOccurrence({ taskId, occurrenceId });
    if ("error" in resolved) {
      return NextResponse.json(
        resolved.state ? { error: resolved.error, ...resolved.state } : { error: resolved.error },
        { status: resolved.status },
      );
    }
    const { task, occurrence } = resolved;
    const taskEvents = await listTaskEvidenceEventsFromDb({ taskId: task.id, limit: 1000 });
    const occurrenceEvents = taskEvents.filter((event) => event.occurrence_id === occurrence.id);
    const latestSubmission = [...occurrenceEvents].reverse().find(
      (event) =>
        (event.evidence_type === "file_upload" || event.evidence_type === "manual") &&
        event.status === "inconclusive" &&
        (event.raw?.review_source === "manual_submission" ||
          typeof event.raw?.image_data_url === "string"),
    );
    if (!latestSubmission) {
      return NextResponse.json(
        { error: "No submitted evidence is awaiting review for this occurrence." },
        { status: 400 },
      );
    }
    const decision =
      payload.status === "pass"
        ? "pass_manual"
        : payload.status === "fail"
          ? "fail"
          : null;
    if (!decision) {
      return NextResponse.json(
        { error: "review_evidence status must be pass or fail." },
        { status: 400 },
      );
    }
    const result = await finalizeEvidenceAttempt({
      task,
      occurrenceId: occurrence.id,
      occurrenceIndex: occurrence.occurrence_index,
      status: decision,
      evidenceType: "manual",
      summary:
        typeof payload.summary === "string" && payload.summary.trim().length > 0
          ? payload.summary.trim()
          : decision === "pass_manual"
            ? "Uploaded evidence approved."
            : "Uploaded evidence rejected.",
      confidence:
        typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
          ? payload.confidence
          : decision === "pass_manual"
            ? 0.8
            : 0.2,
      raw: {
        review_source:
          latestSubmission.evidence_type === "file_upload"
            ? "uploaded_image"
            : "manual_submission",
        reviewed_event_id: latestSubmission.id,
      },
    });
    let baselinePromoted = false;
    if (
      decision === "pass_manual" &&
      payload.useAsNextBaseline === true &&
      latestSubmission.evidence_type === "file_upload" &&
      typeof latestSubmission.raw?.image_data_url === "string"
    ) {
      const nextPendingOccurrence = await findNextPendingTaskOccurrenceInDb(task.id);
      if (nextPendingOccurrence) {
        await updateTaskOccurrenceInDb(nextPendingOccurrence.id, {
          metadata: {
            ...nextPendingOccurrence.metadata,
            evidence_baseline_image_data_url: String(latestSubmission.raw.image_data_url),
            evidence_baseline_set_at: new Date().toISOString(),
            evidence_baseline_source_occurrence_id: occurrence.id,
          },
        });
        baselinePromoted = true;
      }
    }
    return NextResponse.json({
      attempt: result.attempt,
      task: result.task,
      pointsAwarded: result.pointsAwarded,
      tierUp: result.tierUp,
      baselinePromoted,
      ...(await buildTasksState()),
      progress: result.progress,
    });
  }

  if (action === "record_game_result") {
    const winner =
      payload.winner === "user_win" || payload.winner === "raven_win"
        ? payload.winner
        : null;
    if (!winner) {
      return NextResponse.json({ error: "winner must be user_win or raven_win." }, { status: 400 });
    }
    const templateId = typeof payload.templateId === "string" ? payload.templateId.trim() : "";
    if (!templateId) {
      return NextResponse.json({ error: "templateId is required." }, { status: 400 });
    }
    const result = await applyDeterministicGameResult({
      winner,
      templateId,
      stakesApplied:
        typeof payload.stakesApplied === "string" ? payload.stakesApplied.trim() : "",
    });
    return NextResponse.json({
      pointsAwarded: result.pointsAwarded,
      tierUp: result.tierUp,
      ...(await buildTasksState()),
      progress: result.progress,
    });
  }

  if (action === "switch_evidence") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const task = await getTaskByIdFromDb(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    const nextType: "camera" | "manual" | "mixed" =
      payload.evidenceType === "camera" || payload.evidenceType === "mixed"
        ? payload.evidenceType
        : "manual";
    if (
      task.evidence_policy.type === "camera" &&
      nextType === "manual" &&
      payload.confirm !== true
    ) {
      return NextResponse.json(
        { error: "Confirm is required to switch camera-only evidence to manual." },
        { status: 400 },
      );
    }
    const updated =
      (await updateTaskInDb(taskId, {
        evidence_policy: {
          ...task.evidence_policy,
          type: nextType,
          deny_user_override: nextType === "camera",
        },
      })) ?? task;
    return NextResponse.json({ task: updated, ...(await buildTasksState()) });
  }

  if (action === "cancel") {
    const taskId = toTaskId(payload.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }
    const updated = await updateTaskInDb(taskId, { status: "cancelled" });
    if (!updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    return NextResponse.json({ task: updated, ...(await buildTasksState()) });
  }

  if (action === "delete_all") {
    await deleteAllTasksData();
    return NextResponse.json(await buildTasksState());
  }

  return NextResponse.json(
    {
      error:
        "Unsupported action. Use create, record_attempt, submit_manual_evidence, submit_upload_evidence, set_evidence_baseline, clear_evidence_baseline, review_evidence, record_game_result, approve_plan, set_preferences, switch_evidence, cancel, or delete_all.",
    },
    { status: 400 },
  );
}
