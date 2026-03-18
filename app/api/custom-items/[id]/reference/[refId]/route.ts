import { NextResponse } from "next/server";

import {
  deleteCustomItemRefInDb,
  listCustomItemsWithRefsFromDb,
} from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; refId: string }> },
) {
  const { id, refId } = await context.params;
  const itemId = id.trim();
  const referenceId = refId.trim();
  if (!itemId || !referenceId) {
    return NextResponse.json(
      { error: "Custom item id and reference id are required." },
      { status: 400 },
    );
  }

  const deleted = await deleteCustomItemRefInDb(itemId, referenceId);
  if (!deleted) {
    return NextResponse.json({ error: "Custom item reference not found." }, { status: 404 });
  }
  const items = await listCustomItemsWithRefsFromDb();
  return NextResponse.json({ items });
}
