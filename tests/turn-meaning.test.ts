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
  assert.equal(kinks.turnMeaning.question_shape, "favorites_request");
  assert.equal(kinks.turnMeaning.answer_contract, "provide_favorites");
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
  assert.equal(meanings[0]?.question_shape, "favorites_request");
  assert.equal(meanings[0]?.answer_contract, "provide_favorites");
  assert.equal(meanings[2]?.requested_operation, "elaborate");
  assert.equal(meanings[2]?.question_shape, "list_expansion");
  assert.equal(meanings[3]?.requested_operation, "answer");
  assert.equal(meanings[3]?.question_shape, "favorites_request");
  assert.equal(meanings[3]?.answer_contract, "provide_favorites");
  assert.equal(meanings[4]?.requested_operation, "answer");
  assert.equal(meanings[4]?.question_shape, "favorites_request");
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
  assert.equal(yesNo.turnMeaning.answer_contract, "answer_yes_no_with_item");
  assert.equal(yesNo.turnMeaning.required_referent, "pegging");

  for (const text of ["do you like pegging or bondage?", "do you like bondage or pegging?"]) {
    const { turnMeaning } = meaningFor(text);
    assert.equal(turnMeaning.question_shape, "binary_compare_or_choice");
    assert.equal(turnMeaning.answer_contract, "compare_or_choose_between_entities");
    assert.equal(turnMeaning.entity_set.length, 2);
  }

  const drilldown = meaningFor("what about pegging?", "My favorites are control and bondage.");
  assert.equal(drilldown.turnMeaning.question_shape, "topic_drilldown");
  assert.equal(drilldown.turnMeaning.answer_contract, "address_topic_directly");
  assert.equal(drilldown.turnMeaning.required_referent, "pegging");

  const invitation = meaningFor("would you like to explore it with me?", "Pegging matters for trust.");
  assert.equal(invitation.turnMeaning.question_shape, "invitation_or_proposal");
  assert.equal(invitation.turnMeaning.answer_contract, "answer_invitation_or_boundary");
  assert.equal(invitation.turnMeaning.current_domain_handler, "raven_preferences");
});

test("metamorphic preference phrasings keep compatible question shapes and contracts", () => {
  const favoriteForms = [
    "what are your kinks?",
    "what are you kinks?",
    "which are your favorite?",
    "do you have a favorite kink or fetish?",
  ].map((text) => meaningFor(text).turnMeaning);

  for (const meaning of favoriteForms) {
    assert.equal(meaning.question_shape, "favorites_request");
    assert.equal(meaning.answer_contract, "provide_favorites");
    assert.equal(meaning.current_domain_handler, "raven_preferences");
  }

  const applicationForms = [
    "i like pegging so how could you use that?",
    "how can we use pegging in our dynamic?",
  ].map((text) => meaningFor(text).turnMeaning);

  for (const meaning of applicationForms) {
    assert.equal(meaning.question_shape, "application_request");
    assert.equal(meaning.answer_contract, "explain_application");
    assert.equal(meaning.required_referent, "pegging");
  }
});
