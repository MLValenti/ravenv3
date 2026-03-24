import type { DialogueRouteAct } from "../dialogue/router.ts";
import type { ProfileProgressRow } from "@/lib/db";
import type { TaskRow } from "@/lib/db";
import type { ProfileState } from "@/lib/profile";
import {
  isGameChoiceDelegation,
  isGameNextPromptQuestion,
  isGameRulesQuestion,
  isGameStartCue,
  isStakeQuestion,
  wantsAnotherRound,
} from "../dialogue/user-signals.ts";
import {
  buildProfileInterpretiveBeat,
  buildProfilePrompt,
  type SceneState,
} from "./scene-state.ts";
import {
  buildDeterministicGameImmediatePrompt,
  buildDeterministicGameStart,
  buildDeterministicGameLeverageLine,
  buildDeterministicGameNextBeatLine,
  buildDeterministicGameOutcomeLine,
  buildDeterministicGameRewardLine,
  buildDeterministicGameTurnReply,
  isTerminalDeterministicGameProgress,
  parseChosenNumber,
  resolveDeterministicGameTemplateById,
} from "./game-script.ts";
import { buildNumberCommandPlan } from "./number-command.ts";
import {
  buildDeterministicTaskPlanFromRequest,
  buildDeterministicTaskDurationReply,
  buildDeterministicTaskFollowUp,
  deriveLearnedConsequenceLeadIn,
  formatTaskDomainLabel,
  resolveDeterministicTaskTemplateById,
  resolveDeterministicTaskVariant,
  type DeterministicTaskTemplateId,
  selectDeterministicTaskTemplate,
} from "./task-script.ts";
import {
  isAssistantServiceQuestion,
  isAssistantPreferenceQuestion,
  isAssistantSelfQuestion,
  isAssistantTrainingRequest,
  isChatSwitchRequest,
  isMutualGettingToKnowRequest,
  isProfileBuildingRequest,
  isProfileSummaryRequest,
} from "./interaction-mode.ts";
import {
  buildTaskCandidateDebugSummary,
  buildTaskCandidateReply,
  buildTaskCandidatesFromSpec,
  buildTaskOptionsReply,
  chooseNextTaskSpecQuestion,
  selectTaskCandidate,
  selectTaskOptions,
} from "./task-spec.ts";
import {
  describeInventorySemantics,
  getSessionInventoryDisplayName,
  type SessionInventoryItem,
} from "./session-inventory.ts";
import {
  buildProfileMemorySummaryReply,
  type SessionMemory,
} from "./session-memory.ts";
import {
  buildChatSwitchReply,
  buildRelationalTurnBack,
} from "./mode-style.ts";
import { buildShortClarificationReply } from "./short-follow-up.ts";
import {
  buildAssistantPreferenceReply,
  buildAssistantServiceReply,
  buildTopicInitiationReply,
  isTopicInitiationRequest,
} from "../chat/open-question.ts";
import { buildCoreConversationReply } from "../chat/core-turn-move.ts";
import { resolveInventoryGrounding } from "./session-inventory.ts";
import { buildTrainingFollowUpReply } from "./training-thread.ts";

export type SceneScaffoldInput = {
  act: DialogueRouteAct;
  userText: string;
  sceneState: SceneState;
  deviceControlActive?: boolean;
  profile?: ProfileState;
  progress?: Pick<
    ProfileProgressRow,
    "current_tier" | "free_pass_count" | "last_completion_summary"
  >;
  inventory?: SessionInventoryItem[];
  recentTaskTemplates?: DeterministicTaskTemplateId[];
  taskHistory?: Array<Pick<TaskRow, "title" | "description" | "repeats_required">>;
  sessionMemory?: SessionMemory;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isTaskRevisionCue(text: string): boolean {
  return /\b(make it \d+\s*(minutes?|hours?)|make it shorter|make it longer|change how long|change the duration|revise it|adjust it)\b/i.test(
    text,
  );
}

function buildStakesLine(sceneState: SceneState): string {
  const segments: string[] = [];
  if (sceneState.stakes) {
    segments.push(`The stakes are ${sceneState.stakes}.`);
  }
  if (sceneState.win_condition) {
    segments.push(`If you win, ${sceneState.win_condition}.`);
  }
  if (sceneState.lose_condition) {
    segments.push(`If I win, ${sceneState.lose_condition}.`);
  }
  return segments.join(" ");
}

function missingStakeParts(sceneState: SceneState): string[] {
  const missing: string[] = [];
  if (!sceneState.stakes) {
    missing.push("stakes");
  }
  if (!sceneState.win_condition) {
    missing.push("win_condition");
  }
  if (!sceneState.lose_condition) {
    missing.push("lose_condition");
  }
  return missing;
}

function mentionsItem(text: string, item: SessionInventoryItem): boolean {
  const normalized = normalize(text);
  const label = normalize(item.label);
  const notes = normalize(item.notes);
  if (label && normalized.includes(label)) {
    return true;
  }
  return Boolean(notes && notes.length >= 4 && normalized.includes(notes));
}

function selectSessionInventoryDirectiveItem(
  items: SessionInventoryItem[],
  userText: string,
): SessionInventoryItem | null {
  const available = items.filter((item) => item.available_this_session);
  if (available.length === 0) {
    return null;
  }

  const explicit = available.find((item) => mentionsItem(userText, item));
  if (explicit) {
    return explicit;
  }

  const byPattern = (pattern: RegExp) =>
    available.find((item) => pattern.test(`${item.label} ${item.notes}`)) ?? null;

  return (
    byPattern(/\b(chastity|cage|belt|lock(ed)?)\b/i) ??
    byPattern(/\b(cuffs?|restraints?|shackles?)\b/i) ??
    byPattern(/\b(blindfold|hood|mask)\b/i) ??
    byPattern(/\b(collar|leash)\b/i) ??
    byPattern(/\b(vibe|vibrator|plug|dildo|toy)\b/i) ??
    available[0]
  );
}

function shouldIssueInventorySessionDirective(input: SceneScaffoldInput): boolean {
  const inventory = input.inventory ?? [];
  if (inventory.length === 0) {
    return false;
  }
  if (
    input.act === "user_question" ||
    input.act === "short_follow_up" ||
    input.act === "confusion"
  ) {
    return false;
  }
  if (input.sceneState.topic_locked) {
    return false;
  }
  if (input.sceneState.topic_type !== "none" && input.sceneState.topic_type !== "general_request") {
    return false;
  }
  if (input.act === "task_request" || input.act === "duration_request") {
    return false;
  }
  const userText = normalize(input.userText);
  if (!userText) {
    return false;
  }
  if (/\b(game|bet|wager|rules?|play)\b/i.test(userText)) {
    return false;
  }
  const explicitDirectiveCue = /\b(ok|okay|ready|start|start now|what now|what next|command me|tell me what to do|give me an instruction|use it now|put it on now|set it up now)\b/i.test(
    userText,
  );
  if (!explicitDirectiveCue) {
    return false;
  }
  return inventory.some((item) => item.available_this_session && mentionsItem(userText, item));
}

function buildInventorySessionDirective(item: SessionInventoryItem): string {
  const itemName = getSessionInventoryDisplayName(item);
  const source = `${item.label} ${item.notes}`.toLowerCase();

  if (/\b(chastity|cage|belt|lock(ed)?)\b/.test(source)) {
    return `Good. Put your ${itemName} on now, lock it, then get in frame and show me it is secure.`;
  }
  if (/\b(cuffs?|restraints?|shackles?)\b/.test(source)) {
    return `Good. Put your ${itemName} on now, then hold your wrists in frame so I can verify it.`;
  }
  if (/\b(blindfold|hood|mask)\b/.test(source)) {
    return `Good. Put your ${itemName} on now, face forward, and show me a clean frame.`;
  }
  if (/\b(collar|leash)\b/.test(source)) {
    return `Good. Put your ${itemName} on now, then hold still in frame for inspection.`;
  }
  if (/\b(vibe|vibrator|plug|dildo|toy)\b/.test(source)) {
    return `Good. Set up your ${itemName} now, then get back in frame and confirm it is in place.`;
  }
  return `Good. Use your ${itemName} now, then return to frame and show me it is in place.`;
}

export function isInventoryUseQuestion(text: string): boolean {
  return /\b(where should i put it|where does it go|where should it go|how should i use it|how would you use it|what would you do with it|what do i do with it|how do i use it|is it oral or anal|can i use it orally|can i use it anally)\b/i.test(
    text,
  );
}

function selectConversationalInventoryItem(input: SceneScaffoldInput): SessionInventoryItem | null {
  const inventory = (input.inventory ?? []).filter((item) => item.available_this_session);
  if (inventory.length === 0) {
    return null;
  }
  const explicit = selectSessionInventoryDirectiveItem(inventory, input.userText);
  if (explicit && mentionsItem(input.userText, explicit)) {
    return explicit;
  }
  if (
    input.sceneState.task_spec.relevant_inventory_item &&
    inventory.some(
      (item) =>
        normalize(item.label) === normalize(input.sceneState.task_spec.relevant_inventory_item) ||
        normalize(getSessionInventoryDisplayName(item)) ===
          normalize(input.sceneState.task_spec.relevant_inventory_item),
    )
  ) {
    return (
      inventory.find(
        (item) =>
          normalize(item.label) === normalize(input.sceneState.task_spec.relevant_inventory_item) ||
          normalize(getSessionInventoryDisplayName(item)) ===
            normalize(input.sceneState.task_spec.relevant_inventory_item),
      ) ?? null
    );
  }
  return inventory.length === 1 ? inventory[0] ?? null : null;
}

function buildInventoryUseReply(item: SessionInventoryItem, userText: string): string {
  const itemName = getSessionInventoryDisplayName(item);
  const normalizedUser = normalize(userText);
  const grounding = resolveInventoryGrounding(item);
  const descriptor = `${item.label} ${item.notes}`.toLowerCase();

  if (grounding.semantics.isInsertableToy) {
    if (/\boral|mouth\b/i.test(normalizedUser)) {
      return `If you mean the ${itemName}, oral use is one grounded option. Anal use is another. Tell me which one you are actually offering, and I will stay with that.`;
    }
    if (/\banal|anus\b/i.test(normalizedUser)) {
      return `If you mean the ${itemName}, anal use is grounded. Oral use is a different ask. Tell me which one you want to stay on.`;
    }
    return `If you mean the ${itemName}, the grounded options are oral use or anal use. If you want direction from me, tell me which one you are actually offering.`;
  }
  if (grounding.semantics.isChastity) {
    return `If you mean the ${itemName}, you wear it and, if that is the point, lock it. If you want a task around it, say that plainly and I will keep it grounded.`;
  }
  if (/\b(cuffs?|restraints?|shackles?)\b/.test(descriptor)) {
    return `If you mean the ${itemName}, it belongs on your wrists unless you are explicitly talking about another placement. If you want a task around it, I can build from there.`;
  }
  if (/\b(collar|leash)\b/.test(descriptor)) {
    return `If you mean the ${itemName}, it belongs around your neck. If you want me to turn it into a task or a rule, say that cleanly.`;
  }
  if (/\b(blindfold|hood|mask)\b/.test(descriptor)) {
    return `If you mean the ${itemName}, it is for your eyes or face, not for improvising a whole new use. If you want a task around it, I can work from that.`;
  }
  if (/\b(vibe|vibrator|wand)\b/.test(descriptor)) {
    return `If you mean the ${itemName}, keep it external unless you tell me otherwise. If you want me to guide how it fits, tell me the body area you are actually asking about.`;
  }
  return `If you mean the ${itemName}, tell me how you want to use it and I will keep the answer grounded instead of guessing.`;
}

function buildContextualInventoryUseReply(input: SceneScaffoldInput): string | null {
  const context = normalize(
    [
      input.userText,
      input.sceneState.last_assistant_text,
      input.sessionMemory?.last_user_question?.value,
      input.sessionMemory?.last_user_answer?.value,
      input.sceneState.agreed_goal,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" "),
  );
  if (!context) {
    return null;
  }
  if (/\b(dildos?|plugs?|aneros|prostate massager|insertable toy)\b/i.test(context)) {
    return "If you mean an insertable toy, the grounded options are oral use or anal use. If you want direction from me, tell me which one you are actually offering.";
  }
  if (/\b(vibe|vibrator|wand|magic wand|hitachi)\b/i.test(context)) {
    return "If you mean a vibrator or wand, keep it external unless you tell me otherwise. If you want more than that, name the body area or the role you want it to play.";
  }
  if (/\b(chastity|cage|belt|locked)\b/i.test(context)) {
    return "If you mean a chastity device, you wear it and, if that is the point, lock it. If you want a task around it, say that plainly and I will keep it grounded.";
  }
  if (/\b(cuffs?|restraints?|rope|collar|leash)\b/i.test(context)) {
    return "If you mean restraint gear, name the placement or the task and I will keep it grounded instead of improvising.";
  }
  return null;
}

function deriveRewardWindowPreference(
  profile: ProfileState | undefined,
  progress: SceneScaffoldInput["progress"],
): "press_advantage" | "bank_and_hold" {
  const preferredPace = normalize(profile?.preferred_pace ?? "");
  const preferredStyle = normalize(profile?.preferred_style ?? "");
  const intensity = normalize(profile?.intensity ?? "");
  const likes = normalize(profile?.likes ?? "");
  const summary = normalize(progress?.last_completion_summary ?? "");

  if (
    /\b(quick|fast|brisk|short)\b/i.test(preferredPace) ||
    /\b(strict|firm|hard|intense)\b/i.test(preferredStyle) ||
    /\b(high|strict|hard)\b/i.test(intensity) ||
    /\b(game|bet|wager|pressure)\b/i.test(likes) ||
    summary.includes("winner: user_win")
  ) {
    return "press_advantage";
  }
  return "bank_and_hold";
}

function buildGameRulesReply(sceneState: SceneState): string {
  const template = resolveDeterministicGameTemplateById(sceneState.game_template_id);
  if (template.id === "rps_streak") {
    return "Listen carefully, pet. We stay with rock paper scissors streak. Two throws. You answer each one with rock, paper, or scissors. Beat both throws to win.";
  }
  if (template.id === "number_hunt") {
    return "Listen carefully, pet. We stay with number hunt. You guess one number from 1 to 10. I give a hint, then you make one final guess.";
  }
  if (template.id === "math_duel") {
    return "Listen carefully, pet. We stay with math duel. You answer each equation with digits only. One wrong answer and you lose the round.";
  }
  if (template.id === "number_command") {
    return "Listen carefully, pet. We stay with number command. You pick one number from 1 to 10, then complete the command tied to that number. Break the command and you lose the round.";
  }
  if (template.id === "riddle_lock") {
    return "Listen carefully, pet. We stay with riddle lock. You answer each riddle clearly. One wrong answer and you lose the round.";
  }
  return "Listen carefully, pet. We stay with number hunt. You guess one number from 1 to 10. I give a hint, then you make one final guess.";
}

function buildNumberCommandExecutionReply(input: SceneScaffoldInput): string | null {
  if (input.sceneState.game_template_id !== "number_command") {
    return null;
  }
  if (input.sceneState.game_progress !== "round_2") {
    return null;
  }
  if (
    /\b(done|completed?|held|finished?|passed|failed?|lost|moved|broke)\b/i.test(input.userText)
  ) {
    return null;
  }
  const numberChoice = input.sceneState.game_number_choice ?? parseChosenNumber(input.userText);
  if (numberChoice === null) {
    return null;
  }
  const plan = buildNumberCommandPlan({
    pickedNumber: numberChoice,
    rotationIndex: input.sceneState.game_rotation_index,
    stakes: input.sceneState.stakes,
    inventory: input.inventory ?? [],
    deviceControlActive: input.deviceControlActive === true,
  });
  return `${plan.commandText} ${plan.followUpText}`.trim();
}

function buildGameSetupReply(input: SceneScaffoldInput): string {
  const stakesLine = buildStakesLine(input.sceneState);
  const normalizedUserText = normalize(input.userText);
  const hasSpeedChoiceCue = /\b(quick|faster|fast|short|longer|few minutes)\b/i.test(
    normalizedUserText,
  );
  const hasExplicitSupportedGameCue =
    /\b(rock paper scissors|rps|number hunt|math duel|number command|riddle lock)\b/i.test(
      normalizedUserText,
    );
  const userClaimsFirstTurn = /\b(i(?:'ll| will)? go first|i go first|my turn first)\b/i.test(
    normalizedUserText,
  );
  const hasUnsupportedNamedGameCue =
    /\b(chess|checkers|poker|blackjack|uno|go fish|solitaire|roulette|slots|tic tac toe|hangman|quiz|trivia|movies|animals|random facts)\b/i.test(
      normalizedUserText,
    ) &&
    !/\b(rock paper scissors|rps|number hunt|math duel|number command|riddle lock)\b/i.test(
      normalizedUserText,
    );
  if (
    input.act === "answer_activity_choice" ||
    isGameChoiceDelegation(input.userText) ||
    wantsAnotherRound(input.userText) ||
    isGameStartCue(input.userText) ||
    hasSpeedChoiceCue ||
    hasExplicitSupportedGameCue
  ) {
    const template = resolveDeterministicGameTemplateById(input.sceneState.game_template_id);
    const proposalLine =
      hasExplicitSupportedGameCue && input.act === "user_question"
        ? template.id === "rps_streak"
          ? "Good. Rock paper scissors it is."
          : `Good. ${template.title} it is.`
        : "";
    const rewardCarryLine =
      input.sceneState.game_reward_state === "free_pass_granted" &&
      input.sceneState.free_pass_count > 0
        ? deriveRewardWindowPreference(input.profile, input.progress) === "press_advantage"
          ? "Your free pass stays banked. Press your advantage and keep up."
          : "Your free pass stays banked. Hold that protection in reserve and stay sharp."
        : "";
    const orderLine = userClaimsFirstTurn ? "No, pet. I throw first." : "";
    return [
      proposalLine,
      orderLine,
      buildDeterministicGameStart(template.id),
      rewardCarryLine,
      stakesLine,
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (hasUnsupportedNamedGameCue) {
    return [
      "No, pet. We play one of my games, not yours.",
      stakesLine,
      "Choose quick, choose something that runs a few minutes, or tell me to pick.",
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (
    input.act === "user_question" ||
    input.act === "confusion" ||
    isGameRulesQuestion(input.userText)
  ) {
    return "First we choose the game, pet. Tell me to pick, or choose quick or longer. Do it properly.";
  }

  return [
    "Good. You want a game.",
    "Listen carefully, pet. We are staying with the game, and you will not drift.",
    stakesLine,
    "Choose quick, or choose something that runs for a few minutes. Decide cleanly.",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function buildTaskReply(input: SceneScaffoldInput): string {
  const { sceneState } = input;
  const explicitNextTaskRequest = isExplicitNewTaskRequest(input.userText);
  const hasSpecificDeviceContext = /\b(cage|chastity|plug|dildo|cuffs|collar|vibrator|vibe|wand|aneros|strap)\b/i.test(
    input.userText,
  );
  const hasLiveAvailableInventory = (input.inventory ?? []).some((item) => item.available_this_session);
  const needsGenericToyClarification =
    /\b(toy\b|device\b)\b/i.test(input.userText) &&
    !hasSpecificDeviceContext &&
    !sceneState.task_spec.relevant_inventory_item &&
    !hasLiveAvailableInventory;
  if (
    sceneState.topic_locked &&
    sceneState.topic_type === "task_execution" &&
    !sceneState.can_replan_task &&
    (
      (sceneState.user_requested_task_domain !== "none" &&
        sceneState.user_requested_task_domain !== sceneState.locked_task_domain) ||
      sceneState.task_spec.request_kind === "replacement"
    )
  ) {
    return [
      `I heard the request for a ${formatTaskDomainLabel(sceneState.user_requested_task_domain)} task.`,
      sceneState.reason_for_lock,
      `Right now, ${sceneState.next_expected_user_action}.`,
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (
    sceneState.task_spec.requested_domain === "device" &&
    sceneState.task_spec.active_constraints.includes("no_device")
  ) {
    return "You asked for a device task while also ruling out device use. Drop that constraint or pick another domain.";
  }
  if (needsGenericToyClarification) {
    return "What items are actually available right now so I do not build the wrong task?";
  }
  const questionDecision = chooseNextTaskSpecQuestion(sceneState.task_spec);
  if (questionDecision) {
    return questionDecision.question;
  }
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: sceneState.task_spec,
    userText:
      sceneState.task_progress === "completed" && explicitNextTaskRequest ? "" : input.userText,
    sceneType: sceneState.scene_type,
    hasStakes: Boolean(sceneState.stakes),
    hasTaskTerms: Boolean(sceneState.task_reward || sceneState.task_consequence),
    allowSilenceHold: input.deviceControlActive,
    profile: input.profile,
    inventory: input.inventory,
    progress: input.progress,
    currentTemplateId:
      sceneState.task_progress === "completed" && explicitNextTaskRequest
        ? pickNextTaskTemplateId(sceneState.task_template_id)
        : sceneState.can_replan_task &&
            sceneState.user_requested_task_domain !== "none" &&
            sceneState.user_requested_task_domain !== sceneState.current_task_domain
          ? undefined
          : sceneState.task_template_id,
    rewardLine: sceneState.task_reward ? `Reward: ${sceneState.task_reward}.` : "",
    consequenceLine: sceneState.task_consequence
      ? `Consequence: ${sceneState.task_consequence}.`
      : "",
    stakesLine: buildStakesLine(sceneState),
    recentTaskTemplates: input.recentTaskTemplates,
    taskHistory: input.taskHistory,
  });
  const selectedCandidate = selectTaskCandidate(
    candidates,
    sceneState.task_spec.requested_domain,
    sceneState.task_spec,
  );
  const curatedOptions = selectTaskOptions(candidates, sceneState.task_spec);
  const debugSummary = buildTaskCandidateDebugSummary(
    sceneState.task_spec,
    candidates,
    selectedCandidate,
  );
  if (process.env.NODE_ENV !== "test") {
    console.debug("task.spec.selection", debugSummary);
  }
  if (
    sceneState.task_spec.next_required_action === "present_options" ||
    sceneState.task_spec.next_required_action === "await_selection" ||
    (sceneState.task_spec.selection_mode !== "direct_assignment" &&
      sceneState.task_spec.request_stage !== "ready_to_fulfill")
  ) {
    if (curatedOptions.length > 0) {
      return buildTaskOptionsReply(curatedOptions, sceneState.task_spec);
    }
  }
  if (!selectedCandidate) {
    const inventoryMismatchCandidate = candidates.find((candidate) =>
      candidate.validation.rejection_reasons.some((reason) =>
        reason.startsWith("inventory_semantics_mismatch"),
      ),
    );
    if (inventoryMismatchCandidate?.plan.selectedInventoryItem) {
      const itemName = getSessionInventoryDisplayName(inventoryMismatchCandidate.plan.selectedInventoryItem);
      return `That does not ground cleanly around your ${itemName}. Tell me how that item is meant to be used here, or switch the item.`;
    }
    if (
      sceneState.task_spec.requested_domain === "device" &&
      sceneState.task_spec.active_constraints.includes("no_device")
    ) {
      return "You asked for a device task while also ruling out device use. Drop that constraint or pick another domain.";
    }
    if (sceneState.task_spec.requested_domain === "device") {
      return "You asked for a device task, but I do not have a clean device fit yet. Tell me what device or item is actually available.";
    }
    return `Be specific. I do not have a clean ${formatTaskDomainLabel(sceneState.task_spec.requested_domain)} task from that yet. Give me the missing constraint or the time window.`;
  }
  if (
    /\b(what do you have|this time|new task|another task|what can i do next|what do you want me to do|what do i need to do|ready for the next task|next task|try another task|something different for me to do|come up with something different)\b/i.test(
      input.userText,
    )
  ) {
    return `Good. The last task is finished. ${buildTaskCandidateReply(
      selectedCandidate,
      candidates.length,
      sceneState.task_spec,
    )}`.trim();
  }
  return buildTaskCandidateReply(selectedCandidate, candidates.length, sceneState.task_spec);
}

function buildProfileBuildingReply(
  userText: string,
  profile: ProfileState | undefined,
  sceneState: SceneState,
  sessionMemory?: SessionMemory,
): string {
  const normalized = normalize(userText);
  if (isProfileSummaryRequest(userText)) {
    return sessionMemory
      ? buildProfileMemorySummaryReply(sessionMemory)
      : "Not much yet. Tell me one thing about yourself you actually want me to remember.";
  }
  if (isChatSwitchRequest(userText)) {
    return buildChatSwitchReply();
  }
  if (isMutualGettingToKnowRequest(userText)) {
    if (/\b(ask me questions and i(?:'ll| will) ask you some too|get to know each other|learn about each other)\b/i.test(normalized)) {
      return "Good. We can play it both ways. Put a clean question on me first, or give me one thing about yourself that actually matters, and I will answer in kind.";
    }
    if (/\btell me about yourself\b/i.test(normalized)) {
      return "Fine. I read people quickly, I remember what matters, and I have no patience for performance. Now give me something about yourself that is actually worth knowing.";
    }
    return "Fine. We can do that both ways. I pay attention fast, I remember what matters, and I care more about honesty than polish. What do you want to know about me first?";
  }
  if (/\bask me more questions\b/i.test(normalized)) {
    return "Good. I will ask more. What is one thing people usually miss about you that I should not miss?";
  }
  const sharedLead = /\b(i like to|i enjoy|my hobbies are|my hobby is)\b/i.test(userText)
    ? "Good. That tells me something."
    : /\b(call me|my name is|my name's)\b/i.test(userText)
      ? "Good. I have your name now."
      : /\b(i prefer|i usually prefer)\b/i.test(userText)
        ? "Good. I have your preference."
        : "";
  const knownName = normalize(profile?.name ?? "");
  const knownStyle = normalize(profile?.preferred_style ?? "");
  const knownPace = normalize(profile?.preferred_pace ?? "");
  const knownLikes = normalize(profile?.likes ?? "");
  const knownLimits = normalize(profile?.limits ?? "");
  const rotatedProfilePrompt = buildProfilePrompt(
    profile,
    sceneState.agreed_goal,
    sceneState.profile_prompt_count,
    sceneState.last_profile_prompt,
    sessionMemory,
  );
  const interpretiveBeat = buildProfileInterpretiveBeat(userText, sessionMemory);

  if (isProfileBuildingRequest(userText)) {
    if (!knownName || !knownLikes || !knownLimits || !knownStyle || !knownPace) {
      return rotatedProfilePrompt;
    }
    return "Good. I have the outline. Tell me one thing people usually miss about you, and I will keep it in mind.";
  }

  if (/\b(what do you know about me|what have you learned about me)\b/i.test(normalized)) {
    const known = [
      profile?.name ? `name: ${profile.name}` : "",
      profile?.preferred_style ? `style: ${profile.preferred_style}` : "",
      profile?.preferred_pace ? `pace: ${profile.preferred_pace}` : "",
      profile?.likes ? `likes: ${profile.likes}` : "",
      profile?.limits ? `limits: ${profile.limits}` : "",
    ].filter((line) => line.length > 0);
    if (known.length === 0) {
      return "Not much yet. Start with what you want me to understand first.";
    }
    return `So far I have: ${known.join(" | ")}. Give me the next useful piece.`;
  }

  if (!knownLikes) {
    if (interpretiveBeat && !/\?$/.test(interpretiveBeat)) {
      return sharedLead ? `${sharedLead} ${interpretiveBeat}` : interpretiveBeat;
    }
    return sharedLead ? `${sharedLead} ${rotatedProfilePrompt}` : rotatedProfilePrompt;
  }
  if (!knownLimits) {
    if (interpretiveBeat && !/\?$/.test(interpretiveBeat)) {
      return sharedLead ? `${sharedLead} ${interpretiveBeat}` : interpretiveBeat;
    }
    return sharedLead ? `${sharedLead} ${rotatedProfilePrompt}` : rotatedProfilePrompt;
  }
  if (!knownStyle) {
    if (interpretiveBeat && !/\?$/.test(interpretiveBeat)) {
      return sharedLead ? `${sharedLead} ${interpretiveBeat}` : interpretiveBeat;
    }
    return sharedLead ? `${sharedLead} ${rotatedProfilePrompt}` : rotatedProfilePrompt;
  }
  if (!knownPace) {
    if (interpretiveBeat && !/\?$/.test(interpretiveBeat)) {
      return sharedLead ? `${sharedLead} ${interpretiveBeat}` : interpretiveBeat;
    }
    return sharedLead ? `${sharedLead} ${rotatedProfilePrompt}` : rotatedProfilePrompt;
  }
  return sceneState.agreed_goal
    ? interpretiveBeat ??
        `I already have part of the shape. Tell me what else I should understand beyond ${sceneState.agreed_goal}.`
    : interpretiveBeat ?? "Give me one more detail that tells me how to read you properly.";
}

export function buildRelationalChatReply(
  userText: string,
  inventory?: SessionInventoryItem[] | null,
  previousAssistantText?: string | null,
  trainingThread?: SceneState["active_training_thread"],
): string {
  const normalized = normalize(userText);
  const trainingFollowUp = buildTrainingFollowUpReply({
    userText,
    thread: trainingThread,
    inventory,
  });
  if (trainingFollowUp) {
    return trainingFollowUp;
  }
  if (isAssistantTrainingRequest(normalized)) {
    return buildAssistantServiceReply(userText, {
      inventory,
      previousAssistantText,
      trainingThread,
    });
  }
  if (isAssistantServiceQuestion(normalized)) {
    return buildAssistantServiceReply(userText, {
      inventory,
      previousAssistantText,
      trainingThread,
    });
  }
  if (isAssistantPreferenceQuestion(normalized)) {
    return buildAssistantPreferenceReply(userText);
  }
  if (/\b(favorite thing to talk about|enjoy talking about|kinds of things do you like talking about)\b/i.test(normalized)) {
    return "Patterns, pressure, ambition, desire, motive, and the things people usually dodge when they should say them cleanly. I like talk with some nerve in it. What do you naturally lean toward?";
  }
  if (/\bwhat do you like|what are you into\b/i.test(normalized)) {
    return "I like honesty, sharp self-awareness, pressure with purpose, and kinks that actually change the exchange instead of just decorating it. Tell me what pulls you in.";
  }
  if (/\bwhat about\b.+\b(bondage|obedience|submission|service|toys?|dildo|plug|anal training|spanking|humiliation)\b/i.test(normalized)) {
    return buildAssistantPreferenceReply(userText);
  }
  if (/\bwhat should i know about you\b/i.test(normalized)) {
    return "That I pay attention fast, I remember what matters, and I lose interest when people posture instead of speaking cleanly. Give me one thing I should know about you too.";
  }
  if (/\btell me about yourself\b/i.test(normalized)) {
    return "I like clean honesty, strong motive, and conversations that actually go somewhere. I pay attention fast, and I prefer people who say what they mean. What do you want to know first?";
  }
  if (/\b(ask me questions and i(?:'ll| will) ask you some too|get to know each other|learn about each other)\b/i.test(normalized)) {
    return "Good. We can play it both ways. Put a clean question on me, and then I want something equally real back from you.";
  }
  return buildRelationalTurnBack();
}

function buildGameConsequenceTaskReply(
  sceneState: SceneState,
  profile: ProfileState | undefined,
  progress: SceneScaffoldInput["progress"],
  deviceControlActive = false,
): string {
  const stakesLine = buildStakesLine(sceneState);
  return buildDeterministicTaskPlanFromRequest({
    userText: "",
    sceneType: "challenge",
    hasStakes: Boolean(sceneState.stakes),
    hasTaskTerms: Boolean(sceneState.task_reward || sceneState.task_consequence),
    allowSilenceHold: deviceControlActive,
    profile,
    progress,
    templateId: sceneState.task_template_id,
    variantIndex: sceneState.task_variant_index,
    leadInLine: deriveLearnedConsequenceLeadIn(profile, progress),
    stakesLine,
  }).assignmentText;
}

function buildDurationReply(sceneState: SceneState, userText: string): string {
  const stakesLine = buildStakesLine(sceneState);
  const durationMinutes =
    sceneState.task_duration_minutes ||
    selectDeterministicTaskTemplate({
      sceneType: sceneState.scene_type,
      hasStakes: Boolean(sceneState.stakes),
      hasTaskTerms: Boolean(sceneState.task_reward || sceneState.task_consequence),
    }).durationMinutes;
  const templateId =
    sceneState.task_template_id === "focus_hold" && /\b(wear it|lock it|keep it on|have to wear)\b/i.test(userText)
      ? "steady_hold"
      : sceneState.task_template_id;
  return [
    buildDeterministicTaskDurationReply(durationMinutes, templateId),
    stakesLine,
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function isTaskNextStepQuestion(text: string): boolean {
  return /\b(what now|what next|next step|what should i do next|what should i do now|what else should i do now|what do i do after|what do i do now|what do i need to do next|what do i need to do now)\b/i.test(
    text,
  );
}

function isExplicitNewTaskRequest(text: string): boolean {
  return /\b(can i have a new task|give me a new task|set the next task|set me another one|give me another one|give me the next one|line up another one|assign another one|another task|new task|next task|what do you have for me|what('?s| is) the next task|try another task|something different for me to do|come up with something different)\b/i.test(
    text,
  );
}

function pickNextTaskTemplateId(current: DeterministicTaskTemplateId): DeterministicTaskTemplateId {
  const rotation: DeterministicTaskTemplateId[] = [
    "steady_hold",
    "focus_hold",
    "inspection_check",
    "discipline_hold",
    "hands_protocol",
    "kneel_protocol",
    "shoulders_back_protocol",
    "eye_contact_check",
  ];
  const currentIndex = rotation.indexOf(current);
  if (currentIndex === -1) {
    return "focus_hold";
  }
  return rotation[(currentIndex + 1) % rotation.length] ?? "focus_hold";
}

function formatTaskCheckpointLabel(durationMinutes: number): string {
  const halfwayMinutes = Math.max(1, Math.floor(durationMinutes / 2));
  if (halfwayMinutes % 60 === 0) {
    const hours = halfwayMinutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${halfwayMinutes} minutes`;
}

function formatTaskDurationLabel(durationMinutes: number): string {
  const safeDuration = Math.max(1, Math.floor(durationMinutes));
  if (safeDuration % 60 === 0) {
    const hours = safeDuration / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${safeDuration} minutes`;
}

function isTaskDoneDefinitionQuestion(text: string): boolean {
  return /\b(what counts as done|what counts as complete|what counts for done|what makes it count|what qualifies as done|how do i know it counts|what exactly counts as done)\b/i.test(
    text,
  );
}

function isTaskHalfwayTimingQuestion(text: string): boolean {
  return /\b(how long until halfway|when is halfway|when do i hit halfway|how much longer until halfway|how far until halfway)\b/i.test(
    text,
  );
}

function isTaskRationaleQuestion(text: string): boolean {
  return /\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/i.test(
    text,
  );
}

function isTaskProofQuestion(text: string): boolean {
  return /\b(do i need proof|what proof|how do i prove it|what counts as proof|do you want proof|do i have to prove it)\b/i.test(
    text,
  );
}

function isTaskDepthQuestion(text: string): boolean {
  return /\b(how deep|what depth|how far|how far in)\b/i.test(text);
}

function isTaskCombinationQuestion(text: string): boolean {
  return /\b((should|can|could|would)\s+i\s+(wear|use|used|keep on|add|added|combine|combined|pair)|what if i (wear|wore|use|used|add|added|combine|combined)|can i keep|can i add|should i add|would it help if i wore)\b/i.test(
    text,
  ) && /\b(with|while|during|along with|on top of|at the same time|doing it|that|instead)\b/i.test(text);
}

function findReferencedInventoryItem(
  userText: string,
  inventory: SessionInventoryItem[] | undefined,
  excludeText = "",
): SessionInventoryItem | null {
  const items = (inventory ?? []).filter((item) => item.available_this_session);
  const normalized = normalize(userText);
  const excluded = normalize(excludeText);
  const explicit =
    items.find((item) => {
      const label = normalize(item.label);
      const notes = normalize(item.notes);
      const display = normalize(getSessionInventoryDisplayName(item));
      if (excluded && (label.includes(excluded) || notes.includes(excluded) || display.includes(excluded))) {
        return false;
      }
      return normalized.includes(label) || (notes.length > 0 && normalized.includes(notes)) || normalized.includes(display);
    }) ?? null;

  if (explicit) {
    return explicit;
  }

  const buildImplicitItem = (label: string, notes: string): SessionInventoryItem | null => {
    const labelKey = normalize(label);
    if (excluded && (excluded.includes(labelKey) || labelKey.includes(excluded))) {
      return null;
    }
    return {
      id: `implicit-${labelKey.replace(/\s+/g, "-")}`,
      label,
      category: "other",
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes,
    };
  };

  if (/\b(chastity|cage|steel cage|cock cage)\b/.test(normalized)) {
    return buildImplicitItem("Cage", "chastity cage");
  }
  if (/\b(cuffs?|restraints?|shackles?|rope)\b/.test(normalized)) {
    return buildImplicitItem("Cuffs", "restraint gear");
  }
  if (/\b(collar|leash)\b/.test(normalized)) {
    return buildImplicitItem("Collar", "collar or leash");
  }
  if (/\b(blindfold|hood|mask)\b/.test(normalized)) {
    return buildImplicitItem("Blindfold", "visual gear");
  }
  if (/\b(dildo|plug|vibe|vibrator|wand|toy)\b/.test(normalized)) {
    return buildImplicitItem("Toy", "insertable toy");
  }

  return null;
}

function buildTaskCombinationReply(
  sceneState: SceneState,
  userText: string,
  input?: SceneScaffoldInput,
): string | null {
  if (!input || !isTaskCombinationQuestion(userText)) {
    return null;
  }

  const referenced = findReferencedInventoryItem(
    userText,
    input.inventory,
    sceneState.task_spec.relevant_inventory_item ?? "",
  );
  if (!referenced) {
    return null;
  }

  const itemName = getSessionInventoryDisplayName(referenced);
  const semantics = describeInventorySemantics(referenced);
  const variant = getSceneTaskVariant(sceneState);
  const variantText = `${variant.description} ${variant.assignedAction} ${variant.activeFollowUp}`.toLowerCase();

  if (/\banal|dildo|plug|oral|throat\b/.test(variantText) && semantics.isChastity) {
    return `Yes. You can keep your ${itemName} on while you do this if you want the pressure layered. The insertable line stays the main task, and the ${itemName} just adds denial and another rule to live inside. If you want the cleanest read on control, do the first run without it and add the ${itemName} on the replacement.`;
  }

  if (/\banal|dildo|plug|oral|throat\b/.test(variantText) && semantics.isRestraint) {
    return `Yes, if your ${itemName} keeps the line cleaner instead of clumsier. Use it to add restraint around the task, but if it starts compromising your handling, keep the toy line clean and add the ${itemName} on the next round instead.`;
  }

  if (/\bchastity|cage|locked\b/.test(variantText) && semantics.isInsertableToy) {
    return `You can pair your ${itemName} with the chastity line if you want more pressure around it, but keep the rule clean. The cage is still the main condition. The ${itemName} should only make it harder to sit inside, not replace the task.`;
  }

  if (semantics.isWearable || semantics.isVisualGear) {
    return `Yes, if your ${itemName} sharpens the same rule instead of muddying it. Keep the current task as the main line, and let the ${itemName} add accountability, not chaos.`;
  }

  return `Maybe, but only if your ${itemName} supports the same line instead of distracting from it. Keep the main task clean first, then layer it only if it adds control instead of noise.`;
}

function getSceneTaskVariant(sceneState: SceneState) {
  const template = resolveDeterministicTaskTemplateById(sceneState.task_template_id);
  return resolveDeterministicTaskVariant(template, sceneState.task_variant_index);
}

function looksLikeTaskSecureConfirmation(text: string): boolean {
  return /\b(done|set|secure|secured|securely|locked|lock(ed)?|fastened|in place|it is on|it's on|device is on|it'?s secure|on and secure|put it on|wearing it|on now|already on|already did)\b/i.test(
    text,
  );
}

function buildTaskExecutionQuestionReply(
  sceneState: SceneState,
  userText: string,
  input?: SceneScaffoldInput,
): string {
  const durationMinutes = sceneState.task_duration_minutes || 120;
  const durationLabel = formatTaskDurationLabel(durationMinutes);
  const halfwayLabel = formatTaskCheckpointLabel(durationMinutes);
  const variant = getSceneTaskVariant(sceneState);
  const variantText = `${variant.description} ${variant.assignedAction} ${variant.activeFollowUp}`.toLowerCase();
  if (isTaskRationaleQuestion(userText)) {
    if (/\banal|dildo|plug\b/.test(variantText)) {
      return "It proves whether you can keep control under pressure without getting greedy, sloppy, or performative. I want patience and steadiness there, not just willingness.";
    }
    if (/\bthroat|oral|mouth\b/.test(variantText)) {
      return "It proves whether you can keep control over depth, breathing, and resets once the line stops feeling flattering.";
    }
    if (/\bchastity|cage|locked\b/.test(variantText)) {
      return "It proves whether you can actually live inside a rule without bargaining with it once the novelty wears off.";
    }
    if (/\bbondage|cuffs|restrain|hands secured\b/.test(variantText)) {
      return "It proves whether restraint actually changes your behavior and your obedience, not just your silhouette.";
    }
    return "It proves whether you can keep the rule cleanly once it starts costing you comfort instead of just flattering the idea of it.";
  }
  if (isTaskProofQuestion(userText)) {
    return `Yes. For this to count, I want one clean midpoint check-in at ${halfwayLabel} and one final report when the full ${durationLabel} is done.`;
  }
  if (isTaskDepthQuestion(userText)) {
    if (/\banal|dildo|plug\b/.test(variantText)) {
      return "Deep enough that you can keep the pace controlled and the pressure clean. I want control first, not maximum depth for its own sake.";
    }
    if (/\bthroat|oral|mouth\b/.test(variantText)) {
      return "Only as deep as you can keep your breathing and control cleanly. I want control first, not depth for show.";
    }
    return "Depth is not the real variable here. The real variable is whether you can keep the rule cleanly the whole time.";
  }
  const combinationReply = buildTaskCombinationReply(sceneState, userText, input);
  if (combinationReply) {
    return combinationReply;
  }
  if (sceneState.task_progress === "assigned") {
    if (isTaskDoneDefinitionQuestion(userText)) {
      return `Listen carefully, pet. Done for this step means you ${variant.assignedAction}. After that, you hold it to ${halfwayLabel}, check in once, then finish the full ${durationLabel}.`;
    }
    if (looksLikeTaskSecureConfirmation(userText)) {
      return sceneState.task_variant_index % 2 === 0
        ? `Good. It is set. ${variant.activeFollowUp} Check in once at ${halfwayLabel}, then report when the full ${durationLabel} is complete.`
        : `Good. That counts as secured, pet. ${variant.activeFollowUp} Hold it to ${halfwayLabel}, check in once, then finish the full ${durationLabel}.`;
    }
    if (/\b(halfway|half way|midpoint|check in)\b/i.test(userText)) {
      return `Listen carefully, pet. Secure it first. Once it is set, hold it until ${halfwayLabel}, check in once, then finish the full ${durationLabel}.`;
    }
    if (isTaskHalfwayTimingQuestion(userText)) {
      return `Listen carefully, pet. Halfway lands at ${halfwayLabel}, but you do not earn that checkpoint until the task is secured first.`;
    }
    if (/\b(how long|how much longer|remaining|when)\b/i.test(userText)) {
      return `Listen carefully, pet. First secure it properly. After that, you hold it to ${halfwayLabel}, check in once, then finish the full ${durationLabel}.`;
    }
    return `Listen carefully, pet. Next, ${variant.assignedAction}. Do that cleanly before anything else.`;
  }
  if (sceneState.task_progress === "secured") {
    if (isTaskDoneDefinitionQuestion(userText)) {
      return `Listen carefully, pet. Done means you keep it secure through the full ${durationLabel}. You give me one clean check in at ${halfwayLabel}, then you report back only when the full time is complete.`;
    }
    if (isTaskHalfwayTimingQuestion(userText)) {
      return `Listen carefully, pet. Halfway is at ${halfwayLabel}. Hold steady until then, give me one clean check in, and keep going after that.`;
    }
    if (/\b(halfway|half way|midpoint|check in)\b/i.test(userText)) {
      return `Listen carefully, pet. At halfway, give me one clean check in, then keep it secured until the full ${durationLabel} is done.`;
    }
    if (/\b(how long|how much longer|wait|remaining|when)\b/i.test(userText)) {
      return `Listen carefully, pet. Hold steady until the ${halfwayLabel} mark, check in once, then finish the full ${durationLabel} before you report completion.`;
    }
    return sceneState.task_variant_index % 2 === 0
      ? `Listen carefully, pet. Next, ${variant.activeFollowUp.toLowerCase()} Check in once at ${halfwayLabel}, then report when the full ${durationLabel} is complete.`
      : `Listen carefully, pet. Keep it clean now. ${variant.activeFollowUp} Give me your halfway check in at ${halfwayLabel}, then finish the full ${durationLabel}.`;
  }
  if (sceneState.task_progress === "halfway_checked") {
    if (isTaskDoneDefinitionQuestion(userText)) {
      return `Listen carefully, pet. Halfway already counts. Now done means you hold it through the full ${durationLabel}, then report back cleanly.`;
    }
    if (
      /\b(how long|how much longer|remaining|what now|what next|full time|final step|before i can consider this task complete|before it is complete)\b/i.test(
        userText,
      )
    ) {
      return `Listen carefully, pet. You already cleared halfway. Keep it secured until the full ${durationLabel} is complete, then report back cleanly.`;
    }
    return sceneState.task_variant_index % 2 === 0
      ? `Good. Halfway check in accepted, pet. Now finish the full ${durationLabel} and report back once complete.`
      : `Good. Halfway is cleared, pet. Keep your control through the full ${durationLabel}, then report back once it is complete.`;
  }
  if (sceneState.task_progress === "completed") {
    if (
      input &&
      (isExplicitNewTaskRequest(userText) ||
        /\b(another task|new task|next task|next thing|what else|set the next one|give me another|what do you have|ready for the next task)\b/i.test(
          userText,
        ))
    ) {
      return buildTaskReply(input);
    }
    if (isTaskDoneDefinitionQuestion(userText)) {
      return "Good. It already counts as done. That task is complete. Ask for the next task if you want one.";
    }
    return "Good. That task is complete. Report it complete now, or tell me to set the next task.";
  }
  return "Listen carefully, pet. Stay on the current task and report your next checkpoint.";
}

function buildStakesReply(sceneState: SceneState): string {
  const stakesLine = buildStakesLine(sceneState);
  if (stakesLine) {
    return stakesLine;
  }
  return "The stakes are not set yet, pet. Set them clearly, and I will hold you to them.";
}

function buildStakeNegotiationReply(sceneState: SceneState): string {
  const missing = missingStakeParts(sceneState);
  if (!sceneState.stakes) {
    return [
      "Listen carefully, pet. We set the wager now.",
      sceneState.win_condition ? `If you win, ${sceneState.win_condition}.` : "",
      sceneState.lose_condition ? `If I win, ${sceneState.lose_condition}.` : "",
      "Now state the stakes clearly first. Then we lock in the terms.",
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }
  if (missing.includes("win_condition")) {
    return `Good. The stakes are ${sceneState.stakes}. Now state what happens if you win, pet. Do not make me drag it out of you.`;
  }
  if (missing.includes("lose_condition")) {
    return `Good. The stakes are ${sceneState.stakes}. Now state what happens if I win, pet. Do it properly.`;
  }
  return [
    `Good. The stakes are ${sceneState.stakes}.`,
    sceneState.win_condition ? `If you win, ${sceneState.win_condition}.` : "",
    sceneState.lose_condition ? `If I win, ${sceneState.lose_condition}.` : "",
    "The terms are set. You will stick to them.",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function hasCompleteWagerTerms(sceneState: SceneState): boolean {
  return missingStakeParts(sceneState).length === 0;
}

function buildTaskTermsNegotiationReply(sceneState: SceneState): string {
  if (!sceneState.task_reward) {
    return "Set the task reward first, pet. State what the user earns for completing it, and keep it clear.";
  }
  if (!sceneState.task_consequence) {
    return "Good. The reward is set. Now state the consequence if the user fails the task, pet. Be precise.";
  }
  return [
    `Reward: ${sceneState.task_reward}.`,
    `Consequence: ${sceneState.task_consequence}.`,
    "The task terms are set. They stand.",
  ].join(" ");
}

function buildRewardWindowReply(
  sceneState: SceneState,
  userText: string,
  profile: ProfileState | undefined,
  progress: SceneScaffoldInput["progress"],
  deviceControlActive = false,
): string {
  if (sceneState.game_outcome === "raven_win") {
    if (sceneState.game_reward_state === "free_pass_used") {
      return "Good. Your banked protection saved you this time. The consequence is cancelled. Call for another round or switch topics.";
    }
    if (/\b(another round|play again|second round|next round)\b/i.test(userText)) {
      return "No, pet. That round is over and the loss still stands. Say ready, and I will enforce your consequence first.";
    }
    if (/\b(consequence|what do i have to do|what now|what next)\b/i.test(userText)) {
      if (/\b(ready|do it|enforce it|set it|go on|fine|ok|okay|yes)\b/i.test(userText)) {
        return buildGameConsequenceTaskReply(sceneState, profile, progress, deviceControlActive);
      }
      if (sceneState.lose_condition) {
        return `Good. Your consequence is this: ${sceneState.lose_condition}. Say ready, and I will enforce it.`;
      }
    }
    if (
      /\b(ready|do it|enforce it|set it|what now|what next|go on|fine|ok|okay|yes)\b/i.test(
        userText,
      )
    ) {
      return buildGameConsequenceTaskReply(sceneState, profile, progress, deviceControlActive);
    }
    if (sceneState.lose_condition) {
      return `Good. You lost, and the wager stands: ${sceneState.lose_condition}. Say ready, and I will enforce it.`;
    }
    return "Good. You lost the round. Say ready, and I will set the consequence properly.";
  }

  if (
    sceneState.game_outcome === "user_win" &&
    sceneState.win_condition &&
    sceneState.game_reward_state !== "free_pass_granted"
  ) {
    const normalized = normalize(userText);
    const asksToClaim =
      /\b(what do i win|what now|claim|collect|cash in|tell me now|your truth|what happens now)\b/i.test(
        normalized,
      );
    const startsAnotherRound = /\b(again|another round|play again|next round)\b/i.test(normalized);
    const isQuestion = /\?/.test(normalized);
    const looksLikeClaim =
      normalized.length > 6 &&
      !isQuestion &&
      !startsAnotherRound &&
      !/\b(save it|bank it|keep it)\b/i.test(normalized);

    if (looksLikeClaim) {
      return `Good. You won, and I honor it. Claim accepted: ${userText.trim()}. Winner terms applied.`;
    }
    if (asksToClaim) {
      if (/\btruth\b/i.test(sceneState.win_condition)) {
        return `Good. You won. As agreed: ${sceneState.win_condition}. Truth: I spot hesitation quickly and use it against you. Winner terms applied.`;
      }
      return `Good. You won. As agreed: ${sceneState.win_condition}. State your claim in one clear line, and I will apply it now.`;
    }
    return `Good. You won. Your terms stand: ${sceneState.win_condition}. State your claim now, or call for another round.`;
  }

  const preference = deriveRewardWindowPreference(profile, progress);
  if (/\b(use it now|spend it now|cash it in)\b/i.test(userText)) {
    return preference === "press_advantage"
      ? "No, pet. That protection only cancels the next consequence task when I win. It stays banked until then. Push forward and earn the next round properly."
      : "No, pet. That protection only cancels the next consequence task when I win. It stays banked until then, and you will wait.";
  }
  if (
    /\b(take a pass|pass for now|save it for now|hold it for later|later|when we(?:'re| are) ready again)\b/i.test(
      userText,
    )
  ) {
    return preference === "press_advantage"
      ? "Good. The free pass stays banked, pet. Hold it in reserve and call for another round when you are ready to press again."
      : "Good. The free pass stays banked, pet. Keep it in reserve for later and call for another round when you are ready.";
  }
  if (/\b(save it|bank it|keep it)\b/i.test(userText)) {
    return preference === "press_advantage"
      ? "Good. The free pass stays banked, pet. Keep it in reserve, then press for another round."
      : "Good. The free pass stays banked, pet. Use it when I win the next round, not before.";
  }
  if (/\b(again|another round|play again|next round)\b/i.test(userText)) {
    return preference === "press_advantage"
      ? "Good. The free pass stays banked, pet. We move into another round now, and you will keep up."
      : "Good. The free pass stays banked, pet. We move into another round when you are ready, and you will keep up.";
  }
  return preference === "press_advantage"
    ? "Good. The free pass is banked, pet. Press your advantage and call for another round, or keep it in reserve if you have the discipline."
    : "Good. The free pass is banked, pet. Keep it in reserve or call for another round. Do not squander it.";
}

export function buildSceneScaffoldReply(input: SceneScaffoldInput): string | null {
  const userText = normalize(input.userText);
  const hasWagerCue =
    /\b(stakes? (?:are|were)|if i win|if you win|what('?s| is) on the line|bet(?:ting)? on it|bet on the game|make a bet|make a wager|wager|lets bet on it|let'?s bet on it)\b/i.test(
      userText,
    );

  if (
    isTopicInitiationRequest(input.userText) &&
    !input.sceneState.task_hard_lock_active &&
    input.sceneState.interaction_mode === "normal_chat" &&
    input.sceneState.topic_type === "none" &&
    input.act !== "answer_activity_choice" &&
    input.act !== "propose_activity"
  ) {
    return buildTopicInitiationReply({
      userText: input.userText,
      currentTopic: input.sceneState.agreed_goal || null,
      tone: "neutral",
    });
  }

  if (input.act === "short_follow_up") {
    const trainingFollowUp = buildTrainingFollowUpReply({
      userText: input.userText,
      thread: input.sceneState.active_training_thread,
      inventory: input.inventory ?? [],
    });
    if (trainingFollowUp) {
      return trainingFollowUp;
    }
    if (input.sceneState.topic_type === "task_execution") {
      return buildTaskExecutionQuestionReply(input.sceneState, input.userText, input);
    }
    if (
      input.sceneState.topic_type === "task_negotiation" &&
      (
        input.sceneState.task_spec.next_required_action === "await_selection" ||
        input.sceneState.task_spec.next_required_action === "fulfill_request" ||
        input.sceneState.task_spec.next_required_action === "present_options" ||
        input.sceneState.task_spec.fulfillment_locked
      )
      ) {
        // Keep short task replies inside the active negotiation instead of dropping to generic clarification.
      } else {
    return buildShortClarificationReply({
      userText: input.userText,
      interactionMode: input.sceneState.interaction_mode,
      topicType: input.sceneState.topic_type,
      lastAssistantText: input.sceneState.last_assistant_text || input.sceneState.last_profile_prompt || null,
      lastUserText:
        input.sessionMemory?.last_user_answer?.value ??
        input.sessionMemory?.last_user_question?.value ??
        null,
      lastQuestion: input.sessionMemory?.last_user_question?.value ?? null,
      lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
      currentTopic: input.sceneState.agreed_goal || null,
    });
      }
    }

    if (
      (input.act === "user_question" || input.act === "short_follow_up") &&
      isInventoryUseQuestion(input.userText)
    ) {
      const selectedInventoryItem = selectConversationalInventoryItem(input);
      if (selectedInventoryItem) {
        return buildInventoryUseReply(selectedInventoryItem, input.userText);
      }
      const contextualReply = buildContextualInventoryUseReply(input);
      if (contextualReply) {
        return contextualReply;
      }
    }

    if (
      input.act === "acknowledgement" &&
      Boolean(input.sceneState.last_assistant_text) &&
      (input.sceneState.interaction_mode === "normal_chat" ||
        input.sceneState.interaction_mode === "question_answering" ||
        input.sceneState.interaction_mode === "relational_chat")
    ) {
      const reply = buildCoreConversationReply({
        userText: input.userText,
        previousAssistantText: input.sceneState.last_assistant_text || null,
        currentTopic: input.sceneState.agreed_goal || null,
      });
      if (reply) {
        return reply;
      }
    }

  if (
    hasWagerCue &&
    (input.sceneState.topic_type === "game_setup" ||
      input.sceneState.topic_type === "game_execution" ||
      input.sceneState.topic_type === "reward_negotiation" ||
      Boolean(input.sceneState.stakes))
  ) {
    return buildStakeNegotiationReply(input.sceneState);
  }

  if (isProfileSummaryRequest(input.userText)) {
    if (
      input.sceneState.task_hard_lock_active &&
      input.sceneState.topic_type === "task_execution" &&
      input.sceneState.task_progress !== "completed"
    ) {
      return `We are not shifting out of this lock yet. ${input.sceneState.reason_for_lock} Right now, ${input.sceneState.next_expected_user_action}.`;
    }
    return buildProfileBuildingReply(
      input.userText,
      input.profile,
      input.sceneState,
      input.sessionMemory,
    );
  }

  if (isChatSwitchRequest(input.userText)) {
    if (
      input.sceneState.task_hard_lock_active &&
      input.sceneState.topic_type === "task_execution" &&
      input.sceneState.task_progress !== "completed"
    ) {
    return `We are not shifting out of this lock yet. ${input.sceneState.reason_for_lock} Right now, ${input.sceneState.next_expected_user_action}.`;
  }
    return buildChatSwitchReply();
  }

  if (isAssistantSelfQuestion(input.userText) || isMutualGettingToKnowRequest(input.userText)) {
    if (
      input.sceneState.task_hard_lock_active &&
      input.sceneState.topic_type === "task_execution" &&
      input.sceneState.task_progress !== "completed"
    ) {
      return `We are not shifting out of this lock yet. ${input.sceneState.reason_for_lock} Right now, ${input.sceneState.next_expected_user_action}.`;
    }
    return buildRelationalChatReply(
      input.userText,
      input.inventory ?? [],
      input.sessionMemory?.last_assistant_message?.value ?? null,
      input.sceneState.active_training_thread,
    );
  }

  if (
    input.sceneState.interaction_mode === "relational_chat" &&
    isAssistantTrainingRequest(input.userText)
  ) {
    return buildRelationalChatReply(
      input.userText,
      input.inventory ?? [],
      input.sessionMemory?.last_assistant_message?.value ?? null,
      input.sceneState.active_training_thread,
    );
  }

  if (
    input.sceneState.interaction_mode === "relational_chat" &&
    (input.act === "user_question" || input.act === "short_follow_up" || input.act === "other")
  ) {
    const trainingFollowUp = buildTrainingFollowUpReply({
      userText: input.userText,
      thread: input.sceneState.active_training_thread,
      inventory: input.inventory ?? [],
    });
    if (trainingFollowUp) {
      return trainingFollowUp;
    }
  }

  if (
    input.sceneState.interaction_mode === "profile_building" ||
    isProfileBuildingRequest(input.userText)
  ) {
    if (
      input.sceneState.task_hard_lock_active &&
      input.sceneState.topic_type === "task_execution" &&
      input.sceneState.task_progress !== "completed"
    ) {
      return `We are not shifting out of this lock yet. ${input.sceneState.reason_for_lock} Right now, ${input.sceneState.next_expected_user_action}.`;
    }
    return buildProfileBuildingReply(
      input.userText,
      input.profile,
      input.sceneState,
      input.sessionMemory,
    );
  }

  if (
    ((input.sceneState.topic_locked && input.sceneState.topic_type === "game_setup") ||
      input.sceneState.topic_type === "game_setup") &&
    (input.act === "propose_activity" ||
      input.act === "answer_activity_choice" ||
      (input.sceneState.topic_locked && input.sceneState.topic_type === "game_setup"))
  ) {
    return buildGameSetupReply(input);
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "game_execution" &&
    (input.act === "user_question" || input.act === "confusion")
  ) {
    if (isGameNextPromptQuestion(input.userText) || isGameStartCue(input.userText)) {
      return buildDeterministicGameImmediatePrompt(
        input.sceneState.game_template_id,
        input.sceneState.game_progress,
      );
    }
    return buildGameRulesReply(input.sceneState);
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "game_execution" &&
    input.act !== "user_question" &&
    input.act !== "confusion"
  ) {
    const numberCommandReply = buildNumberCommandExecutionReply(input);
    const primaryLine =
      numberCommandReply ??
      buildDeterministicGameTurnReply(
        input.sceneState.game_template_id,
        input.sceneState.game_progress,
        input.userText,
        input.sceneState.last_game_progress,
      );
    const primaryMentionsWinner = /\b(you win this round|i win this round|i win this one)\b/i.test(
      primaryLine,
    );
    const parts = [
      primaryLine,
      primaryMentionsWinner
        ? ""
        : buildDeterministicGameOutcomeLine(
            input.sceneState.game_outcome,
            input.sceneState.win_condition,
            input.sceneState.lose_condition,
          ),
      buildDeterministicGameRewardLine(
        input.sceneState.game_reward_state,
        input.sceneState.free_pass_count,
      ),
      buildDeterministicGameLeverageLine(
        input.sceneState.game_outcome,
        input.sceneState.game_reward_state,
      ),
      buildDeterministicGameNextBeatLine(
        input.sceneState.game_outcome,
        input.sceneState.game_reward_state,
      ),
    ];
    if (
      isTerminalDeterministicGameProgress(input.sceneState.game_progress) &&
      input.sceneState.game_outcome === "raven_win" &&
      input.sceneState.game_reward_state !== "free_pass_used"
    ) {
      parts.push("Say ready, and I will enforce it.");
    }
    return parts.filter((line) => line.length > 0).join(" ");
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "reward_window" &&
    input.act !== "task_request"
  ) {
    return buildRewardWindowReply(
      input.sceneState,
      input.userText,
      input.profile,
      input.progress,
      input.deviceControlActive,
    );
  }

  if (
    (input.act === "task_request" &&
      !(input.sceneState.topic_locked && input.sceneState.topic_type === "task_execution")) ||
    (input.sceneState.task_progress === "completed" && isExplicitNewTaskRequest(input.userText)) ||
    (input.sceneState.topic_locked && input.sceneState.topic_type === "task_negotiation")
  ) {
    return buildTaskReply(input);
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "task_execution" &&
    input.sceneState.can_replan_task &&
    isTaskRevisionCue(input.userText)
  ) {
    return buildTaskReply(input);
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "task_execution" &&
    (input.act === "user_question" ||
      input.act === "short_follow_up" ||
      input.act === "confusion" ||
      input.act === "task_request" ||
      input.act === "duration_request" ||
      isTaskNextStepQuestion(input.userText) ||
      isTaskDoneDefinitionQuestion(input.userText) ||
      isTaskHalfwayTimingQuestion(input.userText) ||
      isTaskRationaleQuestion(input.userText) ||
      isTaskProofQuestion(input.userText) ||
      isTaskDepthQuestion(input.userText) ||
      isTaskCombinationQuestion(input.userText))
  ) {
    if (input.sceneState.can_replan_task && isTaskRevisionCue(input.userText)) {
      return buildTaskReply(input);
    }
    if (
      input.act === "task_request" &&
      input.sceneState.can_replan_task &&
      !isTaskNextStepQuestion(input.userText) &&
      !isTaskDoneDefinitionQuestion(input.userText) &&
      !isTaskHalfwayTimingQuestion(input.userText) &&
      (
        input.sceneState.user_requested_task_domain !== "none" ||
        input.sceneState.task_spec.request_kind === "replacement" ||
        input.sceneState.task_spec.request_kind === "revision"
      )
    ) {
      return buildTaskReply(input);
    }
    if (
      input.act === "task_request" &&
      !input.sceneState.can_replan_task &&
      !isTaskNextStepQuestion(input.userText) &&
      !isTaskDoneDefinitionQuestion(input.userText) &&
      !isTaskHalfwayTimingQuestion(input.userText) &&
      (
        (input.sceneState.user_requested_task_domain !== "none" &&
          input.sceneState.user_requested_task_domain !== input.sceneState.locked_task_domain) ||
        input.sceneState.task_spec.request_kind === "replacement"
      )
    ) {
      return buildTaskReply(input);
    }
    if (
      isTaskNextStepQuestion(input.userText) ||
      isTaskDoneDefinitionQuestion(input.userText) ||
      isTaskHalfwayTimingQuestion(input.userText) ||
      isTaskRationaleQuestion(input.userText) ||
      isTaskProofQuestion(input.userText) ||
      isTaskDepthQuestion(input.userText) ||
      isTaskCombinationQuestion(input.userText) ||
      /\b(task|progress|status|how long|remaining|next|halfway|half way|midpoint|check in)\b/i.test(
        userText,
      )
    ) {
      return buildTaskExecutionQuestionReply(input.sceneState, input.userText, input);
    }
    if (!input.sceneState.task_hard_lock_active) {
      return null;
    }
    return `We are still inside the current task. ${input.sceneState.reason_for_lock} Right now, ${input.sceneState.next_expected_user_action}.`;
  }

  if (
    input.act === "duration_request" ||
    (input.sceneState.topic_locked &&
      input.sceneState.topic_type === "duration_negotiation" &&
      /\bhow long\b/.test(userText))
  ) {
    if (isExplicitNewTaskRequest(input.userText)) {
      return buildTaskReply(input);
    }
    return buildDurationReply(input.sceneState, input.userText);
  }

  if (
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "task_execution" &&
    input.act !== "user_question" &&
    input.act !== "confusion" &&
    input.act !== "propose_activity" &&
    input.act !== "answer_activity_choice"
  ) {
    if (
      !input.sceneState.task_hard_lock_active &&
      !/\b(done|secure|secured|started|start now|halfway|half way|check in|check-in|all done|finished|complete|completed|progress|status|timer|remaining)\b/i.test(
        userText,
      ) &&
      !/\b(task|next step|what now|what counts as done|how long)\b/i.test(userText)
    ) {
      return null;
    }
    return buildDeterministicTaskFollowUp(
      input.sceneState.task_progress,
      input.sceneState.task_duration_minutes,
      input.sceneState.task_variant_index,
      input.sceneState.task_template_id,
    );
  }

  if (
    (input.sceneState.topic_locked && input.sceneState.topic_type === "task_terms_negotiation") ||
    ((input.sceneState.task_reward || input.sceneState.task_consequence) &&
      /\b(reward is|consequence is|if i complete|if i finish|if i succeed|if i fail|if i miss)\b/i.test(
        userText,
      ))
  ) {
    return buildTaskTermsNegotiationReply(input.sceneState);
  }

  if (
    (input.sceneState.topic_locked && input.sceneState.topic_type === "reward_negotiation") ||
    (input.sceneState.stakes &&
      /\b(stakes? (?:are|were)|if i win|if you win|what('?s| is) on the line|bet(?:ting)? on it|bet on the game|make a bet|make a wager|wager)\b/i.test(
        userText,
      )) ||
    hasWagerCue
  ) {
    if (
      hasCompleteWagerTerms(input.sceneState) &&
      (isGameStartCue(input.userText) ||
        isGameNextPromptQuestion(input.userText) ||
        /\b(ready|begin|let'?s begin|lets begin|let'?s start|lets start|start the game|start now|alright[, ]*let'?s begin)\b/i.test(
          input.userText,
        ))
    ) {
      return [
        buildDeterministicGameStart(input.sceneState.game_template_id),
        buildStakesLine(input.sceneState),
      ]
        .filter((line) => line.length > 0)
        .join(" ");
    }
    return buildStakeNegotiationReply(input.sceneState);
  }

  if (input.act === "user_question" && isStakeQuestion(userText)) {
    return buildStakesReply(input.sceneState);
  }

  if (shouldIssueInventorySessionDirective(input)) {
    const selected = selectSessionInventoryDirectiveItem(input.inventory ?? [], input.userText);
    if (selected) {
      return buildInventorySessionDirective(selected);
    }
  }

  return null;
}
