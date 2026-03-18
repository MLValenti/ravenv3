export type PreferredStyle = "gentle" | "direct" | "playful";

export type ConsentState = {
  confirmedAdults: boolean;
  safeWord: string;
  limits: string;
  preferredStyle: PreferredStyle;
};

export const CONSENT_STORAGE_KEY = "raven.consent";

export const DEFAULT_CONSENT_STYLE: PreferredStyle = "gentle";

export const ADULT_CONSENT_SYSTEM_MESSAGE =
  "Safety policy: all participants are consenting adults age 21+. No minors, no age ambiguity, and no school context are allowed. Explicit consent is required for all activity and anyone can stop at any time. Refuse any request involving minors, age ambiguity, school context, or non-consent, and ask the user to rephrase with clearly adult-only consensual context.";

const AGE_AMBIGUITY_PATTERNS = [
  /\bminor(s)?\b/i,
  /\bunder[\s-]?age(d)?\b/i,
  /\bteen(ager|s)?\b/i,
  /\bchild(ren)?\b/i,
  /\bkid(s)?\b/i,
  /\bschool(girl|boy)\b/i,
  /\bhigh school\b/i,
  /\bmiddle school\b/i,
  /\bgrade school\b/i,
  /\byoung\s*(looking|girl|boy)?\b/i,
  /\bbarely legal\b/i,
  /\bage[\s-]?play\b/i,
  /\bloli\b/i,
  /\bjailbait\b/i,
];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePreferredStyle(value: unknown): PreferredStyle {
  if (value === "gentle" || value === "direct" || value === "playful") {
    return value;
  }

  return DEFAULT_CONSENT_STYLE;
}

export function isConsentComplete(value: unknown): value is ConsentState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const consent = value as Partial<ConsentState>;
  const safeWord = normalizeText(consent.safeWord);
  const limits = normalizeText(consent.limits);
  const style = normalizePreferredStyle(consent.preferredStyle);

  return consent.confirmedAdults === true && safeWord.length > 0 && limits.length > 0 && !!style;
}

export function loadConsentFromStorage(storage: Storage | null | undefined): ConsentState | null {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(CONSENT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    const candidate: ConsentState = {
      confirmedAdults: parsed.confirmedAdults === true,
      safeWord: normalizeText(parsed.safeWord),
      limits: normalizeText(parsed.limits),
      preferredStyle: normalizePreferredStyle(parsed.preferredStyle),
    };

    return isConsentComplete(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function containsAgeAmbiguityTerms(input: string): boolean {
  return AGE_AMBIGUITY_PATTERNS.some((pattern) => pattern.test(input));
}
