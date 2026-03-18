import type { DeterministicTaskProgress } from "./task-script";

export type DeterministicTaskTimerSnapshot = {
  totalDueAtMs: number;
  halfwayDueAtMs: number;
  totalRemainingSeconds: number;
  halfwayRemainingSeconds: number;
  phaseLabel:
    | "halfway_due"
    | "halfway_overdue"
    | "completion_due"
    | "completion_due_now"
    | "complete";
};

export function getDeterministicTaskTimerSnapshot(
  startedAtMs: number | null,
  nowMs: number,
  durationMinutes: number,
  progress: DeterministicTaskProgress,
): DeterministicTaskTimerSnapshot | null {
  if (
    startedAtMs === null ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(nowMs) ||
    durationMinutes <= 0 ||
    progress === "none" ||
    progress === "assigned"
  ) {
    return null;
  }

  const durationMs = Math.max(0, Math.floor(durationMinutes * 60 * 1000));
  const halfwayDueAtMs = startedAtMs + Math.floor(durationMs / 2);
  const totalDueAtMs = startedAtMs + durationMs;
  const halfwayRemainingSeconds = Math.max(
    0,
    Math.floor((halfwayDueAtMs - nowMs) / 1000),
  );
  const totalRemainingSeconds = Math.max(0, Math.floor((totalDueAtMs - nowMs) / 1000));

  let phaseLabel: DeterministicTaskTimerSnapshot["phaseLabel"] = "completion_due";
  if (progress === "secured") {
    phaseLabel = halfwayRemainingSeconds > 0 ? "halfway_due" : "halfway_overdue";
  } else if (progress === "halfway_checked") {
    phaseLabel = totalRemainingSeconds > 0 ? "completion_due" : "completion_due_now";
  } else if (progress === "completed") {
    phaseLabel = "complete";
  }

  return {
    totalDueAtMs,
    halfwayDueAtMs,
    totalRemainingSeconds,
    halfwayRemainingSeconds,
    phaseLabel,
  };
}
