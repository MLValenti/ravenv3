# Semantic Response Path Ownership

Raven v3 uses
`interpretTurnMeaning -> updateCanonicalTurnState -> planSemanticResponse -> selectEligibleDomainHandler -> planDomainAnswer`
as the owner of conversational move selection, facet selection, handler
eligibility, and domain answer contracts.

## Replaced by Semantic Planner

- `lib/chat/open-question.ts`
  - Assistant self-disclosure, assistant preference questions, reciprocal offers,
    preference application requests, definition answers, and factual answers now enter
    through `buildSemanticPlannedReply`, then `realizeSemanticContent`.
  - Raven preference/self-disclosure content is grounded in
    `lib/session/raven-preferences.ts`; `lib/session/raven-profile.ts` is a
    compatibility wrapper around that source.
- `lib/session/raven-preferences.ts`
  - Owns Raven preference facts, facet-aware answer plans, answer contracts, and
    validation for category overviews, favorites, list expansion, yes/no item
    questions, binary comparisons, item reasons, explicitly modeled tool
    availability boundaries, clarifying enumerations, invitations, application
    requests, and challenges.
- `lib/session/turn-meaning.ts`
  - Owns requested facets, primary/secondary subjects, required answer slots,
    handler eligibility decisions, and rejected-handler trace data. A broad
    domain match is not enough for a handler to answer.
- `lib/session/scene-scaffolds.ts`
  - Open-chat semantic turns such as greetings, Raven preference questions,
    reciprocal probes, and user-preference application requests are routed through
    `buildSemanticOpenReply` before generic scene scaffolds can answer.
- `lib/session/response-gate.ts`
  - Response traces are built from `updateCanonicalTurnState`; the gate can reject
    malformed output, but it does not choose a new semantic move.
  - Semantic traces include requested facet, required answer slots, eligible and
    rejected handlers, chosen handler, and answer-contract validation result.
- `app/api/chat/route.ts`
  - API debug headers use `updateCanonicalTurnState` so live route traces expose
    the same `TurnMeaning` and `PlannedMove` as tests.

## Allowed Temporary Fallback

- `lib/session/response-gate-candidates.ts`
  - Still provides fallback text for hard structured task, game, commitment,
    verification, profile, and repair flows after the semantic plan is known.
- `lib/session/scene-state.ts`
  - Still owns deterministic state updates for task/game/profile modes.
- `lib/session/short-follow-up.ts`
  - Still realizes clarification and training-thread continuations when those
    are the active structured context.

## Delete Later

- Remaining open-chat raw text branches in `lib/chat/open-question.ts` should be
  migrated behind `TurnMeaning` question shapes and answer contracts as new
  meaning classes are promoted.
- Generic conversational rescue paths in `response-gate-candidates.ts` should keep
  shrinking as semantic content realization grows.

## Fenced Legacy Emitters

- Generic comparison text such as "Give me the two real options" remains only in
  `open-question.ts` for non-Raven, non-domain comparison questions. Raven
  preference comparisons now use the `binary_compare_or_choice` contract.
- Raven preference handling is fenced by requested facet: it rejects current
  status and definition facets, and it only answers possession/tool questions
  through the explicit tool-availability boundary in the preference model.
- "Keep going" and similar continuation lines remain allowed only inside
  explicit continuation, active game, task, or conversation-lead flows. Raven
  preference/domain contracts reject them before visible commit.

## Live-Path Authority Rules

- A semantic-owned turn is any turn whose planned content key is owned by a
  structured semantic realizer, including Raven preferences, definitions,
  embodiment/current-status answers, reciprocal probes, and relational dynamics.
- Once a turn is semantic-owned, legacy candidates may not replace the move,
  requested facet, answer mode, domain handler, or content source.
- The live path records `semantic_owned`, `semantic_owner_id`, `planned_move`,
  `requested_facet`, `answer_mode`, `domain_handler`,
  `content_source_before_gate`, `content_source_after_gate`,
  `gate_replaced_output`, `replacement_source`, `scaffold_source`,
  `final_visible_source`, and `commit_owner_id` so overwrites are visible in
  traces.
- Legacy scene, repair, deterministic, fallback, and game candidates may still
  be produced for diagnostics, but for semantic-owned turns they are advisory
  only. If selected text comes from a legacy source, the response gate
  re-realizes from the same `AnswerPlan`.
- Compound turns keep one semantic owner. `TurnMeaning.components` records each
  required semantic component, while `requested_facets` records every facet the
  answer must satisfy before commit. The planner must not satisfy the first
  component and silently drop the rest.

## Compound Relational Turns

- Relational equipment turns may combine disclosure, invitation, and direction
  in one user message. For example, "I have a cage and plug, would you want me
  to use them?" is one semantic-owned relational turn with disclosed objects,
  dynamic application, and invitation-response requirements.
- The extracted object list lives in `dynamic_slots.disclosed_objects`; the
  proposal target lives in `dynamic_slots.proposal_target`; invitation state is
  recorded in `dynamic_slots.invitation_or_proposal`.
- Compound equipment/application answers must acknowledge the objects, answer
  the invitation conditionally, preserve physical-control boundaries, and offer
  one bounded next step. Raw normalized-user-text echoes are invalid output.

## Continuation Attachment

- Short continuations such as "yes please, explain it", "tell me how", and
  "what do you mean by that?" attach to the previous substantive semantic plan
  when that plan can be identified.
- Traces include `previous_semantic_plan_id`,
  `continuation_attached_to_plan_id`, `continuation_attachment_reason`, and
  `stale_scaffold_rejected`.
- Style address terms are never valid clarification referents. A continuation
  can attach to role negotiation, service direction, equipment disclosure, or
  dynamic application, but it cannot attach to "pet", "slut", "mistress", or a
  stale game scaffold.
- Active task/training substitution questions keep their existing rail unless
  the user explicitly asks for a relational dynamic. Relational equipment
  semantics must not steal established training follow-ups by seeing an item
  word alone.

## Typo Normalization

- Low-risk semantic normalization may correct a term only when the corrected
  term strongly matches the active domain and the original reading is not useful
  in context.
- Current relational normalization records `server better -> serve better` for
  service/equipment contexts, with `normalization_applied`,
  `normalized_user_text`, and `normalization_reason` in trace.

## Response Gate Contract

- The response gate may block malformed, unsafe, duplicated, internally leaked,
  or contract-breaking output.
- For relational semantic-owned turns, the gate builds a `ResponseBrief` from
  `TurnMeaning`, `PlannedMove`, `AnswerIntent`, and the previous response brief
  summary. The brief, not a scene scaffold, is the contract for final wording.
- For non-relational semantic-owned turns, existing domain realizers remain
  authoritative; the response-brief writer is intentionally scoped so it does
  not steal task, inventory, game, profile, definition, or Raven-preference
  rails.
- A blocked relational reply must be repaired by re-realizing from the same
  `ResponseBrief`. If model text fails validation, Raven may retry the model
  with the same brief and validation failure; the final emergency fallback is a
  minimal deterministic brief fallback that still satisfies the brief.
- The gate must not choose a new move, facet, answer mode, handler, or fallback
  family while repairing a semantic-owned turn.
- Definition fallback is only allowed when `requested_facet` is `definition`.
- Game scaffolds are only allowed when the semantic plan is explicitly game
  scoped.
- Repair-turn output must never surface raw repair instructions or weak anchors
  such as style-only address terms.

## Scene Scaffold Role

- Scene scaffolds may provide local deterministic text only when no structured
  semantic owner has claimed the turn.
- They may not invent visible text for relational dynamic, Raven preference,
  definition, or embodiment turns once those turns are semantic-owned.
- If a scaffold candidate wins before the gate on a semantic-owned turn, the
  gate treats that as a legacy override attempt and restores the semantic
  realization.

## Device Channel Separation

- Assistant output is split into `visible_reply`, `device_actions`, and
  `debug_trace` before chat commit.
- Device command JSON and formatted device text are handled by the device/action
  channel or debug feed only.
- `visible_reply` is the only value eligible for chat display or speech.
- Visible text is linted for `Device command:`, tool-command wording, and raw
  `device_command` payloads before commit.

## Final Visible Barrier

- The final visible-output barrier runs immediately before visible commit.
- It rejects device/tool command text, internal repair text, scaffold
  instructions, build/offline fallback text outside definition contexts, game
  scaffolding outside game contexts, malformed templates, and style-only
  clarification answers such as "I mean slut."
- It also rejects raw normalized-user-text echo prefixes and equipment template
  fragments such as "you have X, would you like..." when the semantic answer
  plan requires a realized relational response.
- If the barrier rejects a semantic-owned answer, Raven reuses the same semantic
  plan and content source. Generic filler is not an allowed recovery path.

## Response Brief Realization

- `lib/session/response-brief.ts` defines `ResponseBrief`, the prompt helper
  shape, the brief validator, previous-brief summaries, and the deterministic
  brief fallback used only after brief validation fails.
- The brief records `brief_id`, `source_turn_id`, `semantic_plan_id`, user text,
  normalized text, domain handler, speech act, requested facet(s), answer mode,
  subjects, dynamic slots, continuity target, previous substantive ask,
  required answer slots, `must_address`, `must_not_include`, allowed
  boundaries, capability limits, persona style, desired depth, reply goal,
  answer strategy, clarification policy, and active interaction fields:
  `active_interaction_id`, `interaction_type`, `active_status`,
  `current_step_summary`, `next_step_policy`,
  `expected_user_response_type`, `previous_instruction_summary`, and
  `active_interaction_safety_notes`.
- The LLM writer is allowed to write natural final prose from the brief, but it
  may not choose a new domain or answer mode, mention internal fields, invent
  physical capability, use game language outside game contexts, or drop required
  answer slots.
- `validateReplyAgainstBrief` checks required slots, forbidden text, game
  language outside game, device/tool command leakage, raw normalized echoes,
  generic continuation filler, and facet-specific requirements such as service
  tasks, correction-away-from-game, and training guidance.
- Traces for semantic-owned turns include `response_brief_id`,
  `response_brief`, `content_realizer`, `validation_result`,
  `validation_failures`, `re_realization_attempts`,
  `previous_response_brief_id`, `correction_target_plan_id`,
  `domain_override_blocked`, and `legacy_visible_emitter_blocked`.

## Active Interaction State

- Directed relational exchanges now persist an `ActiveInteractionState` rather
  than relying on visible text. The state records `active_interaction_id`,
  `interaction_type`, `domain_handler`, `status`, current and previous step
  summaries, next-step policy, known goals/limits/equipment/preferences,
  awaited user response type, last assistant instruction/question, progress and
  confusion reports, pause/stop flags, safety review, and source turn ids.
- Assistant directions are also stored as structured instructions with an
  `instruction_id`, plain-language summary, expected user response type,
  required slots, example user response, safety notes, linked response brief id,
  and linked active interaction id.
- Interaction types are separate: `game` is only for games. Relational setup,
  service protocol, training discussion, check-in sequence, and task sequence do
  not inherit game scaffolds.
- Active follow-ups classify by function:
  `what else?` and `now what do i do?` become `next_step_request`;
  `i am doing that now`, `i never stopped`, and sensation reports become
  `progress_report`; `i am ready` and `keep going` become
  `readiness_confirmation`; confusion becomes `clarification_recovery`; stop or
  pause requests pause the active interaction; active corrections update the
  interaction instead of continuing the rejected plan.
- Active interaction routing now runs before global conversation mode and before
  generic task or game rails. When the stored interaction is relational setup,
  service protocol, training discussion, check-in sequence, or task sequence,
  compatible turns about tasks, rules, daily protocol, training, service,
  confusion, next steps, progress, readiness, limits, boundaries, role,
  permission, or approval stay on the relational route unless the user clearly
  changes topic.
- Route traces include `active_interaction_route_considered`,
  `active_interaction_continuity_score`, `topic_shift_score`,
  `candidate_routes`, `chosen_route`, `rejected_routes`,
  `rejected_game_reason`, `rejected_generic_task_reason`,
  `rejected_definition_reason`,
  `conversation_mode_overridden_by_active_interaction`, and
  `previous_response_brief_used`.
- Response contracts for active turns require the answer to use the active
  interaction state, avoid "Keep going", avoid stale fragments such as "Open is
  the part...", and block "The game continues" unless the interaction type is
  actually `game`.
- Traces include `active_interaction_before`, `active_interaction_after`,
  `active_interaction_transition`, `current_step_id`,
  `previous_instruction_id`, `attached_instruction_id`,
  `expected_user_response_type`, `next_step_policy`,
  `active_interaction_realizer_used`, `stale_fragment_rejected`, and
  `game_candidate_rejected_due_to_interaction_type`.
- The production chat route treats active interaction state as a canonical
  session field, not a debug-only trace. The client sends `activeInteraction`,
  `previousResponseBrief`, and the last `activeStateOwner` with each `/api/chat`
  request; the route normalizes that state, passes it into semantic
  interpretation, response brief building, response gate, and active-state
  updates, then returns `activeInteraction`, `previousResponseBrief`, and a new
  owner in the NDJSON response payload. The client commits that state only after
  the visible assistant reply wins the same commit guard as the text.
- Stale response protection applies to active state too: an older
  `user_message_id`, request owner, or committed response cannot overwrite a
  newer active interaction update.
- Assistant asks are now state-producing events. If the final visible assistant
  reply asks for a relational setup answer, rule selection, limit, role,
  check-in, service lane, task preference, or training preference, the
  assistant-answer update creates or refreshes `ActiveInteractionState` even
  when that wording came from the response brief/model realizer. For example,
  "Choose the first rule you want me to hold you to" persists
  `interaction_type=relational_setup`, `status=awaiting_user_answer`,
  `awaiting_user_input_type=rule_selection`, and a structured
  `last_assistant_instruction` explaining the first-rule ask.
- The browser-path state-chain trace records each handoff:
  `active_state_created_this_turn`, `active_state_creation_reason`,
  `active_interaction_before_request_client`,
  `active_interaction_sent_to_server`,
  `active_interaction_received_by_server`,
  `active_interaction_before_routing`,
  `active_interaction_after_response_gate`,
  `active_interaction_returned_to_client`,
  `active_interaction_accepted_by_client`,
  `active_interaction_rejected_by_client_reason`,
  `previous_response_brief_created_this_turn`,
  `previous_response_brief_sent_to_server`,
  `previous_response_brief_received_by_server`,
  `previous_response_brief_used_in_routing`,
  `last_assistant_instruction_created_this_turn`,
  `last_assistant_instruction_sent_to_server`, and
  `last_assistant_instruction_used_for_followup`.
- Active route precedence runs before `conversation_mode`. Compatible
  acknowledgements such as "yes mistress", "ok", "sounds good", and "i agree"
  attach to the pending active ask; they acknowledge acceptance and advance one
  small step rather than repeating the prior answer or falling into normal chat.

## State Deltas And Feedback Recovery

- User turns that add information to an active interaction are state deltas, not
  repeats of the prior request. `TurnMeaning` and `ActiveInteractionState`
  record delta classes such as `user_state_delta`, `user_preference_delta`,
  `user_experience_delta`, `boundary_delta`, `training_goal_delta`,
  `meta_feedback`, `complaint_about_response`, and `correction_to_response`.
- Active interaction state now persists delta-aware fields:
  `known_experience_level`, `active_training_goals`, `answered_topics`,
  `last_answer_signature`, `last_answered_slots`,
  `pending_unaddressed_slots`, and `user_feedback_on_last_response`.
  A turn like "i dont have much training" updates the active experience level
  to beginner/low experience and requires the next answer to adapt pacing
  instead of replaying the old training answer.
- Compound goals must stay compound across turns. "I want anal and chastity
  training" stores both `anal training` and `chastity training`; later answers
  must either address both, sequence them, or explicitly ask which lane starts
  first. Dropping the second goal fails the response brief validator.
- `ResponseBrief` records `state_delta_summary`, `newly_added_slots`,
  `already_answered_slots`, `pending_unaddressed_slots`,
  `avoid_repeating_answer_ids`, and `required_novelty_reason`. Brief
  realization must address the newly added slots before it may restate old
  material.
- Anti-repetition validation compares candidate replies with recent assistant
  replies. If a state-delta turn produces a high-overlap answer or ignores the
  newly added slot, the gate re-realizes from the same brief with an explicit
  novelty requirement. It never repairs repetition by falling back to generic
  filler.
- User complaints such as "why are you repeating?", "you already said that",
  "that is not what I asked", or "you are not answering me" route to
  `response_correction` with answer mode `revise_or_clarify`. The answer must
  acknowledge the issue briefly, correct course, and provide a revised answer or
  one focused clarifying question.
- Structured assistant instructions separate internal summaries from
  renderable fields. Internal labels such as "Choose a role frame" and raw slot
  summaries are invalid visible prose; realizers must use the user-facing
  prompt, example response, action label, or renderable next step instead.
- Traces expose `state_delta_detected`, `state_delta_type`,
  `active_state_delta_applied`, `new_slots_added`,
  `pending_unaddressed_slots`, `last_answer_signature`,
  `repeated_answer_detected`, `repeated_answer_similarity`,
  `repetition_repair_used`, `meta_feedback_detected`,
  `internal_instruction_summary_rendered`, and
  `instruction_renderable_field_used`.

## Service Task Lane

- Relational service tasks are distinct from games, planning tasks, chores, and
  inventory-grounded task generation.
- In an active relational dynamic, "I want to do tasks" and "what task should I
  do" route to `service_task` with answer mode `service_task_instruction`.
- Generic task requests and inventory-grounded training requests stay on the
  task/inventory rail unless there is relational context or explicit service
  language.
- The service task contract requires one bounded task or one focused setup
  question, no scoring, no rounds, no "best of" framing, and no game language.
- Daily service tasks are stricter than generic service tasks: the reply must
  include a concrete daily action, frequency such as once per day, what the user
  reports back, and a bounded purpose. Vague output such as "complete the
  current checkpoint" fails validation and is re-realized from the same brief.

## Correction And Depth

- Corrections such as "I want a task not a game", "not a game, a task", and
  "stop making it a game" route to `correction_to_prior_plan` when correcting a
  prior plan, or `correction_to_active_interaction` when a directed interaction
  is already active. The reply must acknowledge the correction, abandon game
  framing, and continue only from the accepted interaction.
- Training guidance turns such as "what things can we do to help with anal
  training?" route to `training_guidance` with answer mode `bounded_guidance`
  when the user is asking for relational guidance rather than inventory-task
  generation.
- Short depth turns such as "how" attach to the previous response brief when a
  substantive brief exists. The brief sets `desired_depth` to `stepwise` and
  keeps the answer on the previous topic instead of starting a new game.

## Relational Contract Hardening

- `relational_dynamic` now distinguishes actual equipment disclosures from
  relational goals, training goals, service lanes, intensity preferences, and
  hard limits. A goal such as tasks, training, approval, permission, or a named
  limit is not equipment unless the user discloses a concrete object.
- Compound relational disclosures carry structured slots:
  `desired_service_lanes`, `intensity_preferences`, `training_goals`,
  `hard_limits`, `boundary_preferences`, and `dynamic_goals`.
- Compound disclosure answers must acknowledge the service lane, training goal,
  and hard limit, preserve boundary framing, and offer one bounded next step.
  Raw normalized echoes such as "you have X..." are rejected.
- Relational-owned turns reject game language even if a stale game scaffold is
  present in scene state. The trace records `stale_game_scaffold_rejected`.

## Clarification Recovery

- Raven stores a structured model of the previous substantive ask when a
  relational answer requests setup information. The model records `ask_type`,
  `ask_slots`, a plain-language summary, an example user response, and the
  semantic plan id.
- User confusion turns such as "what do you mean?", "i dont understand what you
  are asking for", and "can you give me an example" route to
  `clarification_recovery` when a previous ask exists.
- Clarification recovery must restate the prior ask in simpler language,
  explain why the slots matter, and give a copy/adapt example. It must not emit
  "Keep going", "concrete part", or style-token explanations.
