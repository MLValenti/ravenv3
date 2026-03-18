import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTaskCandidatesFromSpec,
  createTaskSpec,
  noteTaskSpecUserTurn,
  selectTaskCandidate,
} from "../lib/session/task-spec.ts";
import { evaluateTaskSpecTranscript } from "../lib/session/task-spec-eval.ts";

test("task transcript eval scores novelty, naturalness, and constraint influence", () => {
  const userText =
    "give me a hard 30 minute posture task, pair it with stillness, and make me check in halfway";
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText,
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText,
    taskHistory: [
      {
        title: "Posture hold task",
        description: "Stand tall for 30 minutes and report back at the end.",
        repeats_required: 1,
      },
    ],
  });
  const selected = selectTaskCandidate(candidates);
  assert.ok(selected);

  const result = evaluateTaskSpecTranscript({
    transcript: [
      { role: "user", text: "give me a task" },
      { role: "raven", text: "Where do you want the pressure: posture, stillness, frame, hands, or device?" },
      { role: "user", text: userText },
      { role: "raven", text: selected?.plan.assignmentText ?? "" },
      { role: "raven", text: `It fits because ${selected?.why_it_fits ?? ""}.` },
    ],
    selectedCandidate: selected!,
    userConstraintText: userText,
  });

  assert.ok(result.novelty > 0.34);
  assert.ok(result.naturalness >= 0.45);
  assert.ok(result.repetition >= 0.5);
  assert.ok(result.constraintInfluence > 0.2);
});
