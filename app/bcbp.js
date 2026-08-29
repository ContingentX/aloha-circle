// IATA BCBP (Resolution 792) boarding-pass barcode parser — mandatory items
// only, fixed-width. Works on the PDF417 payload from paper passes and the
// QR/Aztec payload from Apple/Google Wallet passes.
//
// Privacy: the barcode also carries the passenger name and PNR (which can
// access the airline booking). We deliberately return only route + date and
// never surface or persist the rest.

// Leg 1 mandatory-item offsets.
const FROM = [30, 33];
const TO = [33, 36];
const JULIAN = [44, 47];

// BCBP dates are a bare day-of-year with no year. Assume the flight is recent
// or upcoming: pick the candidate year whose date lands closest to today
// (handles scanning a January pass in late December and vice versa).
export function julianToISO(dayOfYear, today = new Date()) {
  const year = today.getFullYear();
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const d = new Date(Date.UTC(y, 0, dayOfYear));
    if (!best || Math.abs(d - today) < Math.abs(best - today)) best = d;
  }
  return best.toISOString().slice(0, 10);
}

export function parseBoardingPass(data, today = new Date()) {
  const raw = String(data ?? '');
  if (!/^M\d/.test(raw) || raw.length < 47) return null;
  const from = raw.slice(...FROM);
  const to = raw.slice(...TO);
  const julian = Number(raw.slice(...JULIAN));
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  if (!(julian >= 1 && julian <= 366)) return null;
  return { from, to, dateISO: julianToISO(julian, today) };
}
