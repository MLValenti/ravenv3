import test from "node:test";
import assert from "node:assert/strict";

import {
  isDeterministicSceneTopic,
  shouldBypassModelForSceneTurn,
} from "../lib/session/deterministic-scene-routing.ts";
import type { SceneState } from "../lib/session/scene-state.ts";

function sceneStatePatch(
  patch: Partial<
    Pick<
      SceneState,
      "topic_type" | "topic_locked" | "scene_type" | "interaction_mode" | "task_hard_lock_active"
    >
  >,
): Pick<
  SceneState,
  "topic_type" | "topic_locked" | "scene_type" | "interaction_mode" | "task_hard_lock_active"
> {
  return {
    topic_type: "none",
    topic_locked: false,
    scene_type: "conversation",
    interaction_mode: "normal_chat",
    task_hard_lock_active: false,
    ...patch,
  };
}

test("deterministic scene topic list includes game and task rails", () => {
  assert.equal(isDeterministicSceneTopic("game_setup"), true);
  assert.equal(isDeterministicSceneTopic("game_execution"), true);
  assert.equal(isDeterministicSceneTopic("task_execution"), true);
  assert.equal(isDeterministicSceneTopic("none"), false);
});

test("bypass model when a deterministic candidate exists in an explicit deterministic mode", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({
      topic_type: "task_negotiation",
      topic_locked: true,
      interaction_mode: "task_planning",
    }),
    dialogueAct: "other",
    hasDeterministicCandidate: true,
  });
  assert.equal(bypass, true);
});

test("bypass model on locked deterministic game topic even without candidate", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({
      topic_type: "game_execution",
      topic_locked: true,
      scene_type: "game",
      interaction_mode: "game",
    }),
    dialogueAct: "other",
    hasDeterministicCandidate: false,
  });
  assert.equal(bypass, true);
});

test("unlocked deterministic topic without a scaffold can still use the model", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({
      topic_type: "game_setup",
      topic_locked: false,
      scene_type: "game",
      interaction_mode: "game",
    }),
    dialogueAct: "user_question",
    hasDeterministicCandidate: false,
  });
  assert.equal(bypass, false);
});

test("game scene type alone does not force model bypass when no deterministic rail is active", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({ topic_type: "none", scene_type: "game" }),
    dialogueAct: "user_question",
    hasDeterministicCandidate: false,
  });
  assert.equal(bypass, false);
});

test("non deterministic conversation can still use model", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({ topic_type: "general_request", scene_type: "conversation" }),
    dialogueAct: "other",
    hasDeterministicCandidate: false,
  });
  assert.equal(bypass, false);
});

test("profile building can use a deterministic conversational question", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({
      topic_type: "general_request",
      topic_locked: false,
      interaction_mode: "profile_building",
    }),
    dialogueAct: "other",
    hasDeterministicCandidate: true,
  });

  assert.equal(bypass, true);
});

test("relational chat can use a deterministic direct answer", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({
      topic_type: "general_request",
      topic_locked: false,
      interaction_mode: "relational_chat",
    }),
    dialogueAct: "user_question",
    hasDeterministicCandidate: true,
  });

  assert.equal(bypass, true);
});

test("non-hard-locked task execution does not bypass the model without a scaffold", () => {
  const bypass = shouldBypassModelForSceneTurn({
    sceneState: sceneStatePatch({
      topic_type: "task_execution",
      topic_locked: true,
      interaction_mode: "task_execution",
      task_hard_lock_active: false,
    }),
    dialogueAct: "user_question",
    hasDeterministicCandidate: false,
  });

  assert.equal(bypass, false);
});
