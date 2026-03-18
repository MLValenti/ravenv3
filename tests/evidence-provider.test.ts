import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetEvidenceProvidersForTests,
  analyzeWithEvidenceProvider,
  getEvidenceProvider,
  registerEvidenceProvider,
  unregisterEvidenceProvider,
} from "../lib/vision/evidence-provider.ts";

test("evidence provider registry can swap providers without changing callers", async () => {
  __resetEvidenceProvidersForTests();

  registerEvidenceProvider({
    id: "mock_provider_a",
    label: "Mock A",
    supportedSignals: ["coverage_change_detected"],
    async analyzeDataUrl() {
      return {
        provider_id: "mock_provider_a",
        status: "pass_candidate",
        confidence: 0.8,
        summary: "Mock provider A passed.",
        review_recommended: true,
        signals: [
          {
            id: "coverage_change_detected",
            state: "positive",
            score: 0.8,
            summary: "Signal A.",
          },
        ],
        metadata: {},
      };
    },
  });

  const first = await analyzeWithEvidenceProvider("mock_provider_a", {
    imageDataUrl: "data:image/png;base64,aaaa",
  });
  assert.equal(first.provider_id, "mock_provider_a");
  assert.equal(first.status, "pass_candidate");

  registerEvidenceProvider({
    id: "mock_provider_b",
    label: "Mock B",
    supportedSignals: ["coverage_change_detected"],
    async analyzeDataUrl() {
      return {
        provider_id: "mock_provider_b",
        status: "fail_candidate",
        confidence: 0.2,
        summary: "Mock provider B failed.",
        review_recommended: true,
        signals: [
          {
            id: "coverage_change_detected",
            state: "negative",
            score: 0.2,
            summary: "Signal B.",
          },
        ],
        metadata: {},
      };
    },
  });

  const second = await analyzeWithEvidenceProvider("mock_provider_b", {
    imageDataUrl: "data:image/png;base64,bbbb",
  });
  assert.equal(second.provider_id, "mock_provider_b");
  assert.equal(second.status, "fail_candidate");
  assert.equal(getEvidenceProvider("mock_provider_b")?.label, "Mock B");

  unregisterEvidenceProvider("mock_provider_a");
  assert.equal(getEvidenceProvider("mock_provider_a"), null);

  __resetEvidenceProvidersForTests();
});
