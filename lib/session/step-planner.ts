"use client";

import type { ConsentState } from "../consent";
import type { SettingsState } from "../settings";
import type { VisionObservation } from "../camera/observation";
import type {
  PlannerCheckValidationReport,
  VisionSignalsStatus,
} from "../camera/vision-capabilities";
import {
  parseAndValidatePlannedStep,
  toPlannerPrompt,
  type PlannerContext,
  type PlannedStep,
} from "./step-planner-schema.ts";

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
  step?: PlannedStep;
  fallback: boolean;
  reason?: string;
  raw?: string;
  validation?: PlannerCheckValidationReport;
  plannerError?: {
    category: string;
    blockedReason: string;
    missingFields: string[];
    plannerPath: string;
    strategy: string;
  };
};

type PlannerRouteResponse = {
  step?: unknown;
  fallback?: unknown;
  error?: unknown;
  type?: unknown;
  error_category?: unknown;
  blocked_reason?: unknown;
  planner_error?: unknown;
  raw?: unknown;
  validation?: unknown;
};

function normalizePlannerError(body: PlannerRouteResponse, fallbackReason: string): PlanStepResult {
  const plannerError =
    body.planner_error && typeof body.planner_error === "object"
      ? (body.planner_error as Record<string, unknown>)
      : {};
  const missingFields = Array.isArray(plannerError.missing_fields)
    ? plannerError.missing_fields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    fallback: false,
    reason:
      typeof body.blocked_reason === "string"
        ? body.blocked_reason
        : typeof body.error === "string"
          ? body.error
          : fallbackReason,
    plannerError: {
      category:
        typeof body.error_category === "string"
          ? body.error_category
          : "planner_validation_error",
      blockedReason:
        typeof body.blocked_reason === "string"
          ? body.blocked_reason
          : "planner_step_missing_required_fields",
      missingFields,
      plannerPath:
        typeof plannerError.planner_path === "string"
          ? plannerError.planner_path
          : "api_chat_planner",
      strategy:
        typeof plannerError.strategy === "string"
          ? plannerError.strategy
          : "unknown",
    },
  };
}

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
    const body = (await response.json().catch(() => ({}))) as PlannerRouteResponse;
    if (body.type === "authority_error" || body.error_category === "planner_validation_error") {
      return normalizePlannerError(body, "Planner request failed.");
    }
    const reason = typeof body.error === "string" ? body.error : "Planner request failed.";
    return {
      fallback: false,
      reason,
      validation: undefined,
      plannerError: {
        category: "planner_request_error",
        blockedReason: reason,
        missingFields: [],
        plannerPath: "api_chat_planner",
        strategy: "unknown",
      },
    };
  }

  const body = (await response.json()) as PlannerRouteResponse;
  if (body.type === "authority_error" || body.error_category === "planner_validation_error") {
    return normalizePlannerError(body, "Planner response failed validation.");
  }
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
    fallback: false,
    reason:
      typeof body.error === "string"
        ? body.error
        : "Planner response was invalid. Using safe fallback.",
    raw: typeof body.raw === "string" ? body.raw : undefined,
    validation: validation ?? undefined,
    plannerError: {
      category: "planner_validation_error",
      blockedReason: "planner_step_missing_required_fields",
      missingFields: [],
      plannerPath: "client_plan_next_step",
      strategy: "unknown",
    },
  };
}
