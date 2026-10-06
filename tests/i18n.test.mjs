// Every language carries every English key, with the same {placeholders}.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, translator, detectLang } from '../src/ui/i18n.js';

const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

for (const [lang, table] of Object.entries(STRINGS)) {
  if (lang === 'en') continue;
  test(`${lang} has every en key with the same placeholders`, () => {
    for (const [k, v] of Object.entries(STRINGS.en)) {
      assert.ok(k in table, `${lang} missing ${k}`);
      assert.equal(holes(table[k]), holes(v), `${lang}.${k} placeholders`);
    }
  });
}

test('translator fills placeholders and falls back to en', () => {
  const t = translator('xx');
  assert.equal(t('step', { n: 1 }), 'Step 1 of 2');
});

test('the saved-transfers button label is short enough for a 390px header', () => {
  for (const [lang, table] of Object.entries(STRINGS)) assert.ok(table.ledger_btn.length <= 12, `${lang}: ${table.ledger_btn}`);
});

test('detectLang picks the first supported language', () => {
  assert.equal(detectLang(['vi-VN', 'en']), 'vi');
  assert.equal(detectLang(['fr']), 'en');
});
