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

function hasMeaningfulText(value: string | null | undefined): boolean {
  return typeof value === "string" && normalize(value) !== "" && normalize(value) !== "none";
}

function computeTranscriptLinkage(turns: EvaluatedTurn[]): number {
  if (turns.length <= 1) {
    return 0;
  }

  let total = 0;
  let comparisons = 0;
  for (let index = 1; index < turns.length; index += 1) {
    const current = turns[index];
    const previous = turns[index - 1];
    total += Math.max(
      tokenOverlap(previous.raven, current.raven),
      tokenOverlap(previous.raven, current.user),
      tokenOverlap(previous.user, current.raven),
    );
    comparisons += 1;
  }

  return comparisons > 0 ? Number((total / comparisons).toFixed(3)) : 0;
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
  const transcriptLinkage = computeTranscriptLinkage(input.turns);
  let continuity = 0.35;
  if (hasMeaningfulText(input.state.active_topic)) {
    continuity += 0.25;
  }
  if (input.state.open_loops.length > 0 || input.state.unanswered_questions.length > 0) {
    continuity += 0.22;
  }
  if (hasMeaningfulText(input.state.pending_user_request)) {
    continuity += 0.15;
  }
  if (input.state.important_entities.length > 0) {
    continuity += 0.1;
  }
  if (input.state.rolling_summary.recent_topic_history.length > 0) {
    continuity += 0.07;
  }
  if (input.state.recent_window.length >= 4) {
    continuity += 0.08;
  }
  if (hasMeaningfulText(input.state.active_thread)) {
    continuity += 0.03;
  }
  if (input.state.current_mode !== "normal_chat") {
    continuity += 0.06;
  }
  if (hasMeaningfulText(input.state.last_satisfied_request)) {
    continuity += 0.06;
  }
  if (hasMeaningfulText(input.state.last_assistant_claim)) {
    continuity += 0.05;
  }
  continuity = Math.max(continuity, Math.min(0.9, 0.45 + transcriptLinkage));
  continuity = Number(Math.min(1, continuity).toFixed(3));
  const topicalRelevance = Number((relevanceScore / turnCount).toFixed(3));
  const repetitionRate = Number((repetitionHits / turnCount).toFixed(3));
  const memoryRecallAccuracy =
    input.state.recent_facts_from_user.length > 0 || input.state.user_goal
      ? 0.9
      : input.state.important_entities.length > 0 ||
          input.state.rolling_summary.important_entities.length > 0 ||
          hasMeaningfulText(input.state.last_satisfied_request) ||
          input.state.recent_window.length >= 4
        ? 0.85
        : 0.75;
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
