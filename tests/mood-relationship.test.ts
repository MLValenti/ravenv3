import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMoodEvent,
  createInitialMoodState,
  readMoodSnapshot,
} from "../lib/session/mood-manager.ts";
import {
  createDefaultRelationshipState,
  updateRelationshipFromSession,
} from "../lib/session/relationship-manager.ts";
import { buildSessionStatePromptBlock, deriveTonePolicy } from "../lib/session/state-policy.ts";
import { toPlannerPrompt } from "../lib/session/step-planner-schema.ts";

test("Mood pass and fail events update score and streak bonuses", () => {
  let mood = createInitialMoodState(0);
  mood = applyMoodEvent(mood, "verification_pass", 1_000);
  mood = applyMoodEvent(mood, "verification_pass", 2_000);
  mood = applyMoodEvent(mood, "verification_pass", 3_000);
  const warmSnapshot = readMoodSnapshot(mood, 3_000);
  assert.equal(warmSnapshot.decay_adjusted_score, 80);
  assert.equal(warmSnapshot.compliance_streak, 3);

  mood = applyMoodEvent(mood, "verification_fail", 4_000);
  mood = applyMoodEvent(mood, "user_refusal", 5_000);
  const strictSnapshot = readMoodSnapshot(mood, 5_000);
  assert.equal(strictSnapshot.decay_adjusted_score, 57);
  assert.equal(strictSnapshot.miss_streak, 2);
});

test("Mood decay lazily moves score toward baseline", () => {
  let mood = createInitialMoodState(0);
  mood = applyMoodEvent(mood, "verification_pass", 1_000);
  mood = applyMoodEvent(mood, "verification_pass", 2_000);
  mood = applyMoodEvent(mood, "verification_pass", 3_000);
  const decayed = readMoodSnapshot(mood, 3_000 + 5 * 60_000);
  assert.equal(decayed.decay_adjusted_score, 75);
});

test("Relationship updates are gradual and capped per session", () => {
  const current = createDefaultRelationshipState(0);
  const improved = updateRelationshipFromSession(
    current,
    {
      pass_rate: 0.92,
      fail_rate: 0.08,
      refusal_count: 0,
      average_response_latency_ms: 9_500,
      total_turns: 10,
      streak_max: 5,
    },
    1_000,
  );

  assert.equal(improved.trust_score - current.trust_score <= 2, true);
  assert.equal(improved.reliability_score - current.reliability_score <= 3, true);
  assert.equal(improved.trust_score > current.trust_score, true);
  assert.equal(improved.reliability_score > current.reliability_score, true);

  const declined = updateRelationshipFromSession(
    improved,
    {
      pass_rate: 0.2,
      fail_rate: 0.8,
      refusal_count: 3,
      average_response_latency_ms: 70_000,
      total_turns: 3,
      streak_max: 0,
    },
    2_000,
  );
  assert.equal(improved.trust_score - declined.trust_score <= 2, true);
  assert.equal(declined.trust_score < improved.trust_score, true);
});

test("Sustained success can move relationship label to established", () => {
  let relationship = createDefaultRelationshipState(0);
  for (let i = 0; i < 25; i += 1) {
    relationship = updateRelationshipFromSession(
      relationship,
      {
        pass_rate: 0.95,
        fail_rate: 0.05,
        refusal_count: 0,
        average_response_latency_ms: 12_000,
        total_turns: 12,
        streak_max: 6,
      },
      10_000 + i,
    );
  }
  assert.equal(
    relationship.relationship_label === "established" ||
      relationship.relationship_label === "high trust",
    true,
  );
});

test("Prompt state block is injected into planner prompt", () => {
  const mood = readMoodSnapshot(createInitialMoodState(0), 0);
  const relationship = createDefaultRelationshipState(0);
  const policy = deriveTonePolicy(mood.mood_label, relationship.relationship_label);
  const stateBlock = buildSessionStatePromptBlock({
    mood,
    relationship,
    policy,
    difficultyLevel: 2,
  });

  const prompt = toPlannerPrompt(
    {
      recentRavenOutputs: ["Keep your gaze steady."],
      recentVerificationSummaries: ["presence passed"],
      lastUserResponse: "done",
      lastUserIntent: "user_ack",
      lastCheckSummary: "presence passed",
      trackingStatus: "tracked",
      lastStepsSummary: "1. check:presence",
      memoryFacts: ["- goal: consistency"],
      memorySummary: "goal consistency",
      sessionMemorySummary: "- goal: consistency",
      sessionPhase: "build",
      awaitingUser: false,
      moodLabel: mood.mood_label,
      relationshipLabel: relationship.relationship_label,
      difficultyLevel: 2,
      statePromptBlock: stateBlock,
      allowedCheckTypes: ["presence", "head_turn", "hold_still"],
      capabilityCatalogPrompt:
        "- presence: Verify user in frame.\n- head_turn: Verify yaw threshold.\n- hold_still: Verify stillness.",
    },
    3,
  );

  assert.match(prompt, /State block:/i);
  assert.match(prompt, /Mood:/i);
  assert.match(prompt, /Relationship:/i);
});
