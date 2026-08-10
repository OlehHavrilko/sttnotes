const fs = require('fs');
const path = require('path');

function createLogger(app) {
  const file = path.join(app.getPath('userData'), 'sttnotes.log');
  function write(level, message, details = {}) {
    const entry = { timestamp: new Date().toISOString(), level, message, ...details };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {}
    if (level === 'error') console.error(`[${level}] ${message}`, details);
    else if (level === 'warn') console.warn(`[${level}] ${message}`, details);
    else console.info(`[${level}] ${message}`, details);
  }
  return {
    file,
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details)
  };
}

module.exports = { createLogger };
