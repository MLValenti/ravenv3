import test from "node:test";
import assert from "node:assert/strict";

import {
  hasTaskEscalationSignal,
  scoreDialogueIntentSignals,
} from "../lib/dialogue/intent-score.ts";

test("intent scoring recognizes paraphrased game and choice signals", () => {
  const game = scoreDialogueIntentSignals("wanna run a game");
  assert.ok(game.proposeActivity.score >= 1.6);

  const choice = scoreDialogueIntentSignals("dealer's choice");
  assert.ok(choice.answerActivityChoice.score >= 1.1);
});

test("intent scoring recognizes paraphrased task and duration requests", () => {
  const task = scoreDialogueIntentSignals("can you set me a challenge for tonight");
  assert.ok(task.taskRequest.score >= 1.8);

  const duration = scoreDialogueIntentSignals("for how much time should i keep it on");
  assert.ok(duration.durationRequest.score >= 1.6);
});

test("intent scoring catches task escalation variants", () => {
  assert.equal(hasTaskEscalationSignal("give me something else to do"), true);
  assert.equal(hasTaskEscalationSignal("what else now"), true);
  assert.equal(hasTaskEscalationSignal("keep going"), false);
});
