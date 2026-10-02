const { test } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.COSMOS_NIM_URL;
delete process.env.COSMOS_API_KEY;
delete process.env.NVIDIA_API_KEY;

const { analyzeBrands, parseBrandReport } = require('../src/brandSense.cjs');

const SAMPLE_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('parseBrandReport reads fenced JSON and normalizes snake_case', () => {
  const report = parseBrandReport('```json\n{"person":true,"brands":["NVIDIA"],"clothing_style":["aloha shirt"],"colors":["teal"],"accessories":["lei"]}\n```');
  assert.deepEqual(report, {
    person: true,
    gender: 'unknown',
    brands: ['NVIDIA'],
    clothingStyle: ['aloha shirt'],
    colors: ['teal'],
    accessories: ['lei'],
  });
});

test('parseBrandReport normalizes gender for the matcher gate', () => {
  assert.equal(parseBrandReport('{"person":true,"gender":"Female"}').gender, 'female');
  assert.equal(parseBrandReport('{"person":true,"gender":"MALE"}').gender, 'male');
  // Anything else stays unknown — unknown matches every local downstream.
  assert.equal(parseBrandReport('{"person":true,"gender":"androgynous"}').gender, 'unknown');
  assert.equal(parseBrandReport('{"person":true}').gender, 'unknown');
});

test('parseBrandReport returns no-person and rejects junk', () => {
  assert.deepEqual(parseBrandReport('{"person":false}'), { person: false });
  assert.equal(parseBrandReport('no json here'), null);
  assert.equal(parseBrandReport(''), null);
});

test('analyzeBrands is a no-op without COSMOS_NIM_URL', async () => {
  const result = await analyzeBrands(SAMPLE_IMAGE);
  assert.equal(result.ok, false);
  assert.equal(result.source, 'unset');
});

test('analyzeBrands returns a report on a well-formed VLM reply', async (t) => {
  const mockFetch = t.mock.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"person":true,"brands":["VAST"],"clothing_style":[],"colors":["black"],"accessories":[]}' } }],
    }),
  }));
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await analyzeBrands(SAMPLE_IMAGE, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'brand-sense');
    assert.deepEqual(result.report.brands, ['VAST']);
  } finally {
    globalThis.fetch = orig;
  }
});
