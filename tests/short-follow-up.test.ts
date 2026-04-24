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
  assert.equal(isShortClarificationTurn("tell me more"), true);
  assert.equal(detectShortFollowUpKind("what?"), "what");
  assert.equal(detectShortFollowUpKind("go on"), "go_on");
  assert.equal(detectShortFollowUpKind("tell me more"), "go_on");
});

test("short follow-up intent typing stays out of generic question and answer buckets", () => {
  assert.equal(classifyUserIntent("what?", false), "user_short_follow_up");
  assert.equal(classifyUserIntent("what do you mean?", false), "user_short_follow_up");
  assert.equal(classifyUserIntent("tell me more", false), "user_short_follow_up");
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

test("tell me more routes as a short follow-up instead of generic question answering", () => {
  const routed = classifyDialogueRoute({
    text: "tell me more",
    awaitingUser: false,
    currentTopic: null,
    nowMs: 1_000,
  });
  assert.equal(routed.act, "short_follow_up");
});

test("elaboration detail variants route as short follow-ups instead of answer continuations", () => {
  for (const text of ["in more detail", "in more details", "more detail", "more details", "explain more"]) {
    assert.equal(isShortClarificationTurn(text), true, text);
  }
  assert.equal(detectShortFollowUpKind("in more detail"), "go_on");
  assert.equal(detectShortFollowUpKind("in more details"), "go_on");
  assert.equal(detectShortFollowUpKind("more detail"), "go_on");
  assert.equal(detectShortFollowUpKind("more details"), "go_on");
  assert.equal(detectShortFollowUpKind("explain more"), "clarify");
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

test("short go-on reply stays on the training thread even when currentTopic is stale", () => {
  const reply = buildShortClarificationReply({
    userText: "go on",
    interactionMode: "relational_chat",
    topicType: "general_request",
    currentTopic: "what you can do for me",
    lastAssistantText:
      "Exactly. Wanting training is easy to say. Letting it change you is the harder part.",
  });

  assert.match(reply, /being trained by me|actually change in you|keep going|concrete part/i);
  assert.doesNotMatch(reply, /what you can actually do for me/i);
});

test("why stays on the trainability line even when currentTopic is stale", () => {
  const reply = buildShortClarificationReply({
    userText: "why?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    currentTopic: "what you can do for me",
    lastAssistantText:
      "Exactly. I need you honest enough for me to see where you hold and consistent enough that I can actually shape something.",
  });

  assert.match(reply, /honest enough|consistent enough|shape something|trainability/i);
  assert.doesNotMatch(reply, /what you can do for me|offer something real|sound eager/i);
});

test("what-do-you-mean stays on the attention usefulness real-change line", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    currentTopic: "what people usually miss about you",
    lastAssistantText:
      "Exactly. That question matters because it tells me whether you want attention, usefulness, or real change.",
  });

  assert.match(reply, /attention|usefulness|real change/i);
  assert.doesNotMatch(reply, /people usually miss about you/i);
});

test("go-on stays on person-versus-performance instead of stale usefulness", () => {
  const reply = buildShortClarificationReply({
    userText: "go on",
    interactionMode: "relational_chat",
    topicType: "general_request",
    currentTopic: "what you can do for me",
    lastAssistantText:
      "Exactly. That tells me very quickly whether I am dealing with a person or a performance.",
  });

  assert.match(reply, /person|performance|keep going|concrete part/i);
  assert.doesNotMatch(reply, /what you can actually do for me/i);
});

test("go-on stays on the work-pressure triad when the clarification used is-it phrasing", () => {
  const reply = buildShortClarificationReply({
    userText: "go on",
    interactionMode: "normal_chat",
    topicType: "general_request",
    currentTopic: "work",
    lastAssistantText: "I mean is it workload, a person, or a decision you keep circling.",
  });

  assert.match(reply, /pick one|three|workload|person|decision|thread/i);
  assert.doesNotMatch(reply, /fine\. say what you want|what you actually want|start talking/i);
});

test("what-do-you-mean stays on the work-pressure triad instead of a generic lead shell", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "normal_chat",
    topicType: "general_request",
    currentTopic: "work",
    lastAssistantText: "Good. Is it workload, a person, or a decision you keep circling?",
  });

  assert.match(reply, /workload|person|decision|keep circling/i);
  assert.doesNotMatch(reply, /fine\. say what you want|follow your lead|concrete part of open/i);
});

test("why stays on the confession line instead of stale usefulness", () => {
  const reply = buildShortClarificationReply({
    userText: "why?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    currentTopic: "what you can do for me",
    lastAssistantText:
      "If you do not usually say this out loud, then it already means something real. Now say the part you were trying not to say.",
  });

  assert.match(reply, /say this out loud|means something real|trying not to say/i);
  assert.doesNotMatch(reply, /what you can do for me|sound eager/i);
});

test("repeat stays on usefulness follow-through instead of stale profile topic", () => {
  const reply = buildShortClarificationReply({
    userText: "say that again",
    interactionMode: "relational_chat",
    topicType: "general_request",
    currentTopic: "what people usually miss about you",
    lastAssistantText:
      "Exactly. That only matters if you mean what you say and hold steady long enough for it to count.",
  });

  assert.match(reply, /mean what you say|hold steady|count/i);
  assert.doesNotMatch(reply, /people usually miss about you/i);
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
      "Usefulness is simple. Be clear, follow through, and stop making me drag the truth out of you. If you want to offer me something, start there.",
  });

  assert.match(reply, /usefulness|be clear|follow through|drag the truth out of you/i);
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

test("repair clarification resolves none from the previous assistant line instead of saying about none", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText: "You said none, but that answer usually hides something.",
    lastUserText: "none",
    lastUserAnswer: "none",
  });

  assert.match(reply, /when you said none|last answer sounded/i);
  assert.doesNotMatch(reply, /about none|tell me about none|what part of none/i);
});

test("repair clarification restates scaffold phrasing instead of asking a new question", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "normal_chat",
    topicType: "general_request",
    lastAssistantText: "Fine. We can talk without the scaffolding for a minute.",
  });

  assert.match(reply, /stop the scripted questioning|talk directly/i);
  assert.doesNotMatch(reply, /\?$/i);
});

test("repair clarification resolves what part from the immediately previous point", () => {
  const reply = buildShortClarificationReply({
    userText: "what part?",
    interactionMode: "relational_chat",
    topicType: "general_request",
    lastAssistantText: "That part matters more than you are pretending.",
    lastUserText: "I said none because I didn't want to get into it",
  });

  assert.match(reply, /the part you just said about i said none because i didn't want to get into it|last answer that actually carried weight/i);
  assert.doesNotMatch(reply, /drop the fog|start talking|part about that/i);
});

test("repair clarification with weak recovered referent prefers restatement over hallucination", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "normal_chat",
    topicType: "general_request",
    lastAssistantText: "That answer is doing more work than you think.",
    lastUserText: "none",
    lastUserAnswer: "none",
  });

  assert.match(reply, /last answer|doing more work than you think/i);
  assert.doesNotMatch(reply, /about none|about that|about it/i);
});

test("repair clarification prefers grounded restatement over a shallow extracted fragment", () => {
  const reply = buildShortClarificationReply({
    userText: "what do you mean?",
    interactionMode: "normal_chat",
    topicType: "general_request",
    lastAssistantText:
      "Then start with what actually holds your attention, and I will stay with that.",
    lastUserText: "i want to talk",
    lastUserAnswer: "i want to talk",
  });

  assert.match(reply, /what is actually holding your attention|start with what is actually holding your attention/i);
  assert.doesNotMatch(reply, /^i mean holds your attention\.?$/i);
});

test("elaboration-style follow-ups attach to the assistant answer instead of the assistant trailing question", () => {
  const lastAssistantText =
    "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it. What pulls at you hardest?";

  for (const userText of ["in more detail", "in more details", "more details", "tell me more", "explain more"]) {
    const reply = buildShortClarificationReply({
      userText,
      interactionMode: "relational_chat",
      topicType: "general_request",
      lastAssistantText,
    });

    assert.match(reply, /control with purpose|power exchange|restraint|obedience|tension/i, userText);
    assert.doesNotMatch(reply, /keep going|tell me the concrete part|what pulls at you hardest/i, userText);
  }
});
