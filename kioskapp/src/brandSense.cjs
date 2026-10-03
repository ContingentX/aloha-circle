// Brand / style capture via the sponsor VLM (W&B Inference by CoreWeave).
//
// Called once per ritual session with a single camera keyframe. Reuses the
// same OpenAI-compatible endpoint + env vars as the stall judge in cosmos.cjs
// (COSMOS_NIM_URL / COSMOS_MODEL / COSMOS_API_KEY) — google/gemma-4-31B-it on
// W&B Inference is verified to accept image input with our CoreWeave key.
//
// The report lands in two places: the session's JSON sidecar (recordings.cjs
// writes it next to the video, so it rides the existing VAST/VSS upload) and
// the admin-gated Detected Brands panel in the renderer.
//
// Degrades like cosmos.cjs: { ok:false, source: 'unset' | 'bad-input' |
// 'timeout' | 'error' | 'unparseable' | 'no-person' } — the kiosk never
// blocks on this call.

const ENDPOINT = process.env.COSMOS_NIM_URL || '';
const MODEL = process.env.COSMOS_MODEL || 'nvidia/cosmos3-nano-reasoner';
const API_KEY = process.env.COSMOS_API_KEY || process.env.NVIDIA_API_KEY || '';
const TIMEOUT_MS = Number(process.env.BRAND_TIMEOUT_MS) || 15000;

const BRAND_PROMPT = [
  'Look at the person in this image.',
  'Reply with ONLY a JSON object — no prose, no markdown fences — shaped exactly like:',
  '{"person":true,"gender":"unknown","brands":[],"clothing_style":[],"colors":[],"accessories":[]}',
  'gender: your best read of the person’s presented gender — "female", "male", or "unknown" if unsure.',
  'brands: brand names whose logo or lettering is clearly legible (empty if none).',
  'clothing_style: up to 3 short style descriptors (e.g. "aloha shirt", "athleisure").',
  'colors: dominant clothing colors.',
  'accessories: visible accessories (hat, glasses, lei, backpack, headphones).',
  'If no person is visible, reply {"person":false}.',
].join(' ');

function toList(value, cap = 6) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const s = String(item || '').trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

// The model is asked for bare JSON but may still wrap it in fences or prose —
// parse the outermost {...} span and normalize both snake_case and camelCase.
function parseBrandReport(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.person === false) return { person: false };
  const gender = String(parsed.gender || '').trim().toLowerCase();
  return {
    person: true,
    gender: gender === 'female' || gender === 'male' ? gender : 'unknown',
    brands: toList(parsed.brands),
    clothingStyle: toList(parsed.clothing_style ?? parsed.clothingStyle),
    colors: toList(parsed.colors),
    accessories: toList(parsed.accessories),
  };
}

async function analyzeBrands(imageDataUrl, options = {}) {
  const endpoint = options.endpoint ?? ENDPOINT;
  const model = options.model ?? MODEL;
  const apiKey = options.apiKey ?? API_KEY;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  if (!endpoint) return { ok: false, source: 'unset' };
  if (!imageDataUrl) return { ok: false, source: 'bad-input' };

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
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl } },
              { type: 'text', text: BRAND_PROMPT },
            ],
          },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`brand sense ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || '';
    const report = parseBrandReport(text);
    if (!report) return { ok: false, source: 'unparseable', raw: String(text).slice(0, 300) };
    if (report.person === false) return { ok: false, source: 'no-person' };
    return { ok: true, source: 'brand-sense', report };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error('brand sense timeout after', timeoutMs, 'ms');
      return { ok: false, source: 'timeout', error: 'Request timed out' };
    }

    console.error('brand sense fallback:', err.message);
    return { ok: false, source: 'error', error: err.message };
  }
}

module.exports = { analyzeBrands, parseBrandReport, BRAND_PROMPT };
