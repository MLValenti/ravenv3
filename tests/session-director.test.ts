import test from "node:test";
import assert from "node:assert/strict";

import { resolveSessionTopic, type SessionTopicType } from "../lib/session/session-director.ts";

function baseInput(overrides: Partial<Parameters<typeof resolveSessionTopic>[0]> = {}) {
  return {
    currentTopicType: "none" as SessionTopicType,
    currentTopicLocked: false,
    inferredTopicType: "general_request" as SessionTopicType,
    explicitStakeSignal: false,
    shouldReopenGameSetup: false,
    userAct: "other" as const,
    taskHardLockActive: false,
    taskExecutionEscalatesToTask: false,
    taskExecutionEscalatesToGame: false,
    taskExecutionEscalatesToGeneral: false,
    gameExecutionEscalatesToGeneral: false,
    rewardWindowEscalatesToTask: false,
    rewardWindowEscalatesToGameSetup: false,
    ...overrides,
  };
}

test("session director keeps hard-locked rail when no interrupt condition exists", () => {
  const decision = resolveSessionTopic(
    baseInput({
      currentTopicType: "game_execution",
      currentTopicLocked: true,
      inferredTopicType: "general_request",
    }),
  );

  assert.equal(decision.topicType, "game_execution");
  assert.equal(decision.topicLocked, true);
  assert.equal(decision.reason, "hold_locked_rail");
});

test("session director escalates to reward negotiation on explicit stake signal", () => {
  const decision = resolveSessionTopic(
    baseInput({
      currentTopicType: "task_execution",
      currentTopicLocked: true,
      explicitStakeSignal: true,
      taskHardLockActive: true,
    }),
  );

  assert.equal(decision.topicType, "reward_negotiation");
  assert.equal(decision.topicLocked, true);
  assert.equal(decision.reason, "explicit_stake_signal");
});

test("session director routes to task negotiation when locked execution requests a new task", () => {
  const decision = resolveSessionTopic(
    baseInput({
      currentTopicType: "task_execution",
      currentTopicLocked: true,
      taskExecutionEscalatesToTask: true,
      taskHardLockActive: true,
    }),
  );

  assert.equal(decision.topicType, "task_negotiation");
  assert.equal(decision.topicLocked, true);
  assert.equal(decision.reason, "task_negotiation_requested");
});

test("session director routes reward window game restart to game setup", () => {
  const decision = resolveSessionTopic(
    baseInput({
      currentTopicType: "reward_window",
      currentTopicLocked: true,
      rewardWindowEscalatesToGameSetup: true,
    }),
  );

  assert.equal(decision.topicType, "game_setup");
  assert.equal(decision.topicLocked, true);
  assert.equal(decision.reason, "game_setup_requested");
});

test("session director can unlock locked rails for a general conversation request", () => {
  const decision = resolveSessionTopic(
    baseInput({
      currentTopicType: "task_execution",
      currentTopicLocked: true,
      taskExecutionEscalatesToGeneral: true,
      taskHardLockActive: true,
    }),
  );

  assert.equal(decision.topicType, "general_request");
  assert.equal(decision.topicLocked, false);
  assert.equal(decision.reason, "general_conversation_requested");
});

test("session director reopens game setup when context requests it", () => {
  const decision = resolveSessionTopic(
    baseInput({
      shouldReopenGameSetup: true,
      inferredTopicType: "general_request",
    }),
  );

  assert.equal(decision.topicType, "game_setup");
  assert.equal(decision.topicLocked, true);
  assert.equal(decision.reason, "reopen_game_setup");
});

test("session director falls back to inferred topic when unlocked", () => {
  const decision = resolveSessionTopic(
    baseInput({
      inferredTopicType: "duration_negotiation",
      userAct: "user_question",
    }),
  );

  assert.equal(decision.topicType, "duration_negotiation");
  assert.equal(decision.topicLocked, true);
  assert.equal(decision.reason, "question_route");
});

test("session director does not keep a non-hard-locked task rail dominant", () => {
  const decision = resolveSessionTopic(
    baseInput({
      currentTopicType: "task_execution",
      currentTopicLocked: true,
      taskHardLockActive: false,
      inferredTopicType: "general_request",
      userAct: "user_question",
    }),
  );

  assert.equal(decision.topicType, "general_request");
  assert.equal(decision.topicLocked, false);
  assert.equal(decision.reason, "question_route");
});
