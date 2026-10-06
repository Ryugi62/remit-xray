import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, findAmounts, findDate, parseReceiptText } from '../src/domain/parse.js';

test('AC-9 amounts in four number styles', () => {
  assert.equal(parseAmount('1,000,000'), 1_000_000);
  assert.equal(parseAmount('1.000.000'), 1_000_000);
  assert.equal(parseAmount('500.00'), 500);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('18.600', 'VND'), 18_600);
  assert.equal(parseAmount('18.600', 'USD'), 18.6);
  assert.equal(parseAmount('1 000 000'), 1_000_000);
  assert.equal(parseAmount('abc'), null);
});

test('AC-9 currency codes and symbols, prefix and suffix', () => {
  assert.deepEqual(findAmounts('₩1,000,000'), [{ amount: 1_000_000, currency: 'KRW' }]);
  assert.deepEqual(findAmounts('1,000,000원'), [{ amount: 1_000_000, currency: 'KRW' }]);
  assert.deepEqual(findAmounts('18.600.000 ₫'), [{ amount: 18_600_000, currency: 'VND' }]);
  assert.deepEqual(findAmounts('USD 500.00'), [{ amount: 500, currency: 'USD' }]);
  assert.deepEqual(findAmounts('₱30,336.03'), [{ amount: 30336.03, currency: 'PHP' }]);
  assert.deepEqual(findAmounts('1,000,000 KRW 18,600,000 VND'),
    [{ amount: 1_000_000, currency: 'KRW' }, { amount: 18_600_000, currency: 'VND' }]);
  assert.deepEqual(findAmounts('Ref FEE 123'), []);
});

test('AC-9 dates in five forms', () => {
  assert.equal(findDate('2026-10-05 14:02').value, '2026-10-05');
  assert.equal(findDate('2026.10.05').value, '2026-10-05');
  assert.equal(findDate('Oct 5, 2026').value, '2026-10-05');
  assert.equal(findDate('2026년 10월 5일').value, '2026-10-05');
  assert.equal(findDate('10/05/2026').value, '2026-10-05');
  assert.equal(findDate('ngày 05/10/2026').value, '2026-10-05');
  assert.equal(findDate('10/05/2026').confidence, 'low');
  assert.equal(findDate('no date'), null);
});

test('English receipt with labels: total is used as the amount sent', () => {
  const { fields, hints } = parseReceiptText([
    'Western Union',
    'Transfer date: Oct 5, 2026',
    'Amount to send: USD 500.00',
    'Transfer fee: USD 1.99',
    'Total: USD 501.99',
    'Exchange rate: 1 USD = 60.9145 PHP',
    'Recipient gets: PHP 30,336.03',
  ].join('\n'));
  assert.equal(fields.sentAmount.value, 501.99);
  assert.equal(fields.sentCurrency.value, 'USD');
  assert.equal(fields.fee.value, 1.99);
  assert.equal(fields.receivedAmount.value, 30336.03);
  assert.equal(fields.receivedCurrency.value, 'PHP');
  assert.equal(fields.date.value, '2026-10-05');
  assert.equal(fields.provider.value, 'Western Union');
  assert.ok(hints.includes('USED_TOTAL_AS_SENT'));
});

test('Korean app notification: 송금액 / 수수료 무료 / 받는 금액', () => {
  const { fields } = parseReceiptText('[해외송금 완료]\n2026년 10월 5일\n송금액 1,000,000원\n수수료 무료\n환율 1원 = 18.6 VND\n받는 금액 18,600,000 VND');
  assert.equal(fields.sentAmount.value, 1_000_000);
  assert.equal(fields.sentCurrency.value, 'KRW');
  assert.equal(fields.fee.value, 0);
  assert.equal(fields.receivedAmount.value, 18_600_000);
  assert.equal(fields.receivedCurrency.value, 'VND');
  assert.equal(fields.date.value, '2026-10-05');
});

test('Vietnamese SMS: số tiền gửi / phí / nhận', () => {
  const { fields } = parseReceiptText('Ngày 05/10/2026\nSố tiền gửi: 1.000.000 KRW\nPhí: 5.000 KRW\nNgười nhận nhận: 18.500.000 VND');
  assert.equal(fields.sentAmount.value, 1_000_000);
  assert.equal(fields.fee.value, 5000);
  assert.equal(fields.receivedAmount.value, 18_500_000);
  assert.equal(fields.date.value, '2026-10-05');
});

test('Unlabelled text: first amount is sent, first other-currency amount is received (low confidence)', () => {
  const { fields } = parseReceiptText('2026-10-05\n500 USD\n30,336.03 PHP');
  assert.equal(fields.sentAmount.value, 500);
  assert.equal(fields.receivedAmount.value, 30336.03);
  assert.equal(fields.sentAmount.confidence, 'low');
});
