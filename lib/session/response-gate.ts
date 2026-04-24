import {
  isResponseAlignedWithCommitment,
  type CommitmentState,
} from "./commitment-engine.ts";
import {
  isResponseAlignedWithSceneState,
  type SceneState,
} from "./scene-state.ts";
import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  buildHumanQuestionFallback,
  buildPlanningQuestionFallback,
  type QuestionToneProfile,
} from "../chat/open-question.ts";
import { isCoherentRelationalQuestionAnswer } from "../chat/relational-answer-alignment.ts";
import { classifyCoreConversationMove } from "../chat/core-turn-move.ts";
import {
  isAssistantGeneralPreferenceQuestion,
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isChatSwitchRequest,
  isGoalOrIntentStatement,
  isMutualGettingToKnowRequest,
  isProfileSummaryRequest,
  isProfileBuildingRequest,
} from "./interaction-mode.ts";
import { enforceGameStartContract, inspectGameStartContract } from "./game-start-contract.ts";
import type { SessionMemory } from "./session-memory.ts";
import type { SessionInventoryItem } from "./session-inventory.ts";
import {
  buildShortClarificationReply,
  detectShortFollowUpKind,
  isShortClarificationTurn,
} from "./short-follow-up.ts";
import {
  detectRepairTurnKind,
  isWeakRepairReferent,
  resolveRepairTurn,
} from "../chat/repair-turn.ts";
import { isTurnPlanSatisfied, type TurnPlan } from "../chat/turn-plan.ts";
import { createResponseGateCandidateBuilder } from "./response-gate-candidates.ts";
import { buildSceneScaffoldReply } from "./scene-scaffolds.ts";
import {
  isExplicitBoundaryAnswer,
  questionSatisfiedMeaningfully,
} from "../chat/question-satisfaction.ts";
import { isHardStructuredScene } from "./conversation-runtime.ts";
import {
  buildSemanticTurnTrace,
  type SemanticTurnTrace,
  updateCanonicalTurnState,
  type PlannedMove,
} from "./turn-meaning.ts";
import {
  planDomainAnswer,
  validateAnswerContract,
} from "./raven-preferences.ts";

export type ResponseGateInput = {
  text: string;
  userText: string;
  dialogueAct?: DialogueRouteAct;
  lastAssistantText: string | null;
  toneProfile?: QuestionToneProfile;
  turnPlan?: TurnPlan | null;
  sceneState: SceneState;
  commitmentState: CommitmentState;
  sessionMemory?: SessionMemory | null;
  inventory?: SessionInventoryItem[] | null;
  observationTrust?: {
    canDescribeVisuals: boolean;
    reason: string;
  };
  commitOwnerId?: string | null;
};

export type ResponseGateResult = {
  text: string;
  forced: boolean;
  reason: string;
  semanticTrace: SemanticTurnTrace;
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
  /\bopen_chat\b/i,
  /\bquestion_answering\b/i,
  /\bsession_intent\b/i,
  /\bnext beat\b/i,
  /\bthat makes the next beat\b/i,
  /\bwe keep [a-z0-9_' -]+ and change it around\b/i,
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

const FINAL_VISIBLE_SCRUB_PATTERNS = [
  ...INTERNAL_PHRASE_PATTERNS,
  /\bresponse strategy\s*:/i,
  /\brequired move\s*:/i,
  /\bturn plan\s*:/i,
  /\bcurrent_mode\b/i,
  /\bactive_thread\b/i,
  /\banswer the user'?s question in the first sentence\b/i,
  /\banswer the user in the first sentence\b/i,
  /\bdo not pivot away before the answer is complete\b/i,
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
  /\bi mean(?: the part about)? (?:none|nothing|anything|something|stuff|that|this|it)\b/i,
  /\b(?:tell me|what part|stay with) (?:about )?(?:none|nothing|anything|something|stuff|that|this|it)\b/i,
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

function splitSentences(text: string): string[] {
  const matches = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]?/g);
  if (!matches) {
    return [];
  }
  return matches.map((item) => item.trim()).filter((item) => item.length > 0);
}

function isLegitimateClarifyingQuestion(userText: string, answerText: string): boolean {
  const normalizedAnswer = normalize(answerText);
  if (!/\?/.test(normalizedAnswer)) {
    return false;
  }
  if (
    /\b(do you mean|which part|what kind|in what sense|are you asking about|when you say)\b/i.test(
      normalizedAnswer,
    )
  ) {
    return true;
  }
  if (
    isAssistantGeneralPreferenceQuestion(userText) &&
    /\b(people|conversation|dynamics?|kinks?|preferences?|style)\b/i.test(normalizedAnswer)
  ) {
    return true;
  }
  return false;
}

function isDirectQuestionResolved(input: ResponseGateInput, answerText: string): boolean {
  if (questionSatisfiedMeaningfully(input.userText, answerText)) {
    return true;
  }
  if (isExplicitBoundaryAnswer(answerText)) {
    return true;
  }
  return isLegitimateClarifyingQuestion(input.userText, answerText);
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

export function scrubVisibleInternalLeakText(text: string): {
  text: string;
  changed: boolean;
  blocked: boolean;
} {
  const strippedLines = stripInternalLines(text);
  const filteredSentences = splitSentences(strippedLines).filter(
    (sentence) => !FINAL_VISIBLE_SCRUB_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  const scrubbed = filteredSentences.join(" ").replace(/\s+/g, " ").trim();
  return {
    text: scrubbed,
    changed: scrubbed !== normalize(text),
    blocked: scrubbed.length === 0,
  };
}

function resolveContinuityTopic(input: ResponseGateInput): string | null {
  const turnPlanThread = input.turnPlan?.activeThread;
  if (turnPlanThread && turnPlanThread !== "none") {
    return turnPlanThread;
  }
  return input.sceneState.agreed_goal || null;
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
  if (input.sceneState.topic_type === "task_execution") {
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

function isActiveAnswerFirstTrainingFollowUp(input: ResponseGateInput): boolean {
  if (input.sceneState.active_training_thread.subject === "none") {
    return false;
  }
  const normalized = normalize(input.userText).toLowerCase();
  return (
    /\btell me what you can actually do for me\b/.test(normalized) ||
    /\btell me what you can do for me\b/.test(normalized) ||
    /^(?:keep going|go on|tell me more|the concrete part)\b/.test(normalized) ||
    (/^\s*so\b/.test(normalized) && /\b(?:plug|dildo|toy)\b/.test(normalized) && /\b\d+\s*(?:hours?|minutes?)\b/.test(normalized))
  );
}

function isQuestionFirstAnswerThreadReset(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\benough hovering\b/.test(normalized) ||
    /\bsharp enough\b/.test(normalized) ||
    /\btell me why you'?re here\b/.test(normalized) ||
    /\bwhat you actually want\b/.test(normalized) ||
    /^(?:good|yes|fine|if you want that from me|then)?[,. ]*(?:then )?tell me\b/.test(normalized)
  );
}

function isRepairReplyGrounded(
  input: ResponseGateInput,
  text: string,
  repairResolution: ReturnType<typeof resolveRepairTurn>,
): boolean {
  if (!repairResolution.detected) {
    return true;
  }
  const normalized = normalize(text).toLowerCase();
  if (containsWeakClarificationAnchor(text)) {
    return false;
  }
  if (
    repairResolution.referentCandidate &&
    isWeakRepairReferent(repairResolution.referentCandidate)
  ) {
    return false;
  }
  if (detectRepairTurnKind(input.userText) && /^\s*(?:what|which|tell me|ask me|can you|do you)\b/i.test(normalized)) {
    return false;
  }
  if (
    /\?/.test(text) &&
    !/\b(i mean|because|when you said|i was talking about|the part|my point was|we can stop)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(i mean|because|when you said|the part|my point was|we can stop|talk directly|last answer|last point)\b/i.test(
    normalized,
  );
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
    !/\b(here is your task|task:|start now|put it on now|reply done|check in once halfway through|start the session|our sessions|what do you want out of this session)\b/i.test(
      text,
    ) &&
    (
      containsProfileIntakeQuestion(text) ||
      /\b(what do you actually enjoy doing|off the clock|what else should i know|what do you lose track of time doing|what do you like about it|what about it actually keeps you there|what people usually miss about you|what should i call you|what do you want me to understand|what do not want pushed|what boundaries|what actually gets its hooks into you)\b/i.test(
        text,
      )
    )
  );
}

function containsProfileIntakeQuestion(text: string): boolean {
  return /\b(what should i call you|what do you want me to understand about you|what boundaries|what should i read correctly about you|what pulls you in|what else should i know about you)\b/i.test(
    text,
  );
}

function isExplicitProfileBuildingInvitation(text: string): boolean {
  return /\b(i want you to|i want us to|i(?: would|'d) like you to|can you|help you)\b[\w\s]{0,30}\b(get to know me better|know me better|understand me better|learn more about me)\b/i.test(
    normalize(text),
  );
}

function isAcceptedProfileBuildingInvitationOpener(text: string): boolean {
  return /\b(what should i call you|what do you lose track of time doing|what boundaries|what people usually miss about you|what should i understand about you|what do you want me to understand about you)\b/i.test(
    normalize(text),
  );
}

function isProfileDisclosureLikeAnswer(text: string): boolean {
  return /\b(call me|my name is|my name's|i like\b|i like to\b|i enjoy\b|my hobbies are\b|my hobby is\b|i prefer\b|you should know that\b)\b/i.test(
    normalize(text),
  );
}

function isGroundedProfileFollowUpQuestion(userText: string, responseText: string): boolean {
  return isSafeProfileQuestion(responseText) && hasKeywordOverlap(userText, responseText);
}

function shouldPreserveInterpretiveProfileBeat(input: ResponseGateInput, text: string): boolean {
  const inProfileContext =
    input.sceneState.interaction_mode === "profile_building" ||
    input.turnPlan?.currentMode === "profile_building";
  if (
    !inProfileContext ||
    input.dialogueAct !== "user_answer"
  ) {
    return false;
  }
  const normalized = normalize(text);
  if (containsProfileIntakeQuestion(text) || violatesEmbodiedVoice(input, text)) {
    return false;
  }
  if (
    /^(?:noted|good|understood|heard)\b/i.test(normalized) &&
    !/\b(that tells me|which tells me|you are reaching for|quiets the noise|not just the hobby label|means|reads like|lands like|not filler|head quieter|head cleaner|quieter and cleaner)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    /\b(now we're getting somewhere|one of your interests|preferences directly from you)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return (
    hasKeywordOverlap(input.userText, text) ||
    /\b(that tells me|which tells me|you are reaching for|quiets the noise|not just the hobby label|not filler|head quieter|head cleaner|quieter and cleaner)\b/i.test(
      normalized,
    )
  );
}

function isValidCurrentRoundGameResolution(input: ResponseGateInput, text: string): boolean {
  if (
    input.dialogueAct !== "answer_activity_choice" ||
    input.sceneState.topic_type !== "game_execution"
  ) {
    return false;
  }
  const normalized = normalize(text).toLowerCase();
  if (!normalized || /\bi pick\b|\bwe are doing\b/.test(normalized)) {
    return false;
  }
  const hasRoundChoice =
    /\byou chose (?:rock|paper|scissors|\d+)\b/.test(normalized) ||
    /\bi (?:threw|chose) (?:rock|paper|scissors|\d+)\b/.test(normalized);
  const hasRoundOutcome =
    /\b(beats?|wins?|lose|loses|won|lost|round is mine|you win|i win|this throw|first throw|second throw|consequence is live now)\b/.test(
      normalized,
    );
  return hasRoundChoice && hasRoundOutcome;
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
  return /\b(drop the fog and say what you want|fine\. say what you want|say it cleanly\. what is actually on your mind|talk to me\. what is on your mind|all right\. tell me what is on your mind|point to the part you want answered|ask the exact question you want answered|name the part that lost you|tell me which part lost you|state the angle cleanly|we can break it down cleanly|there you are\. start talking|there you are\. tell me what is actually on your mind|start talking\.)\b/i.test(
    normalize(text).toLowerCase(),
  );
}

function containsWeakCasualProfileShell(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\b(let'?s have a chat|you can lead the topic|i will steer as long as you participate)\b/.test(
      normalized,
    ) ||
    /\bi'?ll follow your lead\b/.test(normalized) ||
    /\bconcrete part of open\b/.test(normalized) ||
    /\bthat sets the tone for this session\b/.test(normalized)
  );
}

function containsWeakGameCorrectionShell(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\banswer the prompt properly\b/.test(normalized) ||
    /\bno stalling\b/.test(normalized)
  );
}

function containsWeakGameContinuationShell(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /^keep going\.?$/i.test(normalize(text)) ||
    /\bkeep going\. tell me the concrete part\b/.test(normalized) ||
    /\bconcrete part of open\b/.test(normalized)
  );
}

function containsConversationalControlScaffold(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /\bunderstand that we have rules here\b/.test(normalized) ||
    /\bremember your place\b/.test(normalized) ||
    /\byou follow my lead now\b/.test(normalized) ||
    /\byou follow my instruction now\b/.test(normalized) ||
    /\bi(?:'m| am)\s*,\s*pet\b/.test(normalized)
  );
}

function containsGameOpenOrProceduralFallback(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /^first we choose the game, pet\./.test(normalized) ||
    /^i pick\. we are doing\b/.test(normalized) ||
    /\bwe stay on one game thread: one prompt from me, one clean reply from you\./.test(normalized) ||
    /^good\. keep the same subject, but answer this change directly:/i.test(normalize(text))
  );
}

function isExplicitGameRestartCue(userText: string): boolean {
  return /\b(start over|new game|different game|reset|you pick|pick for me|choose quick|choose longer|play again|another round)\b/i.test(
    normalize(userText),
  );
}

function hasExplicitCurrentTurnLiveGameEvidence(text: string): boolean {
  return /\b(game|rock paper scissors|rps|number hunt|math duel|riddle lock|number command|wager|stakes|if i win|if you win|another round|play again|you pick|pick for me|choose quick|choose longer|start over|new game|different game|reset)\b/i.test(
    normalize(text),
  );
}

function roundCommittedForGame(input: ResponseGateInput): boolean {
  const userText = normalize(input.userText);
  const lastAssistantText = normalize(input.lastAssistantText ?? input.sceneState.last_assistant_text ?? "");
  const hasMoveOrGuessCue =
    /\b(i choose\b|my choice is|my first throw is|for my (?:first|second|third) throw|first throw\b|second throw\b|rock\b|paper\b|scissors\b|guess(?:\s+\d+)?)\b/i.test(
      userText,
    );
  const hasImmediateContinuationCue =
    /\b(go on|keep going|what now|play again|another round|continue|wager|stakes|if i win|if you win|why that game|why this game|explain the game)\b/i.test(
      userText,
    );
  const hasPlayablePrompt =
    /\b(i pick\. we are doing|first throw now|first guess now)\b/i.test(lastAssistantText);
  const hasResolvedRoundCue =
    /\b(you win this round|i win this one|your consequence is live now|say ready)\b/i.test(
      lastAssistantText,
    );
  return (
    !isExplicitGameRestartCue(input.userText) &&
    (
      (
        input.sceneState.topic_type === "game_execution" &&
        (hasMoveOrGuessCue || hasImmediateContinuationCue)
      ) ||
      ((hasPlayablePrompt || hasResolvedRoundCue) &&
        (hasMoveOrGuessCue || hasImmediateContinuationCue))
    )
  );
}

function containsWrongFamilyTaskResidue(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return /\b(work assignment|next instruction|initial request to have a device task|focus on your initial request|explore [a-z0-9' -]+ games later)\b/.test(
    normalized,
  );
}

function isFreshCasualDisclosureOrTopicQuestion(input: ResponseGateInput): boolean {
  if (
    input.sceneState.interaction_mode !== "normal_chat" &&
    input.sceneState.interaction_mode !== "relational_chat" &&
    input.sceneState.interaction_mode !== "question_answering" &&
    input.sceneState.interaction_mode !== "profile_building"
  ) {
    return false;
  }
  const normalized = normalize(input.userText).toLowerCase();
  return (
    /^(?:i like|i love|i enjoy|i want|i wanted|i prefer|i think|i feel|call me|my name is|my name's|i'm into|i am into)\b/.test(
      normalized,
    ) ||
    /^(?:what do you think about|what's your take on)\b/.test(normalized)
  );
}

function isTrueActiveGameExecution(input: ResponseGateInput): boolean {
  return (
    input.sceneState.interaction_mode === "game" &&
    input.sceneState.topic_locked &&
    input.sceneState.topic_type === "game_execution"
  );
}

function isTurnPlanDurationCannedText(text: string): boolean {
  return /^(?:listen carefully, pet\.\s*)?(?:for this round, 30 minutes|this round runs for 30 minutes)\.?$/i.test(
    normalize(text),
  );
}

function classifyWinningSourceFamily(text: string, reason: string, finalMatchesRaw: boolean): string {
  const normalized = normalize(text);
  if (finalMatchesRaw && reason === "accepted") {
    return "raw_model";
  }
  if (/^first we choose the game, pet\./i.test(normalized)) {
    return "buildGameSetupReply";
  }
  if (/^i pick\. we are doing\b/i.test(normalized)) {
    return "buildDeterministicGameStart";
  }
  if (
    /\bwe stay on one game thread: one prompt from me, one clean reply from you\./i.test(normalized) ||
    /^good\. keep the same subject, but answer this change directly:/i.test(normalized) ||
    isTurnPlanDurationCannedText(normalized)
  ) {
    return reason === "turn_plan_misaligned" ? "turn_plan_misaligned" : "buildTurnPlanFallback";
  }
  if (reason === "duplicate_output_replaced" || reason === "duplicate_output_blocked") {
    return "duplicate_output_path";
  }
  if (reason === "turn_plan_misaligned") {
    return "turn_plan_misaligned";
  }
  if (/fallback|misaligned|blocked|replaced|drift|hijack|wrapper|leak|residue/i.test(reason)) {
    return "buildFallback";
  }
  return "other";
}

function isSemanticPlannerOwnedMove(plannedMove: PlannedMove): boolean {
  return (
    plannedMove.content_key === "greeting_open" ||
    plannedMove.content_key === "assistant_preference_answer" ||
    plannedMove.content_key === "assistant_preference_elaboration" ||
    plannedMove.content_key === "assistant_preference_clarification" ||
    plannedMove.content_key === "assistant_preference_revision" ||
    plannedMove.content_key === "user_preference_application" ||
    plannedMove.content_key === "raven_invitation_answer" ||
    plannedMove.content_key === "reciprocal_user_probe" ||
    plannedMove.content_key === "definition_answer" ||
    plannedMove.content_key === "factual_answer" ||
    plannedMove.content_key === "current_status_answer"
  );
}

function isKnownBadFamilyText(text: string): boolean {
  return containsGameOpenOrProceduralFallback(text) || isTurnPlanDurationCannedText(text);
}

function hasCommittedDelegatedPlayableCue(text: string | null | undefined): boolean {
  return /\b(i pick\. we are doing|first throw now|first guess now)\b/i.test(normalize(text ?? ""));
}

function isPostChoiceQuestionFirstGameTurn(input: ResponseGateInput): boolean {
  if (
    input.sceneState.topic_type !== "game_setup" ||
    input.dialogueAct !== "user_question" ||
    !hasCommittedDelegatedPlayableCue(input.lastAssistantText ?? input.sceneState.last_assistant_text)
  ) {
    return false;
  }
  return /\b(rules?|how does that one work|how do we play|which one|easiest|beginner|first move)\b/i.test(
    normalize(input.userText),
  );
}

function buildPostChoiceGameQuestionReply(input: ResponseGateInput): string | null {
  const previous = normalize(input.lastAssistantText ?? input.sceneState.last_assistant_text ?? "");
  const user = normalize(input.userText).toLowerCase();
  if (/rock paper scissors streak/i.test(previous)) {
    if (/\b(which one|easiest|beginner)\b/.test(user)) {
      return "Rock paper scissors streak is the easy one. Two throws, you choose rock, paper, or scissors each throw, and I reveal after you commit.";
    }
    if (/\b(first move)\b/.test(user)) {
      return "First move is yours. Choose rock, paper, or scissors for the first throw, then I reveal mine after you commit.";
    }
    return "Rock paper scissors streak is simple: two throws, you choose rock, paper, or scissors each throw, and I reveal after you commit.";
  }
  if (/number hunt/i.test(previous)) {
    return "Number hunt is simple: I lock one hidden number from 1 to 10, and you get two guesses maximum.";
  }
  if (/math duel/i.test(previous)) {
    return "Math duel is simple: two math prompts, digits only, and one wrong answer loses the round.";
  }
  return null;
}

function isRepeatedTaskBlockerFamily(text: string): boolean {
  return /^(?:answer directly, pet\.\s*)?be specific\. give me the task domain or the time window so i can set it properly\.?$/i.test(
    normalize(text),
  );
}

function isTaskProgressReportBackTurn(input: ResponseGateInput): boolean {
  const hasTaskContext =
    (input.sceneState.topic_type === "task_negotiation" || input.sceneState.topic_type === "task_execution") &&
    (input.sceneState.task_spec.request_fulfilled ||
      input.sceneState.current_task_domain.length > 0 ||
      input.sceneState.task_progress !== "none");
  return (
    hasTaskContext &&
    /\b(halfway|report back|check(?:-| )?in|finish|completed?|done|proceed|next step|what should i do next|what do i do next)\b/i.test(
      normalize(input.userText),
    )
  );
}

function explicitlyAsksTaskDomainOrDuration(userText: string): boolean {
  return /\b(task domain|what domain|which domain|time window|how long|duration|minutes?|hours?)\b/i.test(
    normalize(userText),
  );
}

function appendResponseGateTrace(entry: unknown): void {
  if (process.env.RAVEN_RESPONSE_GATE_TRACE !== "1") {
    return;
  }
  const traceFile = process.env.RAVEN_RESPONSE_GATE_TRACE_FILE || ".tmp-response-gate-trace.jsonl";
  try {
    const builtinProcess = process as typeof process & {
      getBuiltinModule?: (id: string) => { appendFileSync?: (path: string, data: string, encoding: string) => void } | null;
    };
    const fsModule =
      typeof builtinProcess.getBuiltinModule === "function"
        ? builtinProcess.getBuiltinModule("node:fs")
        : null;
    fsModule?.appendFileSync?.(traceFile, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Debug tracing must never affect live behavior.
  }
}

function isWeakGameExplanationDrift(input: ResponseGateInput, text: string): boolean {
  if (!isTrueActiveGameExecution(input)) {
    return false;
  }
  const user = normalize(input.userText).toLowerCase();
  if (!/\b(why that game|why this game|explain the game)\b/.test(user)) {
    return false;
  }
  const normalized = normalize(text).toLowerCase();
  return (
    /\bwe stay with\b/.test(normalized) &&
    /\b(two throws|one final guess|digits only|break the command|answer each riddle)\b/.test(normalized)
  );
}

function buildGameFollowThroughRepair(input: ResponseGateInput): string | null {
  return buildSceneScaffoldReply({
    act: input.dialogueAct ?? "other",
    userText: input.userText,
    sceneState: input.sceneState,
    sessionMemory: input.sessionMemory ?? undefined,
    inventory: input.inventory ?? undefined,
  });
}

function isCasualProfileGateContext(input: ResponseGateInput): boolean {
  if (isActiveTaskThread(input)) {
    return false;
  }
  if (
    input.sceneState.topic_type === "game_setup" ||
    input.sceneState.topic_type === "game_execution" ||
    input.sceneState.topic_type === "reward_negotiation" ||
    input.sceneState.topic_type === "reward_window" ||
    input.sceneState.topic_type === "task_negotiation" ||
    input.sceneState.topic_type === "task_execution"
  ) {
    return false;
  }
  return (
    input.sceneState.interaction_mode === "profile_building" ||
    input.sceneState.topic_type === "general_request" ||
    input.sceneState.topic_type === "none" ||
    isAssistantSelfQuestion(input.userText) ||
    isMutualGettingToKnowRequest(input.userText) ||
    isProfileBuildingRequest(input.userText)
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
    /\bkeep the same subject, but answer this change directly\b/.test(normalized) ||
    /\bi heard your answer and i am continuing from it now\b/.test(normalized) ||
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

function isWeakAcknowledgementOnly(text: string): boolean {
  const normalized = normalize(text).toLowerCase();
  return (
    /^(?:i mean\s+)?(?:noted|understood|heard|accepted|okay|ok|alright|all right|good)(?:,?\s*(?:pet|good|right|then))?[.!?]*$/.test(
      normalized,
    ) ||
    /^(?:noted|understood)(?:,?\s*(?:pet|good|then))?\.\s*i heard your answer and i am continuing from it now\.$/.test(
      normalized,
    )
  );
}

function isPlanningTurnPlan(turnPlan: TurnPlan | null | undefined): boolean {
  if (!turnPlan) {
    return false;
  }
  const combined = normalize(
    `${turnPlan.latestUserMessage} ${turnPlan.previousAssistantMessage ?? ""} ${turnPlan.activeThread}`,
  ).toLowerCase();
  return (
    /\b(?:help(?: me)? plan|let'?s plan|plan my|plan tomorrow|plan saturday|figure out my)\b/.test(
      combined,
    ) ||
    /\b(plan|planning|workdays|weekends|errands first|gym first|downtime first|morning plan|morning block|wake time|focused hour|first block|saturday|tomorrow morning)\b/.test(
      combined,
    )
  );
}

function isTaskTurnPlan(turnPlan: TurnPlan | null | undefined): boolean {
  if (!turnPlan) {
    return false;
  }
  const combined = normalize(
    `${turnPlan.latestUserMessage} ${turnPlan.previousAssistantMessage ?? ""} ${turnPlan.activeThread}`,
  ).toLowerCase();
  return (
    /\b(?:here is your task|start now|report back|check in once halfway|that task is complete|ask for the next task)\b/.test(
      combined,
    ) ||
    /\b(?:task|check in|report back|what counts as done|why that task|set me another one|different task|make it \d+\s*(?:minutes?|hours?))\b/.test(
      combined,
    )
  );
}

function hasPlanningContinuationContext(input: ResponseGateInput): boolean {
  const combined = normalize(
    `${input.userText} ${input.lastAssistantText ?? ""} ${input.sceneState.last_assistant_text ?? ""} ${input.sceneState.agreed_goal ?? ""}`,
  ).toLowerCase();
  return /\b(tomorrow morning|morning plan|morning block|wake time|first block|saturday|errands first|gym first|downtime first|the evening stays open|evening plan|workdays first|weekends first|plan)\b/.test(
    combined,
  );
}

function containsGenericPlanningDrift(input: ResponseGateInput, text: string): boolean {
  if (!hasPlanningContinuationContext(input)) {
    return false;
  }
  const user = normalize(input.userText).toLowerCase();
  const normalized = normalize(text).toLowerCase();

  if (
    /^\s*(?:errands first|gym first|downtime first)\s*$/.test(user) &&
    /\b(let'?s plan your saturday around|what specific tasks do you need to complete|what specific tasks do you need to get done this weekend|be as detailed as possible)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    (/^\s*why\??\s*$/.test(user) || /^what do you mean\??$/.test(user)) &&
    /\b(establish a clear schedule|establish a routine|makes everything run smoothly|increases productivity|responsibilities|which errands should we prioritize|let'?s get into the specifics)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /^(?:then what|what next|and then what)\??$/.test(user) &&
    /\b(how would you like to spend the rest of the day)\b/.test(normalized)
  ) {
    return true;
  }

  if (
    (/\bchange that\b.*\bgym\b.*\berrands\b/.test(user) ||
      /\bchange that,\s*put gym before errands\b/.test(user)) &&
    (
      /\b(reorganize and plan for a gym visit|specific gym activity|workout routine|start with the gym and then move on to your errands)\b/.test(
        normalized,
      ) ||
      (/\bswap that up\b/.test(normalized) && /\bstart with the gym\b/.test(normalized) && /\berrands\b/.test(normalized))
    )
  ) {
    return true;
  }

  if (
    /\bwhat about the evening\b/.test(user) &&
    /\bwhat it actually changes between people\b/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function hasTaskContinuationContext(input: ResponseGateInput): boolean {
  if (isActiveTaskThread(input)) {
    return true;
  }
  const combined = normalize(
    `${input.userText} ${input.lastAssistantText ?? ""} ${input.sceneState.last_assistant_text ?? ""} ${input.sceneState.current_task_domain} ${input.sceneState.task_spec.current_task_family} ${input.sceneState.task_spec.requested_domain}`,
  ).toLowerCase();
  return /\b(task|report back|check in once halfway|what counts as done|why that task|why this task|set me another one|next task|what else should i do now|start now|reply done)\b/.test(
    combined,
  );
}

function containsGenericTaskDrift(input: ResponseGateInput, text: string): boolean {
  if (!hasTaskContinuationContext(input)) {
    return false;
  }
  const user = normalize(input.userText).toLowerCase();
  const normalized = normalize(text).toLowerCase();

  if (
    /\b(why that task|why this task|why that one|why this one)\b/.test(user) &&
    /\b(control test|ready for more complex|adjust your next task)\b/.test(normalized)
  ) {
    return true;
  }

  if (
    /\b(what counts as done|what counts as complete|what exactly counts as done)\b/.test(user) &&
    /\b(current checkpoint|report back cleanly)\b/.test(normalized) &&
    !/\b(done means|20 minutes|30 minutes|hour|halfway)\b/.test(normalized)
  ) {
    return true;
  }

  if (
    /\b(set me another one|give me another one|give me the next one|next task|another task|new task)\b/.test(
      user,
    ) &&
    (
      containsStockConversationFallback(text) ||
      /\b(adjust the line after this|missing constraint|time window)\b/.test(normalized)
    )
  ) {
    return true;
  }

  return false;
}

function isKnownTaskDomain(
  value: string,
): value is SceneState["current_task_domain"] | SceneState["locked_task_domain"] {
  return /^(general|device|frame|posture|hands|kneeling|shoulders|stillness)$/.test(value);
}

function resolveTaskRepairDomain(input: ResponseGateInput): SceneState["current_task_domain"] {
  if (
    input.sceneState.task_spec.requested_domain !== "none" &&
    isKnownTaskDomain(input.sceneState.task_spec.requested_domain)
  ) {
    return input.sceneState.task_spec.requested_domain;
  }
  if (
    input.sceneState.user_requested_task_domain !== "none" &&
    isKnownTaskDomain(input.sceneState.user_requested_task_domain)
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

function buildTaskFollowThroughRepair(input: ResponseGateInput): string | null {
  const repairDomain = resolveTaskRepairDomain(input);
  const explicitNextTaskRequest = /\b(set me another one|give me another one|give me the next one|next task|another task|new task)\b/i.test(
    normalize(input.userText),
  );
  return buildSceneScaffoldReply({
    act: input.dialogueAct ?? "other",
    userText: input.userText,
    sceneState: {
      ...input.sceneState,
      interaction_mode: "task_planning",
      topic_type: "task_execution",
      topic_locked: true,
      topic_state: "open",
      current_task_domain: repairDomain,
      locked_task_domain: repairDomain,
      user_requested_task_domain: explicitNextTaskRequest
        ? repairDomain
        : input.sceneState.user_requested_task_domain,
      task_spec: {
        ...input.sceneState.task_spec,
        request_fulfilled: true,
        requested_domain:
          input.sceneState.task_spec.requested_domain === "none" ||
          !isKnownTaskDomain(input.sceneState.task_spec.requested_domain)
            ? repairDomain
            : input.sceneState.task_spec.requested_domain,
        request_kind: explicitNextTaskRequest
          ? "replacement"
          : input.sceneState.task_spec.request_kind,
        next_required_action: explicitNextTaskRequest
          ? "fulfill_request"
          : input.sceneState.task_spec.next_required_action,
        request_stage: explicitNextTaskRequest
          ? "ready_to_fulfill"
          : input.sceneState.task_spec.request_stage,
        selection_mode: explicitNextTaskRequest
          ? "direct_assignment"
          : input.sceneState.task_spec.selection_mode,
      },
    },
    sessionMemory: input.sessionMemory ?? undefined,
    inventory: input.inventory ?? undefined,
  });
}

function isMissingPlanningDetourBridge(input: ResponseGateInput, text: string): boolean {
  const previous = normalize(input.lastAssistantText ?? input.sceneState.last_assistant_text ?? "").toLowerCase();
  const user = normalize(input.userText).toLowerCase();
  const normalized = normalize(text).toLowerCase();
  if (
    !/\bone round first, then we return to (tomorrow morning|the morning plan|the week|saturday|the evening plan)\b/.test(
      previous,
    )
  ) {
    return false;
  }
  if (
    input.sceneState.topic_type !== "game_setup" ||
    input.sceneState.interaction_mode !== "game"
  ) {
    return false;
  }
  if (!/\b(you pick|you choose|pick for me|surprise me)\b/.test(user)) {
    return false;
  }
  return (
    /\b(i pick|we are doing|number hunt|rock paper scissors|math duel|riddle lock|number command)\b/.test(
      normalized,
    ) &&
    !/\b(one round|return to)\b/.test(normalized)
  );
}

function buildPlanningDriftRepair(input: ResponseGateInput): string | null {
  const fallback = buildPlanningQuestionFallback(input.userText, {
    previousAssistantText: input.lastAssistantText ?? input.sceneState.last_assistant_text ?? null,
    currentTopic: input.sceneState.agreed_goal || null,
  });
  if (fallback) {
    return fallback;
  }
  const normalized = normalize(input.userText).toLowerCase();
  if (/\bchange that\b/i.test(normalized) && /\bgym\b/i.test(normalized) && /\berrands\b/i.test(normalized)) {
    return "Fine. Gym first, errands second, evening still open. The thread stays the same, only the order changes.";
  }
  return null;
}

function isSoftPlanningReorderDrift(input: ResponseGateInput, text: string): boolean {
  const user = normalize(input.userText).toLowerCase();
  const normalized = normalize(text).toLowerCase();
  return (
    (/\bchange that\b.*\bgym\b.*\berrands\b/.test(user) ||
      /\bchange that,\s*put gym before errands\b/.test(user)) &&
    /\bswap that up\b/.test(normalized) &&
    /\bstart with the gym\b/.test(normalized) &&
    /\berrands\b/.test(normalized)
  );
}

function buildPlanningDetourBridgeRepair(input: ResponseGateInput, text: string): string | null {
  const previous = normalize(input.lastAssistantText ?? input.sceneState.last_assistant_text ?? "");
  const match = previous.match(
    /(Good\.\s*One round first, then we return to (?:tomorrow morning|the morning plan|the week|saturday|the evening plan)\.)/i,
  );
  if (!match) {
    return null;
  }
  if (/\b(one round|return to)\b/i.test(text)) {
    return text;
  }
  return `${match[1]} ${text}`.trim();
}

function shouldEnforceProfileGatherTurn(input: ResponseGateInput): boolean {
  if (!input.turnPlan || input.turnPlan.requestedAction !== "gather_profile_only_when_needed") {
    return false;
  }
  if (isPlanningTurnPlan(input.turnPlan) || isTaskTurnPlan(input.turnPlan)) {
    return false;
  }
  const combined = normalize(
    `${input.userText} ${input.turnPlan.activeThread} ${input.turnPlan.previousAssistantMessage ?? ""}`,
  ).toLowerCase();
  if (
    /\b(?:help(?: me)? plan|let'?s plan|plan my|plan tomorrow|plan saturday|plan my week|figure out my|go back to|back to|return to)\b/.test(
      combined,
    )
  ) {
    return false;
  }
  if (
    /\b(?:what counts as done|why that task|set me another one|different task|make it \d+\s*(?:minutes?|hours?))\b/.test(
      combined,
    )
  ) {
    return false;
  }
  return true;
}

function shouldAllowRepeatedGamePrompt(input: ResponseGateInput, text: string): boolean {
  if (
    input.sceneState.topic_type !== "game_execution" ||
    input.dialogueAct !== "short_follow_up"
  ) {
    return false;
  }
  return /\b(first throw|first guess|second throw|second and final guess|choose rock, paper, or scissors|one number from 1 to 10|reply with digits only|riddle one|riddle two)\b/i.test(
    normalize(text),
  );
}

function isExplicitActivityDelegation(text: string): boolean {
  return /\b(you pick|you choose|pick for me|dealer'?s choice|let'?s play a game|wanna run a game)\b/i.test(
    normalize(text),
  );
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
  const normalized = normalize(text);
  return matchesCurrentTaskFamily(input.sceneState.task_spec.current_task_family, normalized);
}

function matchesCurrentTaskFamily(family: string, normalized: string): boolean {
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
    input.dialogueAct === "duration_request" &&
    input.sceneState.topic_type === "game_execution"
  ) {
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
    shouldEnforceProfileGatherTurn(input) ||
    input.turnPlan.requestedAction === "acknowledge_then_act" ||
    input.turnPlan.requestedAction === "summarize_current_thread" ||
    input.turnPlan.requestedAction === "follow_through_commitment" ||
    (input.turnPlan.requestedAction === "shift_topic" &&
      isPlanningTurnPlan(input.turnPlan) &&
      /\b(go back|back to|return to)\b/i.test(normalize(input.userText))) ||
    (input.turnPlan.requestedAction === "answer_direct_question" &&
      isPlanningTurnPlan(input.turnPlan)) ||
    (input.turnPlan.requestedAction === "continue_active_thread" && isPlanningTurnPlan(input.turnPlan)) ||
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
    if (input.sceneState.topic_type === "game_execution") {
      return /\b(task timing|not this game|want a task|stay with the current move|current move|round)\b/i.test(
        normalized,
      );
    }
    if (
      input.sceneState.topic_type === "task_execution" &&
      input.sceneState.task_spec.request_kind === "revision" &&
      input.sceneState.task_spec.current_task_family
    ) {
      return (
        /\b\d+\s*(hour|hours|minute|minutes)\b/.test(normalized) &&
        matchesCurrentTaskFamily(input.sceneState.task_spec.current_task_family, normalized)
      );
    }
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
    if (isValidCurrentRoundGameResolution(input, text)) {
      return true;
    }
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
    if (input.sceneState.topic_type === "game_execution") {
      return /\b(game|round|throw|guess|prompt|rock|paper|scissors|number|riddle|equation|first throw|first guess|second throw|second and final guess|current move)\b/i.test(
        normalized,
      );
    }
    if (isWeakAcknowledgementOnly(text)) {
      return false;
    }
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
    const previousAskedQuestion = Boolean(input.lastAssistantText && /\?/.test(input.lastAssistantText));
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
      if (/\b(start the session|our sessions|what do you want out of this session)\b/i.test(normalized)) {
        return false;
      }
      if (shouldPreserveInterpretiveProfileBeat(input, text)) {
        return true;
      }
      return (
        isSafeProfileQuestion(normalized) ||
        /\b(what do you want to know about me|tell me something about yourself|i pay attention|i remember what matters|both ways|give me something real back)\b/i.test(
          normalized,
        ) || hasKeywordOverlap(user, normalized)
      );
    }
    if (previousAskedQuestion && isWeakAcknowledgementOnly(text) && !hasKeywordOverlap(user, normalized)) {
      return false;
    }
    return (
      /\b(noted|understood|i will use that)\b/.test(normalized) ||
      hasKeywordOverlap(user, normalized)
    );
  }
  if (act === "user_question") {
    if (
      isAssistantServiceQuestion(input.userText) &&
      /\b(ask me directly|turn one back on you|may turn one back|i will answer\. then i may turn one back)\b/i.test(
        normalized,
      )
    ) {
      return false;
    }
    if (isCoherentRelationalQuestionAnswer(input.userText, text)) {
      return true;
    }
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
      return /\b(i(?:'m| am) (?:good|okay|ok|fine|well)|sharp|watchful|awake|paying attention|on yours|what about you)\b/i.test(
        normalized,
      );
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

export function applyResponseGate(input: ResponseGateInput): ResponseGateResult {
  const rawModelOutput = input.text;
  let text = stripInternalLines(input.text);
  let forced = false;
  let reason = "accepted";
  let preservedCurrentAnswerAfterBlockedFallback = false;
  const replacementChain: Array<{
    oldText: string;
    newText: string;
    reason: string;
    sourcePath: string;
  }> = [];
  const continuityTopic = resolveContinuityTopic(input);
  const canonicalTurnState = updateCanonicalTurnState({
    userText: input.userText,
    previousAssistantText: input.lastAssistantText,
    previousUserText:
      input.sessionMemory?.last_user_answer?.value ??
      input.sessionMemory?.last_user_question?.value ??
      null,
    currentTopic: continuityTopic,
  });
  const turnMeaning = canonicalTurnState.turn_meaning;
  const plannedMove = canonicalTurnState.planned_move;
  const traceDecision = (
    oldText: string,
    newText: string,
    decisionReason: string,
    sourcePath: string,
    preservedCurrent = false,
  ): void => {
    if (normalize(oldText) === normalize(newText) && !preservedCurrent) {
      return;
    }
    if (preservedCurrent) {
      preservedCurrentAnswerAfterBlockedFallback = true;
    }
    replacementChain.push({
      oldText: normalize(oldText),
      newText: normalize(newText),
      reason: decisionReason,
      sourcePath,
    });
  };
  const finalizeCurrentResult = (): ResponseGateResult => {
    const finalOutput = normalize(text);
    const finalMatchesRaw = finalOutput === normalize(rawModelOutput);
    const classifiedWinningSourceFamily = classifyWinningSourceFamily(
      finalOutput,
      reason,
      finalMatchesRaw,
    );
    const winningSourceFamily =
      isSemanticPlannerOwnedMove(plannedMove) && !forced
        ? "semantic_planner"
        : classifiedWinningSourceFamily;
    const answerPlan = planDomainAnswer({ turnMeaning, plannedMove });
    const answerContractValidation = validateAnswerContract(answerPlan, finalOutput);
    const semanticTrace = buildSemanticTurnTrace({
      turnMeaning,
      plannedMove,
      winningSubsystem: winningSourceFamily,
      contentSource: classifiedWinningSourceFamily,
      styleWrapperApplied: false,
      guardIntervention: forced,
      commitOwnerId: input.commitOwnerId ?? null,
      legacyOverrideAttempted:
        replacementChain.length > 0 ||
        (isSemanticPlannerOwnedMove(plannedMove) && classifiedWinningSourceFamily !== "raw_model"),
      answerContractValidation,
    });
    if (forced && replacementChain.length === 0) {
      replacementChain.push({
        oldText: normalize(rawModelOutput),
        newText: finalOutput,
        reason,
        sourcePath: winningSourceFamily,
      });
    }
    appendResponseGateTrace({
      turnId: null,
      scenarioLabel: null,
      rawModelOutput: normalize(rawModelOutput),
      userText: normalize(input.userText),
      dialogueAct: input.dialogueAct ?? null,
      topicType: input.sceneState.topic_type,
      interactionMode: input.sceneState.interaction_mode,
      finalOutput,
      finalMatchesRaw,
      replaced: !finalMatchesRaw,
      replacementReason: reason,
      winningSourceFamily,
      turnMeaning,
      plannedMove,
      semanticTrace,
      preservedCurrentAnswerAfterBlockedFallback,
      rawAlreadyBad: isKnownBadFamilyText(rawModelOutput),
      replacementIntroducedBadOutput:
        !isKnownBadFamilyText(rawModelOutput) && isKnownBadFamilyText(finalOutput),
      replacementChain,
    });
    return {
      text: finalOutput,
      forced,
      reason,
      semanticTrace,
    };
  };
  const conversationMove = classifyCoreConversationMove({
    userText: input.userText,
    previousAssistantText: input.lastAssistantText,
    currentTopic: continuityTopic,
  });
  const activeTaskThread = isActiveTaskThread(input);
  const enforceTurnPlan = isSemanticPlannerOwnedMove(plannedMove)
    ? false
    : shouldEnforceTurnPlan(input);
  const explicitActivityDelegation = isExplicitActivityDelegation(input.userText);
  const assistantSelfDisclosureTurn =
    isAssistantSelfQuestion(input.userText) && !isAssistantServiceQuestion(input.userText);
  const hardStructuredScene = isHardStructuredScene({
    topic_type: input.sceneState.topic_type,
    topic_locked: input.sceneState.topic_locked,
    interaction_mode: input.sceneState.interaction_mode,
    task_hard_lock_active: input.sceneState.task_hard_lock_active,
    task_paused: input.sceneState.task_paused,
  });
  const candidates = createResponseGateCandidateBuilder({
    gateInput: input,
    continuityTopic,
    conversationMove,
    activeTaskThread,
    enforceTurnPlan,
    explicitActivityDelegation,
  });
  const initialGameStartInspection = inspectGameStartContract(text, input.sceneState.game_template_id);
  const allowGameStartContract = candidates.shouldAllowGameStartContract(initialGameStartInspection);
  if (initialGameStartInspection.detected && !allowGameStartContract) {
    const oldText = text;
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "unexpected_game_start_on_conversational_turn";
    traceDecision(oldText, text, reason, "buildOpenConversationFallback");
  }
  if (!forced && allowGameStartContract) {
    const enforcedGameStart = enforceGameStartContract(text, input.sceneState.game_template_id);
    if (enforcedGameStart.inspection.detected && enforcedGameStart.inspection.usedFallbackStart) {
      const oldText = text;
      text = enforcedGameStart.text;
      forced = true;
      reason = enforcedGameStart.inspection.hasPlayablePrompt
        ? "game_start_contract_restored"
        : "game_start_missing_first_prompt";
      traceDecision(oldText, text, reason, "enforceGameStartContract");
    }
  }
  const isGameStartTurn =
    allowGameStartContract && inspectGameStartContract(text, input.sceneState.game_template_id).detected;
  const repairResolution = isShortClarificationTurn(input.userText)
    ? resolveRepairTurn({
        userText: input.userText,
        previousAssistantText: input.lastAssistantText,
        previousUserText:
          input.sessionMemory?.last_user_answer?.value ??
          input.sessionMemory?.last_user_question?.value ??
          null,
        currentTopic: continuityTopic,
        memoryFallbackText:
          input.sessionMemory?.last_user_answer?.value ??
          input.sessionMemory?.last_user_question?.value ??
          null,
      })
    : null;
  const openConversationTurn =
    !hardStructuredScene &&
    !activeTaskThread &&
    !isGameStartTurn &&
    !enforceTurnPlan &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    input.dialogueAct !== "task_request" &&
    input.dialogueAct !== "duration_request" &&
    input.dialogueAct !== "propose_activity" &&
    input.dialogueAct !== "answer_activity_choice" &&
    input.sceneState.interaction_mode === "relational_chat" &&
    assistantSelfDisclosureTurn;

  if (!text || containsBadInternalPhrase(text) || containsIdentityLeak(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "removed_internal_or_identity_leak";
  }

  if (!isResponseAlignedWithCommitment(input.commitmentState, text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "commitment_misaligned";
  }

  if (!isResponseAlignedWithSceneState(input.sceneState, text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "scene_misaligned";
  }

  if (
    input.observationTrust &&
    !input.observationTrust.canDescribeVisuals &&
    containsVisualClaim(text)
  ) {
    text = candidates.buildNoVisualClaimFallback();
    forced = true;
    reason = "visual_claim_blocked_by_trust";
  }

  if (!forced && openConversationTurn) {
    if (
      repairResolution &&
      repairResolution.detected &&
      !isRepairReplyGrounded(input, text, repairResolution)
    ) {
      text =
        repairResolution.reply ??
        buildShortClarificationReply({
          userText: input.userText,
          interactionMode: input.sceneState.interaction_mode,
          topicType: input.sceneState.topic_type,
          lastAssistantText: input.lastAssistantText,
          lastUserText:
            input.sessionMemory?.last_user_answer?.value ??
            input.sessionMemory?.last_user_question?.value ??
            null,
          lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
          currentTopic: continuityTopic,
        });
      forced = true;
      reason = "repair_resolution_misaligned";
    }

    if (!forced && isShortClarificationTurn(input.userText) && containsWeakClarificationAnchor(text)) {
      text = buildShortClarificationReply({
        userText: input.userText,
        interactionMode: input.sceneState.interaction_mode,
        topicType: input.sceneState.topic_type,
        lastAssistantText: input.lastAssistantText,
        lastUserText:
          input.sessionMemory?.last_user_answer?.value ??
          input.sessionMemory?.last_user_question?.value ??
          null,
        lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
        currentTopic: continuityTopic,
      });
      forced = true;
      reason = "weak_clarification_anchor";
    }

    const directQuestionTurn =
      input.dialogueAct === "user_question" ||
      isAssistantSelfQuestion(input.userText) ||
      isMutualGettingToKnowRequest(input.userText);
    if (!forced && containsStockConversationFallback(text)) {
      text = candidates.buildOpenConversationFallback();
      forced = true;
      reason = "generic_fallback_on_valid_turn";
    }

    if (
      !forced &&
      (containsProceduralConversationTemplate(text) || containsAbstractConversationTemplate(text))
    ) {
      text = candidates.buildOpenConversationFallback();
      forced = true;
      reason = "procedural_conversation_template";
    }

    if (!forced && containsThinConversationReply(text)) {
      text = candidates.buildOpenConversationFallback();
      forced = true;
      reason = "thin_conversation_reply";
    }

    if (!forced && !isDialogueActAligned(input, text)) {
      const oldText = text;
      text = input.dialogueAct === "short_follow_up"
        ? buildShortClarificationReply({
          userText: input.userText,
          interactionMode: input.sceneState.interaction_mode,
          topicType: input.sceneState.topic_type,
          lastAssistantText: input.lastAssistantText,
          lastUserText:
            input.sessionMemory?.last_user_answer?.value ??
            input.sessionMemory?.last_user_question?.value ??
            null,
          lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
          currentTopic: continuityTopic,
        })
        : candidates.buildOpenConversationFallback();
      forced = true;
      reason = "dialogue_act_misaligned";
      traceDecision(oldText, text, reason, "buildOpenConversationFallback");
    }

    if (!forced && directQuestionTurn && !isDirectQuestionResolved(input, text)) {
      text = candidates.buildOpenConversationFallback();
      forced = true;
      reason = "direct_question_not_answered";
    }

    return finalizeCurrentResult();
  }

  const planningDriftDetected = !forced && containsGenericPlanningDrift(input, text);
  const planningDetourBridgeMissing = !forced && isMissingPlanningDetourBridge(input, text);
  const softPlanningReorderDetected = !forced && isSoftPlanningReorderDrift(input, text);
  if (!forced && planningDriftDetected) {
    const repaired = buildPlanningDriftRepair(input);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "planning_drift_replaced";
    }
  }
  if (!forced && planningDetourBridgeMissing) {
    const repaired = buildPlanningDetourBridgeRepair(input, text);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "planning_detour_bridge_restored";
    }
  }
  if (!forced && softPlanningReorderDetected) {
    const repaired = buildPlanningDriftRepair(input);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "planning_drift_replaced";
    }
  }
  if (
    !forced &&
    /\b(set me another one|give me another one|give me the next one|next task|another task|new task)\b/i.test(
      normalize(input.userText),
    ) &&
    input.sceneState.task_spec.request_fulfilled &&
    input.sceneState.task_spec.current_task_family.length > 0 &&
    input.sceneState.topic_type !== "task_execution" &&
    !/\b(here is your task|next task|start now|report back when it is done)\b/i.test(text)
  ) {
    const repaired = candidates.buildFallback();
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "task_follow_through_replaced";
    }
  }
  if (!forced && containsGenericTaskDrift(input, text)) {
    const repaired = buildTaskFollowThroughRepair(input);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "task_follow_through_replaced";
    }
  }
  if (
    !forced &&
    isTrueActiveGameExecution(input) &&
    input.dialogueAct === "user_question" &&
    containsWeakGameCorrectionShell(text)
  ) {
    const repaired = buildGameFollowThroughRepair(input);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "weak_game_correction_replaced";
    }
  }
  if (
    !forced &&
    isTrueActiveGameExecution(input) &&
    input.dialogueAct === "short_follow_up" &&
    containsWeakGameContinuationShell(text)
  ) {
    const repaired = buildGameFollowThroughRepair(input);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "weak_game_continuation_replaced";
    }
  }
  if (!forced && isWeakGameExplanationDrift(input, text)) {
    const repaired = buildGameFollowThroughRepair(input);
    if (repaired && normalize(repaired).toLowerCase() !== normalize(text).toLowerCase()) {
      text = repaired;
      forced = true;
      reason = "weak_game_explanation_replaced";
    }
  }
  if (
    !forced &&
    containsGameOpenOrProceduralFallback(text) &&
    (
      roundCommittedForGame(input) ||
      (
        input.sceneState.topic_type === "task_execution" &&
        !hasExplicitCurrentTurnLiveGameEvidence(input.userText)
      )
    )
  ) {
    const oldText = text;
    text = candidates.buildFallback();
    forced = true;
    reason = "wrong_family_game_open_blocked";
    traceDecision(oldText, text, reason, "buildFallback");
  }

  if (
    !forced &&
    input.turnPlan?.requestedAction === "gather_profile_only_when_needed" &&
    !input.lastAssistantText &&
    isProfileBuildingRequest(input.userText) &&
    !isAcceptedProfileBuildingInvitationOpener(text)
  ) {
    text = "What should I call you when I am speaking to you directly?";
    forced = true;
    reason = "profile_invitation_opener_restored";
  }

  if (
    !forced &&
    input.turnPlan?.requestedAction === "gather_profile_only_when_needed" &&
    input.dialogueAct === "user_answer" &&
    Boolean(input.lastAssistantText && /\?/.test(input.lastAssistantText)) &&
    isProfileDisclosureLikeAnswer(input.userText) &&
    !shouldPreserveInterpretiveProfileBeat(input, text) &&
    !isGroundedProfileFollowUpQuestion(input.userText, text)
  ) {
    text = buildHumanQuestionFallback(input.userText, input.toneProfile ?? "neutral", {
      previousAssistantText: input.lastAssistantText,
      currentTopic: input.turnPlan?.activeThread || resolveContinuityTopic(input),
    });
    forced = true;
    reason = "profile_answer_follow_up_restored";
  }

  if (
    input.turnPlan &&
    enforceTurnPlan &&
    input.turnPlan.requestedAction !== "gather_profile_only_when_needed" &&
    containsProfileIntakeQuestion(text)
  ) {
    text = candidates.buildTurnPlanFallback();
    forced = true;
    reason = "profile_hijack_during_execution";
  }

  if (enforceTurnPlan && input.turnPlan) {
    const turnPlanCheck = isTurnPlanSatisfied(input.turnPlan, text);
    if (!turnPlanCheck.ok) {
      const oldText = text;
      if (shouldPreserveInterpretiveProfileBeat(input, text)) {
        traceDecision(
          oldText,
          text,
          "turn_plan_interpretive_profile_preserved",
          "preserveCurrentAnswer",
          true,
        );
      } else if (
        input.sceneState.interaction_mode === "profile_building" &&
        input.dialogueAct === "user_answer" &&
        isExplicitProfileBuildingInvitation(input.userText)
      ) {
        if (isAcceptedProfileBuildingInvitationOpener(text)) {
          traceDecision(oldText, text, "turn_plan_profile_invitation_opener_preserved", "preserveCurrentAnswer", true);
        } else {
          text = "What should I call you when I am speaking to you directly?";
          if (normalize(text).toLowerCase() !== normalize(oldText).toLowerCase()) {
            forced = true;
            reason = "turn_plan_profile_invitation_opener_restored";
            traceDecision(oldText, text, reason, "restoreProfileBuildingInvitationOpener");
          }
        }
      } else {
        text = candidates.buildTurnPlanFallback();
        if (normalize(text).toLowerCase() !== normalize(oldText).toLowerCase()) {
          forced = true;
          reason = "turn_plan_misaligned";
          traceDecision(oldText, text, reason, "buildTurnPlanFallback");
        }
      }
    }
  }

  if (isTaskFulfillmentDue(input) && reasksResolvedTaskBlocker(input, text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "blocker_reask_during_fulfillment";
  }

  if (isTaskFulfillmentDue(input) && containsProfileIntakeQuestion(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "profile_hijack_during_fulfillment";
  }

  if (isTaskFulfillmentDue(input) && (containsMenuDrift(text) || (!looksLikeTaskFulfillment(text) && /\?/.test(text)))) {
    text = candidates.buildFallback();
    forced = true;
    reason = "fulfilled_context_asked_again";
  }

  if (isTaskFulfillmentDue(input) && !looksLikeTaskFulfillment(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "output_shape_mismatch_during_fulfillment";
  }

  if (isTaskOptionsDue(input) && looksLikeTaskFulfillment(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "preselected_task_when_options_due";
  }

  if (activeTaskThread && containsGenericTaskThreadFallback(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "generic_chat_fallback_during_task_flow";
  }

  if (activeTaskThread && containsVerboseTaskDebugWrapper(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "verbose_task_debug_wrapper";
  }

  if (
    !forced &&
    isFreshCasualDisclosureOrTopicQuestion(input) &&
    containsWrongFamilyTaskResidue(text)
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "task_residue_on_casual_turn";
  }

  if (
    !forced &&
    containsStockConversationFallback(text) &&
    !activeTaskThread &&
    !isGameStartTurn &&
    input.dialogueAct !== "task_request" &&
    input.dialogueAct !== "duration_request" &&
    conversationMove !== "blocked_need_clarification" &&
    (
      conversationMove !== "concrete_request" ||
      input.sceneState.interaction_mode === "profile_building" ||
      isProfileBuildingRequest(input.userText)
    )
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "generic_fallback_on_valid_turn";
  }

  if (
    !forced &&
    isCasualProfileGateContext(input) &&
    containsWeakCasualProfileShell(text)
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "weak_casual_profile_shell";
  }

  if (
    !forced &&
    !activeTaskThread &&
    !isGameStartTurn &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    containsConversationalControlScaffold(text)
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "conversational_control_scaffold";
  }

  if (
    !forced &&
    !activeTaskThread &&
    !isGameStartTurn &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    conversationMove !== "blocked_need_clarification" &&
    containsThinConversationReply(text)
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "thin_conversation_reply";
  }

  if (
    !forced &&
    repairResolution &&
    repairResolution.detected &&
    !isRepairReplyGrounded(input, text, repairResolution)
  ) {
    text =
      repairResolution.reply ??
      buildShortClarificationReply({
        userText: input.userText,
        interactionMode: input.sceneState.interaction_mode,
        topicType: input.sceneState.topic_type,
        lastAssistantText: input.lastAssistantText,
        lastUserText:
          input.sessionMemory?.last_user_answer?.value ??
          input.sessionMemory?.last_user_question?.value ??
          null,
        lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
        currentTopic: continuityTopic,
      });
    forced = true;
    reason = "repair_resolution_misaligned";
  }

  if (!forced && isShortClarificationTurn(input.userText) && containsWeakClarificationAnchor(text)) {
    text = buildShortClarificationReply({
      userText: input.userText,
      interactionMode: input.sceneState.interaction_mode,
      topicType: input.sceneState.topic_type,
      lastAssistantText: input.lastAssistantText,
      lastUserText:
        input.sessionMemory?.last_user_answer?.value ??
        input.sessionMemory?.last_user_question?.value ??
        null,
      lastUserAnswer: input.sessionMemory?.last_user_answer?.value ?? null,
      currentTopic: continuityTopic,
    });
    forced = true;
    reason = "weak_clarification_anchor";
  }

  if (
    !forced &&
    isActiveAnswerFirstTrainingFollowUp(input) &&
    isQuestionFirstAnswerThreadReset(text)
  ) {
    text = candidates.buildFallback();
    forced = true;
    reason = "answer_thread_not_answered_first";
  }

  if (!forced && containsWeakLiteralConversationLead(text)) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "weak_literal_topic_lead";
  }

  if (
    !forced &&
    !activeTaskThread &&
    !isGameStartTurn &&
    conversationMove !== "blocked_need_clarification" &&
    containsProceduralConversationTemplate(text)
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "procedural_conversation_template";
  }

  if (
    !forced &&
    !activeTaskThread &&
    !isGameStartTurn &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    containsAbstractConversationTemplate(text)
  ) {
    text = candidates.buildOpenConversationFallback();
    forced = true;
    reason = "abstract_conversation_template";
  }

  if (containsExcludedTaskCategory(input, text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "excluded_task_category_leak";
  }

  if (containsUndefinedTaskReferent(input, text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "undefined_task_referent";
  }

  if (repeatsCurrentTaskFamily(input, text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "replacement_repeated_current_family";
  }

  if (!forced && containsDuplicateTaskPayload(text)) {
    text = candidates.buildFallback();
    forced = true;
    reason = "duplicate_task_payload";
  }

  if (!forced && !isDialogueActAligned(input, text)) {
    const oldText = text;
    const fallback = candidates.buildFallback();
    if (
      isPostChoiceQuestionFirstGameTurn(input) &&
      containsGameOpenOrProceduralFallback(fallback)
    ) {
      const repaired = buildPostChoiceGameQuestionReply(input);
      if (repaired) {
        text = repaired;
        forced = true;
        reason = "dialogue_act_misaligned";
        traceDecision(oldText, text, reason, "post_choice_game_question");
      } else {
        text = fallback;
        forced = true;
        reason = "dialogue_act_misaligned";
        traceDecision(oldText, text, reason, "buildFallback");
      }
    } else {
      text = fallback;
      forced = true;
      reason = "dialogue_act_misaligned";
      traceDecision(oldText, text, reason, "buildFallback");
    }
  }

  if (
    !forced &&
    isPostChoiceQuestionFirstGameTurn(input) &&
    containsGameOpenOrProceduralFallback(text)
  ) {
    const oldText = text;
    const repaired = buildPostChoiceGameQuestionReply(input);
    if (repaired) {
      text = repaired;
      forced = true;
      reason = "post_choice_game_question";
      traceDecision(oldText, text, reason, "post_choice_game_question");
    }
  }

  if (
    !forced &&
    !activeTaskThread &&
    !isGameStartTurn &&
    input.sceneState.topic_type !== "game_setup" &&
    input.sceneState.topic_type !== "game_execution" &&
    input.sceneState.topic_type !== "reward_negotiation" &&
    input.sceneState.topic_type !== "reward_window" &&
    input.dialogueAct !== "task_request" &&
    input.dialogueAct !== "duration_request" &&
    input.dialogueAct !== "propose_activity" &&
    input.dialogueAct !== "answer_activity_choice" &&
    !explicitActivityDelegation &&
    containsUnexpectedExecutionScaffold(text)
  ) {
    text = candidates.buildOpenConversationFallback();
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
    text = candidates.buildFallback();
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
  const shouldAllowGamePromptSimilarity = shouldAllowRepeatedGamePrompt(input, text);
  const shouldAllowCurrentRoundGameResolution = isValidCurrentRoundGameResolution(input, text);
  if (
    input.lastAssistantText &&
    !shouldAllowReplacementTaskSimilarity &&
    !shouldAllowTrainingFollowUpSimilarity &&
    !shouldAllowGamePromptSimilarity &&
    !shouldAllowCurrentRoundGameResolution &&
    isSemanticallyRepeated(text, input.lastAssistantText)
  ) {
    if (isShortClarificationTurn(input.userText)) {
      const oldText = text;
      text = candidates.buildFallback();
      forced = true;
      reason = "duplicate_output_replaced";
      traceDecision(oldText, text, reason, "buildFallback");
      return finalizeCurrentResult();
    }
    const hasWagerCue = /\b(bet|wager|stakes|if i win|if you win)\b/i.test(
      normalize(input.userText),
    );
    if (input.sceneState.topic_type === "reward_negotiation" || hasWagerCue) {
      const oldText = text;
      text = candidates.buildDuplicateNudge(candidates.buildFallback());
      forced = true;
      reason = "duplicate_output_blocked";
      traceDecision(oldText, text, reason, "duplicate_output_path");
      return finalizeCurrentResult();
    }
    const fallback = candidates.buildFallback();
    if (
      isPostChoiceQuestionFirstGameTurn(input) &&
      containsGameOpenOrProceduralFallback(fallback)
    ) {
      const oldText = text;
      const repaired = buildPostChoiceGameQuestionReply(input);
      if (repaired) {
        text = repaired;
        forced = true;
        reason = "duplicate_output_replaced";
        traceDecision(oldText, text, reason, "post_choice_game_question");
        return finalizeCurrentResult();
      }
    }
    if (
      isRepeatedTaskBlockerFamily(text) &&
      isTaskProgressReportBackTurn(input) &&
      !explicitlyAsksTaskDomainOrDuration(input.userText)
    ) {
      const repaired = buildTaskFollowThroughRepair(input);
      if (repaired && normalize(repaired).toLowerCase() !== normalized.toLowerCase()) {
        const oldText = text;
        text = repaired;
        forced = true;
        reason = "duplicate_output_replaced";
        traceDecision(oldText, text, reason, "buildTaskFollowThroughRepair");
        return finalizeCurrentResult();
      }
    }
    if (normalize(fallback).toLowerCase() !== normalized.toLowerCase()) {
      const oldText = text;
      text = fallback;
      forced = true;
      reason = "duplicate_output_replaced";
      traceDecision(oldText, text, reason, "buildFallback");
    } else {
      const oldText = text;
      text = candidates.buildDuplicateNudge(fallback);
      forced = true;
      reason = "duplicate_output_blocked";
      traceDecision(oldText, text, reason, "duplicate_output_path");
    }
  }

  const finalGameStartInspection = inspectGameStartContract(text, input.sceneState.game_template_id);
  if (
    allowGameStartContract &&
    initialGameStartInspection.detected &&
    !finalGameStartInspection.hasPlayablePrompt
  ) {
    const oldText = text;
    const restored = enforceGameStartContract(
      initialGameStartInspection.usedFallbackStart ? text : input.text,
      initialGameStartInspection.templateId,
    );
    text = restored.text;
    forced = true;
    reason = "game_start_contract_restored";
    traceDecision(oldText, text, reason, "enforceGameStartContract");
  }

  return finalizeCurrentResult();
}
