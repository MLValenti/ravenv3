import test from "node:test";
import assert from "node:assert/strict";

import { classifyUserIntent } from "../lib/session/intent-router.ts";
import { classifyDialogueRoute } from "../lib/dialogue/router.ts";
import {
  buildShortClarificationReply,
  detectShortFollowUpKind,
  isShortClarificationTurn,
} from "../lib/session/short-follow-up.ts";

test("short follow-up helper detects terse clarification turns", () => {
  assert.equal(isShortClarificationTurn("what?"), true);
  assert.equal(isShortClarificationTurn("why?"), true);
  assert.equal(isShortClarificationTurn("what do you mean?"), true);
  assert.equal(isShortClarificationTurn("go on"), true);
  assert.equal(detectShortFollowUpKind("what?"), "what");
  assert.equal(detectShortFollowUpKind("go on"), "go_on");
});

test("short follow-up intent typing stays out of generic question and answer buckets", () => {
  assert.equal(classifyUserIntent("what?", false), "user_short_follow_up");
  assert.equal(classifyUserIntent("what do you mean?", false), "user_short_follow_up");
});

test("short follow-up dialogue routing is explicit and traceable", () => {
  const routed = classifyDialogueRoute({
    text: "what do you mean?",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  assert.equal(routed.act, "short_follow_up");
});

test("short clarification reply stays single-family in open chat", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "normal_chat",
    topicType: "general_request",
  });
  assert.match(reply, /i mean|point i just made|last point/i);
  assert.doesNotMatch(reply, /first move|pacing|end point first/i);
  assert.doesNotMatch(reply, /my little pet returns/i);
});

test("short clarification reply uses recent question context when available", () => {
  const reply = buildShortClarificationReply({
    userText: "what?",
    interactionMode: "question_answering",
    topicType: "general_request",
    lastQuestion: "what is aftercare",
  });
  assert.match(reply, /aftercare/i);
  assert.doesNotMatch(reply, /what do you want from this|speak plainly\. what do you want/i);
});

test("short clarification reply uses a grounded prior anchor instead of weak filler wording", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "question_answering",
    topicType: "general_request",
    lastAssistantText:
      "Yes. Stay with control. That is the point where it stops being an image and starts asking something real of the people inside it.",
  });

  assert.match(reply, /i mean control/i);
  assert.doesNotMatch(reply, /part about stay|part about good|part about image/i);
});

test("short clarification reply paraphrases the prior assistant question instead of anchoring on question filler", () => {
  const reply = buildShortClarificationReply({
    userText: "what?",
    interactionMode: "profile_building",
    topicType: "general_request",
    lastAssistantText: "What should I call you when I am speaking to you directly?",
  });

  assert.match(reply, /the name you want me to use/i);
  assert.doesNotMatch(reply, /part about should|part about speaking|part about directly/i);
});

test("short clarification reply rejects weak imperative anchors like tell", () => {
  const reply = buildShortClarificationReply({
    userText: "what?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText: "Tell me one thing people usually miss about you.",
    lastUserAnswer: "thinking about what i can do for you",
  });

  assert.match(reply, /what people usually miss about you|what you can do for me/i);
  assert.doesNotMatch(reply, /part about tell|stay with tell/i);
});

test("short clarification reply keeps semantic focus on what people usually miss about you", () => {
  const reply = buildShortClarificationReply({
    userText: "why?",
    interactionMode: "profile_building",
    topicType: "general_request",
    lastAssistantText: "I mean what people usually miss about you, and I will keep it in mind.",
  });

  assert.match(reply, /what people usually miss about you|first answer people reach for/i);
  assert.doesNotMatch(reply, /part about usually/i);
});

test("short go-on reply builds the thread instead of collapsing to a bare acknowledgment", () => {
  const reply = buildShortClarificationReply({
    userText: "go on",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText:
      "Yes. Being trained by me in a way that actually changes you is where it stops being an image and starts asking something real.",
  });

  assert.match(reply, /being trained by me|actually change for you|keep going|concrete part/i);
  assert.doesNotMatch(reply, /^good\.?$/i);
  assert.doesNotMatch(reply, /safe version|costing something|decorative/i);
});

test("short clarification reply keeps semantic focus on training instead of weak modal verbs", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText:
      "Yes. Being trained by me in a way that actually changes you is where it stops being an image and starts asking something real.",
  });

  assert.match(reply, /being trained by me/i);
  assert.doesNotMatch(reply, /part about would|part about could|part about should/i);
});

test("short clarification reply keeps semantic focus on steadiness instead of weak helper words", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText:
      "Be useful in a real way. Attention, follow-through, honesty, and enough steadiness that I do not have to drag clarity out of you.",
  });

  assert.match(reply, /attention, follow-through, honesty, and steadiness/i);
  assert.doesNotMatch(reply, /part about would|part about makes|part about sounds/i);
});

test("short go-on reply does not promote weak verb anchors like keep or happens", () => {
  const reply = buildShortClarificationReply({
    userText: "go on",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText: "Keep going on what happens there first.",
  });

  assert.match(reply, /concrete part|wording around it/i);
  assert.doesNotMatch(reply, /tell me more about keep|tell me more about happens/i);
});

test("short clarification reply does not literalize malformed answer fragments into profile-thread anchors", () => {
  const reply = buildShortClarificationReply({
    userText: "what?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText: "Keep going. Tell me the concrete part.",
    lastUserAnswer: "happens what first",
  });

  assert.match(reply, /concrete part|last idea|point i just made|exactly what i gave you/i);
  assert.doesNotMatch(reply, /i mean happens|i mean keep|part about happens|part about keep/i);
});
