const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const CAPS = new Set(['notes.read', 'notes.write', 'ui.panel', 'commands', 'network', 'oauth', 'webhooks', 'calendar']);
function safePath(root, candidate) {
  const resolved = path.resolve(root, candidate);
  return resolved === path.resolve(root) || resolved.startsWith(path.resolve(root) + path.sep);
}
function validateManifest(m) {
  if (!m || !ID.test(m.id) || typeof m.name !== 'string' || !m.name.trim() || typeof m.version !== 'string') throw new Error('Invalid plugin manifest.');
  const capabilities = Array.isArray(m.capabilities) ? m.capabilities : [];
  if (capabilities.some(x => typeof x !== 'string' || !CAPS.has(x))) throw new Error('Plugin requests an unsupported capability.');
  return { id: m.id, name: m.name.slice(0, 120), version: m.version.slice(0, 40), description: String(m.description || '').slice(0, 500), capabilities, main: typeof m.main === 'string' ? m.main : 'index.js', panel: m.panel ? String(m.panel) : null };
}
function createPluginManager(app, ipcMain, dialog) {
  const root = path.join(app.getPath('userData'), 'plugins');
  const stateFile = path.join(root, 'state.json');
  const state = () => { try { const x = JSON.parse(fs.readFileSync(stateFile, 'utf8')); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
  const saveState = x => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(x, null, 2)); };
  function list() {
    fs.mkdirSync(root, { recursive: true }); const s = state(); const result = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && ID.test(e.name)) {
      try { const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(root, e.name, 'manifest.json'), 'utf8'))); result.push({ ...manifest, enabled: s[e.name]?.enabled === true, path: path.join(root, e.name) }); } catch {}
    }
    return result;
  }
  function install(source) {
    if (typeof source !== 'string' || !fs.existsSync(source)) throw new Error('Plugin source was not found.');
    const staging = path.join(root, `.install-${crypto.randomUUID()}`); fs.mkdirSync(staging, { recursive: true });
    try {
      if (fs.statSync(source).isDirectory()) fs.cpSync(source, staging, { recursive: true });
      else if (/\.zip$/i.test(source)) {
        const p = require('child_process').spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `Expand-Archive -LiteralPath '${source.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`], { windowsHide: true });
        if (p.status !== 0) throw new Error('Could not extract plugin archive.');
      } else throw new Error('Choose a plugin folder or .zip archive.');
      let dir = staging;
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) { const children = fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory()); if (children.length === 1) dir = path.join(dir, children[0].name); }
      const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
      if (!safePath(staging, manifest.main) || manifest.panel && !safePath(staging, manifest.panel)) throw new Error('Plugin paths must stay inside the plugin directory.');
      const target = path.join(root, manifest.id); fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(dir, target);
      const s = state(); s[manifest.id] = { enabled: false, settings: {} }; saveState(s); return manifest;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  ipcMain.handle('plugins:list', () => list());
  ipcMain.handle('plugins:chooseInstall', async () => { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Plugin package', extensions: ['zip'] }] }); return r.canceled ? null : install(r.filePaths[0]); });
  ipcMain.handle('plugins:chooseFolderInstall', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return r.canceled ? null : install(r.filePaths[0]); });
  ipcMain.handle('plugins:setEnabled', (_, id, enabled) => { if (!ID.test(id)) throw new Error('Invalid plugin ID.'); const s = state(); s[id] = { ...(s[id] || {}), enabled: !!enabled }; saveState(s); return list(); });
  ipcMain.handle('plugins:remove', (_, id) => { if (!ID.test(id)) throw new Error('Invalid plugin ID.'); fs.rmSync(path.join(root, id), { recursive: true, force: true }); const s = state(); delete s[id]; saveState(s); return list(); });
  ipcMain.handle('plugins:getState', () => ({ directory: root, plugins: list(), offline: true }));
  return { list };
}
module.exports = { createPluginManager };
