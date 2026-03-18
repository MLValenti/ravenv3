import type { EvidenceAnalysisResult, EvidenceProvider, EvidenceSignalResult } from "../evidence-provider";

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
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

async function imageDataFromDataUrl(imageDataUrl: string): Promise<ImageData> {
  if (typeof window === "undefined") {
    throw new Error("Coverage evidence analysis is only available in the browser.");
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Failed to load uploaded image."));
    nextImage.src = imageDataUrl;
  });

  const aspectRatio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
  const width = Math.max(96, Math.min(192, image.naturalWidth || 160));
  const height = Math.max(96, Math.round(width / Math.max(0.2, aspectRatio)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Failed to create analysis canvas.");
  }
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

async function resolveOptionalImageData(imageDataUrl: string | null | undefined): Promise<ImageData | null> {
  if (!imageDataUrl) {
    return null;
  }
  try {
    return await imageDataFromDataUrl(imageDataUrl);
  } catch {
    return null;
  }
}

function sampleRegionSkinRatio(
  imageData: ImageData,
  yStart: number,
  yEnd: number,
): { skinRatio: number; brightness: number } {
  const { width, height, data } = imageData;
  const x0 = Math.floor(width * 0.25);
  const x1 = Math.ceil(width * 0.75);
  const startY = Math.max(0, Math.floor(height * yStart));
  const endY = Math.min(height, Math.ceil(height * yEnd));
  let skinCount = 0;
  let brightnessSum = 0;
  let sampleCount = 0;
  const stepX = Math.max(1, Math.floor((x1 - x0) / 36));
  const stepY = Math.max(1, Math.floor((endY - startY) / 24));

  for (let y = startY; y < endY; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      brightnessSum += brightness;
      if (isSkinLike(r, g, b)) {
        skinCount += 1;
      }
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) {
    return { skinRatio: 0, brightness: 0 };
  }

  return {
    skinRatio: skinCount / sampleCount,
    brightness: brightnessSum / sampleCount,
  };
}

function buildSignal(id: EvidenceSignalResult["id"], score: number, summary: string): EvidenceSignalResult {
  const normalizedScore = clampUnit(score);
  return {
    id,
    state:
      normalizedScore >= 0.55 ? "positive" : normalizedScore >= 0.2 ? "unknown" : "negative",
    score: normalizedScore,
    summary,
  };
}

function deriveStatus(input: {
  focusUpper: boolean;
  focusLower: boolean;
  upperScore: number;
  lowerScore: number;
  combinedScore: number;
}): { status: EvidenceAnalysisResult["status"]; confidence: number; summary: string } {
  const targetScore = input.focusUpper
    ? input.upperScore
    : input.focusLower
      ? input.lowerScore
      : Math.max(input.upperScore, input.lowerScore, input.combinedScore);

  const confidence = clampUnit(targetScore);
  if (targetScore >= 0.62) {
    const summary = input.focusUpper
      ? "Coverage analysis suggests reduced upper-body coverage."
      : input.focusLower
        ? "Coverage analysis suggests reduced lower-body coverage."
        : "Coverage analysis suggests reduced body coverage.";
    return { status: "pass_candidate", confidence, summary };
  }
  if (targetScore >= 0.32) {
    return {
      status: "inconclusive",
      confidence,
      summary: "Coverage analysis is mixed. Review the evidence manually.",
    };
  }
  return {
    status: "fail_candidate",
    confidence,
    summary: "Coverage analysis did not find a clear reduction in visible coverage.",
  };
}

export const coverageChangeEvidenceProvider: EvidenceProvider = {
  id: "safe_coverage_v1",
  label: "Safe coverage analyzer",
  supportedSignals: [
    "coverage_change_detected",
    "upper_body_coverage_reduced",
    "lower_body_coverage_reduced",
  ],
  async analyzeDataUrl(input) {
    const imageData = await imageDataFromDataUrl(input.imageDataUrl);
    const baselineImageData = await resolveOptionalImageData(input.baselineDataUrl);
    const hint = (input.taskHint ?? "").toLowerCase();
    const focusUpper =
      hint.includes("upper") || hint.includes("top") || hint.includes("shirt") || hint.includes("chest");
    const focusLower =
      hint.includes("lower") || hint.includes("bottom") || hint.includes("pants") || hint.includes("shorts");
    const upperRegion = sampleRegionSkinRatio(imageData, 0.16, 0.56);
    const lowerRegion = sampleRegionSkinRatio(imageData, 0.56, 0.95);
    const baselineUpperRegion = baselineImageData
      ? sampleRegionSkinRatio(baselineImageData, 0.16, 0.56)
      : null;
    const baselineLowerRegion = baselineImageData
      ? sampleRegionSkinRatio(baselineImageData, 0.56, 0.95)
      : null;
    const upperDelta = baselineUpperRegion
      ? clampUnit((upperRegion.skinRatio - baselineUpperRegion.skinRatio + 0.08) / 0.24)
      : 0;
    const lowerDelta = baselineLowerRegion
      ? clampUnit((lowerRegion.skinRatio - baselineLowerRegion.skinRatio + 0.08) / 0.24)
      : 0;
    const upperScore = clampUnit(
      baselineUpperRegion ? upperDelta : (upperRegion.skinRatio - 0.06) / 0.28,
    );
    const lowerScore = clampUnit(
      baselineLowerRegion ? lowerDelta : (lowerRegion.skinRatio - 0.05) / 0.28,
    );
    const combinedScore = clampUnit((upperScore * 0.55 + lowerScore * 0.45));
    const decision = deriveStatus({
      focusUpper,
      focusLower,
      upperScore,
      lowerScore,
      combinedScore,
    });

    return {
      provider_id: "safe_coverage_v1",
      status: decision.status,
      confidence: decision.confidence,
      summary: decision.summary,
      review_recommended: true,
      signals: [
        buildSignal(
          "upper_body_coverage_reduced",
          upperScore,
          `Upper body coverage signal ${Math.round(upperScore * 100)}%.`,
        ),
        buildSignal(
          "lower_body_coverage_reduced",
          lowerScore,
          `Lower body coverage signal ${Math.round(lowerScore * 100)}%.`,
        ),
        buildSignal(
          "coverage_change_detected",
          combinedScore,
          `Combined coverage-change signal ${Math.round(combinedScore * 100)}%.`,
        ),
      ],
      metadata: {
        baseline_used: baselineImageData ? "yes" : "no",
        upper_skin_ratio: Number(upperRegion.skinRatio.toFixed(3)),
        lower_skin_ratio: Number(lowerRegion.skinRatio.toFixed(3)),
        ...(baselineUpperRegion
          ? {
              baseline_upper_skin_ratio: Number(baselineUpperRegion.skinRatio.toFixed(3)),
              baseline_lower_skin_ratio: Number((baselineLowerRegion?.skinRatio ?? 0).toFixed(3)),
            }
          : {}),
        brightness: Number(((upperRegion.brightness + lowerRegion.brightness) / 2).toFixed(3)),
      },
    };
  },
};
