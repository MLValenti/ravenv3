# Raven (Local-Only)

Raven runs fully local on Windows 11 and binds to `127.0.0.1` only.

## Prereqs

- Node.js 20+
- npm 10+
- Python 3.10+
- Ollama running on `http://127.0.0.1:11434`

## Install

```powershell
npm install
```

## Piper LibriTTS setup (local, free)

1. Download model files:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\tts\download-voices.ps1
```

2. Install `piper-tts` into your current Python (no PATH edits):

```powershell
python -m pip install -U piper-tts
```

3. Start local Piper TTS server (`127.0.0.1:7002`):

```powershell
python .\tools\tts\server.py
```

4. Start Raven:

```powershell
npm run dev
```

5. Open Raven settings:

- `http://127.0.0.1:3000/settings`
- Set:
  - `TTS provider`: `piper`
  - `Piper URL`: `http://127.0.0.1:7002`
  - `Piper voice model path`: `tools/tts/models/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx` (server uses this repo model path)

## Test `/api/tts`

Run this while Raven dev server is running:

```powershell
Invoke-WebRequest `
  -Method POST `
  -Uri "http://127.0.0.1:3000/api/tts" `
  -ContentType "application/json" `
  -Body '{"text":"Raven online. Stand still and look forward."}' `
  -OutFile ".\raven-tts-test.wav"
```

Then play `.\raven-tts-test.wav`.

Directly test the local TTS server (`/speak`):

```powershell
Invoke-WebRequest `
  -Method POST `
  -Uri "http://127.0.0.1:7002/speak" `
  -ContentType "application/json" `
  -Body '{"text":"Raven local TTS check."}' `
  -OutFile ".\piper-direct-test.wav"
```

## Runtime behavior

- `/api/tts` is blocked when Emergency Stop is enabled (`403`)
- Piper URL is validated to localhost/loopback only
- Session/avatar Raven output uses:
  - Piper via `/api/tts` when provider is `piper`
  - browser speech synthesis as fallback if Piper is unavailable
- Emergency Stop cancels current speech immediately

## Long-term memory

Raven now uses an approval-based memory system that persists across sessions in local SQLite storage.

Storage location:

- `raven-memory.sqlite` in the project root (or `RAVEN_DB_FILE` override)

Memory records:

- `memories`: approved active memories with key, value, type, tags, confidence, importance, stability, and source metadata
- `memory_suggestions`: pending or decided suggestions with status `pending | approved | rejected`
- `memory_preferences`: auto save toggles and suggestion snooze timestamp
- `session_summaries`: compact per-session summary text (max 800 chars)

Suggestion behavior:

- Suggestions are created only for high-value stable facts.
- Duplicate active facts are ignored.
- Rejected key and value pairs are snoozed for 30 days.
- If a key already exists with a new value, suggestion kind is marked as update.
- Suggestion frequency adapts by favoring higher-importance candidates after repeated rejects.

Approval mode:

- Open `http://127.0.0.1:3000/profile` and use the **Memory Panel**.
- Pending suggestions are shown with a badge count.
- You can edit suggestion key, value, type, and tags before approving.
- You can reject suggestions with optional feedback.
- You can toggle auto save by category: goals, constraints, preferences.
- You can snooze suggestions for this session window or 24 hours.

### Memory commands in session

- `remember: <text>` creates a pending suggestion immediately
- `forget: <key or phrase>` asks for confirmation
- `forget confirm: <key or phrase>` deletes matching memories
- `show memories` lists active saved memories

### Memory management UI

Open `http://127.0.0.1:3000/profile` and use the **Memory Panel** to:

- view saved memories
- edit key, value, type, tags, and active state
- delete single memories
- approve or reject pending suggestions
- run forget-by-phrase
- delete all memories and summaries

Every `/api/chat` turn injects a compact memory block (capped to 10 lines) into prompt context:

- approved active memories grouped by type
- last session summary when available

## Task system and progression

Raven sessions now support persistent tasks with deadlines, repeat counts, evidence requirements, points, and tier progression.

Task model highlights:

- `status`: `active | completed | failed | expired | cancelled`
- `repeats_required` and `repeats_completed`
- `evidence_policy`:
  - `type`: `camera | manual | mixed`
  - camera checks from the runtime vision capability catalog
  - `max_attempts`
  - `deny_user_override` for camera required tasks
- `schedule_policy`:
  - `type`: `one_time | daily`
  - one time: `window_seconds`
  - daily: `start_date`, `end_date`, `days`, `occurrences_per_day`, `allow_make_up`
  - optional `per_repeat_timeout_seconds`
- `reward_plan` and `consequence_plan`:
  - validated against app-controlled catalogs
  - approval status per plan: `pending | approved | auto_approved | rejected`

Occurrences and evidence records:

- each task creates occurrences
- occurrence status: `pending | completed | missed | verified_failed`
- evidence records are stored per occurrence
- evidence type: `camera | manual | file_upload`
- each record includes status, confidence, summary, and local raw metadata

Points and tiers:

- points are awarded when task completion is confirmed
- tiers are app controlled:
  - bronze: 0+
  - silver: 50+
  - gold: 150+
  - platinum: 300+
- rewards and consequences are app defined and shown in the Tasks panel

### Task APIs

- `GET /api/tasks`
- `POST /api/tasks` actions:
  - `create`
  - `record_attempt`
  - `approve_plan`
  - `set_preferences`
  - `switch_evidence`
  - `cancel`
  - `delete_all`

Catalog configuration:

- reward and consequence catalogs are defined in `lib/tasks/system.ts`
- update `TASK_REWARD_CATALOG` and `TASK_CONSEQUENCE_CATALOG` to change allowed ids and parameter limits

### Task behavior in session

- Raven can create tasks through structured `create_task` JSON.
- The app validates task JSON and downgrades unsupported camera checks to manual evidence when needed.
- The app validates reward and consequence catalog ids and replaces invalid ids with safe defaults.
- Typing `done` does not count for camera only tasks when `deny_user_override` is true.
- If camera is unavailable:
  - `mixed` tasks can use one manual confirmation per occurrence
  - `camera` tasks require explicit evidence mode switch before manual counting
- Daily tasks can span multiple days and track per-day occurrences.
- Missed occurrences are marked automatically after deadline.
- Task completion applies reward plan and base points.
- Task failure applies consequence plan and records an outcome event.
- Typing `show tasks` shows active task progress summary.
- Typing `switch task evidence manual` switches the active task evidence policy.

### Session UI

Open `http://127.0.0.1:3000/session` and use **Tasks and Progress**:

- points and current tier
- active tasks with countdown, schedule, reward, consequence, and evidence policy
- occurrence list with status and deadline
- outcome events list for applied rewards and consequences
- recent task history
- approval toggle: require reward and consequence approval
- per-task buttons to approve pending reward and consequence plans
- debug create form for manual task creation
- quick actions:
  - refresh
  - count current occurrence
  - switch active task to manual evidence
  - cancel task

## Intiface device control (local only)

Raven can connect to Intiface over local websocket and run validated device commands through a guarded internal API.

### Start Intiface and connect

1. Start Intiface Central (desktop app) and run a websocket server on `ws://localhost:12345`.
2. Start Raven:

```powershell
npm run dev
```

3. Open `http://127.0.0.1:3000/session`.
4. Open the `Devices` panel, enable `Show devices panel`, then click `Connect`.
5. Enable `Allow Raven device action execution` only when you want device actions to run.

### Device API routes

- `GET /api/devices/status`
- `POST /api/devices/connect` with body `{ "url": "ws://localhost:12345" }`
- `POST /api/devices/disconnect`
- `GET /api/devices/list`
- `POST /api/devices/command` with body:

```json
{
  "type": "device_command",
  "device_id": "1",
  "command": "vibrate",
  "params": { "intensity": 0.4, "duration_ms": 1500 },
  "opt_in": true
}
```

- `POST /api/devices/stop`

### Raven device action format

Raven requests device actions using a single JSON schema:

```json
{
  "type": "device_command",
  "device_id": "0",
  "command": "vibrate",
  "params": {
    "intensity": 0.3,
    "duration_ms": 1500
  }
}
```

Supported commands:

- `vibrate`
- `rotate`
- `linear`
- `stop`
- `stop_all`

Rules:

- JSON can be inside a fenced `json` code block in Raven output.
- `device_id` accepts string or number for per-device commands.
- `stop_all` does not require `device_id`.
- Values are clamped to valid ranges and duration is bounded.

Session Devices panel includes per-device `Test vibrate 1s` buttons that call the same `/api/devices/command` route used by Raven action execution.

### Safety behavior

- Commands are local only and require `ws://localhost` or `ws://127.0.0.1`.
- `intensity`, `speed`, and `position` are clamped to `0..1`.
- Duration is bounded and commands are rate limited.
- Emergency Stop blocks `/api/devices/command` and also sends stop all to active devices.

## Vision perception layer

Raven injects structured local observations into each LLM call:

- person presence and pose label (`unknown` fallback when posture model is unavailable)
- motion score and moving or still state with hysteresis
- stable object list with multi-frame consensus
- facial cues from landmarks: mouth open state, smile, brow furrow, eye openness, head pose, gaze direction
- scene summary and scene object change summary

Privacy and safety for facial cues:

- no identity recognition
- no face embeddings
- no image persistence in app storage
- local-only inference from the active webcam stream

Current object detection stack:

- `@mediapipe/tasks-vision` ObjectDetector
- EfficientDet Lite `.tflite` model in `public/models`
- letterbox preprocessing to model input resolution
- confidence filtering, class-aware NMS, and top-K pruning
- rolling stable object tracker (default window `8`, minimum frames `3`)

### Object model setup

Download a higher quality local model (default `efficientdet_lite2`) into `public/models`:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\vision\download-object-model.ps1 -Variant efficientdet_lite2
```

Optional variants:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\vision\download-object-model.ps1 -Variant efficientdet_lite0
powershell -ExecutionPolicy Bypass -File .\tools\vision\download-object-model.ps1 -Variant efficientdet_lite4
```

### Object detection config

Set in `.env.local` (all optional):

```powershell
OBJECT_MODEL=/models/efficientdet_lite2.tflite
OBJECT_CONFIDENCE_THRESHOLD=0.25
OBJECT_NMS_IOU_THRESHOLD=0.50
OBJECT_TOPK=50
OBJECT_INPUT_RESOLUTION=640
OBJECT_FPS=2
OBJECT_STABLE_WINDOW=8
OBJECT_STABLE_MIN_FRAMES=3
FACE_CUES_FPS=5
MOUTH_OPEN_THRESHOLD=0.18
VOICE_AUTO_SEND=true
VOICE_MIN_CHARS=2
```

Use `NEXT_PUBLIC_` versions of these names if you want to expose explicit client overrides.

### Calibration debug mode

- `/camera` page:
  - toggle `Object Boxes Overlay` to verify bounding box alignment
  - toggle `Debug Overlay` to show face box, mouth ratio and expression scores
  - view raw, post-threshold, and post-NMS counts
  - view stable objects with counts and median confidence
  - view mouth open, smile, brow, eye openness, head pose, gaze direction, facial fps
- `/session` page:
  - enable `Vision debug panel`
  - optionally enable `Object boxes overlay` for live alignment checks

### Microphone toggle mode

Session page now uses a microphone toggle instead of push to talk.

- Enable microphone to keep speech recognition running hands free.
- Disable microphone to stop recognition immediately.
- Indicator near the input shows `Listening`, `Enabled (reconnecting)`, or `Mic off`.
- Keyboard shortcuts:
  - `M` toggles microphone on or off
  - `Escape` turns microphone off

Voice transcript behavior:

- `VOICE_AUTO_SEND=true` sends final transcripts automatically (default).
- `VOICE_MIN_CHARS=2` minimum transcript length before send.
- If `VOICE_AUTO_SEND=false`, transcript is placed in input and waits for `Save Response`.

### Fix model 404

If you see `Failed to fetch model: /models/efficientdet_lite2.tflite (404)`, download a local model:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\vision\download-object-model.ps1 -Variant efficientdet_lite2
```

Then restart `npm run dev`.

## LLM session back and forth eval harness

You can run a local multi-turn evaluator that uses:

- a simulated user LLM
- Raven through real `/api/chat`
- a judge LLM that scores each turn

All calls stay local on loopback URLs.

Start prerequisites first:

```powershell
npm run dev
```

```powershell
ollama serve
```

Run evaluator:

```powershell
npm run eval:session
```

If your local dev server is not already running, use:

```powershell
npm run eval:session:local
```

Optional environment overrides:

```powershell
$env:RAVEN_EVAL_APP_CHAT_URL="http://127.0.0.1:3000/api/chat"
$env:RAVEN_EVAL_OLLAMA_URL="http://127.0.0.1:11434"
$env:RAVEN_EVAL_RAVEN_MODEL="dolphin-llama3:8b"
$env:RAVEN_EVAL_USER_MODEL="dolphin-llama3:8b"
$env:RAVEN_EVAL_JUDGE_MODEL="dolphin-llama3:8b"
$env:RAVEN_EVAL_TIMEOUT_MS="30000"
$env:RAVEN_EVAL_SCENARIOS="game_wager_followthrough"
$env:RAVEN_EVAL_MAX_TURNS="3"
$env:RAVEN_EVAL_DIRECT_ROUTE="true"
npm run eval:session
```

The script prints per-turn transcript, judge checks, hard failure flags, and a summary score.
It exits non-zero when average score is too low or hard failures are detected.

## Existing routes

- `http://127.0.0.1:3000/camera`
- `http://127.0.0.1:3000/session`
- `http://127.0.0.1:3000/avatar`
- `http://127.0.0.1:3000/profile`
- `http://127.0.0.1:3000/consent`
- `http://127.0.0.1:3000/settings`

`/chat` now redirects to `/session`. Session is the only conversational UI.
