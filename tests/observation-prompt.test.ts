import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObservationPromptBlock,
  normalizeObservationPrompt,
} from "../lib/session/observation-prompt.ts";

test("normalizes missing observation to unavailable defaults", () => {
  const normalized = normalizeObservationPrompt(null);
  assert.equal(normalized.camera_available, false);
  assert.equal(normalized.face_present, false);
  assert.equal(normalized.scene_objects_summary, "I see: none");
  assert.match(normalized.scene_summary, /no observation data/i);
  const block = buildObservationPromptBlock(normalized);
  assert.match(block, /camera_available: false/i);
  assert.match(block, /scene_objects_summary: I see: none/i);
  assert.match(block, /clothing_change_detected: false/i);
  assert.doesNotMatch(block, /Facial cues:/i);
  assert.doesNotMatch(block, /person_present: true/i);
});

test("builds short observation prompt block with key fields", () => {
  const normalized = normalizeObservationPrompt({
    camera_available: true,
    person_present: true,
    face_present: true,
    mouth_open: true,
    smile_score: 0.8,
    brow_furrow_score: 0.22,
    eye_openness_left: 0.7,
    eye_openness_right: 0.8,
    head_pose: { yaw: 14, pitch: -2, roll: 1 },
    gaze_direction: "right",
    pose_label: "unknown",
    motion_state: "moving",
    clothing_change_detected: true,
    clothing_change_region: "upper",
    clothing_change_confidence: 0.72,
    clothing_change_summary: "Possible clothing removal detected in upper region.",
    scene_objects_summary: "I see: chair, desk",
    scene_objects_change: "New: bottle",
    scene_summary: "person present and moving",
    scene_change_summary: "motion changed to moving",
    objects: [{ label: "person", confidence: 0.9 }],
  });
  const block = buildObservationPromptBlock(normalized);
  assert.match(block, /scene_summary: person present and moving/i);
  assert.match(block, /scene_objects_summary: I see: chair, desk/i);
  assert.match(block, /scene_objects_change: New: bottle/i);
  assert.match(block, /scene_change_summary: motion changed to moving/i);
  assert.match(block, /clothing_change_detected: true/i);
  assert.match(block, /clothing_change_region: upper/i);
  assert.match(block, /Facial cues:/i);
  assert.match(block, /mouth open: yes/i);
  assert.match(block, /smile: high/i);
  assert.match(block, /head turned: right/i);
  assert.doesNotMatch(block, /\[|\]/);
});
