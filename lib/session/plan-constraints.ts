import type { PlannedStep } from "./step-planner-schema";

export type PlanOverrideResult = {
  step: PlannedStep;
  overridden: boolean;
  reason?: string;
};

function makeTransitionOverride(base: PlannedStep, stepIndex: number, reason: string): PlanOverrideResult {
  return {
    overridden: true,
    reason,
    step: {
      id: `dynamic-${stepIndex}-override-transition`,
      mode: "talk",
      say: "Hold still and keep your gaze forward.",
      timeoutSeconds: 12,
      onPassSay: base.onPassSay,
      onFailSay: base.onFailSay,
      maxRetries: 0,
    },
  };
}

function makeCheckOverride(base: PlannedStep, stepIndex: number, reason: string): PlanOverrideResult {
  return {
    overridden: true,
    reason,
    step: {
      id: `dynamic-${stepIndex}-override-check`,
      mode: "check",
      say: "Stay centered and look at the camera.",
      checkType: "presence",
      timeoutSeconds: 12,
      onPassSay: base.onPassSay,
      onFailSay: base.onFailSay,
      maxRetries: 1,
    },
  };
}

function hasSameSay(lastSteps: PlannedStep[], say: string): boolean {
  const normalized = say.trim().toLowerCase();
  return lastSteps
    .slice(-5)
    .some((step) => step.say.trim().toLowerCase() === normalized);
}

function sameCheckTypeStreak(lastSteps: PlannedStep[], checkType: string): number {
  let streak = 0;
  for (let i = lastSteps.length - 1; i >= 0; i -= 1) {
    const step = lastSteps[i];
    if (step.mode !== "check" || step.checkType !== checkType) {
      break;
    }
    streak += 1;
  }
  return streak;
}

export function applyPlannerConstraints(
  planned: PlannedStep,
  lastSteps: PlannedStep[],
  stepIndex: number,
): PlanOverrideResult {
  if (hasSameSay(lastSteps, planned.say)) {
    return makeTransitionOverride(
      planned,
      stepIndex,
      "Planner repeated identical say text from recent history.",
    );
  }

  if (planned.mode === "check" && planned.checkType) {
    const streak = sameCheckTypeStreak(lastSteps, planned.checkType);
    if (streak >= 2) {
      return makeTransitionOverride(
        planned,
        stepIndex,
        "Planner repeated the same checkType more than 2 times in a row.",
      );
    }
  }

  const previous = lastSteps[lastSteps.length - 1];
  if (previous) {
    if (previous.mode === "check" && planned.mode === "check") {
      return makeTransitionOverride(
        planned,
        stepIndex,
        "Alternating to transition step to avoid check-check chaining.",
      );
    }
    if (previous.mode === "listen" && planned.mode === "listen") {
      return makeCheckOverride(
        planned,
        stepIndex,
        "Alternating to check step to avoid listen-listen chaining.",
      );
    }
  }

  return { step: planned, overridden: false };
}
