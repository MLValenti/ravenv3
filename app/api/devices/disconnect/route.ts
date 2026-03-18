import { NextResponse } from "next/server";

import { getDeviceService } from "@/lib/devices/device-service";

export const runtime = "nodejs";

export async function POST() {
  const service = getDeviceService();
  const status = await service.disconnect();
  return NextResponse.json(status);
}
