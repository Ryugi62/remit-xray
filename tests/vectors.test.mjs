// Criterion 1: the JS engine reproduces an independent Python Decimal implementation
// on every real published quote in vectors/receipts.json to ±0.01 percentage point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTransferReceipt } from '../src/domain/receipt.js';
import { createReferenceBand } from '../src/domain/band.js';
import { auditReceipt } from '../src/domain/audit.js';

const { vectors } = JSON.parse(readFileSync(new URL('../vectors/receipts.json', import.meta.url)));

test('at least 9 vectors from ≥3 providers × ≥3 corridors', () => {
  assert.ok(vectors.length >= 9);
  const corridors = new Set(vectors.map((v) => `${v.input.sentCurrency}-${v.input.receivedCurrency}`));
  const providers = new Set(vectors.map((v) => v.input.provider));
  assert.ok(corridors.size >= 3, `corridors ${corridors.size}`);
  assert.ok(providers.size >= 3, `providers ${providers.size}`);
});

for (const v of vectors) {
  test(`vector ${v.id}`, () => {
    const parsed = createTransferReceipt(v.input);
    assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
    const band = createReferenceBand(v.band.observations);
    assert.equal(band.min, v.band.min);
    assert.equal(band.max, v.band.max);
    const a = auditReceipt(parsed.receipt, band);
    const e = v.expected;
    assert.ok(Math.abs(a.markup.low * 100 - e.markup_low_pct) <= 0.01);
    assert.ok(Math.abs(a.markup.high * 100 - e.markup_high_pct) <= 0.01);
    assert.ok(Math.abs(a.cost.totalPct.low * 100 - e.total_pct_low) <= 0.01);
    assert.ok(Math.abs(a.cost.totalPct.high * 100 - e.total_pct_high) <= 0.01);
    assert.equal(a.classification, e.classification);
  });
}

// Calibration against an outside measurement: Wise publishes, for every quote it collects, the markup
// over its own mid-market rate. Our band (daily rates, several sources) must contain that published
// markup within the measured tolerance — and the zero-markup quotes must never be called a markup or a promotion.
import { MEASUREMENT_TOLERANCE } from '../src/domain/audit.js';

const published = vectors.filter((v) => typeof v.published_markup_pct === 'number');

test('calibration: every published markup lies inside our range ± tolerance', () => {
  assert.ok(published.length >= 40, `only ${published.length} published markups`);
  const tol = MEASUREMENT_TOLERANCE * 100;
  const misses = published.filter((v) => v.published_markup_pct < v.expected.markup_low_pct - tol || v.published_markup_pct > v.expected.markup_high_pct + tol);
  assert.deepEqual(misses.map((v) => v.id), []);
});

test('calibration: zero-markup quotes (Wise) are "within-band" in every corridor', () => {
  const zero = published.filter((v) => v.published_markup_pct === 0);
  assert.ok(zero.length >= 5);
  for (const v of zero) assert.equal(v.expected.classification, 'within-band', v.id);
});
