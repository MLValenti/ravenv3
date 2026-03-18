import test from "node:test";
import assert from "node:assert/strict";

import { buildBehaviorPackSystemMessages } from "../lib/chat/behavior-pack.ts";

test("behavior pack emits style bible and selected playbooks", () => {
  const messages = buildBehaviorPackSystemMessages({
    toneProfile: "dominant",
    dialogueAct: "answer_question",
    sessionPhase: "game_execution",
  });
  const joined = messages.join("\n");
  assert.match(joined, /Behavior pack version:/i);
  assert.match(joined, /Style bible:/i);
  assert.match(joined, /Selected playbooks:/i);
  assert.match(joined, /Playbook: question_resolution/i);
  assert.match(joined, /Playbook: game_followthrough/i);
});

test("behavior pack selects task playbook for task phase", () => {
  const messages = buildBehaviorPackSystemMessages({
    toneProfile: "neutral",
    dialogueAct: "acknowledge",
    sessionPhase: "task_execution",
  });
  const joined = messages.join("\n");
  assert.match(joined, /Playbook: task_followthrough/i);
});
