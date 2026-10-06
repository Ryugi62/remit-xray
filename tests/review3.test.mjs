// Acceptance tests added after mock-judging round 3 (2026-10-06 19:2x).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareWithQuotes } from '../src/domain/quotes.js';
import { compareToBenchmarks } from '../src/domain/impact.js';
import { currencyApiSource, frankfurterSource, nrbSource, cbuSource, openErApiSource } from '../src/adapters/rateSources.js';

test('AC-12e a better-than-mid-market offer is reported separately, never silently dropped', () => {
  const r = compareWithQuotes({ low: 0.0573, high: 0.0608 }, [
    { provider: 'Xoom', totalPct: { low: -0.02, high: -0.015 } },
    { provider: 'Instarem', totalPct: { low: 0.0008, high: 0.0046 } },
  ]);
  assert.equal(r.cheapest.provider, 'Instarem');
  assert.equal(r.offer.provider, 'Xoom');
  assert.equal(compareWithQuotes({ low: 0.01, high: 0.02 }, [{ provider: 'A', totalPct: { low: 0.001, high: 0.002 } }]).offer, null);
});

test('AC-19 SDG 10.c: corridors above 5 % are the ones the goal says to eliminate', () => {
  assert.equal(compareToBenchmarks({ low: 0.0573, high: 0.0608 }).above5, true);
  assert.equal(compareToBenchmarks({ low: 0.045, high: 0.055 }).above5, false); // only certain when even the low end is above 5 %
});

test('AC-20 each rate source says whether it is an official reference (central bank) or an aggregator', () => {
  assert.equal(frankfurterSource().official, true);
  assert.equal(nrbSource().official, true);
  assert.equal(cbuSource().official, true);
  assert.equal(currencyApiSource().official, false);
  assert.equal(openErApiSource().official, false);
});

test('UI: comparison bars share one fixed value column, so bar length always matches the number', () => {
  const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  const rule = css.match(/\.bench-row\s*\{[^}]*grid-template-columns:\s*([^;]+);/);
  assert.ok(rule, 'bench-row grid rule');
  assert.doesNotMatch(rule[1], /\bauto\b/);
});

import { parseReceiptText } from '../src/domain/parse.js';
import { createDraft, addFeeOnTop } from '../src/application/draft.js';
import { decodeReceipt, encodeReceipt } from '../src/application/share.js';

test('review3: "Total to recipient" is the received amount', () => {
  const { fields } = parseReceiptText('Amount sent: 500.00 USD\nFee: 3.99 USD\nTotal to recipient: 9,460.00 MXN');
  assert.equal(fields.sentAmount.value, 500);
  assert.equal(fields.fee.value, 3.99);
  assert.equal(fields.receivedAmount.value, 9460);
  assert.equal(fields.receivedCurrency.value, 'MXN');
});

test('review3: VNĐ, 동, Rs., NRs, रु are read in context', () => {
  const r = (t) => parseReceiptText(t).fields;
  assert.equal(r('Số tiền gửi: 1.000.000 KRW\nNhận: 18.450.000 VNĐ').receivedCurrency.value, 'VND');
  assert.equal(r('송금액 1,000,000원\n받는 금액 18,450,000동').receivedCurrency.value, 'VND');
  assert.equal(r('Send amount 1,000,000 KRW\nRecipient gets NRs 112,000').receivedCurrency.value, 'NPR');
  assert.equal(r('Send amount 1,000,000 KRW\nRecipient gets रु 112,000').receivedCurrency.value, 'NPR');
  assert.equal(r('Nepal transfer\nSend amount 1,000,000 KRW\nRecipient gets Rs. 112,000').receivedCurrency.value, 'NPR');
  assert.equal(r('Send amount 500 GBP\nRecipient gets Rs. 58,000').receivedCurrency.value, 'INR');
});

test('review3: an exchange-rate line is never an amount', () => {
  const { fields } = parseReceiptText('USD 500.00\n1 USD = 18.92 MXN\nMXN 9,460.00');
  assert.equal(fields.receivedAmount.value, 9460);
});

test('review3: two labelled amounts on one line keep their own labels ("Amount … Fee …")', () => {
  const { fields } = parseReceiptText('Amount 1,000.00 AUD Fee 0.00 AUD\nRecipient receives 17,013,489 VND');
  assert.equal(fields.sentAmount.value, 1000);
  assert.equal(fields.fee.value, 0);
  assert.equal(parseReceiptText('Total amount 1,005,000 KRW\nRecipient gets 19,101,734 VND').fields.sentAmount.value, 1_005_000);
});

test('review3: a bare "$" is flagged as ambiguous; a known Australian bank means AUD', () => {
  let p = parseReceiptText('Amount: $1,000.00\nRecipient receives 16,000,000 VND');
  assert.ok(p.hints.includes('DOLLAR_AMBIGUOUS'));
  assert.equal(p.fields.sentCurrency.confidence, 'low');
  p = parseReceiptText('Commonwealth Bank\nAmount: $1,000.00\nRecipient receives 16,000,000 VND');
  assert.equal(p.fields.sentCurrency.value, 'AUD');
});

test('review3: fee on top keeps the currency precision (KWD 1.005 + 0.0005)', () => {
  const d = addFeeOnTop(createDraft({ sentAmount: 1.005, sentCurrency: 'KWD', fee: 0.0005 }, 'pasted'));
  assert.equal(d.fields.sentAmount.value, 1.0055);
});

test('review3: share links strip bidirectional control characters from the provider', () => {
  const code = encodeReceipt({ provider: 'Bank‮evil', sentAmount: 1, sentCurrency: 'USD', fee: 0, receivedAmount: 2, receivedCurrency: 'PHP', date: '2026-10-06' });
  assert.equal(decodeReceipt(code).provider, 'Bankevil');
});

test('UI: banner buttons wrap on a phone instead of being cut off', () => {
  const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.banner-btns\s*\{[^}]*flex-wrap:\s*wrap/);
});
