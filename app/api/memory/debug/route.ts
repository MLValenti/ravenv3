import { NextResponse } from "next/server";

import { getMemoryDebugEntry } from "@/lib/memory/debug";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = (searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }
  const entry = getMemoryDebugEntry(sessionId);
  return NextResponse.json({ debug: entry });
}
