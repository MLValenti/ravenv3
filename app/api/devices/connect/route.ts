import { NextResponse } from "next/server";

import { getDeviceService } from "@/lib/devices/device-service";
import { validateAndNormalizeLocalWsBaseUrl } from "@/lib/local-url";
import { DEFAULT_SETTINGS } from "@/lib/settings";

type ConnectRequestBody = {
  url?: unknown;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: ConnectRequestBody;
  try {
    payload = (await request.json()) as ConnectRequestBody;
  } catch {
    payload = {};
  }

  const rawUrl =
    typeof payload.url === "string" && payload.url.trim().length > 0
      ? payload.url.trim()
      : DEFAULT_SETTINGS.intifaceWsUrl;

  const validated = validateAndNormalizeLocalWsBaseUrl(rawUrl);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const service = getDeviceService();
  const status = await service.connect(validated.normalizedBaseUrl);
  const devices = service.listDevices();
  if (!status.connected) {
    return NextResponse.json(
      {
        ...status,
        devices,
        error: status.last_error ?? "Failed to connect to Intiface.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ...status, devices });
}
