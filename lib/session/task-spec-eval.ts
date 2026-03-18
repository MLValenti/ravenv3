import type { TaskCandidate } from "./task-spec.ts";

export type TaskSpecTranscriptTurn = {
  role: "user" | "raven";
  text: string;
};

export type TaskSpecEvalResult = {
  novelty: number;
  naturalness: number;
  repetition: number;
  constraintInfluence: number;
  collaboration: number;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function overlapScore(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let hit = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      hit += 1;
    }
  }
  return hit / Math.max(leftTokens.size, rightTokens.size);
}

export function evaluateTaskSpecTranscript(input: {
  transcript: TaskSpecTranscriptTurn[];
  selectedCandidate: TaskCandidate;
  userConstraintText: string;
}): TaskSpecEvalResult {
  const ravenTurns = input.transcript.filter((turn) => turn.role === "raven").map((turn) => turn.text);
  const uniqueRavenTurns = new Set(ravenTurns.map((turn) => normalize(turn)));
  const repeatedCount = Math.max(0, ravenTurns.length - uniqueRavenTurns.size);
  const finalReply = ravenTurns[ravenTurns.length - 1] ?? "";
  const asksCollaboratively = /\b(i have|i worked through|cleanest fit|strongest fit|this one gives you|i tightened this)\b/i.test(
    finalReply,
  )
    ? 1
    : 0.5;
  const naturalness =
    /\bwhat kind of task|how long|what items\b/i.test(finalReply) ||
    !/\b(it fits because|what i am watching for)\b/i.test(finalReply)
      ? 0.45
      : 0.85;
  const constraintInfluence = Math.max(
    overlapScore(input.userConstraintText, finalReply),
    overlapScore(input.userConstraintText, input.selectedCandidate.why_it_fits),
  );
  return {
    novelty: input.selectedCandidate.validation.novelty_score,
    naturalness,
    repetition: Number((1 - repeatedCount / Math.max(1, ravenTurns.length)).toFixed(3)),
    constraintInfluence: Number(constraintInfluence.toFixed(3)),
    collaboration: asksCollaboratively,
  };
}
