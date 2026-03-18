import test from "node:test";
import assert from "node:assert/strict";

import { ClothingChangeDetector } from "../lib/camera/clothing-change.ts";

function createFrame(
  width: number,
  height: number,
  topRgb: [number, number, number],
  bottomRgb: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rgb = y < height * 0.56 ? topRgb : bottomRgb;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
}

test("clothing change detector builds baseline before detection", () => {
  const detector = new ClothingChangeDetector();
  const baselineFrame = createFrame(160, 120, [40, 60, 160], [30, 30, 30]);
  let latest = detector.update({
    imageData: baselineFrame,
    personPresent: true,
    motionState: "still",
    objects: [],
  });
  assert.equal(latest.baseline_ready, false);
  assert.equal(latest.removed_detected, false);

  for (let i = 0; i < 8; i += 1) {
    latest = detector.update({
      imageData: baselineFrame,
      personPresent: true,
      motionState: "still",
      objects: [],
    });
  }
  assert.equal(latest.baseline_ready, true);
});

test("clothing change detector detects strong upper region removal signal", () => {
  const detector = new ClothingChangeDetector();
  const baselineFrame = createFrame(160, 120, [35, 50, 170], [25, 25, 25]);
  for (let i = 0; i < 8; i += 1) {
    detector.update({
      imageData: baselineFrame,
      personPresent: true,
      motionState: "still",
      objects: [],
    });
  }

  const changedFrame = createFrame(160, 120, [230, 185, 160], [25, 25, 25]);
  let latest = detector.update({
    imageData: changedFrame,
    personPresent: true,
    motionState: "still",
    objects: [],
  });
  for (let i = 0; i < 8; i += 1) {
    latest = detector.update({
      imageData: changedFrame,
      personPresent: true,
      motionState: "still",
      objects: [],
    });
    if (latest.removed_detected) {
      break;
    }
  }

  assert.equal(latest.baseline_ready, true);
  assert.equal(latest.removed_detected, true);
  assert.equal(latest.removed_region, "upper");
  assert.ok(latest.removed_confidence >= 0.55);
});
