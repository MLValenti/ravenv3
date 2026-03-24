import {
  buildPriorBeatOpinionReply,
  buildHumanQuestionFallback,
  buildTopicInitiationReply,
  isTopicInitiationRequest,
} from "../chat/open-question.ts";
import {
  buildCoreConversationReply,
  isStableCoreConversationMove,
  type CoreConversationMove,
} from "../chat/core-turn-move.ts";
import {
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isChatSwitchRequest,
  isChatLikeSmalltalk,
  isGoalOrIntentStatement,
  isMutualGettingToKnowRequest,
  isProfileSummaryRequest,
  isProfileBuildingRequest,
} from "./interaction-mode.ts";
import {
  buildChatSwitchReply,
  buildOpenChatGreeting,
  buildOpenChatNudge,
} from "./mode-style.ts";
import { buildCommitmentFallback } from "./commitment-engine.ts";
import { buildSceneFallback } from "./scene-state.ts";
import {
  buildShortClarificationReply,
  isShortClarificationTurn,
} from "./short-follow-up.ts";
import { buildTurnPlanFallback } from "../chat/turn-plan.ts";
import type { ResponseGateInput } from "./response-gate.ts";

type GameStartInspectionLike = {
  detected: boolean;
};

export type ResponseGateCandidateBuilderInput = {
  gateInput: ResponseGateInput;
  continuityTopic: string | null;
  conversationMove: CoreConversationMove;
  activeTaskThread: boolean;
  enforceTurnPlan: boolean;
  explicitActivityDelegation: boolean;
};

export type ResponseGateCandidateBuilder = {
  shouldAllowGameStartContract: (inspection: GameStartInspectionLike) => boolean;
  buildOpenConversationFallback: () => string;
  buildFallback: () => string;
  buildTurnPlanFallback: () => string;
  buildDuplicateNudge: (fallback: string) => string;
  buildNoVisualClaimFallback: () => string;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isBareOpinionFollowUp(text: string): boolean {
  return /^(?:what do you think|and what do you think|what about you|thoughts)\??$/i.test(
    normalize(text),
  );
}

function isGameTopicActive(input: ResponseGateInput): boolean {
  return (
    input.sceneState.interaction_mode === "game" ||
    input.sceneState.topic_type === "game_setup" ||
    input.sceneState.topic_type === "game_execution" ||
    input.sceneState.topic_type === "reward_negotiation" ||
    input.sceneState.topic_type === "reward_window"
  );
}

function shouldPreferOpenConversationFallback(
  input: ResponseGateInput,
  conversationMove: CoreConversationMove,
  activeTaskThread: boolean,
): boolean {
  if (
    activeTaskThread ||
    input.sceneState.topic_type === "duration_negotiation" ||
    input.sceneState.topic_type === "task_terms_negotiation" ||
    input.sceneState.topic_type === "reward_negotiation" ||
    input.sceneState.topic_type === "reward_window" ||
    input.sceneState.topic_type === "game_setup" ||
    input.sceneState.topic_type === "game_execution" ||
    input.sceneState.topic_type === "verification_in_progress" ||
    input.sceneState.interaction_mode === "profile_building"
  ) {
    return false;
  }
  if (
    isAssistantSelfQuestion(input.userText) ||
    isMutualGettingToKnowRequest(input.userText) ||
    isTopicInitiationRequest(input.userText) ||
    isBareOpinionFollowUp(input.userText)
  ) {
    return true;
  }
  if (input.dialogueAct === "user_question" || input.dialogueAct === "short_follow_up") {
    return true;
  }
  return isStableCoreConversationMove(conversationMove);
}

export function createResponseGateCandidateBuilder(
  input: ResponseGateCandidateBuilderInput,
): ResponseGateCandidateBuilder {
  const { gateInput, continuityTopic, conversationMove, activeTaskThread, enforceTurnPlan } = input;

  const buildOpenConversationFallback = (): string => {
    const toneProfile = gateInput.toneProfile ?? "neutral";
    const conversationFallback = buildCoreConversationReply({
      userText: gateInput.userText,
      previousAssistantText: gateInput.lastAssistantText,
      currentTopic: continuityTopic,
    });
    if (isTopicInitiationRequest(gateInput.userText)) {
      return buildTopicInitiationReply({
        userText: gateInput.userText,
        currentTopic: continuityTopic,
        tone: toneProfile,
      });
    }
    if (isBareOpinionFollowUp(gateInput.userText) && gateInput.lastAssistantText) {
      return buildPriorBeatOpinionReply(gateInput.lastAssistantText);
    }
    if (isShortClarificationTurn(gateInput.userText)) {
      return buildShortClarificationReply({
        userText: gateInput.userText,
        interactionMode: gateInput.sceneState.interaction_mode,
        topicType: gateInput.sceneState.topic_type,
        lastAssistantText: gateInput.lastAssistantText,
        lastUserText:
          gateInput.sessionMemory?.last_user_answer?.value ??
          gateInput.sessionMemory?.last_user_question?.value ??
          null,
        lastUserAnswer: gateInput.sessionMemory?.last_user_answer?.value ?? null,
        currentTopic: gateInput.sceneState.agreed_goal || null,
      });
    }
    if (isChatSwitchRequest(gateInput.userText)) {
      return buildChatSwitchReply();
    }
    if (isProfileSummaryRequest(gateInput.userText)) {
      return "Not much yet. Give me one thing about yourself that is actually worth keeping, and I will hold onto it.";
    }
    if (isMutualGettingToKnowRequest(gateInput.userText)) {
      return "Good. We can play it both ways. Put a real question on me first, then I may put one back on you.";
    }
    if (isAssistantSelfQuestion(gateInput.userText)) {
      return buildHumanQuestionFallback(gateInput.userText, toneProfile, {
        previousAssistantText: gateInput.lastAssistantText,
        currentTopic: continuityTopic,
        inventory: gateInput.inventory ?? null,
      });
    }
    if (
      gateInput.sceneState.interaction_mode === "profile_building" ||
      isProfileBuildingRequest(gateInput.userText)
    ) {
      return (
        buildSceneFallback(
          gateInput.sceneState,
          gateInput.userText,
          gateInput.sessionMemory,
          gateInput.inventory,
        ) ??
        "Fine. Give me one thing I should understand about you, or tell me what I should get right about you first."
      );
    }
    if (isGoalOrIntentStatement(gateInput.userText)) {
      return (
        buildCoreConversationReply({
          userText: gateInput.userText,
          previousAssistantText: gateInput.lastAssistantText,
          currentTopic: continuityTopic,
        }) ??
        "If you want something from me, say what you want it to change, and I will stay with that."
      );
    }
    if (isChatLikeSmalltalk(gateInput.userText)) {
      return buildOpenChatGreeting();
    }
    if (gateInput.dialogueAct === "user_question" || gateInput.dialogueAct === "short_follow_up") {
      return buildHumanQuestionFallback(gateInput.userText, toneProfile, {
        previousAssistantText: gateInput.lastAssistantText,
        currentTopic: continuityTopic,
        inventory: gateInput.inventory ?? null,
      });
    }
    if (conversationFallback) {
      return conversationFallback;
    }
    return buildOpenChatNudge();
  };

  const buildFallback = (): string => {
    const commitmentFallback = buildCommitmentFallback(gateInput.commitmentState, gateInput.userText);
    if (commitmentFallback) {
      return commitmentFallback;
    }
    if (isAssistantSelfQuestion(gateInput.userText)) {
      return buildOpenConversationFallback();
    }
    if (isBareOpinionFollowUp(gateInput.userText) && gateInput.lastAssistantText) {
      return buildOpenConversationFallback();
    }
    if (shouldPreferOpenConversationFallback(gateInput, conversationMove, activeTaskThread)) {
      return buildOpenConversationFallback();
    }
    const sceneFallback = buildSceneFallback(
      gateInput.sceneState,
      gateInput.userText,
      gateInput.sessionMemory,
      gateInput.inventory,
    );
    if (sceneFallback) {
      return sceneFallback;
    }
    return buildOpenConversationFallback();
  };

  const buildTurnPlanFallbackCandidate = (): string => {
    const turnPlan = gateInput.turnPlan;
    if (
      isAssistantSelfQuestion(gateInput.userText) ||
      isAssistantServiceQuestion(gateInput.userText) ||
      isMutualGettingToKnowRequest(gateInput.userText)
    ) {
      return buildFallback();
    }
    if (turnPlan && enforceTurnPlan) {
      return buildTurnPlanFallback(turnPlan, gateInput.toneProfile ?? "neutral");
    }
    return buildFallback();
  };

  const buildDuplicateNudge = (fallback: string): string => {
    const cleanedFallback = fallback.replace(/^good\.\s*/i, "").trim();
    const normalizedUser = normalize(gateInput.userText).toLowerCase();
    const hasWagerCue = /\b(bet|wager|stakes|if i win|if you win)\b/i.test(normalizedUser);

    if (gateInput.sceneState.topic_type === "reward_negotiation" || hasWagerCue) {
      return `No dodging, pet. ${cleanedFallback}`;
    }

    if (
      gateInput.sceneState.topic_type === "game_setup" ||
      gateInput.sceneState.topic_type === "game_execution"
    ) {
      return `Stay on this game, pet. ${cleanedFallback}`;
    }

    if (gateInput.sceneState.topic_type === "task_execution") {
      return `No drifting, pet. ${cleanedFallback}`;
    }

    return `Answer directly, pet. ${cleanedFallback}`;
  };

  const buildNoVisualClaimFallback = (): string => {
    const reason = gateInput.observationTrust?.reason ? ` (${gateInput.observationTrust.reason})` : "";
    return `I do not have a fresh camera read right now${reason}, so I will not claim what I see. Ask again once the feed refreshes.`;
  };

  const shouldAllowGameStartContract = (inspection: GameStartInspectionLike): boolean => {
    if (!inspection.detected) {
      return false;
    }
    if (isGameTopicActive(gateInput)) {
      return true;
    }
    if (gateInput.dialogueAct === "propose_activity" || gateInput.dialogueAct === "answer_activity_choice") {
      return true;
    }
    return input.explicitActivityDelegation;
  };

  return {
    shouldAllowGameStartContract,
    buildOpenConversationFallback,
    buildFallback,
    buildTurnPlanFallback: buildTurnPlanFallbackCandidate,
    buildDuplicateNudge,
    buildNoVisualClaimFallback,
  };
}
