import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicTaskAttemptSpec,
  buildTaskBoardSummary,
  classifyTaskUserCommand,
  findNextPendingOccurrence,
} from "../lib/session/task-bridge.ts";
import type { TaskOccurrenceRow, TaskRow } from "../lib/db.ts";
import type { TaskReviewQueueBuckets } from "../lib/tasks/system.ts";

function makeTask(id: string): TaskRow {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    created_at: "",
    updated_at: "",
    due_at: new Date(Date.now() + 60_000).toISOString(),
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
    program_kind: "task",
    strictness_mode: "standard",
    session_id: null,
    turn_id: null,
    created_by: "raven",
  };
}

function makeOccurrence(taskId: string): TaskOccurrenceRow {
  return {
    id: `occ-${taskId}`,
    task_id: taskId,
    occurrence_index: 1,
    scheduled_date: "2026-03-04",
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
    status: "pending",
    review_state: "not_required",
    reviewed_at: null,
    completed_at: null,
    metadata: {},
    created_at: "",
    updated_at: "",
  };
}

test("task bridge builds session board summary", () => {
  const tasks = [makeTask("a"), makeTask("b")];
  const occurrences = [makeOccurrence("a")];
  const reviewBuckets: TaskReviewQueueBuckets = {
    awaitingSubmission: [
      {
        task_id: "a",
        occurrence_id: "occ-a",
        title: "Task a",
        program_kind: "task",
        strictness_mode: "standard",
        scheduled_date: "2026-03-04",
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
        evidence_type: "manual",
        attempts_used: 0,
        max_attempts: 2,
        review_state: "awaiting_submission",
        last_status: null,
        last_summary: null,
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
    ],
    pendingReview: [],
    needsRetry: [],
  };
  const summary = buildTaskBoardSummary({
    taskActive: tasks,
    taskOccurrences: occurrences,
    taskReviewBuckets: reviewBuckets,
    taskTodayRows: [{ task_id: "a", pending: 1, completed: 2, missed: 0 }],
  });

  assert.equal(summary.active, 2);
  assert.equal(summary.dueNow, 1);
  assert.equal(summary.awaitingSubmission, 1);
  assert.equal(summary.pendingReview, 0);
  assert.equal(summary.retryNeeded, 0);
  assert.equal(summary.completedToday, 2);
});

test("task bridge classifies user commands deterministically", () => {
  assert.equal(classifyTaskUserCommand("show tasks"), "show_tasks");
  assert.equal(classifyTaskUserCommand("switch task evidence manual"), "switch_task_evidence_manual");
  assert.equal(classifyTaskUserCommand("done"), "done_like");
  assert.equal(classifyTaskUserCommand("confirm manual evidence"), "done_like");
  assert.equal(classifyTaskUserCommand("hello there"), "none");
});

test("task bridge selects next pending occurrence by occurrence index", () => {
  const rows: TaskOccurrenceRow[] = [
    {
      ...makeOccurrence("a"),
      id: "occ-2",
      occurrence_index: 2,
    },
    {
      ...makeOccurrence("a"),
      id: "occ-1",
      occurrence_index: 1,
    },
    {
      ...makeOccurrence("a"),
      id: "occ-done",
      occurrence_index: 0,
      status: "completed",
    },
  ];
  const next = findNextPendingOccurrence("a", rows);
  assert.equal(next?.id, "occ-1");
});

test("task bridge builds deterministic attempt payloads for task execution stages", () => {
  const secured = buildDeterministicTaskAttemptSpec("secured");
  assert.equal(secured?.status, "inconclusive");
  assert.equal(secured?.rawProgress, "secured");

  const halfway = buildDeterministicTaskAttemptSpec("halfway_checked");
  assert.equal(halfway?.status, "inconclusive");
  assert.equal(halfway?.rawProgress, "halfway_checked");

  const completed = buildDeterministicTaskAttemptSpec("completed");
  assert.equal(completed?.status, "pass_manual");
  assert.equal(completed?.rawProgress, "completed");

  assert.equal(buildDeterministicTaskAttemptSpec("assigned"), null);
});
