import test from "node:test";
import assert from "node:assert/strict";

import { loadSettingsFromStorage } from "../lib/settings.ts";

test("settings loader ignores legacy persona steering fields", () => {
  const storage = new Map<string, string>();
  const localStorageLike = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  localStorageLike.setItem(
    "raven.settings",
    JSON.stringify({
      personaDirective: "Cold and exact",
      personaAvoid: "No therapy voice",
      personaExamples: "Look at me.\nAnswer properly.",
      personaAddressTerm: "toy!!",
      personaIntensity: "high",
      personaPackId: "custom",
    }),
  );

  const settings = loadSettingsFromStorage(localStorageLike as unknown as Storage);
  assert.equal(settings.personaPackId, "custom");
  assert.equal(settings.toneProfile, "neutral");
  assert.equal("personaDirective" in settings, false);
});
