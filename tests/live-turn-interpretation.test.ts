import test from "node:test";
import assert from "node:assert/strict";

import { classifyCoreConversationMove } from "../lib/chat/core-turn-move.ts";
import { selectDialogueAct } from "../lib/chat/conversation-quality.ts";
import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import {
  classifyRouteActForState,
  interpretLiveRouteTurn,
} from "../lib/chat/live-turn-interpretation.ts";
import { classifyUserIntent } from "../lib/session/intent-router.ts";

function buildInput(lastUserMessage: string) {
  return {
    lastUserMessage,
    awaitingUser: false,
    userAnswered: false,
    verificationJustCompleted: false,
    sessionPhase: "chat",
    previousAssistantMessage: "I said the part that matters is whether it changes you.",
    currentTopic: "consistency under pressure",
  };
}

test("live turn interpretation normalizes latest turn signals from shared classifiers", () => {
  const input = buildInput("what do you mean");
  const interpretation = interpretLiveRouteTurn(input);

  assert.equal(interpretation.dialogueAct, selectDialogueAct(input));
  assert.equal(interpretation.latestUserIntent, classifyUserIntent(input.lastUserMessage, false));
  assert.equal(
    interpretation.latestRouteAct,
    classifyDialogueRoute({
      text: input.lastUserMessage,
      awaitingUser: false,
      currentTopic: null,
      nowMs: Date.now(),
    }).act,
  );
  assert.equal(
    interpretation.latestCoreConversationMove,
    classifyCoreConversationMove({
      userText: input.lastUserMessage,
      previousAssistantText: input.previousAssistantMessage,
      currentTopic: input.currentTopic,
    }),
  );
  assert.ok(interpretation.latestRouteReason.length > 0);
});

test("live turn interpretation exposes state classifiers with unchanged behavior", () => {
  const interpretation = interpretLiveRouteTurn(buildInput("make it 10 minutes"));
  const text = "different task";

  assert.equal(
    interpretation.classifyUserIntentForState(text, false),
    classifyUserIntent(text, false),
  );
  assert.equal(
    interpretation.classifyRouteActForState(text, false),
    classifyDialogueRoute({
      text,
      awaitingUser: false,
      currentTopic: null,
      nowMs: Date.now(),
    }).act,
  );
  assert.equal(
    interpretation.classifyRouteActForState(text, false),
    classifyRouteActForState(text, false),
  );
});

test("live turn interpretation preserves empty-turn defaults and null core move", () => {
  const interpretation = interpretLiveRouteTurn(buildInput(""));

  assert.equal(interpretation.latestCoreConversationMove, null);
  assert.equal(interpretation.latestUserIntent, "user_ack");
  assert.equal(interpretation.latestRouteAct, "acknowledgement");
});
