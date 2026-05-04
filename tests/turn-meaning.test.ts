import test from "node:test";
import assert from "node:assert/strict";

import {
  interpretTurnMeaning,
  planSemanticResponse,
  updateCanonicalTurnState,
} from "../lib/session/turn-meaning.ts";
import { planAnswerIntent } from "../lib/session/raven-embodiment.ts";
import {
  planDomainAnswer,
  realizeValidatedDomainAnswer,
  validateAnswerContract,
} from "../lib/session/raven-preferences.ts";
import {
  applyRelationalDynamicStateUpdate,
  createRelationalDynamicState,
} from "../lib/session/relational-dynamic.ts";
import type { SemanticCandidate } from "../lib/session/semantic-candidate-generator.ts";

function meaningFor(userText: string, previousAssistantText?: string) {
  const turnMeaning = interpretTurnMeaning({
    userText,
    previousAssistantText: previousAssistantText ?? null,
    currentTopic: null,
  });
  const plannedMove = planSemanticResponse(turnMeaning);
  return { turnMeaning, plannedMove };
}

function llmCandidate(overrides: Partial<SemanticCandidate>): SemanticCandidate {
  return {
    source: "llm",
    speech_act: "direct_question",
    target: "assistant",
    subject_domain: "assistant_preferences",
    requested_operation: "answer",
    question_shape: "open_question",
    requested_facet: "category_overview",
    primary_subject: "Raven's preferences",
    secondary_subjects: [],
    entity_set: ["kinks"],
    required_referent: "Raven's kinks",
    required_scope: "answer_plus_explanation",
    current_domain_handler: "raven_preferences",
    continuity_attachment: "fresh_topic",
    confidence: 0.9,
    rationale: "mock model semantic candidate for paraphrase normalization",
    alternative_interpretations: [],
    ...overrides,
  };
}

function canonicalFor(
  userText: string,
  candidates: unknown[],
  previousAssistantText?: string,
) {
  return updateCanonicalTurnState({
    userText,
    previousAssistantText: previousAssistantText ?? null,
    currentTopic: null,
    llmSemanticCandidates: candidates,
  });
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

test("answer-mode metamorphic phrasings map to compatible intents", () => {
  for (const text of [
    "do you have a strapon for pegging?",
    "do you own a strap for pegging?",
    "would you have gear for that?",
  ]) {
    const { turnMeaning, plannedMove } = meaningFor(text, "Pegging is the active topic.");
    const intent = planAnswerIntent({ turnMeaning, plannedMove });
    assert.equal(turnMeaning.requested_facet, "possession_or_tool_availability", text);
    assert.equal(turnMeaning.answer_contract, "answer_possession_or_tool_availability", text);
    assert.equal(intent.answer_mode, "tool_or_inventory", text);
    assert.equal(intent.embodiment_context, "actual_disembodied", text);
  }

  for (const text of [
    "what if you had a body?",
    "if you were physically here...",
    "if you had a body and we were in the same room...",
  ]) {
    const { turnMeaning, plannedMove } = meaningFor(text);
    const intent = planAnswerIntent({ turnMeaning, plannedMove });
    assert.equal(turnMeaning.requested_facet, "hypothetical_embodiment", text);
    assert.equal(turnMeaning.answer_contract, "answer_hypothetical_embodiment", text);
    assert.equal(intent.answer_mode, "counterfactual_hypothetical", text);
    assert.equal(intent.embodiment_context, "hypothetical_embodied", text);
  }

  for (const text of [
    "i want you to peg me remotely",
    "could you control a toy on me from a distance?",
    "what if i wanted you to use a remote toy with me?",
  ]) {
    const { turnMeaning, plannedMove } = meaningFor(text, "Pegging is the active topic.");
    const intent = planAnswerIntent({ turnMeaning, plannedMove });
    assert.equal(turnMeaning.requested_facet, "remote_control_proposal", text);
    assert.equal(turnMeaning.answer_contract, "answer_remote_control_proposal", text);
    assert.equal(intent.answer_mode, "proposal_response", text);
    assert.equal(intent.embodiment_context, "actual_disembodied", text);
  }
});

test("answer-mode facets distinguish abstract and procedural preference requests", () => {
  const abstract = meaningFor("what kind of things are you into?");
  const abstractIntent = planAnswerIntent(abstract);
  assert.equal(abstract.turnMeaning.requested_facet, "category_overview");
  assert.equal(abstractIntent.answer_mode, "abstract_preference");

  const reason = meaningFor("what do you like about pegging?");
  const reasonIntent = planAnswerIntent(reason);
  assert.equal(reason.turnMeaning.requested_facet, "reason_about_item");
  assert.equal(reasonIntent.answer_mode, "abstract_preference");

  const procedural = meaningFor("what position do you like when pegging?");
  const proceduralIntent = planAnswerIntent(procedural);
  assert.equal(procedural.turnMeaning.requested_facet, "procedural_preference");
  assert.equal(procedural.turnMeaning.answer_contract, "provide_procedural_preference");
  assert.equal(proceduralIntent.answer_mode, "procedural_preference");
});

test("llm semantic candidates improve novel paraphrases only after arbitration", () => {
  let llmChosenCount = 0;
  const overviewForms = [
    "what sort of stuff do you like?",
    "what are you into sexually?",
    "what kind of dynamics do you like?",
  ];
  for (const text of overviewForms) {
    const state = canonicalFor(text, [
      llmCandidate({
        primary_subject: "Raven's kink preferences",
        required_referent: "Raven's kinks",
        rationale: "paraphrase asks for a category overview of Raven's preferences",
      }),
    ]);
    assert.match(state.semantic_arbitration.chosen_source, /^(?:deterministic|llm)$/, text);
    if (state.semantic_arbitration.chosen_source === "llm") {
      llmChosenCount += 1;
    }
    assert.equal(state.turn_meaning.requested_facet, "category_overview", text);
    assert.equal(state.turn_meaning.answer_contract, "provide_category_overview", text);
    assert.equal(state.turn_meaning.current_domain_handler, "raven_preferences", text);
  }

  const favoriteForms = [
    "do you have one you like most?",
    "what's your favorite kink?",
    "what kink do you like best?",
  ];
  for (const text of favoriteForms) {
    const state = canonicalFor(text, [
      llmCandidate({
        question_shape: "favorites_request",
        requested_facet: "favorites_subset",
        primary_subject: "Raven's favorite kink",
        required_referent: "Raven's favorite kinks",
        required_scope: "answer_plus_explanation",
        rationale: "paraphrase asks for Raven's favorites, not a broad overview",
      }),
    ]);
    assert.match(state.semantic_arbitration.chosen_source, /^(?:deterministic|llm)$/, text);
    if (state.semantic_arbitration.chosen_source === "llm") {
      llmChosenCount += 1;
    }
    assert.equal(state.turn_meaning.requested_facet, "favorites_subset", text);
    assert.equal(state.turn_meaning.answer_contract, "provide_favorites", text);
  }

  const hypotheticalForms = [
    "if you were physically here, how would that work?",
    "if you had a body, what would you do?",
    "suppose you were really in the room with me",
  ];
  for (const text of hypotheticalForms) {
    const state = canonicalFor(text, [
      llmCandidate({
        question_shape: "hypothetical_request",
        requested_facet: "hypothetical_embodiment",
        primary_subject: "hypothetical embodied Raven",
        entity_set: ["hypothetical embodied setup"],
        required_referent: "hypothetical embodied setup",
        current_domain_handler: "raven_preferences",
        rationale: "counterfactual body wording asks for hypothetical embodiment",
      }),
    ]);
    const intent = planAnswerIntent({
      turnMeaning: state.turn_meaning,
      plannedMove: state.planned_move,
    });
    assert.match(state.semantic_arbitration.chosen_source, /^(?:deterministic|llm)$/, text);
    if (state.semantic_arbitration.chosen_source === "llm") {
      llmChosenCount += 1;
    }
    assert.equal(state.turn_meaning.requested_facet, "hypothetical_embodiment", text);
    assert.equal(intent.answer_mode, "counterfactual_hypothetical", text);
  }
  assert.ok(llmChosenCount > 0, "expected model-assisted semantics to win at least one weak paraphrase");
});

test("semantic arbitration rejects invalid and ineligible model candidates", () => {
  const status = canonicalFor("what are you doing?", [
    llmCandidate({
      requested_facet: "category_overview",
      question_shape: "open_question",
      required_referent: "Raven's kinks",
      current_domain_handler: "raven_preferences",
      rationale: "bad model candidate overclaims preferences",
    }),
  ]);
  assert.equal(status.semantic_arbitration.chosen_source, "deterministic");
  assert.equal(status.turn_meaning.requested_facet, "current_activity_or_status");
  assert.ok(
    status.semantic_arbitration.rejected_candidates.some(
      (candidate) => candidate.reason === "conflicts_with_current_status_context",
    ),
  );

  const invalid = canonicalFor("what sort of stuff do you like?", [
    {
      ...llmCandidate({}),
      visible_reply: "I like control.",
    },
  ]);
  assert.equal(invalid.semantic_arbitration.chosen_source, "deterministic");
  assert.ok(
    invalid.semantic_arbitration.rejected_candidates.some(
      (candidate) => candidate.reason === "candidate_contains_visible_text",
    ),
  );

  const ineligible = canonicalFor("what sort of stuff do you like?", [
    llmCandidate({
      requested_facet: "definition",
      question_shape: "definition_request",
      subject_domain: "assistant_preferences",
      current_domain_handler: "raven_preferences",
      required_referent: "Raven's kinks",
      rationale: "bad model candidate tries to define with preference handler",
    }),
  ]);
  assert.equal(ineligible.semantic_arbitration.chosen_source, "deterministic");
  assert.ok(
    ineligible.semantic_arbitration.rejected_candidates.some(
      (candidate) => candidate.reason === "unsupported_handler_eligibility",
    ),
  );
});

function assertRelationalMeaning(
  text: string,
  expected: {
    speechAct: string;
    facet: string;
    answerMode: string;
    answerContract?: string;
    slot?: keyof NonNullable<ReturnType<typeof meaningFor>["turnMeaning"]["dynamic_slots"]>;
    slotValue?: string | RegExp;
  },
  previousAssistantText =
    "We are discussing a negotiated mistress/submissive dynamic with service, chastity, rules, and limits.",
) {
  const { turnMeaning, plannedMove } = meaningFor(text, previousAssistantText);
  const intent = planAnswerIntent({ turnMeaning, plannedMove });
  const answerPlan = planDomainAnswer({ turnMeaning, plannedMove });
  const answer = realizeValidatedDomainAnswer(answerPlan) ?? "";
  const validation = validateAnswerContract(answerPlan, answer);

  assert.equal(turnMeaning.speech_act, expected.speechAct, text);
  assert.equal(turnMeaning.requested_facet, expected.facet, text);
  assert.equal(turnMeaning.answer_contract, expected.answerContract ?? expected.facet, text);
  assert.equal(turnMeaning.current_domain_handler, "relational_dynamics", text);
  assert.equal(plannedMove.content_key, "relational_dynamic_answer", text);
  assert.equal(intent.answer_mode, expected.answerMode, text);
  assert.equal(answerPlan.content_source, "relational_dynamic_model", text);
  assert.equal(validation.ok, true, `${text}: ${validation.reason}`);
  assert.doesNotMatch(
    answer,
    /Keep going|Fine\. Say what you want|I do not have enough local context to define|Give me the domain you mean/i,
    text,
  );
  if (expected.slot) {
    const slotValue = turnMeaning.dynamic_slots?.[expected.slot];
    if (expected.slotValue instanceof RegExp) {
      assert.match(String(slotValue ?? ""), expected.slotValue, text);
    } else if (expected.slotValue) {
      assert.equal(slotValue, expected.slotValue, text);
    } else {
      assert.ok(slotValue, `${text} should populate ${expected.slot}`);
    }
  }
  return { turnMeaning, plannedMove, intent, answerPlan, answer };
}

test("relational dynamic live-like transcript routes service role equipment and ambiguity", () => {
  const transcript: Array<{
    text: string;
    speechAct: string;
    facet: string;
    answerMode: string;
    slot?: keyof NonNullable<ReturnType<typeof meaningFor>["turnMeaning"]["dynamic_slots"]>;
    slotValue?: string | RegExp;
  }> = [
    {
      text: "what do you think about exposure?",
      speechAct: "ambiguous_dynamic_topic",
      facet: "ambiguous_boundary_topic",
      answerMode: "boundary_clarification",
      slot: "user_preference",
      slotValue: "exposure",
    },
    {
      text: "do you like having your slaves in chastity?",
      speechAct: "expectation_request",
      facet: "expectations",
      answerMode: "expectation_response",
      slot: "expectation",
      slotValue: /slaves? in chastity/,
    },
    {
      text: "i have a chastity cage",
      speechAct: "user_equipment_disclosure",
      facet: "equipment_disclosure",
      answerMode: "equipment_acknowledgement",
      slot: "disclosed_object",
      slotValue: "chastity cage",
    },
    {
      text: "so how can i start serving you mistress?",
      speechAct: "service_request",
      facet: "service_initiation",
      answerMode: "service_instruction",
      slot: "requested_direction",
      slotValue: "begin serving",
    },
    {
      text: "what would you like me to do for you?",
      speechAct: "request_for_direction",
      facet: "service_direction",
      answerMode: "service_instruction",
      slot: "requested_direction",
      slotValue: "what Raven wants from the user",
    },
    {
      text: "i want to be your submissive and you my mistress",
      speechAct: "role_proposal",
      facet: "role_negotiation",
      answerMode: "role_response",
      slot: "desired_role",
      slotValue: "submissive",
    },
  ];

  for (const item of transcript) {
    const result = assertRelationalMeaning(item.text, item);
    assert.ok(result.turnMeaning.eligible_domain_handlers.some((handler) => handler.handler === "relational_dynamics"));
  }
});

test("relational dynamic paraphrases generalize by function instead of exact wording", () => {
  const serviceInitiation = [
    "how can i start serving you mistress?",
    "how do i begin serving you?",
    "what should i do first for you?",
    "how do you want me to serve?",
    "i want to serve by following rules",
  ];
  for (const text of serviceInitiation) {
    assertRelationalMeaning(text, {
      speechAct: "service_request",
      facet: "service_initiation",
      answerMode: "service_instruction",
    });
  }

  for (const text of [
    "what would you like me to do for you?",
    "what do you want from me?",
    "what should I do for you?",
    "what would please you?",
  ]) {
    assertRelationalMeaning(text, {
      speechAct: "request_for_direction",
      facet: "service_direction",
      answerMode: "service_instruction",
      slot: "requested_direction",
    });
  }

  for (const text of [
    "i want to be your submissive and you my mistress",
    "i want you to be my mistress",
    "can i be your submissive?",
    "i want this to be a mistress/submissive dynamic",
    "i want to be owned",
    "i want to be your pet",
  ]) {
    assertRelationalMeaning(text, {
      speechAct: "role_proposal",
      facet: "role_negotiation",
      answerMode: "role_response",
    });
  }

  for (const text of [
    "i like being told what to do",
    "i want structure",
    "i need you to be strict with me",
    "i want to earn approval",
    "i want tasks from you",
    "i like rules",
    "i like denial",
    "i want permission rules",
  ]) {
    const result = assertRelationalMeaning(text, {
      speechAct: /rules|tasks|permission|structure|approval|denial/i.test(text)
        ? "service_preference_disclosure"
        : "user_preference_disclosure",
      facet: /rules|tasks|permission|structure|approval|denial/i.test(text) ? "service_preference" : "user_preference",
      answerMode: "focused_dynamic_followup",
    });
    assert.ok(
      result.turnMeaning.dynamic_slots?.user_preference || result.turnMeaning.dynamic_slots?.service_style,
      `${text} should populate a preference or service style slot`,
    );
  }

  for (const text of [
    "what do you think about exposure?",
    "are you into exposure?",
    "how do you feel about exposure?",
  ]) {
    assertRelationalMeaning(text, {
      speechAct: "ambiguous_dynamic_topic",
      facet: "ambiguous_boundary_topic",
      answerMode: "boundary_clarification",
      slot: "user_preference",
      slotValue: "exposure",
    });
  }
});

test("relational equipment disclosures extract unseen objects into slots", () => {
  for (const [text, object] of [
    ["i have a plug", "plug"],
    ["i bought a collar", "collar"],
    ["i have cuffs", "cuffs"],
    ["i have rope", "rope"],
    ["i have a remote toy", "remote toy"],
  ] as const) {
    const result = assertRelationalMeaning(text, {
      speechAct: "user_equipment_disclosure",
      facet: "equipment_disclosure",
      answerMode: "equipment_acknowledgement",
      slot: "disclosed_object",
      slotValue: object,
    });
    assert.equal(result.turnMeaning.primary_subject, object);
    assert.ok(result.turnMeaning.entity_set.includes(object));
  }
});

test("relational compound equipment proposals expose components and satisfy every answer slot", () => {
  const cases: Array<[string, string[]]> = [
    ["i have a cage and plug, would you want me to use them?", ["cage", "plug"]],
    ["i bought a collar and leash, should i use them for you?", ["collar", "leash"]],
    ["i have restraints and a toy, how would you want them used?", ["restraints", "toy"]],
    ["i have gear that could help me serve better", ["gear"]],
  ];

  for (const [text, objects] of cases) {
    const result = assertRelationalMeaning(text, {
      speechAct: "user_equipment_disclosure",
      facet: "equipment_disclosure",
      answerContract: text.includes("could help")
        ? "equipment_disclosure"
        : "compound_equipment_application",
      answerMode: text.includes("could help")
        ? "equipment_acknowledgement"
        : "dynamic_application_response",
    });
    assert.deepEqual(result.turnMeaning.dynamic_slots?.disclosed_objects, objects, text);
    if (!text.includes("could help")) {
      assert.equal(result.turnMeaning.compound_intent, true, text);
      assert.ok(result.turnMeaning.requested_facets.includes("equipment_disclosure"), text);
      assert.ok(result.turnMeaning.requested_facets.includes("dynamic_application"), text);
      assert.ok(result.turnMeaning.requested_facets.includes("invitation_response"), text);
      assert.ok(result.turnMeaning.dynamic_slots?.invitation_or_proposal, text);
      assert.equal(result.turnMeaning.dynamic_slots?.proposal_target, "use_in_dynamic", text);
      assert.match(result.answer, /yes|conditionally|limits|protocol|physically control/i, text);
      assert.doesNotMatch(result.answer, /\byou have\b[^.?!]{0,120}\bwould you like\b/i, text);
    }
  }
});

test("relational continuations attach to the prior semantic plan instead of stale scaffolds", () => {
  const rolePrior =
    "You have three clean role options here: submissive, service submissive, or pet. My recommendation is service submissive first.";
  for (const text of [
    "yes please, explain it",
    "yes please mistress, explain it",
    "explain that more",
    "what do you mean by that?",
    "how would that work?",
  ]) {
    const result = assertRelationalMeaning(text, {
      speechAct: "clarification",
      facet: "role_negotiation",
      answerMode: "role_response",
    }, rolePrior);
    assert.equal(result.turnMeaning.continuity_attachment, "immediate_prior_answer", text);
    assert.equal(result.turnMeaning.primary_subject, "role guidance", text);
    assert.match(result.answer, /role|submissive|recommendation|choose|limits/i, text);
  }

  const equipmentPrior =
    "Noted: you have chastity cage and butt plug. We can decide what they mean in the dynamic, with limits.";
  const tellMeHow = assertRelationalMeaning("tell me how", {
    speechAct: "clarification",
    facet: "dynamic_application",
    answerMode: "dynamic_application_response",
  }, equipmentPrior);
  assert.equal(tellMeHow.turnMeaning.continuity_attachment, "immediate_prior_answer");
  assert.deepEqual(tellMeHow.turnMeaning.dynamic_slots?.disclosed_objects, ["chastity cage", "butt plug"]);
  assert.match(tellMeHow.answer, /chastity cage|butt plug|protocol|limits|physically enforce/i);
});

test("relational service direction paraphrases require concrete bounded realization", () => {
  for (const text of [
    "what things can i do to serve you now?",
    "what should i do first?",
    "how can i start serving?",
    "what would please you?",
  ]) {
    const result = assertRelationalMeaning(text, {
      speechAct: /what should i do first|how can i start serving/.test(text)
        ? "service_request"
        : "request_for_direction",
      facet: /what should i do first|how can i start serving/.test(text)
        ? "service_initiation"
        : "service_direction",
      answerMode: "service_instruction",
    });
    assert.match(result.answer, /check-in|one limit|service lane|rules|tasks|permission|approval/i, text);
  }
});

test("relational typo normalization records low-risk domain corrections", () => {
  const result = assertRelationalMeaning("i have toys and things that i can use to server better as well", {
    speechAct: "user_equipment_disclosure",
    facet: "equipment_disclosure",
    answerMode: "equipment_acknowledgement",
  });
  assert.equal(result.turnMeaning.normalization_applied, true);
  assert.equal(
    result.turnMeaning.normalization_reason,
    "low-risk semantic typo correction: server better -> serve better in active service/equipment context",
  );
  assert.match(result.turnMeaning.normalized_text, /serve better/);
  assert.deepEqual(result.turnMeaning.dynamic_slots?.disclosed_objects, ["toys", "things"]);
});

test("compound relational disclosures separate goals training and limits from equipment", () => {
  const exact = assertRelationalMeaning(
    "I want to do tasks, have my boundaries pushed, have anal training and my limit is scat",
    {
      speechAct: "compound_relational_disclosure",
      facet: "compound_relational_disclosure",
      answerMode: "focused_dynamic_followup",
    },
  );
  assert.deepEqual(exact.turnMeaning.dynamic_slots?.desired_service_lanes, ["tasks"]);
  assert.deepEqual(exact.turnMeaning.dynamic_slots?.intensity_preferences, ["boundaries pushed"]);
  assert.deepEqual(exact.turnMeaning.dynamic_slots?.training_goals, ["anal training"]);
  assert.deepEqual(exact.turnMeaning.dynamic_slots?.hard_limits, ["scat"]);
  assert.equal(exact.turnMeaning.dynamic_slots?.disclosed_object, null);
  assert.deepEqual(exact.turnMeaning.dynamic_slots?.disclosed_objects, []);
  assert.doesNotMatch(exact.answer, /\byou have\b|\bequipment\b/i);
  assert.match(exact.answer, /tasks|anal training|scat|off-limits|Bounded start/i);

  for (const text of [
    "I want tasks, training, and my hard limit is scat",
    "I want rules and anal training, but no scat",
    "I want my boundaries pushed but my limit is scat",
    "I want to earn approval through tasks",
  ]) {
    const result = assertRelationalMeaning(text, {
      speechAct: "compound_relational_disclosure",
      facet: "compound_relational_disclosure",
      answerMode: "focused_dynamic_followup",
    });
    assert.ok(
      (result.turnMeaning.dynamic_slots?.training_goals.length ?? 0) > 0 ||
        (result.turnMeaning.dynamic_slots?.hard_limits.length ?? 0) > 0 ||
        (result.turnMeaning.dynamic_slots?.dynamic_goals.length ?? 0) > 0,
      text,
    );
    assert.deepEqual(result.turnMeaning.dynamic_slots?.disclosed_objects, [], text);
  }

  const tasksAndRules = assertRelationalMeaning("i want tasks and rules", {
    speechAct: "service_preference_disclosure",
    facet: "service_preference",
    answerMode: "focused_dynamic_followup",
  });
  assert.equal(tasksAndRules.turnMeaning.answer_contract, "service_preference");

  const equipment = assertRelationalMeaning("i have a chastity cage and butt plug", {
    speechAct: "user_equipment_disclosure",
    facet: "equipment_disclosure",
    answerMode: "equipment_acknowledgement",
  });
  assert.deepEqual(equipment.turnMeaning.dynamic_slots?.disclosed_objects, ["chastity cage", "butt plug"]);

  const ropeAndCuffs = assertRelationalMeaning("i have rope and cuffs", {
    speechAct: "user_equipment_disclosure",
    facet: "equipment_disclosure",
    answerMode: "equipment_acknowledgement",
  });
  assert.deepEqual(ropeAndCuffs.turnMeaning.dynamic_slots?.disclosed_objects, ["rope", "cuffs"]);
});

test("relational confusion recovery attaches to the previous substantive ask", () => {
  const prior =
    "Do this first: send a clean three-line check-in with your role, one limit I should respect, and the service lane you want now: rules, tasks, permission, or approval. That gives me enough to direct you without making the dynamic sloppy.";
  for (const text of [
    "i dont understand",
    "i dont understand what you are asking for",
    "what are you asking me to do",
    "explain that more simply",
    "can you give me an example",
    "what do you mean?",
  ]) {
    const result = assertRelationalMeaning(text, {
      speechAct: "user_confusion",
      facet: "clarification_recovery",
      answerMode: "clarification_explanation",
    }, prior);
    assert.equal(result.turnMeaning.dynamic_slots?.previous_ask_type, "service_setup_checkin", text);
    assert.equal(result.turnMeaning.dynamic_slots?.clarification_recovery_used, true, text);
    assert.match(result.answer, /plain language|You can answer like this|role|limit|service lane/i, text);
    assert.doesNotMatch(result.answer, /Keep going|concrete part|I mean my last point/i, text);
  }
});

test("relational dynamic state records proposals disclosures and boundaries", () => {
  let state = createRelationalDynamicState();
  for (const text of [
    "i have a chastity cage",
    "i want permission rules",
    "i want to be your submissive and you my mistress",
  ]) {
    const result = assertRelationalMeaning(text, {
      speechAct: text.includes("cage")
        ? "user_equipment_disclosure"
        : text.includes("permission")
          ? "service_preference_disclosure"
          : "role_proposal",
      facet: text.includes("cage")
        ? "equipment_disclosure"
        : text.includes("permission")
          ? "service_preference"
          : "role_negotiation",
      answerMode: text.includes("cage")
        ? "equipment_acknowledgement"
        : text.includes("permission")
          ? "focused_dynamic_followup"
          : "role_response",
    });
    state = applyRelationalDynamicStateUpdate(state, {
      eligible: true,
      speech_act: result.turnMeaning.speech_act as never,
      requested_facet: result.turnMeaning.requested_facet as never,
      answer_contract: result.turnMeaning.answer_contract as never,
      answer_mode: result.intent.answer_mode as never,
      primary_subject: result.turnMeaning.primary_subject,
      entity_set: result.turnMeaning.entity_set,
      slots: result.turnMeaning.dynamic_slots!,
      components: result.turnMeaning.components.map((component) => ({
        speech_act: component.speech_act as never,
        requested_facet: component.requested_facet as never,
        answer_contract: component.answer_contract as never,
        primary_subject: component.primary_subject ?? component.referent,
        entity_set: component.entity_set ?? [],
      })),
      confidence: result.turnMeaning.confidence,
      reason: "test update",
    });
  }
  assert.ok(state.known_user_equipment.includes("chastity cage"));
  assert.ok(state.known_user_service_preferences.some((item) => /permission/.test(item)));
  assert.equal(state.proposed_user_role, "submissive");
  assert.equal(state.proposed_raven_role, "mistress");
  assert.equal(state.accepted_dynamic_yes_no_unknown, "unknown");
  assert.equal(state.boundaries_discussed_yes_no, "yes");
});
