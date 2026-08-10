const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { safePath, validateManifest } = require('../src/plugin-manager');

test('safePath rejects traversal outside the plugin directory', () => {
  const root = path.join('/tmp', 'plugin');
  assert.equal(safePath(root, 'index.js'), true);
  assert.equal(safePath(root, '../outside.js'), false);
  assert.equal(safePath(root, path.resolve(root, '..', 'outside.js')), false);
});

test('validateManifest normalizes valid plugin metadata', () => {
  assert.deepEqual(validateManifest({
    id: 'hello-local',
    name: ' Hello ',
    version: '1.0.0',
    description: 42,
    capabilities: ['notes.read']
  }), {
    id: 'hello-local',
    name: ' Hello ',
    version: '1.0.0',
    description: '42',
    capabilities: ['notes.read'],
    main: 'index.js',
    panel: null
  });
});

test('validateManifest rejects invalid IDs and capabilities', () => {
  assert.throws(() => validateManifest({ id: '../bad', name: 'Bad', version: '1' }), /Invalid plugin manifest/);
  assert.throws(() => validateManifest({ id: 'valid', name: 'Valid', version: '1', capabilities: ['filesystem'] }), /unsupported capability/);
});
