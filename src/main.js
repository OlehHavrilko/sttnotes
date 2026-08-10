const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { createPluginManager } = require('./plugin-manager');
const { createLogger } = require('./logger');
const store = () => path.join(app.getPath('userData'), 'notes.sqlite');
const legacyStore = () => path.join(app.getPath('userData'), 'notes.json');
const attachmentDir = () => path.join(app.getPath('userData'), 'attachments');
const backupDir = () => path.join(app.getPath('userData'), 'backups');
const schemaVersion = 2;
let db;
let logger;
const cancelledOperations = new Set();
const activeTranscriptions = new Map();
function operationId(payload) {
  return typeof payload?.operationId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(payload.operationId) ? payload.operationId : crypto.randomUUID();
}
function atomicWrite(file, data) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, data);
  fs.rmSync(file, { force: true });
  fs.renameSync(temporary, file);
}
function backupDatabase() {
  if (!db) return null;
  fs.mkdirSync(backupDir(), { recursive: true });
  const file = path.join(backupDir(), `notes-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  fs.writeFileSync(file, Buffer.from(db.export()));
  const files = fs.readdirSync(backupDir()).filter(x => x.endsWith('.sqlite')).sort().reverse();
  files.slice(20).forEach(x => fs.rmSync(path.join(backupDir(), x), { force: true }));
  return file;
}
function persistDb() { fs.mkdirSync(path.dirname(store()), { recursive: true }); atomicWrite(store(), Buffer.from(db.export())); }
function tableColumns(table) { return rows(`PRAGMA table_info(${table})`).map(x => x.name); }
function migrateDb() {
  db.run('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const current = Number(rows('SELECT value FROM metadata WHERE key=?', ['schema_version'])[0]?.value || 1);
  if (current < 2) {
    if (!tableColumns('notes').includes('attachments')) db.run("ALTER TABLE notes ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
    if (!tableColumns('history').includes('attachments')) db.run("ALTER TABLE history ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
    db.run('INSERT OR REPLACE INTO metadata VALUES (?,?)', ['schema_version', String(schemaVersion)]);
  }
}
function initDb() {
  const SQL = initSqlJs({ locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
  return SQL.then(Sql => {
    fs.mkdirSync(path.dirname(store()), { recursive: true });
    if (fs.existsSync(store())) {
      fs.mkdirSync(backupDir(), { recursive: true });
      fs.copyFileSync(store(), path.join(backupDir(), `pre-migration-${Date.now()}.sqlite`));
      db = new Sql.Database(fs.readFileSync(store()));
      migrateDb();
      persistDb();
    }
    else {
      db = new Sql.Database();
      db.run('CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, folder TEXT NOT NULL, updated INTEGER NOT NULL, attachments TEXT NOT NULL)');
      db.run('CREATE TABLE folders (name TEXT PRIMARY KEY)');
      db.run('CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, folder TEXT NOT NULL, updated INTEGER NOT NULL, attachments TEXT NOT NULL, created INTEGER NOT NULL)');
      db.run('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.run('INSERT INTO metadata VALUES (?,?)', ['schema_version', String(schemaVersion)]);
      db.run('INSERT OR IGNORE INTO folders VALUES (?)', ['Inbox']);
      if (fs.existsSync(legacyStore())) {
        try {
          const legacy = JSON.parse(fs.readFileSync(legacyStore(), 'utf8'));
          if (Array.isArray(legacy)) legacy.forEach(n => upsertNote(n, false));
          fs.copyFileSync(legacyStore(), `${legacyStore()}.backup-${Date.now()}`);
        } catch {}
      }
      persistDb(); backupDatabase();
    }
  });
}
function rows(sql, params = []) { const s = db.prepare(sql); s.bind(params); const out = []; while (s.step()) out.push(s.getAsObject()); s.free(); return out; }
function cleanNote(n) { return { id: String(n.id || Date.now()), title: String(n.title || '').slice(0, 1000), body: String(n.body || '').slice(0, 1000000), folder: String(n.folder || 'Inbox').slice(0, 200), updated: Number(n.updated) || Date.now(), attachments: Array.isArray(n.attachments) ? n.attachments.filter(isAttachmentPath).slice(0, 1000) : [] }; }
function upsertNote(raw, history = true) {
  const n = cleanNote(raw);
  if (history && rows('SELECT id FROM notes WHERE id=?', [n.id]).length) db.run('INSERT INTO history(note_id,title,body,folder,updated,attachments,created) VALUES(?,?,?,?,?,?,?)', [n.id,n.title,n.body,n.folder,n.updated,JSON.stringify(n.attachments),Date.now()]);
  db.run('INSERT OR REPLACE INTO notes VALUES(?,?,?,?,?,?)', [n.id,n.title,n.body,n.folder,n.updated,JSON.stringify(n.attachments)]);
  db.run('INSERT OR IGNORE INTO folders VALUES (?)', [n.folder]);
}
function parseAttachments(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter(isAttachmentPath).slice(0, 1000) : []; } catch (error) {
    logger?.warn('Malformed attachment metadata ignored', { error: error.message });
    return [];
  }
}
function readNotes() { return rows('SELECT id,title,body,folder,updated,attachments FROM notes ORDER BY updated DESC').map(n => ({ ...n, attachments: parseAttachments(n.attachments) })); }
function writeNotes(payload) {
  const notes = Array.isArray(payload) ? payload : payload?.notes;
  if (!Array.isArray(notes) || notes.length > 10000) throw new Error('Invalid notes data.');
  const folders = Array.isArray(payload?.folders) ? payload.folders.filter(f => typeof f === 'string' && f.trim()).slice(0, 500) : [];
  db.run('BEGIN'); try { notes.forEach(n => upsertNote(n)); folders.forEach(f => db.run('INSERT OR IGNORE INTO folders VALUES (?)', [String(f).slice(0,200)])); db.run('COMMIT'); persistDb(); backupDatabase(); } catch (e) { db.run('ROLLBACK'); throw e; }
}
function isAttachmentPath(file) {
  if (typeof file !== 'string') return false;
  const root = path.resolve(attachmentDir()) + path.sep;
  return path.resolve(file).startsWith(root);
}
function safeLocalPath(root, file) {
  return typeof file === 'string' && path.resolve(file).startsWith(path.resolve(root) + path.sep);
}
function scanModelDir(dir) {
  if (!dir || !fs.existsSync(dir)) return { directory: dir || '', executable: '', models: [] };
  const files = fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? scanModelDir(path.join(dir, e.name)).models.map(x => path.join(e.name, x)) : [e.name]);
  const executable = files.find(f => /(^|[\\/])(whisper|whisper-cli|main)(\.exe)?$/i.test(f) || /whisper.*\.exe$/i.test(f)) || '';
  const models = files.filter(f => /\.(bin|gguf|pt|onnx|safetensors)$/i.test(f));
  return { directory: dir, executable: executable ? path.join(dir, executable) : '', models };
}
const modelCatalog = [
  { id: 'base-en', name: 'Whisper base (English)', file: 'ggml-base.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin', format: 'bin' },
  { id: 'tiny-en', name: 'Whisper tiny (English)', file: 'ggml-tiny.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin', format: 'bin' }
];
function modelRoot() { return path.join(app.getPath('userData'), 'models'); }
function sendProgress(event, value) { if (!event.sender.isDestroyed()) event.sender.send('models:progress', value); }
function requestFollow(url, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error('Download redirected too many times.'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const request = client.get(url, { headers: { 'User-Agent': 'STTNotes/1.0' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return requestFollow(new URL(response.headers.location, url).toString(), redirects + 1).then(resolve, reject);
      }
      resolve(response);
    });
    request.setTimeout(30000, () => request.destroy(new Error('Download timed out.')));
    request.on('error', reject);
  });
}
async function downloadFile(url, target, event, id, operation) {
  const response = await requestFollow(url);
  if (response.statusCode !== 200) { response.resume(); throw new Error(`Download failed (${response.statusCode}) for ${url}`); }
  const total = Number(response.headers['content-length']) || 0;
  const temp = `${target}.partial-${process.pid}`;
  await new Promise((resolve, reject) => {
    let done = 0; const out = fs.createWriteStream(temp);
    response.on('data', chunk => {
      if (cancelledOperations.has(operation)) { response.destroy(); reject(new Error('Operation cancelled.')); return; }
      done += chunk.length; sendProgress(event, { id, progress: total ? done / total : 0, bytes: done, total });
    });
    response.on('error', reject); out.on('error', reject);
    out.on('finish', () => out.close(resolve));
    response.pipe(out);
  });
  fs.renameSync(temp, target);
}
async function installEngine(event, payload = {}) {
  const operation = operationId(payload);
  const root = modelRoot(), dir = path.join(root, 'engine'), zip = path.join(root, 'engine-download.zip');
  fs.mkdirSync(root, { recursive: true });
  let release;
  try {
    const response = await requestFollow('https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest');
    if (response.statusCode !== 200) { response.resume(); throw new Error(`GitHub release lookup failed (${response.statusCode}).`); }
    release = JSON.parse(await new Promise((resolve, reject) => { let text = ''; response.setEncoding('utf8'); response.on('data', x => text += x); response.on('end', () => resolve(text)); response.on('error', reject); }));
  } catch (e) { throw new Error(`Could not find the current whisper.cpp Windows release: ${e.message}`); }
  const asset = (release.assets || []).find(x => /\.zip$/i.test(x.name) && /(x64|amd64)/i.test(x.name) && !/win32|arm64|armv7/i.test(x.name));
  if (!asset) throw new Error('The latest whisper.cpp release has no Windows x64 ZIP asset. Download a compatible whisper-cli.exe and select its folder instead.');
  try {
    fs.rmSync(zip, { force: true }); sendProgress(event, { id: 'engine', progress: 0 });
    await downloadFile(asset.browser_download_url, zip, event, 'engine', operation);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const p = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`], { windowsHide: true });
    const code = await new Promise(resolve => p.on('close', resolve));
    fs.rmSync(zip, { force: true });
    if (code !== 0) throw new Error('Windows could not extract the engine ZIP.');
    const scan = scanModelDir(dir);
    if (!scan.executable) throw new Error('The downloaded ZIP contains no whisper executable. Select a compatible whisper-cli.exe folder manually.');
    sendProgress(event, { id: 'engine', progress: 1 });
    return { executable: scan.executable, directory: dir, source: asset.browser_download_url, version: release.tag_name };
  } catch (e) { fs.rmSync(zip, { force: true }); throw new Error(`Engine installation failed: ${e.message}`); }
}
async function downloadModel({ id, operationId: requestedOperation }, event) {
  const operation = operationId({ operationId: requestedOperation });
  const item = modelCatalog.find(x => x.id === id); if (!item) throw new Error('Unknown model ID.');
  const dir = modelRoot(); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, item.file);
  try {
    await downloadFile(item.url, target, event, id, operation);
    return { ...item, path: target, directory: dir, size: fs.statSync(target).size };
  } catch (e) { fs.rmSync(`${target}.partial-${process.pid}`, { force: true }); throw new Error(`Model installation failed: ${e.message}`); }
}
function modelState() {
  const dir = modelRoot(), scan = scanModelDir(dir);
  return { directory: dir, executable: scan.executable || '', models: scan.models, catalog: modelCatalog.map(({ id, name, file, format }) => ({ id, name, file, format })) };
}
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800, minWidth: 980, minHeight: 620, backgroundColor: '#0d1117', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }});
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(async () => {
logger = createLogger(app);
logger.info('Application starting', { version: app.getVersion() });
await initDb();
  setInterval(() => { try { backupDatabase(); } catch {} }, 24 * 60 * 60 * 1000);
  createPluginManager(app, ipcMain, dialog);
  ipcMain.handle('notes:list', () => ({ notes: readNotes(), folders: rows('SELECT name FROM folders ORDER BY name').map(x => x.name) }));
  ipcMain.handle('notes:save', (_, notes) => { writeNotes(notes); return true; });
  ipcMain.handle('backups:list', () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    return fs.readdirSync(backupDir()).filter(x => x.endsWith('.sqlite')).sort().reverse().slice(0, 20).map(name => ({ name, path: path.join(backupDir(), name), size: fs.statSync(path.join(backupDir(), name)).size }));
  });
  ipcMain.handle('backups:create', () => backupDatabase());
  ipcMain.handle('backups:restore', (_, file) => {
    if (typeof file !== 'string' || !safeLocalPath(backupDir(), file) || !fs.existsSync(file)) throw new Error('Backup was not found.');
    const bytes = fs.readFileSync(file); if (bytes.length < 16) throw new Error('Backup is invalid.');
    backupDatabase(); fs.writeFileSync(store(), bytes); app.relaunch(); app.exit(0); return true;
  });
  ipcMain.handle('workspace:export', async (_, passphrase) => {
    if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    const r = await dialog.showSaveDialog({ defaultPath: 'sttnotes-workspace.sttnx', filters: [{ name: 'Encrypted workspace', extensions: ['sttnx'] }] });
    if (r.canceled) return null;
    const payload = JSON.stringify({ format: 'sttnotes', version: 1, exported: Date.now(), notes: readNotes(), folders: rows('SELECT name FROM folders ORDER BY name').map(x => x.name) });
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(passphrase, salt, 32), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    fs.writeFileSync(r.filePath, Buffer.concat([Buffer.from('STTNX1'), salt, iv, cipher.getAuthTag(), encrypted]));
    return r.filePath;
  });
  ipcMain.handle('workspace:import', async (_, passphrase) => {
    if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Use the passphrase used during export.');
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Encrypted workspace', extensions: ['sttnx'] }] });
    if (r.canceled) return null;
    const b = fs.readFileSync(r.filePaths[0]); if (b.subarray(0, 6).toString() !== 'STTNX1') throw new Error('Unsupported workspace format.');
    try {
      const key = crypto.scryptSync(passphrase, b.subarray(6, 22), 32), decipher = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(22, 34));
      decipher.setAuthTag(b.subarray(34, 50)); const data = JSON.parse(Buffer.concat([decipher.update(b.subarray(50)), decipher.final()]).toString('utf8'));
      writeNotes(data); return true;
    } catch { throw new Error('Could not decrypt workspace. Check the passphrase and file.'); }
  });
  ipcMain.handle('notes:history', (_, id) => rows('SELECT id,title,body,folder,updated,attachments,created FROM history WHERE note_id=? ORDER BY created DESC LIMIT 50', [String(id)]).map(n => ({ ...n, attachments: JSON.parse(n.attachments || '[]') })));
  ipcMain.handle('notes:restore', (_, version) => { upsertNote(version); persistDb(); return readNotes(); });
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
  ipcMain.handle('models:state', () => modelState());
  ipcMain.handle('operations:cancel', (_, id) => { if (typeof id === 'string') cancelledOperations.add(id); activeTranscriptions.get(id)?.kill(); return true; });
  ipcMain.handle('models:download', (event, payload) => downloadModel(payload, event).finally(() => cancelledOperations.delete(payload?.operationId)));
  ipcMain.handle('models:installEngine', (event, payload) => installEngine(event, payload).finally(() => cancelledOperations.delete(payload?.operationId)));
  ipcMain.handle('transcribe:run', (_, { executable, audioPath, model, operationId: requestedOperation }) => new Promise((resolve, reject) => {
    const operation = operationId({ operationId: requestedOperation });
    if (!executable) return reject(new Error('No local Whisper executable is configured. Set its full path in Settings.'));
    if (!audioPath || !fs.existsSync(audioPath)) return reject(new Error('The recording file does not exist.'));
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) return reject(new Error(`Configured Whisper executable was not found: ${executable}`));
    if (model && (!fs.existsSync(model) || !fs.statSync(model).isFile())) return reject(new Error('Configured Whisper model was not found.'));
    const child = spawn(executable, ['-m', model || 'base', '-f', audioPath, '-otxt'], { windowsHide: true });
    activeTranscriptions.set(operation, child);
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', e => reject(new Error(`Could not start local Whisper: ${e.message}`)));
    child.on('close', code => { activeTranscriptions.delete(operation); code === 0 ? resolve(out.trim()) : reject(new Error(`Local Whisper exited with code ${code}: ${err.trim() || 'no error details'}`)); });
  }));
  ipcMain.handle('ai:status', () => ({ enabled: false, network: false, providers: [{ id: 'ollama', label: 'Ollama (localhost)', configured: false }, { id: 'lmstudio', label: 'LM Studio (localhost)', configured: false }, { id: 'openai-compatible', label: 'OpenAI-compatible local endpoint', configured: false }] }));
  ipcMain.handle('ai:run', async (_, payload) => {
    if (!payload?.enabled) throw new Error('Local AI is disabled. Enable and configure a localhost provider first.');
    throw new Error('No local AI provider is configured.');
  });
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
