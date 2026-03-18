import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveTaskRequestFromAssistantOutput,
  shouldNoopForNoNewUserMessage,
  type ChatMessageLike,
} from "../lib/chat/session-contract.ts";
import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import { buildSceneScaffoldReply } from "../lib/session/scene-scaffolds.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
} from "../lib/session/scene-state.ts";
import {
  canEmitAssistant,
  createTurnGate,
  markAssistantEmitted,
  persistUserMessage,
} from "../lib/session/turn-gate.ts";

test("session contract noops when last message is assistant and no new user turn", () => {
  const messages: ChatMessageLike[] = [
    { role: "system", content: "Turn routing: ..." },
    { role: "assistant", content: "Previous response." },
  ];
  assert.equal(
    shouldNoopForNoNewUserMessage({
      messages,
      sessionMode: true,
      plannerEnabled: false,
    }),
    true,
  );
});

test("session contract does not noop when a new user turn exists", () => {
  const messages: ChatMessageLike[] = [
    { role: "assistant", content: "Previous response." },
    { role: "user", content: "give me a task" },
  ];
  assert.equal(
    shouldNoopForNoNewUserMessage({
      messages,
      sessionMode: true,
      plannerEnabled: false,
    }),
    false,
  );
});

test("session contract resolves fallback task request from plain assignment text", () => {
  const request = resolveTaskRequestFromAssistantOutput({
    sessionMode: true,
    lastUserText: "give me a chastity task for 30 minutes",
    shapedText:
      "Listen carefully, pet. Here is your task: Keep the device on for 30 minutes, check in once halfway through, and report back when it is done. Start now.",
    allowedCheckTypes: ["presence", "head_turn"],
  });
  assert.ok(request);
  assert.equal(request?.type, "create_task");
  assert.match((request?.title ?? "").toLowerCase(), /chastity/);
  assert.equal(request?.repeats_required, 1);
});

test("session contract does not resolve task creation from clarifying or checkpoint text", () => {
  const clarifying = resolveTaskRequestFromAssistantOutput({
    sessionMode: true,
    lastUserText: "give me a device task",
    shapedText: "What items are actually available right now so I do not build the wrong task?",
    allowedCheckTypes: ["presence", "head_turn"],
  });
  const checkpoint = resolveTaskRequestFromAssistantOutput({
    sessionMode: true,
    lastUserText: "give me a task",
    shapedText:
      "Listen carefully, pet. Next step: complete the current checkpoint and report back cleanly.",
    allowedCheckTypes: ["presence", "head_turn"],
  });

  assert.equal(clarifying, null);
  assert.equal(checkpoint, null);
});

test("session harness game plus wager stays coherent and emits exactly one assistant turn per user turn", () => {
  let gate = createTurnGate("contract-game-harness");
  let scene = createSceneState();

  const userTurns = [
    "lets play a game",
    "lets bet on the game",
    "the stakes are chastity",
    "if i win you tell me a truth",
    "if you win i wear it overnight",
    "you pick",
    "lock",
    "nerve",
  ];

  for (const userText of userTurns) {
    const route = classifyDialogueRoute({
      text: userText,
      awaitingUser: false,
      currentTopic: scene.topic_locked
        ? {
            topic_type: scene.topic_type,
            topic_state: scene.topic_state,
            summary: scene.summary,
            created_at: Date.now(),
            topic_locked: scene.topic_locked,
          }
        : null,
      nowMs: Date.now(),
    });

    gate = persistUserMessage(gate, userText);
    scene = noteSceneStateUserTurn(scene, {
      text: userText,
      act: route.act,
      sessionTopic: route.nextTopic,
    });

    const assistantText =
      buildSceneScaffoldReply({
        act: route.act,
        userText,
        sceneState: scene,
      }) ?? "No. Stay on task.";

    const decision = canEmitAssistant(gate, `contract-step-${gate.stepIndex}`, assistantText);
    assert.equal(decision.allow, true);
    gate = markAssistantEmitted(gate, {
      stepId: `contract-step-${gate.stepIndex}`,
      content: assistantText,
      isQuestion: assistantText.includes("?"),
    });
    scene = noteSceneStateAssistantTurn(scene, { text: assistantText });
  }

  assert.match(scene.stakes.toLowerCase(), /chastity/);
  assert.match(scene.win_condition.toLowerCase(), /tell me a truth/);
  assert.match(scene.lose_condition.toLowerCase(), /wear it overnight/);
  assert.equal(scene.scene_type, "game");
});
