const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { createPluginManager } = require('./plugin-manager');
const store = () => path.join(app.getPath('userData'), 'notes.json');
const attachmentDir = () => path.join(app.getPath('userData'), 'attachments');
function readNotes() { try { const value = JSON.parse(fs.readFileSync(store(), 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; } }
function writeNotes(notes) {
  if (!Array.isArray(notes) || notes.length > 10000) throw new Error('Invalid notes data.');
  const clean = notes.map(n => ({ id: String(n.id || Date.now()), title: String(n.title || '').slice(0, 1000), body: String(n.body || '').slice(0, 1000000), folder: String(n.folder || 'Inbox').slice(0, 200), updated: Number(n.updated) || Date.now(), attachments: Array.isArray(n.attachments) ? n.attachments.filter(isAttachmentPath).slice(0, 1000) : [] }));
  fs.mkdirSync(path.dirname(store()), { recursive: true }); fs.writeFileSync(store(), JSON.stringify(clean, null, 2), 'utf8');
}
function isAttachmentPath(file) {
  if (typeof file !== 'string') return false;
  const root = path.resolve(attachmentDir()) + path.sep;
  return path.resolve(file).startsWith(root);
}
function scanModelDir(dir) {
  if (!dir || !fs.existsSync(dir)) return { directory: dir || '', executable: '', models: [] };
  const files = fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? scanModelDir(path.join(dir, e.name)).models.map(x => path.join(e.name, x)) : [e.name]);
  const executable = files.find(f => /(^|[\\/])(whisper|whisper-cli|main)(\.exe)?$/i.test(f) || /whisper.*\.exe$/i.test(f)) || '';
  const models = files.filter(f => /\.(bin|gguf|pt|onnx|safetensors)$/i.test(f));
  return { directory: dir, executable: executable ? path.join(dir, executable) : '', models };
}
const modelCatalog = [
  { id: 'base-en', name: 'Whisper base (English)', file: 'ggml-base.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' },
  { id: 'tiny-en', name: 'Whisper tiny (English)', file: 'ggml-tiny.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin' }
];
const engineUrl = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip';
function installEngine(event) {
  const root = path.join(app.getPath('userData'), 'models'), dir = path.join(root, 'engine'), zip = path.join(root, 'engine-download.zip');
  fs.mkdirSync(root, { recursive: true }); try { if (fs.existsSync(zip)) fs.unlinkSync(zip); } catch {}
  return new Promise((resolve, reject) => {
    const get = url => https.get(url, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location);
      if (r.statusCode !== 200) return reject(new Error(`Engine download failed (${r.statusCode}). Official package URL may have changed.`));
      const total = Number(r.headers['content-length']) || 0; let done = 0; const out = fs.createWriteStream(zip);
      r.on('data', c => { done += c.length; event.sender.send('models:progress', { id: 'engine', progress: total ? done / total : 0 }); });
      r.pipe(out); out.on('finish', () => { out.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
        const p = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`], { windowsHide: true });
        p.on('close', code => { try { fs.unlinkSync(zip); } catch {} if (code !== 0) return reject(new Error('Could not extract the engine package.')); let found = ''; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d,e.name); if (e.isDirectory()) walk(f); else if (e.name.toLowerCase() === 'whisper-cli.exe') found = f; } }; walk(dir); found ? resolve({ executable: found, directory: dir }) : reject(new Error('The official package did not contain whisper-cli.exe.')); });
      }); out.on('error', e => { try { fs.unlinkSync(zip); } catch {} reject(e); });
    }); get(engineUrl).on('error', e => { try { if (fs.existsSync(zip)) fs.unlinkSync(zip); } catch {} reject(e); });
  });
}
function downloadModel({ id }, event) {
  const item = modelCatalog.find(x => x.id === id); if (!item) throw new Error('Unknown model.');
  const dir = path.join(app.getPath('userData'), 'models'); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, item.file);
  return new Promise((resolve, reject) => {
    const request = https.get(item.url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) return https.get(response.headers.location, r => r.pipe(fs.createWriteStream(target))).on('error', reject);
      if (response.statusCode !== 200) return reject(new Error(`Model download failed (${response.statusCode}).`));
      const total = Number(response.headers['content-length']) || 0; let done = 0;
      const out = fs.createWriteStream(target); response.on('data', chunk => { done += chunk.length; event.sender.send('models:progress', { id, progress: total ? done / total : 0 }); });
      response.pipe(out); out.on('finish', () => { out.close(); resolve({ ...item, path: target }); }); out.on('error', reject);
    }); request.on('error', reject);
  });
}
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800, minWidth: 980, minHeight: 620, backgroundColor: '#0d1117', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }});
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => {
  createPluginManager(app, ipcMain, dialog);
  ipcMain.handle('notes:list', () => readNotes());
  ipcMain.handle('notes:save', (_, notes) => { writeNotes(notes); return true; });
  ipcMain.handle('notes:deleteAttachment', (_, file) => { if (isAttachmentPath(file) && fs.existsSync(file)) fs.unlinkSync(file); return true; });
  ipcMain.handle('attachment:save', (_, { data, name }) => {
    if (typeof data !== 'string' || data.length > 50 * 1024 * 1024) throw new Error('Invalid attachment data.');
    const dir = attachmentDir(); fs.mkdirSync(dir, { recursive: true });
    const safe = `${Date.now()}-${String(name || 'attachment').replace(/[^\w.\-]/g, '_')}`;
    const file = path.join(dir, safe); fs.writeFileSync(file, Buffer.from(data, 'base64')); return file;
  });
  ipcMain.handle('attachment:copy', (_, source) => {
    if (typeof source !== 'string' || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Attachment file was not found.');
    const dir = attachmentDir(); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${path.basename(source).replace(/[^\w.\-]/g, '_')}`); fs.copyFileSync(source, file); return file;
  });
  ipcMain.handle('attachment:open', async () => { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Media', extensions: ['png','jpg','jpeg','gif','webp','mp4','webm','mov'] }] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('file:open', async () => { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio or text', extensions: ['txt','md','wav','mp3','m4a','ogg'] }] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('file:readText', (_, file) => { try { if (typeof file !== 'string' || !fs.statSync(file).isFile() || !/\.(txt|md)$/i.test(file)) return ''; return fs.readFileSync(file, 'utf8').slice(0, 1000000); } catch { return ''; } });
  ipcMain.handle('audio:save', (_, { data, extension = 'webm' }) => {
    if (!data || typeof data !== 'string') throw new Error('No audio data was provided.');
    const dir = path.join(app.getPath('userData'), 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    if (!/^(webm|wav|mp3|m4a|ogg)$/i.test(extension)) throw new Error('Unsupported audio format.');
    const file = path.join(dir, `recording-${Date.now()}.${extension.toLowerCase()}`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  });
  ipcMain.handle('models:choose', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled) return null;
    return scanModelDir(r.filePaths[0]);
  });
  ipcMain.handle('models:scan', (_, dir) => typeof dir === 'string' ? scanModelDir(dir) : { directory: '', executable: '', models: [] });
  ipcMain.handle('models:download', (event, payload) => downloadModel(payload, event));
  ipcMain.handle('models:installEngine', event => installEngine(event));
  ipcMain.handle('transcribe:run', (_, { executable, audioPath, model }) => new Promise((resolve, reject) => {
    if (!executable) return reject(new Error('No local Whisper executable is configured. Set its full path in Settings.'));
    if (!audioPath || !fs.existsSync(audioPath)) return reject(new Error('The recording file does not exist.'));
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) return reject(new Error(`Configured Whisper executable was not found: ${executable}`));
    if (model && (!fs.existsSync(model) || !fs.statSync(model).isFile())) return reject(new Error('Configured Whisper model was not found.'));
    const child = spawn(executable, ['-m', model || 'base', '-f', audioPath, '-otxt'], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', e => reject(new Error(`Could not start local Whisper: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`Local Whisper exited with code ${code}: ${err.trim() || 'no error details'}`)));
  }));
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
