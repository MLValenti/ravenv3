import { NextResponse } from "next/server.js";

import {
  EMERGENCY_STOP_COOKIE,
  getEmergencyStopSnapshot,
  setEmergencyStopped,
} from "../../../lib/emergency-stop.ts";
import { getDeviceService } from "../../../lib/devices/device-service.ts";

export const runtime = "nodejs";

export async function GET() {
  const emergencyStop = await getEmergencyStopSnapshot();
  return NextResponse.json(emergencyStop);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as { stopped?: unknown };
  const nextValue = payload.stopped === true;

  const reason = nextValue ? "manual_engaged" : "manual_released";
  await setEmergencyStopped(nextValue, reason);
  if (nextValue) {
    await getDeviceService().stopAll("emergency_stop");
  }

  const response = NextResponse.json(await getEmergencyStopSnapshot());
  response.cookies.set(EMERGENCY_STOP_COOKIE, String(nextValue), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
