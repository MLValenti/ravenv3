import { NextResponse } from "next/server";

import {
  deleteCustomItemInDb,
  listCustomItemsWithRefsFromDb,
} from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const itemId = id.trim();
  if (!itemId) {
    return NextResponse.json({ error: "Custom item id is required." }, { status: 400 });
  }

  const deleted = await deleteCustomItemInDb(itemId);
  if (!deleted) {
    return NextResponse.json({ error: "Custom item not found." }, { status: 404 });
  }
  const items = await listCustomItemsWithRefsFromDb();
  return NextResponse.json({ items });
}
