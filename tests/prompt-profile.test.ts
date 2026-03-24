import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseVoicePromptProfile,
  shouldIncludeResponseStrategyPromptBlock,
  shouldIncludeTaskRuntimePromptBlocks,
} from "../lib/chat/prompt-profile.ts";

test("voice-first relational chat turns use the minimal voice prompt profile", () => {
  for (const text of [
    "good evening",
    "how can i be useful?",
    "what do you want?",
    "what do you mean?",
    "tell me something real",
  ]) {
    assert.equal(
      chooseVoicePromptProfile({
        plannerEnabled: false,
        sessionMode: false,
        promptRouteMode:
          text === "good evening"
            ? "fresh_greeting"
            : text === "what do you mean?"
              ? "relational_direct"
              : "default",
        latestUserMessage: text,
        currentMode: "normal_chat",
      }),
      "minimal_voice_chat",
      text,
    );
  }
});

test("task and execution-heavy turns keep the full prompt profile", () => {
  for (const text of [
    "give me a task",
    "make it 10 minutes",
    "verify this",
    "what does the camera see?",
  ]) {
    assert.equal(
      chooseVoicePromptProfile({
        plannerEnabled: false,
        sessionMode: false,
        promptRouteMode: "default",
        latestUserMessage: text,
        currentMode: "task_execution",
      }),
      "full",
      text,
    );
  }
});

test("ordinary chat turns do not include task or runtime prompt blocks", () => {
  for (const input of [
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "hi",
      promptRouteMode: "fresh_greeting" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "question_answering",
      sessionPhase: "chat",
      latestUserMessage: "what should our session be about?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "relational_chat",
      sessionPhase: "chat",
      latestUserMessage: "i want to talk",
      promptRouteMode: "default" as const,
    },
  ]) {
    assert.equal(shouldIncludeTaskRuntimePromptBlocks(input), false, input.latestUserMessage);
  }
});

test("active task and execution turns still include task and runtime prompt blocks", () => {
  for (const input of [
    {
      plannerEnabled: false,
      currentMode: "task_execution",
      sessionPhase: "task",
      latestUserMessage: "okay what do i do first?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "locked_task_execution",
      sessionPhase: "challenge",
      latestUserMessage: "done",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "game",
      sessionPhase: "game",
      latestUserMessage: "how do we play?",
      promptRouteMode: "default" as const,
    },
  ]) {
    assert.equal(shouldIncludeTaskRuntimePromptBlocks(input), true, input.latestUserMessage);
  }
});

test("device and capability relevant turns still include the needed runtime prompt blocks", () => {
  for (const input of [
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "what does the camera see?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "question_answering",
      sessionPhase: "verification",
      latestUserMessage: "verify this",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "use the device",
      promptRouteMode: "default" as const,
    },
  ]) {
    assert.equal(shouldIncludeTaskRuntimePromptBlocks(input), true, input.latestUserMessage);
  }
});

test("ordinary open-conversation turns exclude the response-strategy prompt block", () => {
  for (const input of [
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "hi",
      promptRouteMode: "fresh_greeting" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "what should our session be about?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "tell me more about that",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "question_answering",
      sessionPhase: "chat",
      latestUserMessage: "okay do we start now?",
      promptRouteMode: "default" as const,
    },
  ]) {
    assert.equal(
      shouldIncludeResponseStrategyPromptBlock(input),
      false,
      input.latestUserMessage,
    );
  }
});

test("structured, task, game, verification, and repair turns still include the response-strategy prompt block", () => {
  for (const input of [
    {
      plannerEnabled: false,
      currentMode: "task_execution",
      sessionPhase: "task",
      latestUserMessage: "okay what do i do first?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "game",
      sessionPhase: "game",
      latestUserMessage: "how do we play?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "question_answering",
      sessionPhase: "verification",
      latestUserMessage: "what can you see?",
      promptRouteMode: "default" as const,
    },
    {
      plannerEnabled: false,
      currentMode: "normal_chat",
      sessionPhase: "chat",
      latestUserMessage: "what do you mean?",
      promptRouteMode: "relational_direct" as const,
    },
  ]) {
    assert.equal(
      shouldIncludeResponseStrategyPromptBlock(input),
      true,
      input.latestUserMessage,
    );
  }
});
