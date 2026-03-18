import {
  createCameraEventBus,
  type CameraDiagnostics,
  type CameraEvent,
  type CheckStatus,
  type CheckType,
} from "./events.ts";
import { HeadTurnStateMachine } from "./head-turn-state-machine.ts";
import {
  FacialCueEstimator,
  FACIAL_CUES_SIGNALS,
  type FacialCueObservation,
} from "./facial-cues.ts";
import {
  MediaPipeFaceDetector,
  TASK_MODEL_URL,
  WASM_BASE_URL,
} from "./mediapipe-face.ts";
import {
  MediaPipeObjectDetector,
} from "./mediapipe-object";
import { MultiFrameConfirmation } from "./multi-frame-confirmation.ts";
import {
  ClothingChangeDetector,
  type ClothingChangeState,
} from "./clothing-change";
import {
  CLOTHING_CHANGE_SIGNALS,
  MOTION_SIGNALS,
  buildSceneChangeSummary,
  buildSceneObjectsSummary,
  buildSceneSummary,
  type CustomObservationObject,
  imageDataToGrayscale,
  MotionDetector,
  type ObservationObject,
  StableObjectTracker,
  type VisionObservation,
} from "./observation.ts";
import {
  getVisionSignalsStatus as buildVisionSignalsStatus,
  type VisionSignalsStatus,
} from "./vision-capabilities";
import {
  drawLetterboxedFrame,
  mapBboxFromLetterboxToSource,
} from "./object-preprocess";
import {
  buildCustomMatchCandidates,
  extractEmbeddingFromCanvasRegion,
  fetchCustomItemsRegistry,
  matchCustomItems,
  type CustomItemWithRefs,
} from "./custom-items";

type RunnerState = {
  cameraRunning: boolean;
  checkType: CheckType | null;
  checkStatus: CheckStatus;
  lastReason: string;
  diagnostics: CameraDiagnostics;
};

export type CameraFrameSnapshot = {
  capturedAt: number;
  cameraReady: boolean;
  modelLoaded: boolean;
  videoWidth: number;
  videoHeight: number;
  facesDetected: number;
  brightness: number;
  yaw: number | null;
  lastInferenceMs: number;
  lastError: string | null;
};

function nowTs() {
  return Date.now();
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readObjectStabilityConfig() {
  const windowSize = parseIntEnv(
    process.env.NEXT_PUBLIC_OBJECT_STABLE_WINDOW ?? process.env.OBJECT_STABLE_WINDOW,
    8,
  );
  const minFrames = parseIntEnv(
    process.env.NEXT_PUBLIC_OBJECT_STABLE_MIN_FRAMES ?? process.env.OBJECT_STABLE_MIN_FRAMES,
    3,
  );
  return {
    windowSize: Math.max(3, Math.min(20, windowSize)),
    minFrames: Math.max(1, Math.min(10, minFrames)),
  };
}

function readFaceCueConfig() {
  const faceFps = parseIntEnv(
    process.env.NEXT_PUBLIC_FACE_CUES_FPS ?? process.env.FACE_CUES_FPS,
    5,
  );
  const mouthOpenThreshold = parseFloatEnv(
    process.env.NEXT_PUBLIC_MOUTH_OPEN_THRESHOLD ?? process.env.MOUTH_OPEN_THRESHOLD,
    0.18,
  );
  return {
    faceFps: Math.max(1, Math.min(15, faceFps)),
    mouthOpenThreshold: Math.max(0.08, Math.min(0.5, mouthOpenThreshold)),
  };
}

function readCustomItemConfig() {
  const fps = parseIntEnv(
    process.env.NEXT_PUBLIC_CUSTOM_ITEM_FPS ?? process.env.CUSTOM_ITEM_FPS,
    1,
  );
  const threshold = parseFloatEnv(
    process.env.NEXT_PUBLIC_CUSTOM_ITEM_SIMILARITY_THRESHOLD ??
      process.env.CUSTOM_ITEM_SIMILARITY_THRESHOLD,
    0.35,
  );
  return {
    fps: Math.max(1, Math.min(5, fps)),
    similarityThreshold: Math.max(0.1, Math.min(0.95, threshold)),
  };
}

function getBrightness(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

function getBlurScore(gray: Uint8ClampedArray, width: number, height: number): number {
  if (width < 2 || height < 2 || gray.length < width * height) {
    return 0;
  }
  let diffSum = 0;
  let samples = 0;
  const stride = 2;
  for (let y = 0; y < height - 1; y += stride) {
    for (let x = 0; x < width - 1; x += stride) {
      const idx = y * width + x;
      const right = idx + 1;
      const down = idx + width;
      diffSum += Math.abs(gray[idx] - gray[right]) + Math.abs(gray[idx] - gray[down]);
      samples += 2;
    }
  }
  if (samples === 0) {
    return 0;
  }
  const meanDiff = diffSum / samples;
  return clamp01(meanDiff / 28);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export class CheckRunner {
  private readonly video: HTMLVideoElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly analysisCanvas: HTMLCanvasElement;
  private readonly observationCanvas: HTMLCanvasElement;
  private readonly objectInputCanvas: HTMLCanvasElement;
  private readonly analysisCtx: CanvasRenderingContext2D;
  private readonly observationCtx: CanvasRenderingContext2D;
  private readonly objectInputCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly bus = createCameraEventBus();
  private readonly brightnessMin = 40;
  private readonly brightnessMax = 210;
  private readonly analysisIntervalMs = 150;

  private stream: MediaStream | null = null;
  private loopTimer: number | null = null;
  private analysisLoopActive = false;
  private debugOverlayEnabled = false;
  private objectOverlayEnabled = false;
  private readonly objectStability = readObjectStabilityConfig();
  private readonly faceCueConfig = readFaceCueConfig();
  private readonly customItemConfig = readCustomItemConfig();
  private detector = new MediaPipeFaceDetector();
  private objectDetector = new MediaPipeObjectDetector();
  private faceCueEstimator = new FacialCueEstimator({
    mouthOpenThreshold: this.faceCueConfig.mouthOpenThreshold,
  });
  private motionDetector = new MotionDetector();
  private clothingChangeDetector = new ClothingChangeDetector();
  private stableObjectTracker = new StableObjectTracker(
    this.objectStability.windowSize,
    this.objectStability.minFrames,
  );
  private observationFps = 2;
  private faceCueFps = this.faceCueConfig.faceFps;
  private objectFps = Math.max(
    1,
    Math.min(5, parseIntEnv(process.env.NEXT_PUBLIC_OBJECT_FPS ?? process.env.OBJECT_FPS, 2)),
  );
  private customItemFps = this.customItemConfig.fps;
  private lastObservationAt = 0;
  private lastObjectInferenceAt = 0;
  private lastFaceCueAt = 0;
  private lastCustomMatchAt = 0;
  private lastCustomRegistryRefreshAt = 0;
  private latestObservation: VisionObservation | null = null;
  private latestFaceCues: FacialCueObservation = this.faceCueEstimator.reset(nowTs());
  private latestRawObjects: ObservationObject[] = [];
  private latestCustomObjects: CustomObservationObject[] = [];
  private customItemRegistry: CustomItemWithRefs[] = [];
  private customItemRegistryRefreshPromise: Promise<void> | null = null;
  private latestObjectStable = [] as VisionObservation["objects_stable"];
  private latestObjectChangeSummary: string | null = null;
  private latestObjectDebug: VisionObservation["object_debug"] = {
    model_name: this.objectDetector.getConfig().modelName,
    input_resolution: this.objectDetector.getConfig().inputResolution,
    raw_count: 0,
    post_threshold_count: 0,
    post_nms_count: 0,
  };
  private latestObjectStatus: VisionObservation["inference_status"] = "unavailable";
  private latestObjectInferenceMs = 0;
  private latestCustomMatchSimilarity = 0;
  private latestCustomCandidateCount = 0;
  private latestCustomReferenceCount = 0;
  private latestClothingChange: ClothingChangeState = this.clothingChangeDetector.reset();
  private blinkTimestamps: number[] = [];
  private lastBlinkDetectedAt = 0;
  private eyesPreviouslyOpen = false;
  private lastYawExtreme: "left" | "right" | null = null;
  private lastYawExtremeAt = 0;
  private lastPitchExtreme: "up" | "down" | null = null;
  private lastPitchExtremeAt = 0;
  private nodDetectedUntilTs = 0;
  private shakeDetectedUntilTs = 0;
  private lastFaceCenter: { x: number; y: number } | null = null;
  private lastFaceArea = 0;
  private frameJitterEma = 0;
  private readonly customScratchCanvas: HTMLCanvasElement;
  private readonly customScratchCtx: CanvasRenderingContext2D;
  private state: RunnerState = {
    cameraRunning: false,
    checkType: null,
    checkStatus: "idle",
    lastReason: "idle",
    diagnostics: {
      modelLoaded: false,
      lastInferenceMs: 0,
      facesDetected: 0,
      videoWidth: 0,
      videoHeight: 0,
      taskModelUrl: TASK_MODEL_URL,
      wasmBaseUrl: WASM_BASE_URL,
      selfTestStatus: "not_run",
      lastError: null,
    },
  };
  private presenceConfirm = new MultiFrameConfirmation(8, 5);
  private holdStillConfirm = new MultiFrameConfirmation(10, 7);
  private holdStillBaselineYaw: number | null = null;
  private headTurnMachine = new HeadTurnStateMachine();

  constructor(video: HTMLVideoElement, overlayCanvas: HTMLCanvasElement) {
    this.video = video;
    this.overlayCanvas = overlayCanvas;
    this.analysisCanvas = document.createElement("canvas");
    this.observationCanvas = document.createElement("canvas");
    this.objectInputCanvas = document.createElement("canvas");
    this.customScratchCanvas = document.createElement("canvas");

    const analysisCtx = this.analysisCanvas.getContext("2d");
    const observationCtx = this.observationCanvas.getContext("2d");
    const objectInputCtx = this.objectInputCanvas.getContext("2d");
    const customScratchCtx = this.customScratchCanvas.getContext("2d");
    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!analysisCtx || !observationCtx || !objectInputCtx || !customScratchCtx || !overlayCtx) {
      throw new Error("Unable to create camera analysis context.");
    }
    this.analysisCtx = analysisCtx;
    this.observationCtx = observationCtx;
    this.objectInputCtx = objectInputCtx;
    this.customScratchCtx = customScratchCtx;
    this.overlayCtx = overlayCtx;
  }

  events() {
    return this.bus;
  }

  setDebugOverlayEnabled(enabled: boolean) {
    this.debugOverlayEnabled = enabled;
    if (!enabled) {
      this.clearOverlay();
    }
  }

  setObjectOverlayEnabled(enabled: boolean) {
    this.objectOverlayEnabled = enabled;
    if (!enabled && !this.debugOverlayEnabled) {
      this.clearOverlay();
    }
  }

  setObservationFps(nextFps: number) {
    const safe = Number.isFinite(nextFps) ? Math.floor(nextFps) : 2;
    this.observationFps = Math.max(1, Math.min(10, safe));
  }

  setObjectFps(nextFps: number) {
    const safe = Number.isFinite(nextFps) ? Math.floor(nextFps) : 2;
    this.objectFps = Math.max(1, Math.min(5, safe));
  }

  setCustomItemFps(nextFps: number) {
    const safe = Number.isFinite(nextFps) ? Math.floor(nextFps) : this.customItemConfig.fps;
    this.customItemFps = Math.max(1, Math.min(5, safe));
  }

  setFaceCueFps(nextFps: number) {
    const safe = Number.isFinite(nextFps) ? Math.floor(nextFps) : this.faceCueConfig.faceFps;
    this.faceCueFps = Math.max(1, Math.min(15, safe));
  }

  getLatestObservation(): VisionObservation | null {
    if (!this.latestObservation) {
      return null;
    }
    return {
      ...this.latestObservation,
      head_pose: { ...this.latestObservation.head_pose },
      objects: [...this.latestObservation.objects],
      custom_objects: [...this.latestObservation.custom_objects],
      objects_stable: [...this.latestObservation.objects_stable],
      object_debug: { ...this.latestObservation.object_debug },
      custom_match_debug: { ...this.latestObservation.custom_match_debug },
    };
  }

  async runVisionSelfTest(): Promise<void> {
    let modelStatus = 0;
    let modelBytes = 0;

    try {
      const response = await fetch(TASK_MODEL_URL, { cache: "no-store" });
      modelStatus = response.status;
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        modelBytes = buffer.byteLength;
      }
      this.emit({
        type: "camera.error",
        timestamp: nowTs(),
        message: `SelfTest model fetch status=${modelStatus} bytes=${modelBytes}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.toString() : String(error);
      this.updateDiagnostics({ selfTestStatus: "fail", lastError: message });
      this.emit({ type: "camera.error", timestamp: nowTs(), message: `SelfTest fetch failed: ${message}` });
      return;
    }

    await this.ensureDetectorReady();
    if (this.detector.isLoaded()) {
      this.updateDiagnostics({ selfTestStatus: "pass", modelLoaded: true, lastError: null });
      this.emit({ type: "camera.error", timestamp: nowTs(), message: "SelfTest detector init succeeded." });
    } else {
      const message = this.detector.getLastError() ?? "Unknown detector initialization error.";
      this.updateDiagnostics({ selfTestStatus: "fail", modelLoaded: false, lastError: message });
      this.emit({ type: "camera.error", timestamp: nowTs(), message: `SelfTest detector init failed: ${message}` });
    }
  }

  async startCamera() {
    if (this.state.cameraRunning) {
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.state.cameraRunning = true;
      this.emit({ type: "camera.started", timestamp: nowTs() });
      this.updateDiagnostics({ lastError: null });
      this.startAnalysisLoop();
      await this.ensureDetectorReady();
      await this.ensureObjectDetectorReady();
      await this.refreshCustomItemRegistry(true);
    } catch (error) {
      const message = error instanceof Error ? error.toString() : "Unable to start camera.";
      this.updateDiagnostics({ lastError: message });
      this.emit({ type: "camera.error", timestamp: nowTs(), message });
    }
  }

  stopCamera() {
    this.stop();
    this.stopAnalysisLoop();
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    this.video.srcObject = null;
    this.state.cameraRunning = false;
    this.latestObservation = null;
    this.lastObservationAt = 0;
    this.lastObjectInferenceAt = 0;
    this.lastFaceCueAt = 0;
    this.lastCustomMatchAt = 0;
    this.lastCustomRegistryRefreshAt = 0;
    this.latestRawObjects = [];
    this.latestCustomObjects = [];
    this.customItemRegistry = [];
    this.customItemRegistryRefreshPromise = null;
    this.latestObjectStable = [];
    this.latestObjectChangeSummary = null;
    this.latestObjectStatus = "unavailable";
    this.latestObjectInferenceMs = 0;
    this.latestCustomMatchSimilarity = 0;
    this.latestCustomCandidateCount = 0;
    this.latestCustomReferenceCount = 0;
    this.latestObjectDebug = {
      model_name: this.objectDetector.getConfig().modelName,
      input_resolution: this.objectDetector.getConfig().inputResolution,
      raw_count: 0,
      post_threshold_count: 0,
      post_nms_count: 0,
    };
    this.stableObjectTracker = new StableObjectTracker(
      this.objectStability.windowSize,
      this.objectStability.minFrames,
    );
    this.latestFaceCues = this.faceCueEstimator.reset(nowTs());
    this.motionDetector = new MotionDetector();
    this.latestClothingChange = this.clothingChangeDetector.reset();
    this.resetDerivedFaceSignals();
    this.clearOverlay();
    this.emit({ type: "camera.stopped", timestamp: nowTs() });
  }

  start(checkType: CheckType) {
    if (!this.state.cameraRunning) {
      const message = "Start camera before running checks.";
      this.updateDiagnostics({ lastError: message });
      this.emit({
        type: "camera.error",
        timestamp: nowTs(),
        message,
      });
      return;
    }

    if (!this.detector.isLoaded()) {
      const message = "Vision model is not loaded yet. Run Self Test or Start Camera.";
      this.updateDiagnostics({ lastError: message });
      this.emit({
        type: "camera.error",
        timestamp: nowTs(),
        message,
      });
      return;
    }

    this.stop();
    this.state.checkType = checkType;
    this.state.checkStatus = "running";
    this.state.lastReason = "running";
    this.presenceConfirm = new MultiFrameConfirmation(8, 5);
    this.holdStillConfirm = new MultiFrameConfirmation(10, 7);
    this.holdStillBaselineYaw = null;
    this.headTurnMachine = new HeadTurnStateMachine();
    this.stableObjectTracker = new StableObjectTracker(
      this.objectStability.windowSize,
      this.objectStability.minFrames,
    );
    this.latestFaceCues = this.faceCueEstimator.reset(nowTs());
    this.lastFaceCueAt = 0;
    this.lastCustomMatchAt = 0;
    this.latestObjectChangeSummary = null;
    this.latestCustomObjects = [];
    this.latestCustomMatchSimilarity = 0;
    this.latestCustomCandidateCount = 0;
    this.latestCustomReferenceCount = 0;
    this.latestClothingChange = this.clothingChangeDetector.reset();
    this.resetDerivedFaceSignals();
    this.emit({ type: "check.started", timestamp: nowTs(), checkType });
    this.startAnalysisLoop();
  }

  stop() {
    if (this.state.checkType) {
      this.emit({
        type: "check.stopped",
        timestamp: nowTs(),
        checkType: this.state.checkType,
      });
    }
    this.state.checkType = null;
    this.state.checkStatus = "idle";
    this.state.lastReason = "idle";
    this.clearOverlay();
  }

  private resetDerivedFaceSignals() {
    this.blinkTimestamps = [];
    this.lastBlinkDetectedAt = 0;
    this.eyesPreviouslyOpen = false;
    this.lastYawExtreme = null;
    this.lastYawExtremeAt = 0;
    this.lastPitchExtreme = null;
    this.lastPitchExtremeAt = 0;
    this.nodDetectedUntilTs = 0;
    this.shakeDetectedUntilTs = 0;
    this.lastFaceCenter = null;
    this.lastFaceArea = 0;
    this.frameJitterEma = 0;
  }

  private updateDerivedFaceSignals(
    now: number,
    facePresent: boolean,
    faceBox: { x: number; y: number; width: number; height: number } | null,
  ): {
    blinkDetectedRecent: boolean;
    blinkRatePerMin: number;
    headNodDetectedRecent: boolean;
    headShakeDetectedRecent: boolean;
    framingStabilityScore: number;
  } {
    const leftEye = this.latestFaceCues.eye_openness_left;
    const rightEye = this.latestFaceCues.eye_openness_right;
    const eyesOpenNow = leftEye >= 0.3 && rightEye >= 0.3;
    const eyesClosedNow = leftEye <= 0.2 && rightEye <= 0.2;

    if (facePresent && this.eyesPreviouslyOpen && eyesClosedNow) {
      this.lastBlinkDetectedAt = now;
      this.blinkTimestamps.push(now);
    }
    this.eyesPreviouslyOpen = facePresent && eyesOpenNow;
    this.blinkTimestamps = this.blinkTimestamps.filter((ts) => now - ts <= 60_000);

    const yaw = this.latestFaceCues.head_pose.yaw;
    const pitch = this.latestFaceCues.head_pose.pitch;
    const yawThreshold = 12;
    const pitchThreshold = 8;
    if (facePresent) {
      if (yaw <= -yawThreshold) {
        if (this.lastYawExtreme === "right" && now - this.lastYawExtremeAt <= 2_500) {
          this.shakeDetectedUntilTs = now + 2_500;
        }
        this.lastYawExtreme = "left";
        this.lastYawExtremeAt = now;
      } else if (yaw >= yawThreshold) {
        if (this.lastYawExtreme === "left" && now - this.lastYawExtremeAt <= 2_500) {
          this.shakeDetectedUntilTs = now + 2_500;
        }
        this.lastYawExtreme = "right";
        this.lastYawExtremeAt = now;
      }

      if (pitch <= -pitchThreshold) {
        if (this.lastPitchExtreme === "down" && now - this.lastPitchExtremeAt <= 2_500) {
          this.nodDetectedUntilTs = now + 2_500;
        }
        this.lastPitchExtreme = "up";
        this.lastPitchExtremeAt = now;
      } else if (pitch >= pitchThreshold) {
        if (this.lastPitchExtreme === "up" && now - this.lastPitchExtremeAt <= 2_500) {
          this.nodDetectedUntilTs = now + 2_500;
        }
        this.lastPitchExtreme = "down";
        this.lastPitchExtremeAt = now;
      }
    }

    let framingStabilityScore = 0;
    if (faceBox) {
      const center = {
        x: faceBox.x + faceBox.width / 2,
        y: faceBox.y + faceBox.height / 2,
      };
      const area = Math.max(0, faceBox.width * faceBox.height);
      if (this.lastFaceCenter) {
        const dx = Math.abs(center.x - this.lastFaceCenter.x);
        const dy = Math.abs(center.y - this.lastFaceCenter.y);
        const dArea = Math.abs(area - this.lastFaceArea);
        const jitter = dx + dy + dArea * 2;
        this.frameJitterEma = this.frameJitterEma === 0 ? jitter : this.frameJitterEma * 0.72 + jitter * 0.28;
      } else {
        this.frameJitterEma = 0.02;
      }
      framingStabilityScore = clamp01(1 - this.frameJitterEma / 0.18);
      this.lastFaceCenter = center;
      this.lastFaceArea = area;
    } else {
      this.lastFaceCenter = null;
      this.lastFaceArea = 0;
      this.frameJitterEma = this.frameJitterEma * 0.8;
      framingStabilityScore = 0;
    }

    return {
      blinkDetectedRecent: now - this.lastBlinkDetectedAt <= 2_500,
      blinkRatePerMin: this.blinkTimestamps.length,
      headNodDetectedRecent: now <= this.nodDetectedUntilTs,
      headShakeDetectedRecent: now <= this.shakeDetectedUntilTs,
      framingStabilityScore,
    };
  }

  currentState() {
    return { ...this.state, diagnostics: { ...this.state.diagnostics } };
  }

  getVisionSignalsStatus(): VisionSignalsStatus {
    return buildVisionSignalsStatus([
      this.detector.getDetectorStatus(),
      this.objectDetector.getDetectorStatus(),
      {
        detector_id: "facial_cues",
        enabled: true,
        healthy: this.detector.isLoaded() && this.state.cameraRunning,
        last_run_ts: this.lastFaceCueAt > 0 ? this.lastFaceCueAt : null,
        supported_signals: [
          ...FACIAL_CUES_SIGNALS,
          "faces_detected",
          "face_bbox",
          "face_box_area_ratio",
          "brightness",
          "camera_blur_score",
          "blink_detected_recent",
          "blink_rate_per_min",
          "head_nod_detected_recent",
          "head_shake_detected_recent",
          "framing_stability_score",
          "face_occlusion_score",
        ],
      },
      {
        detector_id: "motion",
        enabled: true,
        healthy: this.state.cameraRunning,
        last_run_ts: this.lastObservationAt > 0 ? this.lastObservationAt : null,
        supported_signals: [...MOTION_SIGNALS],
      },
      {
        detector_id: "clothing_change",
        enabled: true,
        healthy: this.state.cameraRunning && this.latestClothingChange.baseline_ready,
        last_run_ts: this.lastObservationAt > 0 ? this.lastObservationAt : null,
        supported_signals: [...CLOTHING_CHANGE_SIGNALS],
      },
      {
        detector_id: "custom_items",
        enabled: true,
        healthy: this.state.cameraRunning && this.customItemRegistry.length > 0,
        last_run_ts: this.lastCustomMatchAt > 0 ? this.lastCustomMatchAt : null,
        supported_signals: ["custom_objects", "objects_stable", "scene_objects_summary", "scene_objects_change"],
      },
    ]);
  }

  captureFrameSnapshot(): CameraFrameSnapshot {
    const cameraReady =
      this.state.cameraRunning &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0;

    if (!cameraReady) {
      return {
        capturedAt: nowTs(),
        cameraReady: false,
        modelLoaded: this.detector.isLoaded(),
        videoWidth: this.video.videoWidth || 0,
        videoHeight: this.video.videoHeight || 0,
        facesDetected: 0,
        brightness: 0,
        yaw: null,
        lastInferenceMs: this.state.diagnostics.lastInferenceMs,
        lastError: "camera not ready",
      };
    }

    this.analysisCanvas.width = this.video.videoWidth;
    this.analysisCanvas.height = this.video.videoHeight;
    this.analysisCtx.drawImage(this.video, 0, 0, this.analysisCanvas.width, this.analysisCanvas.height);
    const brightness = getBrightness(this.analysisCtx, this.analysisCanvas.width, this.analysisCanvas.height);

    if (!this.detector.isLoaded()) {
      return {
        capturedAt: nowTs(),
        cameraReady: true,
        modelLoaded: false,
        videoWidth: this.video.videoWidth,
        videoHeight: this.video.videoHeight,
        facesDetected: this.state.diagnostics.facesDetected,
        brightness,
        yaw: null,
        lastInferenceMs: this.state.diagnostics.lastInferenceMs,
        lastError: "vision model not loaded",
      };
    }

    const t0 = performance.now();
    const detection = this.detector.detect(this.video, performance.now());
    const inferenceMs = performance.now() - t0;

    return {
      capturedAt: nowTs(),
      cameraReady: true,
      modelLoaded: this.detector.isLoaded(),
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      facesDetected: detection.facesDetected,
      brightness,
      yaw: detection.yaw,
      lastInferenceMs: inferenceMs,
      lastError: detection.lastError,
    };
  }

  private emit(event: CameraEvent) {
    this.bus.emit(event);
  }

  private updateDiagnostics(patch: Partial<CameraDiagnostics>) {
    this.state.diagnostics = { ...this.state.diagnostics, ...patch };
    this.emit({
      type: "diagnostics.update",
      timestamp: nowTs(),
      diagnostics: { ...this.state.diagnostics },
    });
  }

  private async ensureDetectorReady() {
    if (this.detector.isLoaded()) {
      this.updateDiagnostics({ modelLoaded: true });
      return;
    }

    const loaded = await this.detector.init();
    if (loaded) {
      this.updateDiagnostics({ modelLoaded: true, lastError: null });
    } else {
      const message = this.detector.getLastError() ?? "Detector init failed.";
      this.updateDiagnostics({ modelLoaded: false, lastError: message });
      this.emit({ type: "vision.error", timestamp: nowTs(), message });
    }
  }

  private async ensureObjectDetectorReady() {
    if (this.objectDetector.isLoaded()) {
      return;
    }
    const loaded = await this.objectDetector.init();
    if (!loaded) {
      const message = this.objectDetector.getLastError() ?? "Object detector init failed.";
      this.emit({ type: "vision.error", timestamp: nowTs(), message });
    }
  }

  private updateFacialCues(detection: {
    facesDetected: number;
    yaw: number | null;
    landmarks: Array<{ x: number; y: number }>;
    boundingBox: { x: number; y: number; width: number; height: number } | null;
  }) {
    const ts = nowTs();
    const intervalMs = 1000 / Math.max(1, this.faceCueFps);
    const shouldUpdate =
      detection.facesDetected < 1 ||
      this.lastFaceCueAt === 0 ||
      ts - this.lastFaceCueAt >= intervalMs;
    if (!shouldUpdate) {
      return;
    }
    this.lastFaceCueAt = ts;
    this.latestFaceCues = this.faceCueEstimator.update({
      ts,
      facesDetected: detection.facesDetected,
      landmarks: detection.landmarks,
      boundingBox: detection.boundingBox,
      yaw: detection.yaw,
    });
  }

  private async updateObjectDetections() {
    const now = performance.now();
    const intervalMs = 1000 / Math.max(1, this.objectFps);
    if (now - this.lastObjectInferenceAt < intervalMs) {
      return;
    }
    this.lastObjectInferenceAt = now;

    await this.ensureObjectDetectorReady();
    if (!this.objectDetector.isLoaded()) {
      this.latestObjectStatus = "limited";
      this.latestRawObjects = [];
      return;
    }

    const config = this.objectDetector.getConfig();
    this.objectInputCanvas.width = config.inputResolution;
    this.objectInputCanvas.height = config.inputResolution;
    const letterbox = drawLetterboxedFrame(
      this.video,
      this.objectInputCtx,
      this.video.videoWidth,
      this.video.videoHeight,
      config.inputResolution,
      config.inputResolution,
    );

    const started = performance.now();
    const result = this.objectDetector.detect(this.objectInputCanvas);
    this.latestObjectInferenceMs = performance.now() - started;
    if (result.lastError) {
      this.emit({ type: "vision.error", timestamp: nowTs(), message: result.lastError });
      this.latestObjectStatus = "limited";
    } else {
      this.latestObjectStatus = "ok";
    }

    const mapped = result.detections
      .map((item) => {
        const mappedBox = mapBboxFromLetterboxToSource(item.bbox, letterbox);
        const x = Math.max(0, Math.min(this.video.videoWidth, mappedBox.x));
        const y = Math.max(0, Math.min(this.video.videoHeight, mappedBox.y));
        const maxWidth = Math.max(0, this.video.videoWidth - x);
        const maxHeight = Math.max(0, this.video.videoHeight - y);
        const clamped: ObservationObject = {
          label: item.label,
          confidence: item.confidence,
          bbox: {
            x,
            y,
            width: Math.max(0, Math.min(maxWidth, mappedBox.width)),
            height: Math.max(0, Math.min(maxHeight, mappedBox.height)),
          },
        };
        return clamped;
      })
      .filter((item) => item.bbox.width > 1 && item.bbox.height > 1)
      .slice(0, config.topK);

    this.latestRawObjects = mapped;
    this.latestObjectDebug = {
      model_name: result.stats.modelName,
      input_resolution: result.stats.inputResolution,
      raw_count: result.stats.rawCount,
      post_threshold_count: result.stats.postThresholdCount,
      post_nms_count: result.stats.postNmsCount,
    };
  }

  private async refreshCustomItemRegistry(force = false) {
    const now = nowTs();
    if (!force && now - this.lastCustomRegistryRefreshAt < 5000) {
      return;
    }
    if (this.customItemRegistryRefreshPromise) {
      await this.customItemRegistryRefreshPromise;
      return;
    }

    this.customItemRegistryRefreshPromise = (async () => {
      try {
        const items = await fetchCustomItemsRegistry();
        this.customItemRegistry = items;
        this.lastCustomRegistryRefreshAt = nowTs();
        this.latestCustomReferenceCount = items.reduce(
          (count, item) => count + item.references.length,
          0,
        );
      } catch (error) {
        const message = error instanceof Error ? error.toString() : String(error);
        this.emit({ type: "vision.error", timestamp: nowTs(), message: `custom items: ${message}` });
      } finally {
        this.customItemRegistryRefreshPromise = null;
      }
    })();
    await this.customItemRegistryRefreshPromise;
  }

  private async updateCustomDetections() {
    const nowMs = nowTs();
    const intervalMs = 1000 / Math.max(1, this.customItemFps);
    if (nowMs - this.lastCustomMatchAt < intervalMs) {
      return;
    }
    this.lastCustomMatchAt = nowMs;
    await this.refreshCustomItemRegistry(false);

    if (this.customItemRegistry.length === 0) {
      this.latestCustomObjects = [];
      this.latestCustomCandidateCount = 0;
      this.latestCustomMatchSimilarity = 0;
      return;
    }
    if (
      !Number.isFinite(this.analysisCanvas.width) ||
      !Number.isFinite(this.analysisCanvas.height) ||
      this.analysisCanvas.width < 8 ||
      this.analysisCanvas.height < 8
    ) {
      this.latestCustomObjects = [];
      this.latestCustomCandidateCount = 0;
      this.latestCustomMatchSimilarity = 0;
      return;
    }

    const candidatesBbox = buildCustomMatchCandidates(
      this.analysisCanvas.width,
      this.analysisCanvas.height,
      this.latestRawObjects,
      30,
    );
    const candidates = candidatesBbox
      .map((bbox) => {
        try {
          const embedding = extractEmbeddingFromCanvasRegion(this.analysisCtx, bbox, {
            embedSize: 16,
            scratchCanvas: this.customScratchCanvas,
            scratchCtx: this.customScratchCtx,
          });
          return {
            bbox,
            embedding,
          };
        } catch (error) {
          const message = error instanceof Error ? error.toString() : String(error);
          this.emit({ type: "vision.error", timestamp: nowTs(), message: `custom detect: ${message}` });
          return {
            bbox,
            embedding: new Float32Array(0),
          };
        }
      })
      .filter((candidate) => candidate.embedding.length > 0);
    this.latestCustomCandidateCount = candidates.length;
    if (candidates.length === 0) {
      this.latestCustomObjects = [];
      this.latestCustomMatchSimilarity = 0;
      return;
    }

    const matched = matchCustomItems(
      this.customItemRegistry,
      candidates,
      this.customItemConfig.similarityThreshold,
    );
    this.latestCustomMatchSimilarity = matched.bestSimilarity;
    this.latestCustomObjects = matched.detections.map((item) => ({
      label: item.label,
      confidence: item.confidence,
      bbox: { ...item.bbox },
      item_id: item.item_id,
      source: "custom",
      similarity: item.similarity,
    }));
  }

  private mergeVisibleObjects(): ObservationObject[] {
    const merged: ObservationObject[] = [];
    for (const object of this.latestRawObjects) {
      merged.push({ ...object });
    }
    for (const custom of this.latestCustomObjects) {
      merged.push({
        label: custom.label,
        confidence: custom.confidence,
        bbox: { ...custom.bbox },
      });
    }
    merged.sort((a, b) => b.confidence - a.confidence);
    return merged;
  }

  private startAnalysisLoop() {
    if (this.analysisLoopActive) {
      return;
    }
    this.analysisLoopActive = true;
    this.loop();
  }

  private stopAnalysisLoop() {
    this.analysisLoopActive = false;
    if (this.loopTimer !== null) {
      window.clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private loop() {
    if (!this.analysisLoopActive) {
      return;
    }
    this.loopTimer = window.setTimeout(() => {
      void this.analyze().finally(() => {
        if (this.analysisLoopActive) {
          this.loop();
        }
      });
    }, this.analysisIntervalMs);
  }

  private clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  private drawOverlay(
    landmarks: Array<{ x: number; y: number }>,
    boundingBox: { x: number; y: number; width: number; height: number } | null,
    objectBoxes: ObservationObject[],
    facialCues: FacialCueObservation,
  ) {
    this.clearOverlay();
    if (!this.debugOverlayEnabled && !this.objectOverlayEnabled) {
      return;
    }

    this.overlayCtx.lineWidth = 2;
    this.overlayCtx.strokeStyle = "#10b981";
    this.overlayCtx.fillStyle = "#f59e0b";

    if (this.debugOverlayEnabled && boundingBox) {
      this.overlayCtx.strokeRect(boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height);
      this.overlayCtx.fillStyle = "#10b981";
      this.overlayCtx.font = "12px sans-serif";
      const top = Math.max(14, boundingBox.y - 6);
      const lines = [
        `mouth ${facialCues.mouth_open ? "open" : "closed"} ratio=${facialCues.mouth_open_ratio.toFixed(3)}`,
        `smile=${facialCues.smile_score.toFixed(2)} brow=${facialCues.brow_furrow_score.toFixed(2)}`,
        `gaze=${facialCues.gaze_direction} yaw=${facialCues.head_pose.yaw.toFixed(1)} pitch=${facialCues.head_pose.pitch.toFixed(1)}`,
      ];
      for (let i = 0; i < lines.length; i += 1) {
        this.overlayCtx.fillText(lines[i], Math.max(0, boundingBox.x), top + i * 13);
      }
    }

    if (this.debugOverlayEnabled) {
      for (const point of landmarks) {
        const x = point.x * this.overlayCanvas.width;
        const y = point.y * this.overlayCanvas.height;
        this.overlayCtx.beginPath();
        this.overlayCtx.arc(x, y, 2, 0, Math.PI * 2);
        this.overlayCtx.fill();
      }
    }

    if (this.objectOverlayEnabled) {
      this.overlayCtx.strokeStyle = "#38bdf8";
      this.overlayCtx.fillStyle = "#38bdf8";
      this.overlayCtx.font = "12px sans-serif";
      for (const object of objectBoxes.slice(0, 20)) {
        this.overlayCtx.strokeRect(
          object.bbox.x,
          object.bbox.y,
          object.bbox.width,
          object.bbox.height,
        );
        this.overlayCtx.fillText(
          `${object.label} ${object.confidence.toFixed(2)}`,
          Math.max(0, object.bbox.x),
          Math.max(12, object.bbox.y - 2),
        );
      }
    }
  }

  private async analyze() {
    const videoReady =
      this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0;
    if (!this.state.cameraRunning || !videoReady) {
      this.updateDiagnostics({
        videoWidth: this.video.videoWidth || 0,
        videoHeight: this.video.videoHeight || 0,
      });
      this.maybeEmitUnavailableObservation();
      return;
    }

    this.analysisCanvas.width = this.video.videoWidth;
    this.analysisCanvas.height = this.video.videoHeight;
    this.overlayCanvas.width = this.video.videoWidth;
    this.overlayCanvas.height = this.video.videoHeight;
    this.analysisCtx.drawImage(this.video, 0, 0, this.analysisCanvas.width, this.analysisCanvas.height);

    if (!this.detector.isLoaded()) {
      this.updateDiagnostics({
        modelLoaded: false,
        lastInferenceMs: 0,
        facesDetected: 0,
        videoWidth: this.video.videoWidth,
        videoHeight: this.video.videoHeight,
      });
      this.maybeEmitUnavailableObservation();
      return;
    }

    const brightness = getBrightness(this.analysisCtx, this.analysisCanvas.width, this.analysisCanvas.height);
    const t0 = performance.now();
    const detection = this.detector.detect(this.video, performance.now());
    const inferenceMs = performance.now() - t0;
    if (detection.lastError) {
      this.emit({ type: "vision.error", timestamp: nowTs(), message: detection.lastError });
    }
    this.updateDiagnostics({
      modelLoaded: this.detector.isLoaded(),
      lastInferenceMs: inferenceMs,
      facesDetected: detection.facesDetected,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      lastError: detection.lastError,
    });
    await this.updateObjectDetections();
    await this.updateCustomDetections();
    this.updateFacialCues(detection);
    this.drawOverlay(
      detection.landmarks,
      detection.boundingBox,
      this.mergeVisibleObjects(),
      this.latestFaceCues,
    );
    this.maybeEmitObservation(detection, brightness, inferenceMs);

    const checkType = this.state.checkType;
    if (!checkType) {
      return;
    }

    if (checkType === "presence") {
      const faceDetected = detection.facesDetected > 0;
      const brightnessPass = brightness >= this.brightnessMin && brightness <= this.brightnessMax;
      const confirmed = this.presenceConfirm.push(faceDetected && brightnessPass);
      const reasons: string[] = [];

      if (!faceDetected) {
        reasons.push("No face detected.");
      }
      if (!brightnessPass) {
        reasons.push("Brightness out of range.");
      }

      this.emit({
        type: "check.update",
        timestamp: nowTs(),
        checkType,
        result: {
          type: "presence",
          passed: confirmed.passed,
          reasons,
          brightness,
          faceDetected,
          passCount: confirmed.passCount,
          windowSize: confirmed.windowSize,
          requiredPasses: confirmed.requiredPasses,
        },
      });

      this.state.lastReason = reasons.join(" ") || "presence_passed";
      if (confirmed.passed) {
        this.state.checkStatus = "passed";
        this.emit({ type: "check.completed", timestamp: nowTs(), checkType, status: "passed" });
      }
      return;
    }

    if (checkType === "hold_still") {
      const faceDetected = detection.facesDetected > 0;
      const brightnessPass = brightness >= this.brightnessMin && brightness <= this.brightnessMax;
      if (faceDetected && detection.yaw !== null && this.holdStillBaselineYaw === null) {
        this.holdStillBaselineYaw = detection.yaw;
      }

      const baselineYaw = this.holdStillBaselineYaw;
      const yawDelta =
        baselineYaw !== null && detection.yaw !== null
          ? Math.abs(detection.yaw - baselineYaw)
          : null;
      const stillPass = yawDelta !== null && yawDelta <= 0.12;
      const confirmed = this.holdStillConfirm.push(faceDetected && brightnessPass && stillPass);
      const reasons: string[] = [];

      if (!faceDetected) {
        reasons.push("No face detected.");
      }
      if (!brightnessPass) {
        reasons.push("Brightness out of range.");
      }
      if (yawDelta === null) {
        reasons.push("Yaw is unavailable.");
      } else if (!stillPass) {
        reasons.push("Head movement is above hold-still threshold.");
      }

      this.emit({
        type: "check.update",
        timestamp: nowTs(),
        checkType,
        result: {
          type: "hold_still",
          passed: confirmed.passed,
          reasons,
          faceDetected,
          brightness,
          yaw: detection.yaw,
          baselineYaw,
          yawDelta,
          passCount: confirmed.passCount,
          windowSize: confirmed.windowSize,
          requiredPasses: confirmed.requiredPasses,
        },
      });

      this.state.lastReason = reasons.join(" ") || "hold_still_passed";
      if (confirmed.passed) {
        this.state.checkStatus = "passed";
        this.emit({ type: "check.completed", timestamp: nowTs(), checkType, status: "passed" });
      }
      return;
    }

    const transition = this.headTurnMachine.transition(performance.now(), detection.yaw);
    const reasons: string[] = [];
    if (detection.facesDetected < 1) {
      reasons.push("No face detected.");
    } else if (detection.yaw === null) {
      reasons.push("Head yaw landmarks not available.");
    }

    this.emit({
      type: "check.update",
      timestamp: nowTs(),
      checkType,
      result: {
        type: "head_turn",
        passed: transition.passed,
        phase: transition.phase,
        reasons,
        yaw: detection.yaw,
        rawYaw: transition.rawYaw,
        baselineYaw: transition.baselineYaw,
        leftSeen: transition.leftSeen,
        rightSeen: transition.rightSeen,
        activeThreshold: transition.activeThreshold,
        elapsedMs: transition.elapsedMs,
      },
    });

    this.state.lastReason = reasons.join(" ") || transition.reason;
    if (transition.passed) {
      this.state.checkStatus = "passed";
      this.emit({ type: "check.completed", timestamp: nowTs(), checkType, status: "passed" });
      return;
    }

    if (transition.failed) {
      this.state.checkStatus = "failed";
      this.emit({ type: "check.completed", timestamp: nowTs(), checkType, status: "failed" });
    }
  }

  private maybeEmitUnavailableObservation() {
    const now = nowTs();
    const intervalMs = Math.floor(1000 / Math.max(1, this.observationFps));
    if (now - this.lastObservationAt < intervalMs) {
      return;
    }
    this.lastObservationAt = now;
    const observation: VisionObservation = {
      ts: now,
      camera_available: false,
      person_present: false,
      face_present: false,
      faces_detected: 0,
      face_bbox: null,
      face_box_area_ratio: 0,
      brightness: 0,
      camera_blur_score: 0,
      mouth_open: false,
      mouth_open_ratio: 0,
      mouth_open_confidence: 0,
      smile_score: 0,
      brow_furrow_score: 0,
      eye_openness_left: 0,
      eye_openness_right: 0,
      head_pose: { yaw: 0, pitch: 0, roll: 0 },
      gaze_direction: "unknown",
      blink_detected_recent: false,
      blink_rate_per_min: 0,
      head_nod_detected_recent: false,
      head_shake_detected_recent: false,
      framing_stability_score: 0,
      face_occlusion_score: 1,
      face_fps: 0,
      pose_label: "none",
      pose_confidence: 0,
      keypoints_confidence: 0,
      motion_score: 0,
      motion_state: "still",
      clothing_change_detected: false,
      clothing_change_region: "none",
      clothing_change_confidence: 0,
      clothing_change_summary: "camera unavailable",
      clothing_upper_change_score: 0,
      clothing_lower_change_score: 0,
      clothing_baseline_ready: false,
      objects: [],
      custom_objects: [],
      objects_stable: [],
      scene_objects_summary: "I see: none",
      scene_objects_change: null,
      scene_summary: "camera unavailable, no visual observations, I see: none",
      scene_change_summary: null,
      inference_status: "unavailable",
      inference_fps: 0,
      last_inference_ms: 0,
      object_debug: { ...this.latestObjectDebug },
      custom_match_debug: {
        last_similarity: 0,
        candidate_count: 0,
        reference_count: this.latestCustomReferenceCount,
      },
    };
    observation.scene_change_summary = buildSceneChangeSummary(this.latestObservation, observation);
    this.latestObservation = observation;
    this.latestObjectChangeSummary = null;
    this.emit({ type: "observation.update", timestamp: now, observation });
  }

  private maybeEmitObservation(
    detection: {
      facesDetected: number;
      yaw: number | null;
      boundingBox: { x: number; y: number; width: number; height: number } | null;
    },
    brightness: number,
    inferenceMs: number,
  ) {
    const now = nowTs();
    const intervalMs = Math.floor(1000 / Math.max(1, this.observationFps));
    if (now - this.lastObservationAt < intervalMs) {
      return;
    }

    const elapsed = this.lastObservationAt > 0 ? now - this.lastObservationAt : 0;
    this.lastObservationAt = now;
    const targetWidth = 640;
    const aspect =
      this.video.videoWidth > 0 ? this.video.videoHeight / this.video.videoWidth : 0;
    const targetHeight = Math.max(
      1,
      Math.round(Number.isFinite(aspect) && aspect > 0 ? aspect * targetWidth : 480),
    );
    this.observationCanvas.width = targetWidth;
    this.observationCanvas.height = targetHeight;
    this.observationCtx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
    const image = this.observationCtx.getImageData(0, 0, targetWidth, targetHeight);
    const gray = imageDataToGrayscale(image);
    const blurScore = getBlurScore(gray, targetWidth, targetHeight);
    const motion = this.motionDetector.update(gray);

    const personPresent = detection.facesDetected > 0;
    const facePresent = this.latestFaceCues.face_present;
    const mergedObjects = this.mergeVisibleObjects();
    this.latestClothingChange = this.clothingChangeDetector.update({
      imageData: image,
      personPresent,
      motionState: motion.motionState,
      objects: mergedObjects,
    });
    const stability = this.stableObjectTracker.update(mergedObjects);
    this.latestObjectStable = stability.stable;
    this.latestObjectChangeSummary = stability.changeSummary;
    const objects: ObservationObject[] = [...mergedObjects].slice(0, 5);
    const customObjects: CustomObservationObject[] = [...this.latestCustomObjects].slice(0, 5);
    const objectsStable = [...this.latestObjectStable].slice(0, 5);
    const sceneObjectsSummary = buildSceneObjectsSummary(objectsStable);
    const sceneObjectsChange = stability.changeSummary;

    const brightnessConfidence = brightness >= this.brightnessMin && brightness <= this.brightnessMax ? 0.1 : 0;
    const faceBoxNormalized =
      detection.boundingBox && this.video.videoWidth > 0 && this.video.videoHeight > 0
        ? {
            x: Math.max(0, Math.min(1, detection.boundingBox.x / this.video.videoWidth)),
            y: Math.max(0, Math.min(1, detection.boundingBox.y / this.video.videoHeight)),
            width: Math.max(0, Math.min(1, detection.boundingBox.width / this.video.videoWidth)),
            height: Math.max(0, Math.min(1, detection.boundingBox.height / this.video.videoHeight)),
          }
        : null;
    const faceBoxAreaRatio =
      faceBoxNormalized && faceBoxNormalized.width > 0 && faceBoxNormalized.height > 0
        ? Math.max(
            0,
            Math.min(1, faceBoxNormalized.width * faceBoxNormalized.height),
          )
        : 0;
    const keypointsConfidence = personPresent ? Math.min(1, 0.7 + brightnessConfidence) : 0.15;
    const derivedFaceSignals = this.updateDerivedFaceSignals(now, facePresent, faceBoxNormalized);
    const faceOcclusionScore = !personPresent
      ? 0
      : !facePresent
        ? 1
        : clamp01((1 - keypointsConfidence) * 0.6 + (faceBoxAreaRatio < 0.02 ? 0.35 : 0));
    const baseObservation: VisionObservation = {
      ts: now,
      camera_available: true,
      person_present: personPresent,
      face_present: facePresent,
      faces_detected: detection.facesDetected,
      face_bbox: faceBoxNormalized,
      face_box_area_ratio: faceBoxAreaRatio,
      brightness,
      camera_blur_score: blurScore,
      mouth_open: this.latestFaceCues.mouth_open,
      mouth_open_ratio: this.latestFaceCues.mouth_open_ratio,
      mouth_open_confidence: this.latestFaceCues.mouth_open_confidence,
      smile_score: this.latestFaceCues.smile_score,
      brow_furrow_score: this.latestFaceCues.brow_furrow_score,
      eye_openness_left: this.latestFaceCues.eye_openness_left,
      eye_openness_right: this.latestFaceCues.eye_openness_right,
      head_pose: { ...this.latestFaceCues.head_pose },
      gaze_direction: this.latestFaceCues.gaze_direction,
      blink_detected_recent: derivedFaceSignals.blinkDetectedRecent,
      blink_rate_per_min: derivedFaceSignals.blinkRatePerMin,
      head_nod_detected_recent: derivedFaceSignals.headNodDetectedRecent,
      head_shake_detected_recent: derivedFaceSignals.headShakeDetectedRecent,
      framing_stability_score: derivedFaceSignals.framingStabilityScore,
      face_occlusion_score: faceOcclusionScore,
      face_fps: this.latestFaceCues.fps,
      pose_label: personPresent ? "unknown" : "none",
      pose_confidence: personPresent ? 0.25 : 0,
      keypoints_confidence: keypointsConfidence,
      motion_score: motion.motionScore,
      motion_state: motion.motionState,
      clothing_change_detected: this.latestClothingChange.removed_detected,
      clothing_change_region: this.latestClothingChange.removed_region,
      clothing_change_confidence: this.latestClothingChange.removed_confidence,
      clothing_change_summary: this.latestClothingChange.summary,
      clothing_upper_change_score: this.latestClothingChange.upper_change_score,
      clothing_lower_change_score: this.latestClothingChange.lower_change_score,
      clothing_baseline_ready: this.latestClothingChange.baseline_ready,
      objects,
      custom_objects: customObjects,
      objects_stable: objectsStable,
      scene_objects_summary: sceneObjectsSummary,
      scene_objects_change: sceneObjectsChange,
      scene_summary: "",
      scene_change_summary: null,
      inference_status:
        this.detector.isLoaded() && this.latestObjectStatus === "ok"
          ? "ok"
          : this.detector.isLoaded()
            ? "limited"
            : "unavailable",
      inference_fps: elapsed > 0 ? 1000 / elapsed : 0,
      last_inference_ms: Math.max(inferenceMs, this.latestObjectInferenceMs),
      object_debug: { ...this.latestObjectDebug },
      custom_match_debug: {
        last_similarity: this.latestCustomMatchSimilarity,
        candidate_count: this.latestCustomCandidateCount,
        reference_count: this.latestCustomReferenceCount,
      },
    };
    const sceneSummary = buildSceneSummary(baseObservation);
    const observation: VisionObservation = {
      ...baseObservation,
      scene_summary: sceneSummary,
    };
    observation.scene_change_summary = buildSceneChangeSummary(this.latestObservation, observation);

    this.latestObservation = observation;
    this.latestObjectChangeSummary = null;
    this.emit({
      type: "observation.update",
      timestamp: now,
      observation,
    });
  }
}
