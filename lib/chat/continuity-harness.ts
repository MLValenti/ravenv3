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

export type ContinuityScenarioTurn = {
  user: string;
  userIntent: string;
  routeAct: DialogueRouteAct;
  raven: string;
  ravenIntent: string;
  expectResponseIncludes?: string[];
  expectResponseExcludes?: string[];
};

export type ContinuityScenario = {
  id: string;
  title: string;
  turns: ContinuityScenarioTurn[];
  finalChecks?: {
    activeTopicIncludes?: string;
    currentMode?: ConversationMode;
    userGoalIncludes?: string;
    recentFactIncludes?: string;
    openLoopIncludes?: string;
    unansweredQuestionIncludes?: string;
    recentCommitmentIncludes?: string;
    importantEntityIncludes?: string;
    minContinuity?: number;
    maxRepetitionRate?: number;
    minCoherence?: number;
  };
};

export type ContinuityAssertion = {
  label: string;
  pass: boolean;
  detail: string;
};

export type ContinuityScenarioResult = {
  scenarioId: string;
  title: string;
  state: ConversationStateSnapshot;
  report: ConversationEvalReport;
  assertions: ContinuityAssertion[];
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function includesNeedle(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function makeAssertion(label: string, pass: boolean, detail: string): ContinuityAssertion {
  return { label, pass, detail };
}

export function runContinuityScenario(
  scenario: ContinuityScenario,
  sessionId = scenario.id,
): ContinuityScenarioResult {
  let state = createConversationStateSnapshot(sessionId);
  const assistantReplies: string[] = [];
  const assertions: ContinuityAssertion[] = [];

  for (const [index, turn] of scenario.turns.entries()) {
    state = noteConversationUserTurn(state, {
      text: turn.user,
      userIntent: turn.userIntent,
      routeAct: turn.routeAct,
      nowMs: index + 1,
    });
    state = noteConversationAssistantTurn(state, {
      text: turn.raven,
      ravenIntent: turn.ravenIntent,
      nowMs: index + 1,
    });

    for (const expected of turn.expectResponseIncludes ?? []) {
      assertions.push(
        makeAssertion(
          `${scenario.id}:turn_${index + 1}:response_includes:${expected}`,
          includesNeedle(turn.raven, expected),
          turn.raven,
        ),
      );
    }

    for (const forbidden of turn.expectResponseExcludes ?? []) {
      assertions.push(
        makeAssertion(
          `${scenario.id}:turn_${index + 1}:response_excludes:${forbidden}`,
          !includesNeedle(turn.raven, forbidden),
          turn.raven,
        ),
      );
    }

    const repetition = detectStaleResponseReuse(turn.raven, assistantReplies);
    assertions.push(
      makeAssertion(
        `${scenario.id}:turn_${index + 1}:no_repeat`,
        !repetition.repeated,
        repetition.reason,
      ),
    );
    assistantReplies.push(turn.raven);
  }

  const report = evaluateConversationTranscript({
    turns: scenario.turns.map((turn) => ({ user: turn.user, raven: turn.raven })),
    state,
  });

  if (scenario.finalChecks?.activeTopicIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:active_topic`,
        includesNeedle(state.active_topic, scenario.finalChecks.activeTopicIncludes),
        state.active_topic,
      ),
    );
  }

  if (scenario.finalChecks?.currentMode) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:current_mode`,
        state.current_mode === scenario.finalChecks.currentMode,
        state.current_mode,
      ),
    );
  }

  if (scenario.finalChecks?.userGoalIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:user_goal`,
        includesNeedle(state.user_goal ?? "", scenario.finalChecks.userGoalIncludes),
        state.user_goal ?? "none",
      ),
    );
  }

  if (scenario.finalChecks?.recentFactIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:recent_fact`,
        state.recent_facts_from_user.some((fact) =>
          includesNeedle(fact, scenario.finalChecks?.recentFactIncludes ?? ""),
        ),
        state.recent_facts_from_user.join(" | "),
      ),
    );
  }

  if (scenario.finalChecks?.openLoopIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:open_loop`,
        state.open_loops.some((loop) =>
          includesNeedle(loop, scenario.finalChecks?.openLoopIncludes ?? ""),
        ),
        state.open_loops.join(" | "),
      ),
    );
  }

  if (scenario.finalChecks?.unansweredQuestionIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:unanswered_question`,
        state.unanswered_questions.some((question) =>
          includesNeedle(question, scenario.finalChecks?.unansweredQuestionIncludes ?? ""),
        ),
        state.unanswered_questions.join(" | "),
      ),
    );
  }

  if (scenario.finalChecks?.recentCommitmentIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:recent_commitment`,
        state.recent_commitments_or_tasks.some((commitment) =>
          includesNeedle(commitment, scenario.finalChecks?.recentCommitmentIncludes ?? ""),
        ),
        state.recent_commitments_or_tasks.join(" | "),
      ),
    );
  }

  if (scenario.finalChecks?.importantEntityIncludes) {
    assertions.push(
      makeAssertion(
        `${scenario.id}:important_entity`,
        state.important_entities.some((entity) =>
          includesNeedle(entity, scenario.finalChecks?.importantEntityIncludes ?? ""),
        ),
        state.important_entities.join(" | "),
      ),
    );
  }

  if (typeof scenario.finalChecks?.minContinuity === "number") {
    assertions.push(
      makeAssertion(
        `${scenario.id}:min_continuity`,
        report.continuity >= scenario.finalChecks.minContinuity,
        String(report.continuity),
      ),
    );
  }

  if (typeof scenario.finalChecks?.maxRepetitionRate === "number") {
    assertions.push(
      makeAssertion(
        `${scenario.id}:max_repetition_rate`,
        report.repetition_rate <= scenario.finalChecks.maxRepetitionRate,
        String(report.repetition_rate),
      ),
    );
  }

  if (typeof scenario.finalChecks?.minCoherence === "number") {
    assertions.push(
      makeAssertion(
        `${scenario.id}:min_coherence`,
        report.coherence >= scenario.finalChecks.minCoherence,
        String(report.coherence),
      ),
    );
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    state,
    report,
    assertions,
  };
}
