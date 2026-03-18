"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  ProfileProgressRow,
  TaskOccurrenceRow,
  TaskPreferencesRow,
  TaskRow,
  TaskStrictnessMode,
} from "@/lib/db";
import { getTierRewards, type TaskCatalogItem, type TaskReviewQueueItem } from "@/lib/tasks/system";

type TasksApiResponse = {
  active?: TaskRow[];
  history?: TaskRow[];
  occurrences?: TaskOccurrenceRow[];
  review_queue?: TaskReviewQueueItem[];
  progress?: ProfileProgressRow;
  preferences?: TaskPreferencesRow;
  catalogs?: {
    rewards?: TaskCatalogItem[];
    consequences?: TaskCatalogItem[];
  };
  error?: string;
  validation?: {
    notes?: string[];
  };
  pointsAwarded?: number;
  tierUp?: boolean;
};

const DEFAULT_PROGRESS: ProfileProgressRow = {
  total_points: 0,
  current_tier: "bronze",
  free_pass_count: 0,
  streak_days: 0,
  last_task_completed_at: null,
  last_completion_summary: null,
  updated_at: "",
};

const DEFAULT_PREFERENCES: TaskPreferencesRow = {
  require_reward_consequence_approval: true,
};

function secondsUntil(dueAtIso: string): number {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((dueAtMs - Date.now()) / 1000));
}

function formatDurationSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function TasksClient() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [activeTasks, setActiveTasks] = useState<TaskRow[]>([]);
  const [historyTasks, setHistoryTasks] = useState<TaskRow[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrenceRow[]>([]);
  const [reviewQueue, setReviewQueue] = useState<TaskReviewQueueItem[]>([]);
  const [progress, setProgress] = useState<ProfileProgressRow>(DEFAULT_PROGRESS);
  const [preferences, setPreferences] = useState<TaskPreferencesRow>(DEFAULT_PREFERENCES);
  const [rewardCatalog, setRewardCatalog] = useState<TaskCatalogItem[]>([]);
  const [consequenceCatalog, setConsequenceCatalog] = useState<TaskCatalogItem[]>([]);
  const [validationNotes, setValidationNotes] = useState<string[]>([]);

  const [titleDraft, setTitleDraft] = useState("Focused task");
  const [descriptionDraft, setDescriptionDraft] = useState(
    "Complete the assigned repetitions and report clearly.",
  );
  const [windowMinutesDraft, setWindowMinutesDraft] = useState("120");
  const [repeatsDraft, setRepeatsDraft] = useState("1");
  const [pointsDraft, setPointsDraft] = useState("5");
  const [scheduleTypeDraft, setScheduleTypeDraft] = useState<"one_time" | "daily">("one_time");
  const [daysDraft, setDaysDraft] = useState("3");
  const [occurrencesPerDayDraft, setOccurrencesPerDayDraft] = useState("1");
  const [allowMakeUpDraft, setAllowMakeUpDraft] = useState(false);
  const [programKindDraft, setProgramKindDraft] = useState<"task" | "habit" | "rule" | "challenge">(
    "task",
  );
  const [strictnessDraft, setStrictnessDraft] = useState<TaskStrictnessMode>("standard");
  const [rewardDraft, setRewardDraft] = useState("reward_positive_message");
  const [consequenceDraft, setConsequenceDraft] = useState("penalty_points");

  const tierRewards = useMemo(() => getTierRewards(progress.current_tier), [progress.current_tier]);
  const pendingReviewCount = useMemo(
    () => reviewQueue.filter((item) => item.review_state === "submitted_for_review").length,
    [reviewQueue],
  );
  const awaitingSubmissionCount = useMemo(
    () => reviewQueue.filter((item) => item.review_state === "awaiting_submission").length,
    [reviewQueue],
  );
  const retryNeededCount = useMemo(
    () => reviewQueue.filter((item) => item.review_state === "needs_retry").length,
    [reviewQueue],
  );

  const applyPayload = useCallback((payload: TasksApiResponse) => {
    setActiveTasks(Array.isArray(payload.active) ? payload.active : []);
    setHistoryTasks(Array.isArray(payload.history) ? payload.history : []);
    setOccurrences(Array.isArray(payload.occurrences) ? payload.occurrences : []);
    setReviewQueue(Array.isArray(payload.review_queue) ? payload.review_queue : []);
    setProgress(payload.progress ?? DEFAULT_PROGRESS);
    setPreferences(payload.preferences ?? DEFAULT_PREFERENCES);
    setRewardCatalog(Array.isArray(payload.catalogs?.rewards) ? payload.catalogs.rewards : []);
    setConsequenceCatalog(
      Array.isArray(payload.catalogs?.consequences) ? payload.catalogs.consequences : [],
    );
    setValidationNotes(Array.isArray(payload.validation?.notes) ? payload.validation.notes : []);
  }, []);

  const refreshTasks = useCallback(async () => {
    const response = await fetch("/api/tasks", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as TasksApiResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load tasks.");
    }
    applyPayload(payload);
  }, [applyPayload]);

  useEffect(() => {
    void refreshTasks()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load tasks.");
      })
      .finally(() => setLoading(false));
  }, [refreshTasks]);

  async function runTaskAction(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as TasksApiResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Task action failed.");
      }
      applyPayload(body);
      return body;
    } finally {
      setBusy(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const windowMinutes = Number(windowMinutesDraft);
    const repeats = Number(repeatsDraft);
    const points = Number(pointsDraft);
    const days = Number(daysDraft);
    const occurrencesPerDay = Number(occurrencesPerDayDraft);
    const actionType =
      programKindDraft === "rule"
        ? "create_rule"
        : programKindDraft === "habit"
          ? "create_habit"
          : programKindDraft === "challenge"
            ? "create_challenge"
            : "create_task";
    try {
      const result = await runTaskAction({
        action: "create",
        createdBy: "user",
        task: {
          type: actionType,
          title: titleDraft.trim() || "Focused task",
          description: descriptionDraft.trim() || "Complete the assigned repetitions.",
          window_seconds: Number.isFinite(windowMinutes) ? Math.max(60, Math.floor(windowMinutes * 60)) : 7200,
          repeats_required: Number.isFinite(repeats) ? Math.max(1, Math.floor(repeats)) : 1,
          points_possible: Number.isFinite(points) ? Math.max(1, Math.floor(points)) : 5,
          schedule:
            scheduleTypeDraft === "daily"
              ? {
                  type: "daily",
                  days: Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 3,
                  occurrences_per_day: Number.isFinite(occurrencesPerDay)
                    ? Math.max(1, Math.floor(occurrencesPerDay))
                    : 1,
                  allow_make_up: allowMakeUpDraft,
                }
              : { type: "one_time" },
          evidence: {
            required: true,
            type: "manual",
            checks: [],
            max_attempts: 2,
            deny_user_override: false,
          },
          reward_plan: {
            catalog_id: rewardDraft,
            params: {},
          },
          consequence_plan: {
            catalog_id: consequenceDraft,
            params: {},
          },
          program_kind: programKindDraft,
          strictness_mode: strictnessDraft,
        },
      });
      if (validationNotes.length > 0) {
        setMessage(`Task created with validation notes: ${validationNotes.join(" | ")}`);
      } else if (result.tierUp) {
        setMessage("Task created. Tier changed.");
      } else {
        setMessage("Task created.");
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create task.");
    }
  }

  async function submitManualEvidence(taskId: string) {
    try {
      const result = await runTaskAction({
        action: "submit_manual_evidence",
        taskId,
        summary: "Manual progress report from tasks page.",
      });
      if (result.pointsAwarded && result.pointsAwarded > 0) {
        setMessage(`Progress recorded. +${result.pointsAwarded} points.`);
      } else {
        setMessage("Progress recorded.");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit evidence.");
    }
  }

  async function cancelTask(taskId: string) {
    try {
      await runTaskAction({ action: "cancel", taskId });
      setMessage("Task cancelled.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Failed to cancel task.");
    }
  }

  async function setApprovalMode(enabled: boolean) {
    try {
      await runTaskAction({
        action: "set_preferences",
        requireRewardConsequenceApproval: enabled,
      });
      setMessage(enabled ? "Approval required for plans." : "Plan approval disabled.");
    } catch (preferencesError) {
      setError(
        preferencesError instanceof Error
          ? preferencesError.message
          : "Failed to update task preferences.",
      );
    }
  }

  return (
    <section className="panel">
      <div className="card">
        <h1>Homework Tasks</h1>
        <p className="muted">
          Use this page for between-session tasks. Live interaction stays in the session page.
        </p>
        <div className="camera-controls">
          <Link className="button button-secondary" href="/session">
            Back to Session
          </Link>
          <Link className="button button-secondary" href="/review">
            Open Review Queue
          </Link>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy || loading}
            onClick={() => void refreshTasks()}
          >
            Refresh
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </div>

      <div className="status-strip">
        <div className="status-pill">
          <strong>{progress.total_points}</strong>
          <span>Points</span>
        </div>
        <div className="status-pill">
          <strong>{progress.current_tier}</strong>
          <span>Tier</span>
        </div>
        <div className="status-pill">
          <strong>{activeTasks.length}</strong>
          <span>Active</span>
        </div>
        <div className="status-pill">
          <strong>{pendingReviewCount}</strong>
          <span>Pending review</span>
        </div>
        <div className="status-pill">
          <strong>{awaitingSubmissionCount}</strong>
          <span>Awaiting proof</span>
        </div>
        <div className="status-pill">
          <strong>{retryNeededCount}</strong>
          <span>Retry needed</span>
        </div>
      </div>

      <div className="card">
        <h2>Create Task</h2>
        <form className="chat-form" onSubmit={createTask}>
          <label className="field-stack" htmlFor="task-program-kind">
            <span>Type</span>
            <select
              id="task-program-kind"
              value={programKindDraft}
              onChange={(event) => {
                const value = event.target.value;
                setProgramKindDraft(
                  value === "rule" || value === "habit" || value === "challenge" ? value : "task",
                );
              }}
            >
              <option value="task">Task</option>
              <option value="rule">Rule</option>
              <option value="habit">Habit</option>
              <option value="challenge">Challenge</option>
            </select>
          </label>
          <label className="field-stack" htmlFor="task-title">
            <span>Title</span>
            <input
              id="task-title"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
            />
          </label>
          <label className="field-stack" htmlFor="task-description">
            <span>Description</span>
            <input
              id="task-description"
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
            />
          </label>
          <div className="compact-grid form-grid-two">
            <label className="field-stack" htmlFor="task-window-minutes">
              <span>Window minutes</span>
              <input
                id="task-window-minutes"
                value={windowMinutesDraft}
                onChange={(event) => setWindowMinutesDraft(event.target.value)}
              />
            </label>
            <label className="field-stack" htmlFor="task-repeats">
              <span>Repeats</span>
              <input
                id="task-repeats"
                value={repeatsDraft}
                onChange={(event) => setRepeatsDraft(event.target.value)}
              />
            </label>
            <label className="field-stack" htmlFor="task-points">
              <span>Points</span>
              <input
                id="task-points"
                value={pointsDraft}
                onChange={(event) => setPointsDraft(event.target.value)}
              />
            </label>
            <label className="field-stack" htmlFor="task-strictness">
              <span>Strictness</span>
              <select
                id="task-strictness"
                value={strictnessDraft}
                onChange={(event) => {
                  const value = event.target.value;
                  setStrictnessDraft(value === "soft" || value === "hard" ? value : "standard");
                }}
              >
                <option value="standard">Standard</option>
                <option value="soft">Soft</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>
          <div className="compact-grid form-grid-two">
            <label className="field-stack" htmlFor="task-schedule">
              <span>Schedule</span>
              <select
                id="task-schedule"
                value={scheduleTypeDraft}
                onChange={(event) =>
                  setScheduleTypeDraft(event.target.value === "daily" ? "daily" : "one_time")
                }
              >
                <option value="one_time">One time</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <label className="field-stack" htmlFor="task-reward-plan">
              <span>Reward plan</span>
              <select
                id="task-reward-plan"
                value={rewardDraft}
                onChange={(event) => setRewardDraft(event.target.value)}
              >
                {rewardCatalog.length === 0 ? (
                  <option value="reward_positive_message">reward_positive_message</option>
                ) : (
                  rewardCatalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="field-stack" htmlFor="task-consequence-plan">
              <span>Consequence plan</span>
              <select
                id="task-consequence-plan"
                value={consequenceDraft}
                onChange={(event) => setConsequenceDraft(event.target.value)}
              >
                {consequenceCatalog.length === 0 ? (
                  <option value="penalty_points">penalty_points</option>
                ) : (
                  consequenceCatalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
          {scheduleTypeDraft === "daily" ? (
            <div className="compact-grid form-grid-two">
              <label className="field-stack" htmlFor="task-days">
                <span>Days</span>
                <input
                  id="task-days"
                  value={daysDraft}
                  onChange={(event) => setDaysDraft(event.target.value)}
                />
              </label>
              <label className="field-stack" htmlFor="task-occurrences-per-day">
                <span>Occurrences per day</span>
                <input
                  id="task-occurrences-per-day"
                  value={occurrencesPerDayDraft}
                  onChange={(event) => setOccurrencesPerDayDraft(event.target.value)}
                />
              </label>
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={allowMakeUpDraft}
                  onChange={(event) => setAllowMakeUpDraft(event.target.checked)}
                />
                <span>Allow make-up</span>
              </label>
            </div>
          ) : null}
          <button className="button" type="submit" disabled={busy}>
            Create task
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Task Policy</h2>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={preferences.require_reward_consequence_approval}
            onChange={(event) => void setApprovalMode(event.target.checked)}
          />
          <span>Require reward and consequence approval</span>
        </label>
        {validationNotes.length > 0 ? (
          <div className="debug-console">
            {validationNotes.map((note, index) => (
              <p key={`task-note-${index}`} className="debug-line">
                {note}
              </p>
            ))}
          </div>
        ) : (
          <p className="muted">No recent task normalization notes.</p>
        )}
      </div>

      <div className="card">
        <h2>Active Tasks</h2>
        {loading ? <p>Loading tasks...</p> : null}
        {activeTasks.length === 0 ? (
          <p className="muted">No active tasks.</p>
        ) : (
          <div className="compact-grid">
            {activeTasks.map((task) => {
              const pendingOccurrence = occurrences
                .filter((occurrence) => occurrence.task_id === task.id && occurrence.status === "pending")
                .sort((left, right) => left.occurrence_index - right.occurrence_index)[0];
              const isCameraLocked =
                task.evidence_policy.type === "camera" && task.evidence_policy.deny_user_override;
              return (
                <div key={task.id} className="task-card">
                  <p>
                    <strong>{task.title}</strong>
                  </p>
                  <p>{task.description}</p>
                  <p className="muted">
                    due in {formatDurationSeconds(secondsUntil(task.due_at))} | repeats{" "}
                    {task.repeats_completed}/{task.repeats_required}
                  </p>
                  <p className="muted">
                    evidence={task.evidence_policy.type} strictness={task.strictness_mode}
                  </p>
                  {pendingOccurrence ? (
                    <p className="muted">
                      next occurrence #{pendingOccurrence.occurrence_index} due{" "}
                      {new Date(pendingOccurrence.deadline_at).toLocaleString()}
                    </p>
                  ) : null}
                  <div className="camera-controls">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy || isCameraLocked}
                      onClick={() => void submitManualEvidence(task.id)}
                    >
                      Submit progress
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void cancelTask(task.id)}
                    >
                      Cancel
                    </button>
                  </div>
                  {isCameraLocked ? (
                    <p className="muted">
                      Camera verification is required for this task. Complete it in a live session.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Tier Rewards</h2>
        <div className="debug-console">
          {tierRewards.map((reward, index) => (
            <p key={`tier-reward-${index}`} className="debug-line">
              {reward}
            </p>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Recent History</h2>
        {historyTasks.length === 0 ? (
          <p className="muted">No completed or expired tasks yet.</p>
        ) : (
          <div className="compact-grid">
            {historyTasks.slice(0, 30).map((task) => (
              <div key={task.id} className="task-card">
                <p>
                  <strong>{task.title}</strong>
                </p>
                <p className="muted">
                  status={task.status} | repeats {task.repeats_completed}/{task.repeats_required}
                </p>
                <p className="muted">
                  points {task.points_awarded}/{task.points_possible}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
