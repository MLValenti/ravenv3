import type { TaskOccurrenceRow, TaskRow } from "@/lib/db";
import type { TaskReviewQueueBuckets } from "@/lib/tasks/system";
import type { DeterministicTaskProgress } from "./task-script.ts";

export type TaskTodayRow = {
  task_id: string;
  pending: number;
  completed: number;
  missed: number;
};

export type TaskBoardSummary = {
  active: number;
  dueNow: number;
  awaitingSubmission: number;
  pendingReview: number;
  retryNeeded: number;
  completedToday: number;
};

export type TaskUserCommand = "show_tasks" | "switch_task_evidence_manual" | "done_like" | "none";

export type DeterministicTaskAttemptSpec = {
  status: "inconclusive" | "pass_manual";
  evidenceType: "manual";
  summary: string;
  confidence: number;
  rawProgress: "secured" | "halfway_checked" | "completed";
  successMessage: string;
};

export function buildTaskBoardSummary(input: {
  taskActive: TaskRow[];
  taskOccurrences: TaskOccurrenceRow[];
  taskReviewBuckets: TaskReviewQueueBuckets;
  taskTodayRows: TaskTodayRow[];
}): TaskBoardSummary {
  const tasksWithPendingOccurrence = new Set(
    input.taskOccurrences
      .filter((occurrence) => occurrence.status === "pending")
      .map((occurrence) => occurrence.task_id),
  );
  const completedToday = input.taskTodayRows.reduce((sum, row) => sum + row.completed, 0);
  return {
    active: input.taskActive.length,
    dueNow: input.taskActive.filter((task) => tasksWithPendingOccurrence.has(task.id)).length,
    awaitingSubmission: input.taskReviewBuckets.awaitingSubmission.length,
    pendingReview: input.taskReviewBuckets.pendingReview.length,
    retryNeeded: input.taskReviewBuckets.needsRetry.length,
    completedToday,
  };
}

export function classifyTaskUserCommand(text: string): TaskUserCommand {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return "none";
  }
  if (normalized === "show tasks" || normalized === "show task") {
    return "show_tasks";
  }
  if (/^switch task evidence manual$/i.test(normalized)) {
    return "switch_task_evidence_manual";
  }
  if (/\b(done|complete|completed|finished|i did it|confirm manual evidence)\b/i.test(normalized)) {
    return "done_like";
  }
  return "none";
}

export function findNextPendingOccurrence(
  taskId: string,
  taskOccurrences: TaskOccurrenceRow[],
): TaskOccurrenceRow | null {
  const rows = taskOccurrences
    .filter((occurrence) => occurrence.task_id === taskId && occurrence.status === "pending")
    .sort((left, right) => left.occurrence_index - right.occurrence_index);
  return rows[0] ?? null;
}

export function buildDeterministicTaskAttemptSpec(
  progress: DeterministicTaskProgress,
): DeterministicTaskAttemptSpec | null {
  if (progress === "secured") {
    return {
      status: "inconclusive",
      evidenceType: "manual",
      summary: "Task secured. Awaiting halfway check in.",
      confidence: 0.4,
      rawProgress: "secured",
      successMessage: "Task secured. Timer started.",
    };
  }
  if (progress === "halfway_checked") {
    return {
      status: "inconclusive",
      evidenceType: "manual",
      summary: "Halfway check in accepted. Awaiting full completion.",
      confidence: 0.5,
      rawProgress: "halfway_checked",
      successMessage: "Halfway check in logged.",
    };
  }
  if (progress === "completed") {
    return {
      status: "pass_manual",
      evidenceType: "manual",
      summary: "Deterministic task completed and confirmed.",
      confidence: 0.75,
      rawProgress: "completed",
      successMessage: "Task completion logged.",
    };
  }
  return null;
}
