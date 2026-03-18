import { NextResponse } from "next/server";

import { getDeviceService } from "@/lib/devices/device-service";

export const runtime = "nodejs";

export async function POST() {
  const service = getDeviceService();
  const stopResult = await service.stopAll("manual");
  return NextResponse.json({
    ...stopResult,
    status: service.getStatus(),
  });
}
