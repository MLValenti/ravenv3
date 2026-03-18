"use client";

import { ChangeEvent, useEffect, useState } from "react";

import type { CustomPersonaSpec } from "@/lib/persona/custom-persona";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type SettingsState,
  loadSettingsFromStorage,
} from "@/lib/settings";

type PersonaRouteBody = {
  spec?: CustomPersonaSpec;
  pack?: {
    style_rules?: {
      voice_markers?: string[];
    };
  };
};

const DEFAULT_CUSTOM_PERSONA: CustomPersonaSpec = {
  id: "custom",
  name: "Custom Raven",
  version: "1.0.0",
  updated_at: "2026-03-09",
  directive: "",
  avoid: [],
  examples: [],
  address_term: "",
  intensity: "medium",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SETTINGS;
    }

    return loadSettingsFromStorage(window.localStorage);
  });
  const [saved, setSaved] = useState(false);
  const [persona, setPersona] = useState<CustomPersonaSpec>(DEFAULT_CUSTOM_PERSONA);
  const [voiceMarkers, setVoiceMarkers] = useState<string[]>([]);
  const [personaLoaded, setPersonaLoaded] = useState(false);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaSaveState, setPersonaSaveState] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let active = true;

    async function loadCustomPersona() {
      try {
        const response = await fetch("/api/persona/custom", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load custom persona");
        }
        const body = (await response.json()) as PersonaRouteBody;
        if (!active) {
          return;
        }
        setPersona(body.spec ?? DEFAULT_CUSTOM_PERSONA);
        setVoiceMarkers(body.pack?.style_rules?.voice_markers ?? []);
      } catch {
        if (!active) {
          return;
        }
        setPersona(DEFAULT_CUSTOM_PERSONA);
        setVoiceMarkers([]);
      } finally {
        if (active) {
          setPersonaLoaded(true);
        }
      }
    }

    void loadCustomPersona();
    return () => {
      active = false;
    };
  }, []);

  function updateField<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    const nextValue = { ...settings, [key]: value };
    setSettings(nextValue);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextValue));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1000);
  }

  function updatePersona<K extends keyof CustomPersonaSpec>(key: K, value: CustomPersonaSpec[K]) {
    setPersona((current) => ({ ...current, [key]: value }));
    setPersonaSaveState("idle");
  }

  async function savePersona(useCustomPack: boolean) {
    setPersonaSaving(true);
    setPersonaSaveState("idle");
    try {
      const response = await fetch("/api/persona/custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(persona),
      });
      if (!response.ok) {
        throw new Error("Failed to save custom persona");
      }
      const body = (await response.json()) as PersonaRouteBody;
      setPersona(body.spec ?? persona);
      setVoiceMarkers(body.pack?.style_rules?.voice_markers ?? []);
      setPersonaSaveState("saved");
      if (useCustomPack) {
        updateField("personaPackId", "custom");
      }
    } catch {
      setPersonaSaveState("error");
    } finally {
      setPersonaSaving(false);
    }
  }

  return (
    <section className="panel">
      <h1>Settings</h1>
      <p className="muted">Saved in localStorage under `{SETTINGS_STORAGE_KEY}`.</p>

      <form className="form" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>Ollama base URL</span>
          <input
            value={settings.ollamaBaseUrl}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("ollamaBaseUrl", event.target.value)
            }
          />
        </label>

        <label className="field">
          <span>Ollama model</span>
          <input
            value={settings.ollamaModel}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("ollamaModel", event.target.value)
            }
          />
        </label>

        <label className="field">
          <span>Persona pack id</span>
          <input
            value={settings.personaPackId}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("personaPackId", event.target.value || "default")
            }
          />
        </label>

        <label className="field">
          <span>Tone profile</span>
          <select
            value={settings.toneProfile}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              updateField(
                "toneProfile",
                event.target.value === "dominant"
                  ? "dominant"
                  : event.target.value === "friendly"
                    ? "friendly"
                    : "neutral",
              )
            }
          >
            <option value="neutral">neutral</option>
            <option value="friendly">friendly</option>
            <option value="dominant">dominant</option>
          </select>
        </label>

        <fieldset className="field">
          <legend>Custom Persona</legend>
          <p className="muted">
            This is the saved source of truth for pack `custom`. Saving regenerates the local custom
            persona spec, source text, and pack.
          </p>

          <label className="field">
            <span>Persona directive</span>
            <textarea
              rows={4}
              value={persona.directive}
              placeholder="Describe the Raven voice you want."
              disabled={!personaLoaded}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                updatePersona("directive", event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>Misses to avoid</span>
            <textarea
              rows={4}
              value={persona.avoid.join("\n")}
              placeholder="One line per miss."
              disabled={!personaLoaded}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                updatePersona(
                  "avoid",
                  event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                )
              }
            />
          </label>

          <label className="field">
            <span>Reference lines</span>
            <textarea
              rows={6}
              value={persona.examples.join("\n")}
              placeholder="One line per example."
              disabled={!personaLoaded}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                updatePersona(
                  "examples",
                  event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                )
              }
            />
          </label>

          <label className="field">
            <span>Preferred address term</span>
            <input
              value={persona.address_term}
              placeholder="Optional, for example pet or toy"
              disabled={!personaLoaded}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updatePersona("address_term", event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>Steering intensity</span>
            <select
              value={persona.intensity}
              disabled={!personaLoaded}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                updatePersona(
                  "intensity",
                  event.target.value === "low"
                    ? "low"
                    : event.target.value === "high"
                      ? "high"
                      : "medium",
                )
              }
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>

          <p className="muted">Generated voice markers: {voiceMarkers.join(", ") || "none"}</p>

          <div className="field">
            <button type="button" onClick={() => void savePersona(false)} disabled={personaSaving}>
              Save custom persona
            </button>
            <button type="button" onClick={() => void savePersona(true)} disabled={personaSaving}>
              Save and use `custom`
            </button>
          </div>

          {personaSaveState === "saved" ? <p className="ok-text">Custom persona saved.</p> : null}
          {personaSaveState === "error" ? (
            <p className="muted">Failed to save custom persona.</p>
          ) : null}
        </fieldset>

        <label className="field">
          <span>LLM temperature</span>
          <input
            type="number"
            min={0.1}
            max={1.5}
            step={0.01}
            value={settings.llmTemperature}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("llmTemperature", Number(event.target.value || "0.9"))
            }
          />
        </label>

        <label className="field">
          <span>LLM top_p</span>
          <input
            type="number"
            min={0.1}
            max={1}
            step={0.01}
            value={settings.llmTopP}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("llmTopP", Number(event.target.value || "0.9"))
            }
          />
        </label>

        <label className="field">
          <span>LLM top_k</span>
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={settings.llmTopK}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("llmTopK", Number(event.target.value || "40"))
            }
          />
        </label>

        <label className="field">
          <span>LLM repeat penalty</span>
          <input
            type="number"
            min={1}
            max={2}
            step={0.01}
            value={settings.llmRepeatPenalty}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("llmRepeatPenalty", Number(event.target.value || "1.12"))
            }
          />
        </label>

        <label className="field">
          <span>LLM stop sequences (comma separated)</span>
          <input
            value={settings.llmStopSequences.join(", ")}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField(
                "llmStopSequences",
                event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0),
              )
            }
          />
        </label>

        <label className="field">
          <span>Vision service base URL</span>
          <input
            value={settings.visionBaseUrl}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("visionBaseUrl", event.target.value)
            }
          />
        </label>

        <label className="field">
          <span>Intiface websocket URL</span>
          <input
            value={settings.intifaceWsUrl}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("intifaceWsUrl", event.target.value)
            }
          />
        </label>

        <label className="field">
          <span>TTS provider</span>
          <select
            value={settings.ttsProvider}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              updateField("ttsProvider", event.target.value === "piper" ? "piper" : "browser")
            }
          >
            <option value="browser">browser</option>
            <option value="piper">piper</option>
          </select>
        </label>

        <label className="field">
          <span>Piper URL</span>
          <input
            value={settings.piperUrl}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("piperUrl", event.target.value)
            }
          />
        </label>

        <label className="field">
          <span>Piper voice model path</span>
          <input
            value={settings.piperVoiceModelPath}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("piperVoiceModelPath", event.target.value)
            }
          />
        </label>

        <label className="field">
          <span>Global pace</span>
          <select
            value={settings.pace}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              updateField(
                "pace",
                event.target.value === "fast"
                  ? "fast"
                  : event.target.value === "normal"
                    ? "normal"
                    : "slow",
              )
            }
          >
            <option value="slow">slow</option>
            <option value="normal">normal</option>
            <option value="fast">fast</option>
          </select>
        </label>

        <label className="field">
          <span>Speech pause before playback (ms)</span>
          <input
            type="number"
            min={0}
            max={5000}
            value={settings.speechPauseMs}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("speechPauseMs", Number(event.target.value || "0"))
            }
          />
        </label>
      </form>

      {saved ? <p className="ok-text">Settings saved.</p> : null}
    </section>
  );
}
