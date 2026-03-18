import { NextResponse } from "next/server.js";

import { blockIfEmergencyStopped } from "../../../../lib/action-route-guard.ts";

export async function POST() {
  const blockedResponse = await blockIfEmergencyStopped();
  if (blockedResponse) {
    return blockedResponse;
  }

  return NextResponse.json({ ok: true, message: "Action accepted." });
}
