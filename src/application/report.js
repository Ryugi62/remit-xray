// Plain-text reports the user can copy: a question to the provider, and a summary of saved transfers.
// English on purpose — the provider's support desk and most complaint channels read it.

import { shiftDate } from '../domain/receipt.js';

const n = (x, digits = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const p = (x) => `${(x * 100).toFixed(2)}%`;
const sig = (x) => Number(x.toPrecision(6)).toString();

/** A factual question to the provider about the exchange-rate margin of one transfer. */
export function providerMessage(result) {
  const { receipt: r, band, audit: a } = result;
  const c = a.cost;
  return [
    `Hello${r.provider ? ` ${r.provider}` : ''},`,
    '',
    `On ${r.date} I sent ${n(r.sent.amount, r.sent.amount % 1 ? 2 : 0)} ${r.sent.currency} and ${n(r.received.amount, r.received.amount % 1 ? 2 : 0)} ${r.received.currency} arrived.`,
    `The fee shown was ${n(c.fee, c.fee % 1 ? 2 : 0)} ${c.currency}. The exchange rate applied works out to 1 ${r.sent.currency} = ${sig(a.effectiveRate)} ${r.received.currency}.`,
    `Published mid-market rates for that day and the day before were ${sig(band.min)}–${sig(band.max)} (${band.sources.join(', ')}).`,
    `So the total cost including the exchange-rate margin was about ${n(c.total.low)}–${n(c.total.high)} ${c.currency} (${p(c.totalPct.low)}–${p(c.totalPct.high)} of the amount).`,
    '',
    'Could you tell me what exchange-rate margin was applied to this transfer, and where it is shown before I pay?',
    '',
    'Thank you.',
    '(Calculated with Remit X-ray — https://ryugi62.github.io/remit-xray/)',
  ].join('\n');
}

/** Saved transfers, newest first, and the 12-month sum per sending currency. */
export function ledgerText(entries, today) {
  const since = shiftDate(today, -365);
  const lines = entries.map((e) => `${e.date} · ${e.provider || '—'} · ${n(e.sent.amount)} ${e.sent.currency} → ${n(e.received.amount)} ${e.received.currency} · cost ${n(Math.max(0, e.total.low))}–${n(Math.max(0, e.total.high))} ${e.sent.currency} (${p(Math.max(0, e.totalPct.low))}–${p(Math.max(0, e.totalPct.high))})`);
  const sums = {};
  for (const e of entries) {
    if (e.date <= since || e.date > today) continue;
    const s = (sums[e.sent.currency] ||= { low: 0, high: 0, count: 0 });
    s.low += Math.max(0, e.total.low); s.high += Math.max(0, e.total.high); s.count += 1;
  }
  const totals = Object.entries(sums).map(([cur, s]) => `Last 12 months: ${s.count} transfer${s.count === 1 ? '' : 's'}, ${n(s.low)}–${n(s.high)} ${cur} in costs (fee + exchange-rate margin).`);
  return ['My transfers — Remit X-ray', ...lines, '', ...totals].join('\n');
}
