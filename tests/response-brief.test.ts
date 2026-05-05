import test from "node:test";
import assert from "node:assert/strict";

import { planAnswerIntent } from "../lib/session/raven-embodiment.ts";
import { buildResponseBrief, realizeResponseFromBrief } from "../lib/session/response-brief.ts";
import { updateCanonicalTurnState } from "../lib/session/turn-meaning.ts";
import {
  createActiveInteractionState,
  updateActiveInteractionState,
  type ActiveInteractionState,
} from "../lib/session/active-interaction.ts";

function briefFor(
  userText: string,
  previousAssistantText?: string,
  activeInteraction?: ActiveInteractionState | null,
) {
  const canonical = updateCanonicalTurnState({
    userText,
    previousAssistantText:
      previousAssistantText ??
      "We are in a negotiated mistress/submissive dynamic with tasks, training, limits, and service.",
    activeInteraction,
  });
  const intent = planAnswerIntent({
    turnMeaning: canonical.turn_meaning,
    plannedMove: canonical.planned_move,
  });
  const brief = buildResponseBrief({
    turnMeaning: canonical.turn_meaning,
    plannedMove: canonical.planned_move,
    answerIntent: intent,
    activeInteraction,
  });
  const realized = realizeResponseFromBrief({ brief });
  return { canonical, intent, brief, realized };
}

function activeTrainingInteraction(): ActiveInteractionState {
  const seed = briefFor("i want you to anal train me");
  return updateActiveInteractionState({
    before: createActiveInteractionState(),
    turnMeaning: seed.canonical.turn_meaning,
    responseBrief: seed.brief,
    assistantText: seed.realized.text,
    turnId: "seed-training",
  }).after;
}

test("response brief separates service tasks from games", () => {
  for (const text of [
    "I want to do tasks",
    "give me a task",
    "what task should i do",
    "what can i do to serve right now",
    "what would be useful to you",
  ]) {
    const { canonical, brief, realized } = briefFor(text);
    assert.equal(canonical.turn_meaning.current_domain_handler, "relational_dynamics", text);
    assert.equal(canonical.turn_meaning.requested_facet, "service_task", text);
    assert.equal(brief.answer_mode, "service_task_instruction", text);
    assert.equal(brief.desired_depth, "concise", text);
    assert.equal(realized.validation_result.ok, true, text);
    assert.doesNotMatch(realized.text, /\bgame|round|score|points?|win|lose\b/i, text);
    assert.match(realized.text, /\b(task|do this|report|timer|minutes?)\b/i, text);
  }
});

test("response brief makes game correction authoritative", () => {
  for (const text of [
    "i want a task not a game",
    "not a game, a task",
    "stop making it a game",
    "give me a task instead",
    "i mean service task",
  ]) {
    const { canonical, brief, realized } = briefFor(
      text,
      "Let's play a quick game. If I win, you get a consequence task.",
    );
    assert.equal(canonical.turn_meaning.requested_facet, "correction_to_prior_plan", text);
    assert.equal(brief.answer_mode, "revise", text);
    assert.equal(realized.validation_result.ok, true, text);
    assert.match(realized.text, /\bnot a game|drop the game|service task\b/i, text);
    assert.doesNotMatch(realized.text, /\bround|score|points?|win|lose|best three out of five\b/i, text);
  }
});

test("response brief carries training guidance depth and required slots", () => {
  for (const text of [
    "what things can we do to help with anal training",
    "how do we approach anal training",
    "what would help with that training",
    "how can I work up to that safely",
  ]) {
    const { canonical, brief, realized } = briefFor(text);
    assert.equal(canonical.turn_meaning.requested_facet, "training_guidance", text);
    assert.equal(brief.answer_mode, "bounded_guidance", text);
    assert.ok(["deeper", "stepwise", "normal"].includes(brief.desired_depth), text);
    assert.ok(brief.must_address.includes("pacing"), text);
    assert.ok(brief.must_address.includes("comfort"), text);
    assert.ok(brief.must_address.includes("limits"), text);
    assert.equal(realized.validation_result.ok, true, text);
    assert.match(realized.text, /\bgradual|baseline|comfort|limits?|stop|pain\b/i, text);
    assert.doesNotMatch(realized.text, /\bgame|round|score|points?|win|lose\b/i, text);
  }
});

test("response brief attaches short how to the prior training plan", () => {
  const prior = briefFor("what things can we do to help with anal training");
  const follow = updateCanonicalTurnState({
    userText: "how",
    previousAssistantText: prior.realized.text,
  });
  const intent = planAnswerIntent({
    turnMeaning: follow.turn_meaning,
    plannedMove: follow.planned_move,
  });
  const brief = buildResponseBrief({
    turnMeaning: follow.turn_meaning,
    plannedMove: follow.planned_move,
    answerIntent: intent,
    previousBrief: {
      previous_response_brief_id: prior.brief.brief_id,
      previous_reply_goal: prior.brief.reply_goal,
      previous_required_slots: prior.brief.required_answer_slots,
      previous_plain_language_summary:
        "Raven wants to keep anal training gradual by naming baseline comfort, pacing, limits, and the next small step.",
      previous_example_user_response:
        "My baseline is small and comfortable; pain is a hard stop; I want the next step gradual.",
      previous_domain_handler: prior.brief.domain_handler,
      previous_answer_mode: prior.brief.answer_mode,
    },
  });
  const realized = realizeResponseFromBrief({ brief });
  assert.equal(follow.turn_meaning.requested_facet, "training_guidance");
  assert.equal(brief.previous_substantive_ask?.previous_response_brief_id, prior.brief.brief_id);
  assert.equal(brief.desired_depth, "stepwise");
  assert.equal(realized.validation_result.ok, true);
  assert.match(realized.text, /\bgradual|baseline|comfort|limits?|stop|pain\b/i);
  assert.doesNotMatch(realized.text, /\bquick mental games?|round|score|points?\b/i);
});

test("active interaction paraphrases classify next step progress confusion readiness and correction", () => {
  const active = activeTrainingInteraction();
  const groups: Array<{ texts: string[]; speechAct: string; facet: string }> = [
    {
      speechAct: "next_step_request",
      facet: "active_next_step",
      texts: ["what else?", "now what?", "now what do i do?", "what comes next?", "what should I do next?"],
    },
    {
      speechAct: "progress_report",
      facet: "active_progress_report",
      texts: ["i am doing that now", "i started", "i am still doing it", "i never stopped", "it feels intense", "it feels uncomfortable"],
    },
    {
      speechAct: "user_confusion",
      facet: "clarification_recovery",
      texts: ["what do you mean?", "i dont understand", "what are you asking me to do?", "explain that", "say that simpler"],
    },
    {
      speechAct: "readiness_confirmation",
      facet: "active_readiness_confirmation",
      texts: ["i am ready", "i am ready for what's next", "yes mistress, next", "keep going", "continue"],
    },
    {
      speechAct: "correction_to_active_interaction",
      facet: "correction_to_active_interaction",
      texts: ["not a game", "i want a task not a game", "stop making it a game", "i mean service task", "no, stay on this"],
    },
  ];
  for (const group of groups) {
    for (const text of group.texts) {
      const { canonical, brief, realized } = briefFor(text, undefined, active);
      assert.equal(canonical.turn_meaning.speech_act, group.speechAct, text);
      assert.equal(canonical.turn_meaning.requested_facet, group.facet, text);
      assert.equal(canonical.turn_meaning.current_domain_handler, "relational_dynamics", text);
      assert.equal(brief.active_interaction_id, active.active_interaction_id, text);
      assert.equal(realized.validation_result.ok, true, text);
      assert.doesNotMatch(realized.text, /\bKeep going\b|The game continues|round|score|points?|Open is the part/i, text);
    }
  }
});

test("active state delta paraphrases update experience without repeating", () => {
  const active = activeTrainingInteraction();
  active.training_goals = ["anal training", "chastity training"];
  for (const text of [
    "i dont have much training",
    "i am new to this",
    "i am inexperienced",
    "i have never done much of this",
    "i need beginner steps",
  ]) {
    const { canonical, brief, realized } = briefFor(text, undefined, active);
    assert.equal(canonical.turn_meaning.requested_facet, "training_guidance", text);
    assert.equal(canonical.turn_meaning.dynamic_slots?.state_delta_type, "user_experience_delta", text);
    assert.equal(canonical.turn_meaning.dynamic_slots?.experience_level, "beginner", text);
    assert.deepEqual(canonical.turn_meaning.dynamic_slots?.new_slots_added, ["experience_level"], text);
    assert.equal(brief.state_delta_summary, "user has low experience and needs beginner-safe pacing", text);
    assert.deepEqual(brief.newly_added_slots, ["experience_level"], text);
    assert.equal(realized.validation_result.ok, true, text);
    assert.match(realized.text, /\bbeginner|low experience|inexperienced|not much training\b/i, text);
    assert.match(realized.text, /\banal\b/i, text);
    assert.match(realized.text, /\bchastity\b/i, text);
    assert.doesNotMatch(realized.text, /Choose a role frame|follow Choose|Keep going/i, text);
  }
});

test("meta feedback paraphrases request response correction", () => {
  const active = activeTrainingInteraction();
  active.training_goals = ["anal training", "chastity training"];
  active.known_experience_level = "beginner";
  for (const text of [
    "why are you repeating?",
    "you already said that",
    "stop repeating yourself",
    "that is not what I asked",
    "you are not answering me",
    "say it differently",
  ]) {
    const { canonical, brief, realized } = briefFor(text, undefined, active);
    assert.equal(canonical.turn_meaning.speech_act, "complaint_about_response", text);
    assert.equal(canonical.turn_meaning.requested_facet, "response_correction", text);
    assert.equal(canonical.turn_meaning.dynamic_slots?.state_delta_type, "meta_feedback", text);
    assert.equal(brief.state_delta_summary, "user says Raven repeated or missed the requested answer", text);
    assert.equal(realized.validation_result.ok, true, text);
    assert.match(realized.text, /\bright|repeated|correct course|instead|revised/i, text);
    assert.doesNotMatch(realized.text, /Keep going|Because that is where|Choose a role frame|follow Choose/i, text);
  }
});

test("compound training goal paraphrases preserve anal and chastity", () => {
  for (const text of [
    "i want anal and chastity training",
    "i want to work on anal and chastity",
    "i want training around chastity and anal",
    "i want to start with anal but include chastity too",
  ]) {
    const { canonical, brief, realized } = briefFor(text);
    assert.equal(canonical.turn_meaning.requested_facet, "training_guidance", text);
    assert.deepEqual(canonical.turn_meaning.dynamic_slots?.training_goals, [
      "anal training",
      "chastity training",
    ], text);
    assert.ok(brief.must_address.includes("anal training"), text);
    assert.ok(brief.must_address.includes("chastity training"), text);
    assert.equal(realized.validation_result.ok, true, text);
    assert.match(realized.text, /\banal\b/i, text);
    assert.match(realized.text, /\bchastity\b/i, text);
  }
});
