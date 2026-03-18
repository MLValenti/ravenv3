import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    OBJECT_MODEL: process.env.OBJECT_MODEL,
    OBJECT_CONFIDENCE_THRESHOLD: process.env.OBJECT_CONFIDENCE_THRESHOLD,
    OBJECT_NMS_IOU_THRESHOLD: process.env.OBJECT_NMS_IOU_THRESHOLD,
    OBJECT_TOPK: process.env.OBJECT_TOPK,
    OBJECT_INPUT_RESOLUTION: process.env.OBJECT_INPUT_RESOLUTION,
    OBJECT_FPS: process.env.OBJECT_FPS,
    OBJECT_STABLE_WINDOW: process.env.OBJECT_STABLE_WINDOW,
    OBJECT_STABLE_MIN_FRAMES: process.env.OBJECT_STABLE_MIN_FRAMES,
    FACE_CUES_FPS: process.env.FACE_CUES_FPS,
    MOUTH_OPEN_THRESHOLD: process.env.MOUTH_OPEN_THRESHOLD,
    VOICE_AUTO_SEND: process.env.VOICE_AUTO_SEND,
    VOICE_MIN_CHARS: process.env.VOICE_MIN_CHARS,
  },
};

export default nextConfig;
