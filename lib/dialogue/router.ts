import { hasStakeSignal, normalizeUserText } from "./user-signals.ts";
import { scoreDialogueIntentSignals } from "./intent-score.ts";
import { isShortClarificationTurn } from "../session/short-follow-up.ts";

export type DialogueRouteAct =
  | "propose_activity"
  | "answer_activity_choice"
  | "task_request"
  | "duration_request"
  | "short_follow_up"
  | "user_question"
  | "user_answer"
  | "confusion"
  | "acknowledgement"
  | "other";

export type SessionTopicType = "game_selection" | "general_request";

export type SessionTopic = {
  topic_type: SessionTopicType;
  topic_state: "open" | "resolved";
  summary: string;
  created_at: number;
};

export type DialogueRouteInput = {
  text: string;
  awaitingUser: boolean;
  currentTopic: SessionTopic | null;
  nowMs?: number;
};

export type DialogueRouteResult = {
  act: DialogueRouteAct;
  reason: string;
  nextTopic: SessionTopic | null;
};

function openTopic(
  topicType: SessionTopicType,
  summary: string,
  nowMs: number,
): SessionTopic {
  return {
    topic_type: topicType,
    topic_state: "open",
    summary,
    created_at: nowMs,
  };
}

export function isTopicUnresolved(topic: SessionTopic | null): boolean {
  return Boolean(topic && topic.topic_state === "open");
}

export function resolveSessionTopic(topic: SessionTopic | null): SessionTopic | null {
  if (!topic) {
    return null;
  }
  return {
    ...topic,
    topic_state: "resolved",
  };
}

export function classifyDialogueRoute(input: DialogueRouteInput): DialogueRouteResult {
  const text = normalizeUserText(input.text);
  const scores = scoreDialogueIntentSignals(text);
  const nowMs = input.nowMs ?? Date.now();
  const currentTopic = input.currentTopic;
  const isTaskExecutionQuestion =
    /\b(what now|what next|next step|what should i do next|what should i do now|what else should i do now|what do i do after|what do i do now|what do i need to do next|what do i need to do now)\b/.test(
      text,
    ) &&
    !/\b(new task|another task|different task|ready for a new task|ready for another task)\b/.test(
      text,
    );
  const isTaskFollowUpQuestion =
    /\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change|do i need proof|what proof|how do i prove it|what counts as proof|do you want proof|do i have to prove it|how deep|what depth|how far|how far in)\b/.test(
      text,
    );
  const isDurationRevisionCue =
    /\b(make it \d+\s*(minutes?|hours?)|make it shorter|make it longer|change how long|change the duration)\b/.test(
      text,
    );
  const isTaskReplacementCue =
    /\b(different task|different kind of task|another task|new task|next task|something else to do)\b/.test(
      text,
    );
  const isTaskSuggestionQuestion =
    /\btask\b/.test(text) &&
    /\b(what kind of|what sort of|what would be a good|what do you think would be a good|what should we do|what could we do|what would work well)\b/.test(
      text,
    );
  const isGameRulesQuestion = /\bhow do we play\b|\bhow does this work\b|\bwhat are the rules\b|\bwhat('?s| is) the first prompt\b|\bwhat('?s| is) the first step\b|\bopening move\b|\bmy turn\b|\byour turn\b/.test(
    text,
  );

  if (!text) {
    return {
      act: "acknowledgement",
      reason: "empty input treated as acknowledgement",
      nextTopic: currentTopic,
    };
  }

  if (isShortClarificationTurn(text)) {
    return {
      act: "short_follow_up",
      reason: "explicit short clarification follow-up",
      nextTopic: currentTopic,
    };
  }

  if (scores.confusion.score >= 1.4) {
    return {
      act: "confusion",
      reason: `scored confusion (${scores.confusion.score.toFixed(1)}): ${scores.confusion.reasons.join(",") || "signal"}`,
      nextTopic: currentTopic,
    };
  }

  if (isTaskExecutionQuestion || isTaskFollowUpQuestion) {
    return {
      act: "user_question",
      reason: isTaskFollowUpQuestion
        ? "task follow-up question should stay on the active task rail"
        : "task progress question should stay on the active task rail",
      nextTopic:
        currentTopic ??
        openTopic("general_request", "answer the current task question before changing topics", nowMs),
    };
  }

  if (isDurationRevisionCue) {
    return {
      act: "duration_request",
      reason: "explicit task duration revision cue",
      nextTopic:
        currentTopic ??
        openTopic("general_request", "answer the duration question before changing topics", nowMs),
    };
  }

  if (scores.durationRequest.score >= 1.6) {
    return {
      act: "duration_request",
      reason: `scored duration request (${scores.durationRequest.score.toFixed(1)}): ${scores.durationRequest.reasons.join(",") || "signal"}`,
      nextTopic:
        currentTopic ??
        openTopic("general_request", "answer the duration question before changing topics", nowMs),
    };
  }

  if (scores.proposeActivity.score >= 1.6 && scores.proposeActivity.score >= scores.question.score) {
    return {
      act: "propose_activity",
      reason: `scored activity proposal (${scores.proposeActivity.score.toFixed(1)}): ${scores.proposeActivity.reasons.join(",") || "signal"}`,
      nextTopic: openTopic("game_selection", "resolve a game choice before changing topics", nowMs),
    };
  }

  if (isTaskReplacementCue || scores.taskEscalation.score >= 1.8) {
    return {
      act: "task_request",
      reason: isTaskReplacementCue
        ? "explicit task replacement cue"
        : `scored task escalation (${scores.taskEscalation.score.toFixed(1)}): ${scores.taskEscalation.reasons.join(",") || "signal"}`,
      nextTopic: openTopic("general_request", "create and explain a task before changing topics", nowMs),
    };
  }

  if (isTaskSuggestionQuestion) {
    return {
      act: "task_request",
      reason: "task suggestion question should stay on the task rail",
      nextTopic: openTopic("general_request", "create and explain a task before changing topics", nowMs),
    };
  }

  if (scores.taskRequest.score >= 1.8 && scores.taskRequest.score >= scores.question.score) {
    return {
      act: "task_request",
      reason: `scored task request (${scores.taskRequest.score.toFixed(1)}): ${scores.taskRequest.reasons.join(",") || "signal"}`,
      nextTopic: openTopic("general_request", "create and explain a task before changing topics", nowMs),
    };
  }

  if (scores.question.score >= 1.2) {
    return {
      act: "user_question",
      reason: `scored question (${scores.question.score.toFixed(1)}): ${scores.question.reasons.join(",") || "signal"}`,
      nextTopic:
        currentTopic ??
        (isGameRulesQuestion
          ? openTopic("game_selection", "resolve a game choice before changing topics", nowMs)
          : currentTopic),
    };
  }

  if (currentTopic?.topic_state === "open" && !hasStakeSignal(text)) {
    const explicitChoiceSignal = scores.answerActivityChoice.score >= 1.1;
    const shortChoiceSignal =
      currentTopic.topic_type === "game_selection" &&
      scores.acknowledgement.score < 1 &&
      scores.wordCount <= 6;
    if (
      explicitChoiceSignal ||
      shortChoiceSignal
    ) {
      return {
        act: "answer_activity_choice",
        reason: `open topic with game-choice signal (${scores.answerActivityChoice.score.toFixed(1)})`,
        nextTopic: currentTopic,
      };
    }
  }

  if (input.awaitingUser) {
    return {
      act: "user_answer",
      reason: "awaiting user answer and input is not a question",
      nextTopic: currentTopic,
    };
  }

  if (scores.acknowledgement.score >= 1) {
    return {
      act: "acknowledgement",
      reason: `scored acknowledgement (${scores.acknowledgement.score.toFixed(1)}): ${scores.acknowledgement.reasons.join(",") || "signal"}`,
      nextTopic: currentTopic,
    };
  }

  return {
    act: "other",
    reason: "default route",
    nextTopic:
      currentTopic ??
      (text.includes("game")
        ? openTopic("game_selection", "resolve a game choice before changing topics", nowMs)
        : null),
  };
}
