from __future__ import annotations

import importlib.util
import io
import json
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = "127.0.0.1"
PORT = 7002
PIPER_INSTALL_COMMAND = "python -m pip install -U piper-tts"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
VOICE_MODEL_PATH = (
    REPO_ROOT
    / "tools"
    / "tts"
    / "models"
    / "en_US"
    / "libritts_r"
    / "medium"
    / "en_US-libritts_r-medium.onnx"
)

VOICE: Any | None = None
VOICE_LOAD_ERROR: str | None = None


def _ensure_model_file() -> None:
    if VOICE_MODEL_PATH.exists():
        return
    raise RuntimeError(
        f"Model file is missing: {VOICE_MODEL_PATH}. "
        "Run .\\tools\\tts\\download-voices.ps1 first."
    )


def _ensure_piper_installed() -> None:
    if importlib.util.find_spec("piper") is not None:
        return
    raise RuntimeError(
        "Python package 'piper-tts' is not installed. "
        f"Install it with: {PIPER_INSTALL_COMMAND}"
    )


def load_voice_once() -> Any:
    global VOICE, VOICE_LOAD_ERROR

    if VOICE is not None:
        return VOICE

    if VOICE_LOAD_ERROR is not None:
        raise RuntimeError(VOICE_LOAD_ERROR)

    try:
        _ensure_model_file()
        _ensure_piper_installed()
        from piper import PiperVoice  # type: ignore

        VOICE = PiperVoice.load(str(VOICE_MODEL_PATH))
        return VOICE
    except Exception as exc:  # pylint: disable=broad-exception-caught
        message = str(exc)
        VOICE_LOAD_ERROR = message
        raise RuntimeError(message) from exc


def synthesize_wav_bytes(text: str) -> bytes:
    voice = load_voice_once()
    data = b""
    last_error: Exception | None = None

    # Preferred path: generate WAV in-memory using wave + BytesIO.
    try:
        buffer = io.BytesIO()
        if hasattr(voice, "synthesize_wav"):
            with wave.open(buffer, "wb") as wav_file:
                voice.synthesize_wav(text, wav_file)
            data = buffer.getvalue()
    except Exception as exc:  # pylint: disable=broad-exception-caught
        last_error = exc

    # Compatibility fallback for piper-tts variants that expect a binary stream.
    if not data:
        try:
            buffer = io.BytesIO()
            if hasattr(voice, "synthesize_wav"):
                voice.synthesize_wav(text, buffer)
                data = buffer.getvalue()
            elif hasattr(voice, "synthesize"):
                with wave.open(buffer, "wb") as wav_file:
                    voice.synthesize(text, wav_file)
                data = buffer.getvalue()
        except Exception as exc:  # pylint: disable=broad-exception-caught
            last_error = exc

    if not data:
        if last_error is not None:
            raise RuntimeError(
                f"piper-tts synthesis failed: {last_error}. "
                f"Install/upgrade with: {PIPER_INSTALL_COMMAND}"
            ) from last_error
        raise RuntimeError("piper-tts generated empty audio output.")
    return data


class TtsHandler(BaseHTTPRequestHandler):
    server_version = "RavenPiperTTS/2.0"

    def _send_json(self, status_code: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_wav(self, wav_bytes: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.end_headers()
        self.wfile.write(wav_bytes)

    def do_POST(self) -> None:
        if self.path != "/speak":
            self._send_json(404, {"error": "Not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Invalid content length."})
            return

        if content_length <= 0:
            self._send_json(400, {"error": "Request body is required."})
            return

        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return

        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            self._send_json(400, {"error": "Field 'text' is required."})
            return

        try:
            wav_bytes = synthesize_wav_bytes(text.strip())
        except Exception as exc:  # pylint: disable=broad-exception-caught
            message = str(exc)
            if "piper-tts" not in message and "Model file is missing" not in message:
                message = f"{message} Install/upgrade dependency with: {PIPER_INSTALL_COMMAND}"
            self._send_json(500, {"error": message})
            return

        self._send_wav(wav_bytes)

    def do_GET(self) -> None:
        if self.path == "/health":
            if VOICE_LOAD_ERROR:
                self._send_json(500, {"ok": False, "error": VOICE_LOAD_ERROR})
                return
            self._send_json(200, {"ok": True, "modelPath": str(VOICE_MODEL_PATH)})
            return
        self._send_json(404, {"error": "Not found."})

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        print(f"[tts-server] {self.address_string()} {message}")


def main() -> None:
    try:
        load_voice_once()
    except Exception as exc:  # pylint: disable=broad-exception-caught
        print(f"Failed to initialize Piper voice: {exc}")
        raise SystemExit(1) from exc

    server = ThreadingHTTPServer((HOST, PORT), TtsHandler)
    print(f"Piper TTS server listening on http://{HOST}:{PORT}")
    print(f"Model path: {VOICE_MODEL_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
