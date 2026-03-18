"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CONSENT_STORAGE_KEY,
  DEFAULT_CONSENT_STYLE,
  PreferredStyle,
  loadConsentFromStorage,
} from "@/lib/consent";
import { PROFILE_STORAGE_KEY } from "@/lib/profile";

type ConsentFormState = {
  confirmedAdults: boolean;
  safeWord: string;
  limits: string;
  preferredStyle: PreferredStyle;
};

export default function ConsentPage() {
  const router = useRouter();
  const [form, setForm] = useState<ConsentFormState>(() => {
    if (typeof window === "undefined") {
      return {
        confirmedAdults: false,
        safeWord: "",
        limits: "",
        preferredStyle: DEFAULT_CONSENT_STYLE,
      };
    }

    const saved = loadConsentFromStorage(window.localStorage);
    if (!saved) {
      return {
        confirmedAdults: false,
        safeWord: "",
        limits: "",
        preferredStyle: DEFAULT_CONSENT_STYLE,
      };
    }

    return saved;
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const safeWord = form.safeWord.trim();
    const limits = form.limits.trim();

    if (!form.confirmedAdults) {
      setError("You must confirm age and adult-only participant requirements.");
      return;
    }

    if (!safeWord || !limits) {
      setError("Safe word and limits are required.");
      return;
    }

    const payload = {
      confirmedAdults: true,
      safeWord,
      limits,
      preferredStyle: form.preferredStyle,
    };

    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        safeword: safeWord,
        limits,
        preferred_style: form.preferredStyle,
      }),
    );

    const profileResponse = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        safeword: safeWord,
        limits,
        preferred_style: form.preferredStyle,
      }),
    });

    if (!profileResponse.ok) {
      setError("Consent saved locally, but profile sync failed. Try again.");
      return;
    }

    router.push("/session");
  }

  return (
    <section className="panel">
      <h1>Consent Setup</h1>
      <p className="muted">Complete this once before using Session.</p>

      <form className="form" onSubmit={onSubmit}>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={form.confirmedAdults}
            onChange={(event) =>
              setForm((current) => ({ ...current, confirmedAdults: event.target.checked }))
            }
          />
          <span>I confirm I am 18+ and all participants are 21+</span>
        </label>

        <label className="field">
          <span>Safe word</span>
          <input
            value={form.safeWord}
            onChange={(event) => setForm((current) => ({ ...current, safeWord: event.target.value }))}
            placeholder="Example: red"
          />
        </label>

        <label className="field">
          <span>Limits</span>
          <textarea
            rows={4}
            value={form.limits}
            onChange={(event) => setForm((current) => ({ ...current, limits: event.target.value }))}
            placeholder="List hard limits and boundaries."
          />
        </label>

        <label className="field">
          <span>Preferred style</span>
          <select
            value={form.preferredStyle}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                preferredStyle: event.target.value as PreferredStyle,
              }))
            }
          >
            <option value="gentle">Gentle</option>
            <option value="direct">Direct</option>
            <option value="playful">Playful</option>
          </select>
        </label>

        <button className="button" type="submit">
          Save Consent
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
