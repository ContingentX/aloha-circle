const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

// Isolate env so the module's unset-endpoint path is the one we test.
delete process.env.COSMOS_NIM_URL;
delete process.env.COSMOS_API_KEY;
delete process.env.NVIDIA_API_KEY;

const { judgeGesture, describeScene, parseConfidence, yes } = require('../src/cosmos.cjs');

const SAMPLE_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const SAMPLE_PROMPT = 'Is the person covering their eyes? Answer YES or NO only.';

// --- Unit tests for helper functions ---

test('yes() recognizes YES answers', () => {
  assert.equal(yes('YES'), true);
  assert.equal(yes('Yes'), true);
  assert.equal(yes('yes'), true);
  assert.equal(yes('YES, the person is covering their eyes.'), true);
  assert.equal(yes('  YES  '), true);
});

test('yes() rejects NO answers', () => {
  assert.equal(yes('NO'), false);
  assert.equal(yes('No'), false);
  assert.equal(yes('no'), false);
  assert.equal(yes(''), false);
  assert.equal(yes(null), false);
  assert.equal(yes(undefined), false);
});

test('parseConfidence extracts percentage values', () => {
  assert.equal(parseConfidence('YES (90% confident)'), 0.9);
  assert.equal(parseConfidence('YES, 75% sure'), 0.75);
  assert.equal(parseConfidence('100%'), 1.0);
  assert.equal(parseConfidence('0%'), 0);
});

test('parseConfidence handles keyword-based confidence', () => {
  assert.equal(parseConfidence('YES, very confident'), 0.9);
  assert.equal(parseConfidence('YES, I am certain'), 0.9);
  assert.equal(parseConfidence('not confident'), 0.4);
  assert.equal(parseConfidence('YES'), null);
});

// --- Integration tests (no HTTP) ---

test('cosmos judge is a no-op without COSMOS_NIM_URL', async () => {
  const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT);
  assert.equal(result.ok, false);
  assert.equal(result.source, 'unset');
});

test('cosmos judge rejects missing image', async () => {
  const result = await judgeGesture(null, SAMPLE_PROMPT, { endpoint: 'http://test' });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'bad-input');
});

test('cosmos judge rejects missing prompt', async () => {
  const result = await judgeGesture(SAMPLE_IMAGE, '', { endpoint: 'http://test' });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'bad-input');
});

// --- HTTP mocking tests ---

test('cosmos judge returns ok:true on YES response', async (t) => {
  const mockFetch = t.mock.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'YES, the person is covering their eyes.' } }],
    }),
  }));

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'cosmos');
    assert.ok(result.text.includes('YES'));
    assert.equal(mockFetch.mock.calls.length, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge returns ok:false on NO response', async (t) => {
  const mockFetch = t.mock.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'NO, the person is not covering their eyes.' } }],
    }),
  }));

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, false);
    assert.equal(result.source, 'cosmos');
    assert.ok(result.text.includes('NO'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge extracts confidence when present', async (t) => {
  const mockFetch = t.mock.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'YES (85% confident)' } }],
    }),
  }));

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, true);
    assert.equal(result.confidence, 0.85);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge handles HTTP error gracefully', async (t) => {
  const mockFetch = t.mock.fn(async () => ({
    ok: false,
    status: 500,
  }));

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, false);
    assert.equal(result.source, 'error');
    assert.ok(result.error.includes('500'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge handles network error gracefully', async (t) => {
  const mockFetch = t.mock.fn(async () => {
    throw new Error('ECONNREFUSED');
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, false);
    assert.equal(result.source, 'error');
    assert.ok(result.error.includes('ECONNREFUSED'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge handles timeout gracefully', async (t) => {
  const mockFetch = t.mock.fn(async (url, opts) => {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      opts.signal.addEventListener('abort', abortHandler);
    });
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
      timeoutMs: 50,
    });
    assert.equal(result.ok, false);
    assert.equal(result.source, 'timeout');
    assert.ok(result.error.includes('timed out'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge sends correct request payload', async (t) => {
  let capturedBody = null;
  let capturedHeaders = null;

  const mockFetch = t.mock.fn(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    capturedHeaders = opts.headers;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
    };
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
      model: 'nvidia/cosmos3-nano-reasoner',
      apiKey: 'test-api-key',
    });

    assert.equal(capturedBody.model, 'nvidia/cosmos3-nano-reasoner');
    assert.equal(capturedBody.max_tokens, 64);
    assert.equal(capturedBody.messages.length, 1);
    assert.equal(capturedBody.messages[0].role, 'user');
    assert.equal(capturedBody.messages[0].content.length, 2);
    assert.equal(capturedBody.messages[0].content[0].type, 'image_url');
    assert.equal(capturedBody.messages[0].content[0].image_url.url, SAMPLE_IMAGE);
    assert.equal(capturedBody.messages[0].content[1].type, 'text');
    assert.equal(capturedHeaders.Authorization, 'Bearer test-api-key');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('describeScene is a no-op without COSMOS_NIM_URL', async () => {
  const result = await describeScene(SAMPLE_IMAGE, 'list brands');
  assert.equal(result.ok, false);
  assert.equal(result.source, 'unset');
});

test('describeScene returns the VLM text without YES/NO parsing', async (t) => {
  const mockFetch = t.mock.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.max_tokens, 256);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[{"name":"NVIDIA","kind":"brand"}]' } }],
      }),
    };
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await describeScene(SAMPLE_IMAGE, 'list brands', {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'cosmos');
    assert.match(result.text, /NVIDIA/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cosmos judge handles malformed API response', async (t) => {
  const mockFetch = t.mock.fn(async () => ({
    ok: true,
    json: async () => ({ unexpected: 'format' }),
  }));

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const result = await judgeGesture(SAMPLE_IMAGE, SAMPLE_PROMPT, {
      endpoint: 'http://localhost:8000/v1/chat/completions',
    });
    assert.equal(result.ok, false);
    assert.equal(result.source, 'cosmos');
    assert.equal(result.text, '');
  } finally {
    globalThis.fetch = origFetch;
  }
});
