import { extractMemorySuggestions, type MemorySuggestionCandidate } from "./extract.ts";

export type MemoryCandidate = {
  key: string;
  value: string;
  tags: string[];
  confidence: number;
  importance: number;
  stability: number;
  type: MemorySuggestionCandidate["type"];
  rationale: string;
};

export function extractMemoryCandidates(text: string): MemoryCandidate[] {
  return extractMemorySuggestions(text).map((candidate) => ({
    key: candidate.key,
    value: candidate.value,
    tags: candidate.tags,
    confidence: candidate.confidence,
    importance: candidate.importance,
    stability: candidate.stability,
    type: candidate.type,
    rationale: candidate.rationale,
  }));
}
