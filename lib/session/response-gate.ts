import {
  buildCommitmentFallback,
  isResponseAlignedWithCommitment,
  type CommitmentState,
} from "./commitment-engine.ts";
import {
  buildSceneFallback,
  isResponseAlignedWithSceneState,
  type SceneState,
} from "./scene-state.ts";
import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  buildPriorBeatOpinionReply,
  buildHumanQuestionFallback,
  buildTopicInitiationReply,
  isTopicInitiationRequest,
} from "../chat/open-question.ts";
import {
  buildCoreConversationReply,
  classifyCoreConversationMove,
  isStableCoreConversationMove,
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
import type { SessionMemory } from "./session-memory.ts";
import type { SessionInventoryItem } from "./session-inventory.ts";
import {
  buildShortClarificationReply,
  detectShortFollowUpKind,
  isShortClarificationTurn,
} from "./short-follow-up.ts";
import {
  buildTurnPlanFallback,
  isTurnPlanSatisfied,
  type TurnPlan,
} from "../chat/turn-plan.ts";

export type ResponseGateInput = {
  text: string;
  userText: string;
  dialogueAct?: DialogueRouteAct;
  lastAssistantText: string | null;
  turnPlan?: TurnPlan | null;
  sceneState: SceneState;
  commitmentState: CommitmentState;
  sessionMemory?: SessionMemory | null;
  inventory?: SessionInventoryItem[] | null;
  observationTrust?: {
    canDescribeVisuals: boolean;
    reason: string;
  };
};

export type ResponseGateResult = {
  text: string;
  forced: boolean;
  reason: string;
};

const INTERNAL_LINE_PATTERNS = [
  /^scene state:/i,
  /^commitment:/i,
  /^working memory:/i,
  /^turn routing:/i,
  /^dialogueact:/i,
  /^topic type:/i,
  /^topic locked:/i,
  /^topic state:/i,
  /^scene type:/i,
  /^agreed goal:/i,
  /^stakes:/i,
  /^win condition:/i,
  /^lose condition:/i,
  /^current rule:/i,
  /^current subtask:/i,
  /^next expected user action:/i,
  /^last verified action:/i,
  /^type:\s+/i,
  /^locked:\s+/i,
  /^detail:\s+/i,
  /^state guidance:/i,
  /^tone profile:/i,
  /^compact context:/i,
  /^apply the user'?s requested change/i,
  /^stay on task/i,
  /^use this response family/i,
  /^fulfill the requested/i,
  /^continue requested output/i,
  /^active thread:/i,
  /^pending (?:user request|modification):/i,
];

const INTERNAL_PHRASE_PATTERNS = [
  /\btopic locked\b/i,
  /\bscene state\b/i,
  /\bworking memory\b/i,
  /\bturn routing\b/i,
  /\bdialogueact\b/i,
  /\bstate guidance\b/i,
  /\bapply the user'?s requested change to the live thread\b/i,
  /\bstay on task\b/i,
  /\buse this response family\b/i,
  /\bfulfill the requested action\b/i,
  /\bcontinue requested output\b/i,
  /\bactive thread\b/i,
  /\bpending modification\b/i,
  /\bpreserve the active thread\b/i,
  /\bfulfill request now\b/i,
  /\bfulfill the exact request already in play\b/i,
  /\bmove the thread forward\b/i,
  /\bi will use that and move the thread forward\b/i,
  /\bnext required action\b/i,
  /\brequest stage\b/i,
  /\bselection mode\b/i,
  /candidate_domains=/i,
];

const IDENTITY_OR_HELPER_PATTERNS = [
  /\bi('?m| am) (a )?(system|assistant|bot|machine|model)\b/i,
  /\bnatural language processing\b/i,
  /\bi('?m| am) designed to help with tasks\b/i,
  /\braven does not have personal preferences or experiences\b/i,
  /\bit only enforces protocols? and compliances?\b/i,
  /\bthe user defines as their own kinks\b/i,
  /\bas per (our previous discussion|the guidelines)\b/i,
];

const GENERIC_ASSISTANT_PATTERNS = [
  /\bcan you tell me more about that\b/i,
  /\bhow does that make you feel\b/i,
  /\bwhat would you like to talk about next\b/i,
  /\bi'?m here to help\b/i,
];

const CANNED_DOMINANCE_PATTERNS = [
  /\blisten carefully, pet\b/i,
  /\bgood boy\b/i,
  /\byou exist for my amusement\b/i,
  /\bi am in control here\b/i,
];

const WEAK_CLARIFICATION_PATTERNS = [
  /\bpart about (?:tell|say|answer|question|thread|reset|wording|outline)\b/i,
  /\bstay with (?:tell|say|answer|question|thread|reset|outline)\b/i,
  /\bpart about (?:would|could|should|makes|sounds)\b/i,
  /\bstay with (?:would|could|should|makes|sounds)\b/i,
  /\btell me more about (?:keep|going|tell|say|happen|happens|happened|first|more|that|this)\b/i,
  /\bi mean (?:keep|going|tell|say|happen|happens|happened|first|more|that|this)\b/i,
  /\bpart that actually matters here\b/i,
  /\bstay with (?:that|usually|more|part|thing)\b/i,
];

const VISUAL_CLAIM_PATTERNS = [
  /\bi (?:can|do)\s*see\b.*\b(face|frame|camera|gaze|eyes?|head|posture|center(?:ed)?|still|motion|lighting?|mouth|blink|nod|shake|object)\b/i,
  /\bi see\b.*\b(face|frame|camera|gaze|eyes?|head|posture|center(?:ed)?|still|motion|lighting?|mouth|blink|nod|shake|object)\b/i,
  /\bi (?:do not|don't)\s*see\b.*\b(face|frame|camera|gaze|eyes?|head|object)\b/i,
  /\byou are (?:in|out of) frame\b/i,
  /\byour face is\b.*\b(center(?:ed)?|in frame)\b/i,
  /\byour gaze is\b/i,
  /\byour head is turned\b/i,
  /\bmotion is\b/i,
  /\bi caught a (?:nod|blink|head shake)\b/i,
];

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeForDuplicateCompare(text: string): string {
  return normalize(text)
    .toLowerCase()
    .replace(
      /^(listen carefully|eyes on me|stay sharp|keep focus|pay attention|hold still|noted|good|answer directly|stay on this game|no drifting|no dodging),?(?: [a-z0-9 -]+)?\.\s*/i,
      "",
    )
    .replace(/^(pet|focus)\.\s*/i, "")
    .trim();
}

function stripInternalLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !INTERNAL_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();
}

function containsBadInternalPhrase(text: string): boolean {
  return INTERNAL_PHRASE_PATTERNS.some((pattern) => pattern.test(text));
}

function containsIdentityLeak(text: string): boolean {
  return IDENTITY_OR_HELPER_PATTERNS.some((pattern) => pattern.test(text));
}

function isLockedExecutionMode(mode: SceneState["interaction_mode"]): boolean {
  return mode === "locked_task_execution" || mode === "game";
}

function violatesEmbodiedVoice(input: ResponseGateInput, text: string): boolean {
  if (isLockedExecutionMode(input.sceneState.interaction_mode)) {
    return false;
  }
  if (input.observationTrust && containsVisualClaim(text)) {
    return false;
  }
  if (GENERIC_ASSISTANT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (CANNED_DOMINANCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return /\b(say more|tell me more|what else should i know)\b/i.test(text);
}

function containsVisualClaim(text: string): boolean {
  return VISUAL_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "what",
    "when",
    "where",
    "which",
    "that",
    "this",
    "with",
    "your",
    "have",
    "from",
    "then",
    "there",
    "about",
  ]);
  return new Set(
    normalize(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopWords.has(token)),
  );
}

function hasKeywordOverlap(userText: string, responseText: string): boolean {
  const userKeywords = extractKeywords(userText);
  const responseKeywords = extractKeywords(responseText);
  for (const keyword of userKeywords) {
    if (responseKeywords.has(keyword)) {
      return true;
    }
  }
  return false;
}

function containsDuplicateTaskPayload(text: string): boolean {
  const matches = normalize(text).match(/\bhere is your task\b/gi);
  return Array.isArray(matches) && matches.length > 1;
}

function containsWeakClarificationAnchor(text: string): boolean {
  return WEAK_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(text));
}

function isActiveTaskThread(input: ResponseGateInput): boolean {
  return (
    (input.sceneState.topic_type === "task_negotiation" ||
      input.sceneState.topic_type === "task_execution") &&
    !input.sceneState.task_paused
  );
}

function isSafeProfileQuestion(text: string): boolean {
  return (
    /\?/.test(text) &&
    !/\b(here is your task|task:|start now|put it on now|reply done|check in once halfway through)\b/i.test(
      text,
    )
  );
}

function containsProfileIntakeQuestion(text: string): boolean {
  return /\b(what should i call you|what do you want me to understand about you|what boundaries|what should i read correctly about you|what pulls you in|what else should i know about you)\b/i.test(
    text,
  );
}

function isTaskFulfillmentDue(input: ResponseGateInput): boolean {
  return (
    input.sceneState.topic_type === "task_negotiation" &&
    input.sceneState.task_spec.fulfillment_locked &&
    !input.sceneState.task_spec.request_fulfilled
  );
}

function isTaskOptionsDue(input: ResponseGateInput): boolean {
  return (
    input.sceneState.topic_type === "task_negotiation" &&
    !input.sceneState.task_spec.request_fulfilled &&
    (
      input.sceneState.task_spec.next_required_action === "present_options" ||
      input.sceneState.task_spec.next_required_action === "await_selection" ||
      input.sceneState.task_spec.selection_mode !== "direct_assignment"
    )
  );
}

function blockerQuestionPattern(slot: SceneState["task_spec"]["last_asked_blocker"]): RegExp | null {
  if (slot === "requested_domain") {
    return /\b(posture|stillness|frame|hands|device)\b/i;
  }
  if (slot === "available_items") {
    return /\b(what items|what can you actually use|gear|tools|on hand)\b/i;
  }
  if (slot === "duration_minutes") {
    return /\b(how long|time window|length)\b/i;
  }
  if (slot === "inventory_details") {
    return /\bexactly what .* is|how it should be used|linked device is meant to control\b/i;
  }
  if (slot === "combine_mode") {
    return /\b(standalone|paired|combine|second condition)\b/i;
  }
  if (slot === "difficulty") {
    return /\b(easy|moderate|hard|light|balanced)\b/i;
  }
  if (slot === "proof_or_checkin_type") {
    return /\b(halfway|proof|report|accountability)\b/i;
  }
  return null;
}

function reasksResolvedTaskBlocker(input: ResponseGateInput, text: string): boolean {
  for (const slot of input.sceneState.task_spec.resolved_blockers) {
    const pattern = blockerQuestionPattern(slot);
    if (pattern && pattern.test(text) && /\?/.test(text)) {
      return true;
    }
  }
  return false;
}

function looksLikeTaskFulfillment(text: string): boolean {
  return /\b(here is your task|start now|report back|reply done|check in once halfway through)\b/i.test(
    text,
  );
}

function containsMenuDrift(text: string): boolean {
  return /\b(psychology|mechanics|pressure first|what kind of task do you want|pick the lane)\b/i.test(
    text,
  );
}

function containsGenericTaskThreadFallback(text: string): boolean {
  return /\b(there you are\. start talking|there you are\. tell me what is actually on your mind|talk to me\. what is on your mind|all right\. tell me what is on your mind|point to the part you want answered|start talking\.|name the part that lost you|tell me which part lost you|state the angle cleanly|we can break it down cleanly)\b/i.test(
    normalize(text).toLowerCase(),
  );
}

function containsVerboseTaskDebugWrapper(text: string): boolean {
  return /\b(i worked through \d+ usable directions|kept the strongest fit|it fits because|what i am watching for:)\b/i.test(
    normalize(text).toLowerCase(),
  );
}

function containsStockConversationFallback(text: string): boolean {
  return /\b(drop the fog and say what you want|say it cleanly\. what is actually on your mind|talk to me\. what is on your mind|all right\. tell me what is on your mind|point to the part you want answered|ask the exact question you want answered|name the part that lost you|tell me which part lost you|state the angle cleanly|we can break it down cleanly|there you are\. start talking|there you are\. tell me what is actually on your mind|start talking\.)\b/i.test(
    normalize(text).toLowerCase(),
  );
}

function containsWeakLiteralConversationLead(text: string): boolean {
  return (
    /\b(?:else|will|part|thing|more)\s+matters once it is lived instead of described\b/i.test(
      normalize(text).toLowerCase(),
    ) ||
    /^(?:can|could|would|should|do|does|did|are|is)\b[^.?!]{0,48}\bmatters once it is lived instead of described\b/i.test(
      normalize(text).toLowerCase(),
    ) ||
    /\b(?:i want to talk about|what i want to talk about is|what interests me is)\s+(?:else|will|part|thing|more)\b/i.test(
      normalize(text).toLowerCase(),
    ) ||
    /\bkeep going on (?:be|being|do|doing|tell|would|could|should|actually)\b/i.test(
      normalize(text).toLowerCase(),
    ) ||
    /\bkeep going on\b/i.test(
      normalize(text).toLowerCase(),
    )
  );
}

function containsProceduralConversationTemplate(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\bgive me the exact live point you want answered\b/.test(normalized) ||
    /\bask the exact question you want answered\b/.test(normalized) ||
    /\bask it plainly, and i will answer (?:it|you) directly\b/.test(normalized) ||
    /\bput the question on me plainly, and i will answer it\b/.test(normalized) ||
    /\btell me what you actually want from it, and i will work with the real goal instead of guessing\b/.test(normalized) ||
    /\bdefine the target properly\b/.test(normalized) ||
    /\bwork with the real goal instead of guessing\b/.test(normalized)
  );
}

function containsAbstractConversationTemplate(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\bstops being decorative\b/.test(normalized) ||
    /\bstarts costing something\b/.test(normalized) ||
    /\bstops being an image\b/.test(normalized) ||
    /\bstarts asking something real\b/.test(normalized) ||
    /\bpolished wrapper\b/.test(normalized) ||
    /\bpolished version\b/.test(normalized) ||
    /\bsafe version\b/.test(normalized) ||
    /\bworks in practice\b/.test(normalized) ||
    /\blive with it\b/.test(normalized) ||
    /\breal dynamic\b/.test(normalized) ||
    /\bstopped being hypothetical\b/.test(normalized) ||
    /\bwhat it actually looks like when it is real\b/.test(normalized) ||
    /\bshaping the exchange\b/.test(normalized) ||
    /\btells me more than small talk\b/.test(normalized)
  );
}

function containsUnexpectedExecutionScaffold(text: string): boolean {
  return /\b(here is your task|check in once halfway through|reply done|choose quick or longer|pick one number from 1 to 10|rock paper scissors|number hunt|math duel|riddle lock|we are doing a quick word chain|let'?s play a game)\b/i.test(
    normalize(text),
  );
}

function containsThinConversationReply(text: string): boolean {
  return /^(?:good|yes|exactly|keep going)\.?$/i.test(normalize(text));
}

function isExplicitActivityDelegation(text: string): boolean {
  return /\b(you pick|you choose|pick for me|dealer'?s choice|let'?s play a game|wanna run a game)\b/i.test(
    normalize(text),
  );
}

function shouldPreferOpenConversationFallback(
  input: ResponseGateInput,
  conversationMove: ReturnType<typeof classifyCoreConversationMove>,
): boolean {
  if (
    isActiveTaskThread(input) ||
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

function containsUndefinedTaskReferent(input: ResponseGateInput, text: string): boolean {
  if (!isActiveTaskThread(input)) {
    return false;
  }
  if (
    input.sceneState.task_spec.relevant_inventory_item ||
    input.sceneState.task_spec.available_items.length > 0
  ) {
    return false;
  }
  return /\b(put it on now|secure it now|lock it in place|keep it on|keep it locked|held it\b)\b/i.test(
    normalize(text),
  );
}

function containsExcludedTaskCategory(input: ResponseGateInput, text: string): boolean {
  const normalized = normalize(text);
  return input.sceneState.task_spec.excluded_task_categories.some((category) => {
    if (category === "stillness") {
      return /\b(stillness|hold still|stay still|stay steady)\b/i.test(normalized);
    }
    if (category === "posture") {
      return /\b(posture|shoulders back|hands behind your back|kneel)\b/i.test(normalized);
    }
    if (category === "frame") {
      return /\b(frame|inspection|eye contact|visible)\b/i.test(normalized);
    }
    if (category === "device") {
      return /\b(device|put it on now|keep it on|lock it in place)\b/i.test(normalized);
    }
    return false;
  });
}

function repeatsCurrentTaskFamily(input: ResponseGateInput, text: string): boolean {
  if (input.sceneState.task_spec.request_kind !== "replacement") {
    return false;
  }
  const family = input.sceneState.task_spec.current_task_family;
  if (!family) {
    return false;
  }
  const normalized = normalize(text);
  if (family === "stillness_focus") {
    return /\b(stillness|hold still|stay still)\b/i.test(normalized);
  }
  if (family === "posture_discipline") {
    return /\b(strict upright posture|hold that posture)\b/i.test(normalized);
  }
  if (family === "posture_hands") {
    return /\b(hands behind your back|hands-back)\b/i.test(normalized);
  }
  if (family === "posture_kneeling") {
    return /\b(kneel|kneeling|on your knees)\b/i.test(normalized);
  }
  if (family === "posture_shoulders") {
    return /\b(shoulders back|chin up)\b/i.test(normalized);
  }
  if (family === "device_endurance" || family === "device_long_endurance" || family === "device_stakes") {
    return /\b(keep the device on|put it on now|keep it locked)\b/i.test(normalized);
  }
  if (family === "device_silence") {
    return /\b(stay silent|keep your mouth shut)\b/i.test(normalized);
  }
  if (family === "frame_inspection") {
    return /\b(inspection frame|fully visible)\b/i.test(normalized);
  }
  if (family === "frame_eye_contact") {
    return /\b(eye contact|eyes on me)\b/i.test(normalized);
  }
  if (family === "frame_quick") {
    return /\b(quick check|face forward)\b/i.test(normalized);
  }
  return false;
}

function shouldEnforceTurnPlan(input: ResponseGateInput): boolean {
  if (!input.turnPlan || !input.turnPlan.hasSufficientContextToAct) {
    return false;
  }
  if (
    input.sceneState.topic_type === "task_negotiation" &&
    (
      input.sceneState.task_spec.next_required_action === "ask_blocker" ||
      input.sceneState.task_spec.next_required_action === "present_options" ||
      input.sceneState.task_spec.next_required_action === "await_selection"
    )
  ) {
    return false;
  }
  return (
    input.turnPlan.requestedAction === "modify_existing_idea" ||
    input.turnPlan.requestedAction === "revise_previous_plan" ||
    input.turnPlan.requestedAction === "expand_previous_answer" ||
    input.turnPlan.requestedAction === "acknowledge_then_act" ||
    input.turnPlan.requestedAction === "summarize_current_thread" ||
    input.turnPlan.requestedAction === "follow_through_commitment" ||
    (input.turnPlan.requestedAction === "interpret_and_reflect" &&
      isBareOpinionFollowUp(input.userText))
  );
}

function isBareOpinionFollowUp(text: string): boolean {
  return /^\s*what do you think\??\s*$/i.test(normalize(text));
}

function isSemanticallyRepeated(current: string, previous: string): boolean {
  const normalizedCurrent = normalize(current).toLowerCase();
  const normalizedPrevious = normalize(previous).toLowerCase();
  if (normalizedCurrent === normalizedPrevious) {
    return true;
  }

  const reducedCurrent = normalizeForDuplicateCompare(current);
  const reducedPrevious = normalizeForDuplicateCompare(previous);
  if (!reducedCurrent || !reducedPrevious) {
    return false;
  }
  if (reducedCurrent === reducedPrevious) {
    return true;
  }
  if (reducedCurrent.length >= 24 && reducedPrevious.length >= 24) {
    if (reducedCurrent.includes(reducedPrevious) || reducedPrevious.includes(reducedCurrent)) {
      const longer =
        reducedCurrent.length >= reducedPrevious.length ? reducedCurrent : reducedPrevious;
      const shorter =
        reducedCurrent.length >= reducedPrevious.length ? reducedPrevious : reducedCurrent;
      const remainder = longer.replace(shorter, "").trim();
      if (
        remainder.length >= 20 &&
        /\b(because|that is|this is|i am talking about|it is where|it starts|it stops|matters|costing something|real dynamic)\b/i.test(
          remainder,
        )
      ) {
        return false;
      }
      return true;
    }
  }
  return false;
}

function isDialogueActAligned(input: ResponseGateInput, text: string): boolean {
  const act = input.dialogueAct;
  if (!act) {
    return true;
  }
  const normalized = normalize(text).toLowerCase();
  const user = normalize(input.userText).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (act === "duration_request") {
    return /\b\d+\s*(hour|hours|minute|minutes)\b/.test(normalized);
  }
  if (act === "task_request") {
    return /\b(task|challenge|hour|hours|minute|minutes|repeat|check in|report back)\b/.test(
      normalized,
    ) || /\b(what items are actually available|what can you actually use|gear or tools|what kind of task do you want|pick the lane|how long should i make it|what time window do you want)\b/i.test(
      normalized,
    );
  }
  if (act === "answer_activity_choice") {
    if (/\b(stakes?|bet|wager|if i win|if you win|on the line)\b/.test(user)) {
      return /\b(stakes?|bet|wager|if i win|if you win|terms?|set the wager|on the line)\b/.test(
        normalized,
      );
    }
    return /\bi pick\b|\bwe are doing\b|\bgame\b/.test(normalized);
  }
  if (act === "propose_activity") {
    return /\b(game|choose|pick|quick|longer|play)\b/.test(normalized);
  }
  if (act === "confusion") {
    return /\b(i mean|to clarify|this means|simple)\b/.test(normalized);
  }
  if (act === "short_follow_up") {
    const kind = detectShortFollowUpKind(input.userText);
    if (kind === "go_on") {
      return /\b(keep going|tell me|because|concrete part|being trained by me|useful to me|what people usually|get wrong|what would make you useful|what you could actually do)\b/i.test(
        normalized,
      );
    }
    if (
      /\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/i.test(
        user,
      )
    ) {
      return /\b(prove|proves|change|control|pressure|sloppy|performative|deliberate|depth|breathing|resets|rule)\b/i.test(
        normalized,
      );
    }
    if (/\b(do i need proof|what proof|how do i prove it|what counts as proof)\b/i.test(user)) {
      return /\b(midpoint|final report|minutes?|proof|count|check-?ins?)\b/i.test(normalized);
    }
    if (/\b(how deep|what depth|how far|how far in)\b/i.test(user)) {
      return /\b(deep enough|control first|maximum depth|depth for show|breathing|steadiness)\b/i.test(
        normalized,
      );
    }
    if (
      /\b((should|can|could|would)\s+i\s+(wear|use|keep on|add|combine|pair)|what if i (wear|use|add|combine)|can i keep|can i add|should i add|would it help if i wore)\b/i.test(
        user,
      ) &&
      /\b(with|while|during|along with|on top of|at the same time|doing it|that|instead)\b/i.test(user)
    ) {
      return /\b(yes|maybe|keep .* on|main (focus|task|line)|adds? denial|adds? accountability|add .* on the next|layered|same rule|control instead of noise)\b/i.test(
        normalized,
      );
    }
    return /\b(i mean|because|clarif|plain|part|unpacked|expanded|sharpened|current step|current move)\b/i.test(
      normalized,
    );
  }
  if (act === "user_answer") {
    if (isChatSwitchRequest(input.userText)) {
      return /\b(chat|talk|mind|normal)\b/.test(normalized);
    }
    if (isAssistantSelfQuestion(input.userText) || isMutualGettingToKnowRequest(input.userText)) {
      return (
        /\b(i like|i enjoy|i pay attention|what matters|what pulls you in|what do you want to know first|ask me something real)\b/i.test(
          normalized,
        ) || hasKeywordOverlap(user, normalized)
      );
    }
    if (isGoalOrIntentStatement(input.userText)) {
      return (
        /\b(goal|want from this|what that means|real goal|shape it with you|work with the real goal|trained|training)\b/i.test(
          normalized,
        ) && !/\bask the exact question|ask the exact part\b/i.test(normalized)
      );
    }
    if (
      input.sceneState.interaction_mode === "profile_building" ||
      isProfileBuildingRequest(input.userText) ||
      isMutualGettingToKnowRequest(input.userText)
    ) {
      return (
        isSafeProfileQuestion(normalized) ||
        /\b(what do you want to know about me|tell me something about yourself|i pay attention|i remember what matters|both ways|give me something real back)\b/i.test(
          normalized,
        ) || hasKeywordOverlap(user, normalized)
      );
    }
    return (
      /\b(noted|understood|i will use that)\b/.test(normalized) ||
      hasKeywordOverlap(user, normalized)
    );
  }
  if (act === "user_question") {
    if (input.sceneState.topic_type === "task_execution") {
      if (/\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/i.test(user)) {
        return /\b(prove|proves|change|control|pressure|sloppy|performative|deliberate|depth|breathing|resets|rule)\b/i.test(
          normalized,
        );
      }
      if (/\b(do i need proof|what proof|how do i prove it|what counts as proof)\b/i.test(user)) {
        return /\b(midpoint|final report|minutes?|proof|count)\b/i.test(normalized);
      }
      if (/\b(how deep|what depth|how far|how far in)\b/i.test(user)) {
        return /\b(deep enough|control first|maximum depth|depth for show|breathing|steadiness)\b/i.test(
          normalized,
        );
      }
    }
    if (input.sceneState.active_training_thread.subject !== "none") {
      if (/\b(what would that prove|what does that prove|what is that meant to prove|what would that change|what is that meant to change)\b/i.test(user)) {
        return /\b(prove|change|control|pressure|deliberate|sloppy|trained|rule)\b/i.test(normalized);
      }
      if (/\b(do i need proof|what proof|how do i prove it|what counts as proof)\b/i.test(user)) {
        return /\b(midpoint|final report|check-?ins?|count)\b/i.test(normalized);
      }
      if (/\b(what else|different one|another one|other angle|something else)\b/i.test(user)) {
        return /\b(switch you to|other angle|intervals|hold|protocol|discipline)\b/i.test(normalized);
      }
    }
    if (/\bhow are you(?: today)?\b/i.test(user)) {
      return /\b(i am good|sharp|awake|paying attention|on yours)\b/i.test(normalized);
    }
    if (isBareOpinionFollowUp(input.userText) && input.lastAssistantText) {
      return /\b(hesitation|truth was in the last line|more exposed than you meant|something real under it|actually change you)\b/i.test(
        normalized,
      );
    }
    if (isAssistantSelfQuestion(input.userText) || isMutualGettingToKnowRequest(input.userText)) {
      return /\b(i like|i enjoy|i pay attention|what matters|what pulls you in|what do you want to know first|ask me something real|be trainable|be useful|honesty|consistent enough|consistency first|follow through|follow-through|steadiness|prove first|notice first)\b/i.test(
        normalized,
      );
    }
    if (isProfileSummaryRequest(input.userText)) {
      return /\b(so far i have|not much yet|remember|interests?|communication|limits?|name)\b/i.test(
        normalized,
      );
    }
    if (/\bhow long\b/.test(user)) {
      return /\b\d+\s*(hour|hours|minute|minutes)\b/.test(normalized);
    }
    if (/\b(stakes?|bet|wager|if i win|if you win|on the line)\b/.test(user)) {
      return /\b(stakes?|bet|wager|if i win|if you win|terms?)\b/.test(normalized);
    }
    if (/\bwhat do you think about\b|\bwhat are your thoughts on\b/i.test(user)) {
      return /\b(i think|i care|i prefer|useful|matters|dynamic|control|fit|exchange|worth)\b/i.test(
        normalized,
      );
    }
    if (
      /\b(game|rules?|play|rock paper scissors|rps|number hunt|math duel|riddle lock|number command)\b/.test(
        user,
      )
    ) {
      return /\b(game|rules?|play|rock paper scissors|rps|number hunt|math duel|riddle lock|number command|first throw|first guess|equation|riddle|pick one number)\b/.test(
        normalized,
      );
    }
    if (
      /\b(where should i put it|where does it go|where should it go|how should i use it|how would you use it|what would you do with it|what do i do with it|how do i use it|is it oral or anal|can i use it orally|can i use it anally)\b/i.test(
        user,
      )
    ) {
      return /\b(oral use|anal use|grounded options|wear it|wrists|neck|eyes|face|external)\b/i.test(
        normalized,
      );
    }
    if (
      /\b((should|can|could|would)\s+i\s+(wear|use|keep on|add|combine|pair)|what if i (wear|use|add|combine)|can i keep|can i add|should i add|would it help if i wore)\b/i.test(
        user,
      ) &&
      /\b(with|while|during|along with|on top of|at the same time|doing it|that|instead)\b/i.test(user)
    ) {
      return /\b(yes|maybe|keep .* on|main (focus|task|line)|adds? denial|adds? accountability|add .* on the next|layered|same rule|control instead of noise)\b/i.test(
        normalized,
      );
    }
    return (
      hasKeywordOverlap(user, normalized) ||
      /\b(i mean|the answer|it means|because|here is|you asked)\b/.test(normalized)
    );
  }
  return true;
}

function buildOpenConversationFallback(input: ResponseGateInput): string {
  const conversationFallback = buildCoreConversationReply({
    userText: input.userText,
    previousAssistantText: input.lastAssistantText,
    currentTopic: input.sceneState.agreed_goal || null,
  });
  if (isTopicInitiationRequest(input.userText)) {
    return buildTopicInitiationReply({
      userText: input.userText,
      currentTopic: input.sceneState.agreed_goal || null,
      tone: "neutral",
    });
  }
  if (isBareOpinionFollowUp(input.userText) && input.lastAssistantText) {
    return buildPriorBeatOpinionReply(input.lastAssistantText);
  }
  if (isShortClarificationTurn(input.userText)) {
    return buildShortClarificationReply({
      userText: input.userText,
      interactionMode: input.sceneState.interaction_mode,
      topicType: input.sceneState.topic_type,
      lastAssistantText: input.lastAssistantText,
      lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
      currentTopic: input.sceneState.agreed_goal || null,
    });
  }
  if (isChatSwitchRequest(input.userText)) {
    return buildChatSwitchReply();
  }
  if (isProfileSummaryRequest(input.userText)) {
    return "Not much yet. Give me one thing about yourself that is actually worth keeping, and I will hold onto it.";
  }
  if (isMutualGettingToKnowRequest(input.userText)) {
    return "Good. We can play it both ways. Put a real question on me first, then I may put one back on you.";
  }
  if (isAssistantSelfQuestion(input.userText)) {
    return buildHumanQuestionFallback(input.userText, "neutral", {
      previousAssistantText: input.lastAssistantText,
      currentTopic: input.sceneState.agreed_goal || null,
      inventory: input.inventory ?? null,
    });
  }
  if (
    input.sceneState.interaction_mode === "profile_building" ||
    isProfileBuildingRequest(input.userText)
  ) {
    return (
      buildSceneFallback(input.sceneState, input.userText, input.sessionMemory, input.inventory) ??
      "Fine. Give me one thing I should understand about you, or tell me what I should get right about you first."
    );
  }
  if (isGoalOrIntentStatement(input.userText)) {
    return (
      buildCoreConversationReply({
        userText: input.userText,
        previousAssistantText: input.lastAssistantText,
        currentTopic: input.sceneState.agreed_goal || null,
      }) ??
      "If you want something from me, say what you want it to change, and I will stay with that."
    );
  }
  if (isChatLikeSmalltalk(input.userText)) {
    return buildOpenChatGreeting();
  }
  if (input.dialogueAct === "user_question" || input.dialogueAct === "short_follow_up") {
    return buildHumanQuestionFallback(input.userText, "neutral", {
      previousAssistantText: input.lastAssistantText,
      currentTopic: input.sceneState.agreed_goal || null,
      inventory: input.inventory ?? null,
    });
  }
  if (conversationFallback) {
    return conversationFallback;
  }
  return buildOpenChatNudge();
}

function chooseFallback(input: ResponseGateInput): string {
  const commitmentFallback = buildCommitmentFallback(input.commitmentState, input.userText);
  if (commitmentFallback) {
    return commitmentFallback;
  }
  const conversationMove = classifyCoreConversationMove({
    userText: input.userText,
    previousAssistantText: input.lastAssistantText,
    currentTopic: input.sceneState.agreed_goal || null,
  });
  if (isAssistantSelfQuestion(input.userText)) {
    return buildOpenConversationFallback(input);
  }
  if (isBareOpinionFollowUp(input.userText) && input.lastAssistantText) {
    return buildOpenConversationFallback(input);
  }
  if (shouldPreferOpenConversationFallback(input, conversationMove)) {
    return buildOpenConversationFallback(input);
  }
  const sceneFallback = buildSceneFallback(
    input.sceneState,
    input.userText,
    input.sessionMemory,
    input.inventory,
  );
  if (sceneFallback) {
    return sceneFallback;
  }
  return buildOpenConversationFallback(input);
}

function chooseTurnPlanFallback(input: ResponseGateInput): string {
  if (
    isAssistantSelfQuestion(input.userText) ||
    isAssistantServiceQuestion(input.userText) ||
    isMutualGettingToKnowRequest(input.userText)
  ) {
    return chooseFallback(input);
  }
  if (input.turnPlan && shouldEnforceTurnPlan(input)) {
    return buildTurnPlanFallback(input.turnPlan, "neutral");
  }
  return chooseFallback(input);
}

function buildDuplicateNudge(input: ResponseGateInput, fallback: string): string {
  const cleanedFallback = fallback.replace(/^good\.\s*/i, "").trim();
  const normalizedUser = normalize(input.userText).toLowerCase();
  const hasWagerCue = /\b(bet|wager|stakes|if i win|if you win)\b/i.test(normalizedUser);

  if (input.sceneState.topic_type === "reward_negotiation" || hasWagerCue) {
    return `No dodging, pet. ${cleanedFallback}`;
  }

  if (
    input.sceneState.topic_type === "game_setup" ||
    input.sceneState.topic_type === "game_execution"
  ) {
    return `Stay on this game, pet. ${cleanedFallback}`;
  }

  if (input.sceneState.topic_type === "task_execution") {
    return `No drifting, pet. ${cleanedFallback}`;
  }

  return `Answer directly, pet. ${cleanedFallback}`;
}

function buildNoVisualClaimFallback(input: ResponseGateInput): string {
  const reason = input.observationTrust?.reason ? ` (${input.observationTrust.reason})` : "";
  return `I do not have a fresh camera read right now${reason}, so I will not claim what I see. Ask again once the feed refreshes.`;
}

export function applyResponseGate(input: ResponseGateInput): ResponseGateResult {
  let text = stripInternalLines(input.text);
  let forced = false;
  let reason = "accepted";
  const conversationMove = classifyCoreConversationMove({
    userText: input.userText,
    previousAssistantText: input.lastAssistantText,
    currentTopic: input.sceneState.agreed_goal || null,
  });

  if (!text || containsBadInternalPhrase(text) || containsIdentityLeak(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "removed_internal_or_identity_leak";
  }

  if (!isResponseAlignedWithCommitment(input.commitmentState, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "commitment_misaligned";
  }

  if (!isResponseAlignedWithSceneState(input.sceneState, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "scene_misaligned";
  }

  if (
    input.observationTrust &&
    !input.observationTrust.canDescribeVisuals &&
    containsVisualClaim(text)
  ) {
    text = buildNoVisualClaimFallback(input);
    forced = true;
    reason = "visual_claim_blocked_by_trust";
  }

  if (
    shouldEnforceTurnPlan(input) &&
    input.turnPlan.requestedAction !== "gather_profile_only_when_needed" &&
    containsProfileIntakeQuestion(text)
  ) {
    text = chooseTurnPlanFallback(input);
    forced = true;
    reason = "profile_hijack_during_execution";
  }

  if (shouldEnforceTurnPlan(input) && input.turnPlan) {
    const turnPlanCheck = isTurnPlanSatisfied(input.turnPlan, text);
    if (!turnPlanCheck.ok) {
      text = chooseTurnPlanFallback(input);
      forced = true;
      reason = "turn_plan_misaligned";
    }
  }

  if (isTaskFulfillmentDue(input) && reasksResolvedTaskBlocker(input, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "blocker_reask_during_fulfillment";
  }

  if (isTaskFulfillmentDue(input) && containsProfileIntakeQuestion(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "profile_hijack_during_fulfillment";
  }

  if (isTaskFulfillmentDue(input) && (containsMenuDrift(text) || (!looksLikeTaskFulfillment(text) && /\?/.test(text)))) {
    text = chooseFallback(input);
    forced = true;
    reason = "fulfilled_context_asked_again";
  }

  if (isTaskFulfillmentDue(input) && !looksLikeTaskFulfillment(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "output_shape_mismatch_during_fulfillment";
  }

  if (isTaskOptionsDue(input) && looksLikeTaskFulfillment(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "preselected_task_when_options_due";
  }

  if (isActiveTaskThread(input) && containsGenericTaskThreadFallback(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "generic_chat_fallback_during_task_flow";
  }

  if (isActiveTaskThread(input) && containsVerboseTaskDebugWrapper(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "verbose_task_debug_wrapper";
  }

  if (
    !forced &&
    containsStockConversationFallback(text) &&
    !isActiveTaskThread(input) &&
    input.dialogueAct !== "task_request" &&
    input.dialogueAct !== "duration_request" &&
    conversationMove !== "blocked_need_clarification" &&
    conversationMove !== "concrete_request"
  ) {
    text = buildOpenConversationFallback(input);
    forced = true;
    reason = "generic_fallback_on_valid_turn";
  }

  if (
    !forced &&
    !isActiveTaskThread(input) &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    conversationMove !== "blocked_need_clarification" &&
    containsThinConversationReply(text)
  ) {
    text = buildOpenConversationFallback(input);
    forced = true;
    reason = "thin_conversation_reply";
  }

  if (!forced && isShortClarificationTurn(input.userText) && containsWeakClarificationAnchor(text)) {
    text = buildShortClarificationReply({
      userText: input.userText,
      interactionMode: input.sceneState.interaction_mode,
      topicType: input.sceneState.topic_type,
      lastAssistantText: input.lastAssistantText,
      lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
      currentTopic: input.sceneState.agreed_goal || null,
    });
    forced = true;
    reason = "weak_clarification_anchor";
  }

  if (!forced && containsWeakLiteralConversationLead(text)) {
    text = buildOpenConversationFallback(input);
    forced = true;
    reason = "weak_literal_topic_lead";
  }

  if (
    !forced &&
    !isActiveTaskThread(input) &&
    conversationMove !== "blocked_need_clarification" &&
    containsProceduralConversationTemplate(text)
  ) {
    text = buildOpenConversationFallback(input);
    forced = true;
    reason = "procedural_conversation_template";
  }

  if (
    !forced &&
    !isActiveTaskThread(input) &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    containsAbstractConversationTemplate(text)
  ) {
    text = buildOpenConversationFallback(input);
    forced = true;
    reason = "abstract_conversation_template";
  }

  if (containsExcludedTaskCategory(input, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "excluded_task_category_leak";
  }

  if (containsUndefinedTaskReferent(input, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "undefined_task_referent";
  }

  if (repeatsCurrentTaskFamily(input, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "replacement_repeated_current_family";
  }

  if (!forced && containsDuplicateTaskPayload(text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "duplicate_task_payload";
  }

  if (!forced && !isDialogueActAligned(input, text)) {
    text = chooseFallback(input);
    forced = true;
    reason = "dialogue_act_misaligned";
  }

  if (
    !forced &&
    !isActiveTaskThread(input) &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    input.dialogueAct !== "task_request" &&
    input.dialogueAct !== "duration_request" &&
    input.dialogueAct !== "propose_activity" &&
    input.dialogueAct !== "answer_activity_choice" &&
    !isExplicitActivityDelegation(input.userText) &&
    containsUnexpectedExecutionScaffold(text)
  ) {
    text = buildOpenConversationFallback(input);
    forced = true;
    reason = "mode_drift_on_conversational_turn";
  }

  if (
    !forced &&
    !(
      (input.dialogueAct === "task_request" ||
        input.sceneState.topic_type === "task_negotiation" ||
        input.sceneState.task_spec.request_kind === "replacement") &&
      /\bhere is your task\b/i.test(text)
    ) &&
    violatesEmbodiedVoice(input, text)
  ) {
    text = chooseFallback(input);
    forced = true;
    reason = "embodied_voice_misaligned";
  }

  const normalized = normalize(text);
  const shouldAllowReplacementTaskSimilarity =
    input.dialogueAct === "task_request" &&
    input.sceneState.task_spec.request_kind === "replacement" &&
    /\bhere is your task\b/i.test(text);
  const shouldAllowTrainingFollowUpSimilarity =
    input.sceneState.active_training_thread.subject !== "none" &&
    /\b(what would that prove|what does that prove|what is that meant to prove|do i need proof|what proof|how deep|what depth|how far|what do you mean|what else|different one|another one|make it stricter|make it softer)\b/i.test(
      normalize(input.userText),
    );
  if (
    input.lastAssistantText &&
    !shouldAllowReplacementTaskSimilarity &&
    !shouldAllowTrainingFollowUpSimilarity &&
    isSemanticallyRepeated(text, input.lastAssistantText)
  ) {
    const hasWagerCue = /\b(bet|wager|stakes|if i win|if you win)\b/i.test(
      normalize(input.userText),
    );
    if (input.sceneState.topic_type === "reward_negotiation" || hasWagerCue) {
      text = buildDuplicateNudge(input, chooseFallback(input));
      forced = true;
      reason = "duplicate_output_blocked";
      return {
        text: normalize(text),
        forced,
        reason,
      };
    }
    const fallback = chooseFallback(input);
    if (normalize(fallback).toLowerCase() !== normalized.toLowerCase()) {
      text = fallback;
      forced = true;
      reason = "duplicate_output_replaced";
    } else {
      text = buildDuplicateNudge(input, fallback);
      forced = true;
      reason = "duplicate_output_blocked";
    }
  }

  return {
    text: normalize(text),
    forced,
    reason,
  };
}
