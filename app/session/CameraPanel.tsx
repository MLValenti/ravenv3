"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { CheckRunner } from "@/lib/camera/check-runner";
import type { CameraEvent } from "@/lib/camera/events";

export type CameraPanelStatus = "idle" | "warming" | "ready" | "error";

export type CameraPanelHandle = {
  startCamera: () => Promise<boolean>;
  stopCamera: () => void;
  getRunner: () => CheckRunner | null;
  getStatus: () => CameraPanelStatus;
};

type CameraPanelProps = {
  onRunnerChange: (runner: CheckRunner | null) => void;
  onCameraEvent: (event: CameraEvent) => void;
};

const PLACEHOLDER = (
  <div className="camera-preview-wrap">
    <video className="camera-preview camera-preview-mirrored" muted playsInline />
    <canvas className="camera-overlay camera-preview-mirrored" />
  </div>
);

const CameraPanel = forwardRef<CameraPanelHandle, CameraPanelProps>(function CameraPanel(
  { onRunnerChange, onCameraEvent },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<CheckRunner | null>(null);
  const onRunnerChangeRef = useRef(onRunnerChange);
  const onCameraEventRef = useRef(onCameraEvent);
  const statusRef = useRef<CameraPanelStatus>("idle");
  const startingRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<CameraPanelStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    onRunnerChangeRef.current = onRunnerChange;
  }, [onRunnerChange]);

  useEffect(() => {
    onCameraEventRef.current = onCameraEvent;
  }, [onCameraEvent]);

  const setCameraStatus = useCallback((next: CameraPanelStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const startCamera = useCallback(async () => {
    const runner = runnerRef.current;
    if (!runner) {
      return false;
    }
    if (startingRef.current) {
      return runner.currentState().cameraRunning === true;
    }
    if (runner.currentState().cameraRunning) {
      setErrorText(null);
      setCameraStatus("ready");
      return true;
    }

    setErrorText(null);
    setCameraStatus("warming");
    startingRef.current = true;
    try {
      await runner.startCamera();
      const running = runner.currentState().cameraRunning === true;
      if (!running && statusRef.current === "warming") {
        setCameraStatus("idle");
      }
      return running;
    } finally {
      startingRef.current = false;
    }
  }, [setCameraStatus]);

  const stopCamera = useCallback(() => {
    runnerRef.current?.stopCamera();
    setCameraStatus("idle");
  }, [setCameraStatus]);

  useImperativeHandle(
    ref,
    () => ({
      startCamera,
      stopCamera,
      getRunner: () => runnerRef.current,
      getStatus: () => statusRef.current,
    }),
    [startCamera, stopCamera],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !videoRef.current || !overlayRef.current) {
      return;
    }

    const runner = new CheckRunner(videoRef.current, overlayRef.current);
    runnerRef.current = runner;
    onRunnerChangeRef.current(runner);

    const unsubscribe = runner.events().on((event) => {
      onCameraEventRef.current(event);

      if (event.type === "camera.started") {
        setErrorText(null);
        setCameraStatus("ready");
      }
      if (event.type === "camera.stopped") {
        setCameraStatus("idle");
      }
      if (event.type === "camera.error" || event.type === "vision.error") {
        setErrorText(event.message);
        setCameraStatus("error");
      }
    });

    if (!autoStartAttemptedRef.current) {
      autoStartAttemptedRef.current = true;
      void startCamera();
    }

    return () => {
      unsubscribe();
      runner.stopCamera();
      runnerRef.current = null;
      onRunnerChangeRef.current(null);
      setCameraStatus("idle");
    };
  }, [mounted, setCameraStatus, startCamera]);

  if (!mounted) {
    return PLACEHOLDER;
  }

  return (
    <>
      <div className="camera-preview-wrap">
        <video ref={videoRef} className="camera-preview camera-preview-mirrored" muted playsInline />
        <canvas ref={overlayRef} className="camera-overlay camera-preview-mirrored" />
      </div>
      <div className="camera-controls">
        <p className="muted">Camera status: {status}</p>
        {status !== "ready" ? (
          <button className="button" type="button" onClick={() => void startCamera()}>
            Enable Camera
          </button>
        ) : null}
      </div>
      {errorText ? <p className="error-text">{errorText}</p> : null}
    </>
  );
});

export default CameraPanel;
