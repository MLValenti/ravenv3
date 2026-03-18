import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  buildHumanQuestionFallback,
  buildTopicInitiationReply,
  isTopicInitiationRequest,
} from "../chat/open-question.ts";
import { buildCoreConversationReply } from "../chat/core-turn-move.ts";
import { buildDeterministicGameStart, selectDeterministicGameTemplate, type DeterministicGameTemplateId } from "./game-script.ts";
import { isAssistantSelfQuestion, isGoalOrIntentStatement } from "./interaction-mode.ts";
import { buildOpenChatGreeting, buildRelationalTurnBack } from "./mode-style.ts";
import { buildRelationalChatReply } from "./scene-scaffolds.ts";
import type { SceneState } from "./scene-state.ts";
import { buildShortClarificationReply } from "./short-follow-up.ts";
import type { WorkingMemory } from "./working-memory.ts";

function extractRequestedTopic(userText: string): string | null {
  const match = userText.match(/\b(?:talk about|discuss|focus on|explore)\s+([^.!?]{2,80})/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1]
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[.?!]+$/g, "");
}

function chooseFallbackGameTemplateId(
  userText: string,
  sceneState?: SceneState,
): DeterministicGameTemplateId {
  const hasStakesCue =
    Boolean(sceneState?.stakes) ||
    /\b(stakes?|bet|wager|if i win|if you win|on the line)\b/i.test(userText);
  const selected = selectDeterministicGameTemplate({
    userText,
    hasStakes: hasStakesCue,
    rotationIndex: sceneState?.game_rotation_index ?? 0,
  });
  return selected.id;
}

export function buildTopicFallback(
  act: DialogueRouteAct,
  userText: string,
  workingMemory: WorkingMemory,
  sceneState?: SceneState,
): string {
  const conversationFallback = buildCoreConversationReply({
    userText,
    currentTopic: workingMemory.session_topic?.label ?? sceneState?.agreed_goal ?? null,
  });
  const topic = workingMemory.session_topic;
  if (topic?.topic_type === "game_selection" && topic.topic_state === "open") {
    if (act === "propose_activity") {
      return "Fine. I will choose. Do you want something quick or something that takes a few minutes?";
    }
    if (act === "answer_activity_choice") {
      return buildDeterministicGameStart(chooseFallbackGameTemplateId(userText, sceneState));
    }
  }
  if (act === "task_request") {
    return "Tell me the domain or time window you want, and I will shape the task properly.";
  }
  if (act === "duration_request") {
    return "Point to the exact duration detail you want clarified, and I will answer it directly.";
  }
  if (isAssistantSelfQuestion(userText)) {
    return buildRelationalChatReply(userText);
  }
  if (isTopicInitiationRequest(userText)) {
    return buildTopicInitiationReply({
      userText,
      currentTopic: topic?.label ?? null,
      tone: "neutral",
    });
  }
  if (/\bwhat do you want (?:from me|me to do|to do)\b/i.test(userText)) {
    return buildHumanQuestionFallback(userText, "neutral", {
      currentTopic: sceneState?.agreed_goal || null,
    });
  }
  const requestedTopic = extractRequestedTopic(userText);
  if (requestedTopic) {
    return buildTopicInitiationReply({
      userText,
      currentTopic: requestedTopic,
      tone: "neutral",
    });
  }
  if (/^(hi|hello|hey)\b/i.test(userText.trim())) {
    return buildOpenChatGreeting();
  }
  if (act === "user_question") {
    return buildHumanQuestionFallback(userText, "neutral", {
      currentTopic: sceneState?.agreed_goal || null,
    });
  }
  if (act === "short_follow_up") {
    return buildShortClarificationReply({
      userText,
      interactionMode: sceneState?.interaction_mode,
      topicType: sceneState?.topic_type,
    });
  }
  if (act === "confusion") {
    return "Show me the part that went muddy, and I will sharpen it.";
  }
  if (act === "user_answer") {
    if (isGoalOrIntentStatement(userText)) {
      return "Good. Tell me what that actually means to you.";
    }
    return conversationFallback ?? "Good. Give me the layer underneath it.";
  }
  if (act === "acknowledgement" && workingMemory.last_assistant_commitment) {
    return `Noted. Next we follow through on ${workingMemory.last_assistant_commitment}.`;
  }
  if ((act === "acknowledgement" || act === "other") && conversationFallback) {
    return conversationFallback;
  }
  return "Then start with what actually holds your attention, and I will stay with that.";
}
