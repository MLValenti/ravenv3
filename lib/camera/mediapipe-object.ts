import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";

import { WASM_BASE_URL } from "./mediapipe-face";
import type { VisionDetectorStatus } from "./vision-capabilities";

export const OBJECT_DETECTOR_SIGNALS = [
  "objects",
  "objects_stable",
  "scene_objects_summary",
  "scene_objects_change",
] as const;

type DetectorConfig = {
  modelPath: string;
  modelName: string;
  confidenceThreshold: number;
  nmsIouThreshold: number;
  topK: number;
  inputResolution: number;
};

export type RawObjectDetection = {
  label: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type ObjectDetectionStats = {
  modelName: string;
  inputResolution: number;
  rawCount: number;
  postThresholdCount: number;
  postNmsCount: number;
};

export type ObjectDetectionResult = {
  detections: RawObjectDetection[];
  stats: ObjectDetectionStats;
  lastError: string | null;
};

function parseNumber(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeModelPath(rawValue: string | undefined): string {
  const raw = (rawValue ?? "").trim();
  if (!raw) {
    return "/models/efficientdet_lite2.tflite";
  }
  if (raw.includes("/") || raw.includes("\\") || raw.endsWith(".tflite")) {
    return raw;
  }
  return `/models/${raw}.tflite`;
}

function readConfig(): DetectorConfig {
  const modelPath = normalizeModelPath(
    process.env.NEXT_PUBLIC_OBJECT_MODEL ?? process.env.OBJECT_MODEL,
  );
  const confidenceThreshold = parseNumber(
    process.env.NEXT_PUBLIC_OBJECT_CONFIDENCE_THRESHOLD ?? process.env.OBJECT_CONFIDENCE_THRESHOLD,
    0.25,
  );
  const nmsIouThreshold = parseNumber(
    process.env.NEXT_PUBLIC_OBJECT_NMS_IOU_THRESHOLD ?? process.env.OBJECT_NMS_IOU_THRESHOLD,
    0.5,
  );
  const topK = Math.floor(
    parseNumber(process.env.NEXT_PUBLIC_OBJECT_TOPK ?? process.env.OBJECT_TOPK, 50),
  );
  const inputResolution = Math.floor(
    parseNumber(
      process.env.NEXT_PUBLIC_OBJECT_INPUT_RESOLUTION ?? process.env.OBJECT_INPUT_RESOLUTION,
      640,
    ),
  );

  const modelName = modelPath.split("/").pop() || "object-model";
  return {
    modelPath,
    modelName,
    confidenceThreshold: Math.max(0, Math.min(1, confidenceThreshold)),
    nmsIouThreshold: Math.max(0, Math.min(1, nmsIouThreshold)),
    topK: Math.max(1, Math.min(200, topK)),
    inputResolution: Math.max(256, Math.min(1280, inputResolution)),
  };
}

function normalizeLabel(label: string | undefined): string {
  const value = (label ?? "").trim().toLowerCase();
  return value || "unknown";
}

function iou(a: RawObjectDetection["bbox"], b: RawObjectDetection["bbox"]): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const intersection = width * height;
  const union = a.width * a.height + b.width * b.height - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function applyNms(
  detections: RawObjectDetection[],
  threshold: number,
  maxOutput: number,
): RawObjectDetection[] {
  const remaining = [...detections].sort((a, b) => b.confidence - a.confidence);
  const selected: RawObjectDetection[] = [];

  while (remaining.length && selected.length < maxOutput) {
    const next = remaining.shift();
    if (!next) {
      break;
    }
    selected.push(next);
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (normalizeLabel(remaining[i].label) !== normalizeLabel(next.label)) {
        continue;
      }
      if (iou(remaining[i].bbox, next.bbox) > threshold) {
        remaining.splice(i, 1);
      }
    }
  }
  return selected;
}

export class MediaPipeObjectDetector {
  private detector: ObjectDetector | null = null;
  private initPromise: Promise<boolean> | null = null;
  private lastError: string | null = null;
  private lastRunTs: number | null = null;
  private readonly config = readConfig();
  private activeModelPath: string;
  private activeModelName: string;

  constructor() {
    this.activeModelPath = this.config.modelPath;
    this.activeModelName = this.config.modelName;
  }

  getConfig() {
    return {
      ...this.config,
      modelPath: this.activeModelPath,
      modelName: this.activeModelName,
    };
  }

  getLastError() {
    return this.lastError;
  }

  isLoaded() {
    return this.detector !== null;
  }

  getDetectorStatus(): VisionDetectorStatus {
    return {
      detector_id: "object_detector",
      enabled: true,
      healthy: this.detector !== null && this.lastError === null,
      last_run_ts: this.lastRunTs,
      supported_signals: [...OBJECT_DETECTOR_SIGNALS],
    };
  }

  private getModelCandidates(): string[] {
    const defaults = [
      "/models/efficientdet_lite2.tflite",
      "/models/efficientdet_lite0.tflite",
      "/models/efficientdet_lite4.tflite",
    ];
    const unique = new Set<string>([this.config.modelPath, ...defaults]);
    return [...unique];
  }

  private async modelAssetExists(path: string): Promise<boolean> {
    try {
      const head = await fetch(path, { method: "HEAD", cache: "no-store" });
      if (head.ok) {
        return true;
      }
      if (head.status !== 405) {
        return false;
      }
    } catch {
      // fall back to GET
    }

    try {
      const get = await fetch(path, { cache: "no-store" });
      return get.ok;
    } catch {
      return false;
    }
  }

  private async resolveModelPath(): Promise<string | null> {
    const candidates = this.getModelCandidates();
    for (const candidate of candidates) {
      const exists = await this.modelAssetExists(candidate);
      if (exists) {
        return candidate;
      }
    }
    return null;
  }

  async init(): Promise<boolean> {
    if (this.detector) {
      return true;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const modelPath = await this.resolveModelPath();
        if (!modelPath) {
          this.lastError = [
            "Object model file not found in /public/models.",
            "Download one with:",
            "powershell -ExecutionPolicy Bypass -File .\\tools\\vision\\download-object-model.ps1 -Variant efficientdet_lite2",
          ].join(" ");
          this.detector = null;
          return false;
        }

        this.activeModelPath = modelPath;
        this.activeModelName = modelPath.split("/").pop() || this.config.modelName;

        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
        this.detector = await ObjectDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelPath,
          },
          scoreThreshold: 0,
          maxResults: this.config.topK,
          runningMode: "IMAGE",
        });
        this.lastError = null;
        return true;
      } catch (error) {
        this.detector = null;
        this.lastError = error instanceof Error ? error.toString() : String(error);
        return false;
      } finally {
        this.initPromise = null;
      }
    })();
    return this.initPromise;
  }

  detect(input: HTMLCanvasElement): ObjectDetectionResult {
    this.lastRunTs = Date.now();
    if (!this.detector) {
      this.lastError = "object detector not ready";
      return {
        detections: [],
        stats: {
          modelName: this.activeModelName,
          inputResolution: this.config.inputResolution,
          rawCount: 0,
          postThresholdCount: 0,
          postNmsCount: 0,
        },
        lastError: this.lastError,
      };
    }

    try {
      const result = this.detector.detect(input);
      const raw = (result.detections ?? []).map((detection) => {
        const category = detection.categories?.[0];
        const box = detection.boundingBox;
        return {
          label: normalizeLabel(category?.categoryName),
          confidence: Number(category?.score ?? 0),
          bbox: {
            x: Number(box?.originX ?? 0),
            y: Number(box?.originY ?? 0),
            width: Number(box?.width ?? 0),
            height: Number(box?.height ?? 0),
          },
        } satisfies RawObjectDetection;
      });
      const rawCount = raw.length;
      const thresholded = raw
        .filter((item) => item.confidence >= this.config.confidenceThreshold)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.config.topK);
      const postThresholdCount = thresholded.length;
      const nms = applyNms(thresholded, this.config.nmsIouThreshold, this.config.topK);
      const postNmsCount = nms.length;
      this.lastError = null;
      return {
        detections: nms,
        stats: {
          modelName: this.activeModelName,
          inputResolution: this.config.inputResolution,
          rawCount,
          postThresholdCount,
          postNmsCount,
        },
        lastError: null,
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.toString() : String(error);
      return {
        detections: [],
        stats: {
          modelName: this.activeModelName,
          inputResolution: this.config.inputResolution,
          rawCount: 0,
          postThresholdCount: 0,
          postNmsCount: 0,
        },
        lastError: this.lastError,
      };
    }
  }
}
