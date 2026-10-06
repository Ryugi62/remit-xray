// Presentation helpers: ranges never pretend to be exact, and they can be split for line-breaking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { money, moneyRange, rangeParts, pct, pctRange, roundNice, latestMid } from '../src/ui/format.js';

test('roundNice keeps 3 significant digits from 1000 up', () => {
  assert.equal(roundNice(15_612.4), 15_600);
  assert.equal(roundNice(18_449), 18_400);
  assert.equal(roundNice(12.345), 12.35);
});

test('money: zero-decimal currencies print no decimals', () => {
  assert.equal(money(15_612, 'KRW', 'en-US'), '₩15,600');
  assert.equal(money(4.99, 'USD', 'en-US', { nice: false }), '$4.99');
});

test('moneyRange collapses equal ends and floors negatives at 0', () => {
  assert.equal(moneyRange({ low: 15_600, high: 18_400 }, 'KRW', 'en-US'), '₩15,600 – ₩18,400');
  assert.equal(moneyRange({ low: 15_601, high: 15_649 }, 'KRW', 'en-US'), '₩15,600');
  assert.equal(moneyRange({ low: -5, high: 0 }, 'KRW', 'en-US'), '₩0');
});

test('rangeParts returns the printed ends separately so a UI can keep each end on one line', () => {
  assert.deepEqual(rangeParts({ low: 15_600, high: 18_400 }, 'KRW', 'en-US'), ['₩15,600', '₩18,400']);
  assert.deepEqual(rangeParts({ low: 15_601, high: 15_649 }, 'KRW', 'en-US'), ['₩15,600']);
  assert.equal(rangeParts({ low: 15_600, high: 18_400 }, 'KRW', 'en-US').join(' – '), moneyRange({ low: 15_600, high: 18_400 }, 'KRW', 'en-US'));
});

test('pct and pctRange', () => {
  assert.equal(pct(0.0156, 'en-US'), '1.56%');
  assert.equal(pctRange({ low: 0.0156, high: 0.0184 }, 'en-US'), '1.56% – 1.84%');
});

test('latestMid averages the observations of the latest date only', () => {
  const band = { observations: [{ date: '2026-10-05', rate: 1 }, { date: '2026-10-06', rate: 2 }, { date: '2026-10-06', rate: 4 }] };
  assert.deepEqual(latestMid(band), { date: '2026-10-06', rate: 3 });
});
