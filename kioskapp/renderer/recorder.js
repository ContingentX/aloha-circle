// Records the visitor's camera feed for the length of one ritual session.
// Lifecycle: begin(stream) when the visitor leaves the attract screen,
// mark(stageId) on every stage, then finish() -> {blob, meta} or discard().

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

// Hard ceiling on one session's footage. A lid-close mid-ritual once left the
// recorder running for 3h51m (345 MB of chunks in renderer memory); any ritual
// longer than this is abandoned hardware, not a visitor.
const MAX_RECORD_MS = 15 * 60 * 1000;

export function createSessionRecorder() {
  let rec = null;
  let chunks = [];
  let meta = null;
  let startedAt = 0;

  function begin(stream) {
    discard();
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    rec = r;
    r.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
      // finish() handles an already-inactive recorder, so capping here is safe.
      if (Date.now() - startedAt > MAX_RECORD_MS && r.state === 'recording') {
        try { r.stop(); } catch { /* already stopping */ }
      }
    };
    r.start(1000);
    startedAt = Date.now();
    meta = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date(startedAt).toISOString(),
      kiosk: 'breath-of-aloha',
      stages: [],
      labels: [],
    };
  }

  function mark(stageId) {
    if (meta) meta.stages.push({ id: stageId, atMs: Date.now() - startedAt });
  }

  function noteLabels(items) {
    if (!meta || !Array.isArray(items)) return;
    const seen = new Set(meta.labels.map((item) => String(item.name || '').toLowerCase()));
    for (const item of items) {
      const name = String(item && item.name ? item.name : '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      meta.labels.push({
        name,
        kind: item.kind === 'brand' ? 'brand' : 'label',
        atMs: Date.now() - startedAt,
      });
    }
  }

  function active() {
    return !!rec;
  }

  function reachedStage(stageId) {
    return !!meta && meta.stages.some((s) => s.id === stageId);
  }

  function discard() {
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* already stopped */ }
    }
    rec = null;
    chunks = [];
    meta = null;
  }

  function finish() {
    return new Promise((resolve, reject) => {
      if (!rec) return reject(new Error('no active recording'));
      const recorder = rec;
      const finished = meta;
      recorder.onstop = () => {
        finished.endedAt = new Date().toISOString();
        finished.durationMs = Date.now() - startedAt;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        rec = null;
        chunks = [];
        meta = null;
        resolve({ blob, meta: finished });
      };
      recorder.onerror = (e) => reject(e.error || new Error('recorder error'));
      if (recorder.state === 'inactive') recorder.onstop();
      else recorder.stop();
    });
  }

  return { begin, mark, noteLabels, active, reachedStage, discard, finish };
}
