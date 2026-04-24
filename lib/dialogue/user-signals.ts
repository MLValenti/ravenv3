export type WagerDelegationMode = "none" | "all" | "user_win" | "raven_win";

export function normalizeUserText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hasStakeSignal(text: string): boolean {
  return /\b(stakes? (?:are|were)|what('?s| is) on the line|if i win|if you win|bet(?:ting)? on it|bet on the game|make a bet|make a wager|wager)\b/i.test(
    text,
  );
}

export function detectWagerDelegation(text: string): WagerDelegationMode {
  const normalized = normalizeUserText(text);
  if (
    /\bif i win\b[,:]?\s*(?:you|raven)\s+(?:can\s+)?(?:pick|choose|decide|set)\b/.test(normalized) ||
    /\bif i win\b[,:]?\s*(?:your|raven'?s)\s+choice\b/.test(normalized)
  ) {
    return "user_win";
  }
  if (
    /\bif you win\b[,:]?\s*(?:you|raven)\s+(?:can\s+)?(?:pick|choose|decide|set)\b/.test(normalized) ||
    /\bif you win\b[,:]?\s*(?:your|raven'?s)\s+choice\b/.test(normalized)
  ) {
    return "raven_win";
  }
  if (
    /\b(?:you|raven)\s+(?:pick|choose|decide|set)\s+(?:what happens\s+)?if i win\b/.test(normalized)
  ) {
    return "user_win";
  }
  if (
    /\b(?:you|raven)\s+(?:pick|choose|decide|set)\s+(?:what happens\s+)?if you win\b/.test(normalized)
  ) {
    return "raven_win";
  }
  if (
    /\b(?:you|raven)\s+(?:pick|choose|decide|set)\s+(?:the\s+)?(?:bet|wager|stakes|terms)\b/.test(normalized) ||
    /\b(?:you pick|you choose|you decide)\s+(?:the\s+)?(?:bet|wager|stakes|terms)\b/.test(normalized)
  ) {
    return "all";
  }
  if (
    /\bwhat do you want if you win\b/.test(normalized) ||
    /\bwhat happens if you win\b/.test(normalized) ||
    /\bwhat do you want if i win\b/.test(normalized) ||
    /\bwhat happens if i win\b/.test(normalized)
  ) {
    return "all";
  }
  if (
    /\bcare to make a wager\b/.test(normalized) ||
    /\bwant to make a wager\b/.test(normalized) ||
    /\bcare to make a bet\b/.test(normalized)
  ) {
    return "all";
  }
  return "none";
}

export function wantsAnotherRound(text: string): boolean {
  return /\b(again|another round|play again|next round)\b/i.test(text);
}

export function isGameChoiceDelegation(text: string): boolean {
  return /\b(you pick|you choose|your choice|your call|dealer'?s choice|surprise me|pick for me|choose for me|whatever you pick|whatever you choose)\b/i.test(
    text,
  );
}

export function isGameStartCue(text: string): boolean {
  return /\b(ok(ay)?\s+)?(let'?s start|lets start|i am ready|i'm ready|im ready|start now)\b/i.test(
    text,
  );
}

export function isGameRulesQuestion(text: string): boolean {
  return /\b(how do we play|how do i play|how does this work|what are the rules|i still don'?t know how to play)\b/i.test(
    text,
  );
}

export function isGameNextPromptQuestion(text: string): boolean {
  return /\b(what now|what next|what do i do now|what do i do next|what happens now|what happens next|what should i do now|what should i do next)\b/i.test(
    text,
  );
}

export function isStakeQuestion(text: string): boolean {
  return (
    /\bwhat('?s| is) on the line\b/i.test(text) ||
    /\bwhat are the stakes\b/i.test(text) ||
    /\bdo you remember the stakes\b/i.test(text) ||
    /\bwhat do i win\b/i.test(text) ||
    /\bwhat happens if i win\b/i.test(text) ||
    /\bwhat happens if you win\b/i.test(text)
  );
}

export function isSimpleGreeting(text: string): boolean {
  const normalized = normalizeUserText(text).replace(/[!?.,]/g, "");
  if (
    [
      "hi",
      "hello",
      "hey",
      "good evening",
      "good morning",
      "good afternoon",
      "evening",
      "morning",
    ].includes(normalized)
  ) {
    return true;
  }
  return /^(hi|hello|hey)\s+(?:miss raven|miss|mistress|raven|ma'am|mam)$/.test(normalized);
}
