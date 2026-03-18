import { normalizePersonaStylePack, type PersonaStylePack } from "./style-pack.ts";

const DOMINANT_MARKERS = [
  "pet",
  "good",
  "listen carefully",
  "eyes on me",
  "stay sharp",
  "focus",
  "hold",
  "obey",
  "no excuses",
];

const IMPERATIVE_OPENERS = [
  /^(?:['"])?(?:eyes on me|listen carefully|stay sharp|keep focus|focus|stand|kneel|get|show|tell|hold|look|answer|report|stay)\b/i,
  /^(?:['"])?(?:on your knees|pay attention|come here|speak clearly)\b/i,
];

const NARRATIVE_CUES = [
  /\bas i\b/i,
  /\bi told\b/i,
  /\bi rose\b/i,
  /\bi took\b/i,
  /\bi (?:walked|looked|returned|responded|replied|felt|thought|started|woke|wondered)\b/i,
  /\bthe apartment\b/i,
  /\bthe hotel\b/i,
  /\bthe pub\b/i,
  /\bthe tube station\b/i,
  /\bshe was\b/i,
  /\bhe was\b/i,
  /\bmy cock\b/i,
  /\bmy jeans\b/i,
  /\bmy panties\b/i,
  /\bthe camera\b/i,
];

function canonicalizeExampleLine(line: string): string {
  const trimmed = line.trim().replace(/\s+/g, " ");
  if (!/^[\'"]/.test(trimmed)) {
    return trimmed;
  }

  const withoutLeadQuote = trimmed.slice(1);
  const closingIndexCandidates = [",'", ".'", "!'", "?'", ',"', '."', '!"', '?"']
    .map((token) => withoutLeadQuote.indexOf(token))
    .filter((index) => index >= 0);

  if (closingIndexCandidates.length === 0) {
    return withoutLeadQuote;
  }

  const closingIndex = Math.min(...closingIndexCandidates);
  return withoutLeadQuote.slice(0, closingIndex + 1).trim();
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

export function splitSourceSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/[.!?]\s+/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length >= 12);
}

export function rankVoiceMarkers(text: string): string[] {
  const normalized = text.toLowerCase();
  return DOMINANT_MARKERS.map((marker) => ({
    marker,
    score: (normalized.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [])
      .length,
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.marker);
}

function exampleScore(line: string): number {
  const normalized = line.toLowerCase();
  let score = 0;

  score += DOMINANT_MARKERS.reduce(
    (total, marker) => total + (normalized.includes(marker) ? 3 : 0),
    0,
  );
  if (/['"]/.test(line)) {
    score += 3;
  }
  if (/\b(you|your)\b/i.test(line)) {
    score += 3;
  }
  if (IMPERATIVE_OPENERS.some((pattern) => pattern.test(line))) {
    score += 4;
  }
  if (/\b(?:mistress|sissy|sub|toy)\b/i.test(line)) {
    score += 2;
  }
  if (!/['"]/.test(line) && !/\b(you|your)\b/i.test(line)) {
    score -= 2;
  }
  if (NARRATIVE_CUES.some((pattern) => pattern.test(line))) {
    score -= 4;
  }

  return score;
}

export function pickPersonaExamples(sentences: string[]): string[] {
  const ranked = sentences
    .map((line) => canonicalizeExampleLine(line))
    .filter((line) => line.length >= 20 && line.length <= 180)
    .map((line) => ({ line, score: exampleScore(line) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.line.length - b.line.length;
    });

  const examples: string[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const normalized = item.line.toLowerCase().replace(/['"]/g, "");
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    examples.push(item.line);
    if (examples.length >= 6) {
      break;
    }
  }
  return examples;
}

export function buildPersonaStylePackFromTexts(input: {
  id: string;
  name: string;
  texts: string[];
}): PersonaStylePack {
  if (input.texts.length === 0) {
    throw new Error("No source texts provided");
  }

  const allText = input.texts.join("\n");
  const markers = rankVoiceMarkers(allText);
  const examples = pickPersonaExamples(splitSourceSentences(allText));

  const pack: PersonaStylePack = {
    id: sanitizeId(input.id) || "custom",
    name: input.name.trim() || "Custom Persona Pack",
    version: "1.0.0",
    updated_at: new Date().toISOString().slice(0, 10),
    style_rules: {
      must: [
        "Acknowledge the user message directly in the first line",
        "Keep turns concise and in character",
        "Use decisive language and clear control",
        "Ask at most one question per turn",
      ],
      avoid: [
        "Do not mention being an AI, model, bot, or system",
        "Do not use generic support, therapy, or mindfulness language",
        "Do not repeat the same phrase across adjacent turns",
      ],
      voice_markers: markers.length > 0 ? markers : ["pet", "listen carefully", "stay sharp"],
    },
    examples,
  };

  const normalized = normalizePersonaStylePack(pack);
  if (!normalized) {
    throw new Error("Failed to normalize generated persona pack");
  }
  return normalized;
}
