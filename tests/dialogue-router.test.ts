import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDialogueRoute,
  isTopicUnresolved,
} from "../lib/dialogue/router.ts";

test("game selection stays on topic across turns", () => {
  const first = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  assert.equal(first.act, "propose_activity");
  assert.equal(first.nextTopic?.topic_type, "game_selection");
  assert.equal(isTopicUnresolved(first.nextTopic), true);

  const second = classifyDialogueRoute({
    text: "you pick",
    awaitingUser: false,
    currentTopic: first.nextTopic,
    nowMs: 2_000,
  });
  assert.equal(second.act, "answer_activity_choice");
  assert.equal(second.nextTopic?.topic_type, "game_selection");
});

test("short clarification takes priority over unresolved topic", () => {
  const topic = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  }).nextTopic;

  const routed = classifyDialogueRoute({
    text: "what do you mean",
    awaitingUser: false,
    currentTopic: topic,
    nowMs: 2_000,
  });

  assert.equal(routed.act, "short_follow_up");
});

test("task request and duration request are classified directly", () => {
  const task = classifyDialogueRoute({
    text: "give me a task",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  assert.equal(task.act, "task_request");

  const duration = classifyDialogueRoute({
    text: "how long do I have to wear it, hours or minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 2_000,
  });
  assert.equal(duration.act, "duration_request");
});

test("router handles paraphrased task and duration requests", () => {
  const task = classifyDialogueRoute({
    text: "can you set me a new challenge to follow",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 3_000,
  });
  assert.equal(task.act, "task_request");

  const duration = classifyDialogueRoute({
    text: "for how much time should i keep it on",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_000,
  });
  assert.equal(duration.act, "duration_request");
});

test("router treats ready for a new task phrasing as a task request", () => {
  const task = classifyDialogueRoute({
    text: "I'm ready for a new task. What should I do next?",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_500,
  });

  assert.equal(task.act, "task_request");
});

test("router treats bare task replacement and duration revision cues as task operations", () => {
  const replacement = classifyDialogueRoute({
    text: "different task",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_750,
  });
  assert.equal(replacement.act, "task_request");

  const revision = classifyDialogueRoute({
    text: "make it 20 minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_800,
  });
  assert.equal(revision.act, "duration_request");
});

test("router keeps task suggestion questions on the task rail", () => {
  const routed = classifyDialogueRoute({
    text: "what kind of anal task would be good for 30 minutes",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_900,
  });

  assert.equal(routed.act, "task_request");
});

test("router keeps task proof and rationale follow-ups on the task rail", () => {
  const rationale = classifyDialogueRoute({
    text: "what would that prove?",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_950,
  });
  assert.equal(rationale.act, "user_question");

  const proof = classifyDialogueRoute({
    text: "do i need proof?",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_975,
  });
  assert.equal(proof.act, "user_question");

  const depth = classifyDialogueRoute({
    text: "how deep?",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 4_990,
  });
  assert.equal(depth.act, "user_question");
});

test("router handles paraphrased game proposal and delegation", () => {
  const first = classifyDialogueRoute({
    text: "wanna run a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 5_000,
  });
  assert.equal(first.act, "propose_activity");

  const second = classifyDialogueRoute({
    text: "dealers choice",
    awaitingUser: false,
    currentTopic: first.nextTopic,
    nowMs: 6_000,
  });
  assert.equal(second.act, "answer_activity_choice");
});

test("bet request does not get misclassified as a game choice while game selection is open", () => {
  const first = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  const second = classifyDialogueRoute({
    text: "lets bet on the game",
    awaitingUser: false,
    currentTopic: first.nextTopic,
    nowMs: 2_000,
  });

  assert.notEqual(second.act, "answer_activity_choice");
});

test("game rules question opens a game selection topic for the next answer", () => {
  const routed = classifyDialogueRoute({
    text: "how do we play",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 7_000,
  });

  assert.equal(routed.act, "user_question");
  assert.equal(routed.nextTopic?.topic_type, "game_selection");
});
