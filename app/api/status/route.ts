import { NextResponse } from "next/server.js";

import pkg from "../../../package.json" with { type: "json" };
import {
  getProfileProgressFromDb,
  getRuntimeStateFromDb,
  listMemorySuggestions,
  listTaskOccurrencesFromDb,
  listTasksFromDb,
} from "../../../lib/db.ts";
import { getDeviceService } from "../../../lib/devices/device-service.ts";
import { probeOllamaService, probePiperService } from "../../../lib/operator-status.ts";
import { DEFAULT_SETTINGS } from "../../../lib/settings.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ollamaUrl = searchParams.get("ollamaUrl")?.trim() || DEFAULT_SETTINGS.ollamaBaseUrl;
  const piperUrl = searchParams.get("piperUrl")?.trim() || DEFAULT_SETTINGS.piperUrl;
  const ttsProvider = searchParams.get("ttsProvider") === "piper" ? "piper" : "browser";
  const skipChecks = searchParams.get("skipChecks") === "true";

  const [
    runtimeState,
    deviceStatus,
    activeTasks,
    occurrences,
    pendingMemorySuggestions,
    profileProgress,
    ollama,
    piper,
  ] = await Promise.all([
    getRuntimeStateFromDb(),
    Promise.resolve(getDeviceService().getStatus()),
    listTasksFromDb({ status: "active", limit: 200 }),
    listTaskOccurrencesFromDb({ status: "all", limit: 2000 }),
    listMemorySuggestions("pending"),
    getProfileProgressFromDb(),
    probeOllamaService(ollamaUrl, { skipChecks }),
    probePiperService(piperUrl, {
      enabled: ttsProvider === "piper",
      skipChecks,
    }),
  ]);

  const pendingOccurrences = occurrences.filter(
    (occurrence) => occurrence.status === "pending",
  ).length;
  const pendingReview = occurrences.filter(
    (occurrence) => occurrence.review_state === "pending_review",
  ).length;

  return NextResponse.json({
    app: {
      name: "Raven",
      version: pkg.version,
      uptimeSeconds: Math.floor(process.uptime()),
      now: new Date().toISOString(),
    },
    emergencyStop: {
      stopped: runtimeState.emergency_stop,
      reason: runtimeState.emergency_stop_reason,
      updatedAt: runtimeState.emergency_stop_updated_at,
    },
    devices: deviceStatus,
    tasks: {
      activeCount: activeTasks.length,
      pendingOccurrenceCount: pendingOccurrences,
      pendingReviewCount: pendingReview,
      totalPoints: profileProgress.total_points,
      currentTier: profileProgress.current_tier,
    },
    memory: {
      pendingSuggestionCount: pendingMemorySuggestions.length,
    },
    services: {
      ollama,
      piper,
    },
    config: {
      ollamaUrl,
      piperUrl,
      ttsProvider,
    },
  });
}
