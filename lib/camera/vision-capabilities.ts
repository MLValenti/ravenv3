import type { VisionObservation } from "./observation";

export type VisionDetectorStatus = {
  detector_id: string;
  enabled: boolean;
  healthy: boolean;
  last_run_ts: number | null;
  supported_signals: string[];
};

export type VisionSignalsStatus = {
  detectors: VisionDetectorStatus[];
  signals_available: string[];
};

export type CapabilityReliability = "high" | "medium" | "low";

export type CapabilityParameterSchema =
  | {
      type: "number";
      required?: boolean;
      min: number;
      max: number;
      default?: number;
      description: string;
    }
  | {
      type: "string";
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      enum?: string[];
      default?: string;
      description: string;
    }
  | {
      type: "boolean";
      required?: boolean;
      default?: boolean;
      description: string;
    };

export type VerificationCapabilityCatalogEntry = {
  capability_id: string;
  description: string;
  required_signals: string[];
  optional_signals: string[];
  parameters_schema: Record<string, CapabilityParameterSchema>;
  allowed_ranges: Record<string, string>;
  default_thresholds: Record<string, number | string | boolean>;
  estimated_reliability: CapabilityReliability;
  limitations: string;
};

export type CapabilityEvaluation = {
  status: "pass" | "fail" | "inconclusive";
  confidence: number;
  summary: string;
  raw: Record<string, unknown>;
};

export type PlannerCheckValidationReport = {
  accepted: Array<{ checkType: string; checkParams: Record<string, unknown> }>;
  removed: Array<{ checkType: string; reason: string }>;
  downgraded: boolean;
  downgrade_reason: string | null;
  clamp_notes: string[];
};

type CapabilityDefinition = VerificationCapabilityCatalogEntry & {
  required_any_signals?: string[];
};

const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  {
    capability_id: "presence",
    description: "Verify the user is in frame.",
    required_signals: [],
    required_any_signals: ["person_present", "face_present"],
    optional_signals: ["keypoints_confidence"],
    parameters_schema: {},
    allowed_ranges: {},
    default_thresholds: {},
    estimated_reliability: "high",
    limitations: "Needs camera visibility and reasonable lighting.",
  },
  {
    capability_id: "head_turn",
    description: "Verify head yaw turns left or right beyond a threshold.",
    required_signals: ["head_pose_yaw"],
    optional_signals: ["face_present"],
    parameters_schema: {
      direction: {
        type: "string",
        enum: ["left", "right", "either"],
        default: "either",
        description: "Expected turn direction.",
      },
      min_abs_yaw: {
        type: "number",
        min: 8,
        max: 35,
        default: 12,
        description: "Minimum absolute yaw in degrees.",
      },
    },
    allowed_ranges: {
      direction: "left|right|either",
      min_abs_yaw: "8..35",
    },
    default_thresholds: {
      direction: "either",
      min_abs_yaw: 12,
    },
    estimated_reliability: "medium",
    limitations: "Single-frame yaw check, not a full multi-step sequence.",
  },
  {
    capability_id: "hold_still",
    description: "Verify the user remains still.",
    required_signals: ["motion_state", "head_pose_yaw"],
    optional_signals: ["face_present"],
    parameters_schema: {
      expected_motion: {
        type: "string",
        enum: ["still"],
        default: "still",
        description: "Expected motion state.",
      },
      max_abs_yaw: {
        type: "number",
        min: 2,
        max: 18,
        default: 9,
        description: "Maximum allowed absolute yaw in degrees.",
      },
    },
    allowed_ranges: {
      expected_motion: "still",
      max_abs_yaw: "2..18",
    },
    default_thresholds: {
      expected_motion: "still",
      max_abs_yaw: 9,
    },
    estimated_reliability: "medium",
    limitations: "Can be affected by camera shake and framing jitter.",
  },
  {
    capability_id: "stillness_hold",
    description: "Verify low-motion stillness for a brief hold.",
    required_signals: ["motion_state", "motion_score"],
    optional_signals: ["head_pose_yaw", "face_present"],
    parameters_schema: {
      expected_motion: {
        type: "string",
        enum: ["still"],
        default: "still",
        description: "Expected motion state.",
      },
      max_score: {
        type: "number",
        min: 0.01,
        max: 0.4,
        default: 0.08,
        description: "Maximum motion_score allowed for pass.",
      },
      max_abs_yaw: {
        type: "number",
        min: 2,
        max: 25,
        default: 12,
        description: "Optional yaw drift cap in degrees when face is present.",
      },
    },
    allowed_ranges: {
      expected_motion: "still",
      max_score: "0.01..0.4",
      max_abs_yaw: "2..25",
    },
    default_thresholds: {
      expected_motion: "still",
      max_score: 0.08,
      max_abs_yaw: 12,
    },
    estimated_reliability: "high",
    limitations: "Background movement can reduce confidence.",
  },
  {
    capability_id: "centered_in_frame",
    description: "Verify face center stays near frame center.",
    required_signals: ["face_bbox"],
    optional_signals: ["face_present"],
    parameters_schema: {
      max_center_offset: {
        type: "number",
        min: 0.05,
        max: 0.45,
        default: 0.22,
        description: "Maximum normalized center offset from frame center.",
      },
    },
    allowed_ranges: {
      max_center_offset: "0.05..0.45",
    },
    default_thresholds: {
      max_center_offset: 0.22,
    },
    estimated_reliability: "high",
    limitations: "Requires stable face bounding box.",
  },
  {
    capability_id: "distance_ok",
    description: "Verify face distance is within a target range.",
    required_signals: ["face_box_area_ratio"],
    optional_signals: ["face_present"],
    parameters_schema: {
      min_ratio: {
        type: "number",
        min: 0.01,
        max: 0.5,
        default: 0.06,
        description: "Minimum face box area ratio.",
      },
      max_ratio: {
        type: "number",
        min: 0.02,
        max: 0.9,
        default: 0.35,
        description: "Maximum face box area ratio.",
      },
    },
    allowed_ranges: {
      min_ratio: "0.01..0.5",
      max_ratio: "0.02..0.9",
    },
    default_thresholds: {
      min_ratio: 0.06,
      max_ratio: 0.35,
    },
    estimated_reliability: "medium",
    limitations: "Perspective and lens differences can shift thresholds.",
  },
  {
    capability_id: "gaze_centered",
    description: "Verify user is looking near the camera center.",
    required_signals: [],
    required_any_signals: ["gaze_direction", "head_pose_yaw"],
    optional_signals: ["face_present"],
    parameters_schema: {
      allowed_deviation_yaw: {
        type: "number",
        min: 3,
        max: 25,
        default: 12,
        description: "Maximum absolute yaw in degrees.",
      },
      require_gaze_center: {
        type: "boolean",
        default: true,
        description: "Require gaze_direction=center when available.",
      },
    },
    allowed_ranges: {
      allowed_deviation_yaw: "3..25",
      require_gaze_center: "true|false",
    },
    default_thresholds: {
      allowed_deviation_yaw: 12,
      require_gaze_center: true,
    },
    estimated_reliability: "medium",
    limitations: "Falls back to yaw-only when gaze direction is unknown.",
  },
  {
    capability_id: "eye_contact_hold",
    description: "Verify gaze is centered with low yaw drift.",
    required_signals: ["gaze_direction", "head_pose_yaw"],
    optional_signals: ["face_present"],
    parameters_schema: {
      allowed_deviation_yaw: {
        type: "number",
        min: 2,
        max: 20,
        default: 9,
        description: "Maximum absolute yaw in degrees.",
      },
      require_gaze_center: {
        type: "boolean",
        default: true,
        description: "Require gaze_direction=center when available.",
      },
    },
    allowed_ranges: {
      allowed_deviation_yaw: "2..20",
      require_gaze_center: "true|false",
    },
    default_thresholds: {
      allowed_deviation_yaw: 9,
      require_gaze_center: true,
    },
    estimated_reliability: "medium",
    limitations: "Single-frame evaluator. Use repeated checks for longer holds.",
  },
  {
    capability_id: "blink_detected",
    description: "Verify a recent blink event was detected.",
    required_signals: ["blink_detected_recent"],
    optional_signals: ["blink_rate_per_min", "face_present"],
    parameters_schema: {},
    allowed_ranges: {},
    default_thresholds: {},
    estimated_reliability: "medium",
    limitations: "Recent blink window is short and depends on frame cadence.",
  },
  {
    capability_id: "blink_rate_range",
    description: "Verify blink rate stays within a configured range.",
    required_signals: ["blink_rate_per_min"],
    optional_signals: ["face_present"],
    parameters_schema: {
      min_rate: {
        type: "number",
        min: 0,
        max: 80,
        default: 4,
        description: "Minimum blinks per minute.",
      },
      max_rate: {
        type: "number",
        min: 1,
        max: 120,
        default: 35,
        description: "Maximum blinks per minute.",
      },
    },
    allowed_ranges: {
      min_rate: "0..80",
      max_rate: "1..120",
    },
    default_thresholds: {
      min_rate: 4,
      max_rate: 35,
    },
    estimated_reliability: "low",
    limitations: "Requires enough elapsed runtime for stable rate estimates.",
  },
  {
    capability_id: "head_nod_detected",
    description: "Verify a recent head nod pattern was detected.",
    required_signals: ["head_nod_detected_recent"],
    optional_signals: ["head_pose"],
    parameters_schema: {},
    allowed_ranges: {},
    default_thresholds: {},
    estimated_reliability: "low",
    limitations: "Nod detection uses lightweight pitch extrema heuristics.",
  },
  {
    capability_id: "head_shake_detected",
    description: "Verify a recent head shake pattern was detected.",
    required_signals: ["head_shake_detected_recent"],
    optional_signals: ["head_pose"],
    parameters_schema: {},
    allowed_ranges: {},
    default_thresholds: {},
    estimated_reliability: "low",
    limitations: "Shake detection uses lightweight yaw extrema heuristics.",
  },
  {
    capability_id: "face_occluded",
    description: "Verify face occlusion score exceeds threshold.",
    required_signals: ["face_occlusion_score"],
    optional_signals: ["face_present", "keypoints_confidence"],
    parameters_schema: {
      min_score: {
        type: "number",
        min: 0.2,
        max: 1,
        default: 0.55,
        description: "Minimum occlusion score required for pass.",
      },
    },
    allowed_ranges: {
      min_score: "0.2..1",
    },
    default_thresholds: {
      min_score: 0.55,
    },
    estimated_reliability: "low",
    limitations: "Occlusion is heuristic and not identity aware.",
  },
  {
    capability_id: "framing_stable",
    description: "Verify framing jitter remains low and stable.",
    required_signals: ["framing_stability_score", "face_bbox"],
    optional_signals: ["face_present"],
    parameters_schema: {
      min_score: {
        type: "number",
        min: 0.2,
        max: 0.98,
        default: 0.62,
        description: "Minimum framing stability score.",
      },
    },
    allowed_ranges: {
      min_score: "0.2..0.98",
    },
    default_thresholds: {
      min_score: 0.62,
    },
    estimated_reliability: "medium",
    limitations: "Fast camera movement and autofocus shifts lower score.",
  },
  {
    capability_id: "motion_zone",
    description: "Verify face center stays inside a normalized frame zone.",
    required_signals: ["face_bbox"],
    optional_signals: ["face_present"],
    parameters_schema: {
      zone_x: {
        type: "number",
        min: 0,
        max: 0.9,
        default: 0.2,
        description: "Zone left edge in normalized coordinates.",
      },
      zone_y: {
        type: "number",
        min: 0,
        max: 0.9,
        default: 0.1,
        description: "Zone top edge in normalized coordinates.",
      },
      zone_width: {
        type: "number",
        min: 0.05,
        max: 1,
        default: 0.6,
        description: "Zone width in normalized coordinates.",
      },
      zone_height: {
        type: "number",
        min: 0.05,
        max: 1,
        default: 0.8,
        description: "Zone height in normalized coordinates.",
      },
    },
    allowed_ranges: {
      zone_x: "0..0.9",
      zone_y: "0..0.9",
      zone_width: "0.05..1",
      zone_height: "0.05..1",
    },
    default_thresholds: {
      zone_x: 0.2,
      zone_y: 0.1,
      zone_width: 0.6,
      zone_height: 0.8,
    },
    estimated_reliability: "high",
    limitations: "Requires stable face bounding box.",
  },
  {
    capability_id: "hand_visible_left_right",
    description: "Verify expected hand visibility side when hand landmarks are available.",
    required_signals: ["hand_landmarks"],
    optional_signals: [],
    parameters_schema: {
      expected: {
        type: "string",
        enum: ["left", "right", "both"],
        default: "both",
        description: "Expected visible hand side.",
      },
    },
    allowed_ranges: {
      expected: "left|right|both",
    },
    default_thresholds: {
      expected: "both",
    },
    estimated_reliability: "low",
    limitations: "Requires a hand landmark detector, not currently enabled in base runtime.",
  },
  {
    capability_id: "hand_pose",
    description: "Verify expected hand pose label when hand pose signals are available.",
    required_signals: ["hand_pose_label"],
    optional_signals: ["hand_landmarks"],
    parameters_schema: {
      expected: {
        type: "string",
        enum: ["open_palm", "fist", "point"],
        default: "open_palm",
        description: "Expected hand pose label.",
      },
    },
    allowed_ranges: {
      expected: "open_palm|fist|point",
    },
    default_thresholds: {
      expected: "open_palm",
    },
    estimated_reliability: "low",
    limitations: "Requires a hand pose detector, not currently enabled in base runtime.",
  },
  {
    capability_id: "shoulders_level",
    description: "Verify shoulders or head line is level within roll threshold.",
    required_signals: ["head_pose"],
    optional_signals: ["face_present"],
    parameters_schema: {
      max_abs_roll: {
        type: "number",
        min: 2,
        max: 25,
        default: 9,
        description: "Maximum absolute roll in degrees.",
      },
    },
    allowed_ranges: {
      max_abs_roll: "2..25",
    },
    default_thresholds: {
      max_abs_roll: 9,
    },
    estimated_reliability: "medium",
    limitations: "Uses head roll as a shoulder-level proxy when body landmarks are unavailable.",
  },
  {
    capability_id: "posture_upright",
    description: "Verify upright posture based on pitch and roll limits.",
    required_signals: ["head_pose"],
    optional_signals: ["person_present", "motion_state"],
    parameters_schema: {
      max_abs_pitch: {
        type: "number",
        min: 5,
        max: 35,
        default: 20,
        description: "Maximum absolute pitch in degrees.",
      },
      max_abs_roll: {
        type: "number",
        min: 2,
        max: 25,
        default: 12,
        description: "Maximum absolute roll in degrees.",
      },
      require_still: {
        type: "boolean",
        default: false,
        description: "Require motion_state=still.",
      },
    },
    allowed_ranges: {
      max_abs_pitch: "5..35",
      max_abs_roll: "2..25",
      require_still: "true|false",
    },
    default_thresholds: {
      max_abs_pitch: 20,
      max_abs_roll: 12,
      require_still: false,
    },
    estimated_reliability: "medium",
    limitations: "Uses head pose as posture proxy without full body keypoints.",
  },
  {
    capability_id: "body_in_frame_full",
    description: "Verify body framing appears wide enough for full upper-body context.",
    required_signals: ["face_box_area_ratio"],
    optional_signals: ["person_present", "face_present"],
    parameters_schema: {
      min_face_ratio: {
        type: "number",
        min: 0.005,
        max: 0.2,
        default: 0.015,
        description: "Minimum face box ratio for reliable tracking.",
      },
      max_face_ratio: {
        type: "number",
        min: 0.02,
        max: 0.35,
        default: 0.12,
        description: "Maximum face box ratio to keep body in frame.",
      },
    },
    allowed_ranges: {
      min_face_ratio: "0.005..0.2",
      max_face_ratio: "0.02..0.35",
    },
    default_thresholds: {
      min_face_ratio: 0.015,
      max_face_ratio: 0.12,
    },
    estimated_reliability: "low",
    limitations: "Approximation from face size only, not full body segmentation.",
  },
  {
    capability_id: "timed_hold_pass",
    description: "Verify hold conditions remain true for a required duration.",
    required_signals: ["motion_state", "framing_stability_score"],
    optional_signals: ["face_present", "head_pose_yaw"],
    parameters_schema: {
      hold_seconds: {
        type: "number",
        min: 3,
        max: 10,
        default: 5,
        description: "Required hold duration in seconds.",
      },
      min_stability: {
        type: "number",
        min: 0.2,
        max: 0.98,
        default: 0.62,
        description: "Minimum framing stability score during hold.",
      },
      hold_key: {
        type: "string",
        minLength: 1,
        maxLength: 48,
        default: "default_hold",
        description: "State key for multi-call hold tracking.",
      },
    },
    allowed_ranges: {
      hold_seconds: "3..10",
      min_stability: "0.2..0.98",
      hold_key: "1..48 chars",
    },
    default_thresholds: {
      hold_seconds: 5,
      min_stability: 0.62,
      hold_key: "default_hold",
    },
    estimated_reliability: "medium",
    limitations: "Requires repeated evaluations using the same hold_key.",
  },
  {
    capability_id: "sequence_check",
    description: "Verify two checks complete in order within a timeout window.",
    required_signals: [],
    required_any_signals: ["person_present", "face_present"],
    optional_signals: ["head_pose_yaw", "motion_state"],
    parameters_schema: {
      first_check: {
        type: "string",
        enum: [
          "presence",
          "gaze_centered",
          "head_turn",
          "hold_still",
          "mouth_open",
          "smile_detected",
        ],
        default: "presence",
        description: "First check capability id.",
      },
      second_check: {
        type: "string",
        enum: [
          "presence",
          "gaze_centered",
          "head_turn",
          "hold_still",
          "mouth_open",
          "smile_detected",
        ],
        default: "head_turn",
        description: "Second check capability id.",
      },
      timeout_seconds: {
        type: "number",
        min: 5,
        max: 30,
        default: 12,
        description: "Maximum time allowed between first and second checks.",
      },
      sequence_id: {
        type: "string",
        minLength: 1,
        maxLength: 48,
        default: "default_sequence",
        description: "State key for multi-call sequence tracking.",
      },
    },
    allowed_ranges: {
      first_check: "presence|gaze_centered|head_turn|hold_still|mouth_open|smile_detected",
      second_check: "presence|gaze_centered|head_turn|hold_still|mouth_open|smile_detected",
      timeout_seconds: "5..30",
      sequence_id: "1..48 chars",
    },
    default_thresholds: {
      first_check: "presence",
      second_check: "head_turn",
      timeout_seconds: 12,
      sequence_id: "default_sequence",
    },
    estimated_reliability: "low",
    limitations: "Requires repeated evaluations using the same sequence_id.",
  },
  {
    capability_id: "rep_counter",
    description: "Heuristic repetition counter for simple motion cycles.",
    required_signals: ["motion_state"],
    optional_signals: ["face_box_area_ratio", "motion_score", "person_present"],
    parameters_schema: {
      rep_type: {
        type: "string",
        enum: ["sit_stand", "squat", "arm_raise"],
        default: "sit_stand",
        description: "Repetition pattern to track.",
      },
      target_reps: {
        type: "number",
        min: 1,
        max: 50,
        default: 5,
        description: "Required repetition count.",
      },
      rep_key: {
        type: "string",
        minLength: 1,
        maxLength: 48,
        default: "default_rep",
        description: "State key for multi-call rep tracking.",
      },
    },
    allowed_ranges: {
      rep_type: "sit_stand|squat|arm_raise",
      target_reps: "1..50",
      rep_key: "1..48 chars",
    },
    default_thresholds: {
      rep_type: "sit_stand",
      target_reps: 5,
      rep_key: "default_rep",
    },
    estimated_reliability: "low",
    limitations: "Heuristic only. Full pose landmarks improve accuracy.",
  },
  {
    capability_id: "attention_state",
    description: "Verify coarse attention state from gaze and motion cues.",
    required_signals: ["person_present", "gaze_direction"],
    optional_signals: ["head_pose_yaw", "motion_state", "framing_stability_score"],
    parameters_schema: {
      expected: {
        type: "string",
        enum: ["present", "looking_away", "distracted"],
        default: "present",
        description: "Expected attention state.",
      },
    },
    allowed_ranges: {
      expected: "present|looking_away|distracted",
    },
    default_thresholds: {
      expected: "present",
    },
    estimated_reliability: "medium",
    limitations: "Attention is inferred from visual proxies, not cognition.",
  },
  {
    capability_id: "camera_quality",
    description: "Verify camera quality thresholds for brightness and sharpness.",
    required_signals: ["brightness", "camera_blur_score"],
    optional_signals: ["inference_status"],
    parameters_schema: {
      min_brightness: {
        type: "number",
        min: 20,
        max: 180,
        default: 40,
        description: "Minimum brightness value.",
      },
      max_brightness: {
        type: "number",
        min: 60,
        max: 245,
        default: 210,
        description: "Maximum brightness value.",
      },
      min_blur_score: {
        type: "number",
        min: 0.05,
        max: 0.95,
        default: 0.22,
        description: "Minimum sharpness proxy score.",
      },
    },
    allowed_ranges: {
      min_brightness: "20..180",
      max_brightness: "60..245",
      min_blur_score: "0.05..0.95",
    },
    default_thresholds: {
      min_brightness: 40,
      max_brightness: 210,
      min_blur_score: 0.22,
    },
    estimated_reliability: "high",
    limitations: "Blur proxy is lightweight and can vary by camera hardware.",
  },
  {
    capability_id: "scene_safety",
    description: "Verify simple scene safety constraints from visibility signals.",
    required_signals: ["faces_detected", "brightness"],
    optional_signals: ["person_present", "face_present"],
    parameters_schema: {
      max_faces: {
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Maximum allowed face count.",
      },
      min_brightness: {
        type: "number",
        min: 10,
        max: 180,
        default: 35,
        description: "Minimum allowed brightness.",
      },
    },
    allowed_ranges: {
      max_faces: "1..4",
      min_brightness: "10..180",
    },
    default_thresholds: {
      max_faces: 1,
      min_brightness: 35,
    },
    estimated_reliability: "medium",
    limitations: "Checks only coarse visual safety conditions.",
  },
  {
    capability_id: "object_interaction_sequence",
    description: "Verify object interaction sequence absent->present->absent.",
    required_signals: [],
    required_any_signals: ["objects", "custom_objects"],
    optional_signals: ["objects_stable"],
    parameters_schema: {
      label: {
        type: "string",
        required: true,
        minLength: 1,
        maxLength: 40,
        description: "Target object label.",
      },
      sequence_id: {
        type: "string",
        minLength: 1,
        maxLength: 48,
        default: "default_object_sequence",
        description: "State key for multi-call sequence tracking.",
      },
      timeout_seconds: {
        type: "number",
        min: 5,
        max: 45,
        default: 20,
        description: "Maximum time to complete the sequence.",
      },
      min_confidence: {
        type: "number",
        min: 0.05,
        max: 0.99,
        default: 0.25,
        description: "Minimum confidence for object presence checks.",
      },
    },
    allowed_ranges: {
      label: "non-empty label",
      sequence_id: "1..48 chars",
      timeout_seconds: "5..45",
      min_confidence: "0.05..0.99",
    },
    default_thresholds: {
      sequence_id: "default_object_sequence",
      timeout_seconds: 20,
      min_confidence: 0.25,
    },
    estimated_reliability: "low",
    limitations: "Sequence depends on repeated evaluations with stable label detection.",
  },
  {
    capability_id: "single_person_only",
    description: "Verify only one person face is in frame.",
    required_signals: ["faces_detected"],
    optional_signals: ["person_present", "face_present"],
    parameters_schema: {
      max_faces: {
        type: "number",
        min: 1,
        max: 2,
        default: 1,
        description: "Maximum allowed faces in frame.",
      },
    },
    allowed_ranges: {
      max_faces: "1..2",
    },
    default_thresholds: {
      max_faces: 1,
    },
    estimated_reliability: "high",
    limitations: "Only face count is checked, not full person segmentation.",
  },
  {
    capability_id: "lighting_quality",
    description: "Verify scene brightness is within a usable range.",
    required_signals: ["brightness"],
    optional_signals: [],
    parameters_schema: {
      min_brightness: {
        type: "number",
        min: 20,
        max: 180,
        default: 40,
        description: "Minimum brightness value.",
      },
      max_brightness: {
        type: "number",
        min: 60,
        max: 245,
        default: 210,
        description: "Maximum brightness value.",
      },
    },
    allowed_ranges: {
      min_brightness: "20..180",
      max_brightness: "60..245",
    },
    default_thresholds: {
      min_brightness: 40,
      max_brightness: 210,
    },
    estimated_reliability: "high",
    limitations: "Extreme dynamic range scenes may require manual tuning.",
  },
  {
    capability_id: "mouth_open",
    description: "Verify mouth open ratio passes threshold.",
    required_signals: ["mouth_open_ratio"],
    optional_signals: ["mouth_open_confidence", "face_present"],
    parameters_schema: {
      min_ratio: {
        type: "number",
        min: 0.08,
        max: 0.5,
        default: 0.18,
        description: "Minimum mouth_open_ratio for pass.",
      },
    },
    allowed_ranges: {
      min_ratio: "0.08..0.5",
    },
    default_thresholds: {
      min_ratio: 0.18,
    },
    estimated_reliability: "medium",
    limitations: "Requires face landmarks to be stable.",
  },
  {
    capability_id: "mouth_closed",
    description: "Verify mouth remains closed below a ratio threshold.",
    required_signals: ["mouth_open_ratio"],
    optional_signals: ["mouth_open_confidence", "face_present"],
    parameters_schema: {
      max_ratio: {
        type: "number",
        min: 0.05,
        max: 0.35,
        default: 0.14,
        description: "Maximum mouth_open_ratio allowed for pass.",
      },
    },
    allowed_ranges: {
      max_ratio: "0.05..0.35",
    },
    default_thresholds: {
      max_ratio: 0.14,
    },
    estimated_reliability: "medium",
    limitations: "Requires stable facial landmark tracking.",
  },
  {
    capability_id: "eyes_open",
    description: "Verify both eyes appear open above threshold.",
    required_signals: ["eye_openness_left", "eye_openness_right"],
    optional_signals: ["face_present"],
    parameters_schema: {
      min_openness: {
        type: "number",
        min: 0.1,
        max: 0.9,
        default: 0.32,
        description: "Minimum openness score per eye.",
      },
    },
    allowed_ranges: {
      min_openness: "0.1..0.9",
    },
    default_thresholds: {
      min_openness: 0.32,
    },
    estimated_reliability: "medium",
    limitations: "Fast blinks can cause transient fails.",
  },
  {
    capability_id: "brow_furrowed",
    description: "Verify brow furrow score passes threshold.",
    required_signals: ["brow_furrow_score"],
    optional_signals: ["face_present"],
    parameters_schema: {
      min_score: {
        type: "number",
        min: 0.1,
        max: 0.95,
        default: 0.45,
        description: "Minimum brow furrow score for pass.",
      },
    },
    allowed_ranges: {
      min_score: "0.1..0.95",
    },
    default_thresholds: {
      min_score: 0.45,
    },
    estimated_reliability: "low",
    limitations: "Expression cues are approximate and lighting sensitive.",
  },
  {
    capability_id: "head_level",
    description: "Verify head roll and pitch stay near level.",
    required_signals: ["head_pose"],
    optional_signals: ["face_present"],
    parameters_schema: {
      max_abs_roll: {
        type: "number",
        min: 2,
        max: 25,
        default: 10,
        description: "Maximum absolute roll in degrees.",
      },
      max_abs_pitch: {
        type: "number",
        min: 3,
        max: 30,
        default: 18,
        description: "Maximum absolute pitch in degrees.",
      },
    },
    allowed_ranges: {
      max_abs_roll: "2..25",
      max_abs_pitch: "3..30",
    },
    default_thresholds: {
      max_abs_roll: 10,
      max_abs_pitch: 18,
    },
    estimated_reliability: "medium",
    limitations: "Extreme camera angles can affect roll and pitch estimates.",
  },
  {
    capability_id: "smile_detected",
    description: "Verify smile score passes threshold.",
    required_signals: ["smile_score"],
    optional_signals: ["face_present"],
    parameters_schema: {
      min_score: {
        type: "number",
        min: 0.2,
        max: 0.95,
        default: 0.55,
        description: "Minimum smile_score for pass.",
      },
    },
    allowed_ranges: {
      min_score: "0.2..0.95",
    },
    default_thresholds: {
      min_score: 0.55,
    },
    estimated_reliability: "low",
    limitations: "Expression score is approximate and lighting-sensitive.",
  },
  {
    capability_id: "clothing_removed",
    description: "Verify a likely clothing removal change in upper or lower region.",
    required_signals: [
      "clothing_change_detected",
      "clothing_change_region",
      "clothing_change_confidence",
      "clothing_baseline_ready",
    ],
    optional_signals: ["person_present", "motion_state"],
    parameters_schema: {
      region: {
        type: "string",
        enum: ["upper", "lower", "either"],
        default: "either",
        description: "Expected clothing removal region.",
      },
      min_confidence: {
        type: "number",
        min: 0.35,
        max: 0.95,
        default: 0.55,
        description: "Minimum confidence required for pass.",
      },
    },
    allowed_ranges: {
      region: "upper|lower|either",
      min_confidence: "0.35..0.95",
    },
    default_thresholds: {
      region: "either",
      min_confidence: 0.55,
    },
    estimated_reliability: "low",
    limitations:
      "Heuristic only. Works best with stable framing and visible torso regions.",
  },
  {
    capability_id: "motion_state",
    description: "Verify global motion state.",
    required_signals: ["motion_state", "motion_score"],
    optional_signals: [],
    parameters_schema: {
      expected: {
        type: "string",
        enum: ["moving", "still"],
        default: "moving",
        description: "Expected motion state.",
      },
      min_score: {
        type: "number",
        min: 0,
        max: 1,
        default: 0.08,
        description: "Minimum motion_score when expected is moving.",
      },
    },
    allowed_ranges: {
      expected: "moving|still",
      min_score: "0..1",
    },
    default_thresholds: {
      expected: "moving",
      min_score: 0.08,
    },
    estimated_reliability: "medium",
    limitations: "Sensitive to background flicker and camera auto-exposure.",
  },
  {
    capability_id: "object_present",
    description: "Verify an object label appears in detections.",
    required_signals: [],
    required_any_signals: ["objects", "custom_objects"],
    optional_signals: ["objects_stable"],
    parameters_schema: {
      label: {
        type: "string",
        required: true,
        minLength: 1,
        maxLength: 40,
        description: "Object label to verify.",
      },
      min_confidence: {
        type: "number",
        min: 0.05,
        max: 0.99,
        default: 0.25,
        description: "Minimum confidence required for pass.",
      },
    },
    allowed_ranges: {
      label: "non-empty label",
      min_confidence: "0.05..0.99",
    },
    default_thresholds: {
      min_confidence: 0.25,
    },
    estimated_reliability: "medium",
    limitations: "Depends on local detector model quality.",
  },
  {
    capability_id: "object_absent",
    description: "Verify an object label is not present above confidence threshold.",
    required_signals: [],
    required_any_signals: ["objects", "custom_objects"],
    optional_signals: ["objects_stable"],
    parameters_schema: {
      label: {
        type: "string",
        required: true,
        minLength: 1,
        maxLength: 40,
        description: "Object label to verify as absent.",
      },
      max_confidence: {
        type: "number",
        min: 0.05,
        max: 0.99,
        default: 0.2,
        description: "Maximum confidence allowed before failing.",
      },
    },
    allowed_ranges: {
      label: "non-empty label",
      max_confidence: "0.05..0.99",
    },
    default_thresholds: {
      max_confidence: 0.2,
    },
    estimated_reliability: "medium",
    limitations: "Depends on local detector quality and object visibility.",
  },
  {
    capability_id: "holding_object",
    description: "Verify the user is holding a labeled object.",
    required_signals: [],
    required_any_signals: ["objects", "custom_objects"],
    optional_signals: ["hand_landmarks"],
    parameters_schema: {
      label: {
        type: "string",
        required: true,
        minLength: 1,
        maxLength: 40,
        description: "Object label to verify.",
      },
      min_confidence: {
        type: "number",
        min: 0.05,
        max: 0.99,
        default: 0.3,
        description: "Minimum confidence required for pass.",
      },
    },
    allowed_ranges: {
      label: "non-empty label",
      min_confidence: "0.05..0.99",
    },
    default_thresholds: {
      min_confidence: 0.3,
    },
    estimated_reliability: "low",
    limitations: "Falls back to object-only heuristic when hand landmarks are unavailable.",
  },
];

type HoldState = {
  startedAt: number;
};

type SequenceState = {
  stage: "await_first" | "await_second";
  firstPassedAt: number;
};

type RepState = {
  count: number;
  phase: "low_seen" | "high_seen";
  lastUpdatedAt: number;
};

type ObjectInteractionState = {
  stage: "await_absent" | "await_present" | "await_absent_final";
  startedAt: number;
};

const TIMED_HOLD_STATE = new Map<string, HoldState>();
const SEQUENCE_STATE = new Map<string, SequenceState>();
const REP_COUNTER_STATE = new Map<string, RepState>();
const OBJECT_INTERACTION_STATE = new Map<string, ObjectInteractionState>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeDetectorStatus(value: unknown): VisionDetectorStatus | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const detectorId =
    typeof record.detector_id === "string" && record.detector_id.trim().length > 0
      ? record.detector_id.trim()
      : "";
  if (!detectorId) {
    return null;
  }
  const lastRunRaw =
    typeof record.last_run_ts === "number"
      ? record.last_run_ts
      : Number(record.last_run_ts);
  const lastRunTs =
    Number.isFinite(lastRunRaw) && lastRunRaw > 0 ? Math.floor(lastRunRaw) : null;
  const supportedSignals = Array.isArray(record.supported_signals)
    ? record.supported_signals
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];
  return {
    detector_id: detectorId,
    enabled: record.enabled === true,
    healthy: record.healthy === true,
    last_run_ts: lastRunTs,
    supported_signals: [...new Set(supportedSignals)],
  };
}

function detectorIndexBySignal(status: VisionSignalsStatus): Map<string, VisionDetectorStatus[]> {
  const map = new Map<string, VisionDetectorStatus[]>();
  for (const detector of status.detectors) {
    for (const signal of detector.supported_signals) {
      const list = map.get(signal) ?? [];
      list.push(detector);
      map.set(signal, list);
    }
  }
  return map;
}

function signalsSet(status: VisionSignalsStatus): Set<string> {
  return new Set(status.signals_available);
}

function cloneCapabilitySchema(
  schema: Record<string, CapabilityParameterSchema>,
): Record<string, CapabilityParameterSchema> {
  const cloned: Record<string, CapabilityParameterSchema> = {};
  for (const [key, value] of Object.entries(schema)) {
    cloned[key] =
      value.type === "string" && Array.isArray(value.enum)
        ? { ...value, enum: [...value.enum] }
        : { ...value };
  }
  return cloned;
}

function normalizeObjectLabelOptions(labels: string[] | undefined): string[] {
  if (!labels) {
    return [];
  }
  return [...new Set(
    labels
      .map((label) => label.trim().toLowerCase())
      .filter((label) => label.length > 0)
      .slice(0, 128),
  )];
}

function capabilityIsSupported(
  definition: CapabilityDefinition,
  availableSignals: Set<string>,
): boolean {
  for (const signal of definition.required_signals) {
    if (!availableSignals.has(signal)) {
      return false;
    }
  }
  if (definition.required_any_signals && definition.required_any_signals.length > 0) {
    const hasAny = definition.required_any_signals.some((signal) =>
      availableSignals.has(signal),
    );
    if (!hasAny) {
      return false;
    }
  }
  return true;
}

export function getVisionSignalsStatus(
  detectorsInput: VisionDetectorStatus[],
): VisionSignalsStatus {
  const detectors = detectorsInput.map((detector) => ({
    detector_id: detector.detector_id,
    enabled: detector.enabled === true,
    healthy: detector.healthy === true,
    last_run_ts:
      typeof detector.last_run_ts === "number" && Number.isFinite(detector.last_run_ts)
        ? Math.floor(detector.last_run_ts)
        : null,
    supported_signals: [...new Set(detector.supported_signals.filter((signal) => signal.trim().length > 0))],
  }));
  const signals = new Set<string>();
  for (const detector of detectors) {
    if (!detector.enabled || !detector.healthy) {
      continue;
    }
    for (const signal of detector.supported_signals) {
      signals.add(signal);
    }
  }
  return {
    detectors,
    signals_available: [...signals].sort((a, b) => a.localeCompare(b)),
  };
}

export function normalizeVisionSignalsStatus(value: unknown): VisionSignalsStatus {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.detectors)) {
    return getVisionSignalsStatus([]);
  }
  const detectors = record.detectors
    .map((entry) => normalizeDetectorStatus(entry))
    .filter((entry): entry is VisionDetectorStatus => entry !== null);
  return getVisionSignalsStatus(detectors);
}

export function inferVisionSignalsStatusFromObservation(
  observation: VisionObservation | null,
): VisionSignalsStatus {
  if (!observation || !observation.camera_available) {
    return getVisionSignalsStatus([]);
  }
  const now = observation.ts;
  const detectors: VisionDetectorStatus[] = [
    {
      detector_id: "face_landmarker",
      enabled: true,
      healthy: observation.inference_status !== "unavailable",
      last_run_ts: now,
      supported_signals: [
        "person_present",
        "face_present",
        "faces_detected",
        "face_bbox",
        "face_box_area_ratio",
        "head_pose_yaw",
        "face_landmarks",
      ],
    },
    {
      detector_id: "facial_cues",
      enabled: true,
      healthy: observation.inference_status !== "unavailable",
      last_run_ts: now,
      supported_signals: [
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
        "brightness",
        "blink_detected_recent",
        "blink_rate_per_min",
        "head_nod_detected_recent",
        "head_shake_detected_recent",
        "framing_stability_score",
        "face_occlusion_score",
        "camera_blur_score",
      ],
    },
    {
      detector_id: "motion",
      enabled: true,
      healthy: true,
      last_run_ts: now,
      supported_signals: ["motion_score", "motion_state"],
    },
    {
      detector_id: "object_detector",
      enabled: true,
      healthy: observation.inference_status === "ok" || observation.inference_status === "limited",
      last_run_ts: now,
      supported_signals: [
        "objects",
        "custom_objects",
        "objects_stable",
        "scene_objects_summary",
        "scene_objects_change",
        "clothing_change_detected",
        "clothing_change_region",
        "clothing_change_confidence",
        "clothing_baseline_ready",
      ],
    },
  ];
  return getVisionSignalsStatus(detectors);
}

export function buildCapabilityCatalog(
  status: VisionSignalsStatus,
  options: { objectLabelOptions?: string[] } = {},
): VerificationCapabilityCatalogEntry[] {
  const availableSignals = signalsSet(status);
  const detectorBySignal = detectorIndexBySignal(status);
  const objectLabelOptions = normalizeObjectLabelOptions(options.objectLabelOptions);
  const entries: VerificationCapabilityCatalogEntry[] = [];

  for (const definition of CAPABILITY_DEFINITIONS) {
    if (!capabilityIsSupported(definition, availableSignals)) {
      continue;
    }
    let healthy = true;
    const requiredSignals = [
      ...definition.required_signals,
      ...(definition.required_any_signals ?? []),
    ];
    for (const signal of requiredSignals) {
      const providers = detectorBySignal.get(signal) ?? [];
      if (providers.length === 0) {
        continue;
      }
      const hasHealthy = providers.some((provider) => provider.enabled && provider.healthy);
      if (!hasHealthy) {
        healthy = false;
        break;
      }
    }
    if (!healthy) {
      continue;
    }
    const parametersSchema = cloneCapabilitySchema(definition.parameters_schema);
    const allowedRanges = { ...definition.allowed_ranges };
    let limitations = definition.limitations;
    if (
      (definition.capability_id === "object_present" ||
        definition.capability_id === "holding_object" ||
        definition.capability_id === "object_absent") &&
      objectLabelOptions.length > 0
    ) {
      const labelSchema = parametersSchema.label;
      if (labelSchema && labelSchema.type === "string") {
        parametersSchema.label = { ...labelSchema, enum: objectLabelOptions };
      }
      allowedRanges.label = objectLabelOptions.join("|");
      limitations = `${limitations} Label list is constrained to runtime catalog values.`;
    }

    entries.push({
      capability_id: definition.capability_id,
      description: definition.description,
      required_signals: definition.required_signals,
      optional_signals: definition.optional_signals,
      parameters_schema: parametersSchema,
      allowed_ranges: allowedRanges,
      default_thresholds: definition.default_thresholds,
      estimated_reliability: definition.estimated_reliability,
      limitations,
    });
  }

  return entries.sort((a, b) => a.capability_id.localeCompare(b.capability_id));
}

function summarizeParamSchema(schema: Record<string, CapabilityParameterSchema>): string {
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return "none";
  }
  return entries
    .map(([key, spec]) => {
      if (spec.type === "number") {
        return `${key}:number(${spec.min}..${spec.max})`;
      }
      if (spec.type === "string") {
        if (spec.enum && spec.enum.length > 0) {
          return `${key}:string(${spec.enum.join("|")})`;
        }
        return `${key}:string`;
      }
      return `${key}:boolean`;
    })
    .join(", ");
}

export function buildCapabilityCatalogPrompt(
  catalog: VerificationCapabilityCatalogEntry[],
): string {
  const lines = ["Supported verification capabilities:"];
  if (catalog.length === 0) {
    lines.push("- none (ask user for a manually confirmable alternative)");
    lines.push("Rule: at most 2 checks per instruction.");
    return lines.join("\n");
  }
  for (const capability of catalog) {
    lines.push(
      `- ${capability.capability_id}: ${capability.description} | params: ${summarizeParamSchema(
        capability.parameters_schema,
      )} | ranges: ${
        Object.entries(capability.allowed_ranges)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ") || "none"
      } | reliability: ${capability.estimated_reliability} | limits: ${capability.limitations}`,
    );
  }
  lines.push("Rule: at most 2 checks per instruction.");
  return lines.join("\n");
}

function normalizeStringParam(
  value: unknown,
  schema: Extract<CapabilityParameterSchema, { type: "string" }>,
): { ok: boolean; value?: string; note?: string } {
  const raw = typeof value === "string" ? value.trim() : "";
  const next = raw || schema.default || "";
  if (!next) {
    if (schema.required) {
      return { ok: false, note: "required string parameter missing" };
    }
    return { ok: true, value: "" };
  }
  if (schema.enum && schema.enum.length > 0 && !schema.enum.includes(next)) {
    if (schema.default && schema.enum.includes(schema.default)) {
      return { ok: true, value: schema.default, note: "enum value reset to default" };
    }
    return { ok: false, note: "string parameter not in allowed enum" };
  }
  if (typeof schema.minLength === "number" && next.length < schema.minLength) {
    return { ok: false, note: "string parameter below minLength" };
  }
  if (typeof schema.maxLength === "number" && next.length > schema.maxLength) {
    return { ok: true, value: next.slice(0, schema.maxLength), note: "string parameter truncated" };
  }
  return { ok: true, value: next };
}

function normalizeNumberParam(
  value: unknown,
  schema: Extract<CapabilityParameterSchema, { type: "number" }>,
): { ok: boolean; value?: number; note?: string } {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    if (typeof schema.default === "number") {
      return { ok: true, value: clamp(schema.default, schema.min, schema.max), note: "number parameter defaulted" };
    }
    if (schema.required) {
      return { ok: false, note: "required numeric parameter missing" };
    }
    return { ok: true, value: schema.min };
  }
  const clamped = clamp(parsed, schema.min, schema.max);
  if (clamped !== parsed) {
    return { ok: true, value: clamped, note: `number parameter clamped to ${clamped}` };
  }
  return { ok: true, value: clamped };
}

function normalizeBooleanParam(
  value: unknown,
  schema: Extract<CapabilityParameterSchema, { type: "boolean" }>,
): { ok: boolean; value?: boolean; note?: string } {
  if (typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof schema.default === "boolean") {
    return { ok: true, value: schema.default, note: "boolean parameter defaulted" };
  }
  if (schema.required) {
    return { ok: false, note: "required boolean parameter missing" };
  }
  return { ok: true, value: false };
}

export function validateCapabilityCheck(
  checkType: string,
  paramsInput: unknown,
  catalog: VerificationCapabilityCatalogEntry[],
): {
  ok: boolean;
  checkType: string;
  params: Record<string, unknown>;
  reason: string | null;
  clampNotes: string[];
} {
  const capability = catalog.find((entry) => entry.capability_id === checkType);
  if (!capability) {
    return {
      ok: false,
      checkType,
      params: {},
      reason: `Unsupported checkType "${checkType}" for current detector catalog.`,
      clampNotes: [],
    };
  }

  const paramsRecord = asRecord(paramsInput) ?? {};
  const normalizedParams: Record<string, unknown> = {};
  const clampNotes: string[] = [];
  for (const [key, schema] of Object.entries(capability.parameters_schema)) {
    if (schema.type === "string") {
      const normalized = normalizeStringParam(paramsRecord[key], schema);
      if (!normalized.ok || typeof normalized.value !== "string") {
        return {
          ok: false,
          checkType,
          params: {},
          reason: `Invalid parameter "${key}" for capability "${checkType}".`,
          clampNotes,
        };
      }
      if (normalized.value.length > 0 || schema.required) {
        normalizedParams[key] = normalized.value;
      }
      if (normalized.note) {
        clampNotes.push(`${key}: ${normalized.note}`);
      }
      continue;
    }
    if (schema.type === "number") {
      const normalized = normalizeNumberParam(paramsRecord[key], schema);
      if (!normalized.ok || typeof normalized.value !== "number") {
        return {
          ok: false,
          checkType,
          params: {},
          reason: `Invalid parameter "${key}" for capability "${checkType}".`,
          clampNotes,
        };
      }
      normalizedParams[key] = normalized.value;
      if (normalized.note) {
        clampNotes.push(`${key}: ${normalized.note}`);
      }
      continue;
    }
    const normalized = normalizeBooleanParam(paramsRecord[key], schema);
    if (!normalized.ok || typeof normalized.value !== "boolean") {
      return {
        ok: false,
        checkType,
        params: {},
        reason: `Invalid parameter "${key}" for capability "${checkType}".`,
        clampNotes,
      };
    }
    normalizedParams[key] = normalized.value;
    if (normalized.note) {
      clampNotes.push(`${key}: ${normalized.note}`);
    }
  }

  return {
    ok: true,
    checkType,
    params: normalizedParams,
    reason: null,
    clampNotes,
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function hasObjectLabel(
  observation: VisionObservation,
  label: string,
  minConfidence: number,
): { matched: boolean; confidence: number } {
  const normalizedLabel = label.toLowerCase();
  const stableMatch = observation.objects_stable.find(
    (item) =>
      item.label.toLowerCase() === normalizedLabel &&
      item.confidence_median >= minConfidence,
  );
  if (stableMatch) {
    return { matched: true, confidence: stableMatch.confidence_median };
  }
  const liveMatch = observation.objects.find(
    (item) =>
      item.label.toLowerCase() === normalizedLabel && item.confidence >= minConfidence,
  );
  if (liveMatch) {
    return { matched: true, confidence: liveMatch.confidence };
  }
  const customMatch = observation.custom_objects.find(
    (item) =>
      item.label.toLowerCase() === normalizedLabel && item.confidence >= minConfidence,
  );
  if (customMatch) {
    return { matched: true, confidence: customMatch.confidence };
  }
  return { matched: false, confidence: 0 };
}

function evaluatePresence(observation: VisionObservation): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.45,
      summary: "Camera is unavailable for presence verification.",
      raw: { camera_available: false },
    };
  }
  const present = observation.person_present || observation.face_present;
  if (present) {
    return {
      status: "pass",
      confidence: 0.82,
      summary: "User is present in frame.",
      raw: {
        person_present: observation.person_present,
        face_present: observation.face_present,
      },
    };
  }
  return {
    status: "fail",
    confidence: 0.18,
    summary: "User is not detected in frame.",
    raw: {
      person_present: observation.person_present,
      face_present: observation.face_present,
    },
  };
}

function evaluateHeadTurn(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Face is not available for head turn verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const direction = asString(params.direction, "either");
  const threshold = asNumber(params.min_abs_yaw, 12);
  const yaw = observation.head_pose.yaw;
  const absYaw = Math.abs(yaw);
  const directionOk =
    direction === "either"
      ? absYaw >= threshold
      : direction === "left"
        ? yaw <= -threshold
        : yaw >= threshold;
  if (directionOk) {
    return {
      status: "pass",
      confidence: 0.78,
      summary: `Head turn verified (${yaw.toFixed(1)} deg yaw).`,
      raw: { yaw, threshold, direction },
    };
  }
  return {
    status: "fail",
    confidence: 0.28,
    summary: `Head turn did not pass threshold (${yaw.toFixed(1)} deg, need ${direction} >= ${threshold}).`,
    raw: { yaw, threshold, direction },
  };
}

function evaluateHoldStill(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Face is not available for hold-still verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const maxAbsYaw = asNumber(params.max_abs_yaw, 9);
  const still = observation.motion_state === "still";
  const yawOk = Math.abs(observation.head_pose.yaw) <= maxAbsYaw;
  if (still && yawOk) {
    return {
      status: "pass",
      confidence: 0.76,
      summary: "Hold-still verification passed.",
      raw: { motion_state: observation.motion_state, yaw: observation.head_pose.yaw, maxAbsYaw },
    };
  }
  return {
    status: "fail",
    confidence: 0.3,
    summary: "Hold-still verification failed due to movement or yaw drift.",
    raw: { motion_state: observation.motion_state, yaw: observation.head_pose.yaw, maxAbsYaw },
  };
}

function evaluateStillnessHold(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Camera is unavailable for stillness verification.",
      raw: { camera_available: false },
    };
  }

  const expected = asString(params.expected_motion, "still");
  const maxScore = asNumber(params.max_score, 0.08);
  const maxAbsYaw = asNumber(params.max_abs_yaw, 12);
  const motionMatches = expected === "still" ? observation.motion_state === "still" : true;
  const scoreMatches = observation.motion_score <= maxScore;
  const yawMatches = !observation.face_present || Math.abs(observation.head_pose.yaw) <= maxAbsYaw;

  if (motionMatches && scoreMatches && yawMatches) {
    return {
      status: "pass",
      confidence: 0.82,
      summary: "Stillness hold passed with low motion.",
      raw: {
        expected_motion: expected,
        motion_state: observation.motion_state,
        motion_score: observation.motion_score,
        max_score: maxScore,
        yaw: observation.head_pose.yaw,
        max_abs_yaw: maxAbsYaw,
      },
    };
  }

  return {
    status: "fail",
    confidence: 0.28,
    summary: "Stillness hold failed due to motion or yaw drift.",
    raw: {
      expected_motion: expected,
      motion_state: observation.motion_state,
      motion_score: observation.motion_score,
      max_score: maxScore,
      yaw: observation.head_pose.yaw,
      max_abs_yaw: maxAbsYaw,
    },
  };
}

function evaluateCenteredInFrame(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_bbox) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Face bounding box is unavailable for centering check.",
      raw: {
        camera_available: observation.camera_available,
        face_bbox_available: observation.face_bbox !== null && observation.face_bbox !== undefined,
      },
    };
  }

  const maxCenterOffset = asNumber(params.max_center_offset, 0.22);
  const centerX = observation.face_bbox.x + observation.face_bbox.width / 2;
  const centerY = observation.face_bbox.y + observation.face_bbox.height / 2;
  const dx = centerX - 0.5;
  const dy = centerY - 0.5;
  const centerOffset = Math.sqrt(dx * dx + dy * dy);
  const passed = centerOffset <= maxCenterOffset;
  const normalizedConfidence = clamp(1 - centerOffset / Math.max(0.01, maxCenterOffset * 1.6), 0, 1);

  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? clamp(0.65 + normalizedConfidence * 0.3, 0, 0.95) : 0.24,
    summary: passed
      ? "Face is centered in frame."
      : "Face is too far from frame center.",
    raw: {
      center_offset: centerOffset,
      max_center_offset: maxCenterOffset,
      center_x: centerX,
      center_y: centerY,
    },
  };
}

function evaluateDistanceOk(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || typeof observation.face_box_area_ratio !== "number") {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Face distance signals are unavailable.",
      raw: {
        camera_available: observation.camera_available,
        face_box_area_ratio: observation.face_box_area_ratio ?? null,
      },
    };
  }

  const minRatio = asNumber(params.min_ratio, 0.06);
  const maxRatio = asNumber(params.max_ratio, 0.35);
  const lower = Math.min(minRatio, maxRatio);
  const upper = Math.max(minRatio, maxRatio);
  const ratio = observation.face_box_area_ratio;
  const passed = ratio >= lower && ratio <= upper;

  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.74 : 0.26,
    summary: passed
      ? "Face distance is within the expected range."
      : "Face distance is outside the expected range.",
    raw: {
      face_box_area_ratio: ratio,
      min_ratio: lower,
      max_ratio: upper,
    },
  };
}

function evaluateGazeCentered(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Face is not available for gaze verification.",
      raw: {
        camera_available: observation.camera_available,
        face_present: observation.face_present,
      },
    };
  }

  const allowedDeviationYaw = asNumber(params.allowed_deviation_yaw, 12);
  const requireGazeCenter = params.require_gaze_center !== false;
  const absYaw = Math.abs(observation.head_pose.yaw);
  const yawPass = absYaw <= allowedDeviationYaw;
  const gazeKnown = observation.gaze_direction !== "unknown";
  const gazePass = !requireGazeCenter || !gazeKnown || observation.gaze_direction === "center";
  const passed = yawPass && gazePass;

  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.72 : 0.3,
    summary: passed ? "Gaze appears centered." : "Gaze is not centered yet.",
    raw: {
      yaw: observation.head_pose.yaw,
      abs_yaw: absYaw,
      allowed_deviation_yaw: allowedDeviationYaw,
      gaze_direction: observation.gaze_direction,
      require_gaze_center: requireGazeCenter,
    },
  };
}

function evaluateEyeContactHold(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  const evaluated = evaluateGazeCentered(observation, params);
  if (evaluated.status === "inconclusive") {
    return evaluated;
  }
  return {
    ...evaluated,
    summary:
      evaluated.status === "pass"
        ? "Eye contact hold verified."
        : "Eye contact hold is not stable yet.",
  };
}

function evaluateBlinkDetected(observation: VisionObservation): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for blink detection.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const detected = observation.blink_detected_recent === true;
  return {
    status: detected ? "pass" : "fail",
    confidence: detected ? 0.78 : 0.22,
    summary: detected ? "Recent blink detected." : "No recent blink detected.",
    raw: {
      blink_detected_recent: observation.blink_detected_recent ?? false,
      blink_rate_per_min: observation.blink_rate_per_min ?? 0,
    },
  };
}

function evaluateBlinkRateRange(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.36,
      summary: "Face is not available for blink rate verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const minRate = asNumber(params.min_rate, 4);
  const maxRate = asNumber(params.max_rate, 35);
  const low = Math.min(minRate, maxRate);
  const high = Math.max(minRate, maxRate);
  const rate = typeof observation.blink_rate_per_min === "number" ? observation.blink_rate_per_min : 0;
  const passed = rate >= low && rate <= high;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.66 : 0.3,
    summary: passed
      ? `Blink rate is in range (${rate.toFixed(1)} per min).`
      : `Blink rate is outside range (${rate.toFixed(1)} per min).`,
    raw: {
      blink_rate_per_min: rate,
      min_rate: low,
      max_rate: high,
    },
  };
}

function evaluateHeadNodDetected(observation: VisionObservation): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for head nod detection.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const detected = observation.head_nod_detected_recent === true;
  return {
    status: detected ? "pass" : "fail",
    confidence: detected ? 0.72 : 0.24,
    summary: detected ? "Recent head nod detected." : "No recent head nod detected.",
    raw: {
      head_nod_detected_recent: observation.head_nod_detected_recent ?? false,
      pitch: observation.head_pose.pitch,
    },
  };
}

function evaluateHeadShakeDetected(observation: VisionObservation): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for head shake detection.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const detected = observation.head_shake_detected_recent === true;
  return {
    status: detected ? "pass" : "fail",
    confidence: detected ? 0.72 : 0.24,
    summary: detected ? "Recent head shake detected." : "No recent head shake detected.",
    raw: {
      head_shake_detected_recent: observation.head_shake_detected_recent ?? false,
      yaw: observation.head_pose.yaw,
    },
  };
}

function evaluateFaceOccluded(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Person is not available for face occlusion verification.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }
  const minScore = asNumber(params.min_score, 0.55);
  const score = typeof observation.face_occlusion_score === "number" ? observation.face_occlusion_score : 0;
  const passed = score >= minScore;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? clamp(Math.max(score, 0.55), 0, 1) : 0.28,
    summary: passed ? "Face occlusion detected." : "Face occlusion not detected.",
    raw: {
      face_occlusion_score: score,
      min_score: minScore,
      face_present: observation.face_present,
      keypoints_confidence: observation.keypoints_confidence,
    },
  };
}

function evaluateFramingStable(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_bbox) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Face bounding box is unavailable for framing stability verification.",
      raw: {
        camera_available: observation.camera_available,
        face_bbox_available: observation.face_bbox !== null && observation.face_bbox !== undefined,
      },
    };
  }
  const minScore = asNumber(params.min_score, 0.62);
  const score =
    typeof observation.framing_stability_score === "number"
      ? observation.framing_stability_score
      : 0;
  const passed = score >= minScore;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? clamp(0.55 + score * 0.35, 0, 0.95) : 0.26,
    summary: passed ? "Framing stability verified." : "Framing is not stable enough.",
    raw: {
      framing_stability_score: score,
      min_score: minScore,
    },
  };
}

function evaluateMotionZone(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_bbox) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Face bounding box is unavailable for zone verification.",
      raw: {
        camera_available: observation.camera_available,
        face_bbox_available: observation.face_bbox !== null && observation.face_bbox !== undefined,
      },
    };
  }

  const zoneX = asNumber(params.zone_x, 0.2);
  const zoneY = asNumber(params.zone_y, 0.1);
  const zoneWidth = asNumber(params.zone_width, 0.6);
  const zoneHeight = asNumber(params.zone_height, 0.8);
  const right = clamp(zoneX + zoneWidth, 0, 1);
  const bottom = clamp(zoneY + zoneHeight, 0, 1);
  const left = clamp(zoneX, 0, 1);
  const top = clamp(zoneY, 0, 1);
  const centerX = observation.face_bbox.x + observation.face_bbox.width / 2;
  const centerY = observation.face_bbox.y + observation.face_bbox.height / 2;
  const inside = centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;

  return {
    status: inside ? "pass" : "fail",
    confidence: inside ? 0.8 : 0.22,
    summary: inside ? "Face center is inside the required zone." : "Face center is outside the required zone.",
    raw: {
      center_x: centerX,
      center_y: centerY,
      zone_x: left,
      zone_y: top,
      zone_width: right - left,
      zone_height: bottom - top,
    },
  };
}

function evaluateHandVisibleLeftRight(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  return {
    status: "inconclusive",
    confidence: 0.4,
    summary: "Hand visibility detection is unavailable until hand landmark signals are enabled.",
    raw: {
      expected: asString(params.expected, "both"),
      camera_available: observation.camera_available,
      requires_signal: "hand_landmarks",
    },
  };
}

function evaluateHandPose(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  return {
    status: "inconclusive",
    confidence: 0.4,
    summary: "Hand pose detection is unavailable until hand pose signals are enabled.",
    raw: {
      expected: asString(params.expected, "open_palm"),
      camera_available: observation.camera_available,
      requires_signal: "hand_pose_label",
    },
  };
}

function evaluateShouldersLevel(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Face is not available for shoulders-level proxy verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const maxAbsRoll = asNumber(params.max_abs_roll, 9);
  const roll = Math.abs(observation.head_pose.roll);
  const passed = roll <= maxAbsRoll;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.71 : 0.29,
    summary: passed ? "Shoulders-level proxy check passed." : "Shoulders-level proxy check failed.",
    raw: {
      roll: observation.head_pose.roll,
      max_abs_roll: maxAbsRoll,
    },
  };
}

function evaluatePostureUpright(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Person is not available for posture verification.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }
  const maxAbsPitch = asNumber(params.max_abs_pitch, 20);
  const maxAbsRoll = asNumber(params.max_abs_roll, 12);
  const requireStill = params.require_still === true;
  const pitchOk = Math.abs(observation.head_pose.pitch) <= maxAbsPitch;
  const rollOk = Math.abs(observation.head_pose.roll) <= maxAbsRoll;
  const stillOk = !requireStill || observation.motion_state === "still";
  const passed = pitchOk && rollOk && stillOk;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.73 : 0.27,
    summary: passed ? "Posture upright check passed." : "Posture upright check failed.",
    raw: {
      pitch: observation.head_pose.pitch,
      roll: observation.head_pose.roll,
      motion_state: observation.motion_state,
      max_abs_pitch: maxAbsPitch,
      max_abs_roll: maxAbsRoll,
      require_still: requireStill,
    },
  };
}

function evaluateBodyInFrameFull(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Person is not available for body framing verification.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }
  const minRatio = asNumber(params.min_face_ratio, 0.015);
  const maxRatio = asNumber(params.max_face_ratio, 0.12);
  const lower = Math.min(minRatio, maxRatio);
  const upper = Math.max(minRatio, maxRatio);
  const ratio = typeof observation.face_box_area_ratio === "number" ? observation.face_box_area_ratio : 0;
  const passed = ratio >= lower && ratio <= upper;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.64 : 0.31,
    summary: passed ? "Body framing proxy check passed." : "Body framing proxy check failed.",
    raw: {
      face_box_area_ratio: ratio,
      min_face_ratio: lower,
      max_face_ratio: upper,
    },
  };
}

function evaluateTimedHoldPass(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Face is not available for timed hold verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const holdSeconds = Math.floor(asNumber(params.hold_seconds, 5));
  const minStability = asNumber(params.min_stability, 0.62);
  const holdKey = asString(params.hold_key, "default_hold").slice(0, 48);
  const stability =
    typeof observation.framing_stability_score === "number"
      ? observation.framing_stability_score
      : 0;
  const holdCondition = observation.motion_state === "still" && stability >= minStability;
  const now = observation.ts;

  if (!holdCondition) {
    TIMED_HOLD_STATE.delete(holdKey);
    return {
      status: "inconclusive",
      confidence: 0.42,
      summary: "Hold conditions are not met yet.",
      raw: {
        hold_key: holdKey,
        motion_state: observation.motion_state,
        framing_stability_score: stability,
        min_stability: minStability,
      },
    };
  }

  const current = TIMED_HOLD_STATE.get(holdKey) ?? { startedAt: now };
  TIMED_HOLD_STATE.set(holdKey, current);
  const elapsedMs = Math.max(0, now - current.startedAt);
  const requiredMs = Math.max(3, Math.min(10, holdSeconds)) * 1000;
  if (elapsedMs >= requiredMs) {
    TIMED_HOLD_STATE.delete(holdKey);
    return {
      status: "pass",
      confidence: 0.78,
      summary: `Timed hold passed (${(elapsedMs / 1000).toFixed(1)}s).`,
      raw: {
        hold_key: holdKey,
        elapsed_ms: elapsedMs,
        required_ms: requiredMs,
      },
    };
  }

  return {
    status: "inconclusive",
    confidence: 0.56,
    summary: `Hold in progress (${(elapsedMs / 1000).toFixed(1)}s/${(requiredMs / 1000).toFixed(1)}s).`,
    raw: {
      hold_key: holdKey,
      elapsed_ms: elapsedMs,
      required_ms: requiredMs,
      framing_stability_score: stability,
    },
  };
}

function evaluateSequenceCheck(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Person is not available for sequence verification.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }

  const first = asString(params.first_check, "presence");
  const second = asString(params.second_check, "head_turn");
  if (first === "sequence_check" || second === "sequence_check") {
    return {
      status: "fail",
      confidence: 0.2,
      summary: "Nested sequence_check is not allowed.",
      raw: { first_check: first, second_check: second },
    };
  }
  const timeoutSeconds = Math.floor(asNumber(params.timeout_seconds, 12));
  const sequenceId = asString(params.sequence_id, `${first}->${second}`).slice(0, 48);
  const timeoutMs = Math.max(5, Math.min(30, timeoutSeconds)) * 1000;
  const now = observation.ts;
  const state = SEQUENCE_STATE.get(sequenceId) ?? { stage: "await_first", firstPassedAt: 0 };

  if (state.stage === "await_first") {
    const firstResult = evaluateCapabilityFromObservation(first, observation, {});
    if (firstResult.status === "pass") {
      SEQUENCE_STATE.set(sequenceId, { stage: "await_second", firstPassedAt: now });
      return {
        status: "inconclusive",
        confidence: 0.58,
        summary: `Sequence step 1 passed (${first}). Awaiting ${second}.`,
        raw: {
          sequence_id: sequenceId,
          stage: "await_second",
          first_check: first,
          second_check: second,
        },
      };
    }
    return {
      status: "inconclusive",
      confidence: 0.45,
      summary: `Waiting for first sequence step (${first}).`,
      raw: {
        sequence_id: sequenceId,
        stage: "await_first",
        first_check: first,
        second_check: second,
      },
    };
  }

  const elapsedMs = Math.max(0, now - state.firstPassedAt);
  if (elapsedMs > timeoutMs) {
    SEQUENCE_STATE.delete(sequenceId);
    return {
      status: "fail",
      confidence: 0.26,
      summary: `Sequence timeout before ${second}.`,
      raw: {
        sequence_id: sequenceId,
        elapsed_ms: elapsedMs,
        timeout_ms: timeoutMs,
      },
    };
  }

  const secondResult = evaluateCapabilityFromObservation(second, observation, {});
  if (secondResult.status === "pass") {
    SEQUENCE_STATE.delete(sequenceId);
    return {
      status: "pass",
      confidence: 0.74,
      summary: `Sequence passed (${first} then ${second}).`,
      raw: {
        sequence_id: sequenceId,
        elapsed_ms: elapsedMs,
        first_check: first,
        second_check: second,
      },
    };
  }

  return {
    status: "inconclusive",
    confidence: 0.5,
    summary: `Sequence awaiting second step (${second}).`,
    raw: {
      sequence_id: sequenceId,
      elapsed_ms: elapsedMs,
      timeout_ms: timeoutMs,
      first_check: first,
      second_check: second,
    },
  };
}

function evaluateRepCounter(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.38,
      summary: "Person is not available for repetition counting.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }

  const repType = asString(params.rep_type, "sit_stand");
  const targetReps = Math.max(1, Math.floor(asNumber(params.target_reps, 5)));
  const repKey = asString(params.rep_key, "default_rep").slice(0, 48);
  const now = observation.ts;
  const state = REP_COUNTER_STATE.get(repKey) ?? {
    count: 0,
    phase: "low_seen",
    lastUpdatedAt: now,
  };

  const metric =
    repType === "arm_raise"
      ? observation.motion_score
      : typeof observation.face_box_area_ratio === "number"
        ? observation.face_box_area_ratio
        : 0;
  const lowThreshold = repType === "arm_raise" ? 0.04 : 0.07;
  const highThreshold = repType === "arm_raise" ? 0.16 : 0.11;
  if (metric <= lowThreshold) {
    state.phase = "low_seen";
  } else if (metric >= highThreshold && state.phase === "low_seen") {
    state.phase = "high_seen";
    state.count += 1;
  }
  state.lastUpdatedAt = now;
  REP_COUNTER_STATE.set(repKey, state);

  if (state.count >= targetReps) {
    REP_COUNTER_STATE.delete(repKey);
    return {
      status: "pass",
      confidence: 0.66,
      summary: `Rep target reached (${state.count}/${targetReps}).`,
      raw: {
        rep_key: repKey,
        rep_type: repType,
        count: state.count,
        target_reps: targetReps,
      },
    };
  }

  return {
    status: "inconclusive",
    confidence: 0.5,
    summary: `Rep progress ${state.count}/${targetReps}.`,
    raw: {
      rep_key: repKey,
      rep_type: repType,
      count: state.count,
      target_reps: targetReps,
      metric,
    },
  };
}

function evaluateAttentionState(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.36,
      summary: "Person is not available for attention-state verification.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }

  const expected = asString(params.expected, "present");
  const gazeAway =
    observation.gaze_direction === "left" ||
    observation.gaze_direction === "right" ||
    Math.abs(observation.head_pose.yaw) > 15;
  const unstable =
    observation.motion_state === "moving" &&
    (typeof observation.framing_stability_score === "number"
      ? observation.framing_stability_score < 0.45
      : false);
  const observed = gazeAway ? "looking_away" : unstable ? "distracted" : "present";
  const passed = observed === expected;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.7 : 0.3,
    summary: passed
      ? `Attention state matched (${observed}).`
      : `Attention state mismatch (observed=${observed}, expected=${expected}).`,
    raw: {
      expected,
      observed,
      gaze_direction: observation.gaze_direction,
      yaw: observation.head_pose.yaw,
      motion_state: observation.motion_state,
      framing_stability_score: observation.framing_stability_score ?? 0,
    },
  };
}

function evaluateCameraQuality(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Camera is unavailable for quality verification.",
      raw: { camera_available: false },
    };
  }

  const minBrightness = asNumber(params.min_brightness, 40);
  const maxBrightness = asNumber(params.max_brightness, 210);
  const minBlurScore = asNumber(params.min_blur_score, 0.22);
  const lower = Math.min(minBrightness, maxBrightness);
  const upper = Math.max(minBrightness, maxBrightness);
  const brightness = typeof observation.brightness === "number" ? observation.brightness : 0;
  const blur = typeof observation.camera_blur_score === "number" ? observation.camera_blur_score : 0;
  const brightnessOk = brightness >= lower && brightness <= upper;
  const blurOk = blur >= minBlurScore;
  const passed = brightnessOk && blurOk;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.85 : 0.22,
    summary: passed ? "Camera quality is acceptable." : "Camera quality is below threshold.",
    raw: {
      brightness,
      min_brightness: lower,
      max_brightness: upper,
      camera_blur_score: blur,
      min_blur_score: minBlurScore,
    },
  };
}

function evaluateSceneSafety(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Camera is unavailable for scene safety checks.",
      raw: { camera_available: false },
    };
  }

  const maxFaces = Math.max(1, Math.floor(asNumber(params.max_faces, 1)));
  const minBrightness = asNumber(params.min_brightness, 35);
  const faces =
    typeof observation.faces_detected === "number" && Number.isFinite(observation.faces_detected)
      ? Math.max(0, Math.floor(observation.faces_detected))
      : observation.face_present
        ? 1
        : 0;
  const brightness = typeof observation.brightness === "number" ? observation.brightness : 0;
  const facesOk = faces <= maxFaces;
  const brightnessOk = brightness >= minBrightness;
  const passed = facesOk && brightnessOk;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.76 : 0.24,
    summary: passed ? "Scene safety checks passed." : "Scene safety checks failed.",
    raw: {
      faces_detected: faces,
      max_faces: maxFaces,
      brightness,
      min_brightness: minBrightness,
    },
  };
}

function evaluateObjectInteractionSequence(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Camera is unavailable for object interaction sequence.",
      raw: { camera_available: false },
    };
  }
  const label = asString(params.label, "");
  if (!label) {
    return {
      status: "fail",
      confidence: 0.2,
      summary: "Object interaction sequence requires a label parameter.",
      raw: {},
    };
  }
  const sequenceId = asString(params.sequence_id, `objseq:${label}`).slice(0, 48);
  const timeoutSeconds = Math.floor(asNumber(params.timeout_seconds, 20));
  const timeoutMs = Math.max(5, Math.min(45, timeoutSeconds)) * 1000;
  const minConfidence = asNumber(params.min_confidence, 0.25);
  const now = observation.ts;
  const present = hasObjectLabel(observation, label, minConfidence).matched;
  const state = OBJECT_INTERACTION_STATE.get(sequenceId) ?? {
    stage: "await_absent",
    startedAt: now,
  };

  if (now - state.startedAt > timeoutMs) {
    OBJECT_INTERACTION_STATE.delete(sequenceId);
    return {
      status: "fail",
      confidence: 0.24,
      summary: "Object interaction sequence timed out.",
      raw: {
        sequence_id: sequenceId,
        label,
        timeout_ms: timeoutMs,
      },
    };
  }

  if (state.stage === "await_absent") {
    if (!present) {
      state.stage = "await_present";
      OBJECT_INTERACTION_STATE.set(sequenceId, state);
      return {
        status: "inconclusive",
        confidence: 0.55,
        summary: `Sequence started. Show ${label}.`,
        raw: { sequence_id: sequenceId, stage: state.stage, label },
      };
    }
    OBJECT_INTERACTION_STATE.set(sequenceId, state);
    return {
      status: "inconclusive",
      confidence: 0.44,
      summary: `Waiting for ${label} to be absent before sequence start.`,
      raw: { sequence_id: sequenceId, stage: state.stage, label },
    };
  }

  if (state.stage === "await_present") {
    if (present) {
      state.stage = "await_absent_final";
      OBJECT_INTERACTION_STATE.set(sequenceId, state);
      return {
        status: "inconclusive",
        confidence: 0.6,
        summary: `Detected ${label}. Remove it from frame.`,
        raw: { sequence_id: sequenceId, stage: state.stage, label },
      };
    }
    OBJECT_INTERACTION_STATE.set(sequenceId, state);
    return {
      status: "inconclusive",
      confidence: 0.46,
      summary: `Waiting for ${label} to appear.`,
      raw: { sequence_id: sequenceId, stage: state.stage, label },
    };
  }

  if (!present) {
    OBJECT_INTERACTION_STATE.delete(sequenceId);
    return {
      status: "pass",
      confidence: 0.7,
      summary: `Object interaction sequence completed for ${label}.`,
      raw: { sequence_id: sequenceId, label },
    };
  }

  OBJECT_INTERACTION_STATE.set(sequenceId, state);
  return {
    status: "inconclusive",
    confidence: 0.5,
    summary: `Waiting for ${label} to leave frame.`,
    raw: { sequence_id: sequenceId, stage: state.stage, label },
  };
}

function evaluateSinglePersonOnly(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Camera is unavailable for face count verification.",
      raw: { camera_available: false },
    };
  }

  const maxFaces = Math.max(1, Math.floor(asNumber(params.max_faces, 1)));
  const facesDetected =
    typeof observation.faces_detected === "number" && Number.isFinite(observation.faces_detected)
      ? Math.max(0, Math.floor(observation.faces_detected))
      : observation.face_present
        ? 1
        : 0;
  const passed = facesDetected >= 1 && facesDetected <= maxFaces;

  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.84 : 0.2,
    summary: passed
      ? "Single person face check passed."
      : `Face count check failed (faces=${facesDetected}).`,
    raw: {
      faces_detected: facesDetected,
      max_faces: maxFaces,
    },
  };
}

function evaluateLightingQuality(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || typeof observation.brightness !== "number") {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Brightness data is unavailable.",
      raw: {
        camera_available: observation.camera_available,
        brightness: observation.brightness ?? null,
      },
    };
  }

  const minBrightness = asNumber(params.min_brightness, 40);
  const maxBrightness = asNumber(params.max_brightness, 210);
  const lower = Math.min(minBrightness, maxBrightness);
  const upper = Math.max(minBrightness, maxBrightness);
  const brightness = observation.brightness;
  const passed = brightness >= lower && brightness <= upper;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.86 : 0.2,
    summary: passed
      ? "Lighting quality is within the expected range."
      : `Lighting quality is outside range (${brightness.toFixed(1)}).`,
    raw: {
      brightness,
      min_brightness: lower,
      max_brightness: upper,
    },
  };
}

function evaluateMouthOpen(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for mouth-open verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const threshold = asNumber(params.min_ratio, 0.18);
  const passed = observation.mouth_open_ratio >= threshold;
  if (passed) {
    return {
      status: "pass",
      confidence: clamp(observation.mouth_open_confidence, 0, 1),
      summary: `Mouth open verified (ratio=${observation.mouth_open_ratio.toFixed(3)}).`,
      raw: {
        mouth_open_ratio: observation.mouth_open_ratio,
        mouth_open_confidence: observation.mouth_open_confidence,
        threshold,
      },
    };
  }
  return {
    status: "fail",
    confidence: 0.25,
    summary: `Mouth open threshold not reached (ratio=${observation.mouth_open_ratio.toFixed(3)}).`,
    raw: {
      mouth_open_ratio: observation.mouth_open_ratio,
      mouth_open_confidence: observation.mouth_open_confidence,
      threshold,
    },
  };
}

function evaluateMouthClosed(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for mouth-closed verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const threshold = asNumber(params.max_ratio, 0.14);
  const passed = observation.mouth_open_ratio <= threshold;
  if (passed) {
    return {
      status: "pass",
      confidence: clamp(Math.max(observation.mouth_open_confidence, 0.55), 0, 1),
      summary: `Mouth closed verified (ratio=${observation.mouth_open_ratio.toFixed(3)}).`,
      raw: {
        mouth_open_ratio: observation.mouth_open_ratio,
        mouth_open_confidence: observation.mouth_open_confidence,
        threshold,
      },
    };
  }
  return {
    status: "fail",
    confidence: 0.25,
    summary: `Mouth-closed threshold exceeded (ratio=${observation.mouth_open_ratio.toFixed(3)}).`,
    raw: {
      mouth_open_ratio: observation.mouth_open_ratio,
      mouth_open_confidence: observation.mouth_open_confidence,
      threshold,
    },
  };
}

function evaluateEyesOpen(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.36,
      summary: "Face is not available for eyes-open verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }

  const minOpenness = asNumber(params.min_openness, 0.32);
  const leftPass = observation.eye_openness_left >= minOpenness;
  const rightPass = observation.eye_openness_right >= minOpenness;
  const passed = leftPass && rightPass;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.73 : 0.27,
    summary: passed
      ? "Eyes-open verification passed."
      : "Eyes-open verification failed.",
    raw: {
      eye_openness_left: observation.eye_openness_left,
      eye_openness_right: observation.eye_openness_right,
      min_openness: minOpenness,
    },
  };
}

function evaluateBrowFurrowed(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for brow verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }

  const threshold = asNumber(params.min_score, 0.45);
  const passed = observation.brow_furrow_score >= threshold;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.66 : 0.3,
    summary: passed
      ? `Brow furrow verified (score=${observation.brow_furrow_score.toFixed(2)}).`
      : `Brow furrow score below threshold (${observation.brow_furrow_score.toFixed(2)}).`,
    raw: {
      brow_furrow_score: observation.brow_furrow_score,
      threshold,
    },
  };
}

function evaluateHeadLevel(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Face is not available for head-level verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }

  const maxAbsRoll = asNumber(params.max_abs_roll, 10);
  const maxAbsPitch = asNumber(params.max_abs_pitch, 18);
  const roll = Math.abs(observation.head_pose.roll);
  const pitch = Math.abs(observation.head_pose.pitch);
  const passed = roll <= maxAbsRoll && pitch <= maxAbsPitch;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.74 : 0.26,
    summary: passed
      ? "Head level verification passed."
      : "Head level verification failed.",
    raw: {
      roll: observation.head_pose.roll,
      pitch: observation.head_pose.pitch,
      max_abs_roll: maxAbsRoll,
      max_abs_pitch: maxAbsPitch,
    },
  };
}

function evaluateSmile(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.face_present) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Face is not available for smile verification.",
      raw: { camera_available: observation.camera_available, face_present: observation.face_present },
    };
  }
  const threshold = asNumber(params.min_score, 0.55);
  const passed = observation.smile_score >= threshold;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.68 : 0.32,
    summary: passed
      ? `Smile verified (score=${observation.smile_score.toFixed(2)}).`
      : `Smile score below threshold (${observation.smile_score.toFixed(2)}).`,
    raw: {
      smile_score: observation.smile_score,
      threshold,
    },
  };
}

function evaluateMotionState(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Camera is unavailable for motion verification.",
      raw: { camera_available: false },
    };
  }
  const expected = asString(params.expected, "moving");
  const minScore = asNumber(params.min_score, 0.08);
  const stateMatches =
    expected === "still"
      ? observation.motion_state === "still"
      : observation.motion_state === "moving" && observation.motion_score >= minScore;
  return {
    status: stateMatches ? "pass" : "fail",
    confidence: stateMatches ? 0.72 : 0.3,
    summary: stateMatches
      ? `Motion state verified as ${observation.motion_state}.`
      : `Motion state mismatch. observed=${observation.motion_state}.`,
    raw: {
      expected,
      motion_state: observation.motion_state,
      motion_score: observation.motion_score,
      minScore,
    },
  };
}

function evaluateClothingRemoved(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available || !observation.person_present) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Person is not available for clothing change verification.",
      raw: {
        camera_available: observation.camera_available,
        person_present: observation.person_present,
      },
    };
  }
  if (!observation.clothing_baseline_ready) {
    return {
      status: "inconclusive",
      confidence: 0.46,
      summary: "Clothing baseline is still warming up.",
      raw: {
        clothing_baseline_ready: observation.clothing_baseline_ready,
      },
    };
  }

  const expectedRegion = asString(params.region, "either");
  const minConfidence = asNumber(params.min_confidence, 0.55);
  const detected = observation.clothing_change_detected;
  const observedRegion = observation.clothing_change_region;
  const confidence = clamp(observation.clothing_change_confidence, 0, 1);
  const regionMatches =
    expectedRegion === "either" ||
    observedRegion === expectedRegion ||
    observedRegion === "unknown";

  if (detected && regionMatches && confidence >= minConfidence) {
    return {
      status: "pass",
      confidence,
      summary:
        observedRegion === "unknown"
          ? "Possible clothing removal detected."
          : `Possible clothing removal detected in ${observedRegion} region.`,
      raw: {
        expected_region: expectedRegion,
        observed_region: observedRegion,
        confidence,
        min_confidence: minConfidence,
        clothing_summary: observation.clothing_change_summary,
      },
    };
  }

  return {
    status: "fail",
    confidence: detected ? Math.max(0.2, confidence) : 0.2,
    summary: detected
      ? `Clothing change did not meet requested region or confidence (observed=${observedRegion}).`
      : "No clothing removal change detected.",
    raw: {
      expected_region: expectedRegion,
      observed_region: observedRegion,
      confidence,
      min_confidence: minConfidence,
      clothing_summary: observation.clothing_change_summary,
    },
  };
}

function evaluateObjectPresent(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Camera is unavailable for object verification.",
      raw: { camera_available: false },
    };
  }
  const label = asString(params.label, "");
  if (!label) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Object label is required for object_present.",
      raw: { label },
    };
  }
  const minConfidence = asNumber(params.min_confidence, 0.25);
  const matched = hasObjectLabel(observation, label, minConfidence);
  return {
    status: matched.matched ? "pass" : "fail",
    confidence: matched.matched ? clamp(matched.confidence, 0.4, 0.95) : 0.24,
    summary: matched.matched
      ? `Object "${label}" verified in frame.`
      : `Object "${label}" not detected above confidence threshold.`,
    raw: { label, min_confidence: minConfidence, matched_confidence: matched.confidence },
  };
}

function evaluateObjectAbsent(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation.camera_available) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "Camera is unavailable for object absence verification.",
      raw: { camera_available: false },
    };
  }
  const label = asString(params.label, "");
  if (!label) {
    return {
      status: "inconclusive",
      confidence: 0.35,
      summary: "Object label is required for object_absent.",
      raw: { label },
    };
  }
  const maxConfidence = asNumber(params.max_confidence, 0.2);
  const matched = hasObjectLabel(observation, label, maxConfidence);
  const passed = !matched.matched;
  return {
    status: passed ? "pass" : "fail",
    confidence: passed ? 0.79 : 0.24,
    summary: passed
      ? `Object "${label}" is absent above confidence threshold.`
      : `Object "${label}" is still present.`,
    raw: { label, max_confidence: maxConfidence, matched_confidence: matched.confidence },
  };
}

function evaluateHoldingObject(
  observation: VisionObservation,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  const objectEval = evaluateObjectPresent(observation, params);
  if (objectEval.status !== "pass") {
    return objectEval;
  }
  return {
    status: "inconclusive",
    confidence: 0.58,
    summary:
      'Object is present, but "holding_object" is heuristic-only because hand landmarks are unavailable.',
    raw: {
      ...objectEval.raw,
      hand_landmarks_available: false,
    },
  };
}

export function evaluateCapabilityFromObservation(
  checkType: string,
  observation: VisionObservation | null,
  params: Record<string, unknown>,
): CapabilityEvaluation {
  if (!observation) {
    return {
      status: "inconclusive",
      confidence: 0.4,
      summary: "No observation available for verification.",
      raw: {},
    };
  }
  const normalizedCheckType = checkType === "user_present" ? "presence" : checkType;
  if (normalizedCheckType === "presence") {
    return evaluatePresence(observation);
  }
  if (normalizedCheckType === "head_turn") {
    return evaluateHeadTurn(observation, params);
  }
  if (normalizedCheckType === "hold_still") {
    return evaluateHoldStill(observation, params);
  }
  if (normalizedCheckType === "stillness_hold") {
    return evaluateStillnessHold(observation, params);
  }
  if (normalizedCheckType === "centered_in_frame") {
    return evaluateCenteredInFrame(observation, params);
  }
  if (normalizedCheckType === "distance_ok") {
    return evaluateDistanceOk(observation, params);
  }
  if (normalizedCheckType === "gaze_centered") {
    return evaluateGazeCentered(observation, params);
  }
  if (normalizedCheckType === "eye_contact_hold") {
    return evaluateEyeContactHold(observation, params);
  }
  if (normalizedCheckType === "blink_detected") {
    return evaluateBlinkDetected(observation);
  }
  if (normalizedCheckType === "blink_rate_range") {
    return evaluateBlinkRateRange(observation, params);
  }
  if (normalizedCheckType === "head_nod_detected") {
    return evaluateHeadNodDetected(observation);
  }
  if (normalizedCheckType === "head_shake_detected") {
    return evaluateHeadShakeDetected(observation);
  }
  if (normalizedCheckType === "face_occluded") {
    return evaluateFaceOccluded(observation, params);
  }
  if (normalizedCheckType === "framing_stable") {
    return evaluateFramingStable(observation, params);
  }
  if (normalizedCheckType === "motion_zone") {
    return evaluateMotionZone(observation, params);
  }
  if (normalizedCheckType === "hand_visible_left_right") {
    return evaluateHandVisibleLeftRight(observation, params);
  }
  if (normalizedCheckType === "hand_pose") {
    return evaluateHandPose(observation, params);
  }
  if (normalizedCheckType === "shoulders_level") {
    return evaluateShouldersLevel(observation, params);
  }
  if (normalizedCheckType === "posture_upright") {
    return evaluatePostureUpright(observation, params);
  }
  if (normalizedCheckType === "body_in_frame_full") {
    return evaluateBodyInFrameFull(observation, params);
  }
  if (normalizedCheckType === "timed_hold_pass") {
    return evaluateTimedHoldPass(observation, params);
  }
  if (normalizedCheckType === "sequence_check") {
    return evaluateSequenceCheck(observation, params);
  }
  if (normalizedCheckType === "rep_counter") {
    return evaluateRepCounter(observation, params);
  }
  if (normalizedCheckType === "attention_state") {
    return evaluateAttentionState(observation, params);
  }
  if (normalizedCheckType === "camera_quality") {
    return evaluateCameraQuality(observation, params);
  }
  if (normalizedCheckType === "scene_safety") {
    return evaluateSceneSafety(observation, params);
  }
  if (normalizedCheckType === "object_interaction_sequence") {
    return evaluateObjectInteractionSequence(observation, params);
  }
  if (normalizedCheckType === "single_person_only") {
    return evaluateSinglePersonOnly(observation, params);
  }
  if (normalizedCheckType === "lighting_quality") {
    return evaluateLightingQuality(observation, params);
  }
  if (normalizedCheckType === "mouth_open") {
    return evaluateMouthOpen(observation, params);
  }
  if (normalizedCheckType === "mouth_closed") {
    return evaluateMouthClosed(observation, params);
  }
  if (normalizedCheckType === "eyes_open") {
    return evaluateEyesOpen(observation, params);
  }
  if (normalizedCheckType === "brow_furrowed") {
    return evaluateBrowFurrowed(observation, params);
  }
  if (normalizedCheckType === "head_level") {
    return evaluateHeadLevel(observation, params);
  }
  if (normalizedCheckType === "smile_detected") {
    return evaluateSmile(observation, params);
  }
  if (normalizedCheckType === "motion_state") {
    return evaluateMotionState(observation, params);
  }
  if (normalizedCheckType === "clothing_removed") {
    return evaluateClothingRemoved(observation, params);
  }
  if (normalizedCheckType === "object_present") {
    return evaluateObjectPresent(observation, params);
  }
  if (normalizedCheckType === "object_absent") {
    return evaluateObjectAbsent(observation, params);
  }
  if (normalizedCheckType === "holding_object") {
    return evaluateHoldingObject(observation, params);
  }
  return {
    status: "inconclusive",
    confidence: 0.5,
    summary: `Capability "${checkType}" is not supported by this evaluator.`,
    raw: { checkType },
  };
}
