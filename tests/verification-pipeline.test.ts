import test from "node:test";
import assert from "node:assert/strict";

import {
  runVerification,
  shouldRequestUserConfirmation,
  shouldRetryVerification,
} from "../lib/session/verification.ts";
import {
  buildCapabilityCatalog,
  getVisionSignalsStatus,
} from "../lib/camera/vision-capabilities.ts";
import type { VisionObservation } from "../lib/camera/observation.ts";
import type { CameraFrameSnapshot } from "../lib/camera/check-runner.ts";

function snapshot(patch: Partial<CameraFrameSnapshot>): CameraFrameSnapshot {
  return {
    capturedAt: 1,
    cameraReady: true,
    modelLoaded: true,
    videoWidth: 640,
    videoHeight: 480,
    facesDetected: 1,
    brightness: 120,
    yaw: 0,
    lastInferenceMs: 8,
    lastError: null,
    ...patch,
  };
}

function observation(patch: Partial<VisionObservation>): VisionObservation {
  return {
    ts: Date.now(),
    camera_available: true,
    person_present: true,
    face_present: true,
    faces_detected: 1,
    face_bbox: {
      x: 0.38,
      y: 0.22,
      width: 0.24,
      height: 0.4,
    },
    face_box_area_ratio: 0.096,
    brightness: 120,
    camera_blur_score: 0.5,
    mouth_open: false,
    mouth_open_ratio: 0.1,
    mouth_open_confidence: 0.5,
    smile_score: 0.2,
    brow_furrow_score: 0.1,
    eye_openness_left: 0.5,
    eye_openness_right: 0.5,
    head_pose: { yaw: 0, pitch: 0, roll: 0 },
    gaze_direction: "center",
    blink_detected_recent: false,
    blink_rate_per_min: 12,
    head_nod_detected_recent: false,
    head_shake_detected_recent: false,
    framing_stability_score: 0.85,
    face_occlusion_score: 0.1,
    face_fps: 5,
    pose_label: "unknown",
    pose_confidence: 0.2,
    keypoints_confidence: 0.6,
    motion_score: 0.1,
    motion_state: "still",
    clothing_change_detected: false,
    clothing_change_region: "none",
    clothing_change_confidence: 0,
    clothing_change_summary: "No major clothing change detected.",
    clothing_upper_change_score: 0,
    clothing_lower_change_score: 0,
    clothing_baseline_ready: true,
    objects: [],
    custom_objects: [],
    objects_stable: [],
    scene_objects_summary: "I see: none",
    scene_objects_change: null,
    scene_summary: "test",
    scene_change_summary: null,
    inference_status: "ok",
    inference_fps: 2,
    last_inference_ms: 8,
    object_debug: {
      model_name: "mock",
      input_resolution: 640,
      raw_count: 0,
      post_threshold_count: 0,
      post_nms_count: 0,
    },
    custom_match_debug: {
      last_similarity: 0,
      candidate_count: 0,
      reference_count: 0,
    },
    ...patch,
  };
}

test("user_present verification passes with confident face detection", () => {
  const result = runVerification("user_present", snapshot({ facesDetected: 1, brightness: 120 }));
  assert.equal(result.status, "pass");
  assert.ok(result.confidence >= 0.7);
});

test("standing_vs_sitting returns unsupported inconclusive", () => {
  const result = runVerification("standing_vs_sitting", snapshot({}));
  assert.equal(result.status, "inconclusive");
  assert.match(result.summary, /not supported/i);
});

test("camera unavailable requests single user confirmation", () => {
  const result = runVerification("user_present", snapshot({ cameraReady: false, facesDetected: 0 }));
  assert.equal(result.status, "inconclusive");
  assert.equal(shouldRequestUserConfirmation(result), true);
  assert.equal(shouldRetryVerification(result, 1), false);
});

test("inconclusive verification retries exactly once when camera is ready", () => {
  const first = runVerification("user_present", snapshot({ modelLoaded: false }));
  assert.equal(first.status, "inconclusive");
  assert.equal(shouldRetryVerification(first, 1), true);
  assert.equal(shouldRetryVerification(first, 0), false);
});

test("clothing_removed verification passes when clothing change is detected", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "clothing_change",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: [
          "clothing_change_detected",
          "clothing_change_region",
          "clothing_change_confidence",
          "clothing_baseline_ready",
        ],
      },
    ]),
  );

  const result = runVerification(
    "clothing_removed",
    snapshot({}),
    observation({
      clothing_change_detected: true,
      clothing_change_region: "upper",
      clothing_change_confidence: 0.71,
      clothing_change_summary: "Possible clothing removal detected in upper region.",
    }),
    { region: "upper", min_confidence: 0.55 },
    catalog,
  );

  assert.equal(result.status, "pass");
  assert.match(result.summary, /clothing removal/i);
});

test("centered_in_frame verification passes when face is centered", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["face_bbox", "face_present", "person_present"],
      },
    ]),
  );

  const result = runVerification(
    "centered_in_frame",
    snapshot({}),
    observation({
      face_bbox: {
        x: 0.4,
        y: 0.2,
        width: 0.2,
        height: 0.4,
      },
    }),
    { max_center_offset: 0.25 },
    catalog,
  );

  assert.equal(result.status, "pass");
});

test("single_person_only verification fails when multiple faces are detected", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["faces_detected", "face_present", "person_present"],
      },
    ]),
  );

  const result = runVerification(
    "single_person_only",
    snapshot({ facesDetected: 2 }),
    observation({
      faces_detected: 2,
      person_present: true,
      face_present: true,
    }),
    { max_faces: 1 },
    catalog,
  );

  assert.equal(result.status, "fail");
  assert.match(result.summary, /face count/i);
});

test("mouth_closed verification passes when ratio is below threshold", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["mouth_open_ratio", "mouth_open_confidence", "face_present"],
      },
    ]),
  );

  const result = runVerification(
    "mouth_closed",
    snapshot({}),
    observation({
      mouth_open_ratio: 0.08,
      mouth_open_confidence: 0.74,
      face_present: true,
    }),
    { max_ratio: 0.14 },
    catalog,
  );

  assert.equal(result.status, "pass");
  assert.match(result.summary, /Mouth closed verified/i);
});

test("eyes_open verification fails when one eye openness is below threshold", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["eye_openness_left", "eye_openness_right", "face_present"],
      },
    ]),
  );

  const result = runVerification(
    "eyes_open",
    snapshot({}),
    observation({
      eye_openness_left: 0.4,
      eye_openness_right: 0.2,
      face_present: true,
    }),
    { min_openness: 0.3 },
    catalog,
  );

  assert.equal(result.status, "fail");
});

test("object_absent verification passes when label is not detected", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "object_detector",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["objects", "custom_objects", "objects_stable"],
      },
    ]),
  );

  const result = runVerification(
    "object_absent",
    snapshot({}),
    observation({
      objects: [{ label: "bottle", confidence: 0.62, bbox: { x: 1, y: 1, width: 5, height: 5 } }],
      custom_objects: [],
      objects_stable: [{ label: "bottle", count: 4, confidence_median: 0.61 }],
    }),
    { label: "phone", max_confidence: 0.2 },
    catalog,
  );

  assert.equal(result.status, "pass");
});

test("eye_contact_hold verification passes for centered gaze with low yaw", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["gaze_direction", "head_pose_yaw", "face_present"],
      },
    ]),
  );

  const result = runVerification(
    "eye_contact_hold",
    snapshot({}),
    observation({
      gaze_direction: "center",
      head_pose: { yaw: 2, pitch: 0, roll: 0 },
      face_present: true,
    }),
    { allowed_deviation_yaw: 8, require_gaze_center: true },
    catalog,
  );

  assert.equal(result.status, "pass");
});

test("blink_detected verification passes when recent blink signal is true", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["blink_detected_recent", "blink_rate_per_min", "face_present"],
      },
    ]),
  );

  const result = runVerification(
    "blink_detected",
    snapshot({}),
    observation({
      face_present: true,
      blink_detected_recent: true,
      blink_rate_per_min: 15,
    }),
    {},
    catalog,
  );

  assert.equal(result.status, "pass");
});

test("motion_zone verification fails when face center is outside zone", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["face_bbox", "face_present"],
      },
    ]),
  );

  const result = runVerification(
    "motion_zone",
    snapshot({}),
    observation({
      face_bbox: { x: 0.8, y: 0.3, width: 0.15, height: 0.2 },
      face_present: true,
    }),
    { zone_x: 0.2, zone_y: 0.1, zone_width: 0.4, zone_height: 0.5 },
    catalog,
  );

  assert.equal(result.status, "fail");
});

test("posture_upright verification passes for low pitch and roll", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["head_pose", "person_present", "motion_state"],
      },
    ]),
  );

  const result = runVerification(
    "posture_upright",
    snapshot({}),
    observation({
      person_present: true,
      head_pose: { yaw: 0, pitch: 6, roll: 4 },
      motion_state: "still",
    }),
    { max_abs_pitch: 20, max_abs_roll: 10, require_still: true },
    catalog,
  );

  assert.equal(result.status, "pass");
});

test("body_in_frame_full verification fails when face is too close", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["face_box_area_ratio", "person_present", "face_present"],
      },
    ]),
  );

  const result = runVerification(
    "body_in_frame_full",
    snapshot({}),
    observation({
      person_present: true,
      face_present: true,
      face_box_area_ratio: 0.24,
    }),
    { min_face_ratio: 0.015, max_face_ratio: 0.12 },
    catalog,
  );

  assert.equal(result.status, "fail");
});

test("timed_hold_pass transitions from inconclusive to pass with same hold_key", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["motion_state", "framing_stability_score", "face_present"],
      },
    ]),
  );

  const baseTs = Date.now();
  const key = `hold-test-${baseTs}`;
  const first = runVerification(
    "timed_hold_pass",
    snapshot({}),
    observation({
      ts: baseTs,
      face_present: true,
      motion_state: "still",
      framing_stability_score: 0.9,
    }),
    { hold_seconds: 3, min_stability: 0.6, hold_key: key },
    catalog,
  );
  assert.equal(first.status, "inconclusive");

  const second = runVerification(
    "timed_hold_pass",
    snapshot({}),
    observation({
      ts: baseTs + 3_400,
      face_present: true,
      motion_state: "still",
      framing_stability_score: 0.92,
    }),
    { hold_seconds: 3, min_stability: 0.6, hold_key: key },
    catalog,
  );
  assert.equal(second.status, "pass");
});

test("sequence_check completes first then second check with same sequence_id", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["person_present", "face_present", "head_pose_yaw", "gaze_direction"],
      },
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["gaze_direction", "head_pose_yaw"],
      },
    ]),
  );

  const sequenceId = `sequence-${Date.now()}`;
  const first = runVerification(
    "sequence_check",
    snapshot({}),
    observation({
      person_present: true,
      face_present: true,
      gaze_direction: "left",
      head_pose: { yaw: 0, pitch: 0, roll: 0 },
    }),
    { first_check: "presence", second_check: "gaze_centered", sequence_id: sequenceId, timeout_seconds: 8 },
    catalog,
  );
  assert.equal(first.status, "inconclusive");

  const second = runVerification(
    "sequence_check",
    snapshot({}),
    observation({
      person_present: true,
      face_present: true,
      gaze_direction: "center",
      head_pose: { yaw: 0, pitch: 0, roll: 0 },
    }),
    { first_check: "presence", second_check: "gaze_centered", sequence_id: sequenceId, timeout_seconds: 8 },
    catalog,
  );
  assert.equal(second.status, "pass");
});

test("attention_state verification passes when expected state is present", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["person_present", "gaze_direction", "head_pose_yaw", "motion_state", "framing_stability_score"],
      },
    ]),
  );

  const result = runVerification(
    "attention_state",
    snapshot({}),
    observation({
      person_present: true,
      gaze_direction: "center",
      head_pose: { yaw: 1, pitch: 0, roll: 0 },
      motion_state: "still",
      framing_stability_score: 0.88,
    }),
    { expected: "present" },
    catalog,
  );
  assert.equal(result.status, "pass");
});

test("camera_quality verification fails on low blur score", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["brightness", "camera_blur_score"],
      },
    ]),
  );

  const result = runVerification(
    "camera_quality",
    snapshot({}),
    observation({
      brightness: 130,
      camera_blur_score: 0.08,
    }),
    { min_brightness: 40, max_brightness: 210, min_blur_score: 0.22 },
    catalog,
  );
  assert.equal(result.status, "fail");
});

test("scene_safety verification fails when face count exceeds max", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "face_landmarker",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["faces_detected", "brightness"],
      },
    ]),
  );

  const result = runVerification(
    "scene_safety",
    snapshot({ facesDetected: 2 }),
    observation({
      faces_detected: 2,
      brightness: 110,
      person_present: true,
    }),
    { max_faces: 1, min_brightness: 35 },
    catalog,
  );
  assert.equal(result.status, "fail");
});

test("rep_counter reaches target reps with a high-cycle signal", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "motion",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["motion_state", "face_box_area_ratio", "person_present", "motion_score"],
      },
    ]),
  );

  const repKey = `rep-${Date.now()}`;
  const result = runVerification(
    "rep_counter",
    snapshot({}),
    observation({
      person_present: true,
      motion_state: "moving",
      face_box_area_ratio: 0.14,
      motion_score: 0.2,
    }),
    { rep_type: "sit_stand", target_reps: 1, rep_key: repKey },
    catalog,
  );
  assert.equal(result.status, "pass");
});

test("object_interaction_sequence progresses to pass across calls", () => {
  const catalog = buildCapabilityCatalog(
    getVisionSignalsStatus([
      {
        detector_id: "object_detector",
        enabled: true,
        healthy: true,
        last_run_ts: Date.now(),
        supported_signals: ["objects", "custom_objects", "objects_stable"],
      },
    ]),
  );

  const sequenceId = `objseq-${Date.now()}`;
  const first = runVerification(
    "object_interaction_sequence",
    snapshot({}),
    observation({
      objects: [],
      objects_stable: [],
      custom_objects: [],
    }),
    { label: "bottle", sequence_id: sequenceId, timeout_seconds: 20, min_confidence: 0.2 },
    catalog,
  );
  assert.equal(first.status, "inconclusive");

  const second = runVerification(
    "object_interaction_sequence",
    snapshot({}),
    observation({
      objects: [{ label: "bottle", confidence: 0.8, bbox: { x: 1, y: 1, width: 3, height: 3 } }],
      objects_stable: [{ label: "bottle", count: 3, confidence_median: 0.75 }],
      custom_objects: [],
    }),
    { label: "bottle", sequence_id: sequenceId, timeout_seconds: 20, min_confidence: 0.2 },
    catalog,
  );
  assert.equal(second.status, "inconclusive");

  const third = runVerification(
    "object_interaction_sequence",
    snapshot({}),
    observation({
      objects: [],
      objects_stable: [],
      custom_objects: [],
    }),
    { label: "bottle", sequence_id: sequenceId, timeout_seconds: 20, min_confidence: 0.2 },
    catalog,
  );
  assert.equal(third.status, "pass");
});
