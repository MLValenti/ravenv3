import { getEmergencyStopSnapshot } from "./emergency-stop.ts";

export const CHAT_ROUTE_BLOCKED_ERROR = "Emergency stop is engaged. /api/chat is blocked while stopped.";

export async function shouldBlockChatRoute(
  emergencyStopOverride?: boolean,
): Promise<boolean> {
  if (typeof emergencyStopOverride === "boolean") {
    return emergencyStopOverride;
  }
  return (await getEmergencyStopSnapshot()).stopped;
}
