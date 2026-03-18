export type JudgeChecks = {
  answered_last_message: boolean;
  continuity: boolean;
  in_character: boolean;
  non_repetitive: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreJudgeChecks(checks: JudgeChecks, issueCount: number): number {
  let score = 0;
  if (checks.answered_last_message) {
    score += 35;
  }
  if (checks.continuity) {
    score += 25;
  }
  if (checks.in_character) {
    score += 25;
  }
  if (checks.non_repetitive) {
    score += 15;
  }

  score -= Math.max(0, issueCount) * 4;
  score = clamp(score, 0, 100);

  if (!checks.answered_last_message) {
    score = Math.min(score, 69);
  }
  if (!checks.continuity) {
    score = Math.min(score, 64);
  }
  if (!checks.in_character) {
    score = Math.min(score, 54);
  }
  if (!checks.non_repetitive) {
    score = Math.min(score, 79);
  }

  return Math.round(clamp(score, 0, 100));
}

