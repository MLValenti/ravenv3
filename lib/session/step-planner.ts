"use client";

import type { ConsentState } from "../consent";
import type { SettingsState } from "../settings";
import type { VisionObservation } from "../camera/observation";
import type {
  PlannerCheckValidationReport,
  VisionSignalsStatus,
} from "../camera/vision-capabilities";
import {
  createSafeFallbackStep,
  parseAndValidatePlannedStep,
  toPlannerPrompt,
  type PlannerContext,
  type PlannedStep,
} from "./step-planner-schema";

type PlanStepOptions = {
  settings: SettingsState;
  consent: ConsentState;
  context: PlannerContext;
  stepIndex: number;
  observation: VisionObservation | null;
  visionSignalsStatus: VisionSignalsStatus;
  deviceOptIn: boolean;
  deviceExecutionSummary: string | null;
  memoryAutoSave?: boolean;
  sessionId?: string;
  signal?: AbortSignal;
};

export type PlanStepResult = {
  step: PlannedStep;
  fallback: boolean;
  reason?: string;
  raw?: string;
  validation?: PlannerCheckValidationReport;
};

type PlannerRouteResponse = {
  step?: unknown;
  fallback?: unknown;
  error?: unknown;
  raw?: unknown;
  validation?: unknown;
};

export async function planNextStep({
  settings,
  consent,
  context,
  stepIndex,
  observation,
  visionSignalsStatus,
  deviceOptIn,
  deviceExecutionSummary,
  memoryAutoSave,
  sessionId,
  signal,
}: PlanStepOptions): Promise<PlanStepResult> {
  const prompt = toPlannerPrompt(context, stepIndex);

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl: settings.ollamaBaseUrl,
      model: settings.ollamaModel,
      personaPackId: settings.personaPackId,
      toneProfile: settings.toneProfile,
      llmTemperature: settings.llmTemperature,
      llmTopP: settings.llmTopP,
      llmTopK: settings.llmTopK,
      llmRepeatPenalty: settings.llmRepeatPenalty,
      llmStop: settings.llmStopSequences,
      consent,
      planner: { enabled: true, stepIndex },
      deviceOptIn,
      deviceExecutionSummary,
      memoryAutoSave,
      sessionId,
      memoryText: context.lastUserResponse ?? "",
      observations: observation,
      visionSignalsStatus,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    const reason = typeof body.error === "string" ? body.error : "Planner request failed.";
    return {
      step: createSafeFallbackStep(stepIndex),
      fallback: true,
      reason,
      validation: undefined,
    };
  }

  const body = (await response.json()) as PlannerRouteResponse;
  const validation = (body.validation ?? null) as PlannerCheckValidationReport | null;
  if (typeof body.raw === "string") {
    const parsed = parseAndValidatePlannedStep(body.raw, stepIndex, {
      allowedCheckTypes: context.allowedCheckTypes,
    });
    if (parsed.ok) {
      return {
        step: parsed.step,
        fallback: body.fallback === true,
        raw: body.raw,
        validation: validation ?? undefined,
      };
    }
  }

  const parsed = parseAndValidatePlannedStep(JSON.stringify(body.step ?? {}), stepIndex, {
    allowedCheckTypes: context.allowedCheckTypes,
  });
  if (parsed.ok) {
    return {
      step: parsed.step,
      fallback: body.fallback === true,
      raw: typeof body.raw === "string" ? body.raw : undefined,
      validation: validation ?? undefined,
    };
  }

  return {
    step: createSafeFallbackStep(stepIndex),
    fallback: true,
    reason:
      typeof body.error === "string"
        ? body.error
        : "Planner response was invalid. Using safe fallback.",
    raw: typeof body.raw === "string" ? body.raw : undefined,
    validation: validation ?? undefined,
  };
}
