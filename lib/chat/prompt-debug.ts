export type PromptDebugEntry = {
  sessionId: string;
  timestamp: number;
  stateSnapshot: string;
  responseStrategy: string;
  promptSizeEstimate: number;
  includedTurns: Array<{ role: string; content: string; reason: string }>;
  excludedTurns: Array<{ role: string; content: string; reason: string }>;
  includedContext: string[];
  assembledPromptPreview: string[];
};

const promptDebugBySession = new Map<string, PromptDebugEntry>();

export function setPromptDebugEntry(entry: PromptDebugEntry): void {
  promptDebugBySession.set(entry.sessionId, entry);
}

export function getPromptDebugEntry(sessionId: string): PromptDebugEntry | null {
  return promptDebugBySession.get(sessionId) ?? null;
}
