import test from "node:test";
import assert from "node:assert/strict";

import { createCommitmentState } from "../lib/session/commitment-engine.ts";
import { explainBypassModelForSceneTurn } from "../lib/session/deterministic-scene-routing.ts";
import type { ActiveInteractionState } from "../lib/session/active-interaction.ts";
import { shouldAllowVisibleAssistantCommit } from "../lib/session/live-turn-integrity.ts";
import { applyResponseGate } from "../lib/session/response-gate.ts";
import { createSceneState } from "../lib/session/scene-state.ts";
import { buildResponseBrief, validateDeterministicFallbackProse, validateReplyAgainstBrief } from "../lib/session/response-brief.ts";
import {
  commitVisibleOutput,
  recordVisibleCandidate,
  selectVisibleOutputOwner,
  visibleTextImpliesUnlimitedConsent,
  type VisibleOutputCandidateKind,
} from "../lib/session/visible-output-authority.ts";

const relationalActiveInteraction: ActiveInteractionState = {
  active_interaction_id: "active-rel-1",
  interaction_type: "relational_setup",
  domain_handler: "relational_dynamics",
  status: "awaiting_user_answer",
  current_step_id: "rule-selection",
  current_step_summary: "choosing the first rule",
  previous_step_summary: null,
  next_step_policy: "answer from the active relational setup",
  user_goal: "service submissive setup",
  known_limits: [],
  known_boundaries: [],
  known_equipment: [],
  known_preferences: [],
  known_service_preferences: [],
  known_experience_level: null,
  awaiting_user_input_type: "rule_selection",
  last_assistant_instruction: {
    instruction_id: "instr-rule-1",
    plain_language_summary: "Raven asked the user to choose the first rule.",
    expected_user_response_type: "rule_selection",
    required_slots: ["rule"],
    example_user_response: "Start with a daily check-in rule.",
    safety_or_boundary_notes: ["Limits and stop conditions still apply."],
    linked_response_brief_id: "brief-rule-1",
    linked_active_interaction_id: "active-rel-1",
  },
  last_assistant_question: null,
  last_user_progress_report: null,
  last_user_confusion: null,
  stop_or_pause_signal_seen: false,
  safety_review_required: false,
  created_from_turn_id: "turn-1",
  updated_at_turn_id: "turn-1",
  current_task_lane: null,
  daily_task_requested: false,
  training_goals: [],
  protocol_rules: [],
  previous_response_brief_id: "brief-rule-1",
  answered_topics: [],
  last_answer_signature: null,
  last_answered_slots: [],
  pending_unaddressed_slots: ["rule"],
  user_feedback_on_last_response: null,
  role_options_offered: ["submissive", "service submissive", "pet"],
  selected_user_role: null,
  role_negotiation_status: "offered",
  accepted_dynamic: null,
  current_selected_task: null,
};

function gate(input: {
  text: string;
  userText: string;
  candidateSource?: string;
  lastAssistantText?: string | null;
  activeInteraction?: ActiveInteractionState | null;
}) {
  return applyResponseGate({
    text: input.text,
    candidateSource: input.candidateSource ?? "raw_model",
    userText: input.userText,
    lastAssistantText: input.lastAssistantText ?? null,
    sceneState: createSceneState(),
    commitmentState: createCommitmentState(),
    activeInteraction: input.activeInteraction ?? null,
  });
}

test("relational turn uses approved response-brief owner for final visible prose", () => {
  const result = gate({
    text: "Yes. Start as a service submissive: choose one rule, name one limit, and keep the first step small.",
    userText: "i want to be your submissive",
  });

  assert.equal(result.semanticTrace.turn_meaning.current_domain_handler, "relational_dynamics");
  assert.equal(
    result.semanticTrace.final_visible_owner,
    "approved_llm_renderer_from_response_brief",
  );
  assert.equal(result.semanticTrace.llm_renderer_used, true);
  assert.equal(result.semanticTrace.visible_commit_allowed, true);
});

test("failed live flow regression keeps visible authority on every assistant line", () => {
  const turns = [
    "hi",
    "what?",
    "i just want to become your sub",
    "huh?",
    "i would become your sub and be trained in the way to be a better submissive",
  ];
  let lastAssistantText: string | null = null;

  for (const userText of turns) {
    const result = gate({
      text: "Yes. I understand. Tell me one concrete training goal.",
      userText,
      lastAssistantText,
    });
    const trace = result.semanticTrace;

    assert.equal(trace.authority_trace_present, true);
    assert.equal(trace.server_authority_sentinel, "SERVER_AUTHORITY_COMMIT_V2");
    assert.equal(typeof trace.server_commit_path, "string");
    assert.ok(trace.server_commit_path);
    assert.equal(trace.candidate_kind, "visible_assistant_prose");
    assert.equal(trace.visible_commit_allowed, true);
    assert.equal(trace.client_generated_reply_used, false);

    lastAssistantText = result.text;
  }
});

test("active relational next-step request cannot return Keep going from legacy fallback", () => {
  const result = gate({
    text: "Keep going.",
    userText: "so what do i do now?",
    candidateSource: "weak_input_reply",
    activeInteraction: relationalActiveInteraction,
  });

  assert.doesNotMatch(result.text, /^keep going\.?$/i);
  assert.equal(result.semanticTrace.legacy_visible_emitter_blocked, true);
  assert.equal(result.semanticTrace.final_visible_owner, "approved_response_brief_fallback");
  assert.equal(result.semanticTrace.visible_commit_allowed, true);
});

test("game scaffold candidates are recorded and blocked for relational turns", () => {
  const result = gate({
    text: "We stay on one game thread. Best three out of five.",
    userText: "what do you want from your submissive?",
    candidateSource: "game_scaffold",
    activeInteraction: relationalActiveInteraction,
  });

  assert.equal(result.semanticTrace.scene_scaffold_candidate_created, true);
  assert.equal(result.semanticTrace.scene_scaffold_candidate_used, false);
  assert.equal(result.semanticTrace.legacy_visible_emitter_blocked, true);
  assert.doesNotMatch(result.text, /game thread|best three out of five/i);
});

test("response gate records replacement chain when legacy visible emitter is blocked", () => {
  const result = gate({
    text: "Stay with the concrete part.",
    userText: "why are you repeating?",
    candidateSource: "repair_turn",
    activeInteraction: relationalActiveInteraction,
  });

  assert.equal(result.semanticTrace.legacy_visible_emitter_blocked, true);
  assert.ok(result.semanticTrace.replacement_chain.length >= 1);
  assert.match(
    result.semanticTrace.replacement_chain.map((entry) => entry.reason).join(" "),
    /legacy|visible_output|repair|filler|semantic|response_brief/i,
  );
  assert.doesNotMatch(result.text, /stay with the concrete part/i);
});

test("deterministic scene bypass is blocked for ordinary semantic conversation", () => {
  const scene = createSceneState();
  const decision = explainBypassModelForSceneTurn({
    sceneState: {
      topic_type: scene.topic_type,
      topic_locked: scene.topic_locked,
      scene_type: scene.scene_type,
      interaction_mode: "normal_chat",
      task_hard_lock_active: false,
    },
    dialogueAct: "user_question",
    hasDeterministicCandidate: true,
    latestUserText: "what kinks do you like?",
  });

  assert.equal(decision.bypass, false);
  assert.equal(decision.reason, "ordinary_conversation_blocks_deterministic_bypass");
});

test("client cannot commit locally generated fallback after server output exists", () => {
  const serverCommit = shouldAllowVisibleAssistantCommit({
    sourceUserMessageId: 42,
    normalizedText: "server approved response",
    existingVisibleNormalizedText: null,
  });
  const localFallbackCommit = shouldAllowVisibleAssistantCommit({
    sourceUserMessageId: 42,
    normalizedText: "client generated fallback",
    existingVisibleNormalizedText: "server approved response",
  });

  assert.equal(serverCommit.allow, true);
  assert.equal(localFallbackCommit.allow, false);
  assert.equal(localFallbackCommit.reason, "second_visible_reply_same_turn");
});

test("final trace contains visible-output authority fields", () => {
  const result = gate({
    text: "Yes. Pick one first rule and one boundary before anything heavier.",
    userText: "i want to be your submissive",
  });
  const trace = result.semanticTrace;

  assert.equal(typeof trace.final_visible_source, "string");
  assert.equal(typeof trace.final_visible_owner, "string");
  assert.equal(typeof trace.candidate_kind, "string");
  assert.equal(typeof trace.candidate_visible_safe, "boolean");
  assert.equal(typeof trace.approved_response_brief_fallback_used, "boolean");
  assert.equal(typeof trace.strict_relational_authority, "boolean");
  assert.ok(Array.isArray(trace.all_visible_candidates));
  assert.ok(Array.isArray(trace.rejected_visible_candidates));
  assert.ok(Array.isArray(trace.replacement_chain));
  assert.equal(typeof trace.model_reply_used, "boolean");
  assert.equal(typeof trace.response_brief_used, "boolean");
  assert.equal(typeof trace.response_brief_id, "string");
  assert.equal(typeof trace.response_gate_replaced, "boolean");
  assert.equal(typeof trace.client_generated_reply_used, "boolean");
  assert.equal(typeof trace.legacy_visible_emitter_used, "boolean");
  assert.equal(typeof trace.legacy_visible_emitter_blocked, "boolean");
  assert.equal(typeof trace.deterministic_bypass_used, "boolean");
  assert.equal(typeof trace.scene_scaffold_candidate_created, "boolean");
  assert.equal(typeof trace.scene_scaffold_candidate_used, "boolean");
  assert.equal(typeof trace.turn_plan_fallback_created, "boolean");
  assert.equal(typeof trace.turn_plan_fallback_used, "boolean");
  assert.equal(typeof trace.brief_realizer_used, "boolean");
  assert.equal(typeof trace.llm_renderer_used, "boolean");
  assert.equal(typeof trace.visible_commit_owner, "string");
  assert.equal(typeof trace.visible_commit_allowed, "boolean");
  assert.equal(trace.authority_trace_present, true);
  assert.equal(trace.authority_trace_version, "visible-output-authority-v2");
  assert.equal(typeof trace.server_commit_path, "string");
  assert.equal(typeof trace.assistant_output_quality, "string");
  assert.equal(typeof trace.assistant_output_context_eligible, "boolean");
  assert.equal(typeof trace.request_fulfilled, "boolean");
});

test("planner fallback shape is invalid fallback prose and context-ineligible", () => {
  const seed = gate({
    text: "I can answer Raven gave a bounded service task with a report-back condition. directly. Keep it bounded: one next step.",
    userText: "what?",
    candidateSource: "deterministic_brief_fallback",
    activeInteraction: relationalActiveInteraction,
  });
  const brief = buildResponseBrief({
    turnMeaning: seed.semanticTrace.turn_meaning,
    plannedMove: seed.semanticTrace.planned_move,
    answerIntent: seed.semanticTrace.answer_intent!,
    activeInteraction: relationalActiveInteraction,
  });
  const plannerText =
    "I can answer Raven gave a bounded service task with a report-back condition. directly. Keep it bounded: one next step, limits named first, and no pretend physical control from chat.";

  const fallbackProse = validateDeterministicFallbackProse(plannerText, brief);
  const briefValidation = validateReplyAgainstBrief(plannerText, brief);

  assert.equal(fallbackProse.ok, false);
  assert.match(fallbackProse.failures.join(" "), /fallback_plan_language_visible|fallback_describes_itself_as_answering/);
  assert.equal(briefValidation.ok, false);
  assert.equal(seed.semanticTrace.assistant_output_context_eligible, false);
  assert.doesNotMatch(seed.text, /\bI can answer\b|Keep it bounded|no pretend physical control/i);
});

test("trusted creator contract rejects approved fallback candidate with planner prose shape", () => {
  const seed = gate({
    text: "Yes. Pick one first rule and one boundary before anything heavier.",
    userText: "i want to be your submissive",
  });
  const badCandidate = recordVisibleCandidate(
    "deterministic_brief_fallback",
    "I can answer this directly. Keep it bounded: one next step, limits named first, and no pretend physical control from chat.",
    "response_brief",
    {
      selected: true,
      owner: "approved_response_brief_fallback",
      visible_safe: true,
      internal_source_type: "visible_safe",
    },
  );
  const decision = selectVisibleOutputOwner({
    turnMeaning: seed.semanticTrace.turn_meaning,
    plannedMove: seed.semanticTrace.planned_move,
    activeInteraction: relationalActiveInteraction,
    candidateSource: "deterministic_brief_fallback",
    finalSource: "deterministic_brief_fallback",
    contentRealizer: "deterministic_brief_fallback",
    candidates: [badCandidate],
    responseBriefId: "brief-test",
  });
  const commit = commitVisibleOutput({
    decision,
    text: badCandidate.text ?? "",
    candidate: badCandidate,
  });

  assert.equal(commit.allow, false);
  assert.equal(commit.reason, "visible_text_has_nonvisible_planner_shape");
});

test("failed fulfillment cannot commit as Raven dialogue", () => {
  const seed = gate({
    text: "Yes. Pick one first rule and one boundary before anything heavier.",
    userText: "i want to be your submissive",
  });
  const candidate = recordVisibleCandidate(
    "deterministic_brief_fallback",
    "For this, keep the answer practical: name the goal and the next step.",
    "response_brief",
    {
      selected: true,
      owner: "approved_response_brief_fallback",
      visible_safe: true,
      internal_source_type: "visible_safe",
    },
  );
  const decision = selectVisibleOutputOwner({
    turnMeaning: seed.semanticTrace.turn_meaning,
    plannedMove: seed.semanticTrace.planned_move,
    activeInteraction: relationalActiveInteraction,
    candidateSource: "deterministic_brief_fallback",
    finalSource: "deterministic_brief_fallback",
    contentRealizer: "deterministic_brief_fallback",
    candidates: [candidate],
    responseBriefId: "brief-test",
    assistantOutputQuality: "failed_fulfillment",
    assistantOutputContextEligible: true,
    requestFulfilled: false,
  });
  const commit = commitVisibleOutput({
    decision,
    text: candidate.text ?? "",
    candidate,
  });

  assert.equal(commit.allow, false);
  assert.equal(commit.reason, "assistant_output_quality_failed_fulfillment");
});

test("generic assistant voice cannot commit as Raven dialogue", () => {
  const seed = gate({
    text: "Hi there! How can I assist you today?",
    userText: "hello",
  });
  const candidate = recordVisibleCandidate(
    "model",
    "Hi there! How can I assist you today?",
    "response_brief",
    {
      selected: true,
      owner: "approved_llm_renderer_from_response_brief",
      visible_safe: false,
      internal_source_type: "visible_safe",
    },
  );
  const decision = selectVisibleOutputOwner({
    turnMeaning: seed.semanticTrace.turn_meaning,
    plannedMove: seed.semanticTrace.planned_move,
    activeInteraction: null,
    candidateSource: "model",
    finalSource: "model",
    contentRealizer: "llm_brief_realizer",
    candidates: [candidate],
    responseBriefId: "brief-generic-voice",
    assistantOutputQuality: "generic_assistant_voice",
    assistantOutputContextEligible: false,
    requestFulfilled: false,
  });
  const commit = commitVisibleOutput({
    decision,
    text: candidate.text ?? "",
    candidate,
  });

  assert.equal(commit.allow, false);
  assert.equal(commit.reason, "assistant_output_quality_generic_assistant_voice");
});

test("context-ineligible output cannot commit as Raven dialogue", () => {
  const seed = gate({
    text: "Yes. Pick one first rule and one boundary before anything heavier.",
    userText: "i want to be your submissive",
  });
  const candidate = recordVisibleCandidate(
    "deterministic_brief_fallback",
    "A visible-looking line that does not answer the current turn.",
    "response_brief",
    {
      selected: true,
      owner: "approved_response_brief_fallback",
      visible_safe: true,
      internal_source_type: "visible_safe",
    },
  );
  const decision = selectVisibleOutputOwner({
    turnMeaning: seed.semanticTrace.turn_meaning,
    plannedMove: seed.semanticTrace.planned_move,
    activeInteraction: relationalActiveInteraction,
    candidateSource: "deterministic_brief_fallback",
    finalSource: "deterministic_brief_fallback",
    contentRealizer: "deterministic_brief_fallback",
    candidates: [candidate],
    responseBriefId: "brief-test",
    assistantOutputQuality: "valid_fallback_reply",
    assistantOutputContextEligible: false,
    requestFulfilled: true,
  });
  const commit = commitVisibleOutput({
    decision,
    text: candidate.text ?? "",
    candidate,
  });

  assert.equal(commit.allow, false);
  assert.equal(commit.reason, "assistant_output_context_not_eligible");
});

test("internal metadata cannot become visible prose on relational turns", () => {
  const result = gate({
    text: [
      "answer_mode: role_response",
      "requested_facet: role_negotiation",
      "current_step_summary: choose a role frame",
    ].join("\n"),
    userText: "i want to be your submissive",
    candidateSource: "turn_plan_fallback",
  });

  assert.equal(result.semanticTrace.legacy_visible_emitter_blocked, true);
  assert.ok(
    result.semanticTrace.replacement_chain.some((entry) =>
      /internal_metadata_visible|internal_brief_or_planner_text|legacy/.test(entry.reason),
    ),
  );
  assert.doesNotMatch(result.text, /answer_mode|requested_facet|current_step_summary|role frame/i);
  assert.equal(result.semanticTrace.visible_commit_allowed, true);
});

test("nonvisible candidate kinds are structurally rejected before visible commit", () => {
  const seed = gate({
    text: "Yes. Pick one first rule and one boundary before anything heavier.",
    userText: "i want to be your submissive",
  });
  const kinds: VisibleOutputCandidateKind[] = [
    "nonvisible_renderer_instruction",
    "nonvisible_state_summary",
    "nonvisible_validator_reason",
    "nonvisible_repair_instruction",
    "nonvisible_fallback_plan",
    "nonvisible_debug_summary",
    "nonvisible_prompt_fragment",
  ];

  for (const kind of kinds) {
    const candidate = recordVisibleCandidate(
      `test_${kind}`,
      "Renderer instruction: answer the current move from the brief.",
      "response_brief",
      {
        kind,
        selected: true,
        visible_safe: false,
        internal_source_type: kind,
      },
    );
    const decision = selectVisibleOutputOwner({
      turnMeaning: seed.semanticTrace.turn_meaning,
      plannedMove: seed.semanticTrace.planned_move,
      activeInteraction: relationalActiveInteraction,
      candidateSource: candidate.source,
      finalSource: candidate.source,
      contentRealizer: "llm_brief_realizer",
      candidates: [candidate],
      responseBriefId: "brief-test",
    });
    const commit = commitVisibleOutput({
      decision,
      text: candidate.text ?? "",
      candidate,
    });

    assert.equal(commit.allow, false, kind);
    assert.match(commit.reason, /nonvisible_candidate_kind|internal_source_type|candidate_not_visible_safe/, kind);
  }
});

test("ResponseBrief-shaped data cannot be committed directly", () => {
  const result = gate({
    text: JSON.stringify({
      brief_id: "brief_x",
      requested_facet: "service_task",
      nonvisible_renderer_instruction: "Ask the user to provide a direct instruction.",
    }),
    userText: "give me a task",
    candidateSource: "response_brief_object",
    activeInteraction: relationalActiveInteraction,
  });

  assert.equal(result.semanticTrace.strict_relational_authority, true);
  assert.notEqual(result.semanticTrace.candidate_kind, "nonvisible_prompt_fragment");
  assert.doesNotMatch(result.text, /brief_id|requested_facet|nonvisible_renderer_instruction|direct instruction/i);
});

test("active relational context owns broad short follow-ups despite shallow chat forms", () => {
  for (const userText of ["what now", "ok", "sure", "that sounds good", "wait what", "explain"]) {
    const result = gate({
      text: "Keep going.",
      userText,
      candidateSource: "weak_input_reply",
      activeInteraction: relationalActiveInteraction,
    });

    assert.equal(
      result.semanticTrace.turn_meaning.current_domain_handler,
      "relational_dynamics",
      userText,
    );
    assert.equal(
      result.semanticTrace.active_interaction_route_considered,
      true,
      userText,
    );
    assert.notEqual(result.semanticTrace.final_visible_owner, "legacy_visible_emitter");
    assert.doesNotMatch(result.text, /^keep going\.?$/i, userText);
  }
});

test("role negotiation state accepts, modifies, or rejects later role replies without re-offering the menu", () => {
  const cases = [
    { userText: "that sounds good", expectedStatus: "accepted", expectedRole: null },
    { userText: "slave instead", expectedStatus: "modified", expectedRole: "slave" },
    { userText: "no pet", expectedStatus: "rejected", expectedRole: null },
  ];

  for (const entry of cases) {
    const result = gate({
      text: "Your role can be a submissive, a service submissive, or a pet.",
      userText: entry.userText,
      candidateSource: "raw_model",
      activeInteraction: relationalActiveInteraction,
    });

    assert.equal(
      result.semanticTrace.active_interaction_after?.role_negotiation_status,
      entry.expectedStatus,
      entry.userText,
    );
    if (entry.expectedRole) {
      assert.equal(
        result.semanticTrace.active_interaction_after?.selected_user_role,
        entry.expectedRole,
        entry.userText,
      );
    }
    assert.doesNotMatch(result.text, /submissive, a service submissive, or a pet/i);
  }
});

test("assistant-selected task requests produce a selected task instead of asking user to choose", () => {
  const active = {
    ...relationalActiveInteraction,
    selected_user_role: "service submissive",
    role_negotiation_status: "accepted" as const,
    accepted_dynamic: "service submissive",
    awaiting_user_input_type: "none" as const,
    pending_unaddressed_slots: [],
  };
  const result = gate({
    text: "I'm going to need you to provide a direct instruction for what task you want.",
    userText: "can you give me the first task, i want you to pick it",
    candidateSource: "repair_turn",
    activeInteraction: active,
  });

  assert.equal(result.semanticTrace.turn_meaning.speech_act, "request_assistant_select_next_task");
  assert.equal(result.semanticTrace.turn_meaning.requested_facet, "service_task");
  assert.equal(result.semanticTrace.strict_relational_authority, true);
  assert.match(result.text, /\b(selected task|do this|your task is|start with|complete)\b/i);
  assert.match(result.text, /\b(report|report back|send|write|check[- ]?in)\b/i);
  assert.doesNotMatch(result.text, /\bprovide a direct instruction|choose the task|what task you want\b/i);
  assert.equal(result.semanticTrace.visible_commit_allowed, true);
});

test("clarification after selected task anchors to prior visible task and active plan", () => {
  const active = {
    ...relationalActiveInteraction,
    selected_user_role: "service submissive",
    role_negotiation_status: "accepted" as const,
    accepted_dynamic: "service submissive",
    current_step_summary: "selected service check-in task",
    current_selected_task: "service check-in",
    last_assistant_instruction: {
      ...relationalActiveInteraction.last_assistant_instruction!,
      plain_language_summary: "Raven selected a service check-in task with a boundary and report-back.",
      expected_user_response_type: "answer" as const,
      required_slots: ["report", "boundary"],
      example_user_response: "I wrote the check-in, kept the boundary, and reported back.",
    },
  };
  const result = gate({
    text: "Good. Keep the same subject, but answer this change directly.",
    userText: "what does that mean? can you give me more details?",
    candidateSource: "repair_turn",
    activeInteraction: active,
  });

  assert.equal(result.semanticTrace.turn_meaning.requested_facet, "clarification_recovery");
  assert.equal(result.semanticTrace.strict_relational_authority, true);
  assert.match(result.text, /\bplain language|mean|asked|example|report|boundary|check[- ]?in\b/i);
  assert.doesNotMatch(result.text, /keep the same subject|answer this change|renderer instruction|requested_facet/i);
});

test("unsafe no-safeword unlimited-consent language is blocked", () => {
  const result = gate({
    text: "No safeword means no limit.",
    userText: "what if i do not set a safeword?",
    activeInteraction: relationalActiveInteraction,
  });

  assert.equal(visibleTextImpliesUnlimitedConsent("No safeword means no limit."), true);
  assert.doesNotMatch(result.text, /no safeword means no limit/i);
  assert.equal(result.semanticTrace.visible_commit_allowed, true);
  assert.ok(
    result.semanticTrace.replacement_chain.some((entry) =>
      /unsafe_unlimited_consent_text/.test(entry.reason),
    ),
  );
});
