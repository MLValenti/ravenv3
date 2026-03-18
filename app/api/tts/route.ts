import { NextResponse } from "next/server.js";

import { getEmergencyStopSnapshot } from "../../../lib/emergency-stop.ts";
import { validateAndNormalizeLocalHttpBaseUrl } from "../../../lib/local-url.ts";
import { DEFAULT_SETTINGS } from "../../../lib/settings.ts";

type TtsRequestBody = {
  text?: unknown;
  piperUrl?: unknown;
  modelPath?: unknown;
};

const TTS_BLOCKED_ERROR = "Emergency stop is engaged. /api/tts is blocked while stopped.";

export async function POST(request: Request) {
  const emergencyStop = await getEmergencyStopSnapshot();
  if (emergencyStop.stopped) {
    return NextResponse.json({ error: TTS_BLOCKED_ERROR }, { status: 403 });
  }

  let payload: TtsRequestBody;
  try {
    payload = (await request.json()) as TtsRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }

  const rawPiperUrl =
    typeof payload.piperUrl === "string" && payload.piperUrl.trim().length > 0
      ? payload.piperUrl.trim()
      : DEFAULT_SETTINGS.piperUrl;
  const validatedPiperUrl = validateAndNormalizeLocalHttpBaseUrl(rawPiperUrl);
  if (!validatedPiperUrl.ok) {
    return NextResponse.json({ error: validatedPiperUrl.error }, { status: 400 });
  }

  const modelPath =
    typeof payload.modelPath === "string" && payload.modelPath.trim().length > 0
      ? payload.modelPath.trim()
      : DEFAULT_SETTINGS.piperVoiceModelPath;

  let upstream: Response;
  try {
    upstream = await fetch(`${validatedPiperUrl.normalizedBaseUrl}/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        modelPath,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Piper server. Verify Piper is running on localhost." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const details = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "Piper server returned an error.", details: details.slice(0, 500) },
      { status: 502 },
    );
  }

  const audioBytes = await upstream.arrayBuffer();
  return new Response(audioBytes, {
    status: 200,
    headers: {
      "content-type": "audio/wav",
      "cache-control": "no-store",
    },
  });
}
