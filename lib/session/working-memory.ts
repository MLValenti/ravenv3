import type { DialogueRouteAct, SessionTopic } from "../dialogue/router.ts";

export type WorkingMemory = {
  current_topic: string;
  last_user_intent: DialogueRouteAct | "none";
  last_user_request: string;
  last_assistant_commitment: string;
  rolling_summary: string;
  session_topic: SessionTopic | null;
  user_turn_count: number;
};

type UserTurnInput = {
  text: string;
  act: DialogueRouteAct;
  nextTopic: SessionTopic | null;
};

type AssistantTurnInput = {
  commitment?: string | null;
  topicResolved?: boolean;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function summarizeTopic(topic: SessionTopic | null): string {
  if (!topic) {
    return "none";
  }
  return `${topic.topic_type}:${topic.topic_state} ${topic.summary}`.trim();
}

function buildRollingSummary(memory: WorkingMemory): string {
  const parts = [
    memory.current_topic !== "none" ? `Topic ${memory.current_topic}.` : "",
    memory.last_user_request ? `User asked: ${memory.last_user_request}.` : "",
    memory.last_assistant_commitment
      ? `Raven committed to: ${memory.last_assistant_commitment}.`
      : "",
  ].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return "No recent summary yet.";
  }
  return parts.join(" ").slice(0, 280);
}

export function createWorkingMemory(): WorkingMemory {
  return {
    current_topic: "none",
    last_user_intent: "none",
    last_user_request: "",
    last_assistant_commitment: "",
    rolling_summary: "No recent summary yet.",
    session_topic: null,
    user_turn_count: 0,
  };
}

export function noteWorkingMemoryUserTurn(
  memory: WorkingMemory,
  input: UserTurnInput,
): WorkingMemory {
  const lastUserRequest = normalize(input.text).slice(0, 220);
  const next: WorkingMemory = {
    ...memory,
    current_topic: summarizeTopic(input.nextTopic),
    last_user_intent: input.act,
    last_user_request: lastUserRequest,
    session_topic: input.nextTopic,
    user_turn_count: memory.user_turn_count + 1,
  };

  if (next.user_turn_count % 4 === 0) {
    next.rolling_summary = buildRollingSummary(next);
  }
  return next;
}

export function noteWorkingMemoryAssistantTurn(
  memory: WorkingMemory,
  input: AssistantTurnInput,
): WorkingMemory {
  const nextTopic =
    input.topicResolved && memory.session_topic
      ? { ...memory.session_topic, topic_state: "resolved" as const }
      : memory.session_topic;
  const next: WorkingMemory = {
    ...memory,
    current_topic: summarizeTopic(nextTopic),
    session_topic: nextTopic,
    last_assistant_commitment: normalize(input.commitment ?? memory.last_assistant_commitment).slice(
      0,
      220,
    ),
  };
  return {
    ...next,
    rolling_summary: buildRollingSummary(next),
  };
}

export function buildWorkingMemoryBlock(memory: WorkingMemory): string {
  return [
    "Working Memory:",
    `Topic: ${memory.current_topic || "none"}`,
    `Rolling summary: ${memory.rolling_summary || "No recent summary yet."}`,
    `Last user request: ${memory.last_user_request || "none"}`,
    `Next commitment: ${memory.last_assistant_commitment || "none"}`,
  ].join("\n");
}
