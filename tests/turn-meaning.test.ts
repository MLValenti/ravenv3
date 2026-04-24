import test from "node:test";
import assert from "node:assert/strict";

import {
  interpretTurnMeaning,
  planSemanticResponse,
} from "../lib/session/turn-meaning.ts";

function meaningFor(userText: string, previousAssistantText?: string) {
  const turnMeaning = interpretTurnMeaning({
    userText,
    previousAssistantText: previousAssistantText ?? null,
    currentTopic: null,
  });
  const plannedMove = planSemanticResponse(turnMeaning);
  return { turnMeaning, plannedMove };
}

test("semantic interpreter maps requested direct-question transcript to stable meanings", () => {
  const greeting = meaningFor("hi");
  assert.equal(greeting.turnMeaning.speech_act, "greeting");
  assert.equal(greeting.plannedMove.move, "acknowledge_and_probe");

  const kinks = meaningFor("what are your kinks?");
  assert.equal(kinks.turnMeaning.speech_act, "direct_question");
  assert.equal(kinks.turnMeaning.target, "assistant");
  assert.equal(kinks.turnMeaning.subject_domain, "assistant_preferences");
  assert.equal(kinks.turnMeaning.requested_operation, "answer");
  assert.equal(kinks.turnMeaning.question_shape, "open_question");
  assert.equal(kinks.turnMeaning.requested_facet, "category_overview");
  assert.equal(kinks.turnMeaning.answer_contract, "provide_category_overview");
  assert.equal(kinks.turnMeaning.current_domain_handler, "raven_preferences");
  assert.equal(kinks.plannedMove.move, "answer");

  const application = meaningFor(
    "i like pegging so how could you use that?",
    "Control with purpose. Power exchange that actually changes the room.",
  );
  assert.equal(application.turnMeaning.speech_act, "self_disclosure");
  assert.equal(application.turnMeaning.target, "assistant");
  assert.equal(application.turnMeaning.subject_domain, "user_preferences");
  assert.equal(application.turnMeaning.requested_operation, "explain_application");
  assert.equal(application.turnMeaning.referent, "pegging");
  assert.equal(application.turnMeaning.question_shape, "application_request");
  assert.equal(application.turnMeaning.answer_contract, "explain_application");
  assert.equal(application.plannedMove.move, "explain_application");

  const challenge = meaningFor(
    "you have to have favorite kinks",
    "I like sharp honesty, control with purpose, and anything that changes the exchange instead of decorating it.",
  );
  assert.equal(challenge.turnMeaning.speech_act, "challenge");
  assert.equal(challenge.turnMeaning.target, "prior_assistant_answer");
  assert.equal(challenge.turnMeaning.subject_domain, "assistant_preferences");
  assert.equal(challenge.turnMeaning.requested_operation, "revise");
  assert.equal(challenge.turnMeaning.question_shape, "challenge_or_correction");
  assert.equal(challenge.turnMeaning.answer_contract, "revise_or_clarify_prior_claim");
  assert.equal(challenge.plannedMove.move, "revise");
});

test("nearby preference phrasings map to the same assistant preference domain", () => {
  const cases = [
    "what are your kinks?",
    "what are you kinks?",
    "what other kinks do you like?",
    "which are your favorite kinks?",
    "do you have a favorite particular kink or fetish?",
  ];

  const meanings = cases.map((userText) => meaningFor(userText).turnMeaning);

  for (const meaning of meanings) {
    assert.equal(meaning.target, "assistant");
    assert.equal(meaning.subject_domain, "assistant_preferences");
    assert.equal(meaning.current_domain_handler, "raven_preferences");
    assert.match(meaning.referent ?? "", /kinks?|fetish/i);
    assert.ok(meaning.confidence >= 0.75);
  }

  assert.equal(meanings[0]?.requested_operation, "answer");
  assert.equal(meanings[0]?.question_shape, "open_question");
  assert.equal(meanings[0]?.requested_facet, "category_overview");
  assert.equal(meanings[0]?.answer_contract, "provide_category_overview");
  assert.equal(meanings[2]?.requested_operation, "elaborate");
  assert.equal(meanings[2]?.question_shape, "list_expansion");
  assert.equal(meanings[2]?.requested_facet, "list_expansion");
  assert.equal(meanings[3]?.requested_operation, "answer");
  assert.equal(meanings[3]?.question_shape, "favorites_request");
  assert.equal(meanings[3]?.requested_facet, "favorites_subset");
  assert.equal(meanings[3]?.answer_contract, "provide_favorites");
  assert.equal(meanings[4]?.requested_operation, "answer");
  assert.equal(meanings[4]?.question_shape, "favorites_request");
  assert.equal(meanings[4]?.requested_facet, "favorites_subset");
});

test("application request phrasings map to the same explain application move", () => {
  const cases = [
    "i like pegging so how could you use that?",
    "i love pegging, how can we use that in our dynamic?",
    "how would you use pegging with me?",
    "what would you do with that preference?",
  ];

  const meanings = cases.map((userText, index) =>
    meaningFor(
      userText,
      index === 3 ? "You said pegging pulls at you because of control and trust." : undefined,
    ),
  );

  for (const { turnMeaning, plannedMove } of meanings) {
    assert.equal(turnMeaning.target, "assistant");
    assert.equal(turnMeaning.subject_domain, "user_preferences");
    assert.equal(turnMeaning.requested_operation, "explain_application");
    assert.equal(plannedMove.move, "explain_application");
    assert.equal(turnMeaning.question_shape, "application_request");
    assert.equal(turnMeaning.answer_contract, "explain_application");
    assert.match(turnMeaning.referent ?? "", /pegging/i);
  }
});

test("challenge phrasings map to revise rather than continuation", () => {
  const previous =
    "I like sharp honesty, control with purpose, and anything that changes the exchange.";
  for (const userText of [
    "you have to have favorite kinks",
    "come on, you must have favorites",
    "that cannot be all",
    "be honest, you have favorites",
  ]) {
    const { turnMeaning, plannedMove } = meaningFor(userText, previous);
    assert.equal(turnMeaning.speech_act, "challenge");
    assert.equal(turnMeaning.target, "prior_assistant_answer");
    assert.equal(turnMeaning.subject_domain, "assistant_preferences");
    assert.equal(turnMeaning.question_shape, "challenge_or_correction");
    assert.equal(plannedMove.move, "revise");
  }
});

test("reciprocal offers and pronoun follow-ups resolve semantic target and referent", () => {
  const reciprocal = meaningFor("would you like to know mine?");
  assert.equal(reciprocal.turnMeaning.speech_act, "reciprocal_offer");
  assert.equal(reciprocal.turnMeaning.target, "user");
  assert.equal(reciprocal.turnMeaning.subject_domain, "user_preferences");
  assert.equal(reciprocal.plannedMove.move, "ask_focused_follow_up");

  const profileProbe = meaningFor("do you want to know anything else about me?");
  assert.equal(profileProbe.turnMeaning.speech_act, "reciprocal_offer");
  assert.equal(profileProbe.turnMeaning.target, "user");
  assert.equal(profileProbe.turnMeaning.requested_operation, "ask_follow_up");

  const pronoun = meaningFor(
    "do you like it?",
    "Pegging usually appeals for a mix of sensation, control, trust, novelty, or the shift in who is doing what.",
  );
  assert.equal(pronoun.turnMeaning.target, "assistant");
  assert.equal(pronoun.turnMeaning.subject_domain, "assistant_preferences");
  assert.equal(pronoun.turnMeaning.referent, "pegging");
  assert.equal(pronoun.turnMeaning.question_shape, "yes_no_about_item");
  assert.equal(pronoun.turnMeaning.answer_contract, "answer_yes_no_with_item");
});

test("definition phrasings map to definition answer meanings", () => {
  for (const [userText, referent] of [
    ["what is FLR", "FLR"],
    ["define FLR", "FLR"],
    ["what does FLR mean", "FLR"],
    ["what is CNC", "CNC"],
    ["define CNC", "CNC"],
  ] as const) {
    const { turnMeaning, plannedMove } = meaningFor(userText);
    assert.equal(turnMeaning.speech_act, "direct_question");
    assert.equal(turnMeaning.subject_domain, "definition");
    assert.equal(turnMeaning.requested_operation, "answer");
    assert.equal(turnMeaning.referent, referent);
    assert.equal(turnMeaning.question_shape, "definition_request");
    assert.equal(turnMeaning.answer_contract, "define_term");
    assert.equal(turnMeaning.current_domain_handler, "definitions");
    assert.equal(plannedMove.move, "answer");
  }
});

test("domain question shapes distinguish yes-no compare drilldown invitation and favorites", () => {
  const yesNo = meaningFor("do you like pegging?");
  assert.equal(yesNo.turnMeaning.question_shape, "yes_no_about_item");
  assert.equal(yesNo.turnMeaning.requested_facet, "yes_no_about_item");
  assert.equal(yesNo.turnMeaning.answer_contract, "answer_yes_no_with_item");
  assert.equal(yesNo.turnMeaning.required_referent, "pegging");

  for (const text of ["do you like pegging or bondage?", "do you like bondage or pegging?"]) {
    const { turnMeaning } = meaningFor(text);
    assert.equal(turnMeaning.question_shape, "binary_compare_or_choice");
    assert.equal(turnMeaning.requested_facet, "binary_compare_or_choice");
    assert.equal(turnMeaning.answer_contract, "compare_or_choose_between_entities");
    assert.equal(turnMeaning.entity_set.length, 2);
  }

  const drilldown = meaningFor("what about pegging?", "My favorites are control and bondage.");
  assert.equal(drilldown.turnMeaning.question_shape, "topic_drilldown");
  assert.equal(drilldown.turnMeaning.requested_facet, "reason_about_item");
  assert.equal(drilldown.turnMeaning.answer_contract, "explain_reason_about_item");
  assert.equal(drilldown.turnMeaning.required_referent, "pegging");

  const invitation = meaningFor("would you like to explore it with me?", "Pegging matters for trust.");
  assert.equal(invitation.turnMeaning.question_shape, "invitation_or_proposal");
  assert.equal(invitation.turnMeaning.requested_facet, "invitation_response");
  assert.equal(invitation.turnMeaning.answer_contract, "answer_invitation_or_boundary");
  assert.equal(invitation.turnMeaning.current_domain_handler, "raven_preferences");
});

test("metamorphic preference phrasings keep compatible facets and contracts", () => {
  const overviewForms = [
    "what are your kinks?",
    "what are you kinks?",
    "what are your kinks mistress?",
    "what kind of stuff are you into?",
  ].map((text) => meaningFor(text).turnMeaning);

  for (const meaning of overviewForms) {
    assert.equal(meaning.requested_facet, "category_overview");
    assert.equal(meaning.answer_contract, "provide_category_overview");
    assert.equal(meaning.current_domain_handler, "raven_preferences");
  }

  const favoriteForms = [
    "which are your favorite?",
    "do you have a favorite kink or fetish?",
  ].map((text) => meaningFor(text).turnMeaning);

  for (const meaning of favoriteForms) {
    assert.equal(meaning.question_shape, "favorites_request");
    assert.equal(meaning.requested_facet, "favorites_subset");
    assert.equal(meaning.answer_contract, "provide_favorites");
    assert.equal(meaning.current_domain_handler, "raven_preferences");
  }

  const applicationForms = [
    "i like pegging so how could you use that?",
    "how can we use pegging in our dynamic?",
  ].map((text) => meaningFor(text).turnMeaning);

  for (const meaning of applicationForms) {
    assert.equal(meaning.question_shape, "application_request");
    assert.equal(meaning.requested_facet, "application_explanation");
    assert.equal(meaning.answer_contract, "explain_application");
    assert.equal(meaning.required_referent, "pegging");
  }
});

test("facet interpreter separates nearby preference requests inside the same broad domain", () => {
  const overview = meaningFor("what are your kinks?");
  assert.equal(overview.turnMeaning.requested_facet, "category_overview");
  assert.equal(overview.turnMeaning.answer_contract, "provide_category_overview");

  const favorites = meaningFor("which are your favorite?", "My kink lane is control and restraint.");
  assert.equal(favorites.turnMeaning.requested_facet, "favorites_subset");
  assert.equal(favorites.turnMeaning.answer_contract, "provide_favorites");

  const clarification = meaningFor(
    "i mean like pegging, bondage, chastity, etc",
    "My kink lane is control, restraint, service, tools, training, and negotiated edge.",
  );
  assert.equal(clarification.turnMeaning.speech_act, "clarification");
  assert.equal(clarification.turnMeaning.requested_facet, "clarifying_enumeration");
  assert.equal(clarification.turnMeaning.answer_contract, "clarify_enumeration");
  assert.deepEqual(clarification.turnMeaning.entity_set.slice(0, 3), ["pegging", "bondage", "chastity"]);

  const possession = meaningFor("do you have a strapon for pegging?");
  assert.equal(possession.turnMeaning.requested_facet, "possession_or_tool_availability");
  assert.equal(possession.turnMeaning.answer_contract, "answer_possession_or_tool_availability");
  assert.equal(possession.turnMeaning.required_referent, "strap-on");

  const reason = meaningFor("what do you like about it?", "Pegging matters because of trust and control.");
  assert.equal(reason.turnMeaning.requested_facet, "reason_about_item");
  assert.equal(reason.turnMeaning.answer_contract, "explain_reason_about_item");
  assert.equal(reason.turnMeaning.required_referent, "pegging");
});

test("current status and definition facets reject the Raven preference handler", () => {
  const status = meaningFor("what are you doing?");
  assert.equal(status.turnMeaning.question_shape, "current_status_request");
  assert.equal(status.turnMeaning.requested_facet, "current_activity_or_status");
  assert.equal(status.turnMeaning.answer_contract, "answer_current_status");
  assert.equal(status.turnMeaning.current_domain_handler, "conversation");
  assert.ok(
    status.turnMeaning.rejected_domain_handlers.some(
      (decision) => decision.handler === "raven_preferences",
    ),
  );

  for (const text of [
    "what is FLR?",
    "define FLR",
    "what does FLR mean?",
    "FLR meaning?",
    "what is a female-led relationship?",
    "what is CNC?",
    "define CNC",
  ]) {
    const { turnMeaning } = meaningFor(text);
    assert.equal(turnMeaning.requested_facet, "definition", text);
    assert.equal(turnMeaning.answer_contract, "define_term", text);
    assert.equal(turnMeaning.current_domain_handler, "definitions", text);
    assert.ok(
      turnMeaning.rejected_domain_handlers.some(
        (decision) => decision.handler === "raven_preferences",
      ),
      text,
    );
  }
});

test("metamorphic application invitation and comparison facets stay stable", () => {
  for (const text of [
    "i like pegging so how could you use that?",
    "how can we use pegging in our dynamic?",
    "what would you do with that preference?",
    "how would that work with me?",
  ]) {
    const { turnMeaning } = meaningFor(text, "You said pegging is the active preference.");
    assert.equal(turnMeaning.requested_facet, "application_explanation", text);
    assert.equal(turnMeaning.answer_contract, "explain_application", text);
  }

  for (const text of [
    "would you like to explore it with me?",
    "would you be into that with me?",
    "would you like to peg me?",
    "would you peg me with a strapon?",
  ]) {
    const { turnMeaning } = meaningFor(text, "Pegging matters because of trust and control.");
    assert.equal(turnMeaning.requested_facet, "invitation_response", text);
    assert.equal(turnMeaning.answer_contract, "answer_invitation_or_boundary", text);
  }

  for (const text of [
    "do you like pegging or bondage?",
    "do you like bondage or pegging?",
    "which do you prefer, bondage or pegging?",
  ]) {
    const { turnMeaning } = meaningFor(text);
    assert.equal(turnMeaning.requested_facet, "binary_compare_or_choice", text);
    assert.equal(turnMeaning.answer_contract, "compare_or_choose_between_entities", text);
    assert.equal(turnMeaning.entity_set.length, 2, text);
  }
});
