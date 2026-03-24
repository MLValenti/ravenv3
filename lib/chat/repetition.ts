function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitWords(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function firstNWords(text: string, count: number): string {
  return splitWords(text).slice(0, count).join(" ");
}

function overlappingTriGramCount(left: string, right: string): number {
  const leftWords = splitWords(left);
  const rightWords = new Set(
    Array.from({ length: Math.max(0, splitWords(right).length - 2) }, (_, index) =>
      splitWords(right)
        .slice(index, index + 3)
        .join(" "),
    ),
  );
  let matches = 0;
  for (let index = 0; index <= leftWords.length - 3; index += 1) {
    const triGram = leftWords.slice(index, index + 3).join(" ");
    if (rightWords.has(triGram)) {
      matches += 1;
    }
  }
  return matches;
}

export function detectStaleResponseReuse(
  text: string,
  recentAssistantReplies: string[],
): { repeated: boolean; reason: string } {
  const normalized = normalize(text);
  if (!normalized) {
    return { repeated: false, reason: "empty" };
  }
  const opening = firstNWords(text, 4);
  for (const previous of recentAssistantReplies.slice(-3)) {
    const normalizedPrevious = normalize(previous);
    if (!normalizedPrevious) {
      continue;
    }
    if (normalized === normalizedPrevious) {
      return { repeated: true, reason: "exact_match" };
    }
    if (opening && opening === firstNWords(previous, 4)) {
      return { repeated: true, reason: "opening_match" };
    }
    if (overlappingTriGramCount(text, previous) >= 2) {
      return { repeated: true, reason: "phrase_reuse" };
    }
  }
  return { repeated: false, reason: "fresh" };
}

export function shouldPreserveAnsweredQuestionAgainstRepetitionFallback(input: {
  repetitionCheck: { repeated: boolean; reason: string };
  turnPlanRequiredMove: string;
  turnPlanCheck: { ok: boolean; reason: string };
}): boolean {
  if (!input.repetitionCheck.repeated) {
    return false;
  }

  if (input.turnPlanRequiredMove !== "answer_user_question" || !input.turnPlanCheck.ok) {
    return false;
  }

  if (!input.turnPlanCheck.reason.endsWith("question_answered")) {
    return false;
  }

  return input.repetitionCheck.reason !== "exact_match";
}
