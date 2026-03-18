import { NextResponse } from "next/server";

import { getRelationshipStateFromDb, upsertRelationshipStateInDb } from "@/lib/db";
import {
  createDefaultRelationshipState,
  normalizeRelationshipState,
  type SessionRelationshipMetrics,
  updateRelationshipFromSession,
} from "@/lib/session/relationship-manager";

type RelationshipRequestBody = {
  metrics?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseMetrics(value: unknown): SessionRelationshipMetrics | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawLatency = value.average_response_latency_ms;
  const latencyNumeric =
    typeof rawLatency === "number" ? rawLatency : rawLatency == null ? NaN : Number(rawLatency);
  return {
    pass_rate: toNumber(value.pass_rate),
    fail_rate: toNumber(value.fail_rate),
    refusal_count: Math.max(0, Math.floor(toNumber(value.refusal_count))),
    average_response_latency_ms: Number.isFinite(latencyNumeric) ? latencyNumeric : null,
    total_turns: Math.max(0, Math.floor(toNumber(value.total_turns))),
    streak_max: Math.max(0, Math.floor(toNumber(value.streak_max))),
  };
}

export async function GET() {
  const raw = await getRelationshipStateFromDb();
  const normalized = normalizeRelationshipState(
    {
      trust_score: raw.trust_score,
      rapport_score: raw.rapport_score,
      reliability_score: raw.reliability_score,
      last_updated_ts: raw.last_updated_ts,
    },
    Date.now(),
  );
  return NextResponse.json({ relationship: normalized });
}

export async function POST(request: Request) {
  let payload: RelationshipRequestBody;
  try {
    payload = (await request.json()) as RelationshipRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const metrics = parseMetrics(payload.metrics);
  if (!metrics) {
    return NextResponse.json({ error: "metrics object is required." }, { status: 400 });
  }

  const currentRaw = await getRelationshipStateFromDb();
  const current = normalizeRelationshipState(
    {
      ...createDefaultRelationshipState(Date.now()),
      trust_score: currentRaw.trust_score,
      rapport_score: currentRaw.rapport_score,
      reliability_score: currentRaw.reliability_score,
      last_updated_ts: currentRaw.last_updated_ts,
    },
    Date.now(),
  );
  const updated = updateRelationshipFromSession(current, metrics, Date.now());
  await upsertRelationshipStateInDb({
    trust_score: updated.trust_score,
    rapport_score: updated.rapport_score,
    reliability_score: updated.reliability_score,
    relationship_label: updated.relationship_label,
    last_updated_ts: updated.last_updated_ts,
  });

  return NextResponse.json({ relationship: updated });
}
