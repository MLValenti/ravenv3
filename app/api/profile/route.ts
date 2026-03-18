import { NextResponse } from "next/server";

import { getProfileFromDb, upsertProfileInDb } from "@/lib/db";
import { normalizeProfileInput } from "@/lib/profile";

export async function GET() {
  const profile = await getProfileFromDb();
  return NextResponse.json({ profile });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const profile = normalizeProfileInput(payload);
  if (!Object.keys(profile).length) {
    return NextResponse.json(
      {
        error:
          "Provide at least one profile field: safeword, limits, intensity, preferred_style, preferred_pace, name, likes, dislikes, memory_summary.",
      },
      { status: 400 },
    );
  }

  await upsertProfileInDb(profile);
  const saved = await getProfileFromDb();
  return NextResponse.json({ profile: saved });
}
