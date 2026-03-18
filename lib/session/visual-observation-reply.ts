import type { VisionObservation } from "../camera/observation";

type VisualQuestionType =
  | "general"
  | "in_frame"
  | "centered"
  | "still"
  | "saw_that";

const VISUAL_QUESTION_PATTERNS: Array<{ type: VisualQuestionType; pattern: RegExp }> = [
  { type: "general", pattern: /\bwhat do you see\b/i },
  { type: "general", pattern: /\bwhat can you see\b/i },
  { type: "general", pattern: /\bwhat are you seeing\b/i },
  { type: "general", pattern: /\bwhat do you see now\b/i },
  { type: "general", pattern: /\bwhat do you notice\b/i },
  { type: "in_frame", pattern: /\bdo you see me\b/i },
  { type: "in_frame", pattern: /\bcan you see me\b/i },
  { type: "in_frame", pattern: /\bam i in frame\b/i },
  { type: "in_frame", pattern: /\bam i visible\b/i },
  { type: "centered", pattern: /\bam i centered\b/i },
  { type: "centered", pattern: /\bam i in the center\b/i },
  { type: "centered", pattern: /\bis my face centered\b/i },
  { type: "still", pattern: /\bam i still\b/i },
  { type: "still", pattern: /\bam i holding still\b/i },
  { type: "still", pattern: /\bam i steady\b/i },
  { type: "saw_that", pattern: /\bdid you see that\b/i },
  { type: "saw_that", pattern: /\bdid you catch that\b/i },
  { type: "saw_that", pattern: /\bdid you notice that\b/i },
];

function normalizeSummary(summary: string | null | undefined): string {
  if (!summary) {
    return "I see: none";
  }
  const next = summary.trim();
  return next || "I see: none";
}

function classifyVisualQuestion(text: string): VisualQuestionType | null {
  for (const candidate of VISUAL_QUESTION_PATTERNS) {
    if (candidate.pattern.test(text)) {
      return candidate.type;
    }
  }
  return null;
}

export function isVisualStatusQuestion(text: string): boolean {
  return classifyVisualQuestion(text) !== null;
}

function isObservationFresh(observation: VisionObservation | null, nowMs: number): boolean {
  return Boolean(observation && nowMs - observation.ts <= 3000);
}

function hasReliableInference(observation: VisionObservation): boolean {
  if (!observation.camera_available) {
    return false;
  }
  if (observation.inference_status === "unavailable") {
    return false;
  }
  if (observation.last_inference_ms <= 0) {
    return false;
  }
  return true;
}

function buildUnreliableReply(observation: VisionObservation | null, nowMs: number): string {
  if (!isObservationFresh(observation, nowMs)) {
    return "Listen carefully, pet. I do not have a reliable camera read right now.";
  }
  if (!observation || !observation.camera_available) {
    return "Listen carefully, pet. The camera is unavailable, so I do not have a live visual read.";
  }
  if (observation.inference_status === "unavailable" || observation.last_inference_ms <= 0) {
    return "Listen carefully, pet. The camera is on, but I do not have a fresh vision read yet.";
  }
  return "Listen carefully, pet. I do not have a reliable camera read right now.";
}

function buildInFrameReply(observation: VisionObservation): string {
  if (!observation.person_present && !observation.face_present) {
    return "Listen carefully, pet. No. You are out of frame right now.";
  }
  if (!observation.face_present) {
    return "Listen carefully, pet. I have movement in frame, but I do not have your face clearly.";
  }
  return "Listen carefully, pet. Yes. I have your face in frame right now.";
}

function buildCenteredReply(observation: VisionObservation): string {
  if (!observation.face_present) {
    return "Listen carefully, pet. I cannot verify your centering because I do not have your face clearly.";
  }
  const absYaw = Math.abs(observation.head_pose.yaw);
  if (observation.gaze_direction === "center" && absYaw <= 12) {
    return "Listen carefully, pet. Yes. Your face is centered and your head is aligned.";
  }
  if (absYaw > 12) {
    return observation.head_pose.yaw < 0
      ? "Listen carefully, pet. No. Your head is turned left, so you are not centered."
      : "Listen carefully, pet. No. Your head is turned right, so you are not centered.";
  }
  if (observation.gaze_direction === "left" || observation.gaze_direction === "right") {
    return `Listen carefully, pet. No. Your gaze is shifted ${observation.gaze_direction}, so you are not centered.`;
  }
  return "Listen carefully, pet. Your face is mostly centered, but the frame is not fully stable yet.";
}

function buildStillReply(observation: VisionObservation): string {
  if (!observation.person_present && !observation.face_present) {
    return "Listen carefully, pet. I cannot verify stillness because you are out of frame.";
  }
  if (observation.motion_state === "still") {
    return "Listen carefully, pet. Yes. You are holding still right now.";
  }
  return "Listen carefully, pet. No. You are still moving.";
}

function buildSawThatReply(observation: VisionObservation): string {
  if (!observation.person_present && !observation.face_present) {
    return "Listen carefully, pet. No. You are out of frame, so I did not catch a clear change.";
  }
  if (observation.scene_change_summary) {
    return `Listen carefully, pet. Yes. ${observation.scene_change_summary}`;
  }
  if (observation.clothing_change_detected && observation.clothing_change_summary) {
    return `Listen carefully, pet. Yes. ${observation.clothing_change_summary}`;
  }
  if (observation.head_nod_detected_recent) {
    return "Listen carefully, pet. Yes. I caught a nod.";
  }
  if (observation.head_shake_detected_recent) {
    return "Listen carefully, pet. Yes. I caught a head shake.";
  }
  if (observation.blink_detected_recent) {
    return "Listen carefully, pet. Yes. I caught a recent blink.";
  }
  return "Listen carefully, pet. No clear new change registered on my end.";
}

export function buildDeterministicVisualObservationReply(
  userText: string,
  observation: VisionObservation | null,
  nowMs: number,
): string {
  const questionType = classifyVisualQuestion(userText) ?? "general";

  if (!isObservationFresh(observation, nowMs) || !observation || !hasReliableInference(observation)) {
    return buildUnreliableReply(observation, nowMs);
  }

  if (questionType === "in_frame") {
    return buildInFrameReply(observation);
  }
  if (questionType === "centered") {
    return buildCenteredReply(observation);
  }
  if (questionType === "still") {
    return buildStillReply(observation);
  }
  if (questionType === "saw_that") {
    return buildSawThatReply(observation);
  }

  if (!observation.person_present && !observation.face_present) {
    return "Listen carefully, pet. You are out of frame right now. I do not see your face in the camera.";
  }

  if (!observation.face_present) {
    return "Listen carefully, pet. I have movement in frame, but I do not have your face clearly right now.";
  }

  const parts = ["Listen carefully, pet. I see your face in frame right now."];
  parts.push(`Motion is ${observation.motion_state}.`);

  if (observation.gaze_direction === "center") {
    parts.push("Your gaze is centered.");
  } else if (observation.gaze_direction === "left" || observation.gaze_direction === "right") {
    parts.push(`Your gaze is shifted ${observation.gaze_direction}.`);
  }

  const absYaw = Math.abs(observation.head_pose.yaw);
  if (absYaw <= 12) {
    parts.push("Your head is mostly centered.");
  } else if (observation.head_pose.yaw < 0) {
    parts.push("Your head is turned left.");
  } else {
    parts.push("Your head is turned right.");
  }

  parts.push(normalizeSummary(observation.scene_objects_summary));
  return parts.join(" ");
}
