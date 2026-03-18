import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackCreateTaskRequest,
  isTaskRequestMessage,
  looksLikeFinalTaskAssignmentText,
  looksLikeTaskAssignmentText,
} from "../lib/tasks/task-request-fallback.ts";

test("task fallback detects task request language", () => {
  assert.equal(isTaskRequestMessage("give me a task"), true);
  assert.equal(isTaskRequestMessage("assign me something"), false);
});

test("task fallback detects assistant assignment phrasing", () => {
  assert.equal(looksLikeTaskAssignmentText("Here is your task: Hold for 30 minutes and report back."), true);
  assert.equal(looksLikeTaskAssignmentText("Interesting idea, tell me more."), false);
});

test("task fallback only accepts final task issuance text for persistence", () => {
  assert.equal(
    looksLikeFinalTaskAssignmentText(
      "Listen carefully, pet. Here is your task: Hold posture for 30 minutes and report back when done. Start now.",
    ),
    true,
  );
  assert.equal(
    looksLikeFinalTaskAssignmentText(
      "Listen carefully, pet. Next step: complete the current checkpoint and report back cleanly.",
    ),
    false,
  );
  assert.equal(
    looksLikeFinalTaskAssignmentText("What kind of task do you want this to be: posture or device?"),
    false,
  );
});

test("task fallback builds a valid one-time request with parsed duration and repeats", () => {
  const request = buildFallbackCreateTaskRequest({
    userText: "give me a chastity task for 30 minutes and 2 repeats",
    assistantText: "Here is your task. Start now and report back.",
    allowedCheckTypes: ["presence", "object_present"],
  });

  assert.equal(request.type, "create_task");
  assert.match(request.title.toLowerCase(), /chastity/);
  assert.equal(request.repeats_required, 2);
  assert.equal(request.per_repeat_timeout_seconds, 30 * 60);
  assert.equal(request.window_seconds, 30 * 60 * 2);
  assert.equal(request.evidence.required, true);
});
