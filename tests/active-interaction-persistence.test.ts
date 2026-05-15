import test from "node:test";
import assert from "node:assert/strict";

import { createCommitmentState } from "../lib/session/commitment-engine.ts";
import { createSceneState } from "../lib/session/scene-state.ts";
import { applyResponseGate } from "../lib/session/response-gate.ts";
import {
  createActiveInteractionState,
  createActiveInteractionStateOwner,
  normalizeActiveInteractionState,
  shouldAcceptActiveInteractionStateUpdate,
  type ActiveInteractionState,
  type ActiveInteractionStateOwner,
} from "../lib/session/active-interaction.ts";
import {
  normalizePreviousResponseBriefSummary,
  type PreviousResponseBriefSummary,
} from "../lib/session/response-brief.ts";

type ClientState = {
  activeInteraction: ActiveInteractionState | null;
  previousResponseBrief: PreviousResponseBriefSummary | null;
  owner: ActiveInteractionStateOwner | null;
};

function cloneForRequest<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runSeparateRequestTurn(
  client: ClientState,
  userText: string,
  index: number,
  candidateText = "Keep going.",
  candidateSource = "scene_fallback",
) {
  const activeBefore =
    normalizeActiveInteractionState(cloneForRequest(client.activeInteraction)) ??
    createActiveInteractionState();
  const previousBrief =
    normalizePreviousResponseBriefSummary(cloneForRequest(client.previousResponseBrief)) ?? null;
  const gated = applyResponseGate({
    text: candidateText,
    candidateSource,
    userText,
    dialogueAct: "user_question",
    lastAssistantText:
      previousBrief?.previous_plain_language_summary ??
      activeBefore.last_assistant_instruction?.plain_language_summary ??
      null,
    toneProfile: "dominant",
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    previousResponseBrief: previousBrief,
    activeInteraction: activeBefore,
    commitOwnerId: `request-${index}`,
  });
  const owner = createActiveInteractionStateOwner({
    requestId: `request-${index}`,
    turnId: String(index),
    userMessageId: index,
    assistantTurnId: `assistant-${index}`,
    committedAtMs: index,
  });
  const incoming = normalizeActiveInteractionState(
    cloneForRequest(gated.semanticTrace.active_interaction_after),
  );
  const decision = shouldAcceptActiveInteractionStateUpdate({
    current: client.activeInteraction,
    incoming,
    currentOwner: client.owner,
    incomingOwner: owner,
  });
  assert.equal(decision.accept, true, `${userText}: ${decision.reason}`);
  client.activeInteraction = incoming;
  client.previousResponseBrief =
    normalizePreviousResponseBriefSummary(
      gated.semanticTrace.persisted_response_brief_summary,
    ) ?? client.previousResponseBrief;
  client.owner = owner;
  return {
    userText,
    text: gated.text,
    trace: gated.semanticTrace,
    activeBefore,
    activeAfter: incoming,
    statePersistence: {
      state_returned_to_server: Boolean(activeBefore.active_interaction_id),
      state_persisted_to_client: decision.accept,
      previous_instruction_id:
        activeBefore.last_assistant_instruction?.instruction_id ?? null,
      active_state_created_this_turn: Boolean(gated.semanticTrace.active_state_created_this_turn),
      active_state_creation_reason: gated.semanticTrace.active_state_creation_reason,
      previous_response_brief_created_this_turn: Boolean(
        gated.semanticTrace.previous_response_brief_created_this_turn,
      ),
      previous_response_brief_sent_to_server: Boolean(
        gated.semanticTrace.previous_response_brief_sent_to_server,
      ),
      previous_response_brief_received_by_server: Boolean(
        gated.semanticTrace.previous_response_brief_received_by_server,
      ),
      last_assistant_instruction_created_this_turn: Boolean(
        gated.semanticTrace.last_assistant_instruction_created_this_turn,
      ),
      last_assistant_instruction_sent_to_server: Boolean(
        gated.semanticTrace.last_assistant_instruction_sent_to_server,
      ),
    },
  };
}

test("active interaction state survives separate live-style request payloads", () => {
  const client: ClientState = {
    activeInteraction: createActiveInteractionState(),
    previousResponseBrief: null,
    owner: null,
  };
  const transcript = [
    "hi",
    "i want to be your submissive",
    "what can my role be?",
    "what can i do to serve you now?",
    "I want to do tasks, have my boundaries pushed, have anal training and my limit is scat",
    "what do you mean?",
    "i dont understand what you are asking for",
    "now what do i do?",
    "i am ready for what is next",
  ];
  const turns = transcript.map((line, index) => runSeparateRequestTurn(client, line, index + 1));

  for (let index = 1; index < turns.length; index += 1) {
    const previousAfter = turns[index - 1]?.activeAfter;
    const nextBefore = turns[index]?.activeBefore;
    if (previousAfter?.active_interaction_id) {
      assert.equal(
        nextBefore?.active_interaction_id,
        previousAfter.active_interaction_id,
        turns[index]?.userText,
      );
      assert.equal(turns[index]?.statePersistence.state_returned_to_server, true);
    }
    assert.equal(turns[index]?.statePersistence.state_persisted_to_client, true);
    assert.doesNotMatch(turns[index]?.text ?? "", /in this game|the game continues|best three out of five|keep going/i);
  }

  const compound = turns.find((turn) => turn.userText.startsWith("I want to do tasks"));
  assert.ok(compound?.trace.active_interaction_after?.last_assistant_instruction);
  assert.deepEqual(compound.trace.turn_meaning.dynamic_slots?.hard_limits, ["scat"]);
  assert.deepEqual(compound.trace.turn_meaning.dynamic_slots?.training_goals, ["anal training"]);

  const clarification = turns.find((turn) => turn.userText === "what do you mean?");
  assert.ok(clarification?.trace.active_interaction_before?.last_assistant_instruction);
  assert.equal(
    clarification.trace.previous_instruction_id,
    clarification.trace.active_interaction_before?.last_assistant_instruction?.instruction_id,
  );
  assert.equal(clarification.trace.turn_meaning.requested_facet, "clarification_recovery");

  const nextStep = turns.find((turn) => turn.userText === "now what do i do?");
  assert.equal(nextStep?.trace.turn_meaning.speech_act, "next_step_request");
  assert.equal(
    nextStep?.trace.response_brief?.active_interaction_id,
    nextStep?.trace.active_interaction_before?.active_interaction_id,
  );

  const readiness = turns.find((turn) => turn.userText === "i am ready for what is next");
  assert.equal(readiness?.trace.turn_meaning.speech_act, "readiness_confirmation");
  assert.ok(readiness?.trace.active_interaction_after?.updated_at_turn_id);
});

test("stale active interaction updates cannot overwrite newer committed state", () => {
  const current = {
    ...createActiveInteractionState(),
    active_interaction_id: "interaction-current",
    status: "awaiting_progress_report" as const,
    updated_at_turn_id: "request-9",
  };
  const staleIncoming = {
    ...current,
    current_step_id: "old-step",
    updated_at_turn_id: "request-8",
  };
  const decision = shouldAcceptActiveInteractionStateUpdate({
    current,
    incoming: staleIncoming,
    currentOwner: createActiveInteractionStateOwner({
      requestId: "request-9",
      turnId: "9",
      userMessageId: 9,
      assistantTurnId: "assistant-9",
      committedAtMs: 900,
    }),
    incomingOwner: createActiveInteractionStateOwner({
      requestId: "request-8",
      turnId: "8",
      userMessageId: 8,
      assistantTurnId: "assistant-8",
      committedAtMs: 800,
    }),
  });

  assert.equal(decision.accept, false);
  assert.equal(decision.reason, "stale_user_message_owner");
});

test("browser-path active-state chain keeps relational setup authoritative", () => {
  const client: ClientState = {
    activeInteraction: createActiveInteractionState(),
    previousResponseBrief: null,
    owner: null,
  };
  const roleSetupAsk =
    "Yes, we can discuss a mistress/submissive dynamic. My recommendation is to start as negotiated service submission: roles, limits, stop conditions, and one check-in before anything heavier. Choose the first rule you want me to hold you to.";
  const turns = [
    runSeparateRequestTurn(client, "hi", 1),
    runSeparateRequestTurn(client, "i want to be your submissive", 2, roleSetupAsk, "raw_model"),
    runSeparateRequestTurn(client, "what do you think should be the first rule?", 3),
    runSeparateRequestTurn(client, "yes mistress", 4),
    runSeparateRequestTurn(client, "i would like to be trained in anal and chastity", 5),
    runSeparateRequestTurn(client, "ok so how about a daily task?", 6),
  ];

  const setup = turns[1]!;
  assert.equal(setup.trace.turn_meaning.current_domain_handler, "relational_dynamics");
  assert.equal(setup.trace.active_state_created_this_turn, true);
  assert.match(setup.trace.active_state_creation_reason ?? "", /assistant_ask_detected|role_negotiation/);
  assert.equal(setup.trace.previous_response_brief_created_this_turn, true);
  assert.equal(setup.trace.last_assistant_instruction_created_this_turn, true);
  assert.equal(setup.activeAfter?.interaction_type, "relational_setup");
  assert.equal(setup.activeAfter?.status, "awaiting_user_answer");
  assert.equal(setup.activeAfter?.awaiting_user_input_type, "rule_selection");
  assert.match(
    setup.activeAfter?.last_assistant_instruction?.plain_language_summary ?? "",
    /choose the first rule/i,
  );
  assert.equal(setup.activeAfter?.last_assistant_instruction?.expected_user_response_type, "rule_selection");
  assert.match(setup.activeAfter?.last_assistant_instruction?.example_user_response ?? "", /check-in rule/i);
  assert.equal(setup.activeAfter?.previous_response_brief_id, setup.trace.response_brief_id);

  for (let index = 2; index < turns.length; index += 1) {
    const previous = turns[index - 1]!;
    const turn = turns[index]!;
    assert.equal(
      turn.trace.active_interaction_before_request_client?.active_interaction_id,
      previous.trace.active_interaction_after?.active_interaction_id,
      turn.userText,
    );
    assert.equal(
      turn.trace.active_interaction_sent_to_server?.active_interaction_id,
      previous.trace.active_interaction_after?.active_interaction_id,
      turn.userText,
    );
    assert.equal(
      turn.trace.active_interaction_received_by_server?.active_interaction_id,
      previous.trace.active_interaction_after?.active_interaction_id,
      turn.userText,
    );
    assert.equal(
      turn.trace.active_interaction_before_routing?.active_interaction_id,
      previous.trace.active_interaction_after?.active_interaction_id,
      turn.userText,
    );
    assert.equal(turn.trace.active_interaction_route_considered, true, turn.userText);
    assert.equal(turn.trace.chosen_route, "relational_dynamic", turn.userText);
    assert.equal(turn.trace.conversation_mode_overridden_by_active_interaction, true, turn.userText);
    assert.equal(turn.trace.previous_response_brief_sent_to_server, true, turn.userText);
    assert.equal(turn.trace.previous_response_brief_received_by_server, true, turn.userText);
    assert.equal(turn.trace.last_assistant_instruction_sent_to_server, true, turn.userText);
    assert.equal(turn.trace.last_assistant_instruction_used_for_followup, true, turn.userText);
    assert.doesNotMatch(
      turn.text,
      /Keep going|concrete part of open|Stay with the concrete part|rock paper scissors|rules of this game|The game continues/i,
      turn.userText,
    );
    assert.notEqual(turn.trace.winning_subsystem, "legacy_repair", turn.userText);
  }

  const firstRule = turns[2]!;
  assert.equal(firstRule.trace.turn_meaning.requested_facet, "protocol_setup");
  assert.equal(firstRule.trace.rejected_game_reason, "active_relational_interaction_blocks_game_route");

  const acknowledgement = turns[3]!;
  assert.equal(acknowledgement.trace.turn_meaning.speech_act, "readiness_confirmation");
  assert.equal(acknowledgement.trace.turn_meaning.requested_facet, "active_readiness_confirmation");
  assert.notEqual(acknowledgement.text, firstRule.text);
  assert.doesNotMatch(acknowledgement.text, /what I think should be the first rule/i);

  const training = turns[4]!;
  assert.equal(training.trace.turn_meaning.requested_facet, "training_guidance");
  assert.deepEqual(training.trace.turn_meaning.dynamic_slots?.training_goals, [
    "anal training",
    "chastity training",
  ]);
  assert.doesNotMatch(training.text, /Keep going|concrete part|open/i);

  const dailyTask = turns[5]!;
  assert.equal(dailyTask.trace.turn_meaning.requested_facet, "service_task");
  assert.equal(dailyTask.trace.turn_meaning.dynamic_slots?.daily_task_requested, true);
  assert.equal(dailyTask.trace.validation_result?.ok, true);
  assert.match(dailyTask.text, /\b(daily|once a day|every day|each day)\b/i);
  assert.match(dailyTask.text, /\b(report|check[- ]?in|send|write)\b/i);
  assert.match(dailyTask.text, /\b(role|limit|boundary|service intention|service action|intention)\b/i);
  assert.doesNotMatch(dailyTask.text, /\bcomplete the current checkpoint\b|\bcurrent checkpoint\b/i);
});

test("active-state delta replay adapts instead of repeating and handles feedback", () => {
  const client: ClientState = {
    activeInteraction: createActiveInteractionState(),
    previousResponseBrief: null,
    owner: null,
  };
  const turns = [
    runSeparateRequestTurn(client, "hi mistress", 1),
    runSeparateRequestTurn(client, "i want to be your submissive", 2),
    runSeparateRequestTurn(client, "i agree service submissive is a good first step", 3),
    runSeparateRequestTurn(client, "i want to be trained in anal and chastity", 4),
    runSeparateRequestTurn(client, "i dont have much training", 5),
    runSeparateRequestTurn(client, "why are you repeating?>", 6),
  ];

  const roleAcceptance = turns[2]!;
  assert.equal(roleAcceptance.trace.turn_meaning.speech_act, "readiness_confirmation");
  assert.equal(roleAcceptance.trace.state_delta_detected, true);
  assert.equal(roleAcceptance.trace.state_delta_type, "user_preference_delta");
  assert.deepEqual(roleAcceptance.trace.new_slots_added, ["desired_role"]);
  assert.doesNotMatch(roleAcceptance.text, /follow Choose|Choose a role frame|Keep going/i);
  assert.equal(roleAcceptance.trace.internal_instruction_summary_rendered, false);
  assert.equal(roleAcceptance.trace.instruction_renderable_field_used, true);
  assert.match(roleAcceptance.text, /service submissive/i);
  assert.match(roleAcceptance.text, /boundary/i);

  const training = turns[3]!;
  assert.equal(training.trace.turn_meaning.requested_facet, "training_guidance");
  assert.deepEqual(training.trace.turn_meaning.dynamic_slots?.training_goals, [
    "anal training",
    "chastity training",
  ]);
  assert.deepEqual(training.activeAfter?.training_goals, [
    "anal training",
    "chastity training",
  ]);
  assert.match(training.text, /\banal\b/i);
  assert.match(training.text, /\bchastity\b/i);

  const experienceDelta = turns[4]!;
  assert.equal(experienceDelta.trace.state_delta_detected, true);
  assert.equal(experienceDelta.trace.state_delta_type, "user_experience_delta");
  assert.deepEqual(experienceDelta.trace.new_slots_added, ["experience_level"]);
  assert.equal(experienceDelta.activeAfter?.known_experience_level, "beginner");
  assert.deepEqual(experienceDelta.activeAfter?.training_goals, [
    "anal training",
    "chastity training",
  ]);
  assert.equal(experienceDelta.trace.repeated_answer_detected, false);
  assert.equal(experienceDelta.trace.repetition_repair_used, false);
  assert.match(experienceDelta.text, /\b(beginner|low experience|not much training)\b/i);
  assert.match(experienceDelta.text, /\banal\b/i);
  assert.match(experienceDelta.text, /\bchastity\b/i);
  assert.doesNotMatch(experienceDelta.text, /follow Choose|Choose a role frame|Keep going/i);

  const feedback = turns[5]!;
  assert.equal(feedback.trace.turn_meaning.speech_act, "complaint_about_response");
  assert.equal(feedback.trace.turn_meaning.requested_facet, "response_correction");
  assert.equal(feedback.trace.meta_feedback_detected, true);
  assert.equal(feedback.trace.state_delta_type, "meta_feedback");
  assert.match(feedback.text, /right|repeated|correct course/i);
  assert.match(feedback.text, /\banal\b/i);
  assert.match(feedback.text, /\bchastity\b/i);
  assert.match(feedback.text, /\bbeginner\b|\blow experience\b/i);
  assert.doesNotMatch(feedback.text, /Because that is where|Keep going|follow Choose|Choose a role frame/i);

  for (const turn of turns.slice(1)) {
    assert.equal(turn.trace.active_interaction_accepted_by_client, true, turn.userText);
    assert.ok(turn.trace.active_interaction_after?.active_interaction_id, turn.userText);
  }
});

test("live-style role-to-task flow preserves type boundary, role state, task selection, and repair anchoring", () => {
  const client: ClientState = {
    activeInteraction: createActiveInteractionState(),
    previousResponseBrief: null,
    owner: null,
  };
  const transcript = [
    "hi mistress",
    "i want to be your sub",
    "that sounds like a good fit for me",
    "ill be your service submissive",
    "i want tasks",
    "do you have one to give me?",
    "can you give me the first task, i want you to pick it",
    "what does that mean? can you give me more details?",
  ];
  const turns = transcript.map((line, index) =>
    runSeparateRequestTurn(client, line, index + 1, "Good. Keep the same subject, but answer this change directly.", "repair_turn"),
  );

  const roleAccepted = turns.find((turn) =>
    Boolean(turn.trace.active_interaction_after?.accepted_dynamic),
  );
  assert.ok(roleAccepted, "role state should be accepted or selected");
  assert.ok(roleAccepted?.trace.active_interaction_after?.selected_user_role, "selected role persists");
  assert.notEqual(
    roleAccepted?.trace.active_interaction_after?.accepted_dynamic,
    null,
    "accepted dynamic should synchronize with role acceptance",
  );
  assert.deepEqual(
    roleAccepted?.trace.active_interaction_after?.pending_unaddressed_slots?.includes("role"),
    false,
    "stale role-choice loop should be cleared",
  );

  const taskTurns = turns.filter((turn) => turn.trace.turn_meaning.requested_facet === "service_task");
  assert.ok(taskTurns.length >= 1, "task request should stay in service task lane");
  for (const turn of taskTurns) {
    assert.equal(turn.trace.strict_relational_authority, true, turn.userText);
    assert.equal(turn.trace.final_visible_owner, "approved_response_brief_fallback", turn.userText);
    assert.match(turn.text, /\b(selected task|do this|your task is|start with|complete)\b/i, turn.userText);
    assert.match(turn.text, /\b(report|report back|send|write|check[- ]?in)\b/i, turn.userText);
    assert.doesNotMatch(turn.text, /provide a direct instruction|choose the task|what task you want/i, turn.userText);
    assert.equal(turn.trace.visible_commit_allowed, true, turn.userText);
  }

  const clarification = turns[turns.length - 1];
  assert.equal(clarification.trace.turn_meaning.requested_facet, "clarification_recovery");
  assert.equal(clarification.trace.strict_relational_authority, true);
  assert.match(clarification.text, /\bplain language|mean|asked|example|report|boundary|check[- ]?in\b/i);
  for (const turn of turns.slice(1)) {
    assert.doesNotMatch(
      turn.text,
      /Good\. Keep the same subject|I can answer Raven gave|I'm going to need you to provide|answer_mode|requested_facet|nonvisible_|current_step_summary/i,
      turn.userText,
    );
    assert.equal(turn.trace.visible_commit_allowed, true, turn.userText);
  }
});
