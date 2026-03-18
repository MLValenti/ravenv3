import test from "node:test";
import assert from "node:assert/strict";

import {
  extractStableFactsFromResponse,
  updateMemorySummary,
} from "../lib/session/memory-extractor.ts";
import {
  buildProfileMemorySummaryReply,
  createSessionMemory,
  inferSlotFromAnswer,
  listMissingAskSlots,
  summarizeSessionMemory,
  writeUserAnswer,
  writeUserQuestion,
} from "../lib/session/session-memory.ts";

test("memory extractor captures stable profile facts without keeping temporary directives", () => {
  const facts = extractStableFactsFromResponse(
    "Call me Mara. I like to golf. I prefer short direct answers. My safeword is amber. Avoid public tasks.",
  );

  assert.equal(facts.name, "Mara");
  assert.equal(facts.likes, "golf");
  assert.equal(facts.preferred_style, "direct");
  assert.equal(facts.safeword, "amber");
  assert.equal(facts.limits, "public tasks");
});

test("session memory stores hobby answers as profile facts", () => {
  const memory = writeUserAnswer(createSessionMemory(), "I like to golf", 1_000, "profile_fact");
  const summary = summarizeSessionMemory(memory);

  assert.equal(memory.user_profile_facts[0]?.kind, "hobby");
  assert.equal(memory.user_profile_facts[0]?.category, "hobbies_interests");
  assert.equal(memory.user_profile_facts[0]?.value, "golf");
  assert.match(summary, /user_profile_facts: hobby: golf/i);
});

test("temporary reply directives do not become stable preferences", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "Ask me more questions about what I like",
    1_000,
    "reply_style",
  );

  assert.equal(memory.temporary_reply_directives[0]?.value, "Ask me more questions about what I like");
  assert.equal(memory.user_profile_facts.length, 0);
  assert.doesNotMatch(summarizeSessionMemory(memory), /preference:/i);
});

test("profile-building request sets session intent and conversation mode", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "I want you to learn what I like",
    1_000,
    null,
  );

  assert.equal(memory.session_intent?.value, "profile_building");
  assert.equal(memory.conversation_mode?.value, "profile_building");
});

test("mutual get-to-know request sets session intent without storing a user fact", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "I want to learn more about you",
    1_000,
    "profile_fact",
  );

  assert.equal(memory.session_intent?.value, "relational_chat");
  assert.equal(memory.conversation_mode?.value, "relational_chat");
  assert.equal(memory.user_profile_facts.length, 0);
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("generic intent statement writes session_intent and not user_profile_facts", () => {
  const memory = writeUserAnswer(createSessionMemory(), "I want to be trained", 1_000, "profile_fact");

  assert.equal(memory.session_intent?.value, "relational_chat");
  assert.equal(memory.conversation_mode?.value, "relational_chat");
  assert.equal(memory.user_profile_facts.length, 0);
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("explicit training request does not become a durable profile fact", () => {
  const memory = writeUserAnswer(createSessionMemory(), "give me anal training", 1_000, "profile_fact");

  assert.equal(memory.session_intent?.value, "relational_chat");
  assert.equal(memory.conversation_mode?.value, "relational_chat");
  assert.equal(memory.user_profile_facts.length, 0);
  assert.equal(memory.last_user_answer?.value, "give me anal training");
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("chat-switch request writes session_intent and not user_profile_facts", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "let's just chat for a minute",
    1_000,
    "profile_fact",
  );

  assert.equal(memory.session_intent?.value, "chat_switch");
  assert.equal(memory.conversation_mode?.value, "normal_chat");
  assert.equal(memory.user_profile_facts.length, 0);
});

test("low-information status answer does not become a profile fact", () => {
  const memory = writeUserAnswer(createSessionMemory(), "im ok", 1_000, "profile_fact");

  assert.equal(memory.user_profile_facts.length, 0);
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("transient arousal state does not become a durable profile fact", () => {
  const memory = writeUserAnswer(createSessionMemory(), "feeling horny", 1_000, "profile_fact");

  assert.equal(memory.user_profile_facts.length, 0);
  assert.equal(memory.last_user_answer?.value, "feeling horny");
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("live relational offer does not become a durable profile fact", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "thinking about what i can do for you",
    1_000,
    "profile_fact",
  );

  assert.equal(memory.user_profile_facts.length, 0);
  assert.equal(memory.last_user_answer?.value, "thinking about what i can do for you");
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("relational follow-up question preserves relational chat mode instead of dropping into generic question answering", () => {
  let memory = writeUserQuestion(createSessionMemory(), "what can i do for you?", 1_000);
  memory = writeUserQuestion(memory, "what would you notice first?", 2_000);

  assert.equal(memory.conversation_mode?.value, "relational_chat");
  assert.equal(memory.last_user_question?.value, "what would you notice first?");
});

test("weak relational acknowledgement does not become a durable profile fact", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "that sounds more real",
    1_000,
    "profile_fact",
  );

  assert.equal(memory.user_profile_facts.length, 0);
  assert.equal(memory.last_user_answer?.value, "that sounds more real");
});

test("malformed short-turn fragments do not become fallback profile facts", () => {
  const memory = writeUserAnswer(
    createSessionMemory(),
    "happens what first",
    1_000,
    "profile_fact",
  );

  assert.equal(memory.user_profile_facts.length, 0);
  assert.equal(memory.last_user_answer?.value, "happens what first");
  assert.doesNotMatch(summarizeSessionMemory(memory), /user_profile_facts:/i);
});

test("short clarification preserves the existing conversation mode instead of forcing question_answering", () => {
  let memory = writeUserAnswer(
    createSessionMemory(),
    "I want you to get to know me better",
    1_000,
    null,
  );
  memory = writeUserQuestion(memory, "what?", 2_000);

  assert.equal(memory.conversation_mode?.value, "profile_building");
  assert.equal(memory.last_user_question?.value, "what?");
});

test("embedded what-clause in an answer does not flip memory into question_answering", () => {
  const memory = writeUserAnswer(
    writeUserAnswer(createSessionMemory(), "I want you to get to know me better", 1_000, null),
    "thinking about what i can do for you",
    2_000,
    "profile_fact",
  );

  assert.equal(memory.conversation_mode?.value, "relational_chat");
  assert.equal(memory.last_user_answer?.value, "thinking about what i can do for you");
});

test("profile summary request stays out of user_profile_facts", () => {
  const memory = writeUserQuestion(
    createSessionMemory(),
    "what have you learned about me so far",
    1_000,
  );

  assert.equal(memory.session_intent?.value, "profile_summary_request");
  assert.equal(memory.conversation_mode?.value, "profile_building");
  assert.equal(memory.user_profile_facts.length, 0);
});

test("typed profile extraction categorizes common profile-building disclosures", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "Call me Mara", 1_000, "profile_fact");
  memory = writeUserAnswer(memory, "I prefer short direct answers", 2_000, "profile_fact");
  memory = writeUserAnswer(memory, "I like firmer guidance from you", 3_000, "profile_fact");
  memory = writeUserAnswer(memory, "I don't like humiliation", 4_000, "profile_fact");
  memory = writeUserAnswer(memory, "I like golf", 5_000, "profile_fact");

  assert.deepEqual(
    memory.user_profile_facts.map((fact) => fact.category),
    [
      "preferred_labels_or_names",
      "communication_preferences",
      "relationship_preferences",
      "dislikes",
      "hobbies_interests",
    ],
  );
});

test("typed preference extraction categorizes pace and intensity cues", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "keep it direct", 1_000, "profile_fact");
  memory = writeUserAnswer(memory, "stay slower with me", 2_000, "profile_fact");
  memory = writeUserAnswer(memory, "keep it light", 3_000, "profile_fact");

  assert.deepEqual(
    memory.user_profile_facts.map((fact) => [fact.category, fact.value]),
    [
      ["communication_preferences", "direct"],
      ["communication_preferences", "slower"],
      ["communication_preferences", "light"],
    ],
  );
});

test("session memory missing slots stay profile-oriented during profile building", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "I want you to get to know me better", 1_000, null);
  assert.deepEqual(listMissingAskSlots(memory), [
    "profile_fact",
    "reply_style",
    "constraints",
    "improvement_area",
  ]);

  memory = writeUserAnswer(memory, "Call me Mara. I like to golf.", 2_000, "profile_fact");
  assert.deepEqual(listMissingAskSlots(memory), ["reply_style", "constraints", "improvement_area"]);
});

test("slot inference distinguishes profile facts from temporary reply directives", () => {
  assert.equal(inferSlotFromAnswer("I like to golf"), "profile_fact");
  assert.equal(inferSlotFromAnswer("Ask me more questions"), "reply_style");
  assert.equal(inferSlotFromAnswer("No public tasks"), "constraints");
  assert.equal(inferSlotFromAnswer("I struggle with follow through"), "improvement_area");
});

test("memory summary only keeps extracted stable facts", () => {
  const summary = updateMemorySummary("name: Mara", {
    likes: "golf",
    preferred_style: "short lines",
  });

  assert.match(summary, /name: Mara/i);
  assert.match(summary, /likes: golf/i);
  assert.match(summary, /style: short lines/i);
  assert.doesNotMatch(summary, /ask me more questions/i);
});

test("profile memory summary uses typed fact buckets", () => {
  let memory = createSessionMemory();
  memory = writeUserAnswer(memory, "Call me Mara", 1_000, "profile_fact");
  memory = writeUserAnswer(memory, "I like golf", 2_000, "profile_fact");
  memory = writeUserAnswer(memory, "I prefer short direct answers", 3_000, "profile_fact");

  const reply = buildProfileMemorySummaryReply(memory);

  assert.match(reply, /name: Mara/i);
  assert.match(reply, /interests: golf/i);
  assert.match(reply, /communication: short direct answers/i);
});
