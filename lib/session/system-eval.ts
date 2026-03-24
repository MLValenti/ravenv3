import {
  replayConversationScenarios,
  summarizeReplayResults,
  type ReplayRunOptions,
  type ReplayScenarioDefinition,
  type ReplayScenarioResult,
  type ReplayViolation,
} from "./conversation-replay.ts";
import { CONVERSATION_REPLAY_SCENARIOS } from "./conversation-replay-scenarios.ts";

export type SystemEvalSectionId =
  | "ordinary_chat"
  | "repair_and_clarification"
  | "mode_boundaries"
  | "game_flow"
  | "task_and_execution"
  | "inventory_and_device"
  | "memory_and_continuity"
  | "rendering_and_finalization";

export type SystemEvalFailureCluster =
  | "rendering_finalization_corruption"
  | "mode_routing_substate"
  | "prompt_contamination"
  | "repair_grounding"
  | "game_continuity"
  | "task_inventory_continuity"
  | "memory_normalization"
  | "fallback_voice_flattening"
  | "other";

export type SystemEvalSection = {
  id: SystemEvalSectionId;
  title: string;
  goals: string[];
  scenarioIds: string[];
};

export type SystemEvalResult = {
  matrix: SystemEvalSection[];
  results: ReplayScenarioResult[];
  summary: ReturnType<typeof summarizeReplayResults>;
  failuresByCluster: Array<{
    cluster: SystemEvalFailureCluster;
    count: number;
    violations: ReplayViolation[];
  }>;
  failuresBySection: Array<{
    sectionId: SystemEvalSectionId;
    title: string;
    scenarioCount: number;
    violationCount: number;
    scenarioIds: string[];
  }>;
};

export const RAVEN_SYSTEM_EVAL_MATRIX: SystemEvalSection[] = [
  {
    id: "ordinary_chat",
    title: "Ordinary Chat",
    goals: [
      "greetings stay normal chat",
      "Raven can lead topics without fallback language",
      "open chat stays conversational instead of switching into tasks or games",
      "topic changes do not corrupt continuity",
    ],
    scenarioIds: [
      "greeting_open_chat_blocked_clarification",
      "greeting_does_not_trigger_game_mode",
      "what_do_you_want_to_talk_about_starts_real_topic",
      "pick_topic_and_begin_conversation",
      "service_training_thread_stays_semantic",
      "agreement_extension_no_generic_fallback",
    ],
  },
  {
    id: "repair_and_clarification",
    title: "Repair And Clarification",
    goals: [
      "what do you mean resolves the immediately previous point",
      "repair turns do not ground on nonsense referents",
      "repair turns restate instead of resetting the thread",
    ],
    scenarioIds: [
      "clarification_stays_specific_to_last_point",
      "short_follow_up_no_cascade",
      "short_follow_up_rejects_weak_anchor",
      "training_follow_up_thread_stays_grounded",
    ],
  },
  {
    id: "mode_boundaries",
    title: "Mode Boundaries",
    goals: [
      "normal chat stays normal chat",
      "profile building does not hijack unrelated turns",
      "game mode does not start on weak greetings",
      "conversation exits submodes cleanly when asked",
    ],
    scenarioIds: [
      "greeting_does_not_trigger_game_mode",
      "no_profile_hijack_during_execution",
      "chat_switch_turn",
      "mode_return_profile_to_chat",
      "game_exit_returns_cleanly_to_chat",
    ],
  },
  {
    id: "game_flow",
    title: "Game Flow",
    goals: [
      "explicit play requests commit to game mode correctly",
      "game start includes a first playable prompt",
      "clarification during a game stays scoped to the current round",
      "game exits cleanly",
    ],
    scenarioIds: [
      "explicit_game_start_commits_mode_and_first_prompt",
      "game_clarification_stays_in_current_round",
      "game_exit_returns_cleanly_to_chat",
    ],
  },
  {
    id: "task_and_execution",
    title: "Task And Execution",
    goals: [
      "task requests stay on the task rail",
      "blockers are asked once then fulfilled",
      "follow-up questions stay grounded in the active task",
      "task flow does not collapse into generic chat",
    ],
    scenarioIds: [
      "ask_blocker_then_fulfill_task",
      "short_turn_resolves_blocker_without_reask",
      "task_request_stays_on_task_rail",
      "task_follow_up_questions_stay_grounded",
      "no_generic_chat_fallback_during_task_flow",
    ],
  },
  {
    id: "inventory_and_device",
    title: "Inventory And Device",
    goals: [
      "inventory references are grounded before use",
      "item use stays in context",
      "inventory-heavy threads do not corrupt mode or continuity",
    ],
    scenarioIds: [
      "insertable_item_use_question_gets_grounded_answer",
      "inventory_training_examples_are_grounded",
      "inventory_task_examples_are_grounded",
      "realistic_item_correction_overrides_stale_task",
    ],
  },
  {
    id: "memory_and_continuity",
    title: "Memory And Continuity",
    goals: [
      "recent topic continuity survives several turns",
      "repair uses the right previous assistant claim",
      "memory writes reflect the live thread instead of noise",
    ],
    scenarioIds: [
      "topic_lead_agreement_keeps_thread",
      "what_else_uses_context_not_literal_subject",
      "service_training_thread_stays_semantic",
      "realistic_item_correction_overrides_stale_task",
      "training_follow_up_handles_mixed_item_questions",
    ],
  },
  {
    id: "rendering_and_finalization",
    title: "Rendering And Finalization",
    goals: [
      "exactly one assistant output is committed",
      "stale candidates are not appended",
      "internal scaffolding never reaches user-visible output",
      "conversation_mode written to memory matches the committed turn",
    ],
    scenarioIds: [
      "no_internal_scaffold_leak",
      "no_duplicate_task_output",
      "explicit_game_start_commits_mode_and_first_prompt",
      "game_exit_returns_cleanly_to_chat",
    ],
  },
];

function selectScenariosFromIds(ids: string[]): ReplayScenarioDefinition[] {
  const byId = new Map(CONVERSATION_REPLAY_SCENARIOS.map((scenario) => [scenario.id, scenario]));
  return ids.flatMap((id) => {
    const scenario = byId.get(id);
    return scenario ? [scenario] : [];
  });
}

export function collectSystemEvalScenarioIds(matrix = RAVEN_SYSTEM_EVAL_MATRIX): string[] {
  return Array.from(new Set(matrix.flatMap((section) => section.scenarioIds)));
}

export function validateSystemEvalMatrix(
  matrix = RAVEN_SYSTEM_EVAL_MATRIX,
): { missingScenarioIds: string[] } {
  const known = new Set(CONVERSATION_REPLAY_SCENARIOS.map((scenario) => scenario.id));
  return {
    missingScenarioIds: collectSystemEvalScenarioIds(matrix).filter((id) => !known.has(id)),
  };
}

export function classifySystemEvalViolation(
  violation: ReplayViolation,
  result: ReplayScenarioResult,
): SystemEvalFailureCluster {
  if (
    violation.invariant.startsWith("final_output_source") ||
    violation.invariant.startsWith("single_output_commit") ||
    violation.invariant.startsWith("render.") ||
    violation.invariant.startsWith("browser_live_")
  ) {
    return "rendering_finalization_corruption";
  }
  if (
    violation.invariant.startsWith("mode.") ||
    violation.invariant.startsWith("task.pause_state") ||
    violation.invariant.startsWith("task.lock_state")
  ) {
    return result.scenario.id.includes("game") ? "game_continuity" : "mode_routing_substate";
  }
  if (violation.invariant.startsWith("game.")) {
    return "game_continuity";
  }
  if (
    violation.invariant.startsWith("memory.") &&
    /conversation_mode|session_intent|last_user|profile_fact/i.test(violation.actual)
  ) {
    return "memory_normalization";
  }
  if (
    result.scenario.id.includes("clarification") ||
    result.scenario.id.includes("follow_up") ||
    result.scenario.id.includes("repair")
  ) {
    return "repair_grounding";
  }
  if (
    result.scenario.id.includes("task") ||
    result.scenario.id.includes("inventory") ||
    result.scenario.id.includes("item")
  ) {
    return "task_inventory_continuity";
  }
  if (
    result.scenario.id.includes("greeting") ||
    result.scenario.id.includes("open_chat") ||
    result.scenario.id.includes("topic") ||
    result.scenario.id.includes("semantic") ||
    result.scenario.id.includes("kink")
  ) {
    return violation.invariant.startsWith("prompt.")
      ? "prompt_contamination"
      : "fallback_voice_flattening";
  }
  return "other";
}

export async function runRavenSystemEvaluation(
  options?: ReplayRunOptions,
  matrix = RAVEN_SYSTEM_EVAL_MATRIX,
): Promise<SystemEvalResult> {
  const scenarioIds = collectSystemEvalScenarioIds(matrix);
  const scenarios = selectScenariosFromIds(scenarioIds);
  const results = await replayConversationScenarios(scenarios, options);
  const summary = summarizeReplayResults(results);
  const failuresByClusterMap = new Map<SystemEvalFailureCluster, ReplayViolation[]>();

  for (const result of results) {
    for (const violation of result.violations) {
      const cluster = classifySystemEvalViolation(violation, result);
      const existing = failuresByClusterMap.get(cluster) ?? [];
      existing.push(violation);
      failuresByClusterMap.set(cluster, existing);
    }
  }

  const failuresByCluster = Array.from(failuresByClusterMap.entries())
    .map(([cluster, violations]) => ({
      cluster,
      count: violations.length,
      violations,
    }))
    .sort((left, right) => right.count - left.count);

  const failuresBySection = matrix.map((section) => {
    const sectionResults = results.filter((result) => section.scenarioIds.includes(result.scenario.id));
    return {
      sectionId: section.id,
      title: section.title,
      scenarioCount: sectionResults.length,
      violationCount: sectionResults.reduce((sum, result) => sum + result.violations.length, 0),
      scenarioIds: section.scenarioIds,
    };
  });

  return {
    matrix,
    results,
    summary,
    failuresByCluster,
    failuresBySection,
  };
}
