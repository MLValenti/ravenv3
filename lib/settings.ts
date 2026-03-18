export type SettingsState = {
  ollamaBaseUrl: string;
  ollamaModel: string;
  personaPackId: string;
  toneProfile: "neutral" | "friendly" | "dominant";
  llmTemperature: number;
  llmTopP: number;
  llmTopK: number;
  llmRepeatPenalty: number;
  llmStopSequences: string[];
  visionBaseUrl: string;
  intifaceWsUrl: string;
  ttsProvider: "browser" | "piper";
  piperUrl: string;
  piperVoiceModelPath: string;
  pace: "slow" | "normal" | "fast";
  speechPauseMs: number;
};

export const DEFAULT_SETTINGS: SettingsState = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "dolphin-llama3:8b",
  personaPackId: "default",
  toneProfile: "neutral",
  llmTemperature: 0.9,
  llmTopP: 0.9,
  llmTopK: 40,
  llmRepeatPenalty: 1.12,
  llmStopSequences: ["<|assistant_end|>"],
  visionBaseUrl: "http://127.0.0.1:7001",
  intifaceWsUrl: "ws://localhost:12345",
  ttsProvider: "browser",
  piperUrl: "http://127.0.0.1:7002",
  piperVoiceModelPath: "tools/tts/models/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx",
  pace: "slow",
  speechPauseMs: 500,
};

export const SETTINGS_STORAGE_KEY = "raven.settings";

function normalizeSpeechPauseMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.speechPauseMs;
  }

  return Math.max(0, Math.min(5000, Math.floor(numeric)));
}

function normalizeLlmTemperature(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.llmTemperature;
  }
  return Math.max(0.1, Math.min(1.5, Number(numeric.toFixed(2))));
}

function normalizeLlmTopP(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.llmTopP;
  }
  return Math.max(0.1, Math.min(1, Number(numeric.toFixed(2))));
}

function normalizeLlmTopK(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.llmTopK;
  }
  return Math.max(1, Math.min(200, Math.floor(numeric)));
}

function normalizeLlmRepeatPenalty(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.llmRepeatPenalty;
  }
  return Math.max(1, Math.min(2, Number(numeric.toFixed(2))));
}

function normalizeStopSequences(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SETTINGS.llmStopSequences;
  }
  const cleaned = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 8);
  if (cleaned.length === 0) {
    return DEFAULT_SETTINGS.llmStopSequences;
  }
  return cleaned;
}

export function loadSettingsFromStorage(storage: Storage | null | undefined): SettingsState {
  if (!storage) {
    return DEFAULT_SETTINGS;
  }

  const raw = storage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      ollamaBaseUrl: parsed.ollamaBaseUrl ?? DEFAULT_SETTINGS.ollamaBaseUrl,
      ollamaModel: parsed.ollamaModel ?? DEFAULT_SETTINGS.ollamaModel,
      personaPackId:
        typeof parsed.personaPackId === "string" && parsed.personaPackId.trim().length > 0
          ? parsed.personaPackId.trim()
          : DEFAULT_SETTINGS.personaPackId,
      toneProfile:
        parsed.toneProfile === "friendly" || parsed.toneProfile === "dominant"
          ? parsed.toneProfile
          : "neutral",
      llmTemperature: normalizeLlmTemperature(parsed.llmTemperature),
      llmTopP: normalizeLlmTopP(parsed.llmTopP),
      llmTopK: normalizeLlmTopK(parsed.llmTopK),
      llmRepeatPenalty: normalizeLlmRepeatPenalty(parsed.llmRepeatPenalty),
      llmStopSequences: normalizeStopSequences(parsed.llmStopSequences),
      visionBaseUrl: parsed.visionBaseUrl ?? DEFAULT_SETTINGS.visionBaseUrl,
      intifaceWsUrl: parsed.intifaceWsUrl ?? DEFAULT_SETTINGS.intifaceWsUrl,
      ttsProvider: parsed.ttsProvider === "piper" ? "piper" : "browser",
      piperUrl: parsed.piperUrl ?? DEFAULT_SETTINGS.piperUrl,
      piperVoiceModelPath: parsed.piperVoiceModelPath ?? DEFAULT_SETTINGS.piperVoiceModelPath,
      pace: parsed.pace === "fast" || parsed.pace === "normal" ? parsed.pace : "slow",
      speechPauseMs: normalizeSpeechPauseMs(parsed.speechPauseMs),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
