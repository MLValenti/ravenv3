import { NextResponse } from "next/server.js";

import {
  loadCustomPersonaPackPreview,
  loadCustomPersonaSpec,
  saveCustomPersonaSpec,
} from "../../../../lib/persona/custom-persona.server.ts";

export const runtime = "nodejs";

export async function GET() {
  const spec = loadCustomPersonaSpec();
  const pack = loadCustomPersonaPackPreview();
  return NextResponse.json({ spec, pack });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const spec = saveCustomPersonaSpec(payload);
  const pack = loadCustomPersonaPackPreview();
  return NextResponse.json({ spec, pack });
}
