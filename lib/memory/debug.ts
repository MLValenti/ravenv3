type MemoryDebugEntry = {
  sessionId: string;
  timestamp: number;
  extractedCandidates: Array<{
    key: string;
    value: string;
    type: string;
    importance: number;
    stability: number;
    confidence: number;
    rationale: string;
  }>;
  pendingSuggestions: Array<{ id: string; key: string; value: string; status: string }>;
  retrievedMemories: Array<{ id: string; key: string; value: string; type: string }>;
  injectedMemoryBlock: string;
};

const MAX_DEBUG_ENTRIES = 40;
const debugBySession = new Map<string, MemoryDebugEntry>();

export function setMemoryDebugEntry(entry: MemoryDebugEntry): void {
  debugBySession.set(entry.sessionId, entry);
  if (debugBySession.size <= MAX_DEBUG_ENTRIES) {
    return;
  }
  const oldest = [...debugBySession.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (let index = 0; index < oldest.length - MAX_DEBUG_ENTRIES; index += 1) {
    debugBySession.delete(oldest[index][0]);
  }
}

export function getMemoryDebugEntry(sessionId: string): MemoryDebugEntry | null {
  return debugBySession.get(sessionId) ?? null;
}
