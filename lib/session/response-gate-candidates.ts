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
import { buildSceneScaffoldReply } from "./scene-scaffolds.ts";
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

function looksLikeProfileDisclosure(text: string): boolean {
  return /\b(call me|my name is|my name's|i like\b|i like to\b|i enjoy\b|my hobbies are\b|my hobby is\b|i prefer\b|what i want you to remember\b|you should know that\b)\b/i.test(
    normalize(text),
  );
}

function looksLikeChoiceOrThreadAnswer(
  text: string,
  previousAssistantText: string | null,
): boolean {
  const normalized = normalize(text).toLowerCase();
  const previous = normalize(previousAssistantText ?? "").toLowerCase();
  if (
    /\bwhat has your attention tonight\b/.test(previous) &&
    /^(chat|plan|game)$/i.test(normalized)
  ) {
    return true;
  }
  if (
    /\bwhat has the most pressure on you right now\b/.test(previous) &&
    /^(work|(?:a )?person|(?:a )?(decision|choice))$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

function isTaskRepairCue(text: string): boolean {
  return /\b(what counts as done|why that task|why this task|set me another one|give me another one|give me the next one|next task|what else should i do now)\b/i.test(
    normalize(text),
  );
}

function shouldBlockTaskRepairForFreshCasualTurn(gateInput: ResponseGateInput): boolean {
  if (
    gateInput.sceneState.interaction_mode !== "normal_chat" &&
    gateInput.sceneState.interaction_mode !== "relational_chat" &&
    gateInput.sceneState.interaction_mode !== "question_answering" &&
    gateInput.sceneState.interaction_mode !== "profile_building"
  ) {
    return false;
  }
  if (isTaskRepairCue(gateInput.userText)) {
    return false;
  }
  const normalized = normalize(gateInput.userText).toLowerCase();
  return (
    /^(work|chat|plan|game)$/i.test(normalized) ||
    /^(?:what do you mean|go on|keep going|why)\??$/.test(normalized) ||
    /^(?:i like|i love|i enjoy|i want|i wanted|i prefer|i think|i feel|call me|my name is|my name's|i'm into|i am into)\b/.test(
      normalized,
    ) ||
    /^(?:what do you think about|what's your take on|where do we start|okay ask|ok ask|ask me more questions|tell me more about you|tell me more about me|what do you want to know about me)\b/.test(
      normalized,
    )
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

function resolveTaskRepairDomain(input: ResponseGateInput): ResponseGateInput["sceneState"]["current_task_domain"] {
  if (
    input.sceneState.task_spec.requested_domain !== "none" &&
    /^(general|device|frame|posture|hands|kneeling|shoulders|stillness)$/.test(
      input.sceneState.task_spec.requested_domain,
    )
  ) {
    return input.sceneState.task_spec.requested_domain;
  }
  if (
    input.sceneState.user_requested_task_domain !== "none" &&
    /^(general|device|frame|posture|hands|kneeling|shoulders|stillness)$/.test(
      input.sceneState.user_requested_task_domain,
    )
  ) {
    return input.sceneState.user_requested_task_domain;
  }
  if (input.sceneState.locked_task_domain !== "none") {
    return input.sceneState.locked_task_domain;
  }
  if (input.sceneState.current_task_domain !== "general") {
    return input.sceneState.current_task_domain;
  }
  if (/\b(stillness|steady|hold)\b/.test(input.sceneState.task_spec.current_task_family)) {
    return "stillness";
  }
  return "general";
}

function buildTaskRepairScene(gateInput: ResponseGateInput) {
  const repairDomain = resolveTaskRepairDomain(gateInput);
  const explicitNextTaskRequest = /\b(set me another one|give me another one|give me the next one|next task|another task|new task)\b/i.test(
    normalize(gateInput.userText),
  );
  const requestedDomainForRepair = explicitNextTaskRequest ? "general" : repairDomain;
  return {
    ...gateInput.sceneState,
    interaction_mode: "task_planning" as const,
    topic_type: "task_execution" as const,
    topic_locked: true,
    topic_state: "open" as const,
    task_progress: explicitNextTaskRequest
      ? ("completed" as const)
      : gateInput.sceneState.task_progress,
    current_task_domain: requestedDomainForRepair,
    locked_task_domain: requestedDomainForRepair,
    user_requested_task_domain: explicitNextTaskRequest
      ? requestedDomainForRepair
      : gateInput.sceneState.user_requested_task_domain,
      task_spec: {
        ...gateInput.sceneState.task_spec,
        request_fulfilled: true,
        requested_domain:
          explicitNextTaskRequest
            ? requestedDomainForRepair
            : gateInput.sceneState.task_spec.requested_domain === "none" ||
          !/^(general|device|frame|posture|hands|kneeling|shoulders|stillness)$/.test(
            gateInput.sceneState.task_spec.requested_domain,
          )
            ? repairDomain
            : gateInput.sceneState.task_spec.requested_domain,
      request_kind: explicitNextTaskRequest
        ? ("replacement" as const)
        : gateInput.sceneState.task_spec.request_kind,
      next_required_action: explicitNextTaskRequest
        ? ("fulfill_request" as const)
        : gateInput.sceneState.task_spec.next_required_action,
      request_stage: explicitNextTaskRequest
        ? ("ready_to_fulfill" as const)
        : gateInput.sceneState.task_spec.request_stage,
      selection_mode: explicitNextTaskRequest
        ? ("direct_assignment" as const)
        : gateInput.sceneState.task_spec.selection_mode,
    },
  };
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
  const isTrueActiveGameContext =
    gateInput.sceneState.interaction_mode === "game" &&
    gateInput.sceneState.topic_locked &&
    (gateInput.sceneState.topic_type === "game_setup" ||
      gateInput.sceneState.topic_type === "game_execution" ||
      gateInput.sceneState.topic_type === "reward_window");
  const hasStaleGameTopic =
    !isTrueActiveGameContext &&
    (gateInput.sceneState.topic_type === "game_setup" ||
      gateInput.sceneState.topic_type === "game_execution" ||
      gateInput.sceneState.topic_type === "reward_window");
  const taskRepairBlocked = shouldBlockTaskRepairForFreshCasualTurn(gateInput);

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
        trainingThread: gateInput.sceneState.active_training_thread,
      });
    }
    if (
      gateInput.sceneState.interaction_mode === "profile_building" ||
      isProfileBuildingRequest(gateInput.userText) ||
      looksLikeProfileDisclosure(gateInput.userText) ||
      looksLikeChoiceOrThreadAnswer(gateInput.userText, gateInput.lastAssistantText)
    ) {
      return buildHumanQuestionFallback(gateInput.userText, toneProfile, {
        previousAssistantText: gateInput.lastAssistantText,
        currentTopic: continuityTopic,
        inventory: gateInput.inventory ?? null,
        trainingThread: gateInput.sceneState.active_training_thread,
      });
    }
    if (
      (gateInput.sceneState.interaction_mode === "normal_chat" ||
        gateInput.sceneState.interaction_mode === "question_answering") &&
      (gateInput.sceneState.topic_type === "none" ||
        gateInput.sceneState.topic_type === "general_request") &&
      looksLikeProfileDisclosure(gateInput.userText)
    ) {
      return (
        buildHumanQuestionFallback(gateInput.userText, toneProfile, {
          previousAssistantText: gateInput.lastAssistantText,
          currentTopic: continuityTopic,
          inventory: gateInput.inventory ?? null,
          trainingThread: gateInput.sceneState.active_training_thread,
        }) ??
        buildSceneFallback(
          gateInput.sceneState,
          gateInput.userText,
          gateInput.sessionMemory,
          gateInput.inventory,
        )
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
        trainingThread: gateInput.sceneState.active_training_thread,
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
    if (isTrueActiveGameContext) {
      const gameFollowThroughFallback = buildSceneScaffoldReply({
        act: gateInput.dialogueAct ?? "other",
        userText: gateInput.userText,
        sceneState: gateInput.sceneState,
        sessionMemory: gateInput.sessionMemory ?? undefined,
        inventory: gateInput.inventory ?? undefined,
      });
      if (gameFollowThroughFallback) {
        return gameFollowThroughFallback;
      }
    }
    if (hasStaleGameTopic) {
      if (
        !taskRepairBlocked &&
        (
          activeTaskThread ||
          isTaskRepairCue(gateInput.userText)
        ) &&
        (gateInput.dialogueAct === "user_question" || gateInput.dialogueAct === "short_follow_up")
      ) {
        const taskFallback = buildSceneScaffoldReply({
          act: gateInput.dialogueAct,
          userText: gateInput.userText,
          sceneState: buildTaskRepairScene(gateInput),
          sessionMemory: gateInput.sessionMemory ?? undefined,
          inventory: gateInput.inventory ?? undefined,
        });
        if (taskFallback) {
          return taskFallback;
        }
      }
      if (gateInput.dialogueAct === "user_question" || gateInput.dialogueAct === "short_follow_up") {
        return buildHumanQuestionFallback(gateInput.userText, gateInput.toneProfile ?? "neutral", {
          previousAssistantText: gateInput.lastAssistantText,
          currentTopic: continuityTopic,
          inventory: gateInput.inventory ?? null,
          trainingThread: gateInput.sceneState.active_training_thread,
        });
      }
      return buildOpenConversationFallback();
    }
    if (
      gateInput.dialogueAct === "duration_request" &&
      gateInput.sceneState.topic_type === "task_execution" &&
      gateInput.sceneState.task_spec.request_kind === "revision"
    ) {
      const durationRevisionFallback = buildSceneScaffoldReply({
        act: gateInput.dialogueAct,
        userText: gateInput.userText,
        sceneState: gateInput.sceneState,
        sessionMemory: gateInput.sessionMemory ?? undefined,
        inventory: gateInput.inventory ?? undefined,
      });
      if (durationRevisionFallback) {
        return durationRevisionFallback;
      }
    }
    if (isTaskRepairCue(gateInput.userText)) {
      const taskFallback = buildSceneScaffoldReply({
        act: gateInput.dialogueAct ?? "other",
        userText: gateInput.userText,
        sceneState: buildTaskRepairScene(gateInput),
        sessionMemory: gateInput.sessionMemory ?? undefined,
        inventory: gateInput.inventory ?? undefined,
      });
      if (taskFallback) {
        return taskFallback;
      }
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
    if (
      !taskRepairBlocked &&
      gateInput.sceneState.topic_type === "task_execution" &&
      (gateInput.dialogueAct === "user_question" || gateInput.dialogueAct === "short_follow_up")
    ) {
      const taskExecutionFallback = buildSceneScaffoldReply({
        act: gateInput.dialogueAct,
        userText: gateInput.userText,
        sceneState: buildTaskRepairScene(gateInput),
        sessionMemory: gateInput.sessionMemory ?? undefined,
        inventory: gateInput.inventory ?? undefined,
      });
      if (taskExecutionFallback) {
        return taskExecutionFallback;
      }
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
    if (isTaskRepairCue(gateInput.userText)) {
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
    const previousAssistant = normalize(gateInput.lastAssistantText ?? "").toLowerCase();

    if (gateInput.sceneState.topic_type === "reward_negotiation" || hasWagerCue) {
      return `No dodging, pet. ${cleanedFallback}`;
    }

    if (
      isTrueActiveGameContext &&
      (gateInput.sceneState.topic_type === "game_setup" ||
        gateInput.sceneState.topic_type === "game_execution")
    ) {
      const variants = [
        `Stay on this game, pet. ${cleanedFallback}`,
        `No drifting, pet. ${cleanedFallback}`,
        `Answer directly, pet. ${cleanedFallback}`,
      ];
      return (
        variants.find((candidate) => normalize(candidate).toLowerCase() !== previousAssistant) ??
        variants[0]!
      );
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
