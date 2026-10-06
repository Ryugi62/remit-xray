// Acceptance tests added after mock-judging round 1 (2026-10-06): tolerance, plausibility,
// quote comparison, fee-on-top receipts, unconfirmed defaults, plain-text reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferReceipt } from '../src/domain/receipt.js';
import { createReferenceBand } from '../src/domain/band.js';
import { auditReceipt, plausibility, MEASUREMENT_TOLERANCE } from '../src/domain/audit.js';
import { quoteCost, compareWithQuotes } from '../src/domain/quotes.js';
import { auditTransfer } from '../src/application/auditTransfer.js';
import { createDraft, suggestField, addFeeOnTop, readiness } from '../src/application/draft.js';
import { ledgerText, providerMessage } from '../src/application/report.js';

const base = { provider: 'X', sentAmount: 1_000_000, sentCurrency: 'KRW', fee: 0, receivedAmount: 18_600_000, receivedCurrency: 'VND', date: '2026-10-01' };
const band = (min, max) => createReferenceBand([{ source: 'a', date: '2026-10-01', rate: min }, { source: 'b', date: '2026-10-01', rate: max }]);
const receipt = (over = {}) => createTransferReceipt({ ...base, ...over }).receipt;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`);
const source = (name, rate) => ({ name, supports: () => true, async getRate(f, t, date) { return { rate, date, url: `fake://${name}` }; } });

test('AC-10 measured tolerance is 0.30 percentage point', () => {
  assert.equal(MEASUREMENT_TOLERANCE, 0.003);
});

test('AC-10 a zero-margin provider just outside the band (≤ tolerance) is "within-band", not a promotion or a markup', () => {
  // 0.2 % above the band top: Wise-style mid taken at a different hour
  // (round 2: with a 0.37 %-wide band the honest answer may be "inconclusive" — never "markup" or "promotion")
  const ok = ['within-band', 'inconclusive'];
  const above = auditReceipt(receipt({ receivedAmount: 1_000_000 * 19.12 * 1.002 }), band(19.05, 19.12));
  assert.ok(ok.includes(above.classification), above.classification);
  // 0.2 % below the band bottom
  const below = auditReceipt(receipt({ receivedAmount: 1_000_000 * 19.05 * 0.998 }), band(19.05, 19.12));
  assert.ok(ok.includes(below.classification), below.classification);
  // a narrow band: 0.2 % outside is within tolerance at both ends
  assert.equal(auditReceipt(receipt({ receivedAmount: 1_000_000 * 19.1 * 1.002 }), band(19.09, 19.1)).classification, 'within-band');
  // 0.5 % below → a real markup
  assert.equal(auditReceipt(receipt({ receivedAmount: 1_000_000 * 19.05 * 0.995 }), band(19.05, 19.12)).classification, 'markup');
});

test('AC-11 implausible results are refused as probable typos', async () => {
  assert.equal(plausibility(auditReceipt(receipt(), band(19.05, 19.12))), 'ok');
  assert.equal(plausibility(auditReceipt(receipt({ receivedAmount: 186_000_000 }), band(19.05, 19.12))), 'IMPLAUSIBLE'); // ×10 typo → −876 %
  assert.equal(plausibility(auditReceipt(receipt({ sentAmount: 321_000_000 }), band(19.05, 19.12))), 'IMPLAUSIBLE'); // 99.7 % "margin"
  const r = await auditTransfer({ ...base, receivedAmount: 186_000_000 }, { rateSources: [source('A', 19.1)], today: '2026-10-06' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'IMPLAUSIBLE');
});

test('AC-12 quoteCost: fee plus margin against the mid-market rate, as % of the amount paid', () => {
  // pay 500, fee 1.99, receive 30,336.03 PHP; mid 62.78
  const c = quoteCost({ sent: 500, fee: 1.99, received: 30_336.03, mid: 62.78 });
  near(c.totalPct, (500 - 30_336.03 / 62.78) / 500, 1e-12);
  near(c.feePct, 1.99 / 500, 1e-12);
});

test('AC-12 compareWithQuotes ranks published quotes and your transfer on one cost scale', () => {
  const rows = compareWithQuotes({ low: 0.0156, high: 0.0184 }, [
    { provider: 'A', totalPct: { low: 0.005, high: 0.005 } },
    { provider: 'B', totalPct: { low: 0.03, high: 0.031 } },
  ]);
  assert.deepEqual(rows.rows.map((r) => r.provider || 'YOU'), ['A', 'YOU', 'B']);
  assert.equal(rows.rows[1].you, true);
  near(rows.cheapestMid, 0.005, 1e-12);
  near(rows.youMid - rows.cheapestMid, 0.012, 1e-9);
});

test('AC-13 fee added on top: sent becomes amount + fee (Hanpass-style receipt)', () => {
  const d = createDraft({ sentAmount: 1_000_000, sentCurrency: 'KRW', fee: 5000 }, 'pasted');
  const d2 = addFeeOnTop(d);
  assert.equal(d2.fields.sentAmount.value, 1_005_000);
  assert.equal(d2.fields.sentAmount.confirmed, true);
  assert.equal(d2.fields.fee.value, 5000);
  const a = auditReceipt(receipt({ sentAmount: 1_005_000, fee: 5000, receivedAmount: 19_294_193, date: '2026-10-06' }), band(19.43, 19.46));
  assert.equal(a.classification, 'markup');
});

test('AC-6b a default value suggested for a machine-read draft stays unconfirmed (yellow)', () => {
  const d = suggestField(createDraft({ sentAmount: 1 }, 'pasted'), 'date', '2026-10-06');
  assert.equal(d.fields.date.confirmed, false);
  assert.equal(d.fields.date.origin, 'default');
  assert.ok(readiness(d).unconfirmed.includes('date'));
  // an existing value is never overwritten by a suggestion
  const d2 = suggestField(createDraft({ date: '2026-10-01' }, 'pasted'), 'date', '2026-10-06');
  assert.equal(d2.fields.date.value, '2026-10-01');
});

const result = {
  receipt: { provider: 'GME Remit', date: '2026-10-06', sent: { amount: 1_000_000, currency: 'KRW' }, received: { amount: 112_854, currency: 'NPR' } },
  band: { min: 0.1146, max: 0.11497, sources: ['currency-api', 'Nepal Rastra Bank'] },
  audit: { effectiveRate: 0.112854, classification: 'markup', cost: { fee: 0, currency: 'KRW', total: { low: 15_200, high: 18_400 }, totalPct: { low: 0.0152, high: 0.0184 } } },
};

test('AC-14 providerMessage states the numbers and asks a question — no accusation, no advice', () => {
  const m = providerMessage(result);
  for (const s of ['2026-10-06', '1,000,000 KRW', '112,854 NPR', '0.112854', '0.1146', '0.11497', 'currency-api', 'Nepal Rastra Bank', '1.52%', '1.84%']) assert.ok(m.includes(s), `missing ${s}`);
  assert.match(m, /\?/);
  assert.doesNotMatch(m, /fraud|scam|illegal|cheat/i);
});

test('AC-14 ledgerText lists saved transfers and the 12-month sum per currency', () => {
  const entries = [
    { date: '2026-10-06', provider: 'GME Remit', sent: { amount: 1_000_000, currency: 'KRW' }, received: { amount: 112_854, currency: 'NPR' }, fee: 0, total: { low: 15_200, high: 18_400 }, totalPct: { low: 0.0152, high: 0.0184 } },
    { date: '2026-09-06', provider: 'GME Remit', sent: { amount: 1_000_000, currency: 'KRW' }, received: { amount: 112_000, currency: 'NPR' }, fee: 0, total: { low: 20_000, high: 23_000 }, totalPct: { low: 0.02, high: 0.023 } },
  ];
  const txt = ledgerText(entries, '2026-10-06');
  assert.match(txt, /2026-10-06 .*GME Remit/);
  assert.match(txt, /35,200–41,400 KRW/);
  assert.equal(txt.split('\n').filter((l) => l.startsWith('2026-')).length, 2);
});

test('ledgerText says "1 transfer" (singular)', () => {
  const e = { date: '2026-10-06', provider: 'P', sent: { amount: 100, currency: 'USD' }, received: { amount: 1, currency: 'PHP' }, fee: 0, total: { low: 1, high: 2 }, totalPct: { low: 0.01, high: 0.02 } };
  assert.match(ledgerText([e], '2026-10-06'), /1 transfer, /);
});
