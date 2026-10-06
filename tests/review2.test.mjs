// Acceptance tests added after mock-judging round 2 (2026-10-06 19:xx).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferReceipt } from '../src/domain/receipt.js';
import { createReferenceBand } from '../src/domain/band.js';
import { auditReceipt, plausibility } from '../src/domain/audit.js';
import { compareWithQuotes, quoteCostRange, scaleQuote, savingVs } from '../src/domain/quotes.js';
import { parseReceiptText, parseAmount } from '../src/domain/parse.js';
import { encodeReceipt, decodeReceipt } from '../src/application/share.js';
import { collectBand } from '../src/application/auditTransfer.js';

const base = { provider: 'X', sentAmount: 500, sentCurrency: 'USD', fee: 0, receivedAmount: 9_400, receivedCurrency: 'MXN', date: '2026-10-02' };
const receipt = (over = {}) => createTransferReceipt({ ...base, ...over }).receipt;
const band = (min, max) => createReferenceBand([{ source: 'a', date: '2026-10-02', rate: min }, { source: 'b', date: '2026-10-02', rate: max }]);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`);

test('AC-15 a wide band that cannot separate "no margin" from a real one is "inconclusive", not "within-band"', () => {
  // margin 0.25 %–1.61 %: the low end is within tolerance, the high end is not
  const eff = 18.75;
  const a = auditReceipt(receipt({ receivedAmount: 500 * eff }), band(eff / (1 - 0.0025), eff / (1 - 0.0161)));
  assert.equal(a.classification, 'inconclusive');
  // both ends inside ±0.30 pp → within-band
  assert.equal(auditReceipt(receipt({ receivedAmount: 500 * eff }), band(eff / (1 - 0.001), eff / (1 - 0.0025))).classification, 'within-band');
  // range straddling zero widely (−0.67 %…+2.58 %) → inconclusive
  assert.equal(auditReceipt(receipt({ sentCurrency: 'KRW', receivedCurrency: 'VND', sentAmount: 1000, receivedAmount: 1_510_000 }), band(1500, 1550)).classification, 'inconclusive');
  // clearly above tolerance at both ends → markup
  assert.equal(auditReceipt(receipt({ receivedAmount: 500 * eff }), band(eff / (1 - 0.01), eff / (1 - 0.02))).classification, 'markup');
});

test('AC-11b a fee above 20 % of the amount is refused as a probable mistake', () => {
  const a = auditReceipt(receipt({ sentAmount: 10_500, fee: 10_000, receivedAmount: 9_400 }), band(18.8, 18.9));
  assert.equal(plausibility(a), 'IMPLAUSIBLE');
});

test('AC-12b promotional quotes (better than mid-market) are never "the cheapest"', () => {
  const r = compareWithQuotes({ low: 0.05, high: 0.06 }, [
    { provider: 'Promo', totalPct: { low: -0.01, high: -0.005 } },
    { provider: 'A', totalPct: { low: 0.005, high: 0.006 } },
  ]);
  assert.equal(r.cheapest.provider, 'A');
  near(r.cheapestMid, 0.0055, 1e-12);
});

test('AC-12c quoteCostRange scores a quote against the same reference band as your transfer', () => {
  const b = { min: 62.6, max: 62.8 };
  const c = quoteCostRange({ sent: 500, fee: 1.99, received: 30_336.03 }, b);
  near(c.low, (500 - 30_336.03 / 62.6) / 500, 1e-12);
  near(c.high, (500 - 30_336.03 / 62.8) / 500, 1e-12);
});

test('AC-12d a fixed-fee quote recorded at ₩1,000,000 is rescaled to your amount', () => {
  // fee 5,000 on top, margin 1.1–1.3 % of the converted amount
  const q = scaleQuote({ fee: 5000, markup: { low: 0.011, high: 0.013 } }, 205_000);
  near(q.low, (5000 + 200_000 * 0.011) / 205_000, 1e-12);
  near(q.high, (5000 + 200_000 * 0.013) / 205_000, 1e-12);
  assert.equal(scaleQuote({ fee: 5000, markup: { low: 0.01, high: 0.01 } }, 4000), null); // fee larger than the amount
});

test('AC-16 savingVs: what switching to the cheapest listed option would have kept, in money', () => {
  const s = savingVs({ low: 0.0573, high: 0.0608 }, 0.0053, 1000);
  near(s.low, 1000 * (0.0573 - 0.0053), 1e-9);
  near(s.high, 1000 * (0.0608 - 0.0053), 1e-9);
  assert.equal(savingVs({ low: 0.004, high: 0.005 }, 0.0053, 1000), null); // you were already the cheapest
});

test('review2: Korean bank outbound SMS — 출금 is what left the account, USD is what arrives', () => {
  const { fields } = parseReceiptText('[KB국민]해외송금\n2026.10.05 14:32\nUSD 500.00 송금\n수수료 10,000원\n출금 682,350원');
  assert.equal(fields.sentAmount.value, 682_350);
  assert.equal(fields.sentCurrency.value, 'KRW');
  assert.equal(fields.fee.value, 10_000);
  assert.equal(fields.receivedAmount.value, 500);
  assert.equal(fields.receivedCurrency.value, 'USD');
  assert.equal(fields.date.value, '2026-10-05');
});

test('review2: a fee in another currency is not silently relabelled', () => {
  const { fields, hints } = parseReceiptText('Send amount: 1,000,000 KRW\nFee: 5 USD\nRecipient gets: 18,600,000 VND');
  assert.equal(fields.fee, undefined);
  assert.ok(hints.includes('FEE_OTHER_CURRENCY'));
});

test('review2: more currency symbols (MX$, A$, C$, S$, HK$, NT$, Rp, ৳, 円)', () => {
  const cur = (t) => parseReceiptText(`Amount sent: 500 USD\nRecipient gets: ${t}`).fields.receivedCurrency.value;
  assert.equal(cur('MX$9,475.00'), 'MXN');
  assert.equal(cur('Rp 7,900,000'), 'IDR');
  assert.equal(cur('৳ 60,000'), 'BDT');
  assert.equal(cur('75,000円'), 'JPY');
  assert.equal(parseReceiptText('Amount sent: A$1,000\nRecipient gets: 17,013,489 VND').fields.sentCurrency.value, 'AUD');
  assert.equal(parseReceiptText('Amount sent: C$700\nRecipient gets: 30,000 PHP').fields.sentCurrency.value, 'CAD');
});

test('review2: an ambiguous dd/mm vs mm/dd date offers both readings', () => {
  const { fields, dateOptions } = parseReceiptText('Thời gian: 05/10/2026\nAmount sent: 1,000,000 KRW\nRecipient gets: 18,600,000 VND');
  assert.deepEqual([...dateOptions].sort(), ['2026-05-10', '2026-10-05']);
  assert.equal(fields.date.confidence, 'low');
  assert.equal(parseReceiptText('13/10/2026 500 USD 30,000 PHP').dateOptions, undefined);
});

test('review2: typed amounts in receipt formats are read as numbers', () => {
  assert.equal(parseAmount('1,000,000', 'KRW'), 1_000_000);
  assert.equal(parseAmount('1.000.000', 'VND'), 1_000_000);
  assert.equal(parseAmount('2,5', 'EUR'), 2.5);
  assert.equal(parseAmount('1.000', 'EUR'), 1000);
});

test('AC-17 share links carry the receipt (and nothing else) and round-trip', () => {
  const r = { provider: 'GME Remit', sentAmount: 1_000_000, sentCurrency: 'KRW', fee: 0, receivedAmount: 112_854, receivedCurrency: 'NPR', date: '2026-10-06' };
  const code = encodeReceipt(r);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeReceipt(code), r);
  assert.equal(decodeReceipt('not-a-receipt'), null);
  assert.equal(decodeReceipt(encodeReceipt({ ...r, sentCurrency: 'K<script>' })), null);
});

test('collectBand gathers D-1..D from every source for any pair (used for today’s quotes too)', async () => {
  const src = { name: 'A', supports: () => true, async getRate(f, t, d) { return { rate: d === '2026-10-06' ? 2 : 1, date: d, url: 'u' }; } };
  const { band, missing } = await collectBand('USD', 'PHP', '2026-10-06', [src]);
  assert.equal(band.min, 1);
  assert.equal(band.max, 2);
  assert.deepEqual(missing, []);
});

test('AC-15b no evidence of a margin (whole range ≤ +0.30 pp) is "within-band" even if the low end is far below', () => {
  const eff = 18.75;
  assert.equal(auditReceipt(receipt({ receivedAmount: 500 * eff }), band(eff / (1 - 0.0011), eff / (1 + 0.004))).classification, 'within-band');
});

test('review2: a receipt that shows the total withdrawn says so (no "fee on top?" question needed)', () => {
  const { hints } = parseReceiptText('[KB국민]해외송금\nUSD 500.00 송금\n수수료 10,000원\n출금 682,350원');
  assert.ok(hints.includes('SENT_IS_TOTAL'));
});
