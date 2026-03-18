import { NextResponse } from "next/server";

import { getDeviceService } from "@/lib/devices/device-service";

export const runtime = "nodejs";

export async function GET() {
  const service = getDeviceService();
  service.listDevices();
  return NextResponse.json(service.getStatus());
}
