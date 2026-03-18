import test from "node:test";
import assert from "node:assert/strict";

import { FacialCueEstimator, type LandmarkPoint } from "../lib/camera/facial-cues.ts";

function makeLandmarks({
  mouthTopY,
  mouthBottomY,
  noseX,
  irisShift = 0,
}: {
  mouthTopY: number;
  mouthBottomY: number;
  noseX: number;
  irisShift?: number;
}): LandmarkPoint[] {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[33] = { x: 0.35, y: 0.4 };
  landmarks[133] = { x: 0.45, y: 0.4 };
  landmarks[263] = { x: 0.65, y: 0.4 };
  landmarks[362] = { x: 0.55, y: 0.4 };
  landmarks[159] = { x: 0.4, y: 0.38 };
  landmarks[145] = { x: 0.4, y: 0.42 };
  landmarks[386] = { x: 0.6, y: 0.38 };
  landmarks[374] = { x: 0.6, y: 0.42 };
  landmarks[61] = { x: 0.38, y: 0.62 };
  landmarks[291] = { x: 0.62, y: 0.62 };
  landmarks[13] = { x: 0.5, y: mouthTopY };
  landmarks[14] = { x: 0.5, y: mouthBottomY };
  landmarks[1] = { x: noseX, y: 0.5 };
  landmarks[55] = { x: 0.43, y: 0.33 };
  landmarks[285] = { x: 0.57, y: 0.33 };
  landmarks[468] = { x: 0.4 + irisShift, y: 0.4 };
  landmarks[473] = { x: 0.6 + irisShift, y: 0.4 };
  return landmarks;
}

test("mouth open toggles with smoothing", () => {
  const estimator = new FacialCueEstimator({
    mouthOpenThreshold: 0.18,
    mouthEmaAlpha: 0.5,
    stabilityWindow: 6,
  });

  const base = {
    facesDetected: 1,
    boundingBox: { x: 10, y: 10, width: 100, height: 120 },
    yaw: 0,
  };

  const closed = estimator.update({
    ts: 1000,
    landmarks: makeLandmarks({ mouthTopY: 0.60, mouthBottomY: 0.63, noseX: 0.5 }),
    ...base,
  });
  assert.equal(closed.mouth_open, false);

  const open1 = estimator.update({
    ts: 1200,
    landmarks: makeLandmarks({ mouthTopY: 0.54, mouthBottomY: 0.71, noseX: 0.5 }),
    ...base,
  });
  const open2 = estimator.update({
    ts: 1400,
    landmarks: makeLandmarks({ mouthTopY: 0.54, mouthBottomY: 0.71, noseX: 0.5 }),
    ...base,
  });
  assert.equal(open2.mouth_open, true);
  assert.ok(open2.mouth_open_ratio > open1.mouth_open_ratio - 0.01);

  let previousRatio = open2.mouth_open_ratio;
  let finalState = open2;
  for (let i = 0; i < 4; i += 1) {
    finalState = estimator.update({
      ts: 1600 + i * 200,
      landmarks: makeLandmarks({ mouthTopY: 0.60, mouthBottomY: 0.63, noseX: 0.5 }),
      ...base,
    });
    assert.ok(previousRatio >= finalState.mouth_open_ratio);
    previousRatio = finalState.mouth_open_ratio;
  }
  assert.equal(finalState.mouth_open, false);
});

test("head yaw and gaze direction update from landmarks", () => {
  const estimator = new FacialCueEstimator();
  const base = {
    facesDetected: 1,
    boundingBox: { x: 10, y: 10, width: 100, height: 120 },
  };

  const left = estimator.update({
    ts: 1000,
    yaw: -0.35,
    landmarks: makeLandmarks({ mouthTopY: 0.58, mouthBottomY: 0.66, noseX: 0.45, irisShift: -0.03 }),
    ...base,
  });
  const right = estimator.update({
    ts: 1200,
    yaw: 0.35,
    landmarks: makeLandmarks({ mouthTopY: 0.58, mouthBottomY: 0.66, noseX: 0.55, irisShift: 0.03 }),
    ...base,
  });

  assert.ok(left.head_pose.yaw < 0);
  assert.ok(right.head_pose.yaw > 0);
  assert.equal(left.gaze_direction, "left");
  assert.equal(right.gaze_direction, "right");
});

test("no face clears cues", () => {
  const estimator = new FacialCueEstimator();
  const result = estimator.update({
    ts: 1000,
    facesDetected: 0,
    yaw: null,
    boundingBox: null,
    landmarks: [],
  });

  assert.equal(result.face_present, false);
  assert.equal(result.mouth_open, false);
  assert.equal(result.gaze_direction, "unknown");
});
