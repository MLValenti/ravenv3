"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CheckRunner } from "@/lib/camera/check-runner";
import {
  addCustomItemReferenceApi,
  computeImageEmbeddingFromImageData,
  createCustomItemApi,
  deleteCustomItemApi,
  deleteCustomItemReferenceApi,
  fetchCustomItemsRegistry,
  type CustomItemWithRefs,
} from "@/lib/camera/custom-items";
import type {
  CameraDiagnostics,
  CameraEvent,
  CheckType,
  HeadTurnResult,
  HoldStillResult,
  PresenceResult,
} from "@/lib/camera/events";
import type { VisionObservation } from "@/lib/camera/observation";
import { publishRuntimeEvent } from "@/lib/runtime-event-bus";

type DebugEvent = {
  timestamp: number;
  label: string;
  detail: string;
};

const EMPTY_DIAGNOSTICS: CameraDiagnostics = {
  modelLoaded: false,
  lastInferenceMs: 0,
  facesDetected: 0,
  videoWidth: 0,
  videoHeight: 0,
  taskModelUrl: "/models/face_landmarker.task",
  wasmBaseUrl: "/vendor/tasks-vision",
  selfTestStatus: "not_run",
  lastError: null,
};

function formatEvent(event: CameraEvent): DebugEvent {
  switch (event.type) {
    case "camera.started":
      return { timestamp: event.timestamp, label: event.type, detail: "camera running" };
    case "camera.stopped":
      return { timestamp: event.timestamp, label: event.type, detail: "camera stopped" };
    case "camera.error":
      return { timestamp: event.timestamp, label: event.type, detail: event.message };
    case "vision.error":
      return { timestamp: event.timestamp, label: event.type, detail: event.message };
    case "diagnostics.update":
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `faces=${event.diagnostics.facesDetected} infer=${event.diagnostics.lastInferenceMs.toFixed(1)}ms`,
      };
    case "check.started":
    case "check.stopped":
      return { timestamp: event.timestamp, label: event.type, detail: event.checkType };
    case "check.completed":
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `${event.checkType}:${event.status}`,
      };
    case "check.update":
      if (event.result.type === "presence") {
        return {
          timestamp: event.timestamp,
          label: event.type,
          detail: `presence pass=${event.result.passed} face=${event.result.faceDetected} brightness=${event.result.brightness.toFixed(1)}`,
        };
      }
      if (event.result.type === "hold_still") {
        return {
          timestamp: event.timestamp,
          label: event.type,
          detail: `hold_still pass=${event.result.passed} yaw=${event.result.yaw?.toFixed(2) ?? "n/a"} delta=${event.result.yawDelta?.toFixed(2) ?? "n/a"}`,
        };
      }
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `head_turn yaw=${event.result.rawYaw?.toFixed(2) ?? "n/a"} threshold=${event.result.activeThreshold}`,
      };
    case "observation.update":
      return {
        timestamp: event.timestamp,
        label: event.type,
        detail: `${event.observation.scene_summary} | clothing=${event.observation.clothing_change_region}:${event.observation.clothing_change_confidence.toFixed(2)}`,
      };
    default:
      return {
        timestamp: Date.now(),
        label: "camera.event",
        detail: "unhandled event",
      };
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Invalid file result."));
    };
    reader.readAsDataURL(file);
  });
}

function loadImageDataFromDataUrl(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("Unable to load image."));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const width = Math.max(1, image.naturalWidth || image.width);
      const height = Math.max(1, image.naturalHeight || image.height);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Unable to create image context."));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };
    image.src = dataUrl;
  });
}

export default function CameraPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<CheckRunner | null>(null);
  const [stateText, setStateText] = useState("idle");
  const [checkType, setCheckType] = useState<CheckType | null>(null);
  const [presenceResult, setPresenceResult] = useState<PresenceResult | null>(null);
  const [headTurnResult, setHeadTurnResult] = useState<HeadTurnResult | null>(null);
  const [holdStillResult, setHoldStillResult] = useState<HoldStillResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics>(EMPTY_DIAGNOSTICS);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [debugOverlay, setDebugOverlay] = useState(false);
  const [objectOverlay, setObjectOverlay] = useState(false);
  const [selfTesting, setSelfTesting] = useState(false);
  const [latestObservation, setLatestObservation] = useState<VisionObservation | null>(null);
  const [customItems, setCustomItems] = useState<CustomItemWithRefs[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const currentResult = useMemo(() => {
    if (checkType === "presence") {
      return presenceResult;
    }
    if (checkType === "head_turn") {
      return headTurnResult;
    }
    if (checkType === "hold_still") {
      return holdStillResult;
    }
    return null;
  }, [checkType, presenceResult, headTurnResult, holdStillResult]);

  const customSeenByLabel = useMemo(() => {
    const map = new Map<string, { confidence: number; timestamp: number }>();
    if (!latestObservation) {
      return map;
    }
    for (const detection of latestObservation.custom_objects) {
      const existing = map.get(detection.label);
      if (!existing || detection.confidence > existing.confidence) {
        map.set(detection.label, {
          confidence: detection.confidence,
          timestamp: latestObservation.ts,
        });
      }
    }
    return map;
  }, [latestObservation]);

  useEffect(() => {
    if (!videoRef.current || !overlayRef.current) {
      return;
    }

    const runner = new CheckRunner(videoRef.current, overlayRef.current);
    runner.setObservationFps(2);
    runner.setFaceCueFps(5);
    runner.setObjectFps(2);
    runner.setCustomItemFps(1);
    runnerRef.current = runner;
    const unsubscribe = runner.events().on((event: CameraEvent) => {
      publishRuntimeEvent({ type: "camera.event", timestamp: Date.now(), event });
      const entry = formatEvent(event);
      setEvents((current) => [entry, ...current].slice(0, 50));

      if (event.type === "check.started") {
        setCheckType(event.checkType);
        setStateText("running");
      }

      if (event.type === "check.update") {
        if (event.result.type === "presence") {
          setPresenceResult(event.result);
        } else if (event.result.type === "head_turn") {
          setHeadTurnResult(event.result);
        } else {
          setHoldStillResult(event.result);
        }
      }

      if (event.type === "diagnostics.update") {
        setDiagnostics(event.diagnostics);
      }

      if (event.type === "check.completed") {
        setStateText(event.status);
      }

      if (event.type === "check.stopped") {
        setStateText("idle");
      }

      if (event.type === "observation.update") {
        setLatestObservation(event.observation);
      }
    });

    return () => {
      unsubscribe();
      runner.stopCamera();
      runnerRef.current = null;
    };
  }, []);

  useEffect(() => {
    runnerRef.current?.setDebugOverlayEnabled(debugOverlay);
  }, [debugOverlay]);

  useEffect(() => {
    runnerRef.current?.setObjectOverlayEnabled(objectOverlay);
  }, [objectOverlay]);

  async function refreshCustomItems() {
    const items = await fetchCustomItemsRegistry().catch(() => []);
    setCustomItems(items);
  }

  useEffect(() => {
    void refreshCustomItems();
  }, []);

  async function createCustomItem() {
    const label = customLabel.trim();
    if (!label) {
      setCustomError("Custom label is required.");
      return;
    }
    setCustomBusy(true);
    setCustomError(null);
    try {
      const created = await createCustomItemApi(label);
      if (!created) {
        setCustomError("Unable to create custom item.");
        return;
      }
      setCustomLabel("");
      await refreshCustomItems();
    } finally {
      setCustomBusy(false);
    }
  }

  async function captureReferenceForItem(itemId: string) {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      setCustomError("Start camera before capturing a reference image.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCustomError("Unable to capture reference image.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const embedding = Array.from(computeImageEmbeddingFromImageData(imageData));
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.92);

    setCustomBusy(true);
    setCustomError(null);
    try {
      const ok = await addCustomItemReferenceApi({ itemId, imageDataUrl, embedding });
      if (!ok) {
        setCustomError("Unable to add custom item reference.");
        return;
      }
      await refreshCustomItems();
    } finally {
      setCustomBusy(false);
    }
  }

  async function uploadReferenceForItem(itemId: string, file: File) {
    setCustomBusy(true);
    setCustomError(null);
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const imageData = await loadImageDataFromDataUrl(imageDataUrl);
      const embedding = Array.from(computeImageEmbeddingFromImageData(imageData));
      const ok = await addCustomItemReferenceApi({ itemId, imageDataUrl, embedding });
      if (!ok) {
        setCustomError("Unable to add uploaded reference.");
        return;
      }
      await refreshCustomItems();
    } catch {
      setCustomError("Unable to process uploaded image.");
    } finally {
      setCustomBusy(false);
    }
  }

  async function removeCustomItem(itemId: string) {
    setCustomBusy(true);
    setCustomError(null);
    try {
      const ok = await deleteCustomItemApi(itemId);
      if (!ok) {
        setCustomError("Unable to delete custom item.");
        return;
      }
      await refreshCustomItems();
    } finally {
      setCustomBusy(false);
    }
  }

  async function removeCustomReference(itemId: string, refId: string) {
    setCustomBusy(true);
    setCustomError(null);
    try {
      const ok = await deleteCustomItemReferenceApi(itemId, refId);
      if (!ok) {
        setCustomError("Unable to delete custom item reference.");
        return;
      }
      await refreshCustomItems();
    } finally {
      setCustomBusy(false);
    }
  }

  function withRunner(action: (runner: CheckRunner) => void) {
    if (!runnerRef.current) {
      return;
    }
    action(runnerRef.current);
  }

  async function runSelfTest() {
    if (!runnerRef.current || selfTesting) {
      return;
    }

    setSelfTesting(true);
    try {
      await runnerRef.current.runVisionSelfTest();
    } finally {
      setSelfTesting(false);
    }
  }

  return (
    <section className="panel">
      <h1>Camera Checks</h1>
      <p className="muted">Browser-only webcam checks for presence and head-turn sequencing.</p>

      <div className="camera-layout">
        <div className="camera-preview-panel">
          <div className="camera-preview-wrap">
            <video ref={videoRef} className="camera-preview camera-preview-mirrored" muted playsInline />
            <canvas ref={overlayRef} className="camera-overlay camera-preview-mirrored" />
          </div>
          <div className="camera-controls">
            <button
              className="button"
              type="button"
              onClick={() => withRunner((runner) => void runner.startCamera())}
            >
              Start Camera
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => withRunner((runner) => runner.stopCamera())}
            >
              Stop Camera
            </button>
            <button
              className="button"
              type="button"
              onClick={() => withRunner((runner) => runner.start("presence"))}
            >
              Start Presence Check
            </button>
            <button
              className="button"
              type="button"
              onClick={() => withRunner((runner) => runner.start("head_turn"))}
            >
              Start Head Turn Check
            </button>
            <button
              className="button"
              type="button"
              onClick={() => withRunner((runner) => runner.start("hold_still"))}
            >
              Start Hold Still Check
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => withRunner((runner) => runner.stop())}
            >
              Stop Check
            </button>
            <button className="button" type="button" onClick={() => void runSelfTest()} disabled={selfTesting}>
              {selfTesting ? "Running Self Test..." : "Vision Self Test"}
            </button>
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={debugOverlay}
                onChange={(event) => setDebugOverlay(event.target.checked)}
              />
              <span>Debug Overlay</span>
            </label>
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={objectOverlay}
                onChange={(event) => setObjectOverlay(event.target.checked)}
              />
              <span>Object Boxes Overlay</span>
            </label>
          </div>
        </div>

        <div className="card">
          <h2>Status</h2>
          <p>Check: {checkType ?? "none"}</p>
          <p>State: {stateText}</p>
          {currentResult ? (
            <pre className="json">{JSON.stringify(currentResult, null, 2)}</pre>
          ) : (
            <p className="muted">No check result yet.</p>
          )}
        </div>
      </div>

      <div className="status-grid">
        <div className="card">
          <h2>Diagnostics</h2>
          <p>modelLoaded: {String(diagnostics.modelLoaded)}</p>
          <p>selfTestStatus: {diagnostics.selfTestStatus}</p>
          <p>taskModelUrl: {diagnostics.taskModelUrl}</p>
          <p>wasmBaseUrl: {diagnostics.wasmBaseUrl}</p>
          <p>lastInferenceMs: {diagnostics.lastInferenceMs.toFixed(1)}</p>
          <p>facesDetected: {diagnostics.facesDetected}</p>
          <p>
            videoWidth x videoHeight: {diagnostics.videoWidth} x {diagnostics.videoHeight}
          </p>
          <p>object model: {latestObservation?.object_debug.model_name ?? "none"}</p>
          <p>object input resolution: {latestObservation?.object_debug.input_resolution ?? 0}</p>
          <p>observation fps: {latestObservation?.inference_fps?.toFixed(2) ?? "0.00"}</p>
          <p>last inference ms: {latestObservation?.last_inference_ms?.toFixed(1) ?? "0.0"}</p>
          <p>raw detections: {latestObservation?.object_debug.raw_count ?? 0}</p>
          <p>post threshold: {latestObservation?.object_debug.post_threshold_count ?? 0}</p>
          <p>post nms: {latestObservation?.object_debug.post_nms_count ?? 0}</p>
          <p>stable objects: {latestObservation?.scene_objects_summary ?? "I see: none"}</p>
          <p>custom match similarity: {latestObservation?.custom_match_debug.last_similarity?.toFixed(3) ?? "0.000"}</p>
          <p>custom candidates: {latestObservation?.custom_match_debug.candidate_count ?? 0}</p>
          <p>custom references: {latestObservation?.custom_match_debug.reference_count ?? 0}</p>
          <p>face present: {latestObservation?.face_present ? "yes" : "no"}</p>
          <p>mouth open: {latestObservation?.mouth_open ? "yes" : "no"}</p>
          <p>mouth ratio: {latestObservation?.mouth_open_ratio?.toFixed(3) ?? "0.000"}</p>
          <p>mouth confidence: {latestObservation?.mouth_open_confidence?.toFixed(2) ?? "0.00"}</p>
          <p>smile score: {latestObservation?.smile_score?.toFixed(2) ?? "0.00"}</p>
          <p>brow furrow score: {latestObservation?.brow_furrow_score?.toFixed(2) ?? "0.00"}</p>
          <p>
            eye openness: L {latestObservation?.eye_openness_left?.toFixed(2) ?? "0.00"} / R{" "}
            {latestObservation?.eye_openness_right?.toFixed(2) ?? "0.00"}
          </p>
          <p>
            head pose: yaw {latestObservation?.head_pose?.yaw?.toFixed(1) ?? "0.0"} pitch{" "}
            {latestObservation?.head_pose?.pitch?.toFixed(1) ?? "0.0"} roll{" "}
            {latestObservation?.head_pose?.roll?.toFixed(1) ?? "0.0"}
          </p>
          <p>gaze direction: {latestObservation?.gaze_direction ?? "unknown"}</p>
          <p>facial fps: {latestObservation?.face_fps?.toFixed(2) ?? "0.00"}</p>
          <p>clothing baseline ready: {latestObservation?.clothing_baseline_ready ? "yes" : "no"}</p>
          <p>clothing change detected: {latestObservation?.clothing_change_detected ? "yes" : "no"}</p>
          <p>clothing change region: {latestObservation?.clothing_change_region ?? "none"}</p>
          <p>clothing change confidence: {latestObservation?.clothing_change_confidence?.toFixed(2) ?? "0.00"}</p>
          <p>clothing upper score: {latestObservation?.clothing_upper_change_score?.toFixed(2) ?? "0.00"}</p>
          <p>clothing lower score: {latestObservation?.clothing_lower_change_score?.toFixed(2) ?? "0.00"}</p>
          <p>clothing summary: {latestObservation?.clothing_change_summary ?? "none"}</p>
          {latestObservation?.objects_stable?.length ? (
            <pre className="json">
              {JSON.stringify(latestObservation.objects_stable, null, 2)}
            </pre>
          ) : (
            <p className="muted">No stable objects yet.</p>
          )}
          {latestObservation?.custom_objects?.length ? (
            <pre className="json">
              {JSON.stringify(latestObservation.custom_objects, null, 2)}
            </pre>
          ) : (
            <p className="muted">No custom object detections yet.</p>
          )}
          <p>lastError: {diagnostics.lastError ?? "none"}</p>
        </div>
      </div>

      <div className="card">
        <h2>Custom Items</h2>
        <p className="muted">Add your own labels and reference images for local matching.</p>
        <div className="camera-controls">
          <input
            value={customLabel}
            onChange={(event) => setCustomLabel(event.target.value)}
            placeholder="new_item_label"
            disabled={customBusy}
          />
          <button className="button" type="button" onClick={() => void createCustomItem()} disabled={customBusy}>
            Add Item
          </button>
          <button className="button button-secondary" type="button" onClick={() => void refreshCustomItems()} disabled={customBusy}>
            Refresh
          </button>
        </div>
        {customError ? <p className="error-text">{customError}</p> : null}
        {customItems.length === 0 ? (
          <p className="muted">No custom items yet.</p>
        ) : (
          <div className="debug-console">
            {customItems.map((item) => {
              const seen = customSeenByLabel.get(item.label);
              return (
                <div key={item.id} className="debug-line">
                  <p>
                    {item.label} refs={item.references.length}
                    {seen
                      ? ` last_seen=${seen.confidence.toFixed(2)} at ${new Date(seen.timestamp).toLocaleTimeString()}`
                      : " last_seen=none"}
                  </p>
                  <div className="camera-controls">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => void captureReferenceForItem(item.id)}
                      disabled={customBusy}
                    >
                      Capture Reference
                    </button>
                    <label className="button button-secondary" style={{ display: "inline-flex", alignItems: "center" }}>
                      Upload Reference
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void uploadReferenceForItem(item.id, file);
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => void removeCustomItem(item.id)}
                      disabled={customBusy}
                    >
                      Delete Item
                    </button>
                  </div>
                  {item.references.length > 0 ? (
                    <div className="debug-console">
                      {item.references.map((ref) => (
                        <p key={ref.id} className="debug-line">
                          ref={ref.id.slice(0, 8)}...{" "}
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => void removeCustomReference(item.id, ref.id)}
                            disabled={customBusy}
                          >
                            Delete Ref
                          </button>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No references saved yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Debug Console (last 50 events)</h2>
        <div className="debug-console">
          {events.length === 0 ? <p className="muted">No events yet.</p> : null}
          {events.map((entry, index) => (
            <p key={`${entry.timestamp}-${index}`} className="debug-line">
              [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.label} - {entry.detail}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
