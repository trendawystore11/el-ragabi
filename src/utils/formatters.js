/**
 * Utility Formatters — pure display/number/date helpers.
 * Ported verbatim from js/utils/formatters.js (legacy).
 * No window / document / localStorage access — pure functions only.
 * العملة وتنسيقها + المنطقة الزمنية للنظام تُقرأ من ملف التخصيص المركزي.
 */
import { CLIENT } from '../client/config.js'

/** V3.15 — NaN-immunity for all aggregation math. */
export function toNumber(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** V3.16.1 — Unified money-rounding helper (banker-safe base-10 exponential scaling). */
export function round2(v) {
  const n = Number(v);
  if (isNaN(n) || !isFinite(n)) return 0;
  // e-notation trick gives exact decimal rounding, but for sub-cent float
  // artifacts (|n| < 1e-6) String(n) becomes exponential ("3.6e-12") and the
  // concatenated "3.6e-12e2" fails to parse → NaN. A sub-cent residue must
  // round to 0, never NaN.
  const r = Number(Math.round(Math.abs(n) + 'e2') + 'e-2');
  if (isNaN(r)) return 0;
  return r * Math.sign(n);
}

/** Converts monetary amount to integer subunits (piastres/cents) */
export function toSubunits(v, factor = 100) {
  const n = Number(v);
  if (isNaN(n) || !isFinite(n)) return 0;
  const f = Number(factor);
  if (!isFinite(f) || f <= 0) return round2(n);
  // V3.58 — Honour the factor (the old code hard-coded e2). For the common
  // power-of-10 factors (100 → 'e2') keep the exact legacy banker rounding;
  // any other factor scales by plain multiplication.
  const exp = Math.round(Math.log10(f));
  if (Math.pow(10, exp) === f) {
    return Math.round(Number(Math.abs(n) + 'e' + exp)) * Math.sign(n);
  }
  return Math.round(Math.abs(n) * f) * Math.sign(n);
}

/** Converts integer subunits back to rounded 2-decimal currency float */
export function fromSubunits(subunits, factor = 100) {
  const s = Number(subunits);
  if (isNaN(s) || !isFinite(s)) return 0;
  return round2(s / factor);
}


/** V3.62 — رمز العملة الفعلي (فارغ = النظام بدون عملة، لا يظهر أي رمز في أي مكان). */
export function currencySymbol() {
  return (CLIENT.currency.symbol || '').trim();
}

/** V3.62 — لاحقة مبلغ: " <رمز>" أو "" عند غياب العملة. */
export function currencySuffix() {
  const s = currencySymbol();
  return s ? ' ' + s : '';
}

/** V3.62 — تسمية وحدة مع عملة: "قيمة المصروف (ج.م)" أو "قيمة المصروف" عند غيابها. */
export function labelWithCurrency(unit) {
  const s = currencySymbol();
  return unit + (s ? ' (' + s + ')' : '');
}

export function formatCurrency(amount) {
  const r = Math.round((Number(amount) || 0) * 100) / 100;
  const hasFraction = r % 1 !== 0;
  const nf = new Intl.NumberFormat(CLIENT.currency.locale, hasFraction
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
  return nf.format(r) + currencySuffix();
}

/** V3.61 — Western-digit full currency string ("4,101,227.33 ج.م") for tooltips/details. */
export function formatCurrencyEn(amount) {
  const r = Math.round((Number(amount) || 0) * 100) / 100;
  const hasFraction = r % 1 !== 0;
  const nf = new Intl.NumberFormat('en-US', hasFraction
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
  return nf.format(r) + currencySuffix();
}

/** V3.61 — Compact K/M display with Western digits; full value belongs in a tooltip. */
export function formatCompactCurrency(amount) {
  const n = round2(Number(amount) || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const suffix = currencySuffix();
  if (abs >= 1e6) return sign + compactNum(abs / 1e6) + 'M' + suffix;
  if (abs >= 1e3) return sign + compactNum(abs / 1e3) + 'K' + suffix;
  return formatCurrencyEn(n);
}

function compactNum(x) {
  const r = Math.round(x * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

/** V3.15 — Unified ISO/Standard display timestamp: YYYY-MM-DD HH:mm */
export function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
  } catch {
    return String(isoString);
  }
}

/** Precise banking-style timestamp formatter: YYYY-MM-DD HH:mm:ss */
export function formatDateTime(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return isoString;
  }
}

/** V3.15 — Composite phone display helper (Fallback). */
export function formatPhonePair(primary, secondary) {
  const p = String(primary || '').trim();
  const s = String(secondary || '').trim();
  if (p) return s ? p + ' / ' + s : p;
  return s || '—';
}

/** V3.15 — Full address display helper: never truncates, collapses empty to '—'. */
export function formatAddress(address) {
  const s = String(address || '').trim();
  return s || '—';
}

/** Region (CLIENT.region.timeZone) local timestamp formatter: YYYY-MM-DD HH:mm */
export function getCairoFormattedDate(date = new Date()) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: CLIENT.region.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
  } catch {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

/**
 * V3.58 — Cairo date-only string (YYYY-MM-DD) in the system timezone.
 * Replaces the UTC-based `new Date().toISOString().slice(0, 10)` so day-scoped
 * filters (AI summaries, daily answers) agree with the Cairo-formatted
 * timestamps stored on documents instead of drifting near midnight.
 */
export function getCairoDate(date = new Date()) {
  return getCairoFormattedDate(date).slice(0, 10);
}

export function generateAutoId(prefix = 'ID') {
  // Phase 2 — the compat bridge exposes this generator on window. The legacy
  // harnesses replace window.generateAutoId with a deterministic stub so stress
  // suites (60+ IDs) never collide. Delegate when a DIFFERENT function is
  // installed; otherwise (normal app / vitest / node) behave byte-identically.
  if (typeof window !== 'undefined' && typeof window.generateAutoId === 'function' && window.generateAutoId !== generateAutoId) {
    return window.generateAutoId(prefix);
  }
  // V3.58 — Stronger IDs: base36 timestamp + 6 random base36 chars. The old
  // 4-digit numeric suffix (PAY-1234) only had ~9k combinations and collided
  // under heavy generation (stress suites, POS, imports).
  const ts = Date.now().toString(36);
  let rand = '';
  while (rand.length < 6) rand += Math.random().toString(36).slice(2);
  rand = rand.slice(0, 6);
  return `${prefix}-${ts}${rand}`;
}

// =============================================================================
// V3.57 — ATOMIC INCREMENT MARKERS (Finding B1)
// -----------------------------------------------------------------------------
// `increment(n)` produces a tiny marker `{ __inc: n }` that a single atomic
// Firestore WriteBatch (db.js runAtomicBatch / compat.withBatch) understands:
//   - the local mirror resolves it numerically (current + n) exactly like the
//     legacy sync math, so in-memory UI state never holds a marker object;
//   - the cloud commit translates it to `FieldValue.increment(n)` so the server
//     performs the arithmetic atomically (never a read-modify-write race).
// Used by stock decrement/increment flows (decrementProductStock,
// incrementProductStock). Fields WITHOUT a marker pass through untouched.
// =============================================================================

export function increment(amount) {
  const n = round2(Number(amount) || 0);
  return { __inc: n };
}

export function isIncrementField(value) {
  return !!(value && typeof value === 'object' && typeof value.__inc === 'number');
}

/**
 * Resolve increment markers against an existing document (or plain object):
 * marker fields become `current + n` (numeric); every other field passes as-is.
 */
export function resolveIncrementFields(current, fields) {
  const out = {};
  for (const key in fields) {
    const value = fields[key];
    if (isIncrementField(value)) {
      out[key] = round2((Number(current && current[key]) || 0) + value.__inc);
    } else {
      out[key] = value;
    }
  }
  return out;
}
