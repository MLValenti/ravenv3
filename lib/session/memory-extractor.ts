import type { ProfileState } from "../profile";

function clean(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:to\s+)/i, "")
    .replace(/[.?!]+$/g, "");
}

function extractName(input: string): string | null {
  const patterns = [
    /\bmy name is\s+([a-z][a-z'-]{1,24})\b/i,
    /\bcall me\s+([a-z][a-z'-]{1,24})\b/i,
    /\bmy name'?s\s+([a-z][a-z'-]{1,24})\b/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return clean(match[1]);
    }
  }
  return null;
}

function extractPreferredPace(input: string): string | null {
  if (/\b(slower|slow down|take it slow|take it slower|go slow)\b/i.test(input)) {
    return "slow";
  }
  if (/\b(faster|speed up|pick up the pace|go faster|move faster)\b/i.test(input)) {
    return "fast";
  }
  if (/\b(normal|steady|medium|even pace|measured)\b/i.test(input)) {
    return "normal";
  }
  return null;
}

function extractPreferredStyle(input: string): string | null {
  const stylePatterns: Array<[RegExp, string]> = [
    [/\b(short lines|short answers|brief answers|keep it brief|keep it short)\b/i, "short lines"],
    [/\b(gentle|softer|soft)\b/i, "gentle"],
    [/\b(direct|more direct|blunt)\b/i, "direct"],
    [/\b(strict|stricter|firm)\b/i, "strict"],
    [/\b(playful)\b/i, "playful"],
    [/\b(clinical|colder|cold)\b/i, "clinical"],
    [/\b(warm|warmer)\b/i, "warm"],
  ];
  for (const [pattern, value] of stylePatterns) {
    if (pattern.test(input)) {
      return value;
    }
  }
  return null;
}

function extractLikes(input: string): string | null {
  return (
    extractAfterPhrase(input, /\bi like to\s+([^.!?]{2,80})/i) ??
    extractAfterPhrase(input, /\bi like\s+([^.!?]{2,80})/i) ??
    extractAfterPhrase(input, /\bi enjoy\s+([^.!?]{2,80})/i) ??
    extractAfterPhrase(input, /\bi(?:'m| am) into\s+([^.!?]{2,80})/i) ??
    extractAfterPhrase(input, /\bmy hobbies are\s+([^.!?]{2,100})/i) ??
    extractAfterPhrase(input, /\bmy hobby is\s+([^.!?]{2,80})/i)
  );
}

function extractIntensity(input: string): string | null {
  if (/\b(light|lighter|low intensity|easy)\b/i.test(input)) {
    return "light";
  }
  if (/\b(medium|moderate)\b/i.test(input)) {
    return "medium";
  }
  if (/\b(harder|hard|high intensity|intense)\b/i.test(input)) {
    return "high";
  }
  return null;
}

function extractSafeword(input: string): string | null {
  const patterns = [
    /\bsafeword is\s+([a-z0-9_-]{2,24})\b/i,
    /\buse\s+([a-z0-9_-]{2,24})\s+as my safeword\b/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return clean(match[1]);
    }
  }
  return null;
}

function extractAfterPhrase(input: string, phrase: RegExp): string | null {
  const match = input.match(phrase);
  return match?.[1] ? clean(match[1]) : null;
}

export function extractStableFactsFromResponse(text: string): ProfileState {
  const normalized = clean(text);
  const facts: ProfileState = {};

  const name = extractName(normalized);
  if (name) {
    facts.name = name;
  }

  const pace = extractPreferredPace(normalized);
  if (pace) {
    facts.preferred_pace = pace;
  }

  const style = extractPreferredStyle(normalized);
  if (style) {
    facts.preferred_style = style;
  }

  const intensity = extractIntensity(normalized);
  if (intensity) {
    facts.intensity = intensity;
  }

  const safeword = extractSafeword(normalized);
  if (safeword) {
    facts.safeword = safeword;
  }

  const likes = extractLikes(normalized);
  if (likes) {
    facts.likes = likes;
  }

  const dislikes =
    extractAfterPhrase(normalized, /\b(?:i don't like|i do not like|dislike)\s+([^.!?]{2,80})/i) ??
    extractAfterPhrase(normalized, /\bi hate\s+([^.!?]{2,80})/i) ??
    extractAfterPhrase(normalized, /\bi(?:'m| am) not into\s+([^.!?]{2,80})/i);
  if (dislikes) {
    facts.dislikes = dislikes;
  }

  const limits =
    extractAfterPhrase(normalized, /\b(?:my limits are|limit is|limits are)\s+([^.!?]{2,120})/i) ??
    extractAfterPhrase(normalized, /\b(?:hard limit is|hard limits are)\s+([^.!?]{2,120})/i) ??
    extractAfterPhrase(normalized, /\b(?:no|avoid)\s+([^.!?]{2,120})/i);
  if (limits) {
    facts.limits = limits;
  }

  return facts;
}

export function updateMemorySummary(previous: string | undefined, facts: ProfileState): string {
  const nextEntries = [
    facts.name ? `name: ${facts.name}` : "",
    facts.likes ? `likes: ${facts.likes}` : "",
    facts.dislikes ? `dislikes: ${facts.dislikes}` : "",
    facts.limits ? `limits: ${facts.limits}` : "",
    facts.preferred_style ? `style: ${facts.preferred_style}` : "",
    facts.preferred_pace ? `pace: ${facts.preferred_pace}` : "",
    facts.intensity ? `intensity: ${facts.intensity}` : "",
    facts.safeword ? `safeword: ${facts.safeword}` : "",
  ].filter(Boolean);
  if (!nextEntries.length) {
    return previous ? previous.trim() : "";
  }
  const entries = [
    ...(previous
      ? previous
          .split(" | ")
          .map((item) => clean(item))
          .filter(Boolean)
      : []),
    ...nextEntries,
  ];
  const unique = Array.from(new Set(entries));
  return unique.slice(-4).join(" | ");
}
