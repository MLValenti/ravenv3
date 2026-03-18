import { NextResponse } from "next/server.js";

import { getEmergencyStopSnapshot } from "./emergency-stop.ts";

export async function blockIfEmergencyStopped() {
  const emergencyStop = await getEmergencyStopSnapshot();
  if (!emergencyStop.stopped) {
    return null;
  }

  return NextResponse.json(
    { error: "Emergency stop is engaged. Action routes are blocked." },
    { status: 423 },
  );
}
