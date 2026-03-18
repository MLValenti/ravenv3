import test from "node:test";
import assert from "node:assert/strict";

import {
  computeLetterbox,
  mapBboxFromLetterboxToSource,
} from "../lib/camera/object-preprocess.ts";

test("letterbox resize keeps aspect ratio for landscape input", () => {
  const box = computeLetterbox(1920, 1080, 640, 640);
  assert.equal(box.resizedWidth, 640);
  assert.equal(box.resizedHeight, 360);
  assert.equal(box.padX, 0);
  assert.equal(box.padY, 140);
});

test("letterbox resize keeps aspect ratio for portrait input", () => {
  const box = computeLetterbox(1080, 1920, 640, 640);
  assert.equal(box.resizedWidth, 360);
  assert.equal(box.resizedHeight, 640);
  assert.equal(box.padX, 140);
  assert.equal(box.padY, 0);
});

test("maps bbox coordinates from letterboxed image back to source frame", () => {
  const letterbox = computeLetterbox(1920, 1080, 640, 640);
  const mapped = mapBboxFromLetterboxToSource(
    { x: 64, y: 176, width: 128, height: 64 },
    letterbox,
  );
  assert.equal(Math.round(mapped.x), 192);
  assert.equal(Math.round(mapped.y), 108);
  assert.equal(Math.round(mapped.width), 384);
  assert.equal(Math.round(mapped.height), 192);
});
