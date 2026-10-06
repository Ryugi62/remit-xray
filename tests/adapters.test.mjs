// Contract tests for adapters with fake fetch (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyApiSource, frankfurterSource } from '../src/adapters/rateSources.js';
import { wiseQuotes } from '../src/adapters/marketQuotes.js';
import { localLedgerStore } from '../src/adapters/browser.js';

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('currency-api: reads rate for the date, falls back to mirror on network error', async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    if (url.includes('jsdelivr')) throw new Error('network');
    return res(200, { date: '2026-10-05', usd: { php: 62.74 } });
  };
  const r = await currencyApiSource(fetchFn).getRate('USD', 'PHP', '2026-10-05');
  assert.deepEqual(r, { rate: 62.74, date: '2026-10-05', url: seen[1] });
  assert.match(seen[0], /currency-api@2026-10-05\/v1\/currencies\/usd\.min\.json$/);
});

test('currency-api: unpublished date (404 on both) → null; missing pair → null', async () => {
  assert.equal(await currencyApiSource(async () => res(404)).getRate('USD', 'PHP', '2099-01-01'), null);
  assert.equal(await currencyApiSource(async () => res(200, { date: 'x', usd: {} })).getRate('USD', 'XXX', '2026-10-05'), null);
});

test('frankfurter: only ECB pairs, returns the fixing date it answered with', async () => {
  const src = frankfurterSource(async (url) => {
    assert.equal(url, 'https://api.frankfurter.dev/v1/2026-10-04?base=USD&symbols=PHP');
    return res(200, { date: '2026-10-02', rates: { PHP: 62.6 } });
  });
  assert.equal(src.supports('KRW', 'VND'), false);
  assert.equal(src.supports('USD', 'PHP'), true);
  assert.deepEqual(await src.getRate('USD', 'PHP', '2026-10-04'), { rate: 62.6, date: '2026-10-02', url: 'https://api.frankfurter.dev/v1/2026-10-04?base=USD&symbols=PHP' });
});

test('frankfurter: server error is thrown (the use case records SOURCE_ERROR)', async () => {
  await assert.rejects(frankfurterSource(async () => res(500)).getRate('USD', 'PHP', '2026-10-04'));
});

test('wise quotes: flattened and sorted by amount received', async () => {
  const q = await wiseQuotes(async () => res(200, { providers: [
    { name: 'A', quotes: [{ fee: 1, rate: 60, receivedAmount: 100, markup: 3, dateCollected: 't' }] },
    { name: 'B', quotes: [{ fee: 0, rate: 62, receivedAmount: 120, markup: 0.2, dateCollected: 't' }] },
    { name: 'C', quotes: [] },
  ] })).getQuotes('USD', 'PHP', 500);
  assert.deepEqual(q.quotes.map((x) => x.provider), ['B', 'A']);
});

test('ledger store survives broken storage', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s = localLedgerStore('k', broken);
  assert.deepEqual(s.load(), []);
  s.save([{ id: 1 }]);
  const mem = new Map();
  const ok = localLedgerStore('k', { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  ok.save([{ id: 1 }]);
  assert.deepEqual(ok.load(), [{ id: 1 }]);
});

test('open.er-api: answers only for the day of its snapshot, fetches once per base', async () => {
  let calls = 0;
  const { openErApiSource } = await import('../src/adapters/rateSources.js');
  const src = openErApiSource(async () => { calls += 1; return res(200, { result: 'success', time_last_update_unix: Date.UTC(2026, 9, 6, 0, 2) / 1000, rates: { VND: 19.318 } }); });
  assert.equal(await src.getRate('KRW', 'VND', '2026-10-05'), null);
  assert.deepEqual(await src.getRate('KRW', 'VND', '2026-10-06'), { rate: 19.318, date: '2026-10-06', url: 'https://open.er-api.com/v6/latest/KRW' });
  assert.equal(calls, 1);
});

test('Nepal Rastra Bank: mid of buy/sell per unit, both directions, payload date', async () => {
  const { nrbSource } = await import('../src/adapters/rateSources.js');
  const body = { data: { payload: [{ date: '2026-10-06', rates: [{ currency: { iso3: 'KRW', unit: 100 }, buy: '11.44', sell: '11.48' }, { currency: { iso3: 'USD', unit: 1 }, buy: '153.78', sell: '154.38' }] }] } };
  let seen;
  const src = nrbSource(async (url) => { seen = url; return res(200, body); });
  assert.equal(src.supports('KRW', 'NPR'), true);
  assert.equal(src.supports('NPR', 'USD'), true);
  assert.equal(src.supports('KRW', 'VND'), false);
  const r = await src.getRate('KRW', 'NPR', '2026-10-06');
  assert.ok(Math.abs(r.rate - 0.1146) < 1e-12);
  assert.equal(r.date, '2026-10-06');
  assert.match(seen, /nrb\.org\.np\/api\/forex\/v1\/rates\?from=2026-10-06&to=2026-10-06/);
  const back = await src.getRate('NPR', 'USD', '2026-10-06');
  assert.ok(Math.abs(back.rate - 1 / 154.08) < 1e-12);
  assert.equal(await nrbSource(async () => res(200, { data: { payload: [] } })).getRate('KRW', 'NPR', '2026-10-06'), null);
});

test('Central Bank of Uzbekistan: Rate/Nominal, DD.MM.YYYY date, both directions', async () => {
  const { cbuSource } = await import('../src/adapters/rateSources.js');
  let seen;
  const src = cbuSource(async (url) => { seen = url; return res(200, [{ Ccy: 'KRW', Rate: '8.76', Nominal: '1', Date: '06.10.2026' }]); });
  assert.equal(src.supports('KRW', 'UZS'), true);
  assert.equal(src.supports('KRW', 'VND'), false);
  const r = await src.getRate('KRW', 'UZS', '2026-10-06');
  assert.deepEqual({ rate: r.rate, date: r.date }, { rate: 8.76, date: '2026-10-06' });
  assert.match(seen, /cbu\.uz\/.*\/json\/KRW\/2026-10-06\/$/);
  const back = await src.getRate('UZS', 'KRW', '2026-10-06');
  assert.ok(Math.abs(back.rate - 1 / 8.76) < 1e-12);
  assert.equal(await cbuSource(async () => res(200, [])).getRate('KRW', 'UZS', '2026-10-06'), null);
});

test('frozen sources replay recorded observations (samples work offline and never drift)', async () => {
  const { frozenSources } = await import('../src/adapters/rateSources.js');
  const obs = [
    { source: 'currency-api', date: '2026-10-05', rate: 0.1146, url: 'u1' },
    { source: 'currency-api', date: '2026-10-06', rate: 0.1149, url: 'u2' },
    { source: 'ECB (Frankfurter)', date: '2026-10-05', rate: 1.1, url: 'u3' },
  ];
  const srcs = frozenSources(obs);
  assert.deepEqual(srcs.map((s) => s.name), ['currency-api', 'ECB (Frankfurter)']);
  assert.deepEqual(await srcs[0].getRate('KRW', 'NPR', '2026-10-06'), { rate: 0.1149, date: '2026-10-06', url: 'u2' });
  // ECB answered the 10-06 request with its 10-05 fixing
  assert.deepEqual(await srcs[1].getRate('X', 'Y', '2026-10-06'), { rate: 1.1, date: '2026-10-05', url: 'u3' });
  assert.equal(await srcs[1].getRate('X', 'Y', '2026-10-04'), null);
});

test('wise quotes carry the mid-market rate implied by their published markup', async () => {
  const q = wiseQuotes(async () => res(200, { providers: [{ name: 'P', quotes: [{ fee: 1, rate: 99, markup: 1, receivedAmount: 9801, dateCollected: 'x' }] }] }));
  const { quotes } = await q.getQuotes('USD', 'XXX', 100);
  assert.ok(Math.abs(quotes[0].mid - 100) < 1e-9);
});
