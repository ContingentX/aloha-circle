import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCauseSignals, OctenError, validateOctenSourceConfig } from '../src/octen.js';

const SOURCE = Object.freeze({
  id: 'octen-maui-events',
  url: 'https://api.octen.ai/search',
  parser: 'octen',
  octen: {
    query: 'Maui community events this week',
    count: 5,
    causeTags: ['Events', 'maui'],
    urgency: 2,
  },
  schema: { required: ['title', 'causeTags', 'urgency', 'summary'] },
});

// Mirrors the real https://api.octen.ai/search envelope (docs.octen.ai quickstart).
function octenEnvelope(results) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, msg: 'success', data: { query: 'q', results } }),
  };
}

const GOOD_RESULT = Object.freeze({
  title: ' Maui County Fair ',
  url: 'https://example.com/fair',
  highlight: 'Four days of rides\nand   fair food at the War Memorial complex.',
  time_published: '2026-10-16T23:40:12Z',
  time_last_crawled: '2026-10-21T04:10:26Z',
});

test('maps octen results into CauseSignals with provenance', async () => {
  let captured;
  const signals = await fetchCauseSignals({
    source: SOURCE,
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return octenEnvelope([GOOD_RESULT]);
    },
  });
  assert.equal(captured.url, 'https://api.octen.ai/search');
  assert.equal(captured.init.headers['x-api-key'], 'test-key');
  assert.deepEqual(JSON.parse(captured.init.body), { query: 'Maui community events this week', count: 5 });

  assert.equal(signals.length, 1);
  const [signal] = signals;
  assert.equal(signal.title, 'Maui County Fair');
  assert.equal(signal.summary, 'Four days of rides and fair food at the War Memorial complex.');
  assert.deepEqual(signal.causeTags, ['events', 'maui']);
  assert.equal(signal.urgency, 2);
  assert.equal(signal.url, 'https://example.com/fair');
  assert.equal(signal.sourceUrl, 'https://example.com/fair');
  assert.equal(signal.fetchedAt, '2026-10-21T04:10:26.000Z');
  assert.equal(signal.provenance.adapter, 'octen');
  // Satisfies the sources.json schema.required contract the ingest loop checks.
  for (const field of SOURCE.schema.required) assert.notEqual(signal[field], undefined);
});

test('skips unusable results and dedupes by url', async () => {
  const signals = await fetchCauseSignals({
    source: SOURCE,
    apiKey: 'test-key',
    fetchImpl: async () => octenEnvelope([
      GOOD_RESULT,
      { ...GOOD_RESULT, title: 'Duplicate of the fair' }, // same URL → deduped
      { title: 'No url at all' },
      { title: 'Insecure', url: 'http://example.com/plain' },
      { title: 'Second event', url: 'https://example.com/second', highlight: '' },
    ]),
  });
  assert.deepEqual(signals.map((s) => s.url), ['https://example.com/fair', 'https://example.com/second']);
  // Empty highlight falls back to the title so summary always validates.
  assert.equal(signals[1].summary, 'Second event');
});

test('fails closed without an API key', async () => {
  await assert.rejects(
    fetchCauseSignals({ source: SOURCE, fetchImpl: async () => octenEnvelope([GOOD_RESULT]) }),
    (err) => err instanceof OctenError && err.code === 'config',
  );
});

test('fails closed on provider errors', async () => {
  await assert.rejects(
    fetchCauseSignals({ source: SOURCE, apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401 }) }),
    (err) => err instanceof OctenError && err.code === 'provider',
  );
  await assert.rejects(
    fetchCauseSignals({
      source: SOURCE,
      apiKey: 'k',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 1301, msg: 'invalid key' }) }),
    }),
    (err) => err instanceof OctenError && /1301/.test(err.message),
  );
  await assert.rejects(
    fetchCauseSignals({ source: SOURCE, apiKey: 'k', fetchImpl: async () => octenEnvelope([]) }),
    (err) => err instanceof OctenError && err.code === 'provider',
  );
  await assert.rejects(
    fetchCauseSignals({ source: SOURCE, apiKey: 'k', fetchImpl: async () => { throw new Error('boom'); } }),
    (err) => err instanceof OctenError && err.code === 'transport',
  );
});

test('rejects malformed source config', () => {
  assert.throws(() => validateOctenSourceConfig({ id: 'x' }), OctenError);
  assert.throws(
    () => validateOctenSourceConfig({ id: 'x', octen: { query: '', causeTags: ['a'] } }),
    (err) => err.code === 'config',
  );
  assert.throws(
    () => validateOctenSourceConfig({ id: 'x', octen: { query: 'q', causeTags: [] } }),
    (err) => err.code === 'config',
  );
  assert.throws(
    () => validateOctenSourceConfig({ id: 'x', octen: { query: 'q', causeTags: ['a'], urgency: 9 } }),
    (err) => err.code === 'config',
  );
});
