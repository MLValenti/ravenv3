import { NextResponse } from "next/server.js";

import { blockIfEmergencyStopped } from "../../../../lib/action-route-guard.ts";
import { parseDeviceCommandRequest } from "../../../../lib/devices/action-schema.ts";
import { getDeviceService } from "../../../../lib/devices/device-service.ts";

export const runtime = "nodejs";

function statusFromError(message: string): number {
  if (/rate limit/i.test(message)) {
    return 429;
  }
  if (/not connected/i.test(message)) {
    return 409;
  }
  if (/opt-in/i.test(message)) {
    return 403;
  }
  return 400;
}

export async function POST(request: Request) {
  const blockedResponse = await blockIfEmergencyStopped();
  if (blockedResponse) {
    return blockedResponse;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseDeviceCommandRequest(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const service = getDeviceService();
  const result = await service.executeCommand(parsed.request);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, status: service.getStatus() },
      { status: statusFromError(result.error) },
    );
  }

  return NextResponse.json(result);
}
