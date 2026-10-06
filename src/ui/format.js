// Presentation helpers (pure; tested in tests/format.test.mjs).

const ZERO_DECIMAL = new Set('KRW VND JPY UZS IDR KHR MMK LAK CLP UGX TZS MNT PYG'.split(' '));

/** Round to 3 significant digits for amounts ≥ 1000 — a range should not pretend to be exact. */
export function roundNice(x) {
  const a = Math.abs(x);
  if (a < 1000) return Math.round(x * 100) / 100;
  const p = 10 ** (Math.floor(Math.log10(a)) - 2);
  return Math.round(x / p) * p;
}

export function money(x, currency, locale = 'en-US', { nice = true } = {}) {
  const v = nice ? roundNice(x) : x;
  const digits = ZERO_DECIMAL.has(currency) || Math.abs(v) >= 1000 ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  } catch {
    return `${v.toLocaleString(locale)} ${currency}`;
  }
}

/** ["₩15,600", "₩18,400"], or one element when both ends print the same. Negative ends are shown as 0. */
export function rangeParts(r, currency, locale) {
  const lo = money(Math.max(0, r.low), currency, locale);
  const hi = money(Math.max(0, r.high), currency, locale);
  return lo === hi ? [lo] : [lo, hi];
}

/** "₩15,600 – ₩18,400"; collapses when both ends print the same. */
export function moneyRange(r, currency, locale) {
  return rangeParts(r, currency, locale).join(' – ');
}

export function pct(x, locale = 'en-US', digits = 2) {
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

export function pctRange(r, locale) {
  const lo = pct(Math.max(0, r.low), locale);
  const hi = pct(Math.max(0, r.high), locale);
  return lo === hi ? lo : `${lo} – ${hi}`;
}

/** Exchange rate with 5 significant digits (19.318, 0.11465, 1346.6). */
export function rate(x, locale = 'en-US') {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 5 }).format(x);
}

/** Most recent mid-market rate in a band (mean of observations on the latest date). */
export function latestMid(band) {
  const latest = band.observations.reduce((d, o) => (o.date > d ? o.date : d), '');
  const same = band.observations.filter((o) => o.date === latest);
  return { date: latest, rate: same.reduce((s, o) => s + o.rate, 0) / same.length };
}
