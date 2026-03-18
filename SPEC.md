Raven is a local-only browser app that provides an interactive session experience using:
1) a local LLM (Ollama) for dialogue
2) webcam-based checks to confirm user actions
3) optional device control via Intiface Central + Buttplug
4) a 3D avatar (VRM) to make Raven feel real

Core user stories
1) User can open Raven locally and configure endpoints (LLM, vision, Intiface).
2) User can chat with the local LLM.
3) User can enable webcam and Raven can perform structured checks with clear pass/fail reasons.
4) User can load a local VRM model and see the avatar animate.
5) User can connect to Intiface and see devices.
6) Any device action requires explicit consent and obeys strict safety limits.
7) Emergency stop always works instantly.

Non-functional requirements
1) Local-only. No telemetry.
2) Safe by default. Visible state and controls.
3) Clean UI, easy debugging, clear logs.
4) Must run well on Windows and in Chrome.