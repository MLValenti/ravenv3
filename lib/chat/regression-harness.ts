import type { DialogueRouteAct } from "../dialogue/router.ts";
import {
  createConversationStateSnapshot,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
  type ConversationMode,
  type ConversationStateSnapshot,
} from "./conversation-state.ts";
import {
  evaluateConversationTranscript,
  type ConversationEvalReport,
} from "./conversation-eval.ts";
import { detectStaleResponseReuse } from "./repetition.ts";

export type RegressionStateCheck = {
  activeTopicIncludes?: string;
  currentMode?: ConversationMode;
  userGoalIncludes?: string;
  recentFactIncludes?: string;
  recentCommitmentIncludes?: string;
  openLoopIncludes?: string;
  unansweredQuestionIncludes?: string;
  importantEntityIncludes?: string;
};

export type RegressionTurnExpectation = {
  responseIncludesAny?: string[];
  responseIncludesAll?: string[];
  responseExcludes?: string[];
  minWords?: number;
  maxQuestions?: number;
  shouldAvoidRepeat?: boolean;
  shouldReferenceActiveTopic?: boolean;
  shouldReferencePriorAssistant?: boolean;
  shouldAnswerQuestion?: boolean;
  shouldChooseConcreteOption?: boolean;
  shouldAskFollowUp?: boolean;
  stateAfterTurn?: RegressionStateCheck;
};

export type RegressionScenarioTurn = {
  user: string;
  userIntent: string;
  routeAct: DialogueRouteAct;
  scriptedAssistant?: string;
  expect: RegressionTurnExpectation;
};

export type RegressionScenario = {
  id: string;
  category:
    | "casual_chat"
    | "follow_up"
    | "topic_shift"
    | "memory_recall"
    | "profile"
    | "planning"
    | "task"
    | "game";
  title: string;
  description: string;
  turns: RegressionScenarioTurn[];
  finalState: RegressionStateCheck;
  thresholds?: {
    minContinuity?: number;
    minTopicalRelevance?: number;
    maxRepetitionRate?: number;
    minMemoryRecall?: number;
    minCoherence?: number;
    minHumanlikeFlow?: number;
    minAssertionPassRate?: number;
  };
};

export type RegressionAssertion = {
  label: string;
  pass: boolean;
  detail: string;
};

export type RegressionTurnLog = {
  turnNumber: number;
  user: string;
  assistant: string;
  stateAfterTurn: ConversationStateSnapshot;
  assertions: RegressionAssertion[];
};

export type RegressionScenarioResult = {
  scenarioId: string;
  category: RegressionScenario["category"];
  title: string;
  description: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  turnLogs: RegressionTurnLog[];
  finalState: ConversationStateSnapshot;
  report: ConversationEvalReport;
  assertions: RegressionAssertion[];
  failedAssertions: RegressionAssertion[];
  assertionPassRate: number;
};

export type RegressionRunSummary = {
  scenarioCount: number;
  turnCount: number;
  assertionCount: number;
  failedAssertionCount: number;
  averages: ConversationEvalReport & { assertion_pass_rate: number };
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function wordCount(text: string): number {
  return normalize(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  );
}

function includesNeedle(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function overlaps(left: string, right: string): boolean {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function isQuestion(text: string): boolean {
  return /\?/.test(text) || /^(what|why|how|when|where|who|which|can|could|would|will)\b/i.test(text);
}

function isConcreteChoice(text: string): boolean {
  return /\b(i pick|we are doing|here is your task|next task|start with|pick one|number hunt|rock paper scissors|task:|do this)\b/i.test(
    text,
  );
}

function makeAssertion(label: string, pass: boolean, detail: string): RegressionAssertion {
  return { label, pass, detail };
}

function assertState(
  scenarioId: string,
  labelPrefix: string,
  state: ConversationStateSnapshot,
  expected: RegressionStateCheck | undefined,
): RegressionAssertion[] {
  if (!expected) {
    return [];
  }

  const assertions: RegressionAssertion[] = [];
  if (expected.activeTopicIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:active_topic`,
        includesNeedle(state.active_topic, expected.activeTopicIncludes),
        state.active_topic,
      ),
    );
  }
  if (expected.currentMode) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:current_mode`,
        state.current_mode === expected.currentMode,
        state.current_mode,
      ),
    );
  }
  if (expected.userGoalIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:user_goal`,
        includesNeedle(state.user_goal ?? "", expected.userGoalIncludes),
        state.user_goal ?? "none",
      ),
    );
  }
  if (expected.recentFactIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:recent_fact`,
        state.recent_facts_from_user.some((fact) => includesNeedle(fact, expected.recentFactIncludes ?? "")),
        state.recent_facts_from_user.join(" | "),
      ),
    );
  }
  if (expected.recentCommitmentIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:recent_commitment`,
        state.recent_commitments_or_tasks.some((item) =>
          includesNeedle(item, expected.recentCommitmentIncludes ?? ""),
        ),
        state.recent_commitments_or_tasks.join(" | "),
      ),
    );
  }
  if (expected.openLoopIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:open_loop`,
        state.open_loops.some((item) => includesNeedle(item, expected.openLoopIncludes ?? "")),
        state.open_loops.join(" | "),
      ),
    );
  }
  if (expected.unansweredQuestionIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:unanswered_question`,
        state.unanswered_questions.some((item) =>
          includesNeedle(item, expected.unansweredQuestionIncludes ?? ""),
        ),
        state.unanswered_questions.join(" | "),
      ),
    );
  }
  if (expected.importantEntityIncludes) {
    assertions.push(
      makeAssertion(
        `${scenarioId}:${labelPrefix}:important_entity`,
        state.important_entities.some((item) => includesNeedle(item, expected.importantEntityIncludes ?? "")),
        state.important_entities.join(" | "),
      ),
    );
  }
  return assertions;
}

function assertTurnBehavior(input: {
  scenarioId: string;
  turnNumber: number;
  user: string;
  assistant: string;
  previousAssistant: string | null;
  stateAfterTurn: ConversationStateSnapshot;
  expectation: RegressionTurnExpectation;
}): RegressionAssertion[] {
  const assertions: RegressionAssertion[] = [];
  const prefix = `${input.scenarioId}:turn_${input.turnNumber}`;
  const normalizedAssistant = normalize(input.assistant);

  for (const needle of input.expectation.responseIncludesAny ?? []) {
    assertions.push(
      makeAssertion(
        `${prefix}:response_includes_any:${needle}`,
        includesNeedle(input.assistant, needle),
        input.assistant,
      ),
    );
  }

  for (const needle of input.expectation.responseIncludesAll ?? []) {
    assertions.push(
      makeAssertion(
        `${prefix}:response_includes_all:${needle}`,
        includesNeedle(input.assistant, needle),
        input.assistant,
      ),
    );
  }

  for (const needle of input.expectation.responseExcludes ?? []) {
    assertions.push(
      makeAssertion(
        `${prefix}:response_excludes:${needle}`,
        !includesNeedle(input.assistant, needle),
        input.assistant,
      ),
    );
  }

  if (typeof input.expectation.minWords === "number") {
    const count = wordCount(input.assistant);
    assertions.push(
      makeAssertion(`${prefix}:min_words`, count >= input.expectation.minWords, String(count)),
    );
  }

  if (typeof input.expectation.maxQuestions === "number") {
    const count = questionCount(input.assistant);
    assertions.push(
      makeAssertion(
        `${prefix}:max_questions`,
        count <= input.expectation.maxQuestions,
        String(count),
      ),
    );
  }

  if (input.expectation.shouldAvoidRepeat !== false) {
    const repetition = detectStaleResponseReuse(
      input.assistant,
      input.previousAssistant ? [input.previousAssistant] : [],
    );
    assertions.push(
      makeAssertion(
        `${prefix}:avoid_repeat`,
        !repetition.repeated,
        repetition.reason,
      ),
    );
  }

  if (input.expectation.shouldReferenceActiveTopic) {
    const activeTopic = input.stateAfterTurn.active_topic;
    assertions.push(
      makeAssertion(
        `${prefix}:references_active_topic`,
        activeTopic !== "none" && (includesNeedle(input.assistant, activeTopic) || overlaps(input.assistant, activeTopic)),
        `${activeTopic} :: ${input.assistant}`,
      ),
    );
  }

  if (input.expectation.shouldReferencePriorAssistant) {
    assertions.push(
      makeAssertion(
        `${prefix}:references_prior_assistant`,
        Boolean(input.previousAssistant) && overlaps(input.assistant, input.previousAssistant ?? ""),
        `${input.previousAssistant ?? "none"} :: ${input.assistant}`,
      ),
    );
  }

  if (input.expectation.shouldAnswerQuestion || isQuestion(input.user)) {
    const whyAnswer = /^\s*because\b/i.test(input.assistant) && /^\s*why\b/i.test(input.user);
    const genericMiss =
      /\b(what do you want out of this session|what would you like to talk about|how's your day|proceed to the next instruction)\b/i.test(
        input.assistant,
      );
    assertions.push(
      makeAssertion(
        `${prefix}:answers_question`,
        !genericMiss &&
          (whyAnswer ||
            overlaps(input.assistant, input.user) ||
            overlaps(input.assistant, input.stateAfterTurn.active_topic) ||
            overlaps(input.assistant, input.stateAfterTurn.open_loops.join(" "))),
        input.assistant,
      ),
    );
  }

  if (input.expectation.shouldChooseConcreteOption) {
    assertions.push(
      makeAssertion(
        `${prefix}:chooses_concrete_option`,
        isConcreteChoice(input.assistant) && !/\bwhat do you want\b/i.test(normalizedAssistant),
        input.assistant,
      ),
    );
  }

  if (typeof input.expectation.shouldAskFollowUp === "boolean") {
    const hasQuestion = questionCount(input.assistant) > 0;
    assertions.push(
      makeAssertion(
        `${prefix}:follow_up_question`,
        input.expectation.shouldAskFollowUp ? hasQuestion : !hasQuestion,
        input.assistant,
      ),
    );
  }

  assertions.push(...assertState(input.scenarioId, `turn_${input.turnNumber}`, input.stateAfterTurn, input.expectation.stateAfterTurn));
  return assertions;
}

export async function runRegressionScenario(input: {
  scenario: RegressionScenario;
  generateAssistant: (turn: RegressionScenarioTurn, state: ConversationStateSnapshot) => Promise<string>;
  sessionId?: string;
}): Promise<RegressionScenarioResult> {
  let state = createConversationStateSnapshot(input.sessionId ?? input.scenario.id);
  const transcript: Array<{ role: "user" | "assistant"; content: string }> = [];
  const turnLogs: RegressionTurnLog[] = [];
  const allAssertions: RegressionAssertion[] = [];
  let previousAssistant: string | null = null;

  for (const [index, turn] of input.scenario.turns.entries()) {
    transcript.push({ role: "user", content: turn.user });
    state = noteConversationUserTurn(state, {
      text: turn.user,
      userIntent: turn.userIntent,
      routeAct: turn.routeAct,
      nowMs: index * 2 + 1,
    });

    const assistant = (await input.generateAssistant(turn, state)).trim();
    transcript.push({ role: "assistant", content: assistant });
    state = noteConversationAssistantTurn(state, {
      text: assistant,
      ravenIntent: "respond",
      nowMs: index * 2 + 2,
    });

    const assertions = assertTurnBehavior({
      scenarioId: input.scenario.id,
      turnNumber: index + 1,
      user: turn.user,
      assistant,
      previousAssistant,
      stateAfterTurn: state,
      expectation: turn.expect,
    });
    turnLogs.push({
      turnNumber: index + 1,
      user: turn.user,
      assistant,
      stateAfterTurn: state,
      assertions,
    });
    allAssertions.push(...assertions);
    previousAssistant = assistant;
  }

  const report = evaluateConversationTranscript({
    turns: turnLogs.map((turn) => ({ user: turn.user, raven: turn.assistant })),
    state,
  });

  allAssertions.push(...assertState(input.scenario.id, "final_state", state, input.scenario.finalState));

  if (typeof input.scenario.thresholds?.minContinuity === "number") {
    allAssertions.push(
      makeAssertion(
        `${input.scenario.id}:metric:min_continuity`,
        report.continuity >= input.scenario.thresholds.minContinuity,
        String(report.continuity),
      ),
    );
  }
  if (typeof input.scenario.thresholds?.minTopicalRelevance === "number") {
    allAssertions.push(
      makeAssertion(
        `${input.scenario.id}:metric:min_topical_relevance`,
        report.topical_relevance >= input.scenario.thresholds.minTopicalRelevance,
        String(report.topical_relevance),
      ),
    );
  }
  if (typeof input.scenario.thresholds?.maxRepetitionRate === "number") {
    allAssertions.push(
      makeAssertion(
        `${input.scenario.id}:metric:max_repetition_rate`,
        report.repetition_rate <= input.scenario.thresholds.maxRepetitionRate,
        String(report.repetition_rate),
      ),
    );
  }
  if (typeof input.scenario.thresholds?.minMemoryRecall === "number") {
    allAssertions.push(
      makeAssertion(
        `${input.scenario.id}:metric:min_memory_recall`,
        report.memory_recall_accuracy >= input.scenario.thresholds.minMemoryRecall,
        String(report.memory_recall_accuracy),
      ),
    );
  }
  if (typeof input.scenario.thresholds?.minCoherence === "number") {
    allAssertions.push(
      makeAssertion(
        `${input.scenario.id}:metric:min_coherence`,
        report.coherence >= input.scenario.thresholds.minCoherence,
        String(report.coherence),
      ),
    );
  }
  if (typeof input.scenario.thresholds?.minHumanlikeFlow === "number") {
    allAssertions.push(
      makeAssertion(
        `${input.scenario.id}:metric:min_humanlike_flow`,
        report.humanlike_flow >= input.scenario.thresholds.minHumanlikeFlow,
        String(report.humanlike_flow),
      ),
    );
  }

  const failedAssertions = allAssertions.filter((assertion) => !assertion.pass);
  const assertionPassRate =
    allAssertions.length > 0
      ? Number(((allAssertions.length - failedAssertions.length) / allAssertions.length).toFixed(3))
      : 1;

  if (typeof input.scenario.thresholds?.minAssertionPassRate === "number") {
    const passRateAssertion = makeAssertion(
      `${input.scenario.id}:metric:min_assertion_pass_rate`,
      assertionPassRate >= input.scenario.thresholds.minAssertionPassRate,
      String(assertionPassRate),
    );
    allAssertions.push(passRateAssertion);
    if (!passRateAssertion.pass) {
      failedAssertions.push(passRateAssertion);
    }
  }

  return {
    scenarioId: input.scenario.id,
    category: input.scenario.category,
    title: input.scenario.title,
    description: input.scenario.description,
    transcript,
    turnLogs,
    finalState: state,
    report,
    assertions: allAssertions,
    failedAssertions,
    assertionPassRate,
  };
}

export function summarizeRegressionResults(results: RegressionScenarioResult[]): RegressionRunSummary {
  const totals = results.reduce(
    (summary, result) => {
      summary.turnCount += result.turnLogs.length;
      summary.assertionCount += result.assertions.length;
      summary.failedAssertionCount += result.failedAssertions.length;
      summary.continuity += result.report.continuity;
      summary.topical_relevance += result.report.topical_relevance;
      summary.repetition_rate += result.report.repetition_rate;
      summary.memory_recall_accuracy += result.report.memory_recall_accuracy;
      summary.coherence += result.report.coherence;
      summary.humanlike_flow += result.report.humanlike_flow;
      summary.assertion_pass_rate += result.assertionPassRate;
      return summary;
    },
    {
      turnCount: 0,
      assertionCount: 0,
      failedAssertionCount: 0,
      continuity: 0,
      topical_relevance: 0,
      repetition_rate: 0,
      memory_recall_accuracy: 0,
      coherence: 0,
      humanlike_flow: 0,
      assertion_pass_rate: 0,
    },
  );

  const scenarioCount = Math.max(1, results.length);
  return {
    scenarioCount: results.length,
    turnCount: totals.turnCount,
    assertionCount: totals.assertionCount,
    failedAssertionCount: totals.failedAssertionCount,
    averages: {
      continuity: Number((totals.continuity / scenarioCount).toFixed(3)),
      topical_relevance: Number((totals.topical_relevance / scenarioCount).toFixed(3)),
      repetition_rate: Number((totals.repetition_rate / scenarioCount).toFixed(3)),
      memory_recall_accuracy: Number((totals.memory_recall_accuracy / scenarioCount).toFixed(3)),
      coherence: Number((totals.coherence / scenarioCount).toFixed(3)),
      humanlike_flow: Number((totals.humanlike_flow / scenarioCount).toFixed(3)),
      assertion_pass_rate: Number((totals.assertion_pass_rate / scenarioCount).toFixed(3)),
    },
  };
}
