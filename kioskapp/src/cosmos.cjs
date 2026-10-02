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

const ENDPOINT = process.env.COSMOS_NIM_URL || '';
const MODEL = process.env.COSMOS_MODEL || 'nvidia/cosmos3-nano-reasoner';
const API_KEY = process.env.COSMOS_API_KEY || process.env.NVIDIA_API_KEY || '';

function yes(text) {
  const t = String(text || '').trim().toUpperCase();
  return t.startsWith('YES') || /\bYES\b/.test(t);
}

async function judgeGesture(imageDataUrl, prompt) {
  if (!ENDPOINT) return { ok: false, source: 'unset' };
  if (!imageDataUrl || !prompt) return { ok: false, source: 'bad-input' };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl } },
              { type: 'text', text: String(prompt).slice(0, 400) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`cosmos ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || '';
    return { ok: yes(text), source: 'cosmos', text: String(text).trim() };
  } catch (err) {
    console.error('cosmos judge fallback:', err.message);
    return { ok: false, source: 'error', error: err.message };
  }
}

module.exports = { judgeGesture };
