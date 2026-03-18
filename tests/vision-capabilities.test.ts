import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapabilityCatalog,
  getVisionSignalsStatus,
  validateCapabilityCheck,
  type VisionDetectorStatus,
} from "../lib/camera/vision-capabilities.ts";

function detector(
  detector_id: string,
  supported_signals: string[],
  overrides: Partial<VisionDetectorStatus> = {},
): VisionDetectorStatus {
  return {
    detector_id,
    enabled: true,
    healthy: true,
    last_run_ts: 1,
    supported_signals,
    ...overrides,
  };
}

function capabilityIds(catalog: ReturnType<typeof buildCapabilityCatalog>): string[] {
  return catalog.map((entry) => entry.capability_id);
}

test("catalog shrinks when detectors are disabled", () => {
  const status = getVisionSignalsStatus([
    detector("face_landmarker", ["person_present", "face_present", "head_pose_yaw"]),
    detector("facial_cues", ["mouth_open_ratio", "smile_score"], { enabled: false }),
    detector("motion", ["motion_score", "motion_state"]),
    detector("object_detector", ["objects", "objects_stable"], { enabled: false }),
  ]);

  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(ids.includes("presence"));
  assert.ok(ids.includes("head_turn"));
  assert.ok(ids.includes("hold_still"));
  assert.ok(ids.includes("motion_state"));
  assert.ok(!ids.includes("mouth_open"));
  assert.ok(!ids.includes("object_present"));
});

test("mouth_open appears when face landmarks cues are available", () => {
  const status = getVisionSignalsStatus([
    detector("face_landmarker", ["person_present", "face_present", "head_pose_yaw"]),
    detector("facial_cues", ["mouth_open_ratio", "mouth_open_confidence", "smile_score"]),
  ]);

  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(ids.includes("mouth_open"));
});

test("object_present appears when object detector is available", () => {
  const status = getVisionSignalsStatus([
    detector("object_detector", ["objects", "objects_stable", "scene_objects_summary"]),
  ]);

  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(ids.includes("object_present"));
});

test("capability is absent when required signals are missing", () => {
  const status = getVisionSignalsStatus([
    detector("motion", ["motion_state"]),
  ]);

  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(!ids.includes("motion_state"));
});

test("plan validation rejects unknown capabilities", () => {
  const status = getVisionSignalsStatus([
    detector("face_landmarker", ["person_present", "face_present", "head_pose_yaw"]),
  ]);
  const catalog = buildCapabilityCatalog(status);
  const result = validateCapabilityCheck("unknown_capability", {}, catalog);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /unsupported checkType/i);
});

test("clothing_removed appears when clothing change signals are available", () => {
  const status = getVisionSignalsStatus([
    detector("clothing_change", [
      "clothing_change_detected",
      "clothing_change_region",
      "clothing_change_confidence",
      "clothing_baseline_ready",
    ]),
  ]);

  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(ids.includes("clothing_removed"));
});

test("framing and lighting capabilities appear when required signals are available", () => {
  const status = getVisionSignalsStatus([
    detector("face_landmarker", [
      "person_present",
      "face_present",
      "faces_detected",
      "face_bbox",
      "face_box_area_ratio",
      "head_pose_yaw",
    ]),
    detector("facial_cues", [
      "gaze_direction",
      "brightness",
      "mouth_open_ratio",
      "eye_openness_left",
      "eye_openness_right",
      "brow_furrow_score",
      "head_pose",
      "blink_detected_recent",
      "blink_rate_per_min",
      "head_nod_detected_recent",
      "head_shake_detected_recent",
      "framing_stability_score",
      "face_occlusion_score",
      "camera_blur_score",
    ]),
    detector("motion", ["motion_state", "motion_score"]),
    detector("object_detector", ["objects", "custom_objects", "objects_stable"]),
  ]);

  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(ids.includes("centered_in_frame"));
  assert.ok(ids.includes("distance_ok"));
  assert.ok(ids.includes("gaze_centered"));
  assert.ok(ids.includes("single_person_only"));
  assert.ok(ids.includes("lighting_quality"));
  assert.ok(ids.includes("stillness_hold"));
  assert.ok(ids.includes("mouth_closed"));
  assert.ok(ids.includes("eyes_open"));
  assert.ok(ids.includes("brow_furrowed"));
  assert.ok(ids.includes("head_level"));
  assert.ok(ids.includes("eye_contact_hold"));
  assert.ok(ids.includes("blink_detected"));
  assert.ok(ids.includes("blink_rate_range"));
  assert.ok(ids.includes("head_nod_detected"));
  assert.ok(ids.includes("head_shake_detected"));
  assert.ok(ids.includes("face_occluded"));
  assert.ok(ids.includes("framing_stable"));
  assert.ok(ids.includes("motion_zone"));
  assert.ok(ids.includes("shoulders_level"));
  assert.ok(ids.includes("posture_upright"));
  assert.ok(ids.includes("body_in_frame_full"));
  assert.ok(ids.includes("timed_hold_pass"));
  assert.ok(ids.includes("sequence_check"));
  assert.ok(ids.includes("rep_counter"));
  assert.ok(ids.includes("attention_state"));
  assert.ok(ids.includes("camera_quality"));
  assert.ok(ids.includes("scene_safety"));
  assert.ok(ids.includes("object_interaction_sequence"));
  assert.ok(!ids.includes("hand_visible_left_right"));
  assert.ok(!ids.includes("hand_pose"));
});

test("object_absent appears when object signals are available", () => {
  const status = getVisionSignalsStatus([
    detector("object_detector", ["objects", "custom_objects", "objects_stable"]),
  ]);
  const ids = capabilityIds(buildCapabilityCatalog(status));
  assert.ok(ids.includes("object_absent"));
});
