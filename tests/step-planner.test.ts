import test from "node:test";
import assert from "node:assert/strict";

import { planNextStep } from "../lib/session/step-planner.ts";

function baseOptions() {
  return {
    settings: {
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test-model",
      personaPackId: null,
      toneProfile: "balanced" as const,
      llmTemperature: 0.2,
      llmTopP: 0.9,
      llmTopK: 40,
      llmRepeatPenalty: 1.1,
      llmStopSequences: [],
    },
    consent: {
      accepted: true,
      safeWord: "red",
      limits: "",
      preferredStyle: "",
    },
    context: {
      recentRavenOutputs: [],
      recentVerificationSummaries: [],
      lastUserResponse: "hi",
      lastUserIntent: "other",
      lastCheckSummary: "",
      trackingStatus: "lost" as const,
      lastStepsSummary: "- none",
      memoryFacts: [],
      memorySummary: "none",
      sessionMemorySummary: "- none",
      sessionPhase: "warmup",
      awaitingUser: false,
      moodLabel: "neutral",
      relationshipLabel: "new",
      difficultyLevel: 1,
      statePromptBlock: "",
      allowedCheckTypes: ["presence"],
      capabilityCatalogPrompt: "",
    },
    stepIndex: 1,
    observation: null,
    visionSignalsStatus: {
      faceLandmarks: false,
      poseLandmarks: false,
      objectDetector: false,
      clothingDetector: false,
    },
    deviceOptIn: false,
    deviceExecutionSummary: null,
  };
}

test("planner authority_error returns planner_error without creating a fallback step", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        type: "authority_error",
        error_category: "planner_validation_error",
        blocked_reason: "planner_step_missing_required_fields",
        authority_trace_present: false,
        server_authority_sentinel: "missing",
        planner_error: {
          missing_fields: ["say", "onPassSay", "onFailSay"],
          planner_path: "api_chat_planner",
          strategy: "interpret_then_lead",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const result = await planNextStep(baseOptions());
    assert.equal(result.step, undefined);
    assert.equal(result.fallback, false);
    assert.equal(result.reason, "planner_step_missing_required_fields");
    assert.equal(result.plannerError?.category, "planner_validation_error");
    assert.deepEqual(result.plannerError?.missingFields, ["say", "onPassSay", "onFailSay"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
