import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildCapabilityCatalog,
  getVisionSignalsStatus,
} from "../lib/camera/vision-capabilities.ts";
import type { VisionObservation } from "../lib/camera/observation.ts";
import type { CameraFrameSnapshot } from "../lib/camera/check-runner.ts";
import { runVerification } from "../lib/session/verification.ts";

const TEST_DB_FILE = path.join(process.cwd(), ".tmp-custom-items.sqlite");

let dbModulePromise: Promise<typeof import("../lib/db.ts")> | null = null;

async function getDb() {
  process.env.RAVEN_DB_FILE = TEST_DB_FILE;
  if (!dbModulePromise) {
    dbModulePromise = import("../lib/db.ts");
  }
  return dbModulePromise;
}

function makeObservation(patch: Partial<VisionObservation> = {}): VisionObservation {
  return {
    ts: Date.now(),
    camera_available: true,
    person_present: true,
    face_present: true,
    mouth_open: false,
    mouth_open_ratio: 0.1,
    mouth_open_confidence: 0.5,
    smile_score: 0.2,
    brow_furrow_score: 0.1,
    eye_openness_left: 0.5,
    eye_openness_right: 0.5,
    head_pose: { yaw: 0, pitch: 0, roll: 0 },
    gaze_direction: "center",
    face_fps: 5,
    pose_label: "unknown",
    pose_confidence: 0.2,
    keypoints_confidence: 0.6,
    motion_score: 0.2,
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
    scene_summary: "test summary",
    scene_change_summary: null,
    inference_status: "ok",
    inference_fps: 2,
    last_inference_ms: 6,
    object_debug: {
      model_name: "test-model",
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

function makeSnapshot(patch: Partial<CameraFrameSnapshot> = {}): CameraFrameSnapshot {
  return {
    capturedAt: Date.now(),
    cameraReady: true,
    modelLoaded: true,
    videoWidth: 640,
    videoHeight: 480,
    facesDetected: 1,
    brightness: 120,
    yaw: 0,
    lastInferenceMs: 7,
    lastError: null,
    ...patch,
  };
}

test("create custom item and reference persists in db", async () => {
  const db = await getDb();
  await db.__resetDbForTests({ deleteFile: true });

  const item = await db.createCustomItemInDb("ice cube");
  assert.equal(item.label, "ice_cube");
  const ref = await db.createCustomItemRefInDb({
    itemId: item.id,
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
    embedding: [0.1, 0.2, 0.3, 0.4],
  });
  assert.ok(ref);

  const items = await db.listCustomItemsWithRefsFromDb();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.label, "ice_cube");
  assert.equal(items[0]?.references.length, 1);
  assert.equal(items[0]?.references[0]?.item_id, item.id);

  await db.__resetDbForTests({ deleteFile: true });
});

test("capability catalog includes custom object label enum", () => {
  const status = getVisionSignalsStatus([
    {
      detector_id: "object_detector",
      enabled: true,
      healthy: true,
      last_run_ts: Date.now(),
      supported_signals: ["objects", "objects_stable", "custom_objects"],
    },
  ]);

  const catalog = buildCapabilityCatalog(status, {
    objectLabelOptions: ["ice_cube", "water_bottle"],
  });
  const objectPresent = catalog.find((entry) => entry.capability_id === "object_present");
  assert.ok(objectPresent);
  const labelSchema = objectPresent?.parameters_schema.label;
  assert.ok(labelSchema && labelSchema.type === "string");
  if (labelSchema && labelSchema.type === "string") {
    assert.deepEqual(labelSchema.enum, ["ice_cube", "water_bottle"]);
  }
});

test("object_present check passes for custom label in observation", () => {
  const status = getVisionSignalsStatus([
    {
      detector_id: "object_detector",
      enabled: true,
      healthy: true,
      last_run_ts: Date.now(),
      supported_signals: ["objects", "objects_stable", "custom_objects"],
    },
  ]);
  const catalog = buildCapabilityCatalog(status, {
    objectLabelOptions: ["ice_cube"],
  });
  const observation = makeObservation({
    custom_objects: [
      {
        label: "ice_cube",
        confidence: 0.82,
        bbox: { x: 10, y: 10, width: 100, height: 100 },
        item_id: "item-1",
        source: "custom",
        similarity: 0.77,
      },
    ],
    objects_stable: [{ label: "ice_cube", count: 3, confidence_median: 0.8 }],
    scene_objects_summary: "I see: ice_cube",
  });

  const result = runVerification(
    "object_present",
    makeSnapshot(),
    observation,
    { label: "ice_cube", min_confidence: 0.25 },
    catalog,
  );

  assert.equal(result.status, "pass");
  assert.match(result.summary, /ice_cube/i);
});
