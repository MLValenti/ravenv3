"use client";

import { loadSettingsFromStorage } from "./settings";

export type RavenSpeechSettings = {
  enabled: boolean;
  voiceName: string;
  rate: number;
  pitch: number;
};

const SPEECH_SETTINGS_KEY = "raven.speech.settings";
const STOPPED_STORAGE_KEY = "raven.emergency_stopped";

const DEFAULT_SPEECH_SETTINGS: RavenSpeechSettings = {
  enabled: false,
  voiceName: "",
  rate: 1,
  pitch: 1,
};

let activeAudio: HTMLAudioElement | null = null;
let activeAudioObjectUrl: string | null = null;
let activeFetchAbortController: AbortController | null = null;
let activeOnEnd: (() => void) | null = null;
let activeSpeechGeneration = 0;
let speechInFlight = false;
const speechQueue: QueuedSpeechRequest[] = [];

type SpeakOptions = {
  onStart?: () => void;
  onEnd?: () => void;
};

type QueuedSpeechRequest = {
  text: string;
  options: SpeakOptions;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clearActiveAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }

  if (activeAudioObjectUrl) {
    URL.revokeObjectURL(activeAudioObjectUrl);
    activeAudioObjectUrl = null;
  }
}

function clearActiveFetch() {
  if (activeFetchAbortController) {
    activeFetchAbortController.abort();
    activeFetchAbortController = null;
  }
}

function consumeActiveOnEnd() {
  const callback = activeOnEnd;
  activeOnEnd = null;
  callback?.();
}

function isEmergencyStoppedClient() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(STOPPED_STORAGE_KEY) === "true";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function applyPaceToRate(baseRate: number, pace: "slow" | "normal" | "fast"): number {
  if (pace === "slow") {
    return clamp(baseRate * 0.85, 0.5, 2);
  }
  if (pace === "fast") {
    return clamp(baseRate * 1.1, 0.5, 2);
  }
  return clamp(baseRate, 0.5, 2);
}

function isSpeechSynthesisActive(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }
  return window.speechSynthesis.speaking || window.speechSynthesis.pending;
}

function isSpeechActive(): boolean {
  return (
    speechInFlight ||
    activeAudio !== null ||
    activeFetchAbortController !== null ||
    isSpeechSynthesisActive()
  );
}

function speakWithBrowser(
  toSpeak: string,
  speechSettings: RavenSpeechSettings,
  pace: "slow" | "normal" | "fast",
  options: SpeakOptions,
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }

  const utterance = new SpeechSynthesisUtterance(toSpeak);
  utterance.rate = applyPaceToRate(speechSettings.rate, pace);
  utterance.pitch = speechSettings.pitch;

  const voices = window.speechSynthesis.getVoices();
  if (speechSettings.voiceName) {
    const voice = voices.find((candidate) => candidate.name === speechSettings.voiceName);
    if (voice) {
      utterance.voice = voice;
    }
  }

  activeOnEnd = options.onEnd ?? null;
  utterance.onstart = () => {
    options.onStart?.();
  };
  utterance.onend = () => {
    consumeActiveOnEnd();
  };
  utterance.onerror = () => {
    consumeActiveOnEnd();
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

async function speakWithPiper(
  toSpeak: string,
  piperUrl: string,
  modelPath: string,
  speechPauseMs: number,
  options: SpeakOptions,
): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  const generation = activeSpeechGeneration;
  const abortController = new AbortController();
  activeFetchAbortController = abortController;

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: toSpeak,
        piperUrl,
        modelPath,
      }),
      signal: abortController.signal,
    });

    if (response.status === 403) {
      return true;
    }

    if (!response.ok) {
      return false;
    }

    const wavBytes = await response.arrayBuffer();
    if (generation !== activeSpeechGeneration || abortController.signal.aborted) {
      return false;
    }

    const wavBlob = new Blob([wavBytes], { type: "audio/wav" });
    const objectUrl = URL.createObjectURL(wavBlob);
    const audio = new Audio(objectUrl);
    activeAudio = audio;
    activeAudioObjectUrl = objectUrl;
    activeOnEnd = options.onEnd ?? null;

    audio.onplay = () => {
      options.onStart?.();
    };
    audio.onended = () => {
      clearActiveAudio();
      consumeActiveOnEnd();
    };
    audio.onerror = () => {
      clearActiveAudio();
      consumeActiveOnEnd();
    };

    if (speechPauseMs > 0) {
      await delay(Math.max(0, Math.min(5000, speechPauseMs)));
      if (generation !== activeSpeechGeneration || abortController.signal.aborted) {
        return false;
      }
    }

    await audio.play();
    return true;
  } finally {
    if (activeFetchAbortController === abortController) {
      activeFetchAbortController = null;
    }
  }
}

export function loadSpeechSettings(): RavenSpeechSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SPEECH_SETTINGS;
  }

  const raw = window.localStorage.getItem(SPEECH_SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_SPEECH_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RavenSpeechSettings>;
    return {
      enabled: parsed.enabled === true,
      voiceName: typeof parsed.voiceName === "string" ? parsed.voiceName : "",
      rate: clamp(typeof parsed.rate === "number" ? parsed.rate : 1, 0.5, 2),
      pitch: clamp(typeof parsed.pitch === "number" ? parsed.pitch : 1, 0.5, 2),
    };
  } catch {
    return DEFAULT_SPEECH_SETTINGS;
  }
}

export function saveSpeechSettings(next: RavenSpeechSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(next));
}

export function truncateSpeechText(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  const hardLimit = 1200;
  if (trimmed.length <= hardLimit) {
    return trimmed;
  }

  const nearLimit = trimmed.slice(0, Math.min(trimmed.length, hardLimit + 200));
  const punctuationMatches = [...nearLimit.matchAll(/[.!?](?=\s|$)/g)];
  const lastPunctuation = punctuationMatches.at(-1);
  if (lastPunctuation && typeof lastPunctuation.index === "number") {
    const boundary = lastPunctuation.index + 1;
    if (boundary >= Math.floor(hardLimit * 0.6)) {
      return nearLimit.slice(0, boundary).trim();
    }
  }

  return `${trimmed.slice(0, hardLimit).trim()}...`;
}

function finalizeSpeechRequest() {
  speechInFlight = false;
  if (isEmergencyStoppedClient()) {
    speechQueue.length = 0;
    return;
  }
  const next = speechQueue.shift();
  if (!next) {
    return;
  }
  void startSpeechRequest(next);
}

async function startSpeechRequest(request: QueuedSpeechRequest): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  const speechSettings = loadSpeechSettings();
  if (!speechSettings.enabled || isEmergencyStoppedClient()) {
    return false;
  }

  const toSpeak = truncateSpeechText(request.text);
  if (!toSpeak) {
    return false;
  }

  speechInFlight = true;
  activeSpeechGeneration += 1;
  const generation = activeSpeechGeneration;
  const appSettings = loadSettingsFromStorage(window.localStorage);

  const wrappedOptions: SpeakOptions = {
    onStart: request.options.onStart,
    onEnd: () => {
      request.options.onEnd?.();
      finalizeSpeechRequest();
    },
  };

  if (appSettings.ttsProvider === "piper") {
    try {
      const started = await speakWithPiper(
        toSpeak,
        appSettings.piperUrl,
        appSettings.piperVoiceModelPath,
        appSettings.speechPauseMs,
        wrappedOptions,
      );
      if (generation !== activeSpeechGeneration) {
        return false;
      }
      if (started) {
        if (!activeAudio && !isSpeechSynthesisActive() && !activeFetchAbortController) {
          finalizeSpeechRequest();
        }
        return true;
      }
      if (isEmergencyStoppedClient()) {
        finalizeSpeechRequest();
        return false;
      }
      const browserStarted = speakWithBrowser(
        toSpeak,
        speechSettings,
        appSettings.pace,
        wrappedOptions,
      );
      if (!browserStarted) {
        finalizeSpeechRequest();
      }
      return browserStarted;
    } catch {
      if (generation !== activeSpeechGeneration) {
        return false;
      }
      if (isEmergencyStoppedClient()) {
        finalizeSpeechRequest();
        return false;
      }
      const browserStarted = speakWithBrowser(
        toSpeak,
        speechSettings,
        appSettings.pace,
        wrappedOptions,
      );
      if (!browserStarted) {
        finalizeSpeechRequest();
      }
      return browserStarted;
    }
  }

  const started = speakWithBrowser(toSpeak, speechSettings, appSettings.pace, wrappedOptions);
  if (!started) {
    finalizeSpeechRequest();
  }
  return started;
}

export function speakRavenText(text: string, options: SpeakOptions = {}): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const speechSettings = loadSpeechSettings();
  if (!speechSettings.enabled) {
    return false;
  }

  if (isEmergencyStoppedClient()) {
    return false;
  }

  const toSpeak = truncateSpeechText(text);
  if (!toSpeak) {
    return false;
  }

  const request: QueuedSpeechRequest = { text: toSpeak, options };
  if (isSpeechActive()) {
    const lastQueued = speechQueue[speechQueue.length - 1];
    if (lastQueued && lastQueued.text === request.text) {
      return true;
    }
    speechQueue.push(request);
    return true;
  }

  void startSpeechRequest(request);
  return true;
}

export function stopRavenSpeech() {
  activeSpeechGeneration += 1;
  speechInFlight = false;
  speechQueue.length = 0;
  clearActiveFetch();
  clearActiveAudio();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  consumeActiveOnEnd();
}
