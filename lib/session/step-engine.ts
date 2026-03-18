import type { CameraEvent, CheckType } from "../camera/events";
import { PacingController } from "./pacing.ts";

export type SessionState =
  | "idle"
  | "running"
  | "waiting_for_check"
  | "waiting_for_user"
  | "passed"
  | "failed"
  | "paused"
  | "stopped"
  | "completed";

export type StepMode = "talk" | "check" | "listen";

export type SessionStep = {
  id: string;
  mode: StepMode;
  say: string;
  checkType?: CheckType;
  question?: string;
  timeoutSeconds?: number;
  onPassSay: string;
  onFailSay: string;
  maxRetries: number;
};

export type StepEngineEvent =
  | { type: "state.changed"; timestamp: number; state: SessionState; message?: string }
  | {
      type: "step.started";
      timestamp: number;
      step: SessionStep;
      stepIndex: number;
      remainingSeconds: number;
    }
  | {
      type: "step.tick";
      timestamp: number;
      step: SessionStep;
      stepIndex: number;
      remainingSeconds: number;
    }
  | { type: "output"; timestamp: number; text: string }
  | { type: "user.input.received"; timestamp: number; text: string }
  | { type: "session.completed"; timestamp: number }
  | { type: "session.failed"; timestamp: number; reason: string }
  | { type: "session.stopped"; timestamp: number; reason: string };

type CheckController = {
  start: (checkType: CheckType) => void;
  stop: () => void;
  onEvent: (handler: (event: CameraEvent) => void) => () => void;
};

type StepEngineOptions = {
  autoTickMs?: number | null;
  pacing?: PacingController;
};

type StepRuntime = {
  stepIndex: number;
  retriesUsed: number;
  remainingSeconds: number;
};

function nowTs() {
  return Date.now();
}

function toTimeoutSeconds(step: SessionStep): number {
  if (typeof step.timeoutSeconds === "number" && Number.isFinite(step.timeoutSeconds)) {
    return Math.max(5, Math.floor(step.timeoutSeconds));
  }
  if (step.mode === "listen") {
    return 30;
  }
  return 15;
}

function shortenQuestion(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Give me a short answer now.";
  }
  const trimmed = normalized.length > 70 ? `${normalized.slice(0, 70)}...` : normalized;
  return `Short answer now: ${trimmed}`;
}

export class StepEngine {
  private readonly steps: SessionStep[];
  private readonly checkController: CheckController;
  private readonly autoTickMs: number | null;
  private readonly pacing: PacingController;
  private readonly handlers = new Set<(event: StepEngineEvent) => void>();
  private readonly unsubCheckEvent: () => void;
  private state: SessionState = "idle";
  private active: StepRuntime | null = null;
  private pausedFrom: SessionState = "idle";
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequenceId = 0;

  constructor(
    steps: SessionStep[],
    checkController: CheckController,
    options: StepEngineOptions = {},
  ) {
    this.steps = steps;
    this.checkController = checkController;
    this.autoTickMs = options.autoTickMs === undefined ? 1000 : options.autoTickMs;
    this.pacing = options.pacing ?? new PacingController("slow");
    this.unsubCheckEvent = this.checkController.onEvent((event) => this.onCheckEvent(event));
  }

  onEvent(handler: (event: StepEngineEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  getState(): SessionState {
    return this.state;
  }

  getCurrentStep(): SessionStep | null {
    if (!this.active) {
      return null;
    }
    return this.steps[this.active.stepIndex] ?? null;
  }

  getRemainingSeconds(): number {
    return this.active?.remainingSeconds ?? 0;
  }

  async waitBeforeNextStepPlanning() {
    await this.pacing.beforeNextPlanning();
  }

  start() {
    const currentSequence = ++this.sequenceId;
    if (this.state === "paused" && this.active) {
      if (this.pausedFrom === "waiting_for_check") {
        const step = this.steps[this.active.stepIndex];
        if (step?.mode === "check" && step.checkType) {
          this.checkController.start(step.checkType);
        }
        this.transitionTo("waiting_for_check");
      } else if (this.pausedFrom === "waiting_for_user") {
        this.transitionTo("waiting_for_user");
      } else {
        this.transitionTo("running");
      }
      this.startTimer();
      return;
    }

    if (this.state === "waiting_for_check" || this.state === "waiting_for_user" || this.state === "running") {
      return;
    }

    this.active = {
      stepIndex: 0,
      retriesUsed: 0,
      remainingSeconds: toTimeoutSeconds(this.steps[0] ?? MILESTONE4_STEPS[0]),
    };
    void this.beginStep(currentSequence);
  }

  pause() {
    if (
      this.state !== "waiting_for_check" &&
      this.state !== "waiting_for_user" &&
      this.state !== "running"
    ) {
      return;
    }

    this.pausedFrom = this.state;
    this.stopTimer();
    this.checkController.stop();
    this.transitionTo("paused");
  }

  stop(reason = "Session stopped.") {
    if (this.state === "idle" || this.state === "stopped") {
      return;
    }

    this.sequenceId += 1;
    this.stopTimer();
    this.checkController.stop();
    this.transitionTo("stopped", reason);
    this.emit({ type: "session.stopped", timestamp: nowTs(), reason });
  }

  provideUserInput(text: string) {
    const cleaned = text.trim();
    if (!cleaned || !this.active) {
      return;
    }

    this.emit({ type: "user.input.received", timestamp: nowTs(), text: cleaned });
    if (this.state === "waiting_for_user") {
      void this.onStepPassed(undefined, this.sequenceId);
    }
  }

  manualContinue() {
    if (!this.active) {
      return;
    }

    if (
      this.state !== "waiting_for_check" &&
      this.state !== "waiting_for_user" &&
      this.state !== "paused"
    ) {
      return;
    }

    void this.onStepPassed("Manual continue used.", this.sequenceId);
  }

  tick() {
    if (
      !this.active ||
      (this.state !== "waiting_for_check" && this.state !== "waiting_for_user")
    ) {
      return;
    }

    this.active.remainingSeconds -= 1;
    this.emit({
      type: "step.tick",
      timestamp: nowTs(),
      step: this.steps[this.active.stepIndex],
      stepIndex: this.active.stepIndex,
      remainingSeconds: this.active.remainingSeconds,
    });

    if (this.active.remainingSeconds <= 0) {
      if (this.state === "waiting_for_user") {
        void this.onListenTimeout(this.sequenceId);
        return;
      }
      void this.onStepFailed("Step timeout reached.", this.sequenceId);
    }
  }

  dispose() {
    this.sequenceId += 1;
    this.stopTimer();
    this.unsubCheckEvent();
    this.checkController.stop();
  }

  private emit(event: StepEngineEvent) {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private transitionTo(state: SessionState, message?: string) {
    this.state = state;
    this.emit({ type: "state.changed", timestamp: nowTs(), state, message });
  }

  private isSequenceCurrent(sequence: number) {
    return sequence === this.sequenceId;
  }

  private async emitOutputWithPacing(text: string, sequence: number) {
    if (!text.trim()) {
      return;
    }
    await this.pacing.beforeSpeak();
    if (!this.isSequenceCurrent(sequence)) {
      return;
    }
    this.emit({ type: "output", timestamp: nowTs(), text });
    this.pacing.markSpoke();
  }

  private async beginStep(sequence: number) {
    if (!this.active || !this.isSequenceCurrent(sequence)) {
      return;
    }

    const step = this.steps[this.active.stepIndex];
    if (!step) {
      this.onSessionCompleted();
      return;
    }

    this.active.remainingSeconds = toTimeoutSeconds(step);
    this.transitionTo("running");
    await this.emitOutputWithPacing(step.say, sequence);
    if (!this.active || !this.isSequenceCurrent(sequence)) {
      return;
    }

    if (step.mode === "talk") {
      await this.onStepPassed(undefined, sequence);
      return;
    }

    if (step.mode === "listen") {
      const question = step.question?.trim() || step.say.trim();
      if (question && question !== step.say.trim()) {
        await this.emitOutputWithPacing(question, sequence);
      }
      if (!this.active || !this.isSequenceCurrent(sequence)) {
        return;
      }

      this.transitionTo("waiting_for_user");
      this.emit({
        type: "step.started",
        timestamp: nowTs(),
        step,
        stepIndex: this.active.stepIndex,
        remainingSeconds: this.active.remainingSeconds,
      });
      this.startTimer();
      return;
    }

    if (!step.checkType) {
      await this.onStepFailed("Check step missing checkType.", sequence);
      return;
    }

    await this.pacing.beforeCheckStart();
    if (!this.active || !this.isSequenceCurrent(sequence)) {
      return;
    }

    this.checkController.start(step.checkType);
    this.transitionTo("waiting_for_check");
    this.emit({
      type: "step.started",
      timestamp: nowTs(),
      step,
      stepIndex: this.active.stepIndex,
      remainingSeconds: this.active.remainingSeconds,
    });
    this.startTimer();
  }

  private startTimer() {
    this.stopTimer();
    if (this.autoTickMs === null) {
      return;
    }

    this.timer = setInterval(() => this.tick(), this.autoTickMs);
  }

  private stopTimer() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private onSessionCompleted() {
    this.sequenceId += 1;
    this.stopTimer();
    this.checkController.stop();
    this.transitionTo("completed");
    this.emit({ type: "session.completed", timestamp: nowTs() });
  }

  private async onListenTimeout(sequence: number) {
    if (!this.active || !this.isSequenceCurrent(sequence)) {
      return;
    }
    const step = this.steps[this.active.stepIndex];
    this.stopTimer();
    this.checkController.stop();
    if ((step.onFailSay ?? "").trim()) {
      const followUp = shortenQuestion(step.question || step.say);
      await this.emitOutputWithPacing(followUp, sequence);
    }
    await this.onStepPassed(undefined, sequence);
  }

  private async onStepPassed(extraSay?: string, sequence = this.sequenceId) {
    if (!this.active || !this.isSequenceCurrent(sequence)) {
      return;
    }

    const step = this.steps[this.active.stepIndex];
    this.stopTimer();
    this.checkController.stop();
    this.transitionTo("passed");
    await this.emitOutputWithPacing(step.onPassSay, sequence);
    if (extraSay) {
      await this.emitOutputWithPacing(extraSay, sequence);
    }
    if (!this.isSequenceCurrent(sequence)) {
      return;
    }

    this.active = {
      stepIndex: this.active.stepIndex + 1,
      retriesUsed: 0,
      remainingSeconds: 0,
    };

    await this.beginStep(sequence);
  }

  private async onStepFailed(reason: string, sequence = this.sequenceId) {
    if (!this.active || !this.isSequenceCurrent(sequence)) {
      return;
    }

    const step = this.steps[this.active.stepIndex];
    this.stopTimer();
    this.checkController.stop();
    this.pacing.markFailure();
    await this.emitOutputWithPacing(step.onFailSay, sequence);
    if (!this.isSequenceCurrent(sequence)) {
      return;
    }

    if (this.active.retriesUsed < step.maxRetries) {
      this.active = {
        ...this.active,
        retriesUsed: this.active.retriesUsed + 1,
        remainingSeconds: toTimeoutSeconds(step),
      };
      await this.emitOutputWithPacing(
        `Retrying step (${this.active.retriesUsed}/${step.maxRetries}).`,
        sequence,
      );
      if (!this.isSequenceCurrent(sequence)) {
        return;
      }
      await this.beginStep(sequence);
      return;
    }

    this.transitionTo("failed", reason);
    this.emit({ type: "session.failed", timestamp: nowTs(), reason });
    this.sequenceId += 1;
  }

  private onCheckEvent(event: CameraEvent) {
    if (!this.active || this.state !== "waiting_for_check") {
      return;
    }

    if (event.type !== "check.completed") {
      return;
    }

    const step = this.steps[this.active.stepIndex];
    if (!step || step.mode !== "check" || !step.checkType || event.checkType !== step.checkType) {
      return;
    }

    if (event.status === "passed") {
      void this.onStepPassed(undefined, this.sequenceId);
      return;
    }

    void this.onStepFailed("Check failed.", this.sequenceId);
  }
}

export const MILESTONE4_STEPS: SessionStep[] = [
  {
    id: "step-1",
    mode: "check",
    say: "Get in frame and look at the camera.",
    checkType: "presence",
    timeoutSeconds: 15,
    onPassSay: "Good. You are in frame.",
    onFailSay: "I could not confirm presence.",
    maxRetries: 1,
  },
  {
    id: "step-2",
    mode: "check",
    say: "Turn your head left, then right.",
    checkType: "head_turn",
    timeoutSeconds: 20,
    onPassSay: "Good turn sequence.",
    onFailSay: "Head turn sequence failed.",
    maxRetries: 1,
  },
  {
    id: "step-3",
    mode: "check",
    say: "Hold still for a moment.",
    checkType: "presence",
    timeoutSeconds: 10,
    onPassSay: "Session complete.",
    onFailSay: "Stillness check failed.",
    maxRetries: 0,
  },
];
