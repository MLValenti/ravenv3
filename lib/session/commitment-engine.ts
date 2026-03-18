import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  buildDeterministicGameStart,
  selectDeterministicGameTemplate,
  type DeterministicGameTemplateId,
} from "./game-script.ts";
import { buildDeterministicTaskAssignment, selectDeterministicTaskTemplate } from "./task-script.ts";

export type CommitmentType =
  | "none"
  | "choose_game"
  | "assign_task"
  | "answer_duration"
  | "complete_verification";

export type CommitmentState = {
  type: CommitmentType;
  locked: boolean;
  detail: string;
  source_act: DialogueRouteAct | "none";
  created_at: number;
};

export type CommitmentDecisionInput = {
  current: CommitmentState;
  act: DialogueRouteAct;
  candidateText: string;
  userText: string;
  nowMs?: number;
};

export type CommitmentDecision = {
  text: string;
  next: CommitmentState;
  forced: boolean;
  reason: string;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function containsDuration(text: string): boolean {
  return /\b\d+\s*(hour|hours|minute|minutes)\b/i.test(text);
}

function looksLikeGameChoice(text: string): boolean {
  return /\bi pick\b|\bwe are doing\b|\bhere is the game\b|\bgame is\b/i.test(text);
}

function looksLikeGameClarifier(text: string): boolean {
  return /\bquick\b|\bfew minutes\b|\blonger\b|\bchoose\b/i.test(text) && text.includes("?");
}

function chooseFallbackGameTemplateId(userText: string): DeterministicGameTemplateId {
  const hasStakesCue = /\b(stakes?|bet|wager|if i win|if you win|on the line)\b/i.test(userText);
  const selected = selectDeterministicGameTemplate({
    userText,
    hasStakes: hasStakesCue,
  });
  return selected.id;
}

function looksLikeTaskAssignment(text: string): boolean {
  return /\bhere is your task\b|\byour task\b|\breport back\b|\bcheck in\b/i.test(text);
}

function looksLikeTaskClarifier(text: string): boolean {
  return /\b(what items are actually available|what can you actually use|gear or tools|what kind of task do you want|pick the lane|how long should i make it|what time window do you want)\b/i.test(
    text,
  ) || (
    /\b(oral|anal|prop)\b/i.test(text) &&
    /\b(tell me whether|which one|be specific|what body area|what role)\b/i.test(text)
  );
}

function looksLikeVerificationFollowThrough(text: string): boolean {
  return (
    /\bverify|verification|hold steady|camera check|keep still\b/i.test(text) ||
    /\bi have you in frame\b|\bi saw the full turn\b|\byou held it cleanly\b|\bi can see it clearly\b/i.test(
      text,
    ) ||
    /\bi saw the change clearly\b|\bi will take your word once\b|\bi did not get a clean read\b/i.test(
      text,
    ) ||
    /\bi do not have a stable (frame|read)\b|\bthat turn was not clean enough\b/i.test(text) ||
    /\bcannot verify the object yet\b|\bframe is not usable yet\b|\bconfirm once that you completed it\b/i.test(
      text,
    )
  );
}

function createCommitment(
  type: CommitmentType,
  sourceAct: DialogueRouteAct | "none",
  detail: string,
  nowMs: number,
): CommitmentState {
  return {
    type,
    locked: type !== "none",
    detail,
    source_act: sourceAct,
    created_at: nowMs,
  };
}

export function createCommitmentState(): CommitmentState {
  return {
    type: "none",
    locked: false,
    detail: "none",
    source_act: "none",
    created_at: 0,
  };
}

export function createVerificationCommitment(
  detail = "finish the camera check before moving on",
  nowMs = Date.now(),
): CommitmentState {
  return createCommitment("complete_verification", "none", detail, nowMs);
}

export function clearVerificationCommitment(current: CommitmentState): CommitmentState {
  if (current.type === "complete_verification") {
    return createCommitmentState();
  }
  return current;
}

export function buildCommitmentPromptBlock(state: CommitmentState): string {
  return [
    "Commitment:",
    `Type: ${state.type}`,
    `Locked: ${state.locked ? "yes" : "no"}`,
    `Detail: ${state.detail || "none"}`,
  ].join("\n");
}

export function isResponseAlignedWithCommitment(
  state: CommitmentState,
  text: string,
): boolean {
  const normalized = normalize(text);
  if (!state.locked || state.type === "none") {
    return true;
  }
  if (!normalized) {
    return false;
  }
  if (state.type === "choose_game") {
    return looksLikeGameChoice(normalized);
  }
  if (state.type === "assign_task") {
    return looksLikeTaskAssignment(normalized) || looksLikeTaskClarifier(normalized);
  }
  if (state.type === "answer_duration") {
    return containsDuration(normalized);
  }
  if (state.type === "complete_verification") {
    return looksLikeVerificationFollowThrough(normalized);
  }
  return true;
}

export function buildCommitmentFallback(
  state: CommitmentState,
  userText: string,
): string | null {
  if (state.type === "choose_game") {
    return buildDeterministicGameStart(chooseFallbackGameTemplateId(userText));
  }
  if (state.type === "assign_task") {
    return buildDeterministicTaskAssignment({
      template: selectDeterministicTaskTemplate({ userText }),
    });
  }
  if (state.type === "answer_duration") {
    return "You will wear it for 2 hours.";
  }
  if (state.type === "complete_verification") {
    return "Hold steady. I am verifying before we move on.";
  }
  if (/\b(you pick|you choose|your choice|surprise me)\b/i.test(userText)) {
    return buildDeterministicGameStart(chooseFallbackGameTemplateId(userText));
  }
  return null;
}

function shouldFulfillImmediately(act: DialogueRouteAct): boolean {
  return act === "answer_activity_choice" || act === "task_request" || act === "duration_request";
}

function deriveNextCommitment(
  act: DialogueRouteAct,
  text: string,
  nowMs: number,
): CommitmentState {
  if (act === "propose_activity") {
    if (looksLikeGameChoice(text)) {
      return createCommitmentState();
    }
    if (looksLikeGameClarifier(text)) {
      return createCommitment("choose_game", act, "choose the game on the next turn", nowMs);
    }
    return createCommitment("choose_game", act, "finish choosing the game", nowMs);
  }
  if (act === "answer_activity_choice") {
    if (looksLikeGameChoice(text)) {
      return createCommitmentState();
    }
    return createCommitment("choose_game", act, "choose the game now", nowMs);
  }
  if (act === "task_request") {
    if (looksLikeTaskAssignment(text) || looksLikeTaskClarifier(text)) {
      return createCommitmentState();
    }
    return createCommitment("assign_task", act, "assign the task directly", nowMs);
  }
  if (act === "duration_request") {
    if (containsDuration(text)) {
      return createCommitmentState();
    }
    return createCommitment("answer_duration", act, "answer with a concrete duration", nowMs);
  }
  return createCommitmentState();
}

export function applyCommitmentDecision(
  input: CommitmentDecisionInput,
): CommitmentDecision {
  const nowMs = input.nowMs ?? Date.now();
  let text = normalize(input.candidateText);
  let forced = false;
  let reason = "accepted_candidate";
  let current = input.current;

  if (current.locked && !isResponseAlignedWithCommitment(current, text)) {
    const forcedText = buildCommitmentFallback(current, input.userText);
    if (forcedText) {
      text = forcedText;
      forced = true;
      reason = "forced_existing_commitment";
    }
  }

  if (current.locked) {
    const resolved = isResponseAlignedWithCommitment(current, text);
    return {
      text,
      next: resolved ? createCommitmentState() : current,
      forced,
      reason: resolved ? reason : "existing_commitment_still_open",
    };
  }

  let next = deriveNextCommitment(input.act, text, nowMs);
  if (next.locked && shouldFulfillImmediately(input.act)) {
    const forcedText = buildCommitmentFallback(next, input.userText);
    if (forcedText) {
      text = forcedText;
      forced = true;
      reason = "forced_immediate_commitment";
      next = createCommitmentState();
    }
  }

  return {
    text,
    next,
    forced,
    reason,
  };
}
