export const PROFILE_STORAGE_KEY = "raven.profile";

export type ProfileKey =
  | "safeword"
  | "limits"
  | "intensity"
  | "preferred_style"
  | "preferred_pace"
  | "name"
  | "likes"
  | "dislikes"
  | "memory_summary";

export type ProfileState = Partial<Record<ProfileKey, string>>;

export const PROFILE_KEYS: ProfileKey[] = [
  "safeword",
  "limits",
  "intensity",
  "preferred_style",
  "preferred_pace",
  "name",
  "likes",
  "dislikes",
  "memory_summary",
];

export function sanitizeProfileValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProfileInput(input: unknown): ProfileState {
  if (!input || typeof input !== "object") {
    return {};
  }

  const raw = input as Record<string, unknown>;
  const output: ProfileState = {};

  for (const key of PROFILE_KEYS) {
    const value = sanitizeProfileValue(raw[key]);
    if (value) {
      output[key] = value;
    }
  }

  return output;
}

export function loadProfileFromStorage(storage: Storage | null | undefined): ProfileState {
  if (!storage) {
    return {};
  }

  const raw = storage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeProfileInput(JSON.parse(raw));
  } catch {
    return {};
  }
}
