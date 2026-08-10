const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const store = () => path.join(app.getPath('userData'), 'notes.json');
function readNotes() { try { return JSON.parse(fs.readFileSync(store(), 'utf8')); } catch { return []; } }
function writeNotes(notes) { fs.mkdirSync(path.dirname(store()), { recursive: true }); fs.writeFileSync(store(), JSON.stringify(notes, null, 2)); }
function scanModelDir(dir) {
  if (!dir || !fs.existsSync(dir)) return { directory: dir || '', executable: '', models: [] };
  const files = fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? scanModelDir(path.join(dir, e.name)).models.map(x => path.join(e.name, x)) : [e.name]);
  const executable = files.find(f => /(^|[\\/])(whisper|whisper-cli|main)(\.exe)?$/i.test(f) || /whisper.*\.exe$/i.test(f)) || '';
  const models = files.filter(f => /\.(bin|gguf|pt|onnx|safetensors)$/i.test(f));
  return { directory: dir, executable: executable ? path.join(dir, executable) : '', models };
}
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800, minWidth: 980, minHeight: 620, backgroundColor: '#0d1117', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }});
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => {
  ipcMain.handle('notes:list', () => readNotes());
  ipcMain.handle('notes:save', (_, notes) => { writeNotes(notes); return true; });
  ipcMain.handle('notes:deleteAttachment', (_, file) => { if (file && fs.existsSync(file)) fs.unlinkSync(file); return true; });
  ipcMain.handle('attachment:save', (_, { data, name }) => {
    const dir = path.join(app.getPath('userData'), 'attachments'); fs.mkdirSync(dir, { recursive: true });
    const safe = `${Date.now()}-${String(name || 'attachment').replace(/[^\w.\-]/g, '_')}`;
    const file = path.join(dir, safe); fs.writeFileSync(file, Buffer.from(data, 'base64')); return file;
  });
  ipcMain.handle('attachment:copy', (_, source) => {
    if (!source || !fs.existsSync(source)) throw new Error('Attachment file was not found.');
    const dir = path.join(app.getPath('userData'), 'attachments'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${path.basename(source).replace(/[^\w.\-]/g, '_')}`); fs.copyFileSync(source, file); return file;
  });
  ipcMain.handle('attachment:open', async () => { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Media', extensions: ['png','jpg','jpeg','gif','webp','mp4','webm','mov'] }] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('file:open', async () => { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio or text', extensions: ['txt','md','wav','mp3','m4a','ogg'] }] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('file:readText', (_, file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } });
  ipcMain.handle('audio:save', (_, { data, extension = 'webm' }) => {
    if (!data || typeof data !== 'string') throw new Error('No audio data was provided.');
    const dir = path.join(app.getPath('userData'), 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `recording-${Date.now()}.${extension}`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  });
  ipcMain.handle('models:choose', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled) return null;
    return scanModelDir(r.filePaths[0]);
  });
  ipcMain.handle('models:scan', (_, dir) => scanModelDir(dir));
  ipcMain.handle('transcribe:run', (_, { executable, audioPath, model }) => new Promise((resolve, reject) => {
    if (!executable) return reject(new Error('No local Whisper executable is configured. Set its full path in Settings.'));
    if (!audioPath || !fs.existsSync(audioPath)) return reject(new Error('The recording file does not exist.'));
    if (!fs.existsSync(executable)) return reject(new Error(`Configured Whisper executable was not found: ${executable}`));
    const child = spawn(executable, ['-m', model || 'base', '-f', audioPath, '-otxt'], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', e => reject(new Error(`Could not start local Whisper: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`Local Whisper exited with code ${code}: ${err.trim() || 'no error details'}`)));
  }));
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
