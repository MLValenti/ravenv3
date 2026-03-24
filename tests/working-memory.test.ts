import test from "node:test";
import assert from "node:assert/strict";

import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import {
  buildWorkingMemoryBlock,
  createWorkingMemory,
  getStartedProposalFlowGuidance,
  isProposalAcceptanceCue,
  normalizeWorkingMemory,
  noteWorkingMemoryAssistantTurn,
  noteWorkingMemoryUserTurn,
  resolveWorkingMemoryContinuityTopic,
  shouldPreferFreshWorkingMemoryContinuity,
  shouldUseStartedProposalFlowGuidance,
} from "../lib/session/working-memory.ts";

test("working memory tracks unresolved topic and commitment", () => {
  let memory = createWorkingMemory();
  const routed = classifyDialogueRoute({
    text: "lets play a game",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });

  memory = noteWorkingMemoryUserTurn(memory, {
    text: "lets play a game",
    act: routed.act,
    nextTopic: routed.nextTopic,
  });
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "resolve the game choice before changing topics",
    topicResolved: false,
  });

  const block = buildWorkingMemoryBlock(memory);
  assert.match(block, /Topic: game_selection:open/i);
  assert.match(block, /Last user request: lets play a game/i);
  assert.match(block, /Next commitment: resolve the game choice/i);
});

test("working memory rolling summary updates over user turns", () => {
  let memory = createWorkingMemory();
  for (let index = 0; index < 4; index += 1) {
    memory = noteWorkingMemoryUserTurn(memory, {
      text: `request ${index + 1}`,
      act: "other",
      nextTopic: null,
    });
  }

  assert.doesNotMatch(memory.rolling_summary, /No recent summary yet/i);
  assert.match(memory.rolling_summary, /User asked:/i);
});

test("working memory tracks pending unaccepted assistant proposals and fresh questions", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "Here is your task. Start now and report back cleanly.",
    topicResolved: false,
  });
  memory = noteWorkingMemoryUserTurn(memory, {
    text: "what should our session be about?",
    act: "user_question",
    nextTopic: null,
  });

  assert.equal(memory.pending_proposal_kind, "task");
  assert.equal(memory.session_started, false);
  assert.equal(memory.current_unresolved_question, "what should our session be about?");
  assert.equal(memory.last_assistant_action, "propose_task");
  assert.equal(resolveWorkingMemoryContinuityTopic(memory), "what should our session be about?");
  assert.equal(
    shouldPreferFreshWorkingMemoryContinuity({
      memory,
      latestUserText: "what should our session be about?",
      dialogueAct: "user_question",
    }),
    true,
  );
});

test("working memory pending unaccepted proposal also releases greetings", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "Here is your task. Start now and report back cleanly.",
    topicResolved: false,
  });

  assert.equal(
    shouldPreferFreshWorkingMemoryContinuity({
      memory,
      latestUserText: "hi",
      dialogueAct: "other",
    }),
    true,
  );
});

test("working memory clears pending proposal after acceptance and active flow stays normal", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "Here is your task. Start now and report back cleanly.",
    topicResolved: false,
  });
  memory = noteWorkingMemoryUserTurn(memory, {
    text: "ok",
    act: "acknowledgement",
    nextTopic: null,
  });

  assert.equal(memory.session_started, true);
  assert.equal(memory.pending_proposal_kind, "none");
  assert.equal(
    shouldPreferFreshWorkingMemoryContinuity({
      memory,
      latestUserText: "how long should it be?",
      dialogueAct: "user_question",
    }),
    false,
  );
});

test("pending task proposal plus yes start sets session started true", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "Here is your task. Hold still for 10 minutes and report back cleanly.",
    topicResolved: false,
  });
  memory = noteWorkingMemoryUserTurn(memory, {
    text: "yes, start",
    act: "other",
    nextTopic: null,
  });

  assert.equal(isProposalAcceptanceCue("yes, start"), true);
  assert.equal(memory.session_started, true);
  assert.equal(memory.pending_proposal_kind, "none");
  assert.equal(memory.pending_proposal_summary, "");
});

test("pending session flow proposal plus lets begin sets session started true", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "This session should be about what you actually want tonight.",
    topicResolved: false,
  });
  memory = noteWorkingMemoryUserTurn(memory, {
    text: "let's begin",
    act: "other",
    nextTopic: null,
  });

  assert.equal(memory.session_started, true);
  assert.equal(memory.pending_proposal_kind, "none");
});

test("plain yes with no pending proposal does not falsely start a flow", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryUserTurn(memory, {
    text: "yes",
    act: "acknowledgement",
    nextTopic: null,
  });

  assert.equal(memory.session_started, false);
  assert.equal(memory.pending_proposal_kind, "none");
});

test("after acceptance what do i do first uses started-flow guidance instead of pending negotiation", () => {
  let memory = createWorkingMemory();
  memory = noteWorkingMemoryAssistantTurn(memory, {
    commitment: "Here is your task. Hold still for 10 minutes and report back cleanly.",
    topicResolved: false,
  });
  memory = noteWorkingMemoryUserTurn(memory, {
    text: "yes, start",
    act: "other",
    nextTopic: null,
  });

  assert.equal(
    shouldUseStartedProposalFlowGuidance({
      memory,
      latestUserText: "okay what do I do first?",
      dialogueAct: "user_question",
    }),
    true,
  );
  assert.match(getStartedProposalFlowGuidance(memory) ?? "", /here is your task|hold still/i);
});

test("working memory normalization preserves the new explicit continuity fields", () => {
  const memory = normalizeWorkingMemory({
    current_unresolved_question: "what are we doing?",
    session_started: false,
    pending_proposal_kind: "session_flow",
    pending_proposal_summary: "We can start with what you actually want tonight.",
    negotiated_topic: "what the session should be about",
    last_assistant_action: "propose_session_flow",
  });

  assert.equal(memory.current_unresolved_question, "what are we doing?");
  assert.equal(memory.pending_proposal_kind, "session_flow");
  assert.equal(memory.negotiated_topic, "what the session should be about");
  assert.equal(memory.last_assistant_action, "propose_session_flow");
});
