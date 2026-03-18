import { NextResponse } from "next/server";

import {
  approveMemorySuggestion,
  createLongTermMemory,
  deleteAllMemoryData,
  deleteLongTermMemory,
  getMemoryPreferencesFromDb,
  rejectMemorySuggestion,
  forgetLongTermMemories,
  listLongTermMemories,
  listMemorySuggestions,
  type MemoryType,
  upsertMemoryPreferencesInDb,
  updateLongTermMemory,
} from "@/lib/db";

type MemoryActionRequest = {
  action?: unknown;
  id?: unknown;
  key?: unknown;
  value?: unknown;
  type?: unknown;
  tags?: unknown;
  importance?: unknown;
  stability?: unknown;
  confidence?: unknown;
  is_active?: unknown;
  is_pinned?: unknown;
  query?: unknown;
  auto_save?: unknown;
  auto_save_goals?: unknown;
  auto_save_constraints?: unknown;
  auto_save_preferences?: unknown;
  suggestion_snooze_until?: unknown;
  user_feedback?: unknown;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 24);
}

function parseConfidence(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function parseType(value: unknown): MemoryType | undefined {
  if (
    value === "preference" ||
    value === "goal" ||
    value === "constraint" ||
    value === "setup" ||
    value === "habit" ||
    value === "misc"
  ) {
    return value;
  }
  return undefined;
}

async function loadMemoryPayload() {
  const [memories, suggestions, preferences] = await Promise.all([
    listLongTermMemories(300, { includeInactive: true }),
    listMemorySuggestions("pending"),
    getMemoryPreferencesFromDb(),
  ]);
  return { memories, suggestions, preferences };
}

export async function GET() {
  return NextResponse.json(await loadMemoryPayload());
}

export async function POST(request: Request) {
  let payload: MemoryActionRequest;
  try {
    payload = (await request.json()) as MemoryActionRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = typeof payload.action === "string" ? payload.action.trim() : "";

  if (action === "create") {
    const key = typeof payload.key === "string" ? payload.key.trim() : "";
    const value = typeof payload.value === "string" ? payload.value.trim() : "";
    if (!key || !value) {
      return NextResponse.json({ error: "Both key and value are required." }, { status: 400 });
    }
    await createLongTermMemory({
      key,
      value,
      tags: normalizeStringArray(payload.tags),
      type: parseType(payload.type),
      importance: parseConfidence(payload.importance),
      stability: parseConfidence(payload.stability),
      confidence: parseConfidence(payload.confidence),
      isActive: typeof payload.is_active === "boolean" ? payload.is_active : true,
      isPinned: payload.is_pinned === true,
      sourceSessionId: "manual",
      sourceTurnId: null,
    });
    return NextResponse.json(await loadMemoryPayload());
  }

  if (action === "update") {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Memory id is required." }, { status: 400 });
    }
    const updated = await updateLongTermMemory(id, {
      key: typeof payload.key === "string" ? payload.key : undefined,
      value: typeof payload.value === "string" ? payload.value : undefined,
      type: parseType(payload.type),
      tags: Array.isArray(payload.tags) ? normalizeStringArray(payload.tags) : undefined,
      importance: parseConfidence(payload.importance),
      stability: parseConfidence(payload.stability),
      confidence: parseConfidence(payload.confidence),
      is_active: typeof payload.is_active === "boolean" ? payload.is_active : undefined,
      is_pinned: typeof payload.is_pinned === "boolean" ? payload.is_pinned : undefined,
    });
    if (!updated) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }
    return NextResponse.json(await loadMemoryPayload());
  }

  if (action === "delete") {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Memory id is required." }, { status: 400 });
    }
    const deleted = await deleteLongTermMemory(id);
    if (!deleted) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }
    return NextResponse.json(await loadMemoryPayload());
  }

  if (action === "forget") {
    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    if (!query) {
      return NextResponse.json({ error: "Forget query is required." }, { status: 400 });
    }
    const deleted = await forgetLongTermMemories(query);
    return NextResponse.json({ deleted, ...(await loadMemoryPayload()) });
  }

  if (action === "approve_suggestion") {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Suggestion id is required." }, { status: 400 });
    }
    const approved = await approveMemorySuggestion(id, {
      key: typeof payload.key === "string" ? payload.key.trim() : undefined,
      value: typeof payload.value === "string" ? payload.value.trim() : undefined,
      type: parseType(payload.type),
      tags: Array.isArray(payload.tags) ? normalizeStringArray(payload.tags) : undefined,
      isPinned: payload.is_pinned === true,
      userFeedback: typeof payload.user_feedback === "string" ? payload.user_feedback : null,
    });
    if (!approved) {
      return NextResponse.json({ error: "Suggestion not found." }, { status: 404 });
    }
    return NextResponse.json(await loadMemoryPayload());
  }

  if (action === "reject_suggestion" || action === "dismiss_suggestion") {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Suggestion id is required." }, { status: 400 });
    }
    const rejected = await rejectMemorySuggestion(
      id,
      typeof payload.user_feedback === "string" ? payload.user_feedback : null,
    );
    if (!rejected) {
      return NextResponse.json({ error: "Suggestion not found." }, { status: 404 });
    }
    return NextResponse.json(await loadMemoryPayload());
  }

  if (action === "set_preferences") {
    const preferences = await upsertMemoryPreferencesInDb({
      auto_save: typeof payload.auto_save === "boolean" ? payload.auto_save : undefined,
      auto_save_goals:
        typeof payload.auto_save_goals === "boolean" ? payload.auto_save_goals : undefined,
      auto_save_constraints:
        typeof payload.auto_save_constraints === "boolean"
          ? payload.auto_save_constraints
          : undefined,
      auto_save_preferences:
        typeof payload.auto_save_preferences === "boolean"
          ? payload.auto_save_preferences
          : undefined,
      suggestion_snooze_until:
        payload.suggestion_snooze_until === null
          ? null
          : typeof payload.suggestion_snooze_until === "string"
            ? payload.suggestion_snooze_until
            : undefined,
    });
    return NextResponse.json({ ...(await loadMemoryPayload()), preferences });
  }

  if (action === "delete_all") {
    await deleteAllMemoryData();
    return NextResponse.json(await loadMemoryPayload());
  }

  return NextResponse.json(
    {
      error:
        "Unsupported action. Use create, update, delete, forget, approve_suggestion, reject_suggestion, set_preferences, or delete_all.",
    },
    { status: 400 },
  );
}
