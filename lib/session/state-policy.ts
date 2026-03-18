import type { MoodLabel, MoodSnapshot } from "./mood-manager";
import type { RelationshipLabel, RelationshipState } from "./relationship-manager";

export type PolicyLevel = "low" | "medium" | "high";
export type ResponseStyle = "concise" | "conversational";
export type DifficultyLevel = 1 | 2 | 3;

export type TonePolicy = {
  response_style: ResponseStyle;
  strictness: PolicyLevel;
  empathy: PolicyLevel;
  question_frequency: PolicyLevel;
  tone_line: string;
  pacing_line: string;
  do_bullets: [string, string];
  avoid_bullets: [string, string];
  target_difficulty: DifficultyLevel;
};

function isLowTrust(label: RelationshipLabel): boolean {
  return label === "low trust" || label === "building";
}

function isHighTrust(label: RelationshipLabel): boolean {
  return label === "established" || label === "high trust";
}

export function deriveTonePolicy(
  moodLabel: MoodLabel,
  relationshipLabel: RelationshipLabel,
): TonePolicy {
  if (moodLabel === "warm" && isHighTrust(relationshipLabel)) {
    return {
      response_style: "conversational",
      strictness: "low",
      empathy: "high",
      question_frequency: "medium",
      tone_line: "Supportive and adaptive while staying in character.",
      pacing_line: "Allow slightly longer arcs and varied steps.",
      do_bullets: [
        "Acknowledge progress with specific detail.",
        "Offer one optional reflective question when useful.",
      ],
      avoid_bullets: [
        "Do not issue multiple hard commands at once.",
        "Do not shift topics without acknowledging the user.",
      ],
      target_difficulty: 3,
    };
  }

  if ((moodLabel === "strict" || moodLabel === "frustrated") && isLowTrust(relationshipLabel)) {
    return {
      response_style: "concise",
      strictness: "high",
      empathy: moodLabel === "frustrated" ? "low" : "medium",
      question_frequency: "low",
      tone_line: "Direct and structured with one clear objective.",
      pacing_line: "Reduce complexity and secure one small success first.",
      do_bullets: [
        "Keep one action per turn.",
        "Use short verification focused prompts.",
      ],
      avoid_bullets: [
        "Do not stack multiple asks in one response.",
        "Do not use vague phrasing.",
      ],
      target_difficulty: 1,
    };
  }

  return {
    response_style: moodLabel === "warm" ? "conversational" : "concise",
    strictness: moodLabel === "strict" ? "high" : "medium",
    empathy: moodLabel === "frustrated" ? "low" : "medium",
    question_frequency: moodLabel === "warm" ? "medium" : "low",
    tone_line: "Balanced and consistent with gradual adaptation.",
    pacing_line: "Keep moderate pacing with clear turn taking.",
    do_bullets: [
      "Acknowledge the latest user input before the next step.",
      "Keep difficulty progression gradual.",
    ],
    avoid_bullets: [
      "Do not repeat the same instruction without new input.",
      "Do not over explain internal logic.",
    ],
    target_difficulty: 2,
  };
}

export function stepDifficultyLevel(
  current: DifficultyLevel,
  target: DifficultyLevel,
): DifficultyLevel {
  if (target === current) {
    return current;
  }
  if (target > current) {
    return (current + 1) as DifficultyLevel;
  }
  return (current - 1) as DifficultyLevel;
}

export function buildSessionStatePromptBlock(input: {
  mood: MoodSnapshot;
  relationship: RelationshipState;
  policy: TonePolicy;
  difficultyLevel: DifficultyLevel;
}): string {
  const mood = input.mood;
  const relationship = input.relationship;
  const policy = input.policy;
  return [
    "State:",
    `Mood: ${mood.mood_label} score ${Math.round(mood.decay_adjusted_score)}`,
    `Relationship: ${relationship.relationship_label} trust ${Math.round(relationship.trust_score)} rapport ${Math.round(relationship.rapport_score)} reliability ${Math.round(relationship.reliability_score)}`,
    "Guidance:",
    `- tone: ${policy.tone_line} style=${policy.response_style} strictness=${policy.strictness} empathy=${policy.empathy}`,
    `- pacing: ${policy.pacing_line} difficulty_level=${input.difficultyLevel} question_frequency=${policy.question_frequency}`,
    `- do: ${policy.do_bullets[0]}`,
    `- do: ${policy.do_bullets[1]}`,
    `- avoid: ${policy.avoid_bullets[0]}`,
    `- avoid: ${policy.avoid_bullets[1]}`,
    "- Never reveal internal numeric scores to the user.",
  ].join("\n");
}
