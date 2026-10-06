// Use case: audit one transfer against published mid-market rates.
//
// Port RateSource {
//   name: string
//   supports(from, to): boolean
//   getRate(from, to, date): Promise<null | {rate:number, date:string, url:string}>
// }

import { createTransferReceipt, corridorOf, shiftDate } from '../domain/receipt.js';
import { createReferenceBand } from '../domain/band.js';
import { auditReceipt, hiddenShare, plausibility } from '../domain/audit.js';

const MAX_STALE_DAYS = 4; // a source may answer with the last business day's fixing

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * @param {Object} input raw receipt fields
 * @param {{rateSources: Array, today: string}} deps
 */
export async function auditTransfer(input, { rateSources, today }) {
  const parsed = createTransferReceipt(input, { today });
  if (!parsed.ok) return { ok: false, error: 'INVALID_RECEIPT', details: parsed.errors };
  const receipt = parsed.receipt;
  const { from, to } = corridorOf(receipt);
  const dates = [shiftDate(receipt.date, -1), receipt.date];

  const observations = [];
  const missing = [];
  const jobs = [];
  for (const source of rateSources) {
    if (!source.supports(from, to)) {
      missing.push({ source: source.name, reason: 'PAIR_NOT_COVERED' });
      continue;
    }
    for (const date of dates) {
      jobs.push((async () => {
        try {
          const r = await source.getRate(from, to, date);
          if (!r) return { source: source.name, date, reason: 'NO_RATE_FOR_DATE' };
          const age = daysBetween(r.date, date);
          if (age < 0 || age > MAX_STALE_DAYS) return { source: source.name, date, reason: 'STALE_RATE' };
          observations.push({ source: source.name, date: r.date, rate: r.rate, url: r.url });
          return null;
        } catch (e) {
          return { source: source.name, date, reason: 'SOURCE_ERROR' };
        }
      })());
    }
  }
  const failures = (await Promise.all(jobs)).filter(Boolean);
  const band = createReferenceBand(observations);
  if (!band) return { ok: false, error: 'NO_REFERENCE', missing: [...missing, ...failures] };

  // a source counts as missing only if it produced nothing at all
  const answered = new Set(band.sources);
  for (const f of failures) {
    if (!answered.has(f.source) && !missing.some((m) => m.source === f.source)) missing.push({ source: f.source, reason: f.reason });
  }
  const audit = auditReceipt(receipt, band);
  if (plausibility(audit) !== 'ok') return { ok: false, error: 'IMPLAUSIBLE', receipt, band, audit, missing };
  return {
    ok: true,
    receipt,
    band,
    audit,
    hiddenShare: hiddenShare(audit),
    missing,
    partial: missing.length > 0,
  };
}
