import type { ConversationStateSnapshot } from "./conversation-state.ts";
import { detectStaleResponseReuse } from "./repetition.ts";

export type EvaluatedTurn = {
  user: string;
  raven: string;
};

export type ConversationEvalReport = {
  continuity: number;
  topical_relevance: number;
  repetition_rate: number;
  memory_recall_accuracy: number;
  coherence: number;
  humanlike_flow: number;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(/\s+/).filter((token) => token.length >= 4));
  const rightTokens = new Set(normalize(right).split(/\s+/).filter((token) => token.length >= 4));
  if (leftTokens.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / leftTokens.size;
}

export function evaluateConversationTranscript(input: {
  turns: EvaluatedTurn[];
  state: ConversationStateSnapshot;
}): ConversationEvalReport {
  const recentReplies: string[] = [];
  let relevanceScore = 0;
  let repetitionHits = 0;
  const stateTopic = input.state.active_topic !== "none" ? input.state.active_topic : "";
  const entitySeed = input.state.important_entities.slice(0, 4).join(" ");

  for (const turn of input.turns) {
    relevanceScore += Math.max(
      tokenOverlap(turn.user, turn.raven),
      tokenOverlap(stateTopic, turn.raven),
      tokenOverlap(entitySeed, turn.raven),
    );
    const repetition = detectStaleResponseReuse(turn.raven, recentReplies);
    if (repetition.repeated) {
      repetitionHits += 1;
    }
    recentReplies.push(turn.raven);
  }

  const turnCount = Math.max(1, input.turns.length);
  const continuity = input.state.open_loops.length > 0 || input.state.active_topic !== "none" ? 0.9 : 0.5;
  const topicalRelevance = Number((relevanceScore / turnCount).toFixed(3));
  const repetitionRate = Number((repetitionHits / turnCount).toFixed(3));
  const memoryRecallAccuracy =
    input.state.recent_facts_from_user.length > 0 || input.state.user_goal ? 0.9 : 0.75;
  const coherence = Number(
    Math.max(
      0,
      Math.min(1, continuity * 0.4 + topicalRelevance * 0.2 + memoryRecallAccuracy * 0.4),
    ).toFixed(3),
  );
  const humanlikeFlow = Number(Math.max(0, Math.min(1, coherence - repetitionRate * 0.5)).toFixed(3));

  return {
    continuity: Number(continuity.toFixed(3)),
    topical_relevance: topicalRelevance,
    repetition_rate: repetitionRate,
    memory_recall_accuracy: Number(memoryRecallAccuracy.toFixed(3)),
    coherence,
    humanlike_flow: humanlikeFlow,
  };
}
