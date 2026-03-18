import { NextResponse } from "next/server.js";

import { getPromptDebugEntry } from "@/lib/chat/prompt-debug";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId")?.trim() || "default-session";
  const debug = getPromptDebugEntry(sessionId);
  return NextResponse.json({ debug });
}
