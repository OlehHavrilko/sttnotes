# STTNotes

Offline-first Windows desktop MVP built with Electron and vanilla JavaScript (no cloud APIs).

## Setup
1. Install Node.js 18+.
2. `npm install`
3. `npm start`
4. `npm run build` creates versioned NSIS and portable Windows artifacts in `dist/`.

## Offline model setup
Use **Install / Select model directory** in the Model Manager and choose a local folder containing a Whisper executable (`whisper-cli.exe` or similar) and model files (`.bin`, `.gguf`, `.pt`, `.onnx`, or `.safetensors`). The app scans and remembers that directory and uses the discovered local executable for transcription. There are no cloud downloads or fallback network calls. A fully offline first run requires models bundled into the installer or imported from a local directory; models are not silently fetched.

## Architecture
Electron main process owns a SQLite database (`notes.sqlite`) in Electron's userData directory and exposes a minimal context-isolated IPC API. On upgrade, the prior `notes.json` is copied to a timestamped backup before migration. Notes, folders, and version history remain local. The renderer provides note CRUD, full-text-style local search, Markdown preview, tags, `[[wiki links]]`, backlinks-ready links, recording controls, model selection, and settings. Audio is never uploaded or sent to a network service.

Record uses the renderer's microphone permission and `MediaRecorder`, then sends the audio bytes over isolated IPC into the app's `userData/recordings` directory. No audio leaves the machine. Transcribe invokes the configured local Whisper executable with `-m <model> -f <audio> -otxt`; missing paths, startup failures, and non-zero exits are shown as explicit errors. The app does not claim real-time transcription: the installed engine is invoked after recording stops.

## Notes workspace
Folders, Markdown editing/preview, local media attachments, drag-and-drop, drawing capture, note deletion, command palette (Ctrl/Cmd+K), version history/restore, light/dark theme, tags, and wiki links are available. Attachments and drawings are copied into the app's local userData attachments directory; no cloud services are used.

## Model Manager and settings
The Models dialog installs supported Whisper model files into the app's local `models` directory. Downloads are only model installation; transcription is always performed locally. A compatible `whisper-cli.exe` must still be bundled or selected because model weights alone are not an executable engine. Settings persist audio format, language, push-to-talk state/key, and reset controls. Hold the configured key (Space by default) while outside text inputs to record; clicking Record remains available.

## Plugins and integrations
The **Plugins** manager installs local folders or ZIP files under the per-user `plugins` directory, validates manifests and paths, and supports enable/disable/remove. The core remains fully offline by default; plugins are disabled on install and renderer Node access is never exposed. Capability declarations are explicit and restricted. Optional GitHub, Google Drive, calendar, Telegram, and Discord adapters are intentionally stubs: they remain offline/disabled until you configure your own OAuth client, token, or webhook URL. See `docs/PLUGIN_API.md` and `examples/hello-local`.

## Backups, encrypted transfer, and local AI
The Backup dialog creates rotating local SQLite snapshots (the last 20 are retained), lists them for restore, and can export/import an encrypted `.sttnx` workspace. AES-256-GCM is used with a passphrase; losing the passphrase makes the export unrecoverable. Restore restarts the app after validating the selected snapshot.

Local AI is an explicit, disabled-by-default provider boundary. Ollama, LM Studio, and OpenAI-compatible **localhost** endpoints are reserved for a future configured provider; STTNotes never falls back to a cloud endpoint. OCR and post-processing similarly expose no fake result: media previews work locally, while OCR/transcription require a configured local executable.

The portable build keeps Electron's user data beside the executable according to Electron Builder's portable runtime behavior. Installer metadata and artifacts are versioned from `package.json`; update by installing the newer version or replacing the portable directory after checking the release notes.
