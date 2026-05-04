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
- For semantic-owned turns, a blocked reply must be repaired by re-realizing the
  same semantic `AnswerPlan`; the gate must not choose a new move or fallback
  family.
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
