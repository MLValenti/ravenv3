import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicVisualObservationReply,
  isVisualStatusQuestion,
} from "../lib/session/visual-observation-reply.ts";
import type { VisionObservation } from "../lib/camera/observation";

function buildObservation(overrides: Partial<VisionObservation> = {}): VisionObservation {
  return {
    ts: 1_000,
    camera_available: true,
    person_present: true,
    face_present: true,
    faces_detected: 1,
    face_bbox: null,
    face_box_area_ratio: 0,
    brightness: 100,
    camera_blur_score: 0.5,
    mouth_open: false,
    mouth_open_ratio: 0,
    mouth_open_confidence: 0,
    smile_score: 0,
    brow_furrow_score: 0,
    eye_openness_left: 0.5,
    eye_openness_right: 0.5,
    head_pose: { yaw: 0, pitch: 0, roll: 0 },
    gaze_direction: "center",
    blink_detected_recent: false,
    blink_rate_per_min: 0,
    head_nod_detected_recent: false,
    head_shake_detected_recent: false,
    framing_stability_score: 0.9,
    face_occlusion_score: 0,
    face_fps: 5,
    pose_label: "unknown",
    pose_confidence: 0,
    keypoints_confidence: 0,
    motion_score: 0,
    motion_state: "still",
    clothing_change_detected: false,
    clothing_change_region: "none",
    clothing_change_confidence: 0,
    clothing_change_summary: "No clothing change signal.",
    clothing_upper_change_score: 0,
    clothing_lower_change_score: 0,
    clothing_baseline_ready: false,
    objects: [],
    custom_objects: [],
    objects_stable: [],
    scene_objects_summary: "I see: none",
    scene_objects_change: null,
    scene_summary: "person present",
    scene_change_summary: null,
    inference_status: "ok",
    inference_fps: 2,
    last_inference_ms: 10,
    object_debug: {
      model_name: "none",
      input_resolution: 0,
      raw_count: 0,
      post_threshold_count: 0,
      post_nms_count: 0,
    },
    custom_match_debug: {
      last_similarity: 0,
      candidate_count: 0,
      reference_count: 0,
    },
    ...overrides,
  };
}

test("detects visual status questions", () => {
  assert.equal(isVisualStatusQuestion("what do you see right now"), true);
  assert.equal(isVisualStatusQuestion("do you see me"), true);
  assert.equal(isVisualStatusQuestion("give me a task"), false);
});

test("visual observation reply reports out of frame when face is gone", () => {
  const text = buildDeterministicVisualObservationReply(
    "what do you see",
    buildObservation({
      person_present: false,
      face_present: false,
      faces_detected: 0,
      ts: 5_000,
    }),
    6_000,
  );
  assert.match(text, /out of frame/i);
  assert.match(text, /do not see your face/i);
});

test("visual observation reply uses fresh current data only", () => {
  const text = buildDeterministicVisualObservationReply("what do you see", buildObservation({ ts: 1_000 }), 5_000);
  assert.match(text, /do not have a reliable camera read/i);
});

test("visual observation reply summarizes current visible state without hallucinating", () => {
  const text = buildDeterministicVisualObservationReply(
    "what do you see",
    buildObservation({
      ts: 5_000,
      motion_state: "moving",
      gaze_direction: "left",
      head_pose: { yaw: -18, pitch: 0, roll: 0 },
      scene_objects_summary: "I see: chair, desk",
    }),
    6_000,
  );
  assert.match(text, /face in frame/i);
  assert.match(text, /Motion is moving/i);
  assert.match(text, /gaze is shifted left/i);
  assert.match(text, /head is turned left/i);
  assert.match(text, /I see: chair, desk/i);
});

test("visual observation reply answers in-frame questions directly", () => {
  const yesText = buildDeterministicVisualObservationReply(
    "am i in frame",
    buildObservation({ ts: 5_000, face_present: true, person_present: true }),
    6_000,
  );
  assert.match(yesText, /yes\. i have your face in frame/i);

  const noText = buildDeterministicVisualObservationReply(
    "can you see me",
    buildObservation({ ts: 5_000, face_present: false, person_present: false, faces_detected: 0 }),
    6_000,
  );
  assert.match(noText, /out of frame/i);
});

test("visual observation reply answers centered and still questions from live signals", () => {
  const centered = buildDeterministicVisualObservationReply(
    "am i centered",
    buildObservation({
      ts: 5_000,
      gaze_direction: "center",
      head_pose: { yaw: 0, pitch: 0, roll: 0 },
    }),
    6_000,
  );
  assert.match(centered, /face is centered/i);

  const notStill = buildDeterministicVisualObservationReply(
    "am i still",
    buildObservation({
      ts: 5_000,
      motion_state: "moving",
    }),
    6_000,
  );
  assert.match(notStill, /still moving/i);
});

test("visual observation reply answers did you see that from scene changes", () => {
  const text = buildDeterministicVisualObservationReply(
    "did you see that",
    buildObservation({
      ts: 5_000,
      scene_change_summary: "New: phone",
    }),
    6_000,
  );
  assert.match(text, /yes\./i);
  assert.match(text, /New: phone/i);
});

test("visual observation reply treats unavailable inference as unreliable", () => {
  const text = buildDeterministicVisualObservationReply(
    "what do you see",
    buildObservation({
      ts: 5_000,
      inference_status: "unavailable",
      last_inference_ms: 0,
    }),
    6_000,
  );
  assert.match(text, /do not have a fresh vision read yet/i);
});
