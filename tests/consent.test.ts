import test from "node:test";
import assert from "node:assert/strict";

import { containsAgeAmbiguityTerms, isConsentComplete } from "../lib/consent.ts";

test("consent must include confirmation, safe word, limits, and preferred style", () => {
  assert.equal(
    isConsentComplete({
      confirmedAdults: true,
      safeWord: "red",
      limits: "no pain",
      preferredStyle: "gentle",
    }),
    true,
  );

  assert.equal(
    isConsentComplete({
      confirmedAdults: false,
      safeWord: "red",
      limits: "no pain",
      preferredStyle: "gentle",
    }),
    false,
  );
});

test("detects age ambiguity terms", () => {
  assert.equal(containsAgeAmbiguityTerms("Use a teen character"), true);
  assert.equal(containsAgeAmbiguityTerms("Adults 21+ only"), false);
});
