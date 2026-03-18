import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSceneObjectsSummary,
  buildSceneChangeSummary,
  buildSceneSummary,
  MotionDetector,
  StableObjectTracker,
  type VisionObservation,
} from "../lib/camera/observation.ts";

function observation(patch: Partial<VisionObservation>): VisionObservation {
  return {
    ts: 1,
    camera_available: true,
    person_present: false,
    face_present: false,
    mouth_open: false,
    mouth_open_ratio: 0,
    mouth_open_confidence: 0,
    smile_score: 0,
    brow_furrow_score: 0,
    eye_openness_left: 0,
    eye_openness_right: 0,
    head_pose: { yaw: 0, pitch: 0, roll: 0 },
    gaze_direction: "unknown",
    face_fps: 0,
    pose_label: "unknown",
    pose_confidence: 0,
    keypoints_confidence: 0,
    motion_score: 0,
    motion_state: "still",
    clothing_change_detected: false,
    clothing_change_region: "none",
    clothing_change_confidence: 0,
    clothing_change_summary: "No major clothing change detected.",
    clothing_upper_change_score: 0,
    clothing_lower_change_score: 0,
    clothing_baseline_ready: false,
    objects: [],
    custom_objects: [],
    objects_stable: [],
    scene_objects_summary: "I see: none",
    scene_objects_change: null,
    scene_summary: "base",
    scene_change_summary: null,
    inference_status: "ok",
    inference_fps: 2,
    last_inference_ms: 5,
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

test("motion detector switches moving then still with hysteresis", () => {
  const detector = new MotionDetector(0.08, 0.04);
  const still = new Uint8ClampedArray(100).fill(10);
  const moving = new Uint8ClampedArray(100).fill(255);
  const lowMotion = new Uint8ClampedArray(100).fill(12);

  const first = detector.update(still);
  assert.equal(first.motionState, "still");

  const second = detector.update(moving);
  assert.equal(second.motionState, "moving");
  assert.ok(second.motionScore > 0.08);

  const third = detector.update(lowMotion);
  assert.equal(third.motionState, "moving");

  const fourth = detector.update(lowMotion);
  assert.equal(fourth.motionState, "still");
});

test("scene change summary reports change once and then stabilizes", () => {
  const previous = observation({
    person_present: true,
    motion_state: "moving",
    objects: [{ label: "person", confidence: 0.8, bbox: { x: 0, y: 0, width: 1, height: 1 } }],
  });
  const current = observation({
    ts: 2,
    person_present: true,
    motion_state: "still",
    objects: [{ label: "person", confidence: 0.82, bbox: { x: 0, y: 0, width: 1, height: 1 } }],
  });
  const firstChange = buildSceneChangeSummary(previous, current);
  assert.match(firstChange ?? "", /motion changed to still/i);

  const stable = buildSceneChangeSummary(current, {
    ...current,
    ts: 3,
  });
  assert.equal(stable, null);
});

test("scene summary includes top objects", () => {
  const summary = buildSceneSummary(
    observation({
      person_present: true,
      motion_state: "still",
      objects_stable: [{ label: "person", count: 4, confidence_median: 0.82 }],
      scene_objects_summary: "I see: person",
      objects: [
        { label: "person", confidence: 0.82, bbox: { x: 1, y: 2, width: 3, height: 4 } },
      ],
    }),
  );
  assert.match(summary, /person present/i);
  assert.match(summary, /objects person/i);
});

test("scene object summary omits low confidence labels", () => {
  const summary = buildSceneObjectsSummary([
    { label: "chair", count: 5, confidence_median: 0.61 },
    { label: "uncertain", count: 3, confidence_median: 0.12 },
  ]);
  assert.equal(summary, "I see: chair");
});

test("stable object tracker promotes repeated labels and reports changes once", () => {
  const tracker = new StableObjectTracker(4, 2);
  tracker.update([{ label: "chair", confidence: 0.7, bbox: { x: 0, y: 0, width: 10, height: 10 } }]);
  const second = tracker.update([{ label: "chair", confidence: 0.72, bbox: { x: 0, y: 0, width: 10, height: 10 } }]);
  assert.equal(second.stable[0]?.label, "chair");
  assert.match(second.changeSummary ?? "", /New: chair/i);

  const third = tracker.update([{ label: "chair", confidence: 0.75, bbox: { x: 0, y: 0, width: 10, height: 10 } }]);
  assert.equal(third.changeSummary, null);
});

test("unsupported posture stays unknown and does not spam repeated changes", () => {
  const first = observation({
    ts: 10,
    person_present: true,
    pose_label: "unknown",
    scene_summary: "person present, pose unknown",
  });
  const initial = buildSceneChangeSummary(null, first);
  assert.match(initial ?? "", /initial scene observation/i);

  const second = {
    ...first,
    ts: 11,
  };
  const repeated = buildSceneChangeSummary(first, second);
  assert.equal(repeated, null);
});
