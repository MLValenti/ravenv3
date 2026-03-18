export type EvidenceProviderStatus = "pass_candidate" | "fail_candidate" | "inconclusive";

export type EvidenceSignalState = "positive" | "negative" | "unknown";

export type EvidenceSignalId =
  | "coverage_change_detected"
  | "upper_body_coverage_reduced"
  | "lower_body_coverage_reduced";

export type EvidenceSignalResult = {
  id: EvidenceSignalId;
  state: EvidenceSignalState;
  score: number;
  summary: string;
};

export type EvidenceAnalysisResult = {
  provider_id: string;
  status: EvidenceProviderStatus;
  confidence: number;
  summary: string;
  review_recommended: boolean;
  signals: EvidenceSignalResult[];
  metadata: Record<string, unknown>;
};

export type EvidenceProvider = {
  id: string;
  label: string;
  supportedSignals: EvidenceSignalId[];
  analyzeDataUrl: (input: {
    imageDataUrl: string;
    baselineDataUrl?: string | null;
    taskHint?: string | null;
  }) => Promise<EvidenceAnalysisResult>;
};

const providerRegistry = new Map<string, EvidenceProvider>();

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeSignalId(value: unknown): EvidenceSignalId | null {
  if (
    value === "coverage_change_detected" ||
    value === "upper_body_coverage_reduced" ||
    value === "lower_body_coverage_reduced"
  ) {
    return value;
  }
  return null;
}

function normalizeSignalState(value: unknown): EvidenceSignalState {
  if (value === "positive" || value === "negative" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function registerEvidenceProvider(provider: EvidenceProvider): void {
  providerRegistry.set(provider.id, provider);
}

export function unregisterEvidenceProvider(providerId: string): void {
  providerRegistry.delete(providerId);
}

export function getEvidenceProvider(providerId: string): EvidenceProvider | null {
  return providerRegistry.get(providerId) ?? null;
}

export function listEvidenceProviders(): EvidenceProvider[] {
  return [...providerRegistry.values()];
}

export async function analyzeWithEvidenceProvider(
  providerId: string,
  input: { imageDataUrl: string; baselineDataUrl?: string | null; taskHint?: string | null },
): Promise<EvidenceAnalysisResult> {
  const provider = getEvidenceProvider(providerId);
  if (!provider) {
    throw new Error(`Evidence provider not found: ${providerId}`);
  }
  return provider.analyzeDataUrl(input);
}

export function normalizeEvidenceAnalysisResult(value: unknown): EvidenceAnalysisResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const providerId =
    typeof candidate.provider_id === "string" ? candidate.provider_id.trim().slice(0, 120) : "";
  if (!providerId) {
    return null;
  }

  const status =
    candidate.status === "pass_candidate" ||
    candidate.status === "fail_candidate" ||
    candidate.status === "inconclusive"
      ? candidate.status
      : "inconclusive";
  const summary =
    typeof candidate.summary === "string" ? candidate.summary.trim().slice(0, 300) : "";
  const signalsSource = Array.isArray(candidate.signals) ? candidate.signals : [];
  const signals: EvidenceSignalResult[] = [];
  for (const item of signalsSource) {
    const signal = asRecord(item);
    const signalId = normalizeSignalId(signal.id);
    if (!signalId) {
      continue;
    }
    signals.push({
      id: signalId,
      state: normalizeSignalState(signal.state),
      score: clampUnit(typeof signal.score === "number" ? signal.score : 0),
      summary:
        typeof signal.summary === "string" ? signal.summary.trim().slice(0, 180) : "",
    });
  }

  const metadata = asRecord(candidate.metadata);
  const normalizedMetadata: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(metadata)) {
    if (typeof rawValue === "string") {
      normalizedMetadata[key] = rawValue.slice(0, 180);
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      normalizedMetadata[key] = rawValue;
    }
  }

  return {
    provider_id: providerId,
    status,
    confidence: clampUnit(typeof candidate.confidence === "number" ? candidate.confidence : 0),
    summary,
    review_recommended: candidate.review_recommended !== false,
    signals: signals.slice(0, 8),
    metadata: normalizedMetadata,
  };
}

export function __resetEvidenceProvidersForTests(): void {
  providerRegistry.clear();
}
