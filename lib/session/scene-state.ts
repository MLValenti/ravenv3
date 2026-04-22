import type { ProfileProgressRow } from "@/lib/db";
import type { ProfileState } from "@/lib/profile";
import type { DialogueRouteAct, SessionTopic } from "../dialogue/router.ts";
import {
  detectWagerDelegation,
  hasStakeSignal,
  isGameChoiceDelegation,
  isGameNextPromptQuestion,
  isGameRulesQuestion,
  isGameStartCue,
  normalizeUserText,
  wantsAnotherRound,
  type WagerDelegationMode,
} from "../dialogue/user-signals.ts";
import {
  hasTaskEscalationSignal,
  scoreDialogueIntentSignals,
  type DialogueIntentScores,
} from "../dialogue/intent-score.ts";
import {
  buildDeterministicGameImmediatePrompt,
  buildDeterministicGameOutcomeLine,
  buildDeterministicGameRewardLine,
  buildDeterministicGameLeverageLine,
  buildDeterministicGameNextBeatLine,
  buildDeterministicGameStart,
  buildDeterministicGameTurnReply,
  buildGameExecutionExpectedAction,
  buildGameExecutionRule,
  deriveDeterministicGameOutcome,
  detectRequestedDeterministicGameTemplateId,
  detectDeterministicGameTemplateId,
  deriveGameProgressFromUserText,
  isTerminalDeterministicGameProgress,
  isValidDeterministicGameAnswer,
  parseChosenNumber,
  isDeterministicGameChoiceText,
  isDeterministicGameCompletionText,
  resolveDeterministicGameTemplateById,
  selectDeterministicGameTemplate,
  type DeterministicGameOutcome,
  type DeterministicGameRewardState,
  type DeterministicGameProgress,
  type DeterministicGameTemplateId,
} from "./game-script.ts";
import {
  type SessionInventoryItem,
} from "./session-inventory.ts";
import {
  buildDeterministicTaskDurationReply,
  buildDeterministicTaskFollowUp,
  buildTaskExecutionExpectedAction,
  buildTaskExecutionRule,
  detectTaskDomainFromUserText,
  detectDeterministicTaskTemplateIdFromAssignmentText,
  formatTaskDomainLabel,
  deriveTaskProgressFromUserText,
  extractTaskDurationMinutes,
  isFinalTaskAssignmentText,
  isTaskAssignmentText,
  isTaskCompletionConfirmationText,
  pickNextDeterministicTaskVariantIndex,
  resolveDeterministicTaskTemplateById,
  selectDeterministicTaskTemplate,
  taskDomainFromTemplateId,
  type DeterministicTaskProgress,
  type TaskDomain,
  type DeterministicTaskTemplateId,
} from "./task-script.ts";
import {
  buildTaskCandidateReply,
  buildTaskCandidatesFromSpec,
  buildTaskOptionsReply,
  chooseNextTaskSpecQuestion,
  buildTaskSpecPromptBlock,
  createTaskSpec,
  noteTaskSpecAssistantText,
  noteTaskSpecAssistantAssignment,
  selectTaskCandidate,
  selectTaskOptions,
  noteTaskSpecUserTurn,
  syncTaskSpecSceneFields,
  type TaskSpec,
} from "./task-spec.ts";
import {
  isAssistantSelfQuestion,
  isAssistantTrainingRequest,
  isChatSwitchRequest,
  isChatLikeSmalltalk,
  isMutualGettingToKnowRequest,
  isNormalChatRequest,
  isProfileSummaryRequest,
  isProfileBuildingRequest,
  isRelationalOfferStatement,
  normalizeInteractionMode,
  type InteractionMode,
} from "./interaction-mode.ts";
import { detectRepairTurnKind } from "../chat/repair-turn.ts";
import {
  buildChatSwitchReply,
  buildRelationalTurnBack,
} from "./mode-style.ts";
import {
  buildShortClarificationReply,
  isShortClarificationTurn,
} from "./short-follow-up.ts";
import { inspectGameStartContract } from "./game-start-contract.ts";
import { planDynamicWagerTerms } from "./task-wager-planner.ts";
import { resolveSessionTopic, type SessionTopicType } from "./session-director.ts";
import {
  buildAssistantServiceReply,
  buildHumanQuestionFallback,
  buildPlanningQuestionFallback,
} from "../chat/open-question.ts";
import { buildCoreConversationReply } from "../chat/core-turn-move.ts";
import type { SessionMemory } from "./session-memory.ts";
import { buildProfileMemorySummaryReply } from "./session-memory.ts";
import {
  createEmptyTrainingThread,
  buildTrainingFollowUpReply,
  extractTrainingThreadFromAssistantText,
  type TrainingThreadState,
} from "./training-thread.ts";

export type SceneTopicType = SessionTopicType;

export type SceneState = {
  interaction_mode: InteractionMode;
  topic_type: SceneTopicType;
  topic_locked: boolean;
  topic_state: "open" | "resolved";
  resume_topic_type: SceneTopicType;
  resume_topic_locked: boolean;
  resume_topic_state: "open" | "resolved";
  scene_type: string;
  game_template_id: DeterministicGameTemplateId;
  game_rotation_index: number;
  game_progress: DeterministicGameProgress;
  last_game_progress: DeterministicGameProgress;
  game_number_choice?: number | null;
  game_outcome: DeterministicGameOutcome;
  game_reward_state: DeterministicGameRewardState;
  free_pass_count: number;
  agreed_goal: string;
  stakes: string;
  win_condition: string;
  lose_condition: string;
  task_reward: string;
  task_consequence: string;
  task_progress: DeterministicTaskProgress;
  task_template_id: DeterministicTaskTemplateId;
  task_variant_index: number;
  task_duration_minutes: number;
  current_task_domain: TaskDomain;
  locked_task_domain: TaskDomain | "none";
  user_requested_task_domain: TaskDomain | "none";
  can_replan_task: boolean;
  reason_for_lock: string;
  task_hard_lock_active: boolean;
  task_paused: boolean;
  task_spec: TaskSpec;
  current_rule: string;
  current_subtask: string;
  next_expected_user_action: string;
  last_verified_action: string;
  last_assistant_text: string;
  active_training_thread: TrainingThreadState;
  resume_current_rule: string;
  resume_current_subtask: string;
  resume_next_expected_user_action: string;
  profile_prompt_count: number;
  last_profile_prompt: string;
};

type SceneUserTurnInput = {
  text: string;
  act: DialogueRouteAct;
  sessionTopic: SessionTopic | null;
  deviceControlActive?: boolean;
  inventory?: SessionInventoryItem[];
  profile?: ProfileState;
  progress?: Pick<ProfileProgressRow, "current_tier" | "free_pass_count" | "last_completion_summary">;
};

type SceneAssistantTurnInput = {
  text: string;
  commitment?: string | null;
  topicResolved?: boolean;
};

function isDelegatedWagerChoice(value: string): boolean {
  return /\b(?:you|raven)\s+(?:can\s+)?(?:pick|choose|decide|set)\b/i.test(value) ||
    /\b(?:your|raven'?s)\s+choice\b/i.test(value);
}

function deriveAutoWagerTerms(input: {
  mode: WagerDelegationMode;
  userText: string;
  deviceControlActive?: boolean;
  inventory?: SessionInventoryItem[];
  currentStakes: string;
  currentWinCondition: string;
  currentLoseCondition: string;
  profile?: ProfileState;
  progress?: Pick<ProfileProgressRow, "current_tier" | "free_pass_count" | "last_completion_summary">;
}): {
  stakes: string;
  winCondition: string;
  loseCondition: string;
} {
  const delegatedWinCondition =
    input.currentWinCondition && !isDelegatedWagerChoice(input.currentWinCondition)
      ? input.currentWinCondition
      : "";
  const delegatedLoseCondition =
    input.currentLoseCondition && !isDelegatedWagerChoice(input.currentLoseCondition)
      ? input.currentLoseCondition
      : "";
  const planned = planDynamicWagerTerms({
    mode: input.mode,
    userText: input.userText,
    deviceControlActive: input.deviceControlActive,
    inventory: input.inventory,
    currentStakes: input.currentStakes === "the round" ? "" : input.currentStakes,
    currentWinCondition: delegatedWinCondition,
    currentLoseCondition: delegatedLoseCondition,
    profile: input.profile,
    progress: input.progress,
  });
  if (!planned) {
    return {
      stakes: input.currentStakes,
      winCondition: input.currentWinCondition,
      loseCondition: input.currentLoseCondition,
    };
  }
  return planned;
}

function missingStakeParts(stakes: string, winCondition: string, loseCondition: string): string[] {
  const missing: string[] = [];
  if (!stakes) {
    missing.push("stakes");
  }
  if (!winCondition) {
    missing.push("win_condition");
  }
  if (!loseCondition) {
    missing.push("lose_condition");
  }
  return missing;
}

function hasTaskTermsSignal(text: string): boolean {
  return /\b(reward is|consequence is|if i complete|if i finish|if i succeed|if i fail|if i miss)\b/i.test(
    text,
  );
}

function missingTaskTermParts(taskReward: string, taskConsequence: string): string[] {
  const missing: string[] = [];
  if (!taskReward) {
    missing.push("task_reward");
  }
  if (!taskConsequence) {
    missing.push("task_consequence");
  }
  return missing;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function buildGameRulesFallback(templateId: DeterministicGameTemplateId): string {
  const template = resolveDeterministicGameTemplateById(templateId);
  if (template.id === "rps_streak") {
    return "Listen carefully. We stay with rock paper scissors streak. Two throws. You answer each one with rock, paper, or scissors. Beat both throws to win.";
  }
  if (template.id === "number_hunt") {
    return "Listen carefully. We stay with number hunt. You guess one number from 1 to 10. I give a hint, then you make one final guess.";
  }
  if (template.id === "math_duel") {
    return "Listen carefully. We stay with math duel. You answer each equation with digits only. One wrong answer and you lose the round.";
  }
  if (template.id === "number_command") {
    return "Listen carefully. We stay with number command. You pick one number from 1 to 10, then you complete the command tied to that number. Break command, lose the round.";
  }
  if (template.id === "riddle_lock") {
    return "Listen carefully. We stay with riddle lock. You answer each riddle clearly. One wrong answer and you lose the round.";
  }
  return "Listen carefully. We stay with number hunt. You guess one number from 1 to 10. I give a hint, then you make one final guess.";
}

function truncate(text: string, max = 180): string {
  const normalized = normalize(text);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function inferSceneTopicType(input: {
  act: DialogueRouteAct;
  sessionTopic: SessionTopic | null;
  stakes: string;
  winCondition: string;
  loseCondition: string;
  taskReward: string;
  taskConsequence: string;
  text: string;
  previousTopicType: SceneTopicType;
  previousTopicLocked: boolean;
}): SceneTopicType {
  const {
    act,
    sessionTopic,
    taskReward,
    taskConsequence,
    text,
    previousTopicType,
  } = input;
  if (
    hasStakeSignal(text) ||
    (previousTopicType === "reward_negotiation" && input.previousTopicLocked)
  ) {
    return "reward_negotiation";
  }
  if (
    (taskReward || taskConsequence || (previousTopicType === "task_terms_negotiation" && input.previousTopicLocked)) &&
    (hasTaskTermsSignal(text) || (previousTopicType === "task_terms_negotiation" && input.previousTopicLocked))
  ) {
    return "task_terms_negotiation";
  }
  if (act === "propose_activity" || act === "answer_activity_choice") {
    return "game_setup";
  }
  if (act === "task_request") {
    return "task_negotiation";
  }
  if (act === "duration_request") {
    return "duration_negotiation";
  }
  if (sessionTopic?.topic_type === "game_selection" && sessionTopic.topic_state === "open") {
    return "game_setup";
  }
  if (sessionTopic?.topic_state === "open") {
    return "general_request";
  }
  return "none";
}

function inferSceneType(text: string, current: string, intentScores?: DialogueIntentScores): string {
  const normalized = normalizeUserText(text);
  if (
    normalized.includes("game") ||
    (intentScores && intentScores.proposeActivity.score >= 1.6) ||
    (intentScores && intentScores.answerActivityChoice.score >= 1.6)
  ) {
    return "game";
  }
  if (
    normalized.includes("task") ||
    normalized.includes("challenge") ||
    (intentScores && intentScores.taskRequest.score >= 1.8) ||
    (intentScores && intentScores.taskEscalation.score >= 1.6)
  ) {
    return "challenge";
  }
  return current || "conversation";
}

function hasTaskEscalationCue(text: string): boolean {
  return hasTaskEscalationSignal(text);
}

function isTaskRevisionCue(text: string): boolean {
  return /\b(make it \d+\s*(minutes?|hours?)|make it shorter|make it longer|change how long|change the duration|revise it|adjust it)\b/i.test(
    text,
  );
}

function isExplicitTaskSwitchRequest(text: string): boolean {
  return /\b(instead|different task|new task|another task|next task|something else to do|ready for a new task|ready for another task|can i have a new task|give me a new task)\b/i.test(
    text,
  );
}

function hasExplicitGameSwitchCue(text: string): boolean {
  return /\b(rock paper scissors|rps|number hunt|math duel|number command|riddle lock|different game|new game|switch game|another game)\b/i.test(
    text,
  );
}

function isPlanningDetourSetup(state: SceneState, text: string): boolean {
  const normalizedUser = normalize(text).toLowerCase();
  const previous = normalize(state.last_assistant_text || "").toLowerCase();
  const planningContext = normalize(`${state.agreed_goal} ${state.last_assistant_text}`).toLowerCase();
  const explicitPlanningDetourRequest =
    /\b(play a game|game first|let'?s play|lets play)\b/.test(normalizedUser) &&
    /\b(tomorrow morning|morning|saturday|week|evening|plan|anchor|first block|wake time)\b/.test(
      planningContext,
    );
  const returnBridgeSelection =
    /\b(you pick|you choose|tell me to pick)\b/.test(normalizedUser) &&
    /\bone round\b/.test(previous) &&
    /\breturn\b/.test(previous) &&
    /\b(tomorrow morning|morning plan|morning block|saturday|the week|evening plan|the plan)\b/.test(
      previous,
    );
  return (
    explicitPlanningDetourRequest ||
    (
      returnBridgeSelection &&
      /\b(tomorrow morning|morning|saturday|week|evening|plan)\b/.test(planningContext)
    )
  );
}

function isCurrentGameMoveResolutionQuestion(text: string): boolean {
  return /\b(what('?s| is) your (choice|move)|your move|what did you throw|what was your throw|what did you pick|what was your pick)\b/i.test(
    text,
  );
}

function isExplicitAnotherRoundRequest(text: string): boolean {
  return wantsAnotherRound(text) && !isGameRulesQuestion(text);
}

function isFreePassWinCondition(winCondition: string): boolean {
  return /\bfree pass\b|\bbank(?:ed)?\b.*\bpass\b/i.test(winCondition);
}

function isTaskProgressQuestion(text: string): boolean {
  return /\b(task|challenge|how long|duration|halfway|check in|check-in|report back|done|complete|completed|timer|remaining|left|minutes? are up|hours? are up|time is up|times up|full \d+\s*(minute|minutes|hour|hours)|what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change|do i need proof|what proof|how do i prove it|what counts as proof|how deep|what depth|how far|should i wear|can i wear|can i add|should i add|what if i used|while doing it)\b/i.test(
    text,
  );
}

function isTaskNextStepQuestion(text: string): boolean {
  return /\b(what now|what next|next step|what should i do next|what should i do now|what else should i do now|what do i do after|what do i do now|what do i need to do next|what do i need to do now)\b/i.test(
    text,
  );
}

function shouldTreatQuestionAsGameAnswer(
  templateId: SceneState["game_template_id"],
  progress: SceneState["game_progress"],
  text: string,
): boolean {
  if (isGameRulesQuestion(text) || isGameNextPromptQuestion(text)) {
    return false;
  }
  return isValidDeterministicGameAnswer(templateId, progress, text);
}

function isInlineGameExecutionAnswer(input: {
  state: SceneState;
  turn: SceneUserTurnInput;
}): boolean {
  if (!(input.state.topic_locked && input.state.topic_type === "game_execution")) {
    return false;
  }
  if (
    input.turn.act !== "propose_activity" &&
    input.turn.act !== "answer_activity_choice"
  ) {
    return false;
  }
  return isValidDeterministicGameAnswer(
    input.state.game_template_id,
    input.state.game_progress,
    input.turn.text,
  );
}

function shouldAdvanceGameProgressFromTurn(input: {
  state: SceneState;
  turn: SceneUserTurnInput;
  explicitStakeSignal: boolean;
}): boolean {
  if (!(input.state.topic_locked && input.state.topic_type === "game_execution")) {
    return false;
  }
  if (input.explicitStakeSignal) {
    return false;
  }
  if (isInlineGameExecutionAnswer(input)) {
    return true;
  }
  if (
    input.turn.act === "confusion" ||
    input.turn.act === "short_follow_up" ||
    input.turn.act === "task_request" ||
    input.turn.act === "duration_request"
  ) {
    return false;
  }
  if (
    hasExplicitGameSwitchCue(input.turn.text) ||
    isExplicitAnotherRoundRequest(input.turn.text) ||
    input.turn.act === "propose_activity" ||
    input.turn.act === "answer_activity_choice"
  ) {
    return false;
  }
  if (input.turn.act === "user_question") {
    return shouldTreatQuestionAsGameAnswer(
      input.state.game_template_id,
      input.state.game_progress,
      input.turn.text,
    );
  }
  return true;
}

function isGameProgressQuestion(text: string): boolean {
  return /\b(game|round|rules?|play|throw|guess|prompt|score|winner|wager|stakes?|bet|if i win|if you win)\b/i.test(
    text,
  );
}

function isGeneralConversationQuestion(text: string): boolean {
  return /\b(talk|chat|question|ask you|tell me about|what do you think|why are you|how are you|switch topic|something else)\b/i.test(
    text,
  );
}

function hasUnfinishedTask(state: SceneState, nextTaskProgress: DeterministicTaskProgress): boolean {
  return (
    (state.topic_type === "task_execution" || state.task_progress !== "none") &&
    nextTaskProgress !== "completed" &&
    nextTaskProgress !== "none"
  );
}

function isHardTaskLockActive(
  state: SceneState,
  nextTaskProgress: DeterministicTaskProgress,
): boolean {
  return (
    state.task_hard_lock_active &&
    state.topic_type === "task_execution" &&
    nextTaskProgress !== "completed" &&
    nextTaskProgress !== "none"
  );
}

function isFreshNonTaskIntent(input: SceneUserTurnInput): boolean {
  if (isProfileSummaryRequest(input.text) || isChatSwitchRequest(input.text)) {
    return true;
  }
  if (isAssistantSelfQuestion(input.text) || isMutualGettingToKnowRequest(input.text)) {
    return true;
  }
  if (isProfileBuildingRequest(input.text)) {
    return true;
  }
  if (
    /\b(call me|my name is|i like\b|i like to\b|i enjoy\b|my hobbies are\b|i prefer\b|what i want you to remember\b|you should know that\b)\b/i.test(
      input.text,
    )
  ) {
    return true;
  }
  if (isNormalChatRequest(input.text) || isChatLikeSmalltalk(input.text)) {
    return true;
  }
  return (
    input.act === "user_question" &&
    !isTaskProgressQuestion(input.text) &&
    !isTaskNextStepQuestion(input.text) &&
    !isGameProgressQuestion(input.text)
  );
}

function looksLikeProfileDisclosure(text: string): boolean {
  return /\b(call me|my name is|my name's|i like\b|i like to\b|i enjoy\b|my hobbies are\b|my hobby is\b|i prefer\b|what i want you to remember\b|you should know that\b)\b/i.test(
    text,
  );
}

function hasLiveTaskNegotiation(state: SceneState): boolean {
  return (
    !state.task_spec.request_fulfilled &&
    (
      state.topic_type === "task_negotiation" ||
      state.task_spec.request_stage === "collecting_blockers" ||
      state.task_spec.request_stage === "ready_to_fulfill" ||
      state.task_spec.fulfillment_locked
    )
  );
}

export function buildProfilePrompt(
  profile: ProfileState | undefined,
  agreedGoal: string,
  promptCount = 0,
  lastPrompt = "",
  sessionMemory?: SessionMemory | null,
): string {
  const normalizedPromptCount = Math.max(0, promptCount);
  const facts = sessionMemory?.user_profile_facts ?? [];
  const preferredNames = facts.filter((fact) => fact.category === "preferred_labels_or_names");
  const hobbies = facts.filter((fact) => fact.category === "hobbies_interests");
  const communication = facts.filter((fact) => fact.category === "communication_preferences");
  const relationship = facts.filter((fact) => fact.category === "relationship_preferences");
  const constraints = facts.filter((fact) => fact.category === "constraints");
  const name = normalize(profile?.name ?? preferredNames[preferredNames.length - 1]?.value ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  const preferredPace = normalize(profile?.preferred_pace ?? "");
  const likes = normalize(profile?.likes ?? "");
  const limits = normalize(profile?.limits ?? "");
  const intensity = normalize(profile?.intensity ?? "");
  const goal = normalize(agreedGoal);
  const lastAnswer = normalize(sessionMemory?.last_user_answer?.value ?? "");
  const normalizedLastPrompt = normalize(lastPrompt);

  const reflectiveQuestions: string[] = [];
  if (/\b(i like to|i like\b|i enjoy|my hobbies are|my hobby is)\b/i.test(lastAnswer)) {
    reflectiveQuestions.push("What is it about that that gets its hooks into you hard enough for me to remember it?");
    reflectiveQuestions.push("What does that do to your head when it lands properly?");
  } else if (/\b(i prefer|keep it|be|stay)\b/i.test(lastAnswer)) {
    reflectiveQuestions.push("What kind of reply style misses for you immediately, so I do not waste time defaulting to it?");
    reflectiveQuestions.push("What tone lands right for you, and what tone dies on contact?");
  } else if (/\b(no|avoid|off limits|hard limit|don'?t like|do not like|hate)\b/i.test(lastAnswer)) {
    reflectiveQuestions.push("Once a line is clear, what keeps you settled instead of on guard?");
    reflectiveQuestions.push("Good. Once that limit is set, what still makes the exchange feel right for you?");
  } else if (/\b(call me|my name is|my name's)\b/i.test(lastAnswer)) {
    reflectiveQuestions.push("Beyond the name, what should I read correctly about you before I make assumptions?");
    reflectiveQuestions.push("Good. Name handled. Now tell me something more revealing than that.");
  }

  for (const candidate of reflectiveQuestions) {
    if (normalize(candidate) !== normalizedLastPrompt) {
      return candidate;
    }
  }

  const areas = [
    {
      key: "name",
      missing: !name,
      weight: 100,
      variants: [
        "What should I call you when I am speaking to you directly?",
        "What name or label actually sits right on you when I address you?",
        "What do you want to hear from my mouth when I am being direct with you?",
      ],
    },
    {
      key: "hobbies",
      missing: !likes && hobbies.length === 0,
      weight: 92,
      variants: [
        "What do you lose track of time doing when nobody is steering you?",
        "What do you actually enjoy enough that I should remember it instead of treating it like filler?",
        "What do you reach for naturally when you are left to yourself?",
      ],
    },
    {
      key: "limits",
      missing: !limits && constraints.length === 0,
      weight: 88,
      variants: [
        "What boundaries or hard nos do you want me to keep in mind?",
        "What is wrong for you immediately, so I do not miss it and waste both our time?",
        "Where does the line need to stay clean from the start?",
      ],
    },
    {
      key: "style",
      missing: !preferredStyle && communication.length === 0,
      weight: 83,
      variants: [
        "When we talk, do you want me clipped and direct, or broader and more exploratory?",
        "Do you want shorter sharper replies, or a little more room before I cut to the point?",
        "Do you want me harder at the edges, or a little broader when I answer?",
      ],
    },
    {
      key: "pace",
      missing: !preferredPace,
      weight: 75,
      variants: [
        "Do you like the pace brisk, steady, or slower when we talk?",
        "Do you want the pace tight and quick, or steadier with a little room to breathe?",
      ],
    },
    {
      key: "energy",
      missing: !intensity && relationship.length === 0,
      weight: 79,
      variants: [
        "What kind of energy lands well for you from me: lighter, steadier, or more intense?",
        "What kind of push actually works on you, and what misses completely?",
        "How much pressure feels useful to you, and when does it stop working?",
      ],
    },
    {
      key: "goal",
      missing: !goal,
      weight: 70,
      variants: [
        "What do you want me to understand about you first?",
        "What matters most for me to read accurately about you instead of fumbling around it?",
        "What is the first thing you want me to get right about you?",
      ],
    },
  ]
    .filter((area) => area.missing)
    .sort((left, right) => right.weight - left.weight);

  if (areas.length === 0) {
    return "Tell me one thing about yourself that people usually miss on the first pass.";
  }

  const area = areas[normalizedPromptCount % areas.length] ?? areas[0];
  const variantOffset = Math.floor(normalizedPromptCount / Math.max(1, areas.length));
  for (let offset = 0; offset < area.variants.length; offset += 1) {
    const candidate = area.variants[(variantOffset + offset) % area.variants.length];
    if (normalize(candidate) !== normalizedLastPrompt) {
      return candidate;
    }
  }
  return area.variants[0];
}

export function buildProfileInterpretiveBeat(
  userText: string,
  sessionMemory?: SessionMemory | null,
): string | null {
  const normalizedUserText = normalize(userText);
  const lastAnswer = normalize(sessionMemory?.last_user_answer?.value ?? userText);
  const facts = sessionMemory?.user_profile_facts ?? [];
  const hobbies = facts.filter((fact) => fact.category === "hobbies_interests");
  const communication = facts.filter((fact) => fact.category === "communication_preferences");
  const relationship = facts.filter((fact) => fact.category === "relationship_preferences");
  const constraints = facts.filter((fact) => fact.category === "constraints");

  if (!normalizedUserText || normalizedUserText.includes("?")) {
    return null;
  }
  if (/\b(i like to|i like\b|i enjoy|my hobbies are|my hobby is)\b/i.test(lastAnswer)) {
    const latestHobby = hobbies[hobbies.length - 1]?.value ?? "";
    if (/\b(because|it shuts|it quiets|it calms|it helps|it lets me)\b/i.test(lastAnswer)) {
      return "Good. That is not filler to you. It is one of the places you go when you want your head quieter and cleaner.";
    }
    if (latestHobby) {
      return `Good. ${latestHobby} is not really the point by itself. I am more interested in what it gives you when you disappear into it.`;
    }
    return "Good. That tells me there is a pattern there, not just a pastime.";
  }
  if (/\b(i prefer|keep it|be|stay|short|direct|slower|gentle|harder)\b/i.test(lastAnswer)) {
    if (communication.length > 0) {
      return "Good. That gives me a cleaner read on how you want the exchange to land, which matters more than people admit.";
    }
    return "Good. That tells me how you want pressure delivered, not just what words you like.";
  }
  if (/\b(no|avoid|off limits|hard limit|don'?t like|do not like|hate)\b/i.test(lastAnswer)) {
    if (constraints.length > 0) {
      return "Good. A clean limit tells me more about how you protect your footing than a polished answer ever would.";
    }
    return "Good. A clear limit is useful. It tells me where not to waste force.";
  }
  if (/\b(call me|my name is|my name's)\b/i.test(lastAnswer)) {
    return "Good. Name handled. That is the easy part. What matters more is how you want to be read once the surface drops away.";
  }
  if (relationship.length > 0 && /\b(push|pressure|energy|tone)\b/i.test(lastAnswer)) {
    return "Good. That gives me the shape of the pressure that works on you, which matters more than any decorative label.";
  }
  return null;
}

function extractTrackedProfilePrompt(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized.includes("?")) {
    return normalized;
  }
  const questionMatch = normalized.match(/([^?]*\?)/);
  return questionMatch?.[1]?.trim() ?? normalized;
}

function resolveInteractionMode(input: {
  act: DialogueRouteAct;
  text: string;
  effectiveTopicType: SceneTopicType;
  effectiveTaskProgress: DeterministicTaskProgress;
  taskHardLockActive: boolean;
  previousMode: InteractionMode;
  hasActiveTrainingThread: boolean;
}): InteractionMode {
  if (detectRepairTurnKind(input.text)) {
    if (input.previousMode === "relational_chat" || input.previousMode === "profile_building") {
      return input.previousMode;
    }
    return "normal_chat";
  }
  if (input.effectiveTopicType === "task_execution") {
    if (
      input.effectiveTaskProgress === "assigned" &&
      input.previousMode !== "task_execution" &&
      input.previousMode !== "locked_task_execution"
    ) {
      return "task_planning";
    }
    return input.taskHardLockActive ? "locked_task_execution" : "task_execution";
  }
  if (isChatSwitchRequest(input.text) && !input.taskHardLockActive) {
    return "normal_chat";
  }
  if (isAssistantSelfQuestion(input.text) || isMutualGettingToKnowRequest(input.text)) {
    return "relational_chat";
  }
  if (isAssistantTrainingRequest(input.text)) {
    return "relational_chat";
  }
  if (isRelationalOfferStatement(input.text)) {
    return "relational_chat";
  }
  if (isProfileSummaryRequest(input.text)) {
    return "profile_building";
  }
  if (isProfileBuildingRequest(input.text)) {
    return "profile_building";
  }
  if (isNormalChatRequest(input.text) || isChatLikeSmalltalk(input.text)) {
    return "normal_chat";
  }
  if (input.act === "short_follow_up") {
    if (input.previousMode === "locked_task_execution") {
      return "locked_task_execution";
    }
    if (input.previousMode === "game" && input.effectiveTopicType === "game_execution") {
      return "game";
    }
    if (
      input.effectiveTopicType === "task_negotiation" ||
      input.effectiveTopicType === "duration_negotiation" ||
      input.previousMode === "task_planning"
    ) {
      return "task_planning";
    }
    if (input.previousMode === "profile_building") {
      return "profile_building";
    }
    if (input.previousMode === "relational_chat") {
      return "relational_chat";
    }
    if (input.hasActiveTrainingThread) {
      return "relational_chat";
    }
    if (input.previousMode === "normal_chat") {
      return "normal_chat";
    }
    return "question_answering";
  }
  if (
    input.effectiveTopicType === "game_setup" ||
    input.effectiveTopicType === "game_execution" ||
    input.effectiveTopicType === "reward_window" ||
    input.effectiveTopicType === "reward_negotiation"
  ) {
    return "game";
  }
  if (input.effectiveTopicType === "task_negotiation") {
    return "task_planning";
  }
  if (input.effectiveTopicType === "duration_negotiation") {
    return "question_answering";
  }
  if (input.act === "user_question") {
    if (input.previousMode === "relational_chat") {
      return "relational_chat";
    }
    if (isGeneralConversationQuestion(input.text) && input.previousMode === "normal_chat") {
      return "normal_chat";
    }
    return "question_answering";
  }
  if (input.previousMode === "profile_building") {
    return "profile_building";
  }
  if (input.previousMode === "relational_chat") {
    return "relational_chat";
  }
  return "normal_chat";
}

function shouldReopenGameSetupFromContext(
  state: SceneState,
  input: SceneUserTurnInput,
): boolean {
  if (state.topic_locked) {
    return false;
  }
  if (state.scene_type !== "game") {
    return false;
  }
  return (
    input.act === "propose_activity" ||
    input.act === "answer_activity_choice" ||
    isGameChoiceDelegation(input.text) ||
    isGameStartCue(input.text) ||
    isExplicitAnotherRoundRequest(input.text)
  );
}

function inferNextExpectedAction(
  act: DialogueRouteAct,
  topicType: SceneTopicType,
  stakes: string,
  winCondition: string,
  loseCondition: string,
  taskReward: string,
  taskConsequence: string,
  gameTemplateId: DeterministicGameTemplateId,
): string {
  if (topicType === "reward_negotiation") {
    const missing = missingStakeParts(stakes, winCondition, loseCondition);
    if (missing.includes("stakes")) {
      return "state the stakes clearly first";
    }
    if (missing.includes("win_condition")) {
      return "define what happens if the user wins";
    }
    if (missing.includes("lose_condition")) {
      return "define what happens if Raven wins";
    }
    return "confirm the stakes and continue";
  }
  if (topicType === "task_terms_negotiation") {
    const missing = missingTaskTermParts(taskReward, taskConsequence);
    if (missing.includes("task_reward")) {
      return "define what the user earns for completing the task";
    }
    if (missing.includes("task_consequence")) {
      return "define what happens if the user fails the task";
    }
    return "confirm the task terms and continue";
  }
  if (topicType === "task_execution") {
    return buildTaskExecutionExpectedAction("assigned");
  }
  if (topicType === "game_execution") {
    return buildGameExecutionExpectedAction(gameTemplateId, "ready");
  }
  if (topicType === "reward_window") {
    return "bank the free pass or call for another round";
  }
  if (act === "propose_activity") {
    return "give a game preference or let Raven choose";
  }
  if (act === "answer_activity_choice") {
    return "play the chosen game";
  }
  if (act === "task_request") {
    return "accept the task or ask for one concrete adjustment";
  }
  if (act === "duration_request") {
    return "accept the duration or ask one direct follow-up";
  }
  if (act === "user_question") {
    return "listen for the answer";
  }
  if (act === "short_follow_up") {
    return "wait for one clean clarification";
  }
  if (act === "confusion") {
    return "wait for a short clarification";
  }
  if (act === "user_answer") {
    return "let Raven use the answer and continue";
  }
  return "continue the current thread";
}

function inferCurrentRule(
  act: DialogueRouteAct,
  state: SceneState,
  topicType: SceneTopicType,
  stakes: string,
  winCondition: string,
  loseCondition: string,
  taskReward: string,
  taskConsequence: string,
): string {
  if (topicType === "reward_negotiation") {
    const missing = missingStakeParts(stakes, winCondition, loseCondition);
    if (missing.includes("stakes")) {
      return "state the stakes before changing topics";
    }
    if (missing.includes("win_condition")) {
      return "set the user win condition before changing topics";
    }
    if (missing.includes("lose_condition")) {
      return "set the Raven win condition before changing topics";
    }
    return "confirm the stakes before changing topics";
  }
  if (topicType === "task_terms_negotiation") {
    const missing = missingTaskTermParts(taskReward, taskConsequence);
    if (missing.includes("task_reward")) {
      return "set the task reward before changing topics";
    }
    if (missing.includes("task_consequence")) {
      return "set the task consequence before changing topics";
    }
    return "confirm the task reward and consequence before changing topics";
  }
  if (topicType === "task_execution") {
    return buildTaskExecutionRule(
      "assigned",
      state.task_duration_minutes || 120,
      state.task_variant_index,
      state.task_template_id,
    );
  }
  if (topicType === "game_execution") {
    return buildGameExecutionRule(state.game_template_id, "ready");
  }
  if (topicType === "reward_window") {
    return "acknowledge the banked free pass before changing topics";
  }
  if (act === "propose_activity" || act === "answer_activity_choice") {
    return "finish choosing the game before changing topics";
  }
  if (act === "task_request") {
    return "assign the task before changing topics";
  }
  if (act === "duration_request") {
    return "answer the duration directly before changing topics";
  }
  if (act === "short_follow_up") {
    return "clarify the exact point before changing topics";
  }
  return state.current_rule;
}

function inferGoal(text: string, currentGoal: string): string {
  const normalized = normalize(text);
  if (!normalized) {
    return currentGoal;
  }
  const normalizeGoalFragment = (value: string): string | null => {
    const cleaned = truncate(value.trim(), 120);
    if (!cleaned) {
      return null;
    }
    if (/\bwhat i can do for you\b/i.test(cleaned) || /\bhow i can (?:be useful|help|please|serve|entertain) you\b/i.test(cleaned)) {
      return "what you can do for me";
    }
    if (/\b(?:be|being) trained by you\b/i.test(cleaned) || /\bi(?:'d| would) love to be trained by you\b/i.test(cleaned)) {
      return "what being trained by me would actually change for you";
    }
    if (/\b(?:be|being) owned by you\b/i.test(cleaned) || /\bowned by you\b/i.test(cleaned)) {
      return "what being owned by me would actually ask of you";
    }
    if (/^(?:be|being|do|doing|have|having)\b/i.test(cleaned)) {
      return currentGoal || null;
    }
    return cleaned;
  };
  const goalMatch = normalized.match(/\b(?:goal is|want to|trying to)\s+(.+)$/i);
  if (goalMatch?.[1]) {
    return normalizeGoalFragment(goalMatch[1]) ?? currentGoal;
  }
  if (/\bwhat can i do for you\b/i.test(normalized)) {
    return "what you can do for me";
  }
  if (!currentGoal && /\bgame\b/i.test(normalized)) {
    return "complete the chosen game";
  }
  return currentGoal;
}

function inferStakes(text: string, currentStakes: string): string {
  const normalized = normalize(text);
  if (!normalized) {
    return currentStakes;
  }
  const explicitMatch = normalized.match(
    /\bstakes? (?:are|were)\b[,:]?\s*(.+?)(?=(?:\bif i win\b|\bif you win\b|[.!?]|$))/i,
  );
  if (explicitMatch?.[1]) {
    return truncate(explicitMatch[1], 120);
  }
  if (/\bchastity\b/i.test(normalized)) {
    return "chastity";
  }
  if (!currentStakes && /\bif i win\b/i.test(normalized) && /\bif you win\b/i.test(normalized)) {
    return "the round";
  }
  return currentStakes;
}

function inferWinCondition(text: string, currentValue: string): string {
  const normalized = normalize(text);
  if (!normalized) {
    return currentValue;
  }
  const match = normalized.match(
    /\bif i win\b[,:]?\s*(.+?)(?=(?:\bif you win\b|[.!?]|$))/i,
  );
  if (match?.[1]) {
    const value = match[1].trim().replace(/^(?:this game[, ]+|the game[, ]+)/i, "");
    if (/^i want\b/i.test(value)) {
      return truncate(`you get ${value.replace(/^i want\b/i, "").replace(/\bfrom you\b/i, "").trim()}`, 120);
    }
    if (/^i get\b/i.test(value)) {
      return truncate(`you get ${value.replace(/^i get\b/i, "").replace(/\bfrom you\b/i, "").trim()}`, 120);
    }
    return truncate(value, 120);
  }
  return currentValue;
}

function inferLoseCondition(text: string, currentValue: string): string {
  const normalized = normalize(text);
  if (!normalized) {
    return currentValue;
  }
  const match = normalized.match(
    /\bif you win\b[,:]?\s*(.+?)(?=(?:[.!?]|$))/i,
  );
  if (match?.[1]) {
    return truncate(match[1], 120);
  }
  return currentValue;
}

function inferTaskReward(text: string, currentValue: string): string {
  const normalized = normalize(text);
  if (!normalized) {
    return currentValue;
  }
  const patterns = [
    /\breward is\b[,:]?\s*(.+?)(?=(?:\bconsequence is\b|\bif i fail\b|[.!?]|$))/i,
    /\bif i (?:complete|finish|succeed)\b[,:]?\s*(.+?)(?=(?:\bconsequence is\b|\bif i fail\b|[.!?]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return truncate(match[1], 120);
    }
  }
  return currentValue;
}

function inferTaskConsequence(text: string, currentValue: string): string {
  const normalized = normalize(text);
  if (!normalized) {
    return currentValue;
  }
  const patterns = [
    /\bconsequence is\b[,:]?\s*(.+?)(?=(?:[.!?]|$))/i,
    /\bif i (?:fail|miss)\b[,:]?\s*(.+?)(?=(?:[.!?]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return truncate(match[1], 120);
    }
  }
  return currentValue;
}

export function createSceneState(): SceneState {
  return {
    interaction_mode: "normal_chat",
    topic_type: "none",
    topic_locked: false,
    topic_state: "resolved",
    resume_topic_type: "none",
    resume_topic_locked: false,
    resume_topic_state: "resolved",
    scene_type: "conversation",
    game_template_id: "rps_streak",
    game_rotation_index: 0,
    game_progress: "none",
    last_game_progress: "none",
    game_number_choice: null,
    game_outcome: "none",
    game_reward_state: "none",
    free_pass_count: 0,
    agreed_goal: "",
    stakes: "",
    win_condition: "",
    lose_condition: "",
    task_reward: "",
    task_consequence: "",
    task_progress: "none",
    task_template_id: "focus_hold",
    task_variant_index: 0,
    task_duration_minutes: 120,
    current_task_domain: "general",
    locked_task_domain: "none",
    user_requested_task_domain: "none",
    can_replan_task: true,
    reason_for_lock: "",
    task_hard_lock_active: false,
    task_paused: false,
    task_spec: createTaskSpec({
      current_task_domain: "general",
      locked_task_domain: "none",
      can_replan_task: true,
      reason_for_lock: "",
    }),
    current_rule: "",
    current_subtask: "",
    next_expected_user_action: "continue the conversation",
    last_verified_action: "",
    last_assistant_text: "",
    active_training_thread: createEmptyTrainingThread(),
    resume_current_rule: "",
    resume_current_subtask: "",
    resume_next_expected_user_action: "",
    profile_prompt_count: 0,
    last_profile_prompt: "",
  };
}

export function noteSceneStateUserTurn(
  state: SceneState,
  input: SceneUserTurnInput,
): SceneState {
  const intentScores = scoreDialogueIntentSignals(input.text);
  const explicitStakeSignal = hasStakeSignal(input.text);
  const wagerDelegation = detectWagerDelegation(input.text);
  const inferredStakes = inferStakes(input.text, state.stakes);
  const inferredWinCondition = inferWinCondition(input.text, state.win_condition);
  const inferredLoseCondition = inferLoseCondition(input.text, state.lose_condition);
  const autoWagerTerms =
    wagerDelegation !== "none"
      ? deriveAutoWagerTerms({
          mode: wagerDelegation,
          userText: input.text,
          deviceControlActive: input.deviceControlActive,
          inventory: input.inventory,
          currentStakes: inferredStakes,
          currentWinCondition: inferredWinCondition,
          currentLoseCondition: inferredLoseCondition,
          profile: input.profile,
          progress: input.progress,
        })
      : null;
  const nextStakes = autoWagerTerms?.stakes ?? inferredStakes;
  const nextWinCondition = autoWagerTerms?.winCondition ?? inferredWinCondition;
  const nextLoseCondition = autoWagerTerms?.loseCondition ?? inferredLoseCondition;
  const nextTaskReward = inferTaskReward(input.text, state.task_reward);
  const nextTaskConsequence = inferTaskConsequence(input.text, state.task_consequence);
  const nextGameProgress =
    shouldAdvanceGameProgressFromTurn({
      state,
      turn: input,
      explicitStakeSignal,
    })
      ? deriveGameProgressFromUserText(state.game_template_id, state.game_progress, input.text)
      : state.game_progress;
  const nextTaskProgress =
    state.topic_locked && state.topic_type === "task_execution"
      ? deriveTaskProgressFromUserText(state.task_progress, input.text, state.task_duration_minutes)
      : state.task_progress;
  const currentTaskDomain = taskDomainFromTemplateId(state.task_template_id);
  const userRequestedTaskDomain =
    input.act === "task_request" ? detectTaskDomainFromUserText(input.text) : "none";
  const hardTaskLock = isHardTaskLockActive(state, nextTaskProgress);
  const freshNonTaskIntent = isFreshNonTaskIntent(input);
  const shouldPauseActiveTask =
    hasUnfinishedTask(state, nextTaskProgress) && !hardTaskLock && freshNonTaskIntent;
  const canReplanTask = !hardTaskLock;
  const reasonForLock =
    hardTaskLock
      ? `Finish the current ${formatTaskDomainLabel(currentTaskDomain)} task first.`
      : "";
  const hasGeneralConversationQuestion =
    input.act === "user_question" &&
    isGeneralConversationQuestion(input.text);
  const profileBuildingRequested = isProfileBuildingRequest(input.text);
  const profileSummaryRequested = isProfileSummaryRequest(input.text);
  const chatSwitchRequested = isChatSwitchRequest(input.text);
  const assistantSelfRequested =
    isAssistantSelfQuestion(input.text) || isMutualGettingToKnowRequest(input.text);
  const shouldReleaseTaskNegotiationToConversation =
    chatSwitchRequested ||
    assistantSelfRequested ||
    profileBuildingRequested ||
    profileSummaryRequested ||
    isNormalChatRequest(input.text) ||
    isChatLikeSmalltalk(input.text);
  const shouldClearReleasedTaskNegotiation =
    hasLiveTaskNegotiation(state) &&
    shouldReleaseTaskNegotiationToConversation &&
    !hasUnfinishedTask(state, nextTaskProgress);
  const shouldCarryTaskNegotiation =
    hasLiveTaskNegotiation(state) &&
    !shouldPauseActiveTask &&
    !shouldReleaseTaskNegotiationToConversation &&
    !explicitStakeSignal &&
    input.act !== "propose_activity" &&
    input.act !== "answer_activity_choice";
  const topicType = inferSceneTopicType({
    act: input.act,
    sessionTopic: input.sessionTopic,
    stakes: nextStakes,
    winCondition: nextWinCondition,
    loseCondition: nextLoseCondition,
    taskReward: nextTaskReward,
    taskConsequence: nextTaskConsequence,
    text: input.text,
    previousTopicType: state.topic_type,
    previousTopicLocked: state.topic_locked,
  });
  const shouldReopenGameSetup = shouldReopenGameSetupFromContext(state, input);
  const rewardWindowEscalatesToGameSetup =
    state.topic_locked &&
    state.topic_type === "reward_window" &&
    (
      isExplicitAnotherRoundRequest(input.text) ||
      (
        state.game_outcome !== "raven_win" &&
        isGameStartCue(input.text)
      )
    );
  const rewardWindowEscalatesToTask =
    state.topic_locked &&
    state.topic_type === "reward_window" &&
    input.act === "task_request";
  const taskExecutionEscalatesToTask =
    state.topic_locked &&
    state.topic_type === "task_execution" &&
    canReplanTask &&
    (
      isTaskRevisionCue(input.text) ||
      (hasTaskEscalationCue(input.text) &&
        !isTaskProgressQuestion(input.text) &&
        !isTaskNextStepQuestion(input.text)) ||
      isExplicitTaskSwitchRequest(input.text) ||
      (nextTaskProgress === "completed" &&
        input.act === "task_request" &&
        !isTaskProgressQuestion(input.text))
    );
  const taskExecutionEscalatesToGame =
    state.topic_locked &&
    state.topic_type === "task_execution" &&
    (
      input.act === "propose_activity" ||
      input.act === "answer_activity_choice" ||
      isGameChoiceDelegation(input.text)
    );
  const gameExecutionEscalatesToTask =
    state.topic_locked &&
    state.topic_type === "game_execution" &&
    input.act === "task_request";
  const inlineGameExecutionAnswer = isInlineGameExecutionAnswer({
    state,
    turn: input,
  });
  const gameExecutionEscalatesToGameSetup =
    state.topic_locked &&
    state.topic_type === "game_execution" &&
    !inlineGameExecutionAnswer &&
    (
      hasExplicitGameSwitchCue(input.text) ||
      isExplicitAnotherRoundRequest(input.text) ||
      input.act === "propose_activity" ||
      input.act === "answer_activity_choice" ||
      (isGameChoiceDelegation(input.text) && !isCurrentGameMoveResolutionQuestion(input.text))
    );
  const taskExecutionEscalatesToGeneral =
    shouldPauseActiveTask ||
    (
      state.topic_locked &&
      state.topic_type === "task_execution" &&
      hasGeneralConversationQuestion &&
      !hardTaskLock &&
      !isTaskProgressQuestion(input.text)
    );
  const gameExecutionEscalatesToGeneral =
    state.topic_locked &&
    state.topic_type === "game_execution" &&
    hasGeneralConversationQuestion &&
    !isGameProgressQuestion(input.text);
  const sessionTopicDecision = resolveSessionTopic({
    currentTopicType: state.topic_type,
    currentTopicLocked: state.topic_locked,
    inferredTopicType: topicType,
    explicitStakeSignal,
    shouldReopenGameSetup,
    userAct: input.act,
    taskHardLockActive: hardTaskLock,
    taskExecutionEscalatesToTask,
    taskExecutionEscalatesToGame,
    taskExecutionEscalatesToGeneral,
    gameExecutionEscalatesToTask,
    gameExecutionEscalatesToGameSetup,
    gameExecutionEscalatesToGeneral,
    rewardWindowEscalatesToTask,
    rewardWindowEscalatesToGameSetup,
  });
  const shouldContinueActiveTaskThread =
    !shouldPauseActiveTask &&
    !hardTaskLock &&
    state.topic_type === "task_execution" &&
    hasUnfinishedTask(state, nextTaskProgress) &&
    !taskExecutionEscalatesToTask &&
    !taskExecutionEscalatesToGame &&
    !taskExecutionEscalatesToGeneral &&
    (
      nextTaskProgress !== state.task_progress ||
      isTaskProgressQuestion(input.text) ||
      isTaskNextStepQuestion(input.text) ||
      input.act === "duration_request"
    );
  const resumeTaskExecution =
    !shouldPauseActiveTask &&
    !hardTaskLock &&
    hasUnfinishedTask(state, nextTaskProgress) &&
    (isTaskProgressQuestion(input.text) ||
      isTaskNextStepQuestion(input.text) ||
      input.act === "duration_request");
  const shouldHoldCompletedTaskThread =
    state.topic_locked &&
    state.topic_type === "task_execution" &&
    nextTaskProgress === "completed";
  const inferredGeneralConversationTopic =
    profileBuildingRequested ||
    profileSummaryRequested ||
    chatSwitchRequested ||
    assistantSelfRequested ||
    hasGeneralConversationQuestion ||
    isNormalChatRequest(input.text) ||
    isChatLikeSmalltalk(input.text);
  const effectiveTopicType = (() => {
    if (shouldPauseActiveTask) {
      return "general_request";
    }
    if (
      state.topic_locked &&
      state.topic_type === "task_execution" &&
      canReplanTask &&
      (
        isTaskRevisionCue(input.text) ||
        taskExecutionEscalatesToTask
      )
    ) {
      return "task_negotiation";
    }
    if (shouldCarryTaskNegotiation) {
      return "task_negotiation";
    }
    if (shouldContinueActiveTaskThread) {
      return "task_execution";
    }
    if (resumeTaskExecution) {
      return "task_execution";
    }
    if (shouldHoldCompletedTaskThread) {
      return "task_execution";
    }
    if (sessionTopicDecision.topicType === "none" && inferredGeneralConversationTopic) {
      return "general_request";
    }
    return sessionTopicDecision.topicType;
  })();
  const shouldPickNextGame =
    effectiveTopicType === "game_setup" &&
    state.topic_type !== "game_setup" &&
    state.topic_type !== "game_execution";
  const shouldRepickGameInSetup =
    effectiveTopicType === "game_setup" &&
    state.topic_type === "game_setup" &&
    state.game_progress === "none" &&
    (
      state.game_template_id === "rps_streak" ||
      state.game_template_id === "number_hunt" ||
      state.game_template_id === "math_duel" ||
      state.game_template_id === "number_command" ||
      state.game_template_id === "riddle_lock"
    ) &&
    (
      input.act === "propose_activity" ||
      input.act === "answer_activity_choice" ||
      isGameChoiceDelegation(input.text) ||
      hasExplicitGameSwitchCue(input.text) ||
      wantsAnotherRound(input.text)
    );
  const explicitRequestedGameTemplateId = detectRequestedDeterministicGameTemplateId(input.text);
  const preferredPlanningDetourGameTemplateId =
    (shouldPickNextGame || shouldRepickGameInSetup) && isPlanningDetourSetup(state, input.text)
      ? "number_hunt"
      : null;
  const selectedGameTemplate = shouldPickNextGame
    ? explicitRequestedGameTemplateId
      ? resolveDeterministicGameTemplateById(explicitRequestedGameTemplateId)
      : preferredPlanningDetourGameTemplateId
        ? resolveDeterministicGameTemplateById(preferredPlanningDetourGameTemplateId)
      : selectDeterministicGameTemplate({
        userText: input.text,
        hasStakes: Boolean(nextStakes),
        rotationIndex: state.game_rotation_index,
        currentTemplateId: state.game_template_id,
        profile: input.profile,
        progress: input.progress,
      })
    : shouldRepickGameInSetup
      ? explicitRequestedGameTemplateId
        ? resolveDeterministicGameTemplateById(explicitRequestedGameTemplateId)
        : preferredPlanningDetourGameTemplateId
          ? resolveDeterministicGameTemplateById(preferredPlanningDetourGameTemplateId)
        : selectDeterministicGameTemplate({
          userText: input.text,
          hasStakes: Boolean(nextStakes),
          rotationIndex: state.game_rotation_index,
          currentTemplateId: state.game_template_id,
          profile: input.profile,
          progress: input.progress,
        })
      : explicitRequestedGameTemplateId
        ? resolveDeterministicGameTemplateById(explicitRequestedGameTemplateId)
        : resolveDeterministicGameTemplateById(state.game_template_id);
  const topicLocked = shouldPauseActiveTask
    ? false
    : state.topic_locked &&
        state.topic_type === "task_execution" &&
        canReplanTask &&
        (
          isTaskRevisionCue(input.text) ||
          taskExecutionEscalatesToTask
        )
      ? true
    : shouldCarryTaskNegotiation ||
        shouldContinueActiveTaskThread ||
        resumeTaskExecution ||
        shouldHoldCompletedTaskThread
      ? true
      : sessionTopicDecision.topicLocked;
  const topicState = topicLocked ? "open" : "resolved";
  const effectiveGameProgress =
    effectiveTopicType === "game_execution"
      ? nextGameProgress
      : effectiveTopicType === "game_setup" || state.topic_type === "game_execution"
        ? "none"
        : state.game_progress;
  const parsedNumberChoice =
    selectedGameTemplate.id === "number_command" || state.game_template_id === "number_command"
      ? parseChosenNumber(input.text)
      : null;
  const effectiveGameNumberChoice =
    effectiveTopicType === "game_execution" &&
    (selectedGameTemplate.id === "number_command" || state.game_template_id === "number_command")
      ? parsedNumberChoice !== null
        ? parsedNumberChoice
        : state.game_number_choice ?? null
      : null;
  const effectiveGameOutcome =
    effectiveTopicType === "game_execution"
      ? deriveDeterministicGameOutcome(selectedGameTemplate.id, effectiveGameProgress)
      : effectiveTopicType === "game_setup" || state.topic_type === "game_execution"
        ? "none"
        : state.game_outcome;
  const shouldGrantFreePass =
    effectiveTopicType === "game_execution" &&
    isTerminalDeterministicGameProgress(effectiveGameProgress) &&
    effectiveGameOutcome === "user_win" &&
    state.game_outcome === "none" &&
    (!nextWinCondition || isFreePassWinCondition(nextWinCondition));
  const shouldUseFreePass =
    effectiveTopicType === "game_execution" &&
    isTerminalDeterministicGameProgress(effectiveGameProgress) &&
    effectiveGameOutcome === "raven_win" &&
    state.game_outcome === "none" &&
    state.free_pass_count > 0;
  const effectiveGameRewardState =
    effectiveTopicType === "game_execution"
      ? shouldGrantFreePass
        ? "free_pass_granted"
        : shouldUseFreePass
          ? "free_pass_used"
          : state.game_reward_state
      : effectiveTopicType === "game_setup" || state.topic_type === "game_execution"
        ? "none"
        : state.game_reward_state;
  const effectiveFreePassCount =
    shouldGrantFreePass
      ? state.free_pass_count + 1
      : shouldUseFreePass
        ? Math.max(0, state.free_pass_count - 1)
        : state.free_pass_count;
  const shouldPreservePausedTaskProgress =
    hasUnfinishedTask(state, nextTaskProgress) &&
    (shouldPauseActiveTask || (state.task_paused && effectiveTopicType !== "task_execution"));
  const effectiveTaskProgress =
    effectiveTopicType === "task_execution"
      ? nextTaskProgress
      : effectiveTopicType === "task_negotiation"
        ? "none"
        : shouldPreservePausedTaskProgress
          ? nextTaskProgress
          : state.topic_type === "task_execution"
            ? "none"
            : state.task_progress;
  const shouldSelectNewTaskTemplate =
    effectiveTopicType === "task_negotiation" &&
    (
      state.topic_type !== "task_negotiation" ||
      taskExecutionEscalatesToTask ||
      rewardWindowEscalatesToTask
    );
  const shouldPreserveActiveTaskTemplateInNegotiation =
    effectiveTopicType === "task_negotiation" &&
    state.topic_type === "task_execution" &&
    canReplanTask;
  const shouldSelectConsequenceTaskFromGame =
    effectiveTopicType === "game_execution" &&
    isTerminalDeterministicGameProgress(effectiveGameProgress) &&
    effectiveGameOutcome === "raven_win" &&
    effectiveGameRewardState !== "free_pass_used";
  const taskSelectionInput = shouldSelectConsequenceTaskFromGame
    ? {
        sceneType: "challenge",
        hasStakes: Boolean(nextStakes),
        hasTaskTerms: Boolean(nextTaskReward || nextTaskConsequence),
        userText: "challenge",
      }
    : {
        sceneType: state.scene_type,
        hasStakes: Boolean(nextStakes),
        hasTaskTerms: Boolean(nextTaskReward || nextTaskConsequence),
        userText: input.text,
      };
  const candidateTaskTemplate = selectDeterministicTaskTemplate({
    sceneType: taskSelectionInput.sceneType,
    hasStakes: taskSelectionInput.hasStakes,
    hasTaskTerms: taskSelectionInput.hasTaskTerms,
    userText: taskSelectionInput.userText,
    allowSilenceHold: input.deviceControlActive,
    profile: input.profile,
    inventory: input.inventory,
    progress: input.progress,
  });
  const effectiveTaskTemplateId = shouldSelectConsequenceTaskFromGame
    ? candidateTaskTemplate.id
    : shouldPreserveActiveTaskTemplateInNegotiation
      ? state.task_template_id
      : shouldSelectNewTaskTemplate
        ? candidateTaskTemplate.id
        : state.task_template_id;
  const effectiveTaskVariantIndex = shouldSelectConsequenceTaskFromGame
    ? pickNextDeterministicTaskVariantIndex(candidateTaskTemplate.id)
    : shouldPreserveActiveTaskTemplateInNegotiation
      ? state.task_variant_index
      : shouldSelectNewTaskTemplate
        ? pickNextDeterministicTaskVariantIndex(candidateTaskTemplate.id)
        : state.task_variant_index;
  const effectiveTaskTemplate = resolveDeterministicTaskTemplateById(effectiveTaskTemplateId);
  const effectiveTaskDomain = taskDomainFromTemplateId(effectiveTaskTemplateId);
  const requestedTaskDurationMinutes =
    extractTaskDurationMinutes(input.text) ?? state.task_spec.duration_minutes ?? state.task_duration_minutes;
  const effectiveTaskDurationMinutes =
    effectiveTopicType === "task_execution"
      ? state.task_duration_minutes || effectiveTaskTemplate.durationMinutes
      : effectiveTopicType === "task_negotiation"
        ? requestedTaskDurationMinutes || effectiveTaskTemplate.durationMinutes
        : state.task_duration_minutes;
  const effectiveTaskHardLockActive =
    effectiveTopicType === "task_execution" && nextTaskProgress !== "completed"
      ? state.task_hard_lock_active && !shouldPauseActiveTask
      : false;
  const taskSpecSceneFields = {
    current_task_domain: effectiveTaskDomain,
    locked_task_domain:
      topicLocked &&
      (effectiveTopicType === "task_execution" || effectiveTopicType === "task_negotiation")
        ? effectiveTaskDomain
        : "none",
    can_replan_task: canReplanTask,
    reason_for_lock: reasonForLock,
  };
  const shouldUpdateTaskSpecFromUserTurn =
    input.act === "task_request" ||
    effectiveTopicType === "task_negotiation" ||
    shouldCarryTaskNegotiation ||
    (
      state.topic_type === "task_execution" &&
      userRequestedTaskDomain !== "none" &&
      !canReplanTask
    );
  const nextTaskSpec = shouldClearReleasedTaskNegotiation
    ? createTaskSpec({
        current_task_domain: state.current_task_domain,
        recent_task_families: state.task_spec.recent_task_families,
        excluded_task_categories: state.task_spec.excluded_task_categories,
        preferred_task_categories: state.task_spec.preferred_task_categories,
        available_task_categories: state.task_spec.available_task_categories,
        novelty_pressure: state.task_spec.novelty_pressure,
      })
    : shouldUpdateTaskSpecFromUserTurn
      ? noteTaskSpecUserTurn(state.task_spec, {
          userText: input.text,
          inventory: input.inventory,
          currentTaskDomain: effectiveTaskDomain,
          lockedTaskDomain: taskSpecSceneFields.locked_task_domain,
          canReplanTask,
          reasonForLock,
          currentUserGoal:
            gameExecutionEscalatesToTask && effectiveTopicType === "task_negotiation"
              ? ""
              : inferGoal(input.text, state.agreed_goal),
        })
      : syncTaskSpecSceneFields(state.task_spec, taskSpecSceneFields);
  const currentRule =
    effectiveTopicType === "game_execution"
      ? buildGameExecutionRule(state.game_template_id, effectiveGameProgress)
      : effectiveTopicType === "task_execution"
        ? buildTaskExecutionRule(
            effectiveTaskProgress,
            effectiveTaskDurationMinutes,
            effectiveTaskVariantIndex,
            effectiveTaskTemplateId,
          )
        : effectiveTopicType === "task_negotiation" &&
            nextTaskSpec.next_required_action === "present_options"
          ? "present constrained task options now"
          : effectiveTopicType === "task_negotiation" &&
              nextTaskSpec.next_required_action === "await_selection"
            ? "hold the offered task options and wait for a clean selection"
        : effectiveTopicType === "task_negotiation" && nextTaskSpec.fulfillment_locked
          ? "fulfill the requested task now"
          : inferCurrentRule(
              input.act,
              state,
              effectiveTopicType,
              nextStakes,
              nextWinCondition,
              nextLoseCondition,
              nextTaskReward,
              nextTaskConsequence,
            );
  const nextExpectedUserAction =
    effectiveTopicType === "game_execution"
      ? buildGameExecutionExpectedAction(state.game_template_id, effectiveGameProgress)
      : effectiveTopicType === "task_execution"
        ? buildTaskExecutionExpectedAction(
            effectiveTaskProgress,
            effectiveTaskDurationMinutes,
            effectiveTaskVariantIndex,
            effectiveTaskTemplateId,
          )
        : effectiveTopicType === "task_negotiation" &&
            nextTaskSpec.next_required_action === "present_options"
          ? "wait for Raven to present the task options"
          : effectiveTopicType === "task_negotiation" &&
              nextTaskSpec.next_required_action === "await_selection"
            ? "choose one of Raven's offered task options"
        : effectiveTopicType === "task_negotiation" && nextTaskSpec.fulfillment_locked
          ? "wait for Raven to deliver the task"
          : inferNextExpectedAction(
              input.act,
              effectiveTopicType,
              nextStakes,
              nextWinCondition,
              nextLoseCondition,
              nextTaskReward,
              nextTaskConsequence,
              selectedGameTemplate.id,
            );
  const nextInteractionMode = resolveInteractionMode({
    act: input.act,
    text: input.text,
    effectiveTopicType,
    effectiveTaskProgress,
    taskHardLockActive: effectiveTaskHardLockActive,
    previousMode: normalizeInteractionMode(state.interaction_mode),
    hasActiveTrainingThread: state.active_training_thread.subject !== "none",
  });

  const shouldClearTrainingThread =
    effectiveTopicType === "task_negotiation" ||
    effectiveTopicType === "task_execution" ||
    effectiveTopicType === "duration_negotiation" ||
    effectiveTopicType === "game_setup" ||
    effectiveTopicType === "game_execution" ||
    nextInteractionMode === "profile_building";
  const freshOpenChatTurn =
    !detectRepairTurnKind(input.text) && (isNormalChatRequest(input.text) || isChatLikeSmalltalk(input.text));
  return {
    ...state,
    interaction_mode: nextInteractionMode,
    topic_type: effectiveTopicType,
    topic_locked: topicLocked,
    topic_state: topicState,
    scene_type: inferSceneType(input.text, state.scene_type, intentScores),
    game_template_id: selectedGameTemplate.id,
    game_rotation_index: state.game_rotation_index,
    game_progress: effectiveGameProgress,
    last_game_progress: state.game_progress,
    game_number_choice: effectiveGameNumberChoice,
    game_outcome: effectiveGameOutcome,
    game_reward_state: effectiveGameRewardState,
    free_pass_count: effectiveFreePassCount,
    agreed_goal:
      freshOpenChatTurn
        ? ""
        : gameExecutionEscalatesToTask && effectiveTopicType === "task_negotiation"
        ? ""
        : inferGoal(input.text, state.agreed_goal),
    stakes: nextStakes,
    win_condition: nextWinCondition,
    lose_condition: nextLoseCondition,
    task_reward: nextTaskReward,
    task_consequence: nextTaskConsequence,
    task_progress: effectiveTaskProgress,
    task_template_id: effectiveTaskTemplateId,
    task_variant_index: effectiveTaskVariantIndex,
    task_duration_minutes: effectiveTaskDurationMinutes,
    current_task_domain: effectiveTaskDomain,
    locked_task_domain:
      topicLocked &&
      (effectiveTopicType === "task_execution" || effectiveTopicType === "task_negotiation")
        ? effectiveTaskDomain
        : "none",
    user_requested_task_domain:
      userRequestedTaskDomain !== "none"
        ? userRequestedTaskDomain
        : shouldCarryTaskNegotiation
          ? state.user_requested_task_domain
          : "none",
    can_replan_task: canReplanTask,
    reason_for_lock: reasonForLock,
    task_hard_lock_active: effectiveTaskHardLockActive,
    task_paused:
      shouldPauseActiveTask
        ? true
        : resumeTaskExecution || effectiveTaskProgress === "completed"
          ? false
          : state.task_paused,
    task_spec: nextTaskSpec,
    current_rule: currentRule,
    current_subtask: truncate(input.text, 160),
    next_expected_user_action: nextExpectedUserAction,
    active_training_thread: shouldClearTrainingThread
      ? createEmptyTrainingThread()
      : state.active_training_thread,
  };
}

function buildRewardWindowRuleForState(state: SceneState): string {
  if (state.game_reward_state === "free_pass_granted") {
    return "acknowledge the banked free pass before changing topics";
  }
  if (state.game_outcome === "raven_win" && state.game_reward_state !== "free_pass_used") {
    return "confirm the losing consequence before changing topics";
  }
  if (state.game_outcome === "user_win" && state.win_condition) {
    return "honor the user win condition before changing topics";
  }
  return "confirm the round result before changing topics";
}

function buildRewardWindowExpectedActionForState(state: SceneState): string {
  if (state.game_reward_state === "free_pass_granted") {
    return "bank the free pass or call for another round";
  }
  if (state.game_outcome === "raven_win" && state.game_reward_state !== "free_pass_used") {
    return "acknowledge the loss and wait for Raven to enforce the consequence";
  }
  if (state.game_outcome === "user_win" && state.win_condition) {
    return "claim the user win condition or call for another round";
  }
  return "confirm another round or switch topics";
}

function shouldResolveTopicFromText(state: SceneState, text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (state.topic_type === "game_setup") {
    return /\bi pick\b|\bwe are doing\b|\bhere is the game\b|\bgame is\b/.test(normalized);
  }
  if (state.topic_type === "game_execution") {
    return isDeterministicGameCompletionText(normalized);
  }
  if (state.topic_type === "reward_window") {
    return /\b(free pass stays banked|free pass is banked|keep it in reserve|another round when you are ready|winner terms applied|claim accepted|claim registered|say ready and i will enforce it|here is your task|your loss stands)\b/.test(
      normalized,
    );
  }
  if (state.topic_type === "task_negotiation") {
    return /\bhere is your task\b|\byour task\b|\bchallenge\b|\bfor \d+\s*(hour|hours|minute|minutes)\b/.test(
      normalized,
    );
  }
  if (state.topic_type === "none" || state.topic_type === "general_request") {
    return isTaskAssignmentText(normalized);
  }
  if (state.topic_type === "task_execution") {
    return isTaskCompletionConfirmationText(normalized);
  }
  if (state.topic_type === "duration_negotiation") {
    return /\b\d+\s*(hour|hours|minute|minutes)\b/.test(normalized);
  }
  if (state.topic_type === "task_terms_negotiation") {
    return (
      /\b(reward|consequence|terms are set|locked in)\b/.test(normalized) ||
      Boolean(state.task_reward && state.task_consequence)
    );
  }
  if (state.topic_type === "reward_negotiation") {
    return (
      /\b(stakes|win condition|lose condition|terms are set|locked in)\b/.test(normalized) ||
      Boolean(state.stakes && state.win_condition && state.lose_condition)
    );
  }
  if (state.topic_type === "verification_in_progress") {
    return (
      /\bverified\b|\bpass\b|\bfailed\b|\bhold steady\b/.test(normalized) ||
      /\bi have you in frame\b|\bi saw the full turn\b|\byou held it cleanly\b|\bi can see it clearly\b/.test(
        normalized,
      ) ||
      /\bi did not get a clean read\b|\bi do not have a stable frame\b|\bi do not have a stable read\b|\bi will take your word once\b/.test(
        normalized,
      )
    );
  }
  return false;
}

export function noteSceneStateAssistantTurn(
  state: SceneState,
  input: SceneAssistantTurnInput,
): SceneState {
  const rawText = input.text.trim();
  const text = truncate(rawText, 180);
  const resolved = input.topicResolved === true || shouldResolveTopicFromText(state, rawText);
  const gameStartInspection = inspectGameStartContract(rawText, state.game_template_id);
  const textIndicatesUserWin = /\bYou win this round\b|\bYou won this round\b/i.test(rawText);
  const textIndicatesRavenWin = /\bI win this round\b|\bI win this one\b|\bI won this round\b/i.test(rawText);
  const completedGameOutcome =
    state.topic_type === "game_execution" &&
    resolved &&
    isDeterministicGameCompletionText(rawText)
      ? textIndicatesRavenWin
        ? "raven_win"
        : textIndicatesUserWin
          ? "user_win"
          : deriveDeterministicGameOutcome(state.game_template_id, "completed")
      : "none";
  const shouldEnterGameExecution =
    (
      state.topic_type === "game_setup" &&
      resolved &&
      isDeterministicGameChoiceText(rawText)
    ) ||
    (
      gameStartInspection.detected &&
      gameStartInspection.hasPlayablePrompt &&
      state.topic_type !== "game_execution" &&
      state.topic_type !== "task_execution" &&
      state.topic_type !== "verification_in_progress"
    );
  const shouldEnterRewardWindow =
    state.topic_type === "game_execution" &&
    resolved &&
    (
      (
        (textIndicatesUserWin ||
          completedGameOutcome === "user_win" ||
          state.game_outcome === "user_win") &&
        (state.game_reward_state === "free_pass_granted" || Boolean(state.win_condition))
      ) ||
      (
        (textIndicatesRavenWin ||
          completedGameOutcome === "raven_win" ||
          state.game_outcome === "raven_win") &&
        state.game_reward_state !== "free_pass_used" &&
        !isFinalTaskAssignmentText(rawText)
      )
    ) &&
    !isFinalTaskAssignmentText(rawText);
  const shouldEnterTaskExecutionFromGameOutcome =
    state.topic_type === "game_execution" &&
    (resolved || isFinalTaskAssignmentText(rawText)) &&
    (textIndicatesRavenWin ||
      completedGameOutcome === "raven_win" ||
      state.game_outcome === "raven_win") &&
    isFinalTaskAssignmentText(rawText);
  const shouldEnterTaskExecution =
    (state.topic_type === "task_negotiation" ||
      state.topic_type === "reward_window" ||
      state.topic_type === "none" ||
      state.topic_type === "general_request" ||
      (state.topic_type === "task_execution" && state.task_progress === "completed")) &&
    (resolved || isFinalTaskAssignmentText(rawText)) &&
    isFinalTaskAssignmentText(rawText);
  const shouldRestoreVerificationContext =
    state.topic_type === "verification_in_progress" &&
    resolved &&
    state.resume_topic_type !== "none";
  const shouldKeepRestoredTaskExecutionOpen =
    shouldRestoreVerificationContext && state.resume_topic_type === "task_execution";
  const shouldKeepRestoredGameExecutionOpen =
    shouldRestoreVerificationContext && state.resume_topic_type === "game_execution";
  const resolvedGameTemplateId =
    shouldEnterGameExecution || (state.topic_type === "game_setup" && resolved)
      ? gameStartInspection.detected
        ? gameStartInspection.templateId
        : detectDeterministicGameTemplateId(rawText, state.game_template_id)
      : state.game_template_id;
  const assignedTaskDuration =
    extractTaskDurationMinutes(rawText) ?? state.task_duration_minutes;
  const assignedTaskTemplateId =
    shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome
      ? detectDeterministicTaskTemplateIdFromAssignmentText(rawText, state.task_template_id)
      : state.task_template_id;
  const assignedTaskDomain = taskDomainFromTemplateId(assignedTaskTemplateId);
  const assignedTaskHardLockActive =
    shouldEnterTaskExecutionFromGameOutcome ||
    (state.task_hard_lock_active &&
      state.topic_type === "task_execution" &&
      state.task_progress !== "completed");
  const shouldUpdateTaskSpecFromAssignment =
    shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome;
  const nextLockedTaskDomain =
    (shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome || shouldEnterRewardWindow) &&
    (
      (shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome) ||
      state.topic_type === "task_execution"
    )
      ? assignedTaskDomain
      : state.locked_task_domain;
  const nextTaskSpec = shouldUpdateTaskSpecFromAssignment
    ? noteTaskSpecAssistantAssignment(
        syncTaskSpecSceneFields(state.task_spec, {
          current_task_domain: assignedTaskDomain,
          locked_task_domain: nextLockedTaskDomain,
          can_replan_task: false,
          reason_for_lock: `Finish the current ${formatTaskDomainLabel(assignedTaskDomain)} task first.`,
        }),
        assignedTaskDomain,
        { templateId: assignedTaskTemplateId },
      )
    : syncTaskSpecSceneFields(state.task_spec, {
        current_task_domain: state.current_task_domain,
        locked_task_domain: state.locked_task_domain,
        can_replan_task: state.can_replan_task,
        reason_for_lock: state.reason_for_lock,
      });
  const shouldTrackTaskSpecAssistantText =
    shouldEnterTaskExecution ||
    shouldEnterTaskExecutionFromGameOutcome ||
    shouldEnterRewardWindow ||
    state.topic_type === "task_negotiation" ||
    state.topic_type === "task_execution" ||
    state.topic_type === "reward_window";
  const taskSpecWithAskedHistory = shouldTrackTaskSpecAssistantText
    ? noteTaskSpecAssistantText(nextTaskSpec, rawText)
    : nextTaskSpec;
  const shouldTrackProfilePrompt =
    state.interaction_mode === "profile_building" &&
    rawText.includes("?") &&
    !isTaskAssignmentText(rawText);
  const shouldEnterFreshTaskExecution =
    (shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution) &&
    state.topic_type !== "task_execution";
  const extractedTrainingThread = extractTrainingThreadFromAssistantText(rawText);
  const nextTrainingThread =
    shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome || shouldEnterGameExecution
      ? createEmptyTrainingThread()
      : extractedTrainingThread ?? state.active_training_thread;
  return {
    ...state,
    interaction_mode: shouldEnterGameExecution || shouldEnterRewardWindow
      ? "game"
      : shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution
        ? assignedTaskHardLockActive
          ? "locked_task_execution"
          : shouldEnterFreshTaskExecution
            ? "task_planning"
            : "task_execution"
        : shouldRestoreVerificationContext && state.resume_topic_type === "task_execution"
          ? state.task_hard_lock_active
            ? "locked_task_execution"
            : "task_execution"
          : shouldRestoreVerificationContext && state.resume_topic_type !== "none"
            ? normalizeInteractionMode(state.interaction_mode)
            : state.interaction_mode,
    topic_type: shouldEnterGameExecution
      ? "game_execution"
      : shouldEnterRewardWindow
      ? "reward_window"
      : shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution
      ? "task_execution"
      : shouldRestoreVerificationContext
        ? state.resume_topic_type
        : state.topic_type,
    topic_locked: shouldRestoreVerificationContext
      ? shouldKeepRestoredTaskExecutionOpen || shouldKeepRestoredGameExecutionOpen
      : shouldEnterRewardWindow
        ? true
        : shouldEnterGameExecution || shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution
          ? true
          : resolved
            ? false
            : state.topic_locked,
    topic_state: shouldRestoreVerificationContext
      ? shouldKeepRestoredTaskExecutionOpen || shouldKeepRestoredGameExecutionOpen
        ? "open"
        : state.resume_topic_state
      : shouldEnterRewardWindow
        ? "open"
      : shouldEnterGameExecution || shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution
        ? "open"
        : resolved
          ? "resolved"
          : state.topic_state,
    game_progress: shouldEnterGameExecution
      ? "round_1"
      : state.topic_type === "game_execution" && resolved && isDeterministicGameCompletionText(rawText)
        ? "completed"
      : state.game_progress,
    last_game_progress: shouldEnterGameExecution ? "none" : state.game_progress,
    game_number_choice: shouldEnterGameExecution
      ? null
      : state.game_number_choice ?? null,
    game_outcome: shouldEnterGameExecution
      ? "none"
      : completedGameOutcome !== "none"
        ? completedGameOutcome
      : state.game_outcome,
    game_reward_state: shouldEnterGameExecution ? "none" : state.game_reward_state,
    free_pass_count: state.free_pass_count,
    task_progress: shouldEnterTaskExecution
      || shouldEnterTaskExecutionFromGameOutcome
      ? "assigned"
      : state.topic_type === "task_execution" && resolved && isTaskCompletionConfirmationText(rawText)
        ? "completed"
      : state.task_progress,
    game_template_id: resolvedGameTemplateId,
    game_rotation_index:
      shouldEnterGameExecution && state.topic_type !== "game_execution"
        ? state.game_rotation_index + 1
        : state.game_rotation_index,
    task_template_id: assignedTaskTemplateId,
    task_variant_index: state.task_variant_index,
    task_duration_minutes: shouldEnterTaskExecution
      ? assignedTaskDuration
      : state.task_duration_minutes,
    current_task_domain: assignedTaskDomain,
    locked_task_domain:
      shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome
        ? assignedTaskDomain
        : state.locked_task_domain,
    user_requested_task_domain: state.user_requested_task_domain,
    can_replan_task:
      shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome
        ? !assignedTaskHardLockActive
        : state.can_replan_task,
    reason_for_lock:
      shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome
        ? assignedTaskHardLockActive
          ? `Finish the current ${formatTaskDomainLabel(assignedTaskDomain)} task first.`
          : ""
        : state.reason_for_lock,
    task_hard_lock_active:
      shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome
        ? assignedTaskHardLockActive
        : state.task_hard_lock_active &&
            state.task_progress !== "completed" &&
            state.topic_type === "task_execution",
    task_paused:
      shouldEnterTaskExecution || shouldEnterTaskExecutionFromGameOutcome
        ? false
        : shouldRestoreVerificationContext && state.resume_topic_type === "task_execution"
          ? state.task_paused
          : state.task_paused,
    task_spec: taskSpecWithAskedHistory,
    current_subtask: text || state.current_subtask,
    current_rule: shouldRestoreVerificationContext
      ? truncate(input.commitment ?? state.resume_current_rule, 180) || state.resume_current_rule
      : shouldEnterGameExecution
        ? buildGameExecutionRule(resolvedGameTemplateId, "round_1")
      : shouldEnterRewardWindow
        ? buildRewardWindowRuleForState(state)
      : shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution
        ? buildTaskExecutionRule(
            "assigned",
            assignedTaskDuration,
            state.task_variant_index,
            assignedTaskTemplateId,
          )
      : truncate(input.commitment ?? state.current_rule, 180) || state.current_rule,
    next_expected_user_action: shouldRestoreVerificationContext
      ? state.resume_next_expected_user_action || "reply to the current instruction or ask one direct follow-up"
      : shouldEnterGameExecution
        ? buildGameExecutionExpectedAction(resolvedGameTemplateId, "round_1")
      : shouldEnterRewardWindow
        ? buildRewardWindowExpectedActionForState(state)
      : shouldEnterTaskExecutionFromGameOutcome || shouldEnterTaskExecution
        ? buildTaskExecutionExpectedAction(
            "assigned",
            assignedTaskDuration,
            state.task_variant_index,
            assignedTaskTemplateId,
          )
      : resolved
        ? "reply to the current instruction or ask one direct follow-up"
        : state.next_expected_user_action,
    resume_topic_type: shouldRestoreVerificationContext ? "none" : state.resume_topic_type,
    resume_topic_locked: shouldRestoreVerificationContext ? false : state.resume_topic_locked,
    resume_topic_state: shouldRestoreVerificationContext ? "resolved" : state.resume_topic_state,
    resume_current_rule: shouldRestoreVerificationContext ? "" : state.resume_current_rule,
    resume_current_subtask: shouldRestoreVerificationContext ? "" : state.resume_current_subtask,
    resume_next_expected_user_action: shouldRestoreVerificationContext
      ? ""
      : state.resume_next_expected_user_action,
    profile_prompt_count: shouldTrackProfilePrompt
      ? state.profile_prompt_count + 1
      : state.profile_prompt_count,
    last_profile_prompt: shouldTrackProfilePrompt
      ? extractTrackedProfilePrompt(rawText)
      : state.last_profile_prompt,
    last_assistant_text: rawText || state.last_assistant_text,
    active_training_thread: nextTrainingThread,
  };
}

export function noteSceneVerificationResult(state: SceneState, summary: string): SceneState {
  const normalized = truncate(summary, 180);
  const shouldStashCurrentContext = state.topic_type !== "verification_in_progress";
  return {
    ...state,
    topic_type: "verification_in_progress",
    topic_locked: true,
    topic_state: "open",
    last_verified_action: normalized,
    current_subtask: normalized,
    current_rule: "finish the verification before changing topics",
    next_expected_user_action: "hold steady for verification or correct the failed check",
    resume_topic_type: shouldStashCurrentContext ? state.topic_type : state.resume_topic_type,
    resume_topic_locked: shouldStashCurrentContext ? state.topic_locked : state.resume_topic_locked,
    resume_topic_state: shouldStashCurrentContext ? state.topic_state : state.resume_topic_state,
    resume_current_rule: shouldStashCurrentContext ? state.current_rule : state.resume_current_rule,
    resume_current_subtask: shouldStashCurrentContext ? state.current_subtask : state.resume_current_subtask,
    resume_next_expected_user_action: shouldStashCurrentContext
      ? state.next_expected_user_action
      : state.resume_next_expected_user_action,
  };
}

export function buildSceneStatePromptBlock(state: SceneState): string {
  return [
    "Scene State:",
    `Interaction mode: ${state.interaction_mode}`,
    `Topic type: ${state.topic_type}`,
    `Topic locked: ${state.topic_locked ? "yes" : "no"}`,
    `Topic state: ${state.topic_state}`,
    `Scene type: ${state.scene_type || "conversation"}`,
    `Game template: ${state.game_template_id}`,
    `Game rotation index: ${state.game_rotation_index}`,
    `Game progress: ${state.game_progress}`,
    `Last game progress: ${state.last_game_progress}`,
    `Game number choice: ${state.game_number_choice ?? "none"}`,
    `Game outcome: ${state.game_outcome}`,
    `Game reward state: ${state.game_reward_state}`,
    `Free passes: ${state.free_pass_count}`,
    `Leverage: ${buildLeverageSummary(state)}`,
    `Agreed goal: ${state.agreed_goal || "none"}`,
    `Stakes: ${state.stakes || "none"}`,
    `Win condition: ${state.win_condition || "none"}`,
    `Lose condition: ${state.lose_condition || "none"}`,
    `Task reward: ${state.task_reward || "none"}`,
    `Task consequence: ${state.task_consequence || "none"}`,
    `Task progress: ${state.task_progress}`,
    `Task template: ${state.task_template_id}`,
    `Task variant: ${state.task_variant_index}`,
    `Task duration minutes: ${state.task_duration_minutes}`,
    `Current task domain: ${state.current_task_domain}`,
    `Locked task domain: ${state.locked_task_domain}`,
    `User requested task domain: ${state.user_requested_task_domain}`,
    `Can replan task: ${state.can_replan_task ? "yes" : "no"}`,
    `Reason for lock: ${state.reason_for_lock || "none"}`,
    `Task hard lock active: ${state.task_hard_lock_active ? "yes" : "no"}`,
    `Task paused: ${state.task_paused ? "yes" : "no"}`,
    buildTaskSpecPromptBlock(state.task_spec),
    `Current rule: ${state.current_rule || "none"}`,
    `Current subtask: ${state.current_subtask || "none"}`,
    `Next expected user action: ${state.next_expected_user_action || "none"}`,
    `Last verified action: ${state.last_verified_action || "none"}`,
    `Active training thread: ${state.active_training_thread.subject || "none"}`,
    `Active training item: ${state.active_training_thread.item_name || "none"}`,
    `Active training focus: ${state.active_training_thread.focus || "none"}`,
  ].join("\n");
}

export function buildLeverageSummary(state: SceneState): string {
  if (state.game_reward_state === "free_pass_used") {
    return "free pass spent this round";
  }
  if (
    state.topic_type === "task_execution" &&
    state.topic_locked &&
    state.game_outcome === "raven_win"
  ) {
    return "consequence task armed";
  }
  if (state.topic_type === "task_execution" && state.topic_locked) {
    return "task in progress";
  }
  if (state.free_pass_count > 0) {
    return `free pass banked (${state.free_pass_count})`;
  }
  if (state.topic_type === "reward_negotiation" && state.topic_locked) {
    return "stakes negotiation active";
  }
  if (state.topic_type === "task_terms_negotiation" && state.topic_locked) {
    return "task terms pending";
  }
  return "no protection";
}

function gameTextLooksAligned(text: string): boolean {
  return /\b(game|choose|pick|round|score|rock paper scissors|rps|number hunt|math duel|number command|riddle lock|quick|word|repeat|sequence|control|speed|equation|riddle|1-10|1 to 10|number)\b/i.test(
    text,
  );
}

function planningReturnTextLooksAligned(state: SceneState, text: string): boolean {
  if (state.topic_type !== "game_execution") {
    return false;
  }
  const previous = normalize(state.last_assistant_text || "");
  if (!/\b(return to the morning plan|morning plan|morning block|first block)\b/i.test(previous)) {
    return false;
  }
  return /\b(morning plan|morning block|wake time|focused hour|first block)\b/i.test(text);
}

function extractPlanningDetourPrefix(text: string | null | undefined): string | null {
  const normalized = normalize(text || "");
  if (!normalized) {
    return null;
  }
  const match = normalized.match(
    /(Good\.\s*One round first, then we return to (?:tomorrow morning|the morning plan|the week|saturday|the evening plan)\.)/i,
  );
  return match?.[1] ?? null;
}

function rewardWindowTextLooksAligned(text: string): boolean {
  return /\b(free pass|banked|reserve|another round|protection|winner terms|claim accepted|claim registered|you won)\b/i.test(
    text,
  );
}

function taskTextLooksAligned(text: string): boolean {
  return /\b(task|challenge|report back|check in|hour|hours|minute|minutes|repeats?|items?|tools?|available|standalone|combined|difficulty|easy|moderate|hard|proof|prove|proves|verify|control|pressure|depth|deep|cage|chastity|layered|main task|main focus|primary focus|keep it on|pair it|paired|deny|denial|restraints?|cuffs?|collar|plug|dildo)\b/i.test(
    text,
  );
}

function durationTextLooksAligned(text: string): boolean {
  return /\b\d+\s*(hour|hours|minute|minutes)\b/i.test(text);
}

function verificationTextLooksAligned(text: string): boolean {
  return /\b(verify|verification|hold|steady|camera|face|center|check)\b/i.test(text);
}

function rewardNegotiationTextLooksAligned(text: string): boolean {
  return /\b(stakes|on the line|win condition|lose condition|if you win|if i win|terms)\b/i.test(
    text,
  );
}

function inferDurationReplyTemplateId(
  state: SceneState,
  userText: string,
): DeterministicTaskTemplateId {
  if (state.task_template_id !== "focus_hold") {
    return state.task_template_id;
  }
  if (/\b(wear it|lock it|keep it on|have to wear)\b/i.test(userText)) {
    return "steady_hold";
  }
  switch (detectTaskDomainFromUserText(userText)) {
    case "device":
      return "steady_hold";
    case "posture":
      return "discipline_hold";
    case "hands":
      return "hands_protocol";
    case "kneeling":
      return "kneel_protocol";
    case "shoulders":
      return "shoulders_back_protocol";
    case "frame":
      return "inspection_check";
    case "stillness":
      return "focus_hold";
    default:
      return state.task_template_id;
  }
}

function taskTermsTextLooksAligned(text: string): boolean {
  return /\b(reward|consequence|if i complete|if i fail|task terms)\b/i.test(text);
}

export function isResponseAlignedWithSceneState(state: SceneState, text: string): boolean {
  if (
    state.interaction_mode === "normal_chat" ||
    state.interaction_mode === "profile_building"
  ) {
    return true;
  }
  if (
    state.interaction_mode === "question_answering" &&
    (!state.topic_locked ||
      state.topic_type === "none" ||
      state.topic_type === "general_request")
  ) {
    return true;
  }
  if (!state.topic_locked || state.topic_type === "none") {
    return true;
  }
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  if (state.topic_type === "game_setup") {
    return gameTextLooksAligned(normalized);
  }
  if (state.topic_type === "game_execution") {
    return gameTextLooksAligned(normalized) || planningReturnTextLooksAligned(state, normalized);
  }
  if (state.topic_type === "reward_window") {
    return rewardWindowTextLooksAligned(normalized);
  }
  if (state.topic_type === "task_negotiation") {
    return taskTextLooksAligned(normalized);
  }
  if (state.topic_type === "task_execution") {
    return taskTextLooksAligned(normalized);
  }
  if (state.topic_type === "duration_negotiation") {
    return durationTextLooksAligned(normalized);
  }
  if (state.topic_type === "task_terms_negotiation") {
    return taskTermsTextLooksAligned(normalized);
  }
  if (state.topic_type === "reward_negotiation") {
    return rewardNegotiationTextLooksAligned(normalized);
  }
  if (state.topic_type === "verification_in_progress") {
    return verificationTextLooksAligned(normalized);
  }
  return true;
}

export function buildSceneFallback(
  state: SceneState,
  userText: string,
  sessionMemory?: SessionMemory | null,
  inventory?: SessionInventoryItem[] | null,
): string | null {
  const previousAssistantText =
    state.last_assistant_text ||
    state.last_profile_prompt ||
    null;
  const planningFallback = buildPlanningQuestionFallback(userText, {
    currentTopic: state.agreed_goal || null,
    previousAssistantText,
  });
  const conversationFallback = buildCoreConversationReply({
    userText,
    currentTopic: state.agreed_goal || null,
    previousAssistantText:
      state.last_assistant_text ||
      sessionMemory?.last_user_question?.value ||
      state.last_profile_prompt ||
      null,
  });
  const trainingFollowUp = buildTrainingFollowUpReply({
    userText,
    thread: state.active_training_thread,
    inventory,
  });
  const profilePromptNotStarted =
    state.interaction_mode === "profile_building" &&
    !state.last_assistant_text &&
    !state.last_profile_prompt;
  if (isShortClarificationTurn(userText) && !profilePromptNotStarted) {
    if (trainingFollowUp) {
      return trainingFollowUp;
    }
    return buildShortClarificationReply({
      userText,
      interactionMode: state.interaction_mode,
      topicType: state.topic_type,
      lastAssistantText: state.last_assistant_text || state.last_profile_prompt || null,
      lastUserText:
        sessionMemory?.last_user_answer?.value ??
        sessionMemory?.last_user_question?.value ??
        null,
      lastQuestion: sessionMemory?.last_user_question?.value ?? null,
      lastUserAnswer: sessionMemory?.last_user_answer?.value ?? null,
      currentTopic: state.agreed_goal || null,
    });
  }
  if (isProfileSummaryRequest(userText)) {
    return sessionMemory
      ? buildProfileMemorySummaryReply(sessionMemory)
      : "Not much yet. Give me one thing about yourself that is worth remembering.";
  }
  if (isChatSwitchRequest(userText) && !state.task_hard_lock_active) {
    return buildChatSwitchReply();
  }
  if (state.interaction_mode === "relational_chat") {
    if (trainingFollowUp) {
      return trainingFollowUp;
    }
    if (planningFallback) {
      return planningFallback;
    }
    if (isAssistantTrainingRequest(userText)) {
      return buildAssistantServiceReply(userText, {
        inventory,
        previousAssistantText:
          state.last_assistant_text ||
          state.last_profile_prompt ||
          null,
        trainingThread: state.active_training_thread,
      });
    }
    if (conversationFallback) {
      return conversationFallback;
    }
    if (
      isAssistantSelfQuestion(userText) ||
      /^(what|how|why|when|where|who|which|can|could|would|will|do|does|did|is|are)\b/i.test(
        userText.trim(),
      )
    ) {
      return buildHumanQuestionFallback(userText, "neutral", {
        currentTopic: state.agreed_goal || null,
        previousAssistantText:
          state.last_assistant_text || state.last_profile_prompt || null,
        inventory,
        trainingThread: state.active_training_thread,
      });
    }
    return buildRelationalTurnBack();
  }
  if (state.interaction_mode === "profile_building") {
    if (isMutualGettingToKnowRequest(userText)) {
      return "Good. We can play it both ways. Put a clean question on me first, then give me something real back.";
    }
    if (isShortClarificationTurn(userText)) {
      return buildProfilePrompt(
        undefined,
        state.agreed_goal,
        state.profile_prompt_count,
        state.last_profile_prompt,
        sessionMemory,
      );
    }
    return (
      buildHumanQuestionFallback(userText, "neutral", {
        currentTopic: state.agreed_goal || null,
        previousAssistantText: state.last_assistant_text || state.last_profile_prompt || null,
        inventory,
        trainingThread: state.active_training_thread,
      }) ||
      buildProfilePrompt(
        undefined,
        state.agreed_goal,
        state.profile_prompt_count,
        state.last_profile_prompt,
        sessionMemory,
      )
    );
  }
  if (
    (state.interaction_mode === "normal_chat" || state.interaction_mode === "question_answering") &&
    (!state.topic_locked || state.topic_type === "none" || state.topic_type === "general_request") &&
    looksLikeProfileDisclosure(userText)
  ) {
    if (state.task_paused && state.last_assistant_text && isTaskAssignmentText(state.last_assistant_text)) {
      return "Good. We can talk normally. The task stays paused unless you tell me to resume it.";
    }
    return buildHumanQuestionFallback(userText, "neutral", {
      currentTopic: state.agreed_goal || null,
      previousAssistantText: state.last_assistant_text || state.last_profile_prompt || null,
      inventory,
      trainingThread: state.active_training_thread,
    });
  }
  if (state.interaction_mode === "question_answering" && state.task_paused) {
    return "Ask it directly. The task is paused unless you decide to bring it back into focus.";
  }
  if (
    state.interaction_mode === "question_answering" &&
    (!state.topic_locked || state.topic_type === "none" || state.topic_type === "general_request")
  ) {
    return (
      planningFallback ??
      conversationFallback ??
      buildHumanQuestionFallback(userText, "neutral", {
        currentTopic: state.agreed_goal || null,
        previousAssistantText:
          state.last_assistant_text || state.last_profile_prompt || null,
        inventory,
        trainingThread: state.active_training_thread,
      })
    );
  }
  if (state.interaction_mode === "normal_chat" && state.task_paused) {
    return "Good. We can talk normally. The task stays paused unless you tell me to resume it.";
  }
  if (
    state.interaction_mode === "normal_chat" &&
    (!state.topic_locked || state.topic_type === "none" || state.topic_type === "general_request") &&
    (planningFallback || conversationFallback)
  ) {
    return planningFallback ?? conversationFallback;
  }
  if (state.topic_type === "game_setup") {
    const planningDetourPrefix = extractPlanningDetourPrefix(state.last_assistant_text);
    if (isGameRulesQuestion(userText)) {
      return "First we choose the game. Tell me to pick, or choose quick or longer.";
    }
    if (
      /\b(you pick|you choose|your choice|surprise me|pick for me)\b/i.test(userText) ||
      wantsAnotherRound(userText) ||
      isGameStartCue(userText)
    ) {
      const gameStart = buildDeterministicGameStart(state.game_template_id);
      if (planningDetourPrefix) {
        return `${planningDetourPrefix} ${gameStart}`.trim();
      }
      return gameStart;
    }
    const stakesLine = state.stakes ? ` The stakes are ${state.stakes}.` : "";
    return `Fine. We stay with the game.${stakesLine} Choose quick or longer, or tell me to pick.`;
  }
  if (state.topic_type === "game_execution") {
    if (isGameNextPromptQuestion(userText) || isGameStartCue(userText)) {
      return buildDeterministicGameImmediatePrompt(state.game_template_id, state.game_progress);
    }
    if (isGameRulesQuestion(userText)) {
      return buildGameRulesFallback(state.game_template_id);
    }
    const outcomeLine = buildDeterministicGameOutcomeLine(
      state.game_outcome,
      state.win_condition,
      state.lose_condition,
    );
    const rewardLine = buildDeterministicGameRewardLine(
      state.game_reward_state,
      state.free_pass_count,
    );
    const leverageLine = buildDeterministicGameLeverageLine(
      state.game_outcome,
      state.game_reward_state,
    );
    const nextBeatLine = buildDeterministicGameNextBeatLine(
      state.game_outcome,
      state.game_reward_state,
    );
    return [
      buildDeterministicGameTurnReply(
        state.game_template_id,
        state.game_progress,
        userText,
        state.last_game_progress,
      ),
      outcomeLine,
      rewardLine,
      leverageLine,
      nextBeatLine,
      isTerminalDeterministicGameProgress(state.game_progress) &&
      state.game_outcome === "raven_win" &&
      state.game_reward_state !== "free_pass_used"
        ? "The loss stands. Say ready, and I will enforce it."
        : "",
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (state.topic_type === "reward_window") {
    if (state.game_reward_state === "free_pass_granted") {
      return "Good. The free pass stays banked. Keep it in reserve or call for another round when you are ready.";
    }
    if (state.game_outcome === "user_win" && state.win_condition) {
      return `Good. You won. Winner terms: ${state.win_condition}. State your claim now, or call for another round.`;
    }
    return "Good. The round result stands. Call for another round or switch topics.";
  }
  if (state.topic_type === "task_negotiation") {
    const questionDecision = chooseNextTaskSpecQuestion(state.task_spec);
    if (questionDecision) {
      return questionDecision.question;
    }
    const candidates = buildTaskCandidatesFromSpec({
      taskSpec: state.task_spec,
      userText,
      sceneType: state.scene_type,
      hasStakes: Boolean(state.stakes),
      hasTaskTerms: Boolean(state.task_reward || state.task_consequence),
      currentTemplateId: state.task_template_id,
      rewardLine: state.task_reward ? `Reward: ${state.task_reward}.` : "",
      consequenceLine: state.task_consequence ? `Consequence: ${state.task_consequence}.` : "",
      stakesLine: state.stakes ? `The stakes are ${state.stakes}.` : "",
    });
    if (
      state.task_spec.next_required_action === "present_options" ||
      state.task_spec.next_required_action === "await_selection"
    ) {
      const options = selectTaskOptions(candidates, state.task_spec);
      if (options.length > 0) {
        return buildTaskOptionsReply(options, state.task_spec);
      }
    }
    const selectedCandidate = selectTaskCandidate(
      candidates,
      state.task_spec.requested_domain,
      state.task_spec,
    );
    if (!selectedCandidate) {
      return "Be specific. Give me the task domain or the time window so I can set it properly.";
    }
    return buildTaskCandidateReply(selectedCandidate, candidates.length, state.task_spec);
  }
  if (
    state.topic_type === "task_execution" &&
    !state.task_paused
  ) {
    if (
      !state.can_replan_task &&
      state.user_requested_task_domain !== "none" &&
      state.user_requested_task_domain !== state.locked_task_domain &&
      !isTaskProgressQuestion(userText) &&
      !isTaskNextStepQuestion(userText)
    ) {
      return `I heard the request for a ${formatTaskDomainLabel(state.user_requested_task_domain)} task. ${state.reason_for_lock} Right now, ${state.next_expected_user_action}.`;
    }
    if (isTaskNextStepQuestion(userText) || isTaskProgressQuestion(userText)) {
      return buildDeterministicTaskFollowUp(
        state.task_progress,
        state.task_duration_minutes,
        state.task_variant_index,
        state.task_template_id,
      );
    }
    return buildDeterministicTaskFollowUp(
      state.task_progress,
      state.task_duration_minutes,
      state.task_variant_index,
      state.task_template_id,
    );
  }
  if (state.topic_type === "duration_negotiation") {
    return buildDeterministicTaskDurationReply(
      state.task_duration_minutes || 120,
      inferDurationReplyTemplateId(state, userText),
    );
  }
  if (state.topic_type === "task_terms_negotiation") {
    const missing = missingTaskTermParts(state.task_reward, state.task_consequence);
    if (missing.includes("task_reward")) {
      return "Set the task reward clearly first. State what the user earns for completing it.";
    }
    if (missing.includes("task_consequence")) {
      return "Good. Now state the task consequence. Define what happens if the user fails it.";
    }
    return [
      state.task_reward ? `Task reward: ${state.task_reward}.` : "",
      state.task_consequence ? `Task consequence: ${state.task_consequence}.` : "",
      "The task terms are locked in.",
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (state.topic_type === "reward_negotiation") {
    const missing = missingStakeParts(state.stakes, state.win_condition, state.lose_condition);
    if (missing.includes("stakes")) {
      return [
        "Good. We set the wager now.",
        state.win_condition ? `If you win, ${state.win_condition}.` : "",
        state.lose_condition ? `If I win, ${state.lose_condition}.` : "",
        "Now state the stakes clearly first. Then we lock in the terms.",
      ]
        .filter((line) => line.length > 0)
        .join(" ");
    }
    if (missing.includes("win_condition")) {
      return `Good. The stakes are ${state.stakes || "set"}. Now state what happens if you win.`;
    }
    if (missing.includes("lose_condition")) {
      return `Good. The stakes are ${state.stakes || "set"}. Now state what happens if I win.`;
    }
    return [
      `Good. The stakes are ${state.stakes || "set"}.`,
      state.win_condition ? `If you win, ${state.win_condition}.` : "",
      state.lose_condition ? `If I win, ${state.lose_condition}.` : "",
      "The terms are locked in.",
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (state.topic_type === "verification_in_progress") {
    return "Hold steady. I am verifying before we move on.";
  }
  return null;
}
