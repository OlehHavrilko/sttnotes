const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogger } = require('../src/logger');

test('logger writes structured entries with levels', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sttnotes-log-'));
  const logger = createLogger({ getPath: () => directory });
  logger.info('started', { requestId: 'test-request' });
  logger.error('failed', { code: 'TEST' });
  const entries = fs.readFileSync(logger.file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries[0].level, 'info');
  assert.equal(entries[0].requestId, 'test-request');
  assert.equal(entries[1].level, 'error');
  fs.rmSync(directory, { recursive: true, force: true });
});
