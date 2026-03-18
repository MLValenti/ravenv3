import { DEFAULT_SETTINGS } from "./settings.ts";
import { validateAndNormalizeLocalHttpBaseUrl } from "./local-url.ts";

export type OperatorServiceState = {
  state: "online" | "offline" | "disabled" | "skipped";
  url: string;
  detail: string;
  latencyMs: number | null;
  httpStatus: number | null;
};

type ProbeOptions = {
  fetchFn?: typeof fetch;
  skipChecks?: boolean;
  timeoutMs?: number;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Service probe failed.";
}

async function fetchWithTimeout(
  url: string,
  options: ProbeOptions,
): Promise<{ response: Response; latencyMs: number }> {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeoutMs = Math.max(150, Math.min(10_000, Math.floor(options.timeoutMs ?? 1_500)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      response,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOllamaService(
  rawUrl = DEFAULT_SETTINGS.ollamaBaseUrl,
  options: ProbeOptions = {},
): Promise<OperatorServiceState> {
  const validated = validateAndNormalizeLocalHttpBaseUrl(rawUrl);
  if (!validated.ok) {
    return {
      state: "offline",
      url: rawUrl,
      detail: validated.error,
      latencyMs: null,
      httpStatus: null,
    };
  }

  if (options.skipChecks) {
    return {
      state: "skipped",
      url: validated.normalizedBaseUrl,
      detail: "Probe skipped.",
      latencyMs: null,
      httpStatus: null,
    };
  }

  try {
    const { response, latencyMs } = await fetchWithTimeout(
      `${validated.normalizedBaseUrl}/api/tags`,
      options,
    );
    if (!response.ok) {
      return {
        state: "offline",
        url: validated.normalizedBaseUrl,
        detail: `HTTP ${response.status} from Ollama.`,
        latencyMs,
        httpStatus: response.status,
      };
    }
    const payload = (await response.json().catch(() => ({}))) as {
      models?: Array<{ name?: string }>;
    };
    const modelCount = Array.isArray(payload.models) ? payload.models.length : 0;
    return {
      state: "online",
      url: validated.normalizedBaseUrl,
      detail: `${modelCount} local model${modelCount === 1 ? "" : "s"} reported.`,
      latencyMs,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      state: "offline",
      url: validated.normalizedBaseUrl,
      detail: toErrorMessage(error),
      latencyMs: null,
      httpStatus: null,
    };
  }
}

export async function probePiperService(
  rawUrl = DEFAULT_SETTINGS.piperUrl,
  options: ProbeOptions & { enabled?: boolean } = {},
): Promise<OperatorServiceState> {
  if (options.enabled === false) {
    return {
      state: "disabled",
      url: rawUrl,
      detail: "Browser speech selected. Piper probe disabled.",
      latencyMs: null,
      httpStatus: null,
    };
  }

  const validated = validateAndNormalizeLocalHttpBaseUrl(rawUrl);
  if (!validated.ok) {
    return {
      state: "offline",
      url: rawUrl,
      detail: validated.error,
      latencyMs: null,
      httpStatus: null,
    };
  }

  if (options.skipChecks) {
    return {
      state: "skipped",
      url: validated.normalizedBaseUrl,
      detail: "Probe skipped.",
      latencyMs: null,
      httpStatus: null,
    };
  }

  try {
    const { response, latencyMs } = await fetchWithTimeout(
      `${validated.normalizedBaseUrl}/health`,
      options,
    );
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      modelPath?: string;
      error?: string;
    };
    if (!response.ok || payload.ok === false) {
      return {
        state: "offline",
        url: validated.normalizedBaseUrl,
        detail: payload.error || `HTTP ${response.status} from Piper.`,
        latencyMs,
        httpStatus: response.status,
      };
    }
    const modelPath = typeof payload.modelPath === "string" ? payload.modelPath : "model loaded";
    return {
      state: "online",
      url: validated.normalizedBaseUrl,
      detail: modelPath,
      latencyMs,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      state: "offline",
      url: validated.normalizedBaseUrl,
      detail: toErrorMessage(error),
      latencyMs: null,
      httpStatus: null,
    };
  }
}
