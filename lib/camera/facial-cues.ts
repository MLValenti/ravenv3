export type LandmarkPoint = {
  x: number;
  y: number;
};

export const FACIAL_CUES_SIGNALS = [
  "mouth_open",
  "mouth_open_ratio",
  "mouth_open_confidence",
  "smile_score",
  "brow_furrow_score",
  "eye_openness_left",
  "eye_openness_right",
  "head_pose",
  "head_pose_yaw",
  "gaze_direction",
] as const;

export type FaceBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GazeDirection = "left" | "right" | "center" | "unknown";

export type FacialCueObservation = {
  ts: number;
  face_present: boolean;
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
  gaze_direction: GazeDirection;
  face_bbox: FaceBoundingBox | null;
  fps: number;
};

type FacialCueConfig = {
  mouthOpenThreshold: number;
  mouthEmaAlpha: number;
  stabilityWindow: number;
};

type FacialCueInput = {
  ts: number;
  facesDetected: number;
  landmarks: LandmarkPoint[];
  boundingBox: FaceBoundingBox | null;
  yaw: number | null;
};

const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;
const MOUTH_TOP_INNER = 13;
const MOUTH_BOTTOM_INNER = 14;
const NOSE_TIP = 1;
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_INNER = 362;
const LEFT_EYE_UPPER = 159;
const LEFT_EYE_LOWER = 145;
const RIGHT_EYE_UPPER = 386;
const RIGHT_EYE_LOWER = 374;
const LEFT_BROW_INNER = 55;
const RIGHT_BROW_INNER = 285;
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function getPoint(landmarks: LandmarkPoint[], index: number): LandmarkPoint | null {
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  return point;
}

function distance(a: LandmarkPoint, b: LandmarkPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleDegrees(a: LandmarkPoint, b: LandmarkPoint): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function midpoint(a: LandmarkPoint, b: LandmarkPoint): LandmarkPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function emptyCue(ts: number, fps = 0): FacialCueObservation {
  return {
    ts,
    face_present: false,
    mouth_open: false,
    mouth_open_ratio: 0,
    mouth_open_confidence: 0,
    smile_score: 0,
    brow_furrow_score: 0,
    eye_openness_left: 0,
    eye_openness_right: 0,
    head_pose: { yaw: 0, pitch: 0, roll: 0 },
    gaze_direction: "unknown",
    face_bbox: null,
    fps,
  };
}

function computeEyeOpenness(
  landmarks: LandmarkPoint[],
  upperIndex: number,
  lowerIndex: number,
  outerIndex: number,
  innerIndex: number,
): number {
  const upper = getPoint(landmarks, upperIndex);
  const lower = getPoint(landmarks, lowerIndex);
  const outer = getPoint(landmarks, outerIndex);
  const inner = getPoint(landmarks, innerIndex);
  if (!upper || !lower || !outer || !inner) {
    return 0;
  }
  const horizontal = distance(outer, inner);
  if (horizontal <= 1e-6) {
    return 0;
  }
  const openness = distance(upper, lower) / horizontal;
  return clamp(openness / 0.35);
}

function computeHeadPitchDegrees(landmarks: LandmarkPoint[]): number {
  const nose = getPoint(landmarks, NOSE_TIP);
  const leftEye = getPoint(landmarks, LEFT_EYE_OUTER);
  const rightEye = getPoint(landmarks, RIGHT_EYE_OUTER);
  const lipTop = getPoint(landmarks, MOUTH_TOP_INNER);
  const lipBottom = getPoint(landmarks, MOUTH_BOTTOM_INNER);
  if (!nose || !leftEye || !rightEye || !lipTop || !lipBottom) {
    return 0;
  }
  const eyeMid = midpoint(leftEye, rightEye);
  const mouthMid = midpoint(lipTop, lipBottom);
  const denom = mouthMid.y - eyeMid.y;
  if (Math.abs(denom) <= 1e-6) {
    return 0;
  }
  const ratio = (nose.y - eyeMid.y) / denom;
  return clamp((ratio - 0.55) * 55, -30, 30);
}

function computeSmileScore(landmarks: LandmarkPoint[]): number {
  const leftCorner = getPoint(landmarks, MOUTH_LEFT);
  const rightCorner = getPoint(landmarks, MOUTH_RIGHT);
  const lipTop = getPoint(landmarks, MOUTH_TOP_INNER);
  const lipBottom = getPoint(landmarks, MOUTH_BOTTOM_INNER);
  if (!leftCorner || !rightCorner || !lipTop || !lipBottom) {
    return 0;
  }
  const mouthWidth = distance(leftCorner, rightCorner);
  if (mouthWidth <= 1e-6) {
    return 0;
  }
  const lipMid = midpoint(lipTop, lipBottom);
  const cornerAvgY = (leftCorner.y + rightCorner.y) / 2;
  const lift = (lipMid.y - cornerAvgY) / mouthWidth;
  return clamp((lift - 0.03) * 7);
}

function computeBrowFurrowScore(landmarks: LandmarkPoint[]): number {
  const leftBrow = getPoint(landmarks, LEFT_BROW_INNER);
  const rightBrow = getPoint(landmarks, RIGHT_BROW_INNER);
  const leftEye = getPoint(landmarks, LEFT_EYE_OUTER);
  const rightEye = getPoint(landmarks, RIGHT_EYE_OUTER);
  if (!leftBrow || !rightBrow || !leftEye || !rightEye) {
    return 0;
  }
  const eyeDistance = distance(leftEye, rightEye);
  if (eyeDistance <= 1e-6) {
    return 0;
  }
  const browDistanceRatio = distance(leftBrow, rightBrow) / eyeDistance;
  return clamp((0.45 - browDistanceRatio) / 0.15);
}

function computeGazeDirection(landmarks: LandmarkPoint[], yawNormalized: number): GazeDirection {
  const leftIris = getPoint(landmarks, LEFT_IRIS_CENTER);
  const rightIris = getPoint(landmarks, RIGHT_IRIS_CENTER);
  const leftOuter = getPoint(landmarks, LEFT_EYE_OUTER);
  const leftInner = getPoint(landmarks, LEFT_EYE_INNER);
  const rightInner = getPoint(landmarks, RIGHT_EYE_INNER);
  const rightOuter = getPoint(landmarks, RIGHT_EYE_OUTER);

  if (leftIris && rightIris && leftOuter && leftInner && rightInner && rightOuter) {
    const leftDenom = leftInner.x - leftOuter.x;
    const rightDenom = rightOuter.x - rightInner.x;
    if (Math.abs(leftDenom) > 1e-6 && Math.abs(rightDenom) > 1e-6) {
      const leftRatio = (leftIris.x - leftOuter.x) / leftDenom;
      const rightRatio = (rightIris.x - rightInner.x) / rightDenom;
      const avg = (leftRatio + rightRatio) / 2;
      if (avg < 0.42) {
        return "left";
      }
      if (avg > 0.58) {
        return "right";
      }
      return "center";
    }
  }

  if (yawNormalized <= -0.18) {
    return "left";
  }
  if (yawNormalized >= 0.18) {
    return "right";
  }
  return "center";
}

function classifyMouthConfidence(stableRatio: number, landmarkCount: number): number {
  const landmarkFactor = clamp(landmarkCount / 478);
  return clamp(0.45 + stableRatio * 0.4 + landmarkFactor * 0.15);
}

export class FacialCueEstimator {
  private readonly config: FacialCueConfig;
  private mouthOpenEma = 0;
  private mouthStates: boolean[] = [];
  private lastTs = 0;
  private lastOutput = emptyCue(0, 0);

  constructor(config?: Partial<FacialCueConfig>) {
    this.config = {
      mouthOpenThreshold: config?.mouthOpenThreshold ?? 0.18,
      mouthEmaAlpha: config?.mouthEmaAlpha ?? 0.35,
      stabilityWindow: config?.stabilityWindow ?? 8,
    };
  }

  getLastOutput(): FacialCueObservation {
    return { ...this.lastOutput, head_pose: { ...this.lastOutput.head_pose } };
  }

  reset(ts: number): FacialCueObservation {
    this.mouthOpenEma = 0;
    this.mouthStates = [];
    this.lastTs = ts;
    this.lastOutput = emptyCue(ts, 0);
    return this.getLastOutput();
  }

  update(input: FacialCueInput): FacialCueObservation {
    const deltaMs = this.lastTs > 0 ? input.ts - this.lastTs : 0;
    const fps = deltaMs > 0 ? 1000 / deltaMs : this.lastOutput.fps;
    this.lastTs = input.ts;

    if (input.facesDetected < 1) {
      this.lastOutput = emptyCue(input.ts, fps);
      this.mouthStates = [];
      return this.getLastOutput();
    }

    const leftMouth = getPoint(input.landmarks, MOUTH_LEFT);
    const rightMouth = getPoint(input.landmarks, MOUTH_RIGHT);
    const topLip = getPoint(input.landmarks, MOUTH_TOP_INNER);
    const bottomLip = getPoint(input.landmarks, MOUTH_BOTTOM_INNER);
    const leftEye = getPoint(input.landmarks, LEFT_EYE_OUTER);
    const rightEye = getPoint(input.landmarks, RIGHT_EYE_OUTER);

    if (!leftMouth || !rightMouth || !topLip || !bottomLip || !leftEye || !rightEye) {
      this.lastOutput = emptyCue(input.ts, fps);
      return this.getLastOutput();
    }

    const mouthWidth = Math.max(distance(leftMouth, rightMouth), 1e-6);
    const mouthGap = distance(topLip, bottomLip);
    const mouthRatioRaw = mouthGap / mouthWidth;
    this.mouthOpenEma =
      this.lastOutput.ts === 0
        ? mouthRatioRaw
        : this.config.mouthEmaAlpha * mouthRatioRaw + (1 - this.config.mouthEmaAlpha) * this.mouthOpenEma;
    const mouthOpen = this.mouthOpenEma >= this.config.mouthOpenThreshold;

    this.mouthStates.push(mouthOpen);
    if (this.mouthStates.length > this.config.stabilityWindow) {
      this.mouthStates.shift();
    }
    const matching = this.mouthStates.filter((state) => state === mouthOpen).length;
    const stableRatio = this.mouthStates.length > 0 ? matching / this.mouthStates.length : 0;
    const mouthConfidence = classifyMouthConfidence(stableRatio, input.landmarks.length);

    const yawDegrees = clamp((input.yaw ?? 0) * 35, -35, 35);
    const rollDegrees = angleDegrees(leftEye, rightEye);
    const pitchDegrees = computeHeadPitchDegrees(input.landmarks);

    this.lastOutput = {
      ts: input.ts,
      face_present: true,
      mouth_open: mouthOpen,
      mouth_open_ratio: clamp(this.mouthOpenEma, 0, 1),
      mouth_open_confidence: mouthConfidence,
      smile_score: computeSmileScore(input.landmarks),
      brow_furrow_score: computeBrowFurrowScore(input.landmarks),
      eye_openness_left: computeEyeOpenness(
        input.landmarks,
        LEFT_EYE_UPPER,
        LEFT_EYE_LOWER,
        LEFT_EYE_OUTER,
        LEFT_EYE_INNER,
      ),
      eye_openness_right: computeEyeOpenness(
        input.landmarks,
        RIGHT_EYE_UPPER,
        RIGHT_EYE_LOWER,
        RIGHT_EYE_OUTER,
        RIGHT_EYE_INNER,
      ),
      head_pose: {
        yaw: yawDegrees,
        pitch: pitchDegrees,
        roll: clamp(rollDegrees, -40, 40),
      },
      gaze_direction: computeGazeDirection(input.landmarks, input.yaw ?? 0),
      face_bbox: input.boundingBox,
      fps: Number.isFinite(fps) ? fps : 0,
    };
    return this.getLastOutput();
  }
}
