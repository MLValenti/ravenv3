import test from "node:test";
import assert from "node:assert/strict";

import {
  createConversationStateSnapshot,
  noteConversationAssistantTurn,
  noteConversationUserTurn,
} from "../lib/chat/conversation-state.ts";
import { createSceneState } from "../lib/session/scene-state.ts";
import { reconcileSceneStateWithConversation } from "../lib/session/conversation-runtime.ts";

test("conversation runtime clears stale soft task residue when the conversation moves to a direct relational question", () => {
  let conversation = createConversationStateSnapshot("conversation-runtime-soft-task-clear");
  conversation = noteConversationUserTurn(conversation, {
    text: "what is your favorite color?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });
  conversation = noteConversationAssistantTurn(conversation, {
    text: "Black. Clean, severe, and impossible to soften by accident.",
    ravenIntent: "respond",
    nowMs: 2,
  });

  const reconciled = reconcileSceneStateWithConversation(
    {
      ...createSceneState(),
      topic_type: "task_negotiation",
      topic_locked: false,
      topic_state: "open",
      interaction_mode: "task_planning",
      scene_type: "task",
      agreed_goal: "choose a task",
      user_requested_task_domain: "frame",
      can_replan_task: true,
      reason_for_lock: "waiting for duration",
      task_paused: true,
      current_rule: "stay in task negotiation",
      current_subtask: "pick duration",
      next_expected_user_action: "answer with a duration",
    },
    conversation,
  );

  assert.equal(reconciled.interaction_mode, "relational_chat");
  assert.equal(reconciled.topic_type, "general_request");
  assert.equal(reconciled.topic_locked, false);
  assert.equal(reconciled.scene_type, "conversation");
  assert.equal(reconciled.user_requested_task_domain, "none");
  assert.equal(reconciled.can_replan_task, false);
});

test("conversation runtime preserves hard structured scene ownership", () => {
  const conversation = noteConversationUserTurn(createConversationStateSnapshot("conversation-runtime-hard-scene"), {
    text: "what is your favorite color?",
    userIntent: "user_question",
    routeAct: "user_question",
    nowMs: 1,
  });

  const scene = {
    ...createSceneState(),
    topic_type: "task_execution" as const,
    topic_locked: true,
    interaction_mode: "task_execution" as const,
    task_hard_lock_active: true,
    current_rule: "hold posture for ten minutes",
  };
  const reconciled = reconcileSceneStateWithConversation(scene, conversation);

  assert.deepEqual(reconciled, scene);
});
