// Live brand + object labels for the admin rail.
//
// Grok / Claude-Fable's YOLO path is the VAST DataEngine after upload — it
// does not paint the kiosk. This module is the live capture: pose events as
// labels, plus an optional VLM pass (same CoreWeave / Cosmos endpoint as the
// stall judge) for brand logos. Results render under the Debug switch and
// can be stamped onto the session sidecar.

export const BRAND_PROMPT =
  'List visible brand logos and notable objects in this kiosk camera frame. ' +
  'Watch especially for NVIDIA, VAST, CoreWeave, Roboflow, Weights & Biases, Cursor, Aloha Circle. ' +
  'Reply with JSON only: [{"name":"NVIDIA","kind":"brand"},{"name":"person","kind":"label"}]. ' +
  'If nothing is readable, reply [].';

const TTL_MS = 20000;
const MAX_ITEMS = 8;

export function formatPoseLabel(classified, dwell, expected) {
  if (classified && classified.event) {
    const pct = dwell && typeof dwell.progress === 'function'
      ? (dwell.progress(classified.event) * 100) | 0
      : 0;
    return `${classified.event}  ${pct}%`;
  }
  return expected ? `waiting: ${expected}` : 'no pose';
}

export function normalizeDetection(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name, kind: 'label', score: null } : null;
  }
  const name = String(raw.name || raw.class || raw.label || '').trim();
  if (!name) return null;
  const kind = raw.kind === 'brand' ? 'brand' : 'label';
  const score = Number.isFinite(raw.score) ? raw.score : null;
  return { name, kind, score };
}

export function parseBrandReply(text) {
  const raw = String(text || '').trim();
  if (!raw || raw === '[]') return [];
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeDetection).filter(Boolean);
      }
    } catch {
      // fall through to comma-list
    }
  }
  return raw
    .split(/[,;\n]/)
    .map((part) => normalizeDetection(part.replace(/^[-*]\s*/, '')))
    .filter(Boolean);
}

export function mergeDetections(existing, incoming, now = Date.now()) {
  const map = new Map();
  for (const item of existing || []) {
    const n = normalizeDetection(item);
    if (n) map.set(n.name.toLowerCase(), { ...n, at: item.at || now });
  }
  for (const item of incoming || []) {
    const n = normalizeDetection(item);
    if (!n) continue;
    map.set(n.name.toLowerCase(), { ...n, at: now });
  }
  return [...map.values()]
    .filter((item) => now - item.at <= TTL_MS)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'brand' ? -1 : 1;
      return (b.at || 0) - (a.at || 0);
    })
    .slice(0, MAX_ITEMS);
}

export function renderBrandList(items) {
  if (!items || items.length === 0) {
    return '<span class="brand-empty">no labels yet</span>';
  }
  return items
    .map((item) => {
      const kind = item.kind === 'brand' ? 'brand' : 'label';
      const name = String(item.name)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span class="brand-chip brand-chip--${kind}">${name}</span>`;
    })
    .join('');
}

export function createBrandSense({ listEl, describe, snapshot, onChange, intervalMs = 8000 } = {}) {
  let items = [];
  let timer = 0;
  let stopped = true;

  const paint = () => {
    if (listEl) listEl.innerHTML = renderBrandList(items);
  };

  const push = (incoming) => {
    items = mergeDetections(items, incoming);
    paint();
    if (typeof onChange === 'function') onChange(items);
    return items;
  };

  const tick = async () => {
    if (stopped || typeof describe !== 'function' || typeof snapshot !== 'function') return;
    try {
      const image = snapshot();
      if (!image) return;
      const result = await describe(image, BRAND_PROMPT);
      if (result?.ok && result.text) push(parseBrandReply(result.text));
    } catch (err) {
      console.warn('[brands] describe skipped', err);
    }
  };

  return {
    push,
    snapshot() {
      return items.map((item) => ({ name: item.name, kind: item.kind, score: item.score }));
    },
    start() {
      stopped = false;
      paint();
      if (typeof describe === 'function') {
        clearInterval(timer);
        timer = setInterval(tick, intervalMs);
        tick();
      }
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = 0;
    },
  };
}
