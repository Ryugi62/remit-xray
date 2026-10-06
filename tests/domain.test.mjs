import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferReceipt, shiftDate } from '../src/domain/receipt.js';
import { createReferenceBand, bandSpread } from '../src/domain/band.js';
import { auditReceipt, effectiveRate, hiddenShare } from '../src/domain/audit.js';
import { yearlyImpact, compareToBenchmarks, SDG_TARGET } from '../src/domain/impact.js';

const base = { provider: 'X', sentAmount: 1_000_000, sentCurrency: 'KRW', fee: 0, receivedAmount: 18_600_000, receivedCurrency: 'VND', date: '2026-10-01' };
const band = (min, max) => createReferenceBand([{ source: 'a', date: '2026-10-01', rate: min }, { source: 'b', date: '2026-10-01', rate: max }]);
const receipt = (over = {}) => createTransferReceipt({ ...base, ...over }).receipt;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`);

test('AC-1 zero-fee KRW→VND: markup 2.36–2.72 %, cost ≈ 23,600–27,200 KRW', () => {
  const a = auditReceipt(receipt(), band(19.05, 19.12));
  near(a.markup.low * 100, 2.362, 0.001);
  near(a.markup.high * 100, 2.720, 0.001);
  near(a.cost.total.low, 23_622, 1);
  near(a.cost.total.high, 27_197, 1);
  assert.equal(a.classification, 'markup');
  assert.equal(a.cost.fee, 0);
});

test('AC-1 shortfall is expressed in the received currency', () => {
  const a = auditReceipt(receipt(), band(19.05, 19.12));
  assert.equal(a.shortfall.currency, 'VND');
  near(a.shortfall.low, 450_000, 1);
  near(a.shortfall.high, 520_000, 1);
});

test('AC-2 stated fee is added to the hidden markup', () => {
  const r = receipt({ fee: 5000, receivedAmount: 18_500_000 });
  const a = auditReceipt(r, band(19.05, 19.12));
  near(effectiveRate(r), 18_500_000 / 995_000, 1e-12);
  near(a.cost.total.low, 5000 + 995_000 * a.markup.low, 1e-6);
  assert.ok(a.cost.total.high > a.cost.hidden.high);
  near(a.cost.feePct, 0.005, 1e-12);
});

test('AC-2 fee-only provider inside the band is "within-band"', () => {
  const r = receipt({ fee: 10_000, receivedAmount: 990_000 * 19.08 });
  const a = auditReceipt(r, band(19.05, 19.12));
  assert.equal(a.classification, 'within-band');
  assert.ok(a.markup.low < 0 && a.markup.high > 0);
});

test('AC-3 effective rate above the band is labelled better-than-mid', () => {
  const a = auditReceipt(receipt({ receivedAmount: 19_300_000 }), band(19.05, 19.12));
  assert.equal(a.classification, 'better-than-mid');
  assert.ok(a.cost.hidden.high < 0);
});

test('hiddenShare: zero-fee transfer hides 100 % of its cost; fee-only hides ~0', () => {
  assert.equal(hiddenShare(auditReceipt(receipt(), band(19.05, 19.12))), 1);
  const feeOnly = auditReceipt(receipt({ fee: 10_000, receivedAmount: 990_000 * 19.085 }), band(19.05, 19.12));
  assert.ok(hiddenShare(feeOnly) < 0.01);
});

test('AC-8 validation rejects bad receipts with codes', () => {
  const bad = createTransferReceipt({ ...base, sentAmount: 0, fee: -1, receivedCurrency: 'KRW', date: '2026-13-01' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.sort(), ['DATE_FORMAT', 'FEE_NONNEGATIVE', 'SAME_CURRENCY', 'SENT_POSITIVE'].sort());
  assert.deepEqual(createTransferReceipt({ ...base, fee: 1_000_000 }).errors, ['FEE_LT_SENT']);
  assert.deepEqual(createTransferReceipt({ ...base, date: '2026-10-09' }, { today: '2026-10-06' }).errors, ['DATE_FUTURE']);
  assert.deepEqual(createTransferReceipt({ ...base, sentCurrency: '₩' }).errors, ['CURRENCY_FORMAT']);
});

test('receipt normalises currency case and defaults fee to 0', () => {
  const r = createTransferReceipt({ ...base, sentCurrency: 'krw', fee: '' });
  assert.equal(r.ok, true);
  assert.equal(r.receipt.sent.currency, 'KRW');
  assert.equal(r.receipt.fee.amount, 0);
  assert.ok(Object.isFrozen(r.receipt));
});

test('shiftDate crosses month and year boundaries', () => {
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
});

test('band dedupes same source+date and ignores invalid rates', () => {
  const b = createReferenceBand([
    { source: 'ECB', date: '2026-10-02', rate: 10 },
    { source: 'ECB', date: '2026-10-02', rate: 10 },
    { source: 'api', date: '2026-10-03', rate: 10.2 },
    { source: 'bad', date: '2026-10-03', rate: 0 },
    { source: 'nan', date: '2026-10-03', rate: NaN },
  ]);
  assert.equal(b.observations.length, 2);
  assert.deepEqual([...b.sources], ['ECB', 'api']);
  near(bandSpread(b), 0.02, 1e-12);
  assert.equal(createReferenceBand([]), null);
});

test('AC-5 yearly impact = total % × monthly × 12, flagged estimate', () => {
  const y = yearlyImpact({ low: 0.0236, high: 0.0272 }, 1_000_000);
  near(y.low, 283_200, 0.01);
  near(y.high, 326_400, 0.01);
  assert.equal(y.estimate, true);
  assert.equal(yearlyImpact({ low: 0.01, high: 0.02 }, 0), null);
  assert.equal(yearlyImpact({ low: -0.01, high: -0.005 }, 100).high, 0); // promo never shows as negative "savings"
});

test('benchmarks: SDG 3 % target and corridor average', () => {
  assert.equal(SDG_TARGET, 0.03);
  assert.deepEqual(compareToBenchmarks({ low: 0.04, high: 0.05 }, 0.0419), { sdg: 'above-target', vsAverage: 'around-average', above5: false });
  assert.deepEqual(compareToBenchmarks({ low: 0.01, high: 0.02 }, 0.0419), { sdg: 'below-target', vsAverage: 'below-average', above5: false });
  assert.deepEqual(compareToBenchmarks({ low: 0.025, high: 0.035 }), { sdg: 'straddles-target', vsAverage: null, above5: false });
});
