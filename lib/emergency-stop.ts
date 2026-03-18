import { getRuntimeStateFromDb, upsertRuntimeStateInDb } from "./db.ts";

export const EMERGENCY_STOP_COOKIE = "raven_stopped";
export const ACTION_ROUTE_PREFIXES = ["/api/actions", "/api/action", "/api/control"];

type EmergencyStopSnapshot = {
  stopped: boolean;
  reason: string | null;
  updatedAt: string;
};

let emergencyStopped = false;

function updateEmergencyStopCache(nextValue: boolean) {
  emergencyStopped = nextValue;
}

export function isEmergencyStopped(): boolean {
  return emergencyStopped;
}

export async function getEmergencyStopSnapshot(): Promise<EmergencyStopSnapshot> {
  const runtimeState = await getRuntimeStateFromDb();
  updateEmergencyStopCache(runtimeState.emergency_stop);
  return {
    stopped: runtimeState.emergency_stop,
    reason: runtimeState.emergency_stop_reason,
    updatedAt: runtimeState.emergency_stop_updated_at,
  };
}

export async function setEmergencyStopped(
  nextValue: boolean,
  reason: string | null = null,
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  updateEmergencyStopCache(nextValue);
  const runtimeState = await upsertRuntimeStateInDb({
    emergency_stop: nextValue,
    emergency_stop_reason: reason,
    emergency_stop_updated_at: updatedAt,
  });
  updateEmergencyStopCache(runtimeState.emergency_stop);
  return runtimeState.emergency_stop;
}
