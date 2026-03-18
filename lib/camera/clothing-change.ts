import type { ObservationObject } from "./observation";

export type ClothingRegion = "upper" | "lower";

export type ClothingChangeState = {
  baseline_ready: boolean;
  upper_change_score: number;
  lower_change_score: number;
  upper_removed_score: number;
  lower_removed_score: number;
  upper_skin_ratio: number;
  lower_skin_ratio: number;
  removed_detected: boolean;
  removed_region: "upper" | "lower" | "unknown" | "none";
  removed_confidence: number;
  summary: string;
};

type RegionSignature = {
  vector: Float32Array;
  meanR: number;
  meanG: number;
  meanB: number;
  skinRatio: number;
};

type RegionBounds = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type DetectorInput = {
  imageData: ImageData;
  personPresent: boolean;
  motionState: "moving" | "still";
  objects: ObservationObject[];
};

type BaselineState = {
  upper: RegionSignature | null;
  lower: RegionSignature | null;
  upperClothingCount: number;
  lowerClothingCount: number;
  frameCount: number;
  ready: boolean;
};

const CLOTHING_LABEL_HINTS = new Set([
  "shirt",
  "tshirt",
  "t-shirt",
  "top",
  "blouse",
  "jacket",
  "coat",
  "hoodie",
  "sweater",
  "dress",
  "pants",
  "trousers",
  "shorts",
  "skirt",
]);

const BASELINE_FRAMES_REQUIRED = 6;
const SCORE_EMA_ALPHA = 0.4;
const CHANGE_THRESHOLD = 0.55;
const REGION_MARGIN = 0.08;
const ADAPTATION_ALPHA = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildInitialState(): ClothingChangeState {
  return {
    baseline_ready: false,
    upper_change_score: 0,
    lower_change_score: 0,
    upper_removed_score: 0,
    lower_removed_score: 0,
    upper_skin_ratio: 0,
    lower_skin_ratio: 0,
    removed_detected: false,
    removed_region: "none",
    removed_confidence: 0,
    summary: "Collecting baseline appearance.",
  };
}

function regionBounds(width: number, height: number, region: ClothingRegion): RegionBounds {
  const x0 = Math.floor(width * 0.25);
  const x1 = Math.ceil(width * 0.75);
  if (region === "upper") {
    return {
      x0,
      y0: Math.floor(height * 0.18),
      x1,
      y1: Math.ceil(height * 0.56),
    };
  }
  return {
    x0,
    y0: Math.floor(height * 0.56),
    x1,
    y1: Math.ceil(height * 0.95),
  };
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) {
    return 0;
  }
  return (max - min) / max;
}

function isSkinLike(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    max - min > 15 &&
    Math.abs(r - g) > 10 &&
    r > g &&
    r > b
  );
}

function extractRegionSignature(imageData: ImageData, bounds: RegionBounds): RegionSignature {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const lumHist = new Float32Array(8);
  const satHist = new Float32Array(6);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let skinCount = 0;
  let sampleCount = 0;
  const stepX = Math.max(1, Math.floor((bounds.x1 - bounds.x0) / 40));
  const stepY = Math.max(1, Math.floor((bounds.y1 - bounds.y0) / 30));

  for (let y = bounds.y0; y < bounds.y1; y += stepY) {
    if (y < 0 || y >= height) {
      continue;
    }
    for (let x = bounds.x0; x < bounds.x1; x += stepX) {
      if (x < 0 || x >= width) {
        continue;
      }
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = luma(r, g, b) / 255;
      const sat = saturation(r, g, b);
      const lumBin = clamp(Math.floor(lum * lumHist.length), 0, lumHist.length - 1);
      const satBin = clamp(Math.floor(sat * satHist.length), 0, satHist.length - 1);
      lumHist[lumBin] += 1;
      satHist[satBin] += 1;
      sumR += r;
      sumG += g;
      sumB += b;
      if (isSkinLike(r, g, b)) {
        skinCount += 1;
      }
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) {
    return {
      vector: new Float32Array(lumHist.length + satHist.length + 3),
      meanR: 0,
      meanG: 0,
      meanB: 0,
      skinRatio: 0,
    };
  }

  for (let i = 0; i < lumHist.length; i += 1) {
    lumHist[i] /= sampleCount;
  }
  for (let i = 0; i < satHist.length; i += 1) {
    satHist[i] /= sampleCount;
  }

  const vector = new Float32Array(lumHist.length + satHist.length + 3);
  vector.set(lumHist, 0);
  vector.set(satHist, lumHist.length);
  vector[lumHist.length + satHist.length] = (sumR / sampleCount) / 255;
  vector[lumHist.length + satHist.length + 1] = (sumG / sampleCount) / 255;
  vector[lumHist.length + satHist.length + 2] = (sumB / sampleCount) / 255;

  return {
    vector,
    meanR: sumR / sampleCount,
    meanG: sumG / sampleCount,
    meanB: sumB / sampleCount,
    skinRatio: skinCount / sampleCount,
  };
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 1;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) {
    return 1;
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return clamp(1 - similarity, 0, 1);
}

function meanColorDistance(a: RegionSignature, b: RegionSignature): number {
  const dr = (a.meanR - b.meanR) / 255;
  const dg = (a.meanG - b.meanG) / 255;
  const db = (a.meanB - b.meanB) / 255;
  const euclidean = Math.sqrt(dr * dr + dg * dg + db * db);
  return clamp(euclidean / 1.732, 0, 1);
}

function smooth(previous: number, next: number): number {
  return previous * (1 - SCORE_EMA_ALPHA) + next * SCORE_EMA_ALPHA;
}

function looksLikeClothingLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (CLOTHING_LABEL_HINTS.has(normalized)) {
    return true;
  }
  for (const hint of CLOTHING_LABEL_HINTS) {
    if (normalized.includes(hint)) {
      return true;
    }
  }
  return false;
}

function clothingCountByRegion(
  objects: ObservationObject[],
  frameHeight: number,
): { upper: number; lower: number } {
  let upper = 0;
  let lower = 0;
  for (const item of objects) {
    if (item.confidence < 0.2 || !looksLikeClothingLabel(item.label)) {
      continue;
    }
    const centerY = item.bbox.y + item.bbox.height / 2;
    if (centerY <= frameHeight * 0.56) {
      upper += 1;
    } else {
      lower += 1;
    }
  }
  return { upper, lower };
}

export class ClothingChangeDetector {
  private baseline: BaselineState = {
    upper: null,
    lower: null,
    upperClothingCount: 0,
    lowerClothingCount: 0,
    frameCount: 0,
    ready: false,
  };

  private state: ClothingChangeState = buildInitialState();

  reset() {
    this.baseline = {
      upper: null,
      lower: null,
      upperClothingCount: 0,
      lowerClothingCount: 0,
      frameCount: 0,
      ready: false,
    };
    this.state = buildInitialState();
    return { ...this.state };
  }

  private updateBaselineSignatures(upper: RegionSignature, lower: RegionSignature, alpha: number) {
    if (!this.baseline.upper || !this.baseline.lower) {
      this.baseline.upper = upper;
      this.baseline.lower = lower;
      return;
    }
    for (let i = 0; i < this.baseline.upper.vector.length; i += 1) {
      this.baseline.upper.vector[i] =
        this.baseline.upper.vector[i] * (1 - alpha) + upper.vector[i] * alpha;
    }
    for (let i = 0; i < this.baseline.lower.vector.length; i += 1) {
      this.baseline.lower.vector[i] =
        this.baseline.lower.vector[i] * (1 - alpha) + lower.vector[i] * alpha;
    }
    this.baseline.upper.meanR = this.baseline.upper.meanR * (1 - alpha) + upper.meanR * alpha;
    this.baseline.upper.meanG = this.baseline.upper.meanG * (1 - alpha) + upper.meanG * alpha;
    this.baseline.upper.meanB = this.baseline.upper.meanB * (1 - alpha) + upper.meanB * alpha;
    this.baseline.lower.meanR = this.baseline.lower.meanR * (1 - alpha) + lower.meanR * alpha;
    this.baseline.lower.meanG = this.baseline.lower.meanG * (1 - alpha) + lower.meanG * alpha;
    this.baseline.lower.meanB = this.baseline.lower.meanB * (1 - alpha) + lower.meanB * alpha;
    this.baseline.upper.skinRatio =
      this.baseline.upper.skinRatio * (1 - alpha) + upper.skinRatio * alpha;
    this.baseline.lower.skinRatio =
      this.baseline.lower.skinRatio * (1 - alpha) + lower.skinRatio * alpha;
  }

  update(input: DetectorInput): ClothingChangeState {
    if (!input.personPresent) {
      this.state = {
        ...this.state,
        baseline_ready: this.baseline.ready,
        removed_detected: false,
        removed_region: "none",
        removed_confidence: 0,
        summary: this.baseline.ready
          ? "Person not detected. Waiting to evaluate clothing change."
          : "Collecting baseline appearance.",
      };
      return { ...this.state };
    }

    const upperBounds = regionBounds(input.imageData.width, input.imageData.height, "upper");
    const lowerBounds = regionBounds(input.imageData.width, input.imageData.height, "lower");
    const upperSig = extractRegionSignature(input.imageData, upperBounds);
    const lowerSig = extractRegionSignature(input.imageData, lowerBounds);
    const clothingCounts = clothingCountByRegion(input.objects, input.imageData.height);

    if (!this.baseline.ready) {
      if (input.motionState === "still" || this.baseline.frameCount < 2) {
        this.updateBaselineSignatures(upperSig, lowerSig, 1 / Math.max(1, this.baseline.frameCount + 1));
        this.baseline.upperClothingCount =
          (this.baseline.upperClothingCount * this.baseline.frameCount + clothingCounts.upper) /
          Math.max(1, this.baseline.frameCount + 1);
        this.baseline.lowerClothingCount =
          (this.baseline.lowerClothingCount * this.baseline.frameCount + clothingCounts.lower) /
          Math.max(1, this.baseline.frameCount + 1);
        this.baseline.frameCount += 1;
      }
      if (this.baseline.frameCount >= BASELINE_FRAMES_REQUIRED) {
        this.baseline.ready = true;
      }
      this.state = {
        ...this.state,
        baseline_ready: this.baseline.ready,
        upper_skin_ratio: upperSig.skinRatio,
        lower_skin_ratio: lowerSig.skinRatio,
        summary: this.baseline.ready
          ? "Baseline ready. Monitoring clothing changes."
          : "Collecting baseline appearance.",
      };
      return { ...this.state };
    }

    const baselineUpper = this.baseline.upper;
    const baselineLower = this.baseline.lower;
    if (!baselineUpper || !baselineLower) {
      this.baseline.ready = false;
      return this.reset();
    }

    const upperChangeRaw =
      0.7 * cosineDistance(baselineUpper.vector, upperSig.vector) +
      0.3 * meanColorDistance(baselineUpper, upperSig);
    const lowerChangeRaw =
      0.7 * cosineDistance(baselineLower.vector, lowerSig.vector) +
      0.3 * meanColorDistance(baselineLower, lowerSig);
    const upperChangeScore = smooth(this.state.upper_change_score, clamp(upperChangeRaw, 0, 1));
    const lowerChangeScore = smooth(this.state.lower_change_score, clamp(lowerChangeRaw, 0, 1));

    const upperSkinIncrease = clamp(upperSig.skinRatio - baselineUpper.skinRatio, 0, 1);
    const lowerSkinIncrease = clamp(lowerSig.skinRatio - baselineLower.skinRatio, 0, 1);

    const upperClothingDrop =
      this.baseline.upperClothingCount > 0 && clothingCounts.upper < this.baseline.upperClothingCount * 0.5
        ? 1
        : 0;
    const lowerClothingDrop =
      this.baseline.lowerClothingCount > 0 && clothingCounts.lower < this.baseline.lowerClothingCount * 0.5
        ? 1
        : 0;

    const upperRemovedScore = clamp(
      upperChangeScore * 0.55 + upperSkinIncrease * 0.3 + upperClothingDrop * 0.15,
      0,
      1,
    );
    const lowerRemovedScore = clamp(
      lowerChangeScore * 0.55 + lowerSkinIncrease * 0.3 + lowerClothingDrop * 0.15,
      0,
      1,
    );

    let removedRegion: ClothingChangeState["removed_region"] = "none";
    let removedConfidence = 0;
    if (upperRemovedScore >= CHANGE_THRESHOLD || lowerRemovedScore >= CHANGE_THRESHOLD) {
      if (
        upperRemovedScore >= CHANGE_THRESHOLD &&
        upperRemovedScore > lowerRemovedScore + REGION_MARGIN
      ) {
        removedRegion = "upper";
        removedConfidence = upperRemovedScore;
      } else if (
        lowerRemovedScore >= CHANGE_THRESHOLD &&
        lowerRemovedScore > upperRemovedScore + REGION_MARGIN
      ) {
        removedRegion = "lower";
        removedConfidence = lowerRemovedScore;
      } else {
        removedRegion = "unknown";
        removedConfidence = Math.max(upperRemovedScore, lowerRemovedScore);
      }
    }

    const removedDetected = removedRegion !== "none";
    let summary = "No major clothing change detected.";
    if (removedDetected) {
      summary =
        removedRegion === "unknown"
          ? "Appearance changed, possible clothing removal detected."
          : `Possible clothing removal detected in ${removedRegion} region.`;
    }

    if (!removedDetected && input.motionState === "still") {
      this.updateBaselineSignatures(upperSig, lowerSig, ADAPTATION_ALPHA);
    }

    this.state = {
      baseline_ready: true,
      upper_change_score: upperChangeScore,
      lower_change_score: lowerChangeScore,
      upper_removed_score: upperRemovedScore,
      lower_removed_score: lowerRemovedScore,
      upper_skin_ratio: upperSig.skinRatio,
      lower_skin_ratio: lowerSig.skinRatio,
      removed_detected: removedDetected,
      removed_region: removedRegion,
      removed_confidence: removedConfidence,
      summary,
    };
    return { ...this.state };
  }
}
