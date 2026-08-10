# Plugin API

Plugins are local packages in `%APPDATA%\Nemotron Notes\plugins`. Each package has a
`manifest.json` with `id` (lowercase validated), `name`, `version`, optional `main`,
`panel`, and `capabilities`. Supported capabilities are `notes.read`,
`notes.write`, `ui.panel`, `commands`, `network`, `oauth`, `webhooks`, and `calendar`.
Plugins are disabled after installation and the offline core never loads network
adapters automatically. Renderer code cannot access Node or Electron; future plugin
IPC must be allowlisted by capability and validate every payload.

Example:

```json
{"id":"hello-local","name":"Hello Local","version":"1.0.0","capabilities":["ui.panel"],"main":"index.js"}
```

Built-in optional adapter stubs (GitHub, Google Drive, Calendar, Telegram, Discord)
must remain disabled/offline until the user supplies OAuth client data, tokens, or
webhook URLs. No credentials are bundled.
