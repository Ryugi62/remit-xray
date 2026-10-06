import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTransfer } from '../src/application/auditTransfer.js';
import { createDraft, confirmField, confirmAll, readiness, toReceiptInput } from '../src/application/draft.js';
import { entryFromResult, addEntry, removeEntry, yearlySummary } from '../src/application/ledger.js';

const input = { provider: 'X', sentAmount: 1_000_000, sentCurrency: 'KRW', fee: 0, receivedAmount: 18_600_000, receivedCurrency: 'VND', date: '2026-10-01' };

function fakeSource(name, table, covers = () => true) {
  return {
    name,
    supports: covers,
    calls: [],
    async getRate(from, to, date) {
      this.calls.push(date);
      const r = table[date];
      if (r instanceof Error) throw r;
      return r ? { rate: r.rate, date: r.date || date, url: `fake://${name}/${date}` } : null;
    },
  };
}

test('use case asks every source for D-1 and D and builds the band', async () => {
  const a = fakeSource('A', { '2026-09-30': { rate: 19.05 }, '2026-10-01': { rate: 19.10 } });
  const b = fakeSource('B', { '2026-09-30': { rate: 19.12 }, '2026-10-01': { rate: 19.08 } });
  const r = await auditTransfer(input, { rateSources: [a, b], today: '2026-10-06' });
  assert.equal(r.ok, true);
  assert.deepEqual(a.calls.sort(), ['2026-09-30', '2026-10-01']);
  assert.equal(r.band.min, 19.05);
  assert.equal(r.band.max, 19.12);
  assert.equal(r.band.observations.length, 4);
  assert.equal(r.partial, false);
  assert.equal(r.hiddenShare, 1);
});

test('AC-4 a source without the pair is listed missing; band uses the rest', async () => {
  const a = fakeSource('currency-api', { '2026-09-30': { rate: 19.05 }, '2026-10-01': { rate: 19.1 } });
  const ecb = fakeSource('ECB', {}, () => false);
  const r = await auditTransfer(input, { rateSources: [a, ecb], today: '2026-10-06' });
  assert.equal(r.ok, true);
  assert.equal(r.partial, true);
  assert.deepEqual(r.missing, [{ source: 'ECB', reason: 'PAIR_NOT_COVERED' }]);
  assert.deepEqual([...r.band.sources], ['currency-api']);
});

test('AC-4 errors and empty answers from every source → NO_REFERENCE, never a guess', async () => {
  const a = fakeSource('A', { '2026-09-30': new Error('down'), '2026-10-01': new Error('down') });
  const b = fakeSource('B', {});
  const r = await auditTransfer(input, { rateSources: [a, b], today: '2026-10-06' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_REFERENCE');
  assert.ok(r.missing.some((m) => m.reason === 'SOURCE_ERROR'));
});

test('stale answers (older than 4 days) are rejected', async () => {
  const a = fakeSource('A', { '2026-09-30': { rate: 19, date: '2026-09-01' }, '2026-10-01': { rate: 19, date: '2026-09-01' } });
  const r = await auditTransfer(input, { rateSources: [a], today: '2026-10-06' });
  assert.equal(r.error, 'NO_REFERENCE');
});

test('invalid receipt never reaches the sources', async () => {
  const a = fakeSource('A', {});
  const r = await auditTransfer({ ...input, date: '2026-12-01' }, { rateSources: [a], today: '2026-10-06' });
  assert.equal(r.error, 'INVALID_RECEIPT');
  assert.deepEqual(r.details, ['DATE_FUTURE']);
  assert.equal(a.calls.length, 0);
});

test('AC-6 pasted fields start unconfirmed and block the audit until confirmed', () => {
  let d = createDraft({ sentAmount: { value: 1_000_000 }, sentCurrency: 'KRW', receivedAmount: 18_600_000, receivedCurrency: 'VND', date: '2026-10-01' }, 'pasted');
  assert.equal(readiness(d).ok, false);
  assert.equal(readiness(d).unconfirmed.length, 5);
  assert.throws(() => toReceiptInput(d), /DRAFT_NOT_READY/);
  d = confirmField(d, 'sentAmount', 1_000_001); // user corrects a misread digit
  assert.equal(d.fields.sentAmount.value, 1_000_001);
  assert.equal(d.fields.sentAmount.confirmed, true);
  d = confirmAll(d);
  assert.equal(readiness(d).ok, true);
  assert.equal(toReceiptInput(d).sentAmount, 1_000_001);
});

test('AC-6 typed and sample values are confirmed; missing required fields are named', () => {
  const d = createDraft({ sentAmount: 500, sentCurrency: 'USD' }, 'typed');
  assert.equal(d.fields.sentAmount.confirmed, true);
  assert.deepEqual(readiness(d).missing, ['receivedAmount', 'receivedCurrency', 'date']);
  assert.equal(createDraft({ fee: 0 }, 'photo').fields.fee.confirmed, false);
});

test('ledger keeps one entry per receipt and sums the last 12 months per currency', async () => {
  const a = fakeSource('A', { '2026-09-30': { rate: 19.05 }, '2026-10-01': { rate: 19.12 } });
  const r = await auditTransfer(input, { rateSources: [a], today: '2026-10-06' });
  let saved = [];
  const store = { load: () => saved.map((e) => ({ ...e })), save: (e) => { saved = e; } };
  const e = entryFromResult(r, '2026-10-06T10:00:00Z');
  addEntry(store, e);
  addEntry(store, e); // same receipt twice → one entry
  addEntry(store, { ...e, id: 'old', date: '2025-09-01' }); // older than a year → excluded from sum
  assert.equal(saved.length, 2);
  const [krw] = yearlySummary(saved, '2026-10-06');
  assert.equal(krw.count, 1);
  assert.ok(Math.abs(krw.high - 27_197) < 1);
  assert.equal(removeEntry(store, 'old').length, 1);
});

test('confirmFields confirms only the named fields (one tap per step), keeping their values', async () => {
  const { confirmFields } = await import('../src/application/draft.js');
  const d = createDraft({ sentAmount: 1000, sentCurrency: 'KRW', fee: 0, receivedAmount: 18000, receivedCurrency: 'VND' }, 'photo');
  const d2 = confirmFields(d, ['sentAmount', 'sentCurrency', 'fee']);
  assert.equal(d2.fields.sentAmount.confirmed, true);
  assert.equal(d2.fields.sentAmount.value, 1000);
  assert.equal(d2.fields.fee.confirmed, true);
  assert.equal(d2.fields.receivedAmount.confirmed, false);
  assert.deepEqual(readiness(d2).unconfirmed, ['receivedAmount', 'receivedCurrency']);
  const d3 = confirmFields(d, ['sentAmount', 'nope-not-present'].filter((n) => n in d.fields));
  assert.equal(d3.fields.sentAmount.confirmed, true);
});
