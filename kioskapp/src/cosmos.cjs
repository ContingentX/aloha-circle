// Optional NVIDIA Cosmos 3 Reasoner NIM hook.
//
// Cosmos is a world/VLM reasoner, not the live pose detector. The kiosk calls
// this only when a ritual gesture has stalled (~8s) and we want a second
// opinion from a physical-AI VLM.
//
// Endpoint: OpenAI-compatible chat completions, as served by
//   nvidia/cosmos3-nano-reasoner  (NIM, default)
//   nvidia/cosmos3-super-reasoner
// Docs: https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/cosmos-reason3/api.html
//
// Export COSMOS_NIM_URL (e.g. http://127.0.0.1:8000/v1/chat/completions) and
// optionally COSMOS_API_KEY / COSMOS_MODEL. Unset → { ok:false, source:'unset' }.
//
// Timeout handling: venue Wi-Fi is unreliable; if the VLM call times out (default
// 5s), the result degrades to { ok:false, source:'timeout' } so the kiosk falls
// back to keypoint-only advancement.
//
// See COSMOS-NIM.md for CoreWeave / local NIM setup instructions.

const ENDPOINT = process.env.COSMOS_NIM_URL || '';
const MODEL = process.env.COSMOS_MODEL || 'nvidia/cosmos3-nano-reasoner';
const API_KEY = process.env.COSMOS_API_KEY || process.env.NVIDIA_API_KEY || '';
const TIMEOUT_MS = Number(process.env.COSMOS_TIMEOUT_MS) || 5000;

function yes(text) {
  const t = String(text || '').trim().toUpperCase();
  return t.startsWith('YES') || /\bYES\b/.test(t);
}

function parseConfidence(text) {
  const match = String(text || '').match(/(\d{1,3})%/);
  if (match) return Math.min(100, Math.max(0, Number(match[1]))) / 100;
  if (/\bnot\s+(confident|certain|sure)\b/i.test(text)) return 0.4;
  if (/\b(very\s+)?(confident|certain|sure)\b/i.test(text)) return 0.9;
  return null;
}

async function callVlm(imageDataUrl, prompt, options = {}) {
  const endpoint = options.endpoint ?? ENDPOINT;
  const model = options.model ?? MODEL;
  const apiKey = options.apiKey ?? API_KEY;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxTokens = options.maxTokens ?? 64;
  const promptLimit = options.promptLimit ?? 400;

  if (!endpoint) return { ok: false, source: 'unset' };
  if (!imageDataUrl || !prompt) return { ok: false, source: 'bad-input' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl } },
              { type: 'text', text: String(prompt).slice(0, promptLimit) },
            ],
          },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`cosmos ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || '';
    return { ok: true, source: 'cosmos', text: String(text).trim() };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error('cosmos judge timeout after', timeoutMs, 'ms');
      return { ok: false, source: 'timeout', error: 'Request timed out' };
    }

    console.error('cosmos judge fallback:', err.message);
    return { ok: false, source: 'error', error: err.message };
  }
}

async function judgeGesture(imageDataUrl, prompt, options = {}) {
  const result = await callVlm(imageDataUrl, prompt, options);
  if (result.source !== 'cosmos') return result;
  const confidence = parseConfidence(result.text);
  return {
    ok: yes(result.text),
    source: 'cosmos',
    text: result.text,
    ...(confidence !== null && { confidence }),
  };
}

// Open-ended scene read for the admin brand/label rail. ok means the VLM
// answered — parse the text in the renderer (JSON or comma list).
async function describeScene(imageDataUrl, prompt, options = {}) {
  return callVlm(imageDataUrl, prompt, { maxTokens: 256, promptLimit: 600, ...options });
}

module.exports = { judgeGesture, describeScene, parseConfidence, yes };
