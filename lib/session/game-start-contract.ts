import {
  buildDeterministicGameStart,
  detectDeterministicGameTemplateId,
  resolveDeterministicGameTemplateById,
  type DeterministicGameTemplateId,
} from "./game-script.ts";

export type GameStartContractInspection = {
  detected: boolean;
  templateId: DeterministicGameTemplateId;
  hasPlayablePrompt: boolean;
  hasRelationalDrift: boolean;
  usedFallbackStart: boolean;
};

const GAME_START_PATTERNS = [
  /\b(?:here(?:'s| is)|this is|next)\s+(?:the\s+)?(?:game|quiz|challenge)\b/i,
  /\banswer this question\b/i,
  /\b(?:for|earn)\s+points\b/i,
  /\brules are simple\b/i,
  /\bi pick\b/i,
  /\bwe are doing\b/i,
  /\b(?:starting|start)\s+(?:the\s+)?(?:game|quiz|challenge)\b/i,
];

const PLAYABLE_PROMPT_PATTERNS = [
  /\bfirst throw now\b/i,
  /\bchoose rock,\s*paper,\s*or scissors\b/i,
  /\bfirst guess now\b/i,
  /\bone number from 1 to 10\b/i,
  /\bpick one number from 1 to 10 now\b/i,
  /\brepeat this sequence exactly\b/i,
  /\briddle one:\b/i,
  /\bfirst prompt:\b/i,
  /\bfirst choice:\b/i,
  /\breply with digits only\b/i,
  /\b(?:first|next)\s+(?:question|prompt)\s*:\s*.+/i,
];

const RELATIONAL_DRIFT_PATTERNS = [
  /\btell me what you want\b/i,
  /\bwhat is on your mind\b/i,
  /\btalk to me\b/i,
  /\btell me about\b/i,
  /\bwhat do you want\b/i,
  /\bwhat part matters\b/i,
];

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function inspectGameStartContract(
  text: string,
  fallbackTemplateId: DeterministicGameTemplateId = "rps_streak",
): GameStartContractInspection {
  const normalized = normalize(text);
  const templateId = detectDeterministicGameTemplateId(normalized, fallbackTemplateId);
  const template = resolveDeterministicGameTemplateById(templateId);
  const detected = GAME_START_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasPlayablePrompt =
    PLAYABLE_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    normalize(template.firstTurnPrompt).length > 0 &&
      normalized.toLowerCase().includes(normalize(template.firstTurnPrompt).toLowerCase()) ||
    (/\?/.test(normalized) &&
      /\b(question|prompt|riddle|throw|pick|choose|answer|reply|digits only|what am i)\b/i.test(normalized));
  const hasRelationalDrift =
    detected &&
    RELATIONAL_DRIFT_PATTERNS.some((pattern) => pattern.test(normalized));
  return {
    detected,
    templateId,
    hasPlayablePrompt,
    hasRelationalDrift,
    usedFallbackStart: false,
  };
}

export function enforceGameStartContract(
  text: string,
  fallbackTemplateId: DeterministicGameTemplateId = "rps_streak",
): { text: string; inspection: GameStartContractInspection } {
  const inspection = inspectGameStartContract(text, fallbackTemplateId);
  if (!inspection.detected) {
    return {
      text,
      inspection,
    };
  }
  if (inspection.hasPlayablePrompt && !inspection.hasRelationalDrift) {
    return {
      text,
      inspection,
    };
  }
  return {
    text: buildDeterministicGameStart(inspection.templateId),
    inspection: {
      ...inspection,
      hasPlayablePrompt: true,
      hasRelationalDrift: false,
      usedFallbackStart: true,
    },
  };
}
