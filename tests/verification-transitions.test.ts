import test from "node:test";
import assert from "node:assert/strict";

import { buildVerificationContinuation } from "../lib/session/verification-transitions.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
  noteSceneVerificationResult,
} from "../lib/session/scene-state.ts";

test("verification continuation returns to reward negotiation", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneVerificationResult(state, "presence:pass confidence=0.90 summary=User detected.");

  const line = buildVerificationContinuation(state, {
    checkType: "presence",
    status: "pass",
  });

  assert.match(line, /Stay in frame and keep your face forward/i);
  assert.match(line, /Now state what happens if you win/i);
});

test("verification continuation uses head turn specific follow-up", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });
  state = noteSceneVerificationResult(state, "head_turn:pass confidence=0.86 summary=Turn complete.");

  const line = buildVerificationContinuation(state, {
    checkType: "head_turn",
    status: "pass",
  });

  assert.match(line, /Face forward now and hold center/i);
  assert.match(line, /I pick\./i);
  assert.match(line, /rock paper scissors streak|number hunt|math duel|number command|riddle lock/i);
});

test("verification continuation resumes a running game round", () => {
  const line = buildVerificationContinuation(
    {
      ...createSceneState(),
      topic_type: "verification_in_progress",
      topic_locked: true,
      topic_state: "open",
      resume_topic_type: "game_execution",
      resume_topic_locked: true,
      resume_topic_state: "open",
      game_template_id: "rps_streak",
      game_progress: "round_1",
    },
    { checkType: "presence", status: "pass" },
  );

  assert.match(line, /Stay in frame and keep your face forward/i);
  assert.match(line, /First throw now/i);
});

test("verification continuation auto-advances completed reward negotiation", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "lets play a game",
    act: "propose_activity",
    sessionTopic: null,
  });
  state = noteSceneStateUserTurn(state, {
    text: "the stakes are chastity. if i win you unlock it. if you win i wear it overnight",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneVerificationResult(state, "presence:pass confidence=0.90 summary=User detected.");

  const line = buildVerificationContinuation(state, {
    checkType: "presence",
    status: "pass",
  });

  assert.match(line, /The terms are locked in/i);
  assert.match(line, /We play now/i);
});

test("verification continuation auto-advances completed task terms", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "i want a challenge",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneStateUserTurn(state, {
    text: "reward is an extra free day. if i fail i lose the reward",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneVerificationResult(state, "presence:pass confidence=0.90 summary=User detected.");

  const line = buildVerificationContinuation(state, {
    checkType: "presence",
    status: "pass",
  });

  assert.match(line, /The task terms are locked in/i);
  assert.match(line, /Now ask for the task or wait for my assignment/i);
});

test("verification continuation resumes task negotiation with a clarifying question when the spec is still vague", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "give me a task",
    act: "task_request",
    sessionTopic: null,
  });
  state = noteSceneVerificationResult(state, "presence:pass confidence=0.90 summary=User detected.");

  const line = buildVerificationContinuation(state, {
    checkType: "presence",
    status: "pass",
  });

  assert.doesNotMatch(line, /Here is your task/i);
  assert.match(line, /What kind of task do you want this to be/i);
});

test("verification continuation resumes task execution follow-up", () => {
  const line = buildVerificationContinuation(
    {
      ...createSceneState(),
      topic_type: "verification_in_progress",
      topic_locked: true,
      topic_state: "open",
      resume_topic_type: "task_execution",
      resume_topic_locked: true,
      resume_topic_state: "open",
      task_progress: "secured",
    },
    { checkType: "presence", status: "pass" },
  );

  assert.match(line, /Stay in frame and keep your face forward/i);
  assert.match(line, /Check in once halfway through/i);
});

test("scene state restores prior topic after a verification reply resolves", () => {
  let state = createSceneState();
  state = noteSceneStateUserTurn(state, {
    text: "the stakes are chastity",
    act: "other",
    sessionTopic: null,
  });
  state = noteSceneVerificationResult(state, "presence:pass confidence=0.90 summary=User detected.");

  const restored = noteSceneStateAssistantTurn(state, {
    text: "Good. I have you in frame. User detected in frame. We continue. Now finish locking the stakes before you move on.",
    topicResolved: true,
  });

  assert.equal(restored.topic_type, "reward_negotiation");
  assert.equal(restored.resume_topic_type, "none");
  assert.equal(restored.topic_locked, false);
});
