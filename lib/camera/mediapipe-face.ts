import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { VisionDetectorStatus } from "./vision-capabilities";

export const TASK_MODEL_URL = "/models/face_landmarker.task";
export const WASM_BASE_URL = "/vendor/tasks-vision";
export const FACE_DETECTOR_SIGNALS = [
  "person_present",
  "face_present",
  "face_landmarks",
  "head_pose_yaw",
] as const;

export type FaceDetectionResult = {
  facesDetected: number;
  yaw: number | null;
  landmarks: Array<{ x: number; y: number }>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  lastError: string | null;
};

function computeYawFromLandmarks(landmarks: Array<{ x: number; y: number }>): number | null {
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const noseTip = landmarks[1];
  if (!leftEye || !rightEye || !noseTip) {
    return null;
  }

  const eyeDistance = Math.abs(rightEye.x - leftEye.x);
  if (eyeDistance < 0.0001) {
    return null;
  }

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const normalized = (noseTip.x - eyeMidX) / (eyeDistance / 2);
  return Math.max(-1, Math.min(1, normalized));
}

function toPixel(value: number, size: number): number {
  return value * size;
}

function getBoundingBox(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!landmarks.length) {
    return null;
  }

  const xs = landmarks.map((item) => item.x);
  const ys = landmarks.map((item) => item.y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(1, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(1, Math.max(...ys));
  return {
    x: toPixel(minX, width),
    y: toPixel(minY, height),
    width: toPixel(Math.max(0, maxX - minX), width),
    height: toPixel(Math.max(0, maxY - minY), height),
  };
}

export class MediaPipeFaceDetector {
  private landmarker: FaceLandmarker | null = null;
  private lastTimestampMs = 0;
  private lastRunTs: number | null = null;
  private lastError: string | null = null;
  private initPromise: Promise<boolean> | null = null;

  async init(): Promise<boolean> {
    if (this.landmarker) {
      return true;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: TASK_MODEL_URL,
          },
          // Keep VIDEO mode fixed at creation; avoid runtime setOptions in dev.
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
        this.lastError = null;
        return true;
      } catch (error) {
        this.lastError = error instanceof Error ? error.toString() : String(error);
        this.landmarker = null;
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async recreate(): Promise<boolean> {
    this.landmarker = null;
    this.lastTimestampMs = 0;
    this.initPromise = null;
    return this.init();
  }

  isLoaded(): boolean {
    return this.landmarker !== null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getDetectorStatus(): VisionDetectorStatus {
    return {
      detector_id: "face_landmarker",
      enabled: true,
      healthy: this.landmarker !== null && this.lastError === null,
      last_run_ts: this.lastRunTs,
      supported_signals: [...FACE_DETECTOR_SIGNALS],
    };
  }

  detect(video: HTMLVideoElement, nowMs: number): FaceDetectionResult {
    this.lastRunTs = Date.now();
    if (!this.landmarker) {
      this.lastError = "landmarker not ready";
      return {
        facesDetected: 0,
        yaw: null,
        landmarks: [],
        boundingBox: null,
        lastError: this.lastError,
      };
    }

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      this.lastError = "video not ready";
      return {
        facesDetected: 0,
        yaw: null,
        landmarks: [],
        boundingBox: null,
        lastError: this.lastError,
      };
    }

    const timestampMs = nowMs > this.lastTimestampMs ? nowMs : this.lastTimestampMs + 1;
    this.lastTimestampMs = timestampMs;

    try {
      const result = this.landmarker.detectForVideo(video, timestampMs);
      const landmarks = result.faceLandmarks?.[0] ?? [];
      this.lastError = null;
      return {
        facesDetected: result.faceLandmarks?.length ?? 0,
        yaw: computeYawFromLandmarks(landmarks),
        landmarks: landmarks.map((item) => ({ x: item.x, y: item.y })),
        boundingBox: getBoundingBox(landmarks, video.videoWidth, video.videoHeight),
        lastError: this.lastError,
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.toString() : String(error);
      return {
        facesDetected: 0,
        yaw: null,
        landmarks: [],
        boundingBox: null,
        lastError: this.lastError,
      };
    }
  }
}
