import type { ProfileProgressRow } from "@/lib/db";
import type { ProfileState } from "@/lib/profile";

export type DeterministicGameTemplateId =
  | "word_chain"
  | "rapid_choice"
  | "memory_chain"
  | "math_duel"
  | "number_command"
  | "riddle_lock"
  | "rps_streak"
  | "number_hunt";

export type DeterministicGameProgress =
  | "none"
  | "ready"
  | "round_1"
  | "round_2"
  | "failed"
  | "completed";

export type DeterministicGameOutcome =
  | "none"
  | "user_win"
  | "raven_win";

export type DeterministicGameRewardState =
  | "none"
  | "free_pass_granted"
  | "free_pass_used";

export type DeterministicGameTemplate = {
  id: DeterministicGameTemplateId;
  title: string;
  intro: string;
  prompt: string;
  firstTurnPrompt: string;
  secondTurnPrompt: string;
  completionText: string;
  failureText: string;
  suddenDeathInvalidLoss?: boolean;
  completionOutcome: Exclude<DeterministicGameOutcome, "none">;
};

type RpsThrow = "rock" | "paper" | "scissors";
type RpsRoundProgress = "round_1" | "round_2";

type DeterministicGameTemplateInput = {
  userText?: string;
  hasStakes?: boolean;
  rotationIndex?: number;
  currentTemplateId?: DeterministicGameTemplateId;
  profile?: ProfileState;
  progress?: Pick<ProfileProgressRow, "current_tier" | "free_pass_count" | "last_completion_summary">;
};

function enforceCompetitiveTemplateForStakes(
  template: DeterministicGameTemplate,
  input: DeterministicGameTemplateInput,
): DeterministicGameTemplate {
  if (!input.hasStakes) {
    return template;
  }
  if (
    template.id === "math_duel" ||
    template.id === "riddle_lock" ||
    template.id === "rps_streak" ||
    template.id === "number_command"
  ) {
    return template;
  }
  const preferredPace = normalize(input.profile?.preferred_pace ?? "");
  if (includesAny(preferredPace, [/\b(quick|fast|speed|brisk|short)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  return DETERMINISTIC_GAME_TEMPLATES.math_duel;
}

const GAME_ORDER: DeterministicGameTemplateId[] = [
  "rps_streak",
  "number_hunt",
  "math_duel",
  "number_command",
  "riddle_lock",
];

const DETERMINISTIC_GAME_TEMPLATES: Record<DeterministicGameTemplateId, DeterministicGameTemplate> = {
  word_chain: {
    // Legacy compatibility alias. Word chain is intentionally retired.
    id: "word_chain",
    title: "Rapid choice",
    intro: "I pick. We are doing a rapid choice round, pet.",
    prompt: "I give you two options and you answer immediately with one of them. No dithering.",
    firstTurnPrompt: "Listen carefully, pet. First choice: control or speed. Pick one word and commit to it now.",
    secondTurnPrompt: "Keep up, pet. Next choice: silence or focus. Pick one word and hold to it.",
    completionText: "Good pet. You answered cleanly. That round is complete.",
    failureText: "You stalled and lost the round. I win this one.",
    completionOutcome: "raven_win",
  },
  rapid_choice: {
    id: "rapid_choice",
    title: "Rapid choice",
    intro: "I pick. We are doing a rapid choice round, pet.",
    prompt: "I give you two options and you answer immediately with one of them. No dithering.",
    firstTurnPrompt: "Listen carefully, pet. First choice: control or speed. Pick one word and commit to it now.",
    secondTurnPrompt: "Keep up, pet. Next choice: silence or focus. Pick one word and hold to it.",
    completionText: "Good pet. You answered cleanly. That round is complete.",
    failureText: "You stalled and lost the round. I win this one.",
    completionOutcome: "raven_win",
  },
  memory_chain: {
    id: "memory_chain",
    title: "Memory chain",
    intro: "I pick. We are doing a short memory chain, pet.",
    prompt: "I give you a short sequence and you repeat it back exactly. No sloppy answers.",
    firstTurnPrompt: "Listen carefully, pet. Repeat this sequence exactly: red, glass, key.",
    secondTurnPrompt: "Keep up, pet. Repeat this sequence exactly: lock, breath, line.",
    completionText: "Good pet. You held the sequence cleanly. That round is complete.",
    failureText: "You broke the sequence. I win this round.",
    completionOutcome: "user_win",
  },
  rps_streak: {
    id: "rps_streak",
    title: "RPS streak",
    intro: "I pick. We are doing a rock paper scissors streak, pet.",
    prompt: "Two throws. Choose rock, paper, or scissors each throw. I reveal my throw after you commit.",
    firstTurnPrompt: "Listen carefully, pet. First throw now. Choose rock, paper, or scissors.",
    secondTurnPrompt: "Keep up, pet. Second throw now. Choose rock, paper, or scissors.",
    completionText: "Good. You beat both throws. That round is complete.",
    failureText: "You lost the throw and the round. I win this one.",
    suddenDeathInvalidLoss: true,
    completionOutcome: "user_win",
  },
  number_hunt: {
    id: "number_hunt",
    title: "Number hunt",
    intro: "I pick. We are doing number hunt, pet.",
    prompt: "You hunt one hidden number from 1 to 10. Two guesses maximum.",
    firstTurnPrompt: "Listen carefully, pet. First guess now. One number from 1 to 10.",
    secondTurnPrompt: "Second and final guess now. One number only.",
    completionText: "Good. You hunted it down. That round is complete.",
    failureText: "You missed the number. I win this round.",
    suddenDeathInvalidLoss: true,
    completionOutcome: "user_win",
  },
  math_duel: {
    id: "math_duel",
    title: "Math duel",
    intro: "I pick. We are doing a math duel, pet.",
    prompt: "Two math prompts, digits only. One wrong answer and I win the round.",
    firstTurnPrompt: "Listen carefully, pet. First prompt: 7 + 4 = ? Reply with digits only.",
    secondTurnPrompt: "Keep up, pet. Second prompt: 9 + 6 = ? Reply with digits only.",
    completionText: "Good. You cleared both prompts cleanly. That round is complete.",
    failureText: "Wrong answer. I win this round.",
    suddenDeathInvalidLoss: true,
    completionOutcome: "user_win",
  },
  riddle_lock: {
    id: "riddle_lock",
    title: "Riddle lock",
    intro: "I pick. We are doing a riddle lock, pet.",
    prompt: "Two riddles. Answer each cleanly. One wrong answer and I win the round.",
    firstTurnPrompt:
      "Listen carefully, pet. Riddle one: I speak without a mouth and hear without ears. What am I?",
    secondTurnPrompt:
      "Keep up, pet. Riddle two: I have cities, but no houses; forests, but no trees; and water, but no fish. What am I?",
    completionText: "Good. You solved both riddles. That round is complete.",
    failureText: "Wrong answer. I win this round.",
    suddenDeathInvalidLoss: true,
    completionOutcome: "user_win",
  },
  number_command: {
    id: "number_command",
    title: "Number command",
    intro: "I pick. We are doing number command, pet.",
    prompt:
      "You pick one number from 1 to 10. I assign a command based on that number. If you fail the command, you lose the round.",
    firstTurnPrompt: "Listen carefully, pet. Pick one number from 1 to 10 now.",
    secondTurnPrompt:
      "Good. Number locked. Complete the command exactly, then report done. If you break the command, say failed.",
    completionText: "Good. You completed the number command cleanly. That round is complete.",
    failureText: "You failed the number command. I win this round.",
    completionOutcome: "user_win",
  },
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isAnotherRoundCue(text: string): boolean {
  return /\b(another round|play again|again|next round|one more round)\b/i.test(text);
}

function includesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function preferredGameTemplateFromProfile(
  profile: ProfileState | undefined,
  progress: DeterministicGameTemplateInput["progress"],
): DeterministicGameTemplate | null {
  const preferredPace = normalize(profile?.preferred_pace ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  const likes = normalize(profile?.likes ?? "");
  const memorySummary = normalize(profile?.memory_summary ?? "");
  const combined = [preferredStyle, likes, memorySummary].filter(Boolean).join(" ");
  const lastCompletionSummary = normalize(progress?.last_completion_summary ?? "");

  if (includesAny(preferredPace, [/\b(quick|fast|short|brisk)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (includesAny(preferredPace, [/\b(slow|steady|calm|measured)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (includesAny(combined, [/\b(memory|recall|sequence|focus)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (includesAny(combined, [/\b(riddle|puzzle|brain)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.riddle_lock;
  }
  if (includesAny(combined, [/\b(number|roulette|random|unpredictable)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (includesAny(combined, [/\b(math|numbers?|challenge|competitive|duel)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.math_duel;
  }
  if (includesAny(combined, [/\b(choice|pressure|bet|wager|strict|control|speed)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (includesAny(combined, [/\b(word|verbal|talk|chat)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (
    (progress?.current_tier === "gold" || progress?.current_tier === "platinum") &&
    progress?.free_pass_count === 0
  ) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (lastCompletionSummary.includes("memory_chain")) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (lastCompletionSummary.includes("rapid_choice")) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (lastCompletionSummary.includes("number_hunt")) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (lastCompletionSummary.includes("rps_streak")) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (lastCompletionSummary.includes("word_chain")) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  return null;
}

export function resolveDeterministicGameTemplateById(
  templateId: DeterministicGameTemplateId,
): DeterministicGameTemplate {
  if (templateId === "word_chain") {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (templateId === "rapid_choice") {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (templateId === "memory_chain") {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  return DETERMINISTIC_GAME_TEMPLATES[templateId] ?? DETERMINISTIC_GAME_TEMPLATES.rps_streak;
}

export function getDeterministicGameTemplateForIndex(
  rotationIndex: number,
): DeterministicGameTemplate {
  const safeIndex = ((rotationIndex % GAME_ORDER.length) + GAME_ORDER.length) % GAME_ORDER.length;
  return resolveDeterministicGameTemplateById(GAME_ORDER[safeIndex] ?? "rps_streak");
}

export function selectDeterministicGameTemplate(
  input: DeterministicGameTemplateInput = {},
): DeterministicGameTemplate {
  const normalizedUserText = normalize(input.userText ?? "");
  const explicitRequestedTemplateId = detectRequestedDeterministicGameTemplateId(normalizedUserText);
  const currentTemplate =
    input.currentTemplateId !== undefined
      ? resolveDeterministicGameTemplateById(input.currentTemplateId)
      : null;
  if (isAnotherRoundCue(normalizedUserText)) {
    if (explicitRequestedTemplateId) {
      return resolveDeterministicGameTemplateById(explicitRequestedTemplateId);
    }
    return getDeterministicGameTemplateForIndex(input.rotationIndex ?? 0);
  }
  if (includesAny(normalizedUserText, [/\b(number command|number roulette|pick a number command)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_command;
  }
  if (includesAny(normalizedUserText, [/\b(pick a number|number game|1-10|1 to 10|roulette)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_command;
  }
  if (includesAny(normalizedUserText, [/\b(rock paper scissors|rps|scissors game)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (includesAny(normalizedUserText, [/\b(number hunt|guess my number|number guess)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (includesAny(normalizedUserText, [/\b(math|number|digits|equation|sum)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.math_duel;
  }
  if (includesAny(normalizedUserText, [/\b(riddle|puzzle|brain)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.riddle_lock;
  }
  if (includesAny(normalizedUserText, [/\b(bet|wager|stakes|competitive|real game|challenge)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.math_duel;
  }
  if (
    input.hasStakes &&
    currentTemplate &&
    includesAny(normalizedUserText, [/\b(you pick|you choose|your choice|surprise me|start|let'?s start|play)\b/i])
  ) {
    return currentTemplate;
  }
  if (includesAny(normalizedUserText, [/\b(quick|fast|speed|snap)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.rps_streak;
  }
  if (includesAny(normalizedUserText, [/\b(memory|sequence|remember|recall)\b/i])) {
    return DETERMINISTIC_GAME_TEMPLATES.number_hunt;
  }
  if (includesAny(normalizedUserText, [/\b(word|letters|verbal|chat)\b/i])) {
    return enforceCompetitiveTemplateForStakes(DETERMINISTIC_GAME_TEMPLATES.rps_streak, input);
  }

  const learnedPreference = preferredGameTemplateFromProfile(input.profile, input.progress);
  if (learnedPreference) {
    return enforceCompetitiveTemplateForStakes(learnedPreference, input);
  }

  return enforceCompetitiveTemplateForStakes(
    getDeterministicGameTemplateForIndex(input.rotationIndex ?? 0),
    input,
  );
}

export function detectRequestedDeterministicGameTemplateId(
  text: string,
): DeterministicGameTemplateId | null {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }
  if (includesAny(normalized, [/\b(number command|number roulette|pick a number command)\b/i])) {
    return "number_command";
  }
  if (includesAny(normalized, [/\b(rock paper scissors|rps|scissors game)\b/i])) {
    return "rps_streak";
  }
  if (includesAny(normalized, [/\b(number hunt|guess my number|number guess)\b/i])) {
    return "number_hunt";
  }
  if (includesAny(normalized, [/\b(math duel)\b/i])) {
    return "math_duel";
  }
  if (includesAny(normalized, [/\b(riddle lock)\b/i])) {
    return "riddle_lock";
  }
  return null;
}

export function buildDeterministicGameChoice(
  templateId: DeterministicGameTemplateId,
): string {
  const template = resolveDeterministicGameTemplateById(templateId);
  return `${template.intro} ${template.prompt}`;
}

export function buildDeterministicGameStart(
  templateId: DeterministicGameTemplateId,
): string {
  return [
    buildDeterministicGameChoice(templateId),
    buildDeterministicGameImmediatePrompt(templateId, "ready"),
  ].join(" ");
}

export function isDeterministicGameChoiceText(text: string): boolean {
  return /\bi pick\b|\bwe are doing\b|\brock paper scissors streak\b|\bnumber hunt\b|\bmath duel\b|\briddle lock\b|\bnumber command\b/i.test(
    text,
  );
}

export function isDeterministicGameCompletionText(text: string): boolean {
  return /\bthat round is complete\b|\bgame is complete\b|\bi win this round\b|\bi win this one\b|\byou win this round\b/i.test(
    text,
  );
}

export function isTerminalDeterministicGameProgress(progress: DeterministicGameProgress): boolean {
  return progress === "completed" || progress === "failed";
}

export function deriveGameProgressFromUserText(
  templateId: DeterministicGameTemplateId,
  current: DeterministicGameProgress,
  text: string,
): DeterministicGameProgress {
  const template = resolveDeterministicGameTemplateById(templateId);
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return current;
  }
  const passiveAck = isPassiveDeterministicGameInput(normalized);
  if (passiveAck) {
    return current === "ready" ? "round_1" : current;
  }
  if (templateId === "rps_streak") {
    const choice = parseRpsThrow(normalized);
    if (current === "ready") {
      return choice === null ? "round_1" : resolveRpsProgress("round_1", choice);
    }
    if (current === "round_1") {
      return choice === null
        ? template.suddenDeathInvalidLoss
          ? "failed"
          : "round_1"
        : resolveRpsProgress("round_1", choice);
    }
    if (current === "round_2") {
      return choice === null
        ? template.suddenDeathInvalidLoss
          ? "failed"
          : "round_2"
        : resolveRpsProgress("round_2", choice);
    }
    return current;
  }
  if (templateId === "number_hunt") {
    const guess = parseChosenNumber(normalized);
    if (current === "ready") {
      return guess === null ? "round_1" : guess === 7 ? "completed" : "round_2";
    }
    if (current === "round_1") {
      return guess === null ? "round_1" : guess === 7 ? "completed" : "round_2";
    }
    if (current === "round_2") {
      if (hasFailureCue(normalized)) {
        return "failed";
      }
      if (guess === 7 || hasCompletionCue(normalized)) {
        return "completed";
      }
      if (guess !== null) {
        return "failed";
      }
      return "round_2";
    }
    return current;
  }
  if (templateId === "number_command") {
    if (current === "ready") {
      return parseChosenNumber(normalized) !== null ? "round_2" : "round_1";
    }
    if (current === "round_1") {
      return parseChosenNumber(normalized) !== null ? "round_2" : "round_1";
    }
    if (current === "round_2") {
      if (hasFailureCue(normalized)) {
        return "failed";
      }
      if (hasCompletionCue(normalized)) {
        return "completed";
      }
      return "round_2";
    }
    return current;
  }
  if (current === "ready") {
    return "round_1";
  }
  if (current === "round_1") {
    if (isValidDeterministicGameAnswer(templateId, "round_1", text)) {
      return "round_2";
    }
    return template.suddenDeathInvalidLoss ? "failed" : "round_1";
  }
  if (current === "round_2") {
    if (isValidDeterministicGameAnswer(templateId, "round_2", text)) {
      return "completed";
    }
    return template.suddenDeathInvalidLoss ? "failed" : "round_2";
  }
  return current;
}

export function buildDeterministicGameFollowUp(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
): string {
  const template = resolveDeterministicGameTemplateById(templateId);
  if (progress === "failed") {
    return template.failureText;
  }
  if (progress === "completed") {
    return template.completionText;
  }
  if (progress === "round_2") {
    return template.secondTurnPrompt;
  }
  if (progress === "round_1") {
    return template.firstTurnPrompt;
  }
  return `Listen carefully, pet. ${template.prompt}`;
}

export function buildDeterministicGameImmediatePrompt(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
): string {
  return buildDeterministicGameFollowUp(
    templateId,
    progress === "ready" ? "round_1" : progress,
  );
}

export function deriveDeterministicGameOutcome(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
): DeterministicGameOutcome {
  if (progress === "failed") {
    return "raven_win";
  }
  if (progress !== "completed") {
    return "none";
  }
  return resolveDeterministicGameTemplateById(templateId).completionOutcome;
}

export function buildDeterministicGameOutcomeLine(
  outcome: DeterministicGameOutcome,
  winCondition = "",
  loseCondition = "",
): string {
  if (outcome === "user_win") {
    const applied = winCondition ? ` ${winCondition}.` : "";
    return `You win this round. Do not get smug.${applied}`.trim();
  }
  if (outcome === "raven_win") {
    const applied = loseCondition ? ` ${loseCondition}.` : "";
    return `I win this round. Remember your place.${applied}`.trim();
  }
  return "";
}

export function buildDeterministicGameRewardLine(
  rewardState: DeterministicGameRewardState,
  freePassCount: number,
): string {
  if (rewardState === "free_pass_granted") {
    return `You earn one free pass. Do not waste it. It cancels one future consequence task the next time I win. Banked free passes: ${Math.max(0, freePassCount)}.`;
  }
  if (rewardState === "free_pass_used") {
    return "Your free pass is spent. You do not get another excuse. It cancels this consequence task. No consequence task this round.";
  }
  return "";
}

export function buildDeterministicGameLeverageLine(
  outcome: DeterministicGameOutcome,
  rewardState: DeterministicGameRewardState,
): string {
  if (outcome !== "raven_win") {
    return "";
  }
  if (rewardState === "free_pass_used") {
    return "Your banked protection covered this round. Do not expect that mercy twice.";
  }
  return "You have no protection banked. Your consequence is live now.";
}

export function buildDeterministicGameNextBeatLine(
  outcome: DeterministicGameOutcome,
  rewardState: DeterministicGameRewardState,
): string {
  if (outcome === "user_win" && rewardState === "free_pass_granted") {
    return "Bank that protection and stay sharp. Press your advantage or call for another round.";
  }
  return "";
}

export function buildGameExecutionRule(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
): string {
  const template = resolveDeterministicGameTemplateById(templateId);
  if (progress === "ready") {
    return `wait for the user to answer the ${template.title.toLowerCase()} opener before changing topics`;
  }
  if (progress === "round_1") {
    return `keep the ${template.title.toLowerCase()} moving and wait for the next answer`;
  }
  if (progress === "round_2") {
    return `finish the ${template.title.toLowerCase()} cleanly before changing topics`;
  }
  if (progress === "failed") {
    return `the ${template.title.toLowerCase()} round is lost, confirm the result before changing topics`;
  }
  if (progress === "completed") {
    return "confirm the game result before changing topics";
  }
  return "";
}

export function buildGameExecutionExpectedAction(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
): string {
  const template = resolveDeterministicGameTemplateById(templateId);
  if (progress === "ready") {
    return `answer the ${template.title.toLowerCase()} opener`;
  }
  if (progress === "round_1") {
    return `answer the next ${template.title.toLowerCase()} prompt`;
  }
  if (progress === "round_2") {
    return `finish the final ${template.title.toLowerCase()} prompt`;
  }
  if (progress === "failed") {
    return "wait for Raven to enforce the result of the lost round";
  }
  if (progress === "completed") {
    return "wait for Raven to confirm the finished round";
  }
  return "stay with the current game";
}

export function detectDeterministicGameTemplateId(
  text: string,
  fallback: DeterministicGameTemplateId = "rps_streak",
): DeterministicGameTemplateId {
  const normalized = text.toLowerCase();
  if (normalized.includes("rock paper scissors") || normalized.includes("rps streak")) {
    return "rps_streak";
  }
  if (normalized.includes("number hunt")) {
    return "number_hunt";
  }
  if (normalized.includes("number command")) {
    return "number_command";
  }
  if (normalized.includes("math duel")) {
    return "math_duel";
  }
  if (normalized.includes("riddle lock")) {
    return "riddle_lock";
  }
  if (normalized.includes("rapid choice")) {
    return "rps_streak";
  }
  if (normalized.includes("memory chain")) {
    return "number_hunt";
  }
  if (normalized.includes("word chain")) {
    return "rps_streak";
  }
  return fallback;
}

export function isPassiveDeterministicGameInput(text: string): boolean {
  return /^(ok|okay|yes|yeah|yep|sure|fine|ready|sounds good|that works|got it|let'?s start|lets start|start now|i am ready|i'?m ready|im ready)[.!]?$/i.test(
    text.trim(),
  );
}

export function buildDeterministicGameTurnReply(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
  userText: string,
  previousProgress: DeterministicGameProgress = progress,
): string {
  const template = resolveDeterministicGameTemplateById(templateId);
  const normalized = userText.trim();
  if (template.id === "rps_streak") {
    const resolutionProgress =
      progress === "round_2" && previousProgress === "round_1"
        ? "round_1"
        : (progress === "failed" || progress === "completed") &&
            (previousProgress === "round_1" || previousProgress === "round_2")
          ? previousProgress
          : progress;
    const activeRound: RpsRoundProgress =
      resolutionProgress === "round_2" ? "round_2" : "round_1";
    const choice = parseRpsThrow(normalized);
    if (progress === "failed") {
      if (!choice) {
        return template.failureText;
      }
      const ravenThrow = rpsThrowForRound(activeRound);
      const outcome = resolveRpsRound(choice, ravenThrow);
      if (outcome === "tie") {
        return buildRpsTieReply(choice, ravenThrow, activeRound);
      }
      return buildRpsFailureReply(choice, ravenThrow, activeRound);
    }
    if (progress === "completed") {
      if (!choice) {
        return buildDeterministicGameFollowUp(templateId, progress);
      }
      const ravenThrow = rpsThrowForRound(activeRound);
      return buildRpsCompletionReply(choice, ravenThrow, template);
    }
    if (resolutionProgress === "round_1") {
      if (isPassiveDeterministicGameInput(normalized)) {
        return `No stalling, pet. ${buildDeterministicGameFollowUp(templateId, "round_1")}`;
      }
      if (!choice) {
        return `No. Answer the prompt properly, pet. ${buildDeterministicGameFollowUp(templateId, "round_1")}`;
      }
      const ravenThrow = rpsThrowForRound("round_1");
      const outcome = resolveRpsRound(choice, ravenThrow);
      if (outcome === "tie") {
        return buildRpsTieReply(choice, ravenThrow, "round_1");
      }
      if (outcome === "raven_win") {
        return buildRpsFailureReply(choice, ravenThrow, "round_1");
      }
      return buildRpsAdvanceReply(choice, ravenThrow);
    }
    if (resolutionProgress === "round_2") {
      if (isPassiveDeterministicGameInput(normalized)) {
        return `No stalling, pet. ${buildDeterministicGameFollowUp(templateId, "round_2")}`;
      }
      if (!choice) {
        return `No. Keep up, pet. ${buildDeterministicGameFollowUp(templateId, "round_2")}`;
      }
      const ravenThrow = rpsThrowForRound("round_2");
      const outcome = resolveRpsRound(choice, ravenThrow);
      if (outcome === "tie") {
        return buildRpsTieReply(choice, ravenThrow, "round_2");
      }
      if (outcome === "raven_win") {
        return buildRpsFailureReply(choice, ravenThrow, "round_2");
      }
      return buildRpsCompletionReply(choice, ravenThrow, template);
    }
  }
  if (progress === "failed") {
    return template.failureText;
  }
  if (progress === "completed") {
    return buildDeterministicGameFollowUp(templateId, progress);
  }
  if (!normalized) {
    return buildDeterministicGameFollowUp(templateId, progress);
  }

  if (progress === "round_1") {
    if (isPassiveDeterministicGameInput(normalized)) {
      return `No stalling, pet. ${buildDeterministicGameFollowUp(templateId, "round_1")}`;
    }
    if (!isValidDeterministicGameAnswer(templateId, "round_1", normalized)) {
      return `No. Answer the prompt properly, pet. ${buildDeterministicGameFollowUp(templateId, "round_1")}`;
    }
    return buildDeterministicGameFollowUp(templateId, "round_2");
  }

  if (template.id === "number_hunt" && progress === "round_2") {
    const firstGuess = parseChosenNumber(normalized);
    if (firstGuess === null) {
      return `No. Give one number, pet. ${buildDeterministicGameFollowUp(templateId, "round_1")}`;
    }
    const target = 7;
    if (firstGuess === target) {
      return template.completionText;
    }
    const hint = firstGuess < target ? "Too low." : "Too high.";
    return `${hint} ${template.secondTurnPrompt}`;
  }

  if (progress === "round_2") {
    if (isPassiveDeterministicGameInput(normalized)) {
      return `No stalling, pet. ${buildDeterministicGameFollowUp(templateId, "round_2")}`;
    }
    if (isValidDeterministicGameAnswer(templateId, "round_1", normalized)) {
      return buildDeterministicGameFollowUp(templateId, "round_2");
    }
    if (!isValidDeterministicGameAnswer(templateId, "round_2", normalized)) {
      return `No. Keep up, pet. ${buildDeterministicGameFollowUp(templateId, "round_2")}`;
    }
  }

  return buildDeterministicGameFollowUp(templateId, progress);
}

function normalizedWords(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function matchesChoice(text: string, expected: readonly string[]): boolean {
  const words = normalizedWords(text);
  return words.some((word) => expected.includes(word));
}

function matchesSequence(text: string, expected: readonly string[]): boolean {
  const words = normalizedWords(text);
  let index = 0;
  for (const word of words) {
    if (word === expected[index]) {
      index += 1;
      if (index >= expected.length) {
        return true;
      }
    }
  }
  return false;
}

function equalsExpectedNumber(text: string, expected: string): boolean {
  const words = normalizedWords(text);
  const numbers = words.filter((word) => /^\d+$/.test(word));
  const candidate = numbers[numbers.length - 1] ?? words[0] ?? "";
  return candidate === expected;
}

function parseRpsThrow(text: string): "rock" | "paper" | "scissors" | null {
  const words = normalizedWords(text);
  for (const word of words) {
    if (word === "rock") {
      return "rock";
    }
    if (word === "paper") {
      return "paper";
    }
    if (word === "scissors" || word === "scissor") {
      return "scissors";
    }
  }
  return null;
}

function rpsThrowForRound(progress: "round_1" | "round_2"): RpsThrow {
  return progress === "round_1" ? "scissors" : "paper";
}

function buildRpsTieReply(
  choice: RpsThrow,
  ravenThrow: RpsThrow,
  progress: RpsRoundProgress,
): string {
  const tieLine =
    progress === "round_1"
      ? "Dead even. The first throw stays live."
      : "Dead even. The deciding throw stays live.";
  return `Good. You chose ${choice}. I threw ${ravenThrow}. ${tieLine} ${buildDeterministicGameFollowUp("rps_streak", progress)}`;
}

function buildRpsAdvanceReply(choice: RpsThrow, ravenThrow: RpsThrow): string {
  return `Good. You chose ${choice}. I threw ${ravenThrow}. ${capitalizeThrow(choice)} beats ${ravenThrow}. Clean. You take the first throw. ${buildDeterministicGameFollowUp("rps_streak", "round_2")}`;
}

function buildRpsCompletionReply(
  choice: RpsThrow,
  ravenThrow: RpsThrow,
  template: DeterministicGameTemplate,
): string {
  return `Good. You chose ${choice}. I threw ${ravenThrow}. ${capitalizeThrow(choice)} beats ${ravenThrow}. Clean finish. You take the deciding throw. ${template.completionText}`;
}

function buildRpsFailureReply(
  choice: RpsThrow,
  ravenThrow: RpsThrow,
  progress: RpsRoundProgress,
): string {
  const failureLine =
    progress === "round_1"
      ? "You lose the first throw. The round is mine."
      : "You lose the deciding throw. The round is mine.";
  return `Good. You chose ${choice}. I threw ${ravenThrow}. ${capitalizeThrow(ravenThrow)} beats ${choice}. ${failureLine} I win this one.`;
}

function capitalizeThrow(value: RpsThrow): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function resolveRpsRound(
  userThrow: RpsThrow,
  ravenThrow: RpsThrow,
): "user_win" | "raven_win" | "tie" {
  if (userThrow === ravenThrow) {
    return "tie";
  }
  if (
    (userThrow === "rock" && ravenThrow === "scissors") ||
    (userThrow === "paper" && ravenThrow === "rock") ||
    (userThrow === "scissors" && ravenThrow === "paper")
  ) {
    return "user_win";
  }
  return "raven_win";
}

function resolveRpsProgress(
  progress: "round_1" | "round_2",
  userThrow: RpsThrow,
): DeterministicGameProgress {
  const outcome = resolveRpsRound(userThrow, rpsThrowForRound(progress));
  if (outcome === "tie") {
    return progress;
  }
  if (outcome === "user_win") {
    return progress === "round_1" ? "round_2" : "completed";
  }
  return "failed";
}

const NUMBER_PICK_PATTERN = /\b(10|[1-9])\b/;

export function parseChosenNumber(text: string): number | null {
  const normalized = normalize(text);
  const match = normalized.match(NUMBER_PICK_PATTERN);
  if (!match || typeof match[1] !== "string") {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 1 || value > 10) {
    return null;
  }
  return Math.floor(value);
}

function hasCompletionCue(text: string): boolean {
  return /\b(done|completed?|held|finished?|passed|success)\b/i.test(text);
}

function hasFailureCue(text: string): boolean {
  return /\b(failed?|lost|moved|broke|couldn'?t|could not|can'?t|cannot)\b/i.test(text);
}

export function isValidDeterministicGameAnswer(
  templateId: DeterministicGameTemplateId,
  progress: DeterministicGameProgress,
  text: string,
): boolean {
  const effectiveTemplateId =
    templateId === "word_chain"
      ? "rps_streak"
      : templateId === "rapid_choice"
        ? "rps_streak"
        : templateId === "memory_chain"
          ? "number_hunt"
          : templateId;
  if (progress !== "round_1" && progress !== "round_2") {
    return false;
  }
  if (effectiveTemplateId === "rps_streak") {
    return parseRpsThrow(text) !== null;
  }
  if (effectiveTemplateId === "number_hunt") {
    return progress === "round_1"
      ? parseChosenNumber(text) !== null
      : equalsExpectedNumber(text, "7");
  }
  if (effectiveTemplateId === "math_duel") {
    return progress === "round_1"
      ? equalsExpectedNumber(text, "11")
      : equalsExpectedNumber(text, "15");
  }
  if (effectiveTemplateId === "number_command") {
    if (progress === "round_1") {
      return parseChosenNumber(text) !== null;
    }
    return hasCompletionCue(text);
  }
  if (effectiveTemplateId === "riddle_lock") {
    return progress === "round_1"
      ? matchesChoice(text, ["echo"])
      : matchesChoice(text, ["map"]);
  }
  return progress === "round_1"
    ? matchesSequence(text, ["red", "glass", "key"])
    : matchesSequence(text, ["lock", "breath", "line"]);
}
