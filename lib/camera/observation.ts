export type ObservationObject = {
  label: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type CustomObservationObject = ObservationObject & {
  item_id: string;
  source: "custom";
  similarity: number;
};

export const MOTION_SIGNALS = ["motion_score", "motion_state"] as const;
export const CLOTHING_CHANGE_SIGNALS = [
  "clothing_change_detected",
  "clothing_change_region",
  "clothing_change_confidence",
  "clothing_baseline_ready",
] as const;

export type StableObservationObject = {
  label: string;
  count: number;
  confidence_median: number;
};

export type VisionObservation = {
  ts: number;
  camera_available: boolean;
  person_present: boolean;
  face_present: boolean;
  faces_detected?: number;
  face_bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  face_box_area_ratio?: number;
  brightness?: number;
  camera_blur_score?: number;
  mouth_open: boolean;
  mouth_open_ratio: number;
  mouth_open_confidence: number;
  smile_score: number;
  brow_furrow_score: number;
  eye_openness_left: number;
  eye_openness_right: number;
  head_pose: {
    yaw: number;
    pitch: number;
    roll: number;
  };
  gaze_direction: "left" | "right" | "center" | "unknown";
  blink_detected_recent?: boolean;
  blink_rate_per_min?: number;
  head_nod_detected_recent?: boolean;
  head_shake_detected_recent?: boolean;
  framing_stability_score?: number;
  face_occlusion_score?: number;
  face_fps: number;
  pose_label: "standing" | "sitting" | "unknown" | "none";
  pose_confidence: number;
  keypoints_confidence: number;
  motion_score: number;
  motion_state: "moving" | "still";
  clothing_change_detected: boolean;
  clothing_change_region: "upper" | "lower" | "unknown" | "none";
  clothing_change_confidence: number;
  clothing_change_summary: string;
  clothing_upper_change_score: number;
  clothing_lower_change_score: number;
  clothing_baseline_ready: boolean;
  objects: ObservationObject[];
  custom_objects: CustomObservationObject[];
  objects_stable: StableObservationObject[];
  scene_objects_summary: string;
  scene_objects_change: string | null;
  scene_summary: string;
  scene_change_summary: string | null;
  inference_status: "ok" | "limited" | "unavailable";
  inference_fps: number;
  last_inference_ms: number;
  object_debug: {
    model_name: string;
    input_resolution: number;
    raw_count: number;
    post_threshold_count: number;
    post_nms_count: number;
  };
  custom_match_debug: {
    last_similarity: number;
    candidate_count: number;
    reference_count: number;
  };
};

export class MotionDetector {
  private previousGray: Uint8ClampedArray | null = null;
  private moving = false;
  private readonly highThreshold: number;
  private readonly lowThreshold: number;

  constructor(highThreshold = 0.085, lowThreshold = 0.045) {
    this.highThreshold = highThreshold;
    this.lowThreshold = lowThreshold;
  }

  update(grayFrame: Uint8ClampedArray): { motionScore: number; motionState: "moving" | "still" } {
    if (!this.previousGray || this.previousGray.length !== grayFrame.length) {
      this.previousGray = grayFrame.slice();
      this.moving = false;
      return { motionScore: 0, motionState: "still" };
    }

    let diffSum = 0;
    for (let i = 0; i < grayFrame.length; i += 1) {
      diffSum += Math.abs(grayFrame[i] - this.previousGray[i]);
    }

    const motionScore = Math.max(0, Math.min(1, diffSum / (grayFrame.length * 255)));
    if (!this.moving && motionScore >= this.highThreshold) {
      this.moving = true;
    } else if (this.moving && motionScore <= this.lowThreshold) {
      this.moving = false;
    }

    this.previousGray = grayFrame.slice();
    return {
      motionScore,
      motionState: this.moving ? "moving" : "still",
    };
  }
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export class StableObjectTracker {
  private frames: ObservationObject[][] = [];
  private previousStableLabels = new Set<string>();
  private readonly windowSize: number;
  private readonly minFrames: number;

  constructor(windowSize = 8, minFrames = 3) {
    this.windowSize = windowSize;
    this.minFrames = minFrames;
  }

  update(currentObjects: ObservationObject[]): {
    stable: StableObservationObject[];
    changeSummary: string | null;
  } {
    const deduped = new Map<string, ObservationObject>();
    for (const item of currentObjects) {
      const existing = deduped.get(item.label);
      if (!existing || item.confidence > existing.confidence) {
        deduped.set(item.label, item);
      }
    }

    this.frames.push([...deduped.values()]);
    if (this.frames.length > this.windowSize) {
      this.frames.shift();
    }

    const aggregate = new Map<string, number[]>();
    for (const frame of this.frames) {
      for (const item of frame) {
        const list = aggregate.get(item.label) ?? [];
        list.push(item.confidence);
        aggregate.set(item.label, list);
      }
    }

    const stable: StableObservationObject[] = [];
    for (const [label, confidences] of aggregate.entries()) {
      if (confidences.length < this.minFrames) {
        continue;
      }
      stable.push({
        label,
        count: confidences.length,
        confidence_median: median(confidences),
      });
    }

    stable.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return b.confidence_median - a.confidence_median;
    });

    const nextLabels = new Set(stable.map((item) => item.label));
    const added = [...nextLabels].filter((label) => !this.previousStableLabels.has(label));
    const removed = [...this.previousStableLabels].filter((label) => !nextLabels.has(label));
    this.previousStableLabels = nextLabels;

    if (!added.length && !removed.length) {
      return { stable, changeSummary: null };
    }

    const parts: string[] = [];
    if (added.length) {
      parts.push(`New: ${added.join(", ")}`);
    }
    if (removed.length) {
      parts.push(`Gone: ${removed.join(", ")}`);
    }
    return {
      stable,
      changeSummary: parts.join(". "),
    };
  }
}

export function imageDataToGrayscale(imageData: ImageData): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(imageData.width * imageData.height);
  const data = imageData.data;
  let g = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const green = data[i + 1];
    const b = data[i + 2];
    gray[g] = Math.round(0.299 * r + 0.587 * green + 0.114 * b);
    g += 1;
  }
  return gray;
}

function normalizeLabels(objects: ObservationObject[]): string {
  if (!objects.length) {
    return "none";
  }
  return objects
    .slice(0, 5)
    .map((item) => `${item.label}(${item.confidence.toFixed(2)})`)
    .join(", ");
}

function normalizeStableLabels(objects: StableObservationObject[]): string {
  if (!objects.length) {
    return "none";
  }
  return objects
    .slice(0, 5)
    .map((item) => `${item.label}(${item.confidence_median.toFixed(2)})`)
    .join(", ");
}

export function buildSceneObjectsSummary(
  objects: StableObservationObject[],
  minimumConfidence = 0.25,
): string {
  const labels = objects
    .filter((item) => item.confidence_median >= minimumConfidence)
    .slice(0, 5)
    .map((item) => item.label);
  if (!labels.length) {
    return "I see: none";
  }
  return `I see: ${labels.join(", ")}`;
}

export function buildSceneSummary(observation: VisionObservation): string {
  const person = observation.person_present ? "person present" : "person absent";
  const pose = observation.pose_label === "none" ? "pose none" : `pose ${observation.pose_label}`;
  const motion = `motion ${observation.motion_state}`;
  const clothing = observation.clothing_change_detected
    ? `clothing_change ${observation.clothing_change_region} (${observation.clothing_change_confidence.toFixed(2)})`
    : "clothing_change none";
  const objects = `objects ${normalizeLabels(observation.objects)}`;
  const customObjects = `custom_objects ${normalizeLabels(observation.custom_objects)}`;
  const stable = `stable_objects ${normalizeStableLabels(observation.objects_stable)}`;
  return `${person}, ${pose}, ${motion}, ${clothing}, ${observation.scene_objects_summary}, ${objects}, ${customObjects}, ${stable}`;
}

export function buildSceneChangeSummary(
  previous: VisionObservation | null,
  current: VisionObservation,
): string | null {
  if (!previous) {
    return "Initial scene observation captured.";
  }

  const changes: string[] = [];
  if (previous.camera_available !== current.camera_available) {
    changes.push(current.camera_available ? "camera became available" : "camera became unavailable");
  }
  if (previous.person_present !== current.person_present) {
    changes.push(current.person_present ? "person entered frame" : "person left frame");
  }
  if (previous.pose_label !== current.pose_label && current.pose_label !== "unknown") {
    changes.push(`pose changed to ${current.pose_label}`);
  }
  if (previous.motion_state !== current.motion_state) {
    changes.push(`motion changed to ${current.motion_state}`);
  }
  if (previous.clothing_change_detected !== current.clothing_change_detected) {
    changes.push(
      current.clothing_change_detected
        ? `clothing change detected (${current.clothing_change_region})`
        : "clothing change cleared",
    );
  } else if (
    current.clothing_change_detected &&
    previous.clothing_change_region !== current.clothing_change_region
  ) {
    changes.push(`clothing change region ${current.clothing_change_region}`);
  }

  if (current.scene_objects_change) {
    changes.push(current.scene_objects_change);
  }

  if (!changes.length) {
    return null;
  }
  return changes.join("; ");
}
