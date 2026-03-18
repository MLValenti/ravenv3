import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTaskOptionsReply,
  buildTaskCandidatesFromSpec,
  chooseNextTaskSpecQuestion,
  createTaskSpec,
  isTaskSpecReady,
  noteTaskSpecAssistantText,
  noteTaskSpecUserTurn,
  noteTaskSpecQuestionAsked,
  selectTaskCandidate,
  selectTaskOptions,
} from "../lib/session/task-spec.ts";

function normalizeTestText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

test("vague task request causes a clarifying domain question", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "requested_domain");
  assert.match(question?.question ?? "", /\bposture\b/i);
});

test("device task request asks about available items when needed", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a device task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "available_items");
  assert.match(question?.question ?? "", /\bavailable\b/i);
});

test("toy task request asks for the actual item instead of assigning a generic device task", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a toy task for 30 minutes",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "available_items");
  assert.match(question?.question ?? "", /\bavailable\b|\bwhat can you actually use\b/i);
});

test("posture task request asks about duration when it is still missing", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a posture task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "duration_minutes");
  assert.match(question?.question ?? "", /\bhow long\b/i);
});

test("task spec can ask whether the task should be combined with another activity", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 20 minute posture task and maybe combine it with something else",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "combine_mode");
  assert.match(question?.question ?? "", /\bstandalone\b/i);
});

test("task spec varies question phrasing when the same slot was already asked", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a posture task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const first = chooseNextTaskSpecQuestion(spec);
  const asked = noteTaskSpecQuestionAsked(spec, "duration_minutes");
  const second = chooseNextTaskSpecQuestion(asked);

  assert.equal(first?.slot, "duration_minutes");
  assert.equal(second?.slot, "duration_minutes");
  assert.notEqual(first?.question, second?.question);
});

test("task spec stops questioning once enough details exist", () => {
  let spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a posture task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  assert.equal(isTaskSpecReady(spec), false);

  spec = noteTaskSpecUserTurn(spec, {
    userText: "make it 20 minutes with a halfway check in",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  assert.equal(isTaskSpecReady(spec), true);
  assert.equal(chooseNextTaskSpecQuestion(spec), null);
});

test("answered blocker flips task spec into fulfillment lock instead of another question", () => {
  let spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a posture task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  spec = noteTaskSpecQuestionAsked(spec, "duration_minutes");

  spec = noteTaskSpecUserTurn(spec, {
    userText: "30 minutes",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  assert.equal(spec.last_resolved_blocker, "duration_minutes");
  assert.equal(spec.request_stage, "ready_to_fulfill");
  assert.equal(spec.next_required_action, "fulfill_request");
  assert.equal(spec.fulfillment_locked, true);
  assert.equal(chooseNextTaskSpecQuestion(spec), null);
});

test("generic inventory item asks one specific clarification before task fulfillment", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a device task for 30 minutes",
    inventory: [
      {
        id: "inv-generic",
        label: "toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "inventory_details");
  assert.match(
    question?.question ?? "",
    /clean read on what "toy" is|exactly what it is and how it is realistically used/i,
  );
});

test("insertable inventory asks a grounded use clarification instead of assigning a generic task", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 30 minute task with my dildo",
    inventory: [
      {
        id: "inv-dildo",
        label: "toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "inventory_details");
  assert.match(question?.question ?? "", /oral use|anal use|prop/i);
});

test("explicit dildo task request asks for use mode even without saved inventory", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 30 minute task with my dildo",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "inventory_details");
  assert.match(question?.question ?? "", /oral use|anal use|prop/i);
  assert.match(spec.relevant_inventory_item, /dildo/i);
});

test("uncertain inventory item uses fallback grounding only to ask a realistic clarification", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 30 minute task with my aneros helix",
    inventory: [
      {
        id: "inv-aneros",
        label: "Aneros Helix",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const question = chooseNextTaskSpecQuestion(spec);
  assert.equal(question?.slot, "inventory_details");
  assert.match(question?.question ?? "", /anal|prop/i);
  assert.doesNotMatch(question?.question ?? "", /exactly what "Aneros Helix" is and how it should be used/i);
});

test("detailed task spec generates structured candidates without unnecessary questions", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 20 minute posture task with a halfway check in",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  assert.equal(isTaskSpecReady(spec), true);
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me a 20 minute posture task with a halfway check in",
    currentTemplateId: "steady_hold",
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain);

  assert.ok(candidates.length >= 3);
  assert.ok(selected);
  assert.equal(
    ["posture", "hands", "kneeling", "shoulders"].includes(selected?.domain ?? ""),
    true,
  );
  assert.equal(selected?.validation.matches_request, true);
  assert.match(selected?.checkin_or_proof_requirement ?? "", /\bhalfway\b/i);
});

test("stillness exclusion is persisted in task policy and removed from available categories", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a task but no stillness",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  assert.deepEqual(spec.excluded_task_categories, ["stillness"]);
  assert.equal(spec.available_task_categories.includes("stillness"), false);
  assert.doesNotMatch(chooseNextTaskSpecQuestion(spec)?.question ?? "", /\bstillness\b/i);
});

test("replacement request avoids the current task family and preserves duration", () => {
  const replacementSpec = noteTaskSpecUserTurn(
    createTaskSpec({
      requested_domain: "posture",
      duration_minutes: 30,
      current_task_domain: "posture",
      current_task_family: "posture_discipline",
      recent_task_families: ["posture_discipline"],
      request_fulfilled: true,
    }),
    {
      userText: "give me a different task",
      currentTaskDomain: "posture",
      lockedTaskDomain: "none",
      canReplanTask: true,
      reasonForLock: "",
    },
  );

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: replacementSpec,
    userText: "give me a different task",
  });
  const selected = selectTaskCandidate(candidates, replacementSpec.requested_domain, replacementSpec);

  assert.equal(replacementSpec.request_kind, "replacement");
  assert.equal(replacementSpec.duration_minutes, 30);
  assert.notEqual(selected?.family, "posture_discipline");
  assert.match(selected?.summary ?? "", /\b30 minutes\b/i);
});

test("grounding correction overrides the stale task family when the item semantics conflict", () => {
  const corrected = noteTaskSpecUserTurn(
    createTaskSpec({
      requested_domain: "device",
      duration_minutes: 30,
      current_task_domain: "device",
      current_task_family: "device_endurance",
      request_fulfilled: true,
    }),
    {
      userText: "that does not make sense for the leather cuffs. use the cuffs instead.",
      inventory: [
        {
          id: "cuffs-1",
          label: "Leather Cuffs",
          category: "accessory",
          available_this_session: true,
          intiface_controlled: false,
          linked_device_id: null,
          notes: "wrist restraints",
        },
      ],
      currentTaskDomain: "device",
      lockedTaskDomain: "none",
      canReplanTask: true,
      reasonForLock: "",
    },
  );

  assert.equal(corrected.request_kind, "replacement");
  assert.equal(corrected.avoid_task_families.includes("device_endurance"), true);
});

test("bondage task request hard-filters candidates to bondage-compatible families", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a bondage task for 30 minutes",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me a bondage task for 30 minutes",
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain, spec);

  assert.equal(spec.requires_bondage_compatibility, true);
  assert.ok(candidates.every((candidate) => ["hands", "kneeling", "shoulders"].includes(candidate.domain)));
  assert.ok(selected);
  assert.equal(["hands", "kneeling", "shoulders"].includes(selected?.domain ?? ""), true);
});

test("duration revision preserves the active task family", () => {
  const revisionSpec = noteTaskSpecUserTurn(
    createTaskSpec({
      requested_domain: "posture",
      duration_minutes: 30,
      current_task_domain: "posture",
      current_task_family: "posture_hands",
      request_fulfilled: true,
    }),
    {
      userText: "make it 20 minutes",
      currentTaskDomain: "posture",
      lockedTaskDomain: "none",
      canReplanTask: true,
      reasonForLock: "",
    },
  );

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: revisionSpec,
    userText: "make it 20 minutes",
    currentTemplateId: "hands_protocol",
  });
  const selected = selectTaskCandidate(candidates, revisionSpec.requested_domain, revisionSpec);

  assert.equal(revisionSpec.request_kind, "revision");
  assert.equal(revisionSpec.duration_minutes, 20);
  assert.equal(revisionSpec.preserve_current_family, true);
  assert.equal(selected?.family, "posture_hands");
  assert.match(selected?.summary ?? "", /\b20 minutes\b/i);
});

test("plausibility validator rejects insertable-toy posture mismatch", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 30 minute posture task with my dildo",
    inventory: [
      {
        id: "inv-dildo",
        label: "toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me a 30 minute posture task with my dildo",
    inventory: [
      {
        id: "inv-dildo",
        label: "toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
  });

  assert.ok(
    candidates.some((candidate) =>
      candidate.validation.rejection_reasons.some((reason) =>
        reason.startsWith("inventory_semantics_mismatch"),
      ),
    ),
  );
  assert.equal(selectTaskCandidate(candidates, spec.requested_domain, spec), null);
});

test("user asking for options switches task policy into curated options", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me options for a 30 minute posture task and no stillness",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me options for a 30 minute posture task and no stillness",
  });
  const options = selectTaskOptions(candidates, spec);
  const reply = buildTaskOptionsReply(options, spec);

  assert.equal(spec.selection_mode, "curated_options");
  assert.equal(spec.next_required_action, "present_options");
  assert.equal(options.length >= 2, true);
  assert.match(reply, /1\./i);
  assert.match(reply, /pick one cleanly, or tell me to choose/i);
  assert.doesNotMatch(reply, /Here is your task/i);
  assert.doesNotMatch(reply, /stillness/i);
});

test("explicit delegation keeps direct assignment mode", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "you choose the task for me, make it posture for 30 minutes",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "you choose the task for me, make it posture for 30 minutes",
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain, spec);

  assert.equal(spec.selection_mode, "direct_assignment");
  assert.equal(spec.allow_raven_to_choose_alone, true);
  assert.ok(selected);
});

test("inventory-aware curated options surface relevant device entries when the item fits", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me options for a device task for 30 minutes",
    inventory: [
      {
        id: "inv-cage",
        label: "Steel Cage",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "chastity cage",
      },
    ],
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me options for a device task for 30 minutes",
    inventory: [
      {
        id: "inv-cage",
        label: "Steel Cage",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "chastity cage",
      },
    ],
  });
  const options = selectTaskOptions(candidates, spec);

  assert.ok(options.length > 0);
  assert.ok(options.some((option) => option.domain === "device"));
  assert.ok(options.some((option) => /steel cage|chastity/i.test(option.why_it_fits)));
});

test("training-style task suggestion defaults to curated options with concrete proof-aware summaries", () => {
  const inventory = [
    {
      id: "inv-dildo",
      label: "Toy",
      category: "toy" as const,
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "silicone dildo",
    },
  ];

  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "what kind of anal task would be good for 30 minutes",
    inventory,
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "what kind of anal task would be good for 30 minutes",
    inventory,
  });
  const options = selectTaskOptions(candidates, spec);
  const reply = buildTaskOptionsReply(options, spec);

  assert.equal(spec.selection_mode, "curated_options");
  assert.equal(spec.next_required_action, "present_options");
  assert.ok(options.length >= 2);
  assert.match(reply, /30m|30 minutes/i);
  assert.match(reply, /final report back|halfway check-in/i);
  assert.match(reply, /silicone dildo|dildo/i);
  assert.doesNotMatch(reply, /A device task with|A stricter locked device hold/i);
});

test("repeated training-style task suggestions rotate the concrete option order", () => {
  const inventory = [
    {
      id: "inv-dildo",
      label: "Toy",
      category: "toy" as const,
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "silicone dildo",
    },
  ];

  let spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "what kind of anal task would be good for 30 minutes",
    inventory,
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const firstCandidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "what kind of anal task would be good for 30 minutes",
    inventory,
  });
  const firstOptions = selectTaskOptions(firstCandidates, spec);
  const firstReply = buildTaskOptionsReply(firstOptions, spec);
  spec = noteTaskSpecAssistantText(spec, firstReply);

  spec = noteTaskSpecUserTurn(spec, {
    userText: "what kind of anal task would be good for 30 minutes",
    inventory,
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const secondCandidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "what kind of anal task would be good for 30 minutes",
    inventory,
  });
  const secondOptions = selectTaskOptions(secondCandidates, spec);
  const secondReply = buildTaskOptionsReply(secondOptions, spec);

  assert.match(firstReply, /1\.\s*Anal training/i);
  assert.match(secondReply, /1\.\s*Anal hold/i);
  assert.notEqual(normalizeTestText(firstReply), normalizeTestText(secondReply));
});

test("insertable-toy use mode is preserved through replacement and duration revision", () => {
  const inventory = [
    {
      id: "toy-1",
      label: "Toy",
      category: "toy" as const,
      available_this_session: true,
      intiface_controlled: false,
      linked_device_id: null,
      notes: "silicone dildo",
    },
  ];

  const initial = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 20 minute task with my dildo",
    inventory,
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const clarified = noteTaskSpecUserTurn(initial, {
    userText: "anal",
    inventory,
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const replaced = noteTaskSpecUserTurn(clarified, {
    userText: "different task",
    inventory,
    currentTaskDomain: "device",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });
  const revised = noteTaskSpecUserTurn(replaced, {
    userText: "make it 10 minutes",
    inventory,
    currentTaskDomain: "device",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  assert.match(clarified.user_goal, /anal use/i);
  assert.match(replaced.user_goal, /anal use/i);
  assert.match(revised.user_goal, /anal use/i);
  assert.equal(revised.duration_minutes, 10);
});

test("task novelty uses stored task history instead of only current template id", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 20 minute posture task with a halfway check in",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me a 20 minute posture task with a halfway check in",
    currentTemplateId: "discipline_hold",
    recentTaskTemplates: ["discipline_hold"],
    taskHistory: [
      {
        title: "Posture hold task",
        description:
          "Stand tall for 20 minutes, keep shoulders back, check in halfway, then report back.",
        repeats_required: 1,
      },
      {
        title: "Focus hold task",
        description: "Hold still for 20 minutes and report back at the end.",
        repeats_required: 1,
      },
    ],
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain);

  assert.ok(selected);
  assert.equal(selected?.validation.novel_enough, true);
  assert.ok((selected?.validation.novelty_score ?? 0) > 0.34);
});

test("task candidate generation reflects user constraints in the selected task", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText:
      "give me a hard 30 minute device task with a halfway proof check, combine it with stillness, and i have a steel cage",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText:
      "give me a hard 30 minute device task with a halfway proof check, combine it with stillness, and i have a steel cage",
    taskHistory: [],
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain);

  assert.ok(selected);
  assert.match(selected?.why_it_fits ?? "", /\bhard\b|\bhalfway\b|\bpairs\b|\bsteel cage\b/i);
  assert.match(
    `${selected?.summary ?? ""} ${(selected?.steps ?? []).join(" ")}`,
    /\b30 minutes\b|\bhalfway\b/i,
  );
});

test("explicit device task request cannot produce a stillness final task", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 30 minute device task with a halfway check in and i have a steel cage",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me a 30 minute device task with a halfway check in and i have a steel cage",
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain);

  assert.ok(selected);
  assert.equal(selected?.domain, "device");
  assert.equal(selected?.validation.matches_request, true);
  assert.doesNotMatch(selected?.plan.assignmentText ?? "", /\bhold still\b/i);
});

test("explicit posture task request cannot produce a device final task", () => {
  const spec = noteTaskSpecUserTurn(createTaskSpec(), {
    userText: "give me a 20 minute posture task",
    currentTaskDomain: "general",
    lockedTaskDomain: "none",
    canReplanTask: true,
    reasonForLock: "",
  });

  const candidates = buildTaskCandidatesFromSpec({
    taskSpec: spec,
    userText: "give me a 20 minute posture task",
  });
  const selected = selectTaskCandidate(candidates, spec.requested_domain);

  assert.ok(selected);
  assert.notEqual(selected?.domain, "device");
  assert.equal(selected?.validation.matches_request, true);
  assert.doesNotMatch(selected?.plan.assignmentText ?? "", /\bput it on now\b/i);
});

test("selectTaskCandidate returns null when no candidate matches the explicit requested domain", () => {
  const selected = selectTaskCandidate(
    [
      {
        title: "Stillness task",
        domain: "stillness",
        summary: "Hold still for 1 hour.",
        steps: ["Hold still for 1 hour."],
        duration: "1 hour",
        difficulty: "moderate",
        checkin_or_proof_requirement: "halfway check-in",
        why_it_fits: "it does not",
        novelty_check: "novel enough",
        strategy: "anchor",
        plan: {
          template: {
            id: "focus_hold",
            title: "Stillness",
            description: "Hold still for 1 hour.",
            durationMinutes: 60,
            pointsPossible: 5,
            taskKind: "stillness_hold",
            variants: [],
          },
          variantIndex: 0,
          durationMinutes: 60,
          repeatsRequired: 1,
          schedule: { type: "one_time" },
          programKind: "task",
          description: "Hold still for 1 hour.",
          scheduleLine: "",
          assignmentText: "Here is your task: Hold still for 1 hour. Start now.",
          adaptiveSummary: {
            selection: "",
            policy: "",
            reward: "",
            consequence: "",
          },
          selectedInventoryItem: null,
          needsInventoryClarification: false,
          inventoryClarificationQuestion: null,
          createPayload: {
            type: "create_task",
            title: "Stillness task",
            description: "Hold still for 1 hour.",
            window_seconds: 3600,
            repeats_required: 1,
            points_possible: 5,
            schedule: { type: "one_time" },
            evidence: {
              required: true,
              type: "manual",
              checks: [],
              max_attempts: 2,
              deny_user_override: false,
            },
            strictness_mode: "standard",
            program_kind: "task",
            reward_plan: {
              catalog_id: "reward_positive_message",
              params: { template_id: "approval_firm" },
            },
            consequence_plan: {
              catalog_id: "penalty_points",
              params: { penalty_points: 5 },
            },
          },
        },
        validation: {
          matches_request: false,
          novel_enough: true,
          respects_lock: true,
          actionable: true,
          plausible_with_inventory: true,
          respects_latest_correction: true,
          novelty_score: 0.8,
          novelty_breakdown: {
            total_similarity: 0.2,
            title_similarity: 0,
            structure_similarity: 0,
            modifier_similarity: 0,
            domain_penalty: 0,
            duration_penalty: 0,
          },
          rejection_reasons: ["domain_mismatch requested=device selected=stillness"],
        },
      },
    ],
    "device",
  );

  assert.equal(selected, null);
});
