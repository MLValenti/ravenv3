# Raven Engineering Guide

## Purpose

Raven is a fully local, stateful conversational application built around a persistent character voice, structured turn handling, deterministic task control, and grounded session behavior.

Raven is not a generic chatbot.
Raven must not be implemented as a single freeform prompt that improvises planning, routing, memory, tasks, and tone in one step.

The system should behave like:
- a structured conversational controller
- with stateful domain logic
- and a character renderer on top

## Current project priority

Do not expand features until the core is stable.

The current priority is making Raven reliably usable in the following areas:
1. short conversation continuity
2. correct turn understanding
3. active thread continuity
4. topic leadership when invited
5. stable task assignment
6. stable task replacement and revision
7. inventory and item grounding
8. exclusion enforcement
9. zero internal leakage
10. zero invalid fallback on valid turns

A simpler Raven that reliably tracks the conversation is better than a richer Raven that keeps resetting.

---

## Product contract

Raven must be able to do all of the following reliably before additional feature work:

1. Raven-led topic start
   - user asks what Raven wants to talk about
   - Raven leads with a real topic or angle

2. Short continuation
   - user agrees, extends, or reflects
   - Raven builds on the current thought without resetting

3. Clarification
   - user asks what do you mean
   - Raven clarifies the exact prior point

4. Task request
   - user asks for a task
   - Raven asks one blocker only if truly needed
   - Raven fulfills immediately once blocker is resolved

5. Different task
   - Raven replaces the current task cleanly
   - Raven does not repeat the same task family unless explicitly asked

6. Duration-only revision
   - Raven changes duration only
   - Raven preserves the active task family unless explicitly told otherwise

7. Item or inventory-based task request
   - Raven grounds the item correctly
   - if uncertainty remains, Raven asks one focused clarification

8. Exclusion enforcement
   - barred categories must never appear once excluded

9. No internal leakage
   - no scaffold, planner, or strategy text should ever appear to the user

10. No fallback misuse
   - stock fallback lines must only appear on truly blocked turns

---

## Architectural direction

Raven should be built as a layered system.

### 1. Turn Interpreter
Responsible for classifying the user’s live turn into a structured turn move.

Examples:
- continue_current_thought
- agree_and_extend
- clarify_meaning
- answer_direct_question
- user_correction
- raven_leads_next_beat
- concrete_request
- request_revision
- blocked_need_clarification

This layer should be as deterministic as practical.

### 2. State Manager
The source of truth for live interaction state.

It should track:
- active thread
- current mode
- last assistant move
- pending request
- task state
- revision state
- exclusions
- relevant inventory
- recent task family
- whether Raven is expected to lead
- whether fallback is allowed

All major systems must read from this shared state.

### 3. Domain Engines
Separate engines should handle different types of work:
- conversation engine
- task engine
- inventory grounding engine
- constraint engine
- fallback engine

These engines should return structured candidates or structured outcomes, not raw freeform behavior by default.

### 4. Action Planner
Chooses exactly one next action from current state and turn type.

Examples:
- continue thought
- clarify last point
- lead topic
- ask one blocker
- assign task
- revise task duration
- replace task family
- ask item clarification
- reject and retry internally

### 5. Voice Renderer
Renders the chosen action in Raven’s voice.

Tone should follow logic.
Tone should not replace logic.

### 6. Response Gate
Rejects bad outputs before they reach the user.

---

## Core engineering rules

1. Normal conversation is the default mode.
2. Task, revision, profile, verification, and execution flows are controlled submodes.
3. Submodes must not leak into ordinary chat.
4. Structured action selection must happen before final wording is generated.
5. Freeform generation must not be the sole decider of system behavior.
6. Prefer deterministic routing for core turns over clever but unstable generation.
7. If a subsystem is causing instability in basic conversation, simplify or constrain it.
8. Do not preserve complexity for its own sake.

---

## Conversation continuity requirements

The conversation engine must preserve:
1. identity continuity
2. emotional continuity
3. relational continuity
4. scene continuity
5. user preference continuity
6. active thread continuity
7. task and revision continuity

Raven must not reset on ordinary user continuations.

Examples of valid non-blocked turns:
- that’s a good point
- yeah
- exactly
- that makes sense
- once it gets real it changes
- what do you mean
- go on
- not like that
- different task
- make it 10 minutes

These should not trigger generic fallback.

---

## Failure modes to avoid

Do not let Raven regress into:
1. a collection of fallback lines
2. a questionnaire with attitude
3. a generic assistant with sharper wording
4. a task engine that dominates unrelated turns
5. a freeform generator that loses two-line conversations
6. a system that leaks scaffold or planner text
7. a system that ignores explicit user corrections
8. a system that guesses blindly about items
9. a system that references undefined objects or setup
10. a system that asks for clarification when enough context already exists

---

## Fallback policy

Fallback lines are recovery tools, not default conversation tools.

Stock fallback lines must only be allowed when the turn is truly blocked.

They must not appear when the user:
- is continuing a thought
- is agreeing
- is extending a point
- is correcting something
- is asking a simple follow-up
- is asking Raven to lead
- is making a concrete request
- is revising a request

If fallback appears often, assume the turn contract or routing is broken.

---

## Task system requirements

Tasks must not be invented entirely from freeform generation.

Task behavior should come from:
1. structured task families or task catalog
2. explicit constraints
3. exclusions
4. active thread state
5. revision state
6. inventory compatibility
7. plausibility checks
8. recent family avoidance where relevant

The LLM may help phrase tasks, but should not be the sole source of task logic.

### Task rules
1. Explicit task-type requests must hard-filter candidates.
2. Excluded categories must never appear.
3. Different task must avoid the current family unless explicitly asked not to.
4. Different kind of task should change family while preserving relevant constraints.
5. Duration-only revision must preserve task family.
6. Task replies must not reference undefined objects or setup.
7. One turn should produce one coherent task response only.

---

## Inventory and item grounding requirements

Inventory and item references must be grounded before task generation or revision.

Preferred grounding order:
1. local item metadata
2. local keyword and synonym mapping
3. local fallback knowledge abstraction when confidence is low
4. optional future bounded external lookup only if explicitly designed

Grounding must support:
1. item identification
2. likely use semantics
3. compatibility checks
4. clarification decisions
5. plausibility validation

Grounding must never override:
1. active thread state
2. task constraints
3. exclusions
4. revision scope

If local metadata already provides the answer, do not perform fallback lookup.

If uncertainty remains, ask one focused clarification instead of guessing.

---

## Response gate invariants

Reject any response that:
1. leaks scaffold, planner, or strategy text
2. uses barred categories
3. references undefined objects or setup
4. asks for clarification when enough context exists
5. repeats blocked fallback lines on a valid turn
6. fails the chosen action
7. switches modes incorrectly
8. duplicates task payloads or stacks partial replies
9. ignores explicit user correction
10. contradicts established task or revision scope

Response gate failures should be treated as real defects, not style issues.

---

## Mode routing rules

Correct routing is mandatory.

1. Normal chat must stay in conversation mode.
2. Task requests must stay in task flow.
3. Task flow must not degrade into generic chat fallback.
4. Lead-the-conversation requests must not route to generic question-answering fallback.
5. Revision requests must remain scoped to the active thread.
6. Question-answering must not absorb every question-shaped turn.

Use social meaning and active thread, not just syntax.

Example:
- “what do you want to talk about?” is a lead request, not generic question_answering
- “make it 10 minutes” is a task revision, not a new task
- “different task” is a constrained replacement, not generic reroll

---

## Hard constraints

1. Must run on Windows 11.
2. Must be fully local by default.
3. Do not add telemetry.
4. Do not add cloud dependencies without explicit approval.
5. All local servers must bind to 127.0.0.1 only.
6. Keep it free: use free and open-source tools and libraries.
7. Prefer minimal dependencies.
8. Ask before adding a new dependency that is not strictly required.
9. Prefer TypeScript everywhere unless there is a very strong reason otherwise.

---

## Safety and control requirements

1. Do not implement device control until an emergency stop exists and is enforced server-side.
2. Emergency stop must immediately stop all active actions.
3. Barred categories must be enforced at the constraint layer, not just by prompt wording.
4. Placeholder, scaffold, fallback, or temporary instruction text must never be persisted as durable memory, profile fact, or active task state.
5. Core control logic must not depend on the model simply “doing the right thing” without validation.

---

## Contributor workflow rules

When making changes:
1. prefer architectural fixes over prompt-only fixes
2. inspect the live path, not just helpers
3. preserve the product contract
4. keep scope narrow
5. do not add features while baseline flows are broken
6. prove changes with tests and manual flow checks

When Raven feels off, inspect in this order:
1. turn interpretation
2. state update correctness
3. mode routing
4. active thread handling
5. task or inventory grounding
6. action planner choice
7. scaffold composition
8. response gate behavior
9. final rendered output

---

## Testing requirements

Do not treat green unit tests alone as success if live session behavior still fails.

Every core behavior change should include:
1. deterministic tests
2. replay or golden conversation tests
3. session or browser-path validation where applicable

### Golden flows are the source of truth

Maintain a golden suite covering at minimum:
1. topic initiation
2. agreement and continuation
3. clarification
4. correction handling
5. task assignment
6. blocker resolution
7. task replacement
8. duration revision
9. item grounding
10. exclusion enforcement
11. no leakage
12. no invalid fallback on valid turns

### Required regression checks
At minimum, verify:
- Raven can sustain a 3 to 5 turn conversation without resetting
- Raven builds on user continuations
- Raven can lead when asked
- Raven can clarify a prior point specifically
- task requests stay in task flow
- different task works
- duration-only revision works
- item-based requests are grounded
- excluded categories stay excluded
- stock fallback lines do not appear in valid turns
- internal text never leaks

---

## Delivery requirements

1. Work in phases or milestones.
2. Each phase must be runnable and verifiable.
3. After each phase, provide:
   - files changed
   - commands to run
   - short manual test plan
   - known risks or remaining gaps
4. Add or update automated tests for any logic that can be tested.
5. For conversation-engine changes, always add or update:
   - deterministic tests
   - replay scenarios
   - transcript or golden-conversation regression coverage
   - session or browser-path validation when applicable

---

## Near-term roadmap

### Phase 1
Stabilize turn interpretation and fallback gating for short live conversations.

### Phase 2
Stabilize state contract and active-thread handling.

### Phase 3
Refactor task handling into deterministic task selection plus revision rules.

### Phase 4
Refactor inventory grounding into a dedicated resolver with confidence-based clarification.

### Phase 5
Harden response gate and live-path validation.

### Phase 6
Only after the above are stable, improve richness, polish, and optional bounded external lookup support.

---

## Rule for agents and copilots

Do not expand features until the core conversation contract is stable.

Do not optimize for style before reliability.

If a change makes Raven more sophisticated but less stable, it is a bad change.

When in doubt, prefer:
- simpler routing
- clearer state
- stronger validation
- deterministic handling of core turns
over:
- richer generation
- more fallback variety
- more autonomous behavior
- more feature scope