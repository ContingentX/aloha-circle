// Deterministic visitor↔local matcher (no LLM — the brandSense report is the
// only model output, and scoring over it is plain set overlap, per the repo
// rule that the matcher stays deterministic and testable).
//
// Gender gates strictly: a local is only eligible when their gender equals the
// visitor's VLM-read gender. An unknown/missing visitor gender matches anyone
// (the safe fallback — the VLM often cannot tell, and a wrong hard gate is
// worse than a soft one).

const WEIGHTS = { brands: 3, styles: 2, colors: 1, accessories: 1 };

export function normalizeGender(value) {
  const g = String(value || '').trim().toLowerCase();
  if (g === 'female' || g === 'woman' || g === 'f') return 'female';
  if (g === 'male' || g === 'man' || g === 'm') return 'male';
  return 'unknown';
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

// Two tags match when equal or one contains the other ("aloha shirt" vs
// "vintage aloha shirt"), so VLM phrasing wobble still scores.
function tagsOverlap(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function overlap(visitorList, localList) {
  const hits = [];
  for (const v of visitorList || []) {
    if ((localList || []).some((l) => tagsOverlap(v, l))) hits.push(v);
  }
  return hits;
}

// Report fields map onto local tag fields: clothingStyle ↔ styles.
const FIELDS = [
  { report: 'brands', local: 'brands', weight: WEIGHTS.brands, phrase: 'both wear' },
  { report: 'clothingStyle', local: 'styles', weight: WEIGHTS.styles, phrase: 'shared style' },
  { report: 'colors', local: 'colors', weight: WEIGHTS.colors, phrase: 'same colors' },
  { report: 'accessories', local: 'accessories', weight: WEIGHTS.accessories, phrase: 'both carry' },
];

export function scoreMatch(report, local) {
  let score = 0;
  const reasons = [];
  for (const f of FIELDS) {
    const hits = overlap(report?.[f.report], local?.[f.local]);
    if (!hits.length) continue;
    score += hits.length * f.weight;
    reasons.push(`${f.phrase}: ${hits.join(', ')}`);
  }
  return { score, reasons };
}

// Returns { local, score, reasons, pool } or null when no local is eligible.
// `seed` only breaks exact ties (including the all-zero no-report case) so
// identical inputs stay reproducible in tests.
export function pickMatch(report, locals, { seed = 0 } = {}) {
  const gender = normalizeGender(report?.gender);
  const pool = (locals || []).filter(
    (l) => gender === 'unknown' || normalizeGender(l.gender) === gender
  );
  if (!pool.length) return null;

  const scored = pool.map((local) => ({ local, ...scoreMatch(report, local) }));
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  const picked = top[Math.abs(seed | 0) % top.length];
  return { ...picked, pool: pool.length };
}
