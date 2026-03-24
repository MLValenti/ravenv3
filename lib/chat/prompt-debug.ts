export type PromptDebugEntry = {
  sessionId: string;
  timestamp: number;
  promptProfile?: string;
  promptRouteMode?: string;
  stateSnapshot: string;
  responseStrategy: string;
  promptSizeEstimate: number;
  includedTurns: Array<{ role: string; content: string; reason: string }>;
  excludedTurns: Array<{ role: string; content: string; reason: string }>;
  includedContext: string[];
  assembledPromptPreview: string[];
  assembledPromptMessages?: Array<{ role: string; content: string }>;
  modelTrace?: {
    rawModelOutput: string;
    shapedOutput: string;
    finalAssistantOutput: string;
    shapeReason: string | null;
    finalOutputSource: string;
    preservedModelVoice: boolean;
    criticReasons: string[];
    appCandidates: Array<{
      source: string;
      text: string | null;
      selected: boolean;
    }>;
  };
};

const promptDebugBySession = new Map<string, PromptDebugEntry>();

export function setPromptDebugEntry(entry: PromptDebugEntry): void {
  promptDebugBySession.set(entry.sessionId, entry);
}

export function getPromptDebugEntry(sessionId: string): PromptDebugEntry | null {
  return promptDebugBySession.get(sessionId) ?? null;
}
