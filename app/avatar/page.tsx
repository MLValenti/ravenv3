"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

import { subscribeRuntimeEvents, type RuntimeEvent } from "@/lib/runtime-event-bus";
import {
  loadSpeechSettings,
  saveSpeechSettings,
  speakRavenText,
  stopRavenSpeech,
  type RavenSpeechSettings,
} from "@/lib/speech";

type AvatarMeta = {
  name: string;
  size: number;
  lastModified: number;
  loadedAt: string;
};

const AVATAR_META_KEY = "raven.avatar.meta";

type SceneState = {
  scene: any;
  camera: any;
  renderer: any;
  clock: any;
  currentVrm: VRM | null;
  neckNode: any;
  targetHeadYaw: number;
  headYaw: number;
  swayScale: number;
  mouthOpen: number;
  speaking: boolean;
  speakingSeed: number;
  lastPresencePassAt: number;
  presenceTracked: boolean;
};

function loadAvatarMeta(): AvatarMeta | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AVATAR_META_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AvatarMeta;
  } catch {
    return null;
  }
}

function saveAvatarMeta(meta: AvatarMeta) {
  window.localStorage.setItem(AVATAR_META_KEY, JSON.stringify(meta));
}

function applyExpression(vrm: VRM | null, expressionName: string, value: number) {
  if (!vrm?.expressionManager) {
    return;
  }
  vrm.expressionManager.setValue(expressionName, value);
}

function parsePresence(event: RuntimeEvent): "tracked" | "lost" | "ignore" {
  if (event.type !== "camera.event") {
    return "ignore";
  }

  const cameraEvent = event.event;
  if (cameraEvent.type === "check.update" && cameraEvent.checkType === "presence") {
    if (cameraEvent.result.type === "presence" && cameraEvent.result.passed) {
      return "tracked";
    }
    return "lost";
  }

  if (cameraEvent.type === "check.completed" && cameraEvent.checkType === "presence") {
    return cameraEvent.status === "passed" ? "tracked" : "lost";
  }

  return "ignore";
}

export default function AvatarPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const [avatarMeta, setAvatarMeta] = useState<AvatarMeta | null>(() =>
    typeof window === "undefined" ? null : loadAvatarMeta(),
  );
  const [presenceStatus, setPresenceStatus] = useState<"tracked" | "lost">("lost");
  const [ravenLog, setRavenLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechSettings, setSpeechSettings] = useState<RavenSpeechSettings>(() =>
    typeof window === "undefined" ? { enabled: false, voiceName: "", rate: 1, pitch: 1 } : loadSpeechSettings(),
  );

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.4, 2.5);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(1, 2, 2);
    scene.add(ambientLight, dirLight);

    const clock = new THREE.Clock();
    sceneRef.current = {
      scene,
      camera,
      renderer,
      clock,
      currentVrm: null,
      neckNode: null,
      targetHeadYaw: 0.2,
      headYaw: 0.2,
      swayScale: 1,
      mouthOpen: 0,
      speaking: false,
      speakingSeed: Math.random() * 10,
      lastPresencePassAt: 0,
      presenceTracked: false,
    };

    let frameId = 0;

    const renderLoop = () => {
      const state = sceneRef.current;
      const container = containerRef.current;
      if (!state || !container) {
        return;
      }

      const width = container.clientWidth;
      const height = Math.max(320, container.clientHeight);
      if (state.renderer.domElement.width !== width * window.devicePixelRatio || state.renderer.domElement.height !== height * window.devicePixelRatio) {
        state.renderer.setSize(width, height, false);
        state.camera.aspect = width / height;
        state.camera.updateProjectionMatrix();
      }

      const delta = state.clock.getDelta();
      const elapsed = state.clock.elapsedTime;

      if (state.currentVrm) {
        state.currentVrm.update(delta);
      }

      if (state.neckNode) {
        const idleSway = Math.sin(elapsed * 0.9) * 0.08 * state.swayScale;
        state.headYaw = THREE.MathUtils.lerp(state.headYaw, state.targetHeadYaw + idleSway, 0.06);
        state.neckNode.rotation.y = state.headYaw;
        state.neckNode.rotation.x = Math.sin(elapsed * 1.2) * 0.03 * state.swayScale;
      }

      if (state.currentVrm) {
        const blinkPhase = elapsed % 4.0;
        const blinkValue = blinkPhase < 0.12 ? 1 - Math.abs((blinkPhase - 0.06) / 0.06) : 0;
        applyExpression(state.currentVrm, "blink", Math.max(0, Math.min(1, blinkValue)));

        if (state.speaking) {
          const envelope =
            0.25 +
            0.2 * Math.abs(Math.sin(elapsed * 11 + state.speakingSeed)) +
            0.15 * Math.abs(Math.sin(elapsed * 17 + state.speakingSeed * 0.5));
          state.mouthOpen = THREE.MathUtils.lerp(state.mouthOpen, envelope, 0.35);
        } else {
          state.mouthOpen = THREE.MathUtils.lerp(state.mouthOpen, 0, 0.25);
        }

        applyExpression(state.currentVrm, "aa", state.mouthOpen);
        applyExpression(state.currentVrm, "oh", state.mouthOpen * 0.7);
      }

      if (state.presenceTracked && Date.now() - state.lastPresencePassAt > 2000) {
        state.presenceTracked = false;
        state.targetHeadYaw = 0.2;
        state.swayScale = 1;
        setPresenceStatus("lost");
      }

      state.renderer.render(state.scene, state.camera);
      frameId = window.requestAnimationFrame(renderLoop);
    };

    frameId = window.requestAnimationFrame(renderLoop);

    return () => {
      window.cancelAnimationFrame(frameId);
      if (sceneRef.current?.currentVrm) {
        sceneRef.current.scene.remove(sceneRef.current.currentVrm.scene);
      }
      renderer.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const updateVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeRuntimeEvents((event) => {
      const presenceEvent = parsePresence(event);
      if (presenceEvent === "tracked" && sceneRef.current) {
        sceneRef.current.presenceTracked = true;
        sceneRef.current.lastPresencePassAt = Date.now();
        sceneRef.current.targetHeadYaw = 0;
        sceneRef.current.swayScale = 0.35;
        setPresenceStatus("tracked");
      } else if (presenceEvent === "lost" && sceneRef.current) {
        if (Date.now() - sceneRef.current.lastPresencePassAt > 2000) {
          sceneRef.current.presenceTracked = false;
          sceneRef.current.targetHeadYaw = 0.2;
          sceneRef.current.swayScale = 1;
          setPresenceStatus("lost");
        }
      }

      if (event.type === "raven.output") {
        setRavenLog((current) => [event.text, ...current].slice(0, 50));
        speakRavenText(event.text, {
          onStart: () => {
            if (sceneRef.current) {
              sceneRef.current.speaking = true;
            }
          },
          onEnd: () => {
            if (sceneRef.current) {
              sceneRef.current.speaking = false;
            }
          },
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  async function loadVrmFile(file: File) {
    const state = sceneRef.current;
    if (!state) {
      return;
    }

    setError(null);
    const objectUrl = URL.createObjectURL(file);
    const loader: any = new GLTFLoader();
    loader.register((parser: any) => new VRMLoaderPlugin(parser));

    try {
      const gltf: any = await loader.loadAsync(objectUrl);
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) {
        throw new Error("Selected file did not contain a VRM model.");
      }

      if (state.currentVrm) {
        state.scene.remove(state.currentVrm.scene);
      }

      state.currentVrm = vrm;
      state.scene.add(vrm.scene);
      vrm.scene.position.set(0, -1.2, 0);
      vrm.scene.rotation.y = Math.PI;
      state.neckNode = vrm.humanoid.getNormalizedBoneNode("neck" as never);
      state.targetHeadYaw = presenceStatus === "tracked" ? 0 : 0.2;
      state.swayScale = presenceStatus === "tracked" ? 0.35 : 1;

      const meta: AvatarMeta = {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        loadedAt: new Date().toISOString(),
      };
      saveAvatarMeta(meta);
      setAvatarMeta(meta);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load VRM.");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".vrm")) {
      setError("Please select a .vrm file.");
      return;
    }

    void loadVrmFile(file);
  }

  function updateSpeechSettings(next: RavenSpeechSettings) {
    setSpeechSettings(next);
    saveSpeechSettings(next);
  }

  return (
    <section className="panel">
      <h1>Avatar</h1>
      <p className="muted">Load a local VRM avatar, configure voice, and watch presence reactions.</p>

      <div className="camera-layout">
        <div className="camera-preview-panel">
          <div ref={containerRef} className="avatar-canvas-wrap">
            <canvas ref={canvasRef} className="avatar-canvas" />
          </div>
          <label className="field">
            <span>Load .vrm from disk</span>
            <input type="file" accept=".vrm,model/gltf-binary" onChange={onFileChange} />
          </label>
          {avatarMeta ? (
            <p className="muted">
              Last loaded: <strong>{avatarMeta.name}</strong> ({Math.round(avatarMeta.size / 1024)} KB)
            </p>
          ) : (
            <p className="muted">No avatar loaded yet.</p>
          )}
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="card">
          <h2>Voice</h2>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={speechSettings.enabled}
              onChange={(event) =>
                updateSpeechSettings({ ...speechSettings, enabled: event.target.checked })
              }
            />
            <span>Speak Raven output</span>
          </label>
          <label className="field">
            <span>Voice</span>
            <select
              value={speechSettings.voiceName}
              onChange={(event) =>
                updateSpeechSettings({ ...speechSettings, voiceName: event.target.value })
              }
            >
              <option value="">Default</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Rate: {speechSettings.rate.toFixed(2)}</span>
            <input
              type="range"
              min="0.7"
              max="1.4"
              step="0.05"
              value={speechSettings.rate}
              onChange={(event) =>
                updateSpeechSettings({ ...speechSettings, rate: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Pitch: {speechSettings.pitch.toFixed(2)}</span>
            <input
              type="range"
              min="0.7"
              max="1.4"
              step="0.05"
              value={speechSettings.pitch}
              onChange={(event) =>
                updateSpeechSettings({ ...speechSettings, pitch: Number(event.target.value) })
              }
            />
          </label>
          <button className="button button-secondary" type="button" onClick={stopRavenSpeech}>
            Stop Speaking
          </button>
        </div>
      </div>

      <div className="status-grid">
        <div className="card">
          <h2>Presence</h2>
          <p className={presenceStatus === "tracked" ? "ok-text" : "danger-text"}>
            Presence: {presenceStatus}
          </p>
          <p className="muted">
            When tracked, Raven faces forward and reduces sway. When lost for 2s, Raven looks away.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Raven Output Log</h2>
        <div className="debug-console">
          {ravenLog.length === 0 ? <p className="muted">No Raven output yet.</p> : null}
          {ravenLog.map((line, index) => (
            <p key={`${line}-${index}`} className="debug-line">
              {line}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
