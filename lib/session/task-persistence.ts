import { resolveTaskRequestFromAssistantOutput } from "../chat/session-contract.ts";
import type { VerificationCapabilityCatalogEntry } from "../camera/vision-capabilities.ts";
import {
  createTaskInDb,
  createTaskOccurrencesInDb,
  getTaskPreferencesFromDb,
} from "../db.ts";
import {
  buildOccurrencesForSchedule,
  buildTaskDueAt,
  parseCreateTaskRequestFromText,
  stripCreateTaskJsonBlock,
  validateTaskRequestAgainstCatalog,
} from "../tasks/system.ts";

export type PersistTaskFromAssistantTextInput = {
  text: string;
  lastUserText: string;
  allowedCheckTypes: string[];
  sessionMode: boolean;
  capabilityCatalog: VerificationCapabilityCatalogEntry[];
  sessionId: string;
  turnId: string;
};

export type PersistTaskFromAssistantTextResult = {
  text: string;
  createdTaskId: string | null;
  taskCreateSource: "none" | "assistant_fallback" | "structured_json";
  taskCreateKind: "none" | "final";
};

export type SessionTaskPersistenceEffects = {
  getTaskPreferences: typeof getTaskPreferencesFromDb;
  createTask: typeof createTaskInDb;
  createOccurrences: typeof createTaskOccurrencesInDb;
};

const defaultTaskPersistenceEffects: SessionTaskPersistenceEffects = {
  getTaskPreferences: getTaskPreferencesFromDb,
  createTask: createTaskInDb,
  createOccurrences: createTaskOccurrencesInDb,
};

export async function persistTaskFromAssistantText(
  input: PersistTaskFromAssistantTextInput,
  effects: SessionTaskPersistenceEffects = defaultTaskPersistenceEffects,
): Promise<PersistTaskFromAssistantTextResult> {
  let finalText = input.text;
  let createdTaskId: string | null = null;
  let taskCreateSource: "none" | "assistant_fallback" | "structured_json" = "none";
  let taskCreateKind: "none" | "final" = "none";
  if (!input.sessionMode) {
    return { text: finalText, createdTaskId, taskCreateSource, taskCreateKind };
  }
  const parsedStructured = parseCreateTaskRequestFromText(finalText);
  const taskRequest = resolveTaskRequestFromAssistantOutput({
    shapedText: finalText,
    lastUserText: input.lastUserText,
    allowedCheckTypes: input.allowedCheckTypes,
    sessionMode: input.sessionMode,
  });
  if (!taskRequest) {
    return { text: finalText, createdTaskId, taskCreateSource, taskCreateKind };
  }
  const taskPreferences = await effects.getTaskPreferences();
  const validation = validateTaskRequestAgainstCatalog(taskRequest, input.capabilityCatalog, {
    requireRewardConsequenceApproval: taskPreferences.require_reward_consequence_approval,
  });
  const dueAt =
    validation.schedulePolicy.type === "daily" && validation.schedulePolicy.end_date
      ? new Date(`${validation.schedulePolicy.end_date}T23:59:59.999`).toISOString()
      : buildTaskDueAt(validation.request.window_seconds);
  const created = await effects.createTask({
    title: validation.request.title,
    description: validation.request.description,
    dueAt,
    repeatsRequired: validation.request.repeats_required,
    pointsPossible: validation.request.points_possible,
    evidencePolicy: {
      required: validation.request.evidence.required,
      type: validation.request.evidence.type,
      camera_plan: validation.request.evidence.checks,
      max_attempts: validation.request.evidence.max_attempts,
      deny_user_override: validation.request.evidence.deny_user_override,
    },
    schedulePolicy: {
      ...validation.schedulePolicy,
    },
    rewardPlan: validation.rewardPlan,
    consequencePlan: validation.consequencePlan,
    sessionId: input.sessionId,
    turnId: input.turnId,
    createdBy: "raven",
  });
  const occurrences = buildOccurrencesForSchedule({
    schedulePolicy: validation.schedulePolicy,
    repeatsRequired: validation.request.repeats_required,
    dueAt,
  });
  if (occurrences.length > 0) {
    await effects.createOccurrences({
      taskId: created.id,
      occurrences,
    });
  }
  createdTaskId = created.id;
  taskCreateSource = parsedStructured ? "structured_json" : "assistant_fallback";
  taskCreateKind = "final";
  finalText =
    stripCreateTaskJsonBlock(finalText) ||
    `Task assigned: ${created.title}. Complete ${created.repeats_required} occurrence(s) by ${created.due_at} for ${created.points_possible} base points.`;

  return { text: finalText, createdTaskId, taskCreateSource, taskCreateKind };
}
