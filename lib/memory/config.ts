export const MEMORY_AUTO_SAVE_STORAGE_KEY = "raven.memory.auto_save";
export const DEFAULT_MEMORY_AUTO_SAVE = false;

export function loadMemoryAutoSave(storage: Storage | null | undefined): boolean {
  if (!storage) {
    return DEFAULT_MEMORY_AUTO_SAVE;
  }
  const raw = storage.getItem(MEMORY_AUTO_SAVE_STORAGE_KEY);
  if (raw == null) {
    return DEFAULT_MEMORY_AUTO_SAVE;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

export function saveMemoryAutoSave(storage: Storage | null | undefined, enabled: boolean): void {
  if (!storage) {
    return;
  }
  storage.setItem(MEMORY_AUTO_SAVE_STORAGE_KEY, enabled ? "1" : "0");
}
