const { test } = require('node:test');
const assert = require('node:assert/strict');

// Isolate env so the module's unset-endpoint path is the one we test.
delete process.env.COSMOS_NIM_URL;
delete process.env.COSMOS_API_KEY;
delete process.env.NVIDIA_API_KEY;

const { judgeGesture } = require('../src/cosmos.cjs');

test('cosmos judge is a no-op without COSMOS_NIM_URL', async () => {
  const result = await judgeGesture('data:image/jpeg;base64,xx', 'Is this YES or NO?');
  assert.equal(result.ok, false);
  assert.equal(result.source, 'unset');
});
