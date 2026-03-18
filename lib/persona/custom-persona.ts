import {
  buildPersonaSteeringSystemMessage,
  normalizePersonaSteering,
  type PersonaIntensity,
  type PersonaSteeringSettings,
} from "./steering.ts";
import { normalizePersonaStylePack, type PersonaStylePack } from "./style-pack.ts";
import { rankVoiceMarkers } from "./style-pack-builder.ts";

export type CustomPersonaSpec = {
  id: "custom";
  name: string;
  version: string;
  updated_at: string;
  directive: string;
  avoid: string[];
  examples: string[];
  address_term: string;
  intensity: PersonaIntensity;
};

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .slice(0, maxLength);
}

function cleanAddressTerm(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

function cleanLines(value: unknown, maxItems: number, maxLength: number): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of source) {
    const line = cleanText(item, maxLength);
    if (!line) {
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push(line);
    if (lines.length >= maxItems) {
      break;
    }
  }
  return lines;
}

export const DEFAULT_CUSTOM_PERSONA_SPEC: CustomPersonaSpec = {
  id: "custom",
  name: "Custom Raven",
  version: "1.0.0",
  updated_at: "2026-03-09",
  directive:
    "Controlled, clipped, direct, and slightly severe. Raven answers first, avoids filler, and stays precise without turning chatty or therapeutic.",
  avoid: [
    "Do not sound like generic customer support.",
    "Do not use therapy, mindfulness, or coaching language.",
    "Do not drift into soft small talk when a direct answer is needed.",
  ],
  examples: [
    "Eyes on me. Answer clearly.",
    "Listen carefully. I want one direct answer, not a ramble.",
    "You do not need to impress me. You need to be precise.",
    "Hold still. I verify first, then we continue.",
    "When you stall, I cut through it.",
    "You will report progress directly.",
  ],
  address_term: "",
  intensity: "medium",
};

export function normalizeCustomPersonaSpec(raw: unknown): CustomPersonaSpec {
  const source =
    raw && typeof raw === "object"
      ? (raw as {
          id?: unknown;
          name?: unknown;
          version?: unknown;
          updated_at?: unknown;
          directive?: unknown;
          avoid?: unknown;
          examples?: unknown;
          address_term?: unknown;
          intensity?: unknown;
        })
      : null;

  return {
    id: "custom",
    name: cleanText(source?.name, 120) || DEFAULT_CUSTOM_PERSONA_SPEC.name,
    version: cleanText(source?.version, 24) || DEFAULT_CUSTOM_PERSONA_SPEC.version,
    updated_at: cleanText(source?.updated_at, 40) || DEFAULT_CUSTOM_PERSONA_SPEC.updated_at,
    directive: cleanText(source?.directive, 500) || DEFAULT_CUSTOM_PERSONA_SPEC.directive,
    avoid: cleanLines(source?.avoid, 8, 180).slice(0, 8),
    examples: cleanLines(source?.examples, 12, 180).slice(0, 12),
    address_term: cleanAddressTerm(source?.address_term),
    intensity:
      source?.intensity === "low" || source?.intensity === "high" ? source.intensity : "medium",
  };
}

export function stampCustomPersonaSpec(
  spec: CustomPersonaSpec,
  updatedAt = new Date().toISOString().slice(0, 10),
): CustomPersonaSpec {
  return {
    ...spec,
    updated_at: updatedAt,
  };
}

export function buildCustomPersonaSteering(spec: CustomPersonaSpec): PersonaSteeringSettings {
  return normalizePersonaSteering({
    directive: spec.directive,
    avoid: spec.avoid.join("\n"),
    examples: spec.examples.join("\n"),
    addressTerm: spec.address_term,
    intensity: spec.intensity,
  });
}

export function buildCustomPersonaSteeringMessage(spec: CustomPersonaSpec): string | null {
  return buildPersonaSteeringSystemMessage(buildCustomPersonaSteering(spec));
}

export function buildCustomPersonaSourceText(spec: CustomPersonaSpec): string {
  return [spec.directive, ...spec.examples, ...spec.avoid.map((line) => `Avoid: ${line}`)]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function buildCustomPersonaPack(spec: CustomPersonaSpec): PersonaStylePack {
  const examples = cleanLines(spec.examples, 8, 180);
  const markerCorpus = [spec.directive, spec.address_term, ...examples].join("\n");
  const markers = rankVoiceMarkers(markerCorpus);

  const pack = normalizePersonaStylePack({
    id: "custom",
    name: spec.name,
    version: spec.version,
    updated_at: spec.updated_at,
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
        ...spec.avoid,
      ],
      voice_markers:
        markers.length > 0
          ? markers
          : spec.address_term
            ? [spec.address_term, "listen carefully", "eyes on me"]
            : ["listen carefully", "eyes on me", "stay sharp"],
    },
    examples,
  });

  if (!pack) {
    throw new Error("Failed to normalize custom persona pack");
  }
  return pack;
}
