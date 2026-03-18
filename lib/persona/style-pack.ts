export type PersonaStylePack = {
  id: string;
  name: string;
  version: string;
  updated_at: string;
  style_rules: {
    must: string[];
    avoid: string[];
    voice_markers: string[];
  };
  examples: string[];
};

function cleanLine(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function cleanLines(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  const lines: string[] = [];
  for (const item of value) {
    const line = cleanLine(item, maxLength);
    if (!line) {
      continue;
    }
    const key = line.toLowerCase();
    if (deduped.has(key)) {
      continue;
    }
    deduped.add(key);
    lines.push(line);
    if (lines.length >= maxItems) {
      break;
    }
  }
  return lines;
}

export function normalizePersonaStylePack(raw: unknown): PersonaStylePack | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as {
    id?: unknown;
    name?: unknown;
    version?: unknown;
    updated_at?: unknown;
    style_rules?: unknown;
    examples?: unknown;
  };

  const id = cleanLine(candidate.id, 64);
  const name = cleanLine(candidate.name, 120);
  const version = cleanLine(candidate.version, 24);
  const updatedAt = cleanLine(candidate.updated_at, 40);
  if (!id || !name || !version || !updatedAt) {
    return null;
  }

  const rulesSource =
    candidate.style_rules && typeof candidate.style_rules === "object"
      ? (candidate.style_rules as {
          must?: unknown;
          avoid?: unknown;
          voice_markers?: unknown;
        })
      : null;

  const must = cleanLines(rulesSource?.must, 12, 180);
  const avoid = cleanLines(rulesSource?.avoid, 12, 180);
  const voiceMarkers = cleanLines(rulesSource?.voice_markers, 12, 120);
  const examples = cleanLines(candidate.examples, 8, 220);

  return {
    id,
    name,
    version,
    updated_at: updatedAt,
    style_rules: {
      must,
      avoid,
      voice_markers: voiceMarkers,
    },
    examples,
  };
}

export function buildPersonaPackSystemMessage(pack: PersonaStylePack): string {
  const mustLines =
    pack.style_rules.must.length > 0
      ? pack.style_rules.must.map((line) => `- ${line}`).join("\n")
      : "- none";
  const avoidLines =
    pack.style_rules.avoid.length > 0
      ? pack.style_rules.avoid.map((line) => `- ${line}`).join("\n")
      : "- none";
  const markerLine =
    pack.style_rules.voice_markers.length > 0
      ? pack.style_rules.voice_markers.join(", ")
      : "none";
  const examplesBlock =
    pack.examples.length > 0
      ? pack.examples.map((line) => `- ${line}`).join("\n")
      : "- none";

  return [
    `Persona pack: ${pack.name} (${pack.id}) v${pack.version}`,
    `Updated: ${pack.updated_at}`,
    "Apply these style rules consistently.",
    "Must:",
    mustLines,
    "Avoid:",
    avoidLines,
    `Voice markers: ${markerLine}`,
    "Style examples:",
    examplesBlock,
  ].join("\n");
}

