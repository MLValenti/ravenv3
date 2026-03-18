export type ObservationPrompt = {
  ts: number | null;
  observation_age_ms: number | null;
  camera_available: boolean;
  person_present: boolean;
  face_present: boolean;
  mouth_open: boolean;
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
  pose_label: string;
  motion_state: string;
  clothing_change_detected: boolean;
  clothing_change_region: "upper" | "lower" | "unknown" | "none";
  clothing_change_confidence: number;
  clothing_change_summary: string;
  scene_objects_summary: string;
  scene_objects_change: string | null;
  scene_summary: string;
  scene_change_summary: string | null;
  inference_status: "ok" | "limited" | "unavailable";
  last_inference_ms: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const next = value.trim();
  return next || fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function levelText(value: number): "low" | "med" | "high" {
  if (value >= 0.67) {
    return "high";
  }
  if (value >= 0.34) {
    return "med";
  }
  return "low";
}

function headTurnLabel(yaw: number): "left" | "right" | "center" {
  if (yaw <= -12) {
    return "left";
  }
  if (yaw >= 12) {
    return "right";
  }
  return "center";
}

export function normalizeObservationPrompt(value: unknown): ObservationPrompt {
  const nowMs = Date.now();
  const record = asRecord(value);
  if (!record) {
    return {
      ts: null,
      observation_age_ms: null,
      camera_available: false,
      person_present: false,
      face_present: false,
      mouth_open: false,
      smile_score: 0,
      brow_furrow_score: 0,
      eye_openness_left: 0,
      eye_openness_right: 0,
      head_pose: { yaw: 0, pitch: 0, roll: 0 },
      gaze_direction: "unknown",
      pose_label: "unknown",
      motion_state: "unknown",
      clothing_change_detected: false,
      clothing_change_region: "none",
      clothing_change_confidence: 0,
      clothing_change_summary: "No clothing change signal.",
      scene_objects_summary: "I see: none",
      scene_objects_change: null,
      scene_summary: "No observation data for this turn.",
      scene_change_summary: null,
      inference_status: "unavailable",
      last_inference_ms: 0,
    };
  }

  const sceneChangeRaw = record.scene_change_summary;
  const sceneChange =
    typeof sceneChangeRaw === "string" && sceneChangeRaw.trim().length > 0
      ? sceneChangeRaw.trim()
      : null;
  const sceneObjectsChangeRaw = record.scene_objects_change;
  const sceneObjectsChange =
    typeof sceneObjectsChangeRaw === "string" && sceneObjectsChangeRaw.trim().length > 0
      ? sceneObjectsChangeRaw.trim()
      : null;
  const headPoseRaw = asRecord(record.head_pose);
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : null;
  const observationAgeMs =
    ts === null ? null : Math.max(0, Math.floor(nowMs - ts));
  const inferenceStatus =
    record.inference_status === "ok" ||
    record.inference_status === "limited" ||
    record.inference_status === "unavailable"
      ? record.inference_status
      : "unavailable";

  return {
    ts,
    observation_age_ms: observationAgeMs,
    camera_available: asBoolean(record.camera_available, false),
    person_present: asBoolean(record.person_present, false),
    face_present: asBoolean(record.face_present, false),
    mouth_open: asBoolean(record.mouth_open, false),
    smile_score: asNumber(record.smile_score, 0),
    brow_furrow_score: asNumber(record.brow_furrow_score, 0),
    eye_openness_left: asNumber(record.eye_openness_left, 0),
    eye_openness_right: asNumber(record.eye_openness_right, 0),
    head_pose: {
      yaw: asNumber(headPoseRaw?.yaw, 0),
      pitch: asNumber(headPoseRaw?.pitch, 0),
      roll: asNumber(headPoseRaw?.roll, 0),
    },
    gaze_direction:
      record.gaze_direction === "left" ||
      record.gaze_direction === "right" ||
      record.gaze_direction === "center"
        ? record.gaze_direction
        : "unknown",
    pose_label: asString(record.pose_label, "unknown"),
    motion_state: asString(record.motion_state, "unknown"),
    clothing_change_detected: asBoolean(record.clothing_change_detected, false),
    clothing_change_region:
      record.clothing_change_region === "upper" ||
      record.clothing_change_region === "lower" ||
      record.clothing_change_region === "unknown"
        ? record.clothing_change_region
        : "none",
    clothing_change_confidence: asNumber(record.clothing_change_confidence, 0),
    clothing_change_summary: asString(record.clothing_change_summary, "No clothing change signal."),
    scene_objects_summary: asString(record.scene_objects_summary, "I see: none"),
    scene_objects_change: sceneObjectsChange,
    scene_summary: asString(record.scene_summary, "No observation data for this turn."),
    scene_change_summary: sceneChange,
    inference_status: inferenceStatus,
    last_inference_ms: asNumber(record.last_inference_ms, 0),
  };
}

export function buildObservationPromptBlock(observation: ObservationPrompt): string {
  const lines = [
    "Observations:",
    `observation_ts: ${observation.ts ?? "none"}`,
    `observation_age_ms: ${observation.observation_age_ms ?? "unknown"}`,
    `scene_summary: ${observation.scene_summary}`,
    `scene_objects_summary: ${observation.scene_objects_summary}`,
    `person_present: ${observation.person_present}`,
    `pose_label: ${observation.pose_label}`,
    `motion_state: ${observation.motion_state}`,
    `clothing_change_detected: ${observation.clothing_change_detected}`,
    `clothing_change_region: ${observation.clothing_change_region}`,
    `clothing_change_confidence: ${observation.clothing_change_confidence.toFixed(2)}`,
    `clothing_change_summary: ${observation.clothing_change_summary}`,
    `camera_available: ${observation.camera_available}`,
    `inference_status: ${observation.inference_status}`,
    `last_inference_ms: ${observation.last_inference_ms.toFixed(1)}`,
  ];
  if (observation.scene_objects_change) {
    lines.push(`scene_objects_change: ${observation.scene_objects_change}`);
  }
  if (observation.scene_change_summary) {
    lines.push(`scene_change_summary: ${observation.scene_change_summary}`);
  }
  if (observation.face_present) {
    lines.push("Facial cues:");
    lines.push("- face present: yes");
    lines.push(`- mouth open: ${observation.mouth_open ? "yes" : "no"}`);
    lines.push(`- smile: ${levelText(observation.smile_score)}`);
    lines.push(`- brow furrow: ${levelText(observation.brow_furrow_score)}`);
    const eyeLevel = levelText((observation.eye_openness_left + observation.eye_openness_right) / 2);
    lines.push(`- eyes open level: ${eyeLevel}`);
    lines.push(`- head turned: ${headTurnLabel(observation.head_pose.yaw)}`);
    lines.push(`- gaze direction: ${observation.gaze_direction}`);
  }
  return lines.join("\n");
}
