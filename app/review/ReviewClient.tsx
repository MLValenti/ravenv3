"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TaskOccurrenceRow, TaskRow } from "@/lib/db";
import { partitionTaskReviewQueue, type TaskReviewQueueItem } from "@/lib/tasks/system";
import type { EvidenceSignalResult } from "@/lib/vision/evidence-provider";

type TasksApiResponse = {
  active?: TaskRow[];
  history?: TaskRow[];
  occurrences?: TaskOccurrenceRow[];
  review_queue?: TaskReviewQueueItem[];
  error?: string;
};

function formatAnalysisSignals(signals: EvidenceSignalResult[] | undefined): string {
  if (!Array.isArray(signals) || signals.length === 0) {
    return "none";
  }
  return signals
    .slice(0, 5)
    .map((signal) => `${signal.id}:${signal.score.toFixed(2)}:${signal.state}`)
    .join(", ");
}

export default function ReviewClient() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [activeTasks, setActiveTasks] = useState<TaskRow[]>([]);
  const [historyTasks, setHistoryTasks] = useState<TaskRow[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrenceRow[]>([]);
  const [reviewQueue, setReviewQueue] = useState<TaskReviewQueueItem[]>([]);

  const [decisionSummaryDrafts, setDecisionSummaryDrafts] = useState<Record<string, string>>({});

  const reviewBuckets = useMemo(() => partitionTaskReviewQueue(reviewQueue), [reviewQueue]);

  const applyPayload = useCallback((payload: TasksApiResponse) => {
    setActiveTasks(Array.isArray(payload.active) ? payload.active : []);
    setHistoryTasks(Array.isArray(payload.history) ? payload.history : []);
    setOccurrences(Array.isArray(payload.occurrences) ? payload.occurrences : []);
    setReviewQueue(Array.isArray(payload.review_queue) ? payload.review_queue : []);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/tasks", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as TasksApiResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load review queue.");
    }
    applyPayload(payload);
  }, [applyPayload]);

  useEffect(() => {
    void refresh()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load review queue.");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  async function reviewEvidence(item: TaskReviewQueueItem, status: "pass" | "fail") {
    setBusy(true);
    setError(null);
    try {
      const summaryKey = `${item.task_id}:${item.occurrence_id}`;
      const summaryDraft = decisionSummaryDrafts[summaryKey]?.trim();
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review_evidence",
          taskId: item.task_id,
          occurrenceId: item.occurrence_id,
          status,
          summary:
            summaryDraft ||
            (status === "pass" ? "Evidence approved from review queue." : "Evidence rejected from review queue."),
          useAsNextBaseline: false,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as TasksApiResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to record review decision.");
      }
      applyPayload(body);
      setMessage(status === "pass" ? "Evidence approved." : "Evidence rejected.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to review evidence.");
    } finally {
      setBusy(false);
    }
  }

  function updateSummaryDraft(key: string, value: string) {
    setDecisionSummaryDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <section className="panel">
      <div className="card">
        <h1>Evidence Review</h1>
        <p className="muted">
          Review submitted evidence for homework tasks. Approvals and rejections update task state
          and points automatically.
        </p>
        <div className="camera-controls">
          <Link className="button button-secondary" href="/tasks">
            Back to Tasks
          </Link>
          <Link className="button button-secondary" href="/session">
            Back to Session
          </Link>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </div>

      <div className="status-strip">
        <div className="status-pill">
          <strong>{reviewBuckets.pendingReview.length}</strong>
          <span>Pending review</span>
        </div>
        <div className="status-pill">
          <strong>{reviewBuckets.needsRetry.length}</strong>
          <span>Needs retry</span>
        </div>
        <div className="status-pill">
          <strong>{reviewBuckets.awaitingSubmission.length}</strong>
          <span>Awaiting submission</span>
        </div>
      </div>

      <div className="card">
        <h2>Pending Review</h2>
        {loading ? <p>Loading review queue...</p> : null}
        {reviewBuckets.pendingReview.length === 0 ? (
          <p className="muted">No evidence is waiting for review.</p>
        ) : (
          <div className="compact-grid">
            {reviewBuckets.pendingReview.map((item) => {
              const key = `${item.task_id}:${item.occurrence_id}`;
              const task =
                activeTasks.find((taskRow) => taskRow.id === item.task_id) ??
                historyTasks.find((taskRow) => taskRow.id === item.task_id);
              return (
                <div key={key} className="task-card">
                  <p>
                    <strong>{task?.title ?? item.title}</strong>
                  </p>
                  <p className="muted">
                    occurrence={item.occurrence_id} | evidence={item.evidence_type} | attempts{" "}
                    {item.attempts_used}/{item.max_attempts}
                  </p>
                  <p className="muted">
                    due {new Date(item.deadline_at).toLocaleString()} | mode={item.analysis_mode ?? "none"}
                  </p>
                  <p className="muted">
                    analysis={item.analysis_status ?? "none"} confidence=
                    {typeof item.analysis_confidence === "number"
                      ? item.analysis_confidence.toFixed(2)
                      : "n/a"}
                  </p>
                  <p className="muted">signals: {formatAnalysisSignals(item.analysis_signals)}</p>
                  {item.last_summary ? <p>{item.last_summary}</p> : null}
                  {item.preview_image_data_url ? (
                    <p>
                      <a href={item.preview_image_data_url} target="_blank" rel="noreferrer">
                        Open image preview
                      </a>
                    </p>
                  ) : null}
                  <label className="field-stack">
                    <span>Review summary</span>
                    <input
                      value={decisionSummaryDrafts[key] ?? ""}
                      onChange={(event) => updateSummaryDraft(key, event.target.value)}
                      placeholder="Add a short reason for approve or reject"
                    />
                  </label>
                  <div className="camera-controls">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void reviewEvidence(item, "pass")}
                    >
                      Approve
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void reviewEvidence(item, "fail")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Occurrence Snapshot</h2>
        {occurrences.length === 0 ? (
          <p className="muted">No occurrences yet.</p>
        ) : (
          <div className="compact-grid">
            {occurrences.slice(0, 20).map((occurrence) => {
              const task =
                activeTasks.find((taskRow) => taskRow.id === occurrence.task_id) ??
                historyTasks.find((taskRow) => taskRow.id === occurrence.task_id);
              return (
                <div key={occurrence.id} className="task-card">
                  <p>
                    <strong>{task?.title ?? occurrence.task_id}</strong>
                  </p>
                  <p className="muted">
                    occ#{occurrence.occurrence_index} status={occurrence.status} review={occurrence.review_state}
                  </p>
                  <p className="muted">due {new Date(occurrence.deadline_at).toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
