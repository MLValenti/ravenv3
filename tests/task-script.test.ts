import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicTaskAssignment,
  buildDeterministicTaskPlanFromRequest,
  buildDeterministicTaskFollowUp,
  buildDeterministicTaskCreatePayload,
  buildDeterministicTaskDurationReply,
  buildTaskExecutionExpectedAction,
  buildTaskExecutionRule,
  deriveLearnedConsequenceLeadIn,
  deriveLearnedPenaltyPoints,
  deriveLearnedRewardTemplate,
  deriveLearnedTaskStrictness,
  deriveTaskProgressFromUserText,
  findDeterministicTaskTemplateByDuration,
  selectDeterministicTaskTemplate,
} from "../lib/session/task-script.ts";

test("task script progresses from assigned to secured to halfway to completed", () => {
  let progress = deriveTaskProgressFromUserText("assigned", "done");
  assert.equal(progress, "secured");

  progress = deriveTaskProgressFromUserText("assigned", "i have started it");
  assert.equal(progress, "secured");

  progress = deriveTaskProgressFromUserText(progress, "halfway check in");
  assert.equal(progress, "halfway_checked");

  progress = deriveTaskProgressFromUserText(progress, "all done");
  assert.equal(progress, "completed");
});

test("task script recognizes already-done phrasing for secure and completion", () => {
  let progress = deriveTaskProgressFromUserText("assigned", "i did already and it is on");
  assert.equal(progress, "secured");

  progress = deriveTaskProgressFromUserText("halfway_checked", "time elapsed and already done");
  assert.equal(progress, "completed");
});

test("task script recognizes full-duration completion phrasing", () => {
  const progress = deriveTaskProgressFromUserText(
    "secured",
    "I've kept the chastity device on for the full 30 minutes.",
  );
  assert.equal(progress, "completed");
});

test("task script recognizes natural completion paraphrases", () => {
  const progress = deriveTaskProgressFromUserText(
    "halfway_checked",
    "The 30 minutes are up, and the chastity device remained secure the entire time.",
  );
  assert.equal(progress, "completed");
});

test("task script recognizes configured-duration completion phrasing", () => {
  const progress = deriveTaskProgressFromUserText(
    "secured",
    "I've been wearing it for 30 minutes. What now?",
    30,
  );
  assert.equal(progress, "completed");
});

test("task script does not treat halfway planning question as completion", () => {
  const progress = deriveTaskProgressFromUserText(
    "secured",
    "What should I do after the 15-minute mark?",
    30,
  );
  assert.equal(progress, "secured");
});

test("task script does not mark a task secured from weak follow-up wording alone", () => {
  const progress = deriveTaskProgressFromUserText(
    "assigned",
    "Okay, I'll keep the device on for 30 minutes and report back when it is done.",
    30,
  );
  assert.equal(progress, "assigned");
});

test("task script marks natural secure confirmation as secured", () => {
  const progress = deriveTaskProgressFromUserText(
    "assigned",
    "The chastity device is securely on. What should I do next?",
    30,
  );
  assert.equal(progress, "secured");
});

test("task script marks fastened confirmation as secured", () => {
  const progress = deriveTaskProgressFromUserText(
    "assigned",
    "Alright, the chastity device is securely fastened. What should I do now?",
    30,
  );
  assert.equal(progress, "secured");
});

test("task script accepts assigned-stage natural completion phrasing", () => {
  const progress = deriveTaskProgressFromUserText(
    "assigned",
    "I've kept the chastity device on for 30 minutes as instructed. What's the next step?",
    30,
  );
  assert.equal(progress, "completed");
});

test("task script follow up text matches progress state", () => {
  assert.match(buildDeterministicTaskFollowUp("assigned"), /next on the task/i);
  assert.match(buildDeterministicTaskFollowUp("secured"), /Check in once halfway through/i);
  assert.match(buildDeterministicTaskFollowUp("halfway_checked"), /Halfway check in accepted/i);
  assert.match(buildDeterministicTaskFollowUp("completed"), /The task is complete/i);
  assert.match(buildDeterministicTaskFollowUp("secured", 30), /Stay in frame/i);
  assert.match(buildDeterministicTaskFollowUp("secured", 60), /Hold still/i);
});

test("task script follow up text varies across task variants", () => {
  const securedA = buildDeterministicTaskFollowUp("secured", 120, 0, "steady_hold");
  const securedB = buildDeterministicTaskFollowUp("secured", 120, 1, "steady_hold");
  const halfwayA = buildDeterministicTaskFollowUp("halfway_checked", 120, 0, "steady_hold");
  const halfwayB = buildDeterministicTaskFollowUp("halfway_checked", 120, 1, "steady_hold");

  assert.notEqual(securedA, securedB);
  assert.notEqual(halfwayA, halfwayB);
  assert.match(securedB, /The task is set|Give me one clean halfway check in/i);
  assert.match(halfwayB, /Hold that control|Finish the full/i);
});

test("task script exposes execution rule and expected action", () => {
  assert.match(buildTaskExecutionRule("assigned"), /(secure the task|put the device on|reply done)/i);
  assert.match(buildTaskExecutionExpectedAction("halfway_checked"), /has elapsed/i);
});

test("task script selects different templates by scene context", () => {
  const defaultTemplate = selectDeterministicTaskTemplate();
  const challengeTemplate = selectDeterministicTaskTemplate({ sceneType: "challenge" });
  const stakesTemplate = selectDeterministicTaskTemplate({ hasStakes: true });
  const quickTemplate = selectDeterministicTaskTemplate({ userText: "give me a quick task" });
  const eyeContactTemplate = selectDeterministicTaskTemplate({
    userText: "give me an eye contact task",
  });
  const inspectionTemplate = selectDeterministicTaskTemplate({
    userText: "give me an inspection task",
  });
  const silenceTemplate = selectDeterministicTaskTemplate({
    userText: "give me a silence task",
    allowSilenceHold: true,
  });
  const noDeviceSilenceTemplate = selectDeterministicTaskTemplate({
    userText: "give me a silence task",
  });
  const handsTemplate = selectDeterministicTaskTemplate({
    userText: "give me a hands behind your back task",
  });
  const kneelTemplate = selectDeterministicTaskTemplate({ userText: "give me a kneeling task" });
  const shouldersTemplate = selectDeterministicTaskTemplate({
    userText: "give me a shoulders back task",
  });
  const longTemplate = selectDeterministicTaskTemplate({ userText: "make it longer and strict" });
  const gameTemplate = selectDeterministicTaskTemplate({ sceneType: "game" });
  const learnedTemplate = selectDeterministicTaskTemplate({
    profile: {
      preferred_pace: "slow and steady",
      preferred_style: "strict dominant control",
      likes: "camera focus",
    },
  });

  assert.equal(defaultTemplate.title, "Session hold task");
  assert.equal(challengeTemplate.durationMinutes, 90);
  assert.equal(stakesTemplate.durationMinutes, 180);
  assert.equal(quickTemplate.durationMinutes, 30);
  assert.equal(eyeContactTemplate.durationMinutes, 15);
  assert.equal(inspectionTemplate.durationMinutes, 20);
  assert.equal(silenceTemplate.durationMinutes, 45);
  assert.equal(noDeviceSilenceTemplate.durationMinutes, 60);
  assert.equal(handsTemplate.durationMinutes, 45);
  assert.equal(kneelTemplate.durationMinutes, 30);
  assert.equal(shouldersTemplate.durationMinutes, 30);
  assert.equal(longTemplate.durationMinutes, 240);
  assert.equal(gameTemplate.durationMinutes, 30);
  assert.equal(learnedTemplate.durationMinutes, 60);
});

test("task script builds a persisted create payload from a template", () => {
  const template = selectDeterministicTaskTemplate({ hasStakes: true });
  const payload = buildDeterministicTaskCreatePayload(template, 0, {
    strictnessMode: "hard",
    rewardTemplateId: "approval_brief",
    penaltyPoints: 8,
  });

  assert.equal(payload.title, "Stakes hold task");
  assert.equal(payload.window_seconds, 10_800);
  assert.equal(payload.points_possible, 8);
  assert.equal(payload.evidence.type, "manual");
  assert.equal(payload.strictness_mode, "hard");
  assert.equal(payload.program_kind, "task");
  assert.equal(payload.reward_plan.params.template_id, "approval_brief");
  assert.equal(payload.consequence_plan.params.penalty_points, 8);
});

test("task script builds a daily challenge plan from the user request", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a chastity task for 2 hours, 3 times a day for 5 days",
    hasStakes: true,
  });

  assert.equal(plan.durationMinutes, 120);
  assert.equal(plan.repeatsRequired, 15);
  assert.equal(plan.programKind, "challenge");
  assert.equal(plan.schedule.type, "daily");
  if (plan.schedule.type === "daily") {
    assert.equal(plan.schedule.days, 5);
    assert.equal(plan.schedule.occurrences_per_day, 3);
  }
  assert.match(plan.description, /chastity device/i);
  assert.match(plan.assignmentText, /3 times per day for 5 days/i);
  assert.equal(plan.createPayload.title, "Chastity protocol 5-day challenge");
  assert.equal(plan.createPayload.type, "create_challenge");
  assert.match(plan.adaptiveSummary.selection, /specific task you asked for: chastity training/i);
  assert.match(plan.adaptiveSummary.policy, /strictness=standard/i);
  assert.match(plan.adaptiveSummary.reward, /firm approval/i);
  assert.match(plan.adaptiveSummary.consequence, /5 penalty points/i);
});

test("task script builds a descriptive one-time title for the task panel", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a chastity task for 2 hours",
  });
  const shortChastityPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a chastity task for 30 minutes",
  });
  const inspectionPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me an inspection task for 20 minutes",
  });
  const eyeContactPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me an eye contact task for 15 minutes",
  });
  const handsPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a hands behind your back task for 45 minutes",
  });
  const kneelPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a kneeling task for 30 minutes",
  });
  const shouldersPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a shoulders back task for 30 minutes",
  });

  assert.equal(plan.createPayload.title, "Chastity protocol 2h hold");
  assert.equal(shortChastityPlan.durationMinutes, 30);
  assert.equal(shortChastityPlan.createPayload.title, "Chastity protocol 30m hold");
  assert.match(shortChastityPlan.assignmentText, /Keep your chastity device on for 30 minutes/i);
  assert.equal(eyeContactPlan.createPayload.title, "Eye contact 15m check");
  assert.equal(inspectionPlan.createPayload.title, "Inspection 20m check");
  assert.equal(handsPlan.createPayload.title, "Hands-back 45m hold");
  assert.equal(kneelPlan.createPayload.title, "Kneeling 30m hold");
  assert.equal(shouldersPlan.createPayload.title, "Shoulders-back 30m hold");
});

test("task script synthesizes a specific requested task instead of falling back to posture", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a throat training task for 30 minutes",
  });

  assert.equal(plan.template.id, "focus_hold");
  assert.match(plan.createPayload.title, /Throat Training 30m/i);
  assert.match(plan.assignmentText, /throat training/i);
  assert.doesNotMatch(plan.assignmentText, /strict posture|hands behind your back/i);
  assert.match(plan.adaptiveSummary.selection, /specific task you asked for: throat training/i);
});

test("task script varies specific task synthesis across different requests", () => {
  const oralPlan = buildDeterministicTaskPlanFromRequest({
    userText: "give me an oral control task for 45 minutes",
  });
  const teasingPlan = buildDeterministicTaskPlanFromRequest({
    userText: "i want a teasing task for 30 minutes",
    inventory: [
      {
        id: "plug-1",
        label: "Steel Plug",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  assert.match(oralPlan.createPayload.title, /Throat Training 45m|Throat Control 45m/i);
  assert.match(oralPlan.assignmentText, /oral control|throat training/i);
  assert.match(teasingPlan.createPayload.title, /Teasing 30m/i);
  assert.match(teasingPlan.assignmentText, /teasing/i);
  assert.doesNotMatch(teasingPlan.assignmentText, /strict posture|hands behind your back/i);
});

test("task script uses available session inventory in task naming and description", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a chastity task with my steel cage for 30 minutes",
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  assert.equal(plan.createPayload.title, "Chastity protocol 30m hold (Steel Cage)");
  assert.match(plan.assignmentText, /Here is your task: Keep your Steel Cage on for 30 minutes/i);
  assert.match(plan.adaptiveSummary.selection, /uses your available Steel Cage this session/i);
});

test("task script uses descriptive inventory notes when the label is generic", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "give me a chastity task with my steel chastity cage for 30 minutes",
    inventory: [
      {
        id: "cage-1",
        label: "Toy",
        category: "other",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "steel chastity cage",
      },
    ],
  });

  assert.equal(plan.needsInventoryClarification, false);
  assert.equal(plan.createPayload.title, "Chastity protocol 30m hold (steel chastity cage)");
  assert.match(plan.assignmentText, /Keep your steel chastity cage on for 30 minutes/i);
  assert.match(
    plan.adaptiveSummary.selection,
    /uses your available steel chastity cage this session/i,
  );
});

test("task script keeps insertable-toy tasks grounded after anal use is specified", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "anal. use Toy. 20 minutes",
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
  });

  assert.equal(plan.needsInventoryClarification, false);
  assert.match(plan.assignmentText, /anal/i);
  assert.match(plan.assignmentText, /Toy|silicone dildo/i);
  assert.doesNotMatch(plan.assignmentText, /keep the device on|put the device on|lock the device/i);
});

test("task script keeps explicit dildo tasks grounded even without saved inventory", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "anal use with dildo. give me a 20 minute task",
    templateId: "steady_hold",
    variantIndex: 0,
  });

  assert.match(plan.assignmentText, /anal|dildo/i);
  assert.match(plan.assignmentText, /slow controlled anal rounds|controlled anal/i);
  assert.doesNotMatch(plan.assignmentText, /anal use with dildo sequence/i);
  assert.doesNotMatch(
    plan.assignmentText,
    /keep the device on|put the device on|lock the device|hold still for 1 hour/i,
  );
});

test("task script varies explicit dildo task language across replacement families without saved inventory", () => {
  const steadyPlan = buildDeterministicTaskPlanFromRequest({
    userText: "anal use with dildo. give me a 20 minute task",
    templateId: "steady_hold",
    variantIndex: 0,
  });
  const silencePlan = buildDeterministicTaskPlanFromRequest({
    userText: "anal use with dildo. give me a 20 minute task",
    templateId: "silence_hold",
    variantIndex: 0,
  });
  const stakesPlan = buildDeterministicTaskPlanFromRequest({
    userText: "anal use with dildo. give me a 20 minute task",
    templateId: "stakes_hold",
    variantIndex: 0,
  });

  assert.match(steadyPlan.assignmentText, /slow controlled anal rounds|controlled anal/i);
  assert.match(silencePlan.assignmentText, /quiet|silence|quiet between/i);
  assert.match(stakesPlan.assignmentText, /stricter anal intervals|sharper anal/i);
  assert.notEqual(steadyPlan.assignmentText, silencePlan.assignmentText);
  assert.notEqual(silencePlan.assignmentText, stakesPlan.assignmentText);
  for (const plan of [steadyPlan, silencePlan, stakesPlan]) {
    assert.match(plan.assignmentText, /anal|dildo/i);
    assert.doesNotMatch(plan.assignmentText, /anal use with dildo sequence/i);
    assert.doesNotMatch(plan.assignmentText, /keep the device on|put the device on|lock the device/i);
  }
});

test("task script can assign an inventory task on a generic start cue", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "ok lets start",
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "device",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
      {
        id: "collar-1",
        label: "Collar",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
  });

  assert.equal(plan.createPayload.title, "Chastity protocol 2h hold (Steel Cage)");
  assert.match(plan.assignmentText, /Steel Cage/i);
});

test("task script can resolve template by duration and build matching assignment text", () => {
  const template = findDeterministicTaskTemplateByDuration(60);
  const reply = buildDeterministicTaskAssignment({ template });
  const enforcedReply = buildDeterministicTaskAssignment({
    template,
    leadInLine: "No protection covers you now. This task is enforced.",
  });
  const quickReply = buildDeterministicTaskAssignment({
    template: selectDeterministicTaskTemplate({ userText: "give me a quick task" }),
  });

  assert.equal(template.title, "Focus hold task");
  assert.match(reply, /Hold still for 1 hour/i);
  assert.match(reply, /Hold still now and reply done once you are set/i);
  assert.match(enforcedReply, /No protection covers you now\. This task is enforced\./i);
  assert.match(quickReply, /Stay fully in frame for 30 minutes/i);
  assert.match(quickReply, /Get fully in frame now and reply done once you are set/i);
  assert.equal(buildDeterministicTaskDurationReply(30), "This task runs for 30 minutes.");
  assert.equal(buildDeterministicTaskDurationReply(120), "You will wear it for 2 hours.");
  assert.equal(
    buildDeterministicTaskDurationReply(45, "hands_protocol"),
    "This task runs for 45 minutes.",
  );
  assert.equal(
    buildDeterministicTaskDurationReply(45, "silence_hold"),
    "You will wear it for 45 minutes.",
  );
});

test("task script derives strictness from learned profile and progress", () => {
  assert.equal(
    deriveLearnedTaskStrictness(
      { intensity: "high", preferred_style: "strict" },
      { current_tier: "bronze", free_pass_count: 0, last_completion_summary: null },
    ),
    "hard",
  );
  assert.equal(
    deriveLearnedTaskStrictness(
      { intensity: "gentle", preferred_style: "warm" },
      { current_tier: "bronze", free_pass_count: 1, last_completion_summary: null },
    ),
    "soft",
  );
  assert.equal(
    deriveLearnedTaskStrictness(
      {},
      { current_tier: "gold", free_pass_count: 0, last_completion_summary: null },
    ),
    "hard",
  );
});

test("task script derives reward and consequence severity from learned profile", () => {
  assert.equal(
    deriveLearnedRewardTemplate(
      { intensity: "high", preferred_style: "strict control" },
      { current_tier: "gold", free_pass_count: 0, last_completion_summary: null },
    ),
    "approval_brief",
  );
  assert.equal(
    deriveLearnedRewardTemplate(
      { intensity: "gentle", preferred_style: "warm" },
      { current_tier: "bronze", free_pass_count: 1, last_completion_summary: null },
    ),
    "approval_warm",
  );
  assert.equal(
    deriveLearnedPenaltyPoints(
      { intensity: "high", preferred_style: "strict discipline" },
      { current_tier: "gold", free_pass_count: 0, last_completion_summary: null },
    ),
    8,
  );
  assert.equal(
    deriveLearnedPenaltyPoints(
      { intensity: "soft", preferred_style: "warm" },
      { current_tier: "bronze", free_pass_count: 1, last_completion_summary: null },
    ),
    3,
  );
  assert.match(
    deriveLearnedConsequenceLeadIn(
      { intensity: "high", preferred_style: "strict discipline" },
      { current_tier: "gold", free_pass_count: 0, last_completion_summary: null },
    ),
    /You will do it properly, pet\./i,
  );
  assert.match(
    deriveLearnedConsequenceLeadIn(
      { intensity: "soft", preferred_style: "warm", preferred_pace: "slow" },
      { current_tier: "bronze", free_pass_count: 1, last_completion_summary: null },
    ),
    /Follow through cleanly, pet\./i,
  );
});

test("task script surfaces adaptive rationale from learned profile when no direct keyword is present", () => {
  const plan = buildDeterministicTaskPlanFromRequest({
    userText: "give me something to work on",
    profile: {
      preferred_pace: "slow and steady",
      preferred_style: "strict dominant control",
      likes: "camera focus",
      intensity: "high",
    },
    progress: {
      current_tier: "gold",
      free_pass_count: 0,
      last_completion_summary: null,
    },
  });

  assert.equal(plan.template.id, "focus_hold");
  assert.match(plan.adaptiveSummary.selection, /steadier control/i);
  assert.match(plan.adaptiveSummary.policy, /strictness=hard/i);
  assert.match(plan.adaptiveSummary.reward, /brief approval/i);
  assert.match(plan.adaptiveSummary.consequence, /8 penalty points/i);
  assert.equal(plan.createPayload.strictness_mode, "hard");
  assert.equal(plan.createPayload.reward_plan.params.template_id, "approval_brief");
  assert.equal(plan.createPayload.consequence_plan.params.penalty_points, 8);
});
