import { NextResponse } from "next/server";

import {
  createCustomItemRefInDb,
  listCustomItemsWithRefsFromDb,
} from "@/lib/db";

export const runtime = "nodejs";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed: number[] = [];
  for (const item of value) {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    parsed.push(Number(numeric.toFixed(6)));
    if (parsed.length >= 2048) {
      break;
    }
  }
  return parsed;
}

function isDataImageUrl(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const itemId = id.trim();
  if (!itemId) {
    return NextResponse.json({ error: "Custom item id is required." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const imageDataUrl = asString((payload as { imageDataUrl?: unknown })?.imageDataUrl);
  if (!isDataImageUrl(imageDataUrl)) {
    return NextResponse.json(
      { error: "imageDataUrl must be a base64 image data URL." },
      { status: 400 },
    );
  }
  const embedding = parseEmbedding((payload as { embedding?: unknown })?.embedding);
  if (embedding.length === 0) {
    return NextResponse.json(
      { error: "embedding is required and must contain numeric values." },
      { status: 400 },
    );
  }

  const created = await createCustomItemRefInDb({
    itemId,
    imageDataUrl,
    embedding,
  });
  if (!created) {
    return NextResponse.json(
      { error: "Unable to create reference for custom item." },
      { status: 404 },
    );
  }

  const items = await listCustomItemsWithRefsFromDb();
  return NextResponse.json({ items });
}
