// Acceptance tests added after mock-judging round 4 (2026-10-06 19:3x).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText, findDate } from '../src/domain/parse.js';
import { providerMessage } from '../src/application/report.js';

test('review4: account numbers are never dates; the real date is found', () => {
  assert.equal(findDate('출금계좌 123456-01-123456\n송금액 1,000,000원\n2026.10.05').value, '2026-10-05');
  assert.equal(findDate('Account 1234-56-78\nSend 1,000,000 KRW\n2026-10-05').value, '2026-10-05');
});

test('review4: more date forms (Vietnamese words, two-digit years)', () => {
  assert.equal(findDate('Ngày 05 tháng 10 năm 2026').value, '2026-10-05');
  assert.equal(findDate('26.10.05 14:32').value, '2026-10-05');
  assert.equal(findDate('10/5/26').options.length, 2);
});

test('review4: "Rs" on a Korea-sent receipt is Nepali; NRs. with a period is read', () => {
  let f = parseReceiptText('IME Pay\nSent: 1,000,000 KRW\nService charge: 5,000 KRW\nReceiver gets: Rs 98,520.50\nDate: 2026/10/05').fields;
  assert.equal(f.receivedCurrency.value, 'NPR');
  assert.equal(f.receivedCurrency.confidence, 'low');
  f = parseReceiptText('Sent: 1,000,000 KRW\nReceiver gets: NRs. 98,520.50').fields;
  assert.equal(f.receivedAmount.value, 98520.5);
});

test('review4: "Collected amount" is the total that left the account', () => {
  const p = parseReceiptText('Collected Amount 1,005,000 KRW\nService Charge 5,000 KRW\nPayout Amount 18,520,000 VND');
  assert.equal(p.fields.sentAmount.value, 1_005_000);
  assert.ok(p.hints.includes('SENT_IS_TOTAL'));
});

test('review4: Korean provider names are recognised', () => {
  assert.equal(parseReceiptText('한패스 해외송금\n송금액 1,000,000원\n받는 금액 19,294,193 VND').fields.provider.value, 'Hanpass');
  assert.equal(parseReceiptText('이나인페이\n송금액 1,000,000원\n받는 금액 19,101,734 VND').fields.provider.value, 'E9pay');
});

const result = {
  receipt: { provider: 'E9pay', date: '2026-10-06', sent: { amount: 1_005_000, currency: 'KRW' }, received: { amount: 19_101_734, currency: 'VND' } },
  band: { min: 19.31, max: 19.36, sources: ['currency-api', 'ExchangeRate-API'] },
  audit: { effectiveRate: 19.1017, classification: 'markup', cost: { fee: 5000, currency: 'KRW', total: { low: 16_200, high: 18_500 }, totalPct: { low: 0.0161, high: 0.0184 } } },
};

test('AC-14b a Korean version of the message for receipts sent from Korea', () => {
  const m = providerMessage(result, 'ko');
  for (const s of ['2026-10-06', '1,005,000', '19,101,734', '?']) assert.ok(m.includes(s), s);
  assert.match(m, /안녕하세요/);
  assert.doesNotMatch(m, /사기|불법/);
});

test('review4: official feeds retry a dropped connection (Nepal Rastra Bank flaked in a judge’s live run)', async () => {
  const { nrbSource } = await import('../src/adapters/rateSources.js');
  let calls = 0;
  const body = { data: { payload: [{ date: '2026-10-03', rates: [{ currency: { iso3: 'KRW', unit: 100 }, buy: '11.44', sell: '11.48' }] }] } };
  const src = nrbSource(async () => { calls += 1; if (calls < 3) throw new Error('UND_ERR_SOCKET'); return { status: 200, ok: true, json: async () => body }; });
  const r = await src.getRate('KRW', 'NPR', '2026-10-03');
  assert.equal(calls, 3);
  assert.ok(r.rate > 0);
});
