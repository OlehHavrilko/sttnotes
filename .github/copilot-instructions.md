# Copilot instructions for STTNotes

## Project scope

STTNotes is an offline-first Windows Electron desktop app using vanilla JavaScript. Keep the core local: notes, recordings, attachments, model files, backups, and plugins must not be sent to cloud services. Do not claim real-time transcription or configured integrations when the local runtime or credentials are unavailable; expose a clear disabled or actionable error state instead.

## Build, test, and run

- Install dependencies: `npm install`
- Run the app: `npm start`
- Run the full test suite: `npm test`
- Run one test file: `node --test test/plugin-manager.test.js` or `node --test test/logger.test.js`
- Build Windows NSIS and portable artifacts: `npm run build`
- Build outputs are written to `dist/`; verify the expected versioned installer and portable artifacts exist after a successful build.

For changes that affect packaging, Windows process execution, microphone capture, model downloads, or installer behavior, distinguish static/local verification from behavior that requires a Windows runtime. Do not report a build or feature as verified solely because code inspection succeeded.

## Architecture

- `src/main.js` owns the Electron main process, `sql.js` persistence, migrations and backups, filesystem paths, model/engine downloads, local Whisper process invocation, attachments, workspace import/export, and IPC handlers.
- `src/preload.js` is the context-isolated, minimal IPC bridge. Renderer code must use this API rather than Node or Electron APIs directly.
- `src/renderer.js` and `src/index.html` implement the notes workspace, dialogs, recording controls, model manager, settings, plugins, and local-only status/error UI.
- `src/styles.css` contains the application styling.
- `src/plugin-manager.js` validates and manages per-user local plugins. Plugins are disabled on install, use explicit capabilities, and must not receive direct renderer Node access.
- Notes are stored in SQLite under Electron `userData`; legacy JSON migration, timestamped migration backups, rotating database backups, and encrypted `.sttnx` workspace transfer are handled by the main process.
- Recordings are captured with renderer `MediaRecorder`, saved through IPC under `userData/recordings`, and passed to a configured local Whisper executable only after recording stops.

## Required implementation workflow

1. Break broad requests into milestones and keep each milestone’s scope explicit. Preserve existing functionality and offline guarantees while changing only the necessary files.
2. Before changing model, recording, or settings behavior, trace the complete IPC contract from renderer call to preload exposure to main handler, including payload names and return/error shapes.
3. For Model Manager changes, verify both success and failure paths: explicit download initiation, redirects, partial-download cleanup, extraction, executable/model detection, progress, cancellation, and actionable errors. Model weights alone are not an executable engine.
4. After each substantial milestone, run the narrowest relevant tests first, then `npm test`; run `npm run build` for packaging or main-process changes. Record what was actually exercised and what still requires Windows hardware/runtime validation.
5. Treat user-visible “ready” or “installed” states as claims that require real filesystem/process checks. Never use fake success, silent fallbacks, or swallowed errors for model, transcription, plugin, backup, or integration operations.
6. When debugging regressions, first stabilize the existing flow and compare the public IPC/API surface with its callers before adding new features. Avoid repeatedly expanding the scope of a large debugging pass.

## Conventions and safety boundaries

- Keep `contextIsolation: true` and `nodeIntegration: false`; add narrowly scoped preload methods instead of exposing arbitrary IPC or filesystem access.
- Validate IPC inputs in the main process. Keep filesystem operations confined to the appropriate `userData` subdirectory and preserve existing path validation and attachment restrictions.
- Use the existing `sql.js` schema and migration pattern for persistence changes. Back up data before migrations or restore operations and preserve recoverability.
- Keep model downloads explicitly user initiated. Downloads install local model assets only; transcription remains local.
- Update `README.md` or `docs/PLUGIN_API.md` when behavior or plugin contracts change, and describe limitations honestly.
- Do not modify unrelated directories or remove tests to make a change pass.
