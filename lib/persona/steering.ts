export type PersonaIntensity = "low" | "medium" | "high";

export type PersonaSteeringSettings = {
  directive: string;
  avoid: string;
  examples: string;
  addressTerm: string;
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

function splitLines(value: string, maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim().replace(/\s+/g, " ").slice(0, maxLength);
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

export function normalizePersonaSteering(raw: unknown): PersonaSteeringSettings {
  const source =
    raw && typeof raw === "object"
      ? (raw as {
          directive?: unknown;
          avoid?: unknown;
          examples?: unknown;
          addressTerm?: unknown;
          intensity?: unknown;
        })
      : null;

  const intensity =
    source?.intensity === "low" || source?.intensity === "high" ? source.intensity : "medium";

  return {
    directive: cleanText(source?.directive, 400),
    avoid: cleanText(source?.avoid, 320),
    examples: cleanText(source?.examples, 700),
    addressTerm: cleanAddressTerm(source?.addressTerm),
    intensity,
  };
}

function buildIntensityGuidance(intensity: PersonaIntensity): string {
  if (intensity === "high") {
    return "Steering intensity: high. Prioritize these cues consistently over softer default phrasing.";
  }
  if (intensity === "low") {
    return "Steering intensity: low. Use these cues lightly without forcing them into every turn.";
  }
  return "Steering intensity: medium. Apply these cues consistently, but keep the reply natural.";
}

export function buildPersonaSteeringSystemMessage(input: PersonaSteeringSettings): string | null {
  const exampleLines = splitLines(input.examples, 6, 180);
  const avoidLines = splitLines(input.avoid, 4, 160);

  if (
    !input.directive &&
    !input.addressTerm &&
    exampleLines.length === 0 &&
    avoidLines.length === 0
  ) {
    return null;
  }

  return [
    "Operator persona steering:",
    "- This steering is authored locally and should override softer defaults when it does not conflict with safety or current task state.",
    `- ${buildIntensityGuidance(input.intensity)}`,
    ...(input.directive ? [`- Desired Raven impression: ${input.directive}`] : []),
    ...(input.addressTerm
      ? [`- Preferred user address term: ${input.addressTerm}. Use it only when it fits naturally.`]
      : []),
    ...(avoidLines.length > 0
      ? ["Avoid these misses:", ...avoidLines.map((line) => `- ${line}`)]
      : []),
    ...(exampleLines.length > 0
      ? ["Reference lines:", ...exampleLines.map((line) => `- ${line}`)]
      : []),
  ].join("\n");
}
