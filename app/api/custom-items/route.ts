import { NextResponse } from "next/server";

import {
  createCustomItemInDb,
  listCustomItemsWithRefsFromDb,
} from "@/lib/db";

export const runtime = "nodejs";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const items = await listCustomItemsWithRefsFromDb();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const label = asString((payload as { label?: unknown })?.label);
  if (!label) {
    return NextResponse.json({ error: "Custom item label is required." }, { status: 400 });
  }

  try {
    await createCustomItemInDb(label);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create custom item.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const items = await listCustomItemsWithRefsFromDb();
  return NextResponse.json({ items });
}
