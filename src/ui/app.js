// UI controller: screens, events, rendering. All decisions live in domain/application.
import { auditTransfer } from '../application/auditTransfer.js';
import { createDraft, confirmField, readiness, toReceiptInput } from '../application/draft.js';
import { entryFromResult, addEntry, removeEntry, yearlySummary } from '../application/ledger.js';
import { parseReceiptText } from '../domain/parse.js';
import { yearlyImpact, compareToBenchmarks } from '../domain/impact.js';
import { currencyApiSource, frankfurterSource, openErApiSource } from '../adapters/rateSources.js';
import { wiseQuotes } from '../adapters/marketQuotes.js';
import { localLedgerStore, recognizeImage } from '../adapters/browser.js';
import { LANGS, LOCALES, translator, detectLang } from './i18n.js';
import { money, moneyRange, pct, pctRange, rate, latestMid } from './format.js';

const SEND = ['KRW', 'USD', 'GBP', 'EUR', 'AUD', 'JPY', 'CAD', 'SGD', 'AED', 'SAR', 'MYR', 'HKD', 'NZD', 'CHF', 'TWD', 'QAR', 'KWD', 'ILS'];
const RECV = ['VND', 'NPR', 'UZS', 'PHP', 'IDR', 'KHR', 'MMK', 'LKR', 'BDT', 'THB', 'INR', 'PKR', 'MXN', 'NGN', 'KGS', 'TJS', 'MNT', 'CNY', 'KES', 'GHS', 'EGP', 'MAD', 'COP', 'GTQ', 'USD', 'EUR'];
const ALL = [...new Set([...SEND, ...RECV])].sort();
const ISO2 = { KRW: 'KR', USD: 'US', GBP: 'GB', JPY: 'JP', AUD: 'AU', SGD: 'SG', CAD: 'CA', SAR: 'SA', AED: 'AE', VND: 'VN', NPR: 'NP',
  UZS: 'UZ', PHP: 'PH', IDR: 'ID', KHR: 'KH', MMK: 'MM', LKR: 'LK', BDT: 'BD', THB: 'TH', INR: 'IN', MXN: 'MX', NGN: 'NG', PKR: 'PK',
  KGS: 'KG', TJS: 'TJ', MNT: 'MN', CNY: 'CN' };
const OCR_LANGS = { en: 'eng', ko: 'eng+kor', vi: 'eng+vie', ne: 'eng', uz: 'eng' };

const rateSources = [currencyApiSource(), frankfurterSource(), openErApiSource()];
const quotesSource = wiseQuotes();
const ledgerStore = localLedgerStore();
const $app = document.getElementById('app');
const $cta = document.getElementById('cta');
const $lang = document.getElementById('lang');
const $ledgerBtn = document.getElementById('ledger-btn');

const params = new URLSearchParams(location.search);
let lang = params.get('lang') || safeGet('remit-xray.lang') || detectLang(navigator.languages || [navigator.language]);
if (!LANGS[lang]) lang = 'en';
let t = translator(lang);
let locale = LOCALES[lang];

const state = { screen: 'home', draft: createDraft({}, 'typed'), result: null, error: null, quotes: null, monthly: '', sample: null, ocr: 0, saved: false };
let samples = [];
let context = null;

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function country(cur) {
  const code = ISO2[cur];
  if (!code) return cur;
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code); } catch { return code; }
}

// ---------- rendering ----------
function go(screen) { state.screen = screen; render(); window.scrollTo(0, 0); }

function cta(buttons) {
  $cta.innerHTML = buttons.length ? `<div class="cta-inner">${buttons.join('')}</div>` : '';
}

function render() {
  document.documentElement.lang = lang;
  $ledgerBtn.textContent = t('ledger_title');
  const views = { home, paste, photo, step1, step2, loading, result, ledger };
  views[state.screen]();
}

function home() {
  $app.innerHTML = `
    <h1>${esc(t('home_title'))}</h1>
    <p class="sub">${esc(t('home_sub'))}</p>
    <p class="caption">🔒 ${esc(t('privacy'))}</p>
    <div class="section alt-actions">
      <button class="btn secondary" data-go="paste" type="button">${esc(t('btn_paste'))}</button>
      <button class="btn secondary" data-go="photo" type="button">${esc(t('btn_photo'))}</button>
    </div>
    <div class="section">
      <h3>${esc(t('samples_title'))}</h3>
      <div class="samples">${samples.map((s, i) => sampleCard(s, i)).join('')}</div>
    </div>
    <footer class="section caption">${esc(t('footer'))}</footer>`;
  cta([`<button class="btn primary" data-go="step1" type="button">${esc(t('btn_enter'))}</button>`]);
}

function sampleCard(s, i) {
  const x = s.input;
  return `<button class="sample" type="button" data-sample="${i}">
    <b>${esc(x.sentCurrency)} → ${esc(x.receivedCurrency)} · ${esc(x.provider)}</b>
    <span class="caption">${esc(money(x.sentAmount, x.sentCurrency, locale, { nice: false }))} → ${esc(money(x.receivedAmount, x.receivedCurrency, locale, { nice: false }))} · ${esc(t('q_fee'))} ${esc(money(x.fee, x.sentCurrency, locale, { nice: false }))}</span><br>
    <span class="pill">${esc(t('sample_note', { provider: x.provider, date: x.date }))}</span>
  </button>`;
}

function field(name, label, { type = 'text', inputmode, options, hint } = {}) {
  const f = state.draft.fields[name];
  const value = f ? f.value : '';
  const machine = f && !f.confirmed;
  const control = options
    ? `<select name="${name}" id="f-${name}">${options.map((o) => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select>`
    : `<input name="${name}" id="f-${name}" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} value="${esc(value)}" autocomplete="off">`;
  return `<label class="field ${machine ? 'unconfirmed' : ''}" for="f-${name}"><span>${esc(label)}</span>${control}
    ${machine ? `<div class="machine">⚠ ${esc(t('check_this'))}<button class="btn small secondary" type="button" data-confirm="${name}">${esc(t('btn_looks_right'))}</button></div>` : ''}
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</label>`;
}

function ensureDefault(name, value) {
  if (!state.draft.fields[name]) state.draft = confirmField(state.draft, name, value);
}

function step1() {
  ensureDefault('sentCurrency', 'KRW');
  $app.innerHTML = `
    <p class="caption">${esc(t('step', { n: 1 }))}</p>
    <h2>${esc(t('q_paid'))}</h2>
    <p class="sub">${esc(t('q_paid_hint'))}</p>
    <div class="row">${field('sentAmount', t('l_amount'), { inputmode: 'decimal' })}${field('sentCurrency', t('l_currency'), { options: ALL })}</div>
    ${field('fee', t('l_fee'), { inputmode: 'decimal', hint: t('fee_hint') })}
    <div id="msg"></div>`;
  cta([`<button class="btn secondary back" data-go="home" type="button">${esc(t('btn_back'))}</button>`,
    `<button class="btn primary" id="next1" type="button">${esc(t('btn_next'))}</button>`]);
}

function step2() {
  ensureDefault('receivedCurrency', state.draft.fields.sentCurrency && state.draft.fields.sentCurrency.value === 'VND' ? 'KRW' : 'VND');
  ensureDefault('date', today());
  $app.innerHTML = `
    <p class="caption">${esc(t('step', { n: 2 }))}</p>
    <h2>${esc(t('q_arrived'))}</h2>
    <div class="row">${field('receivedAmount', t('l_received'), { inputmode: 'decimal' })}${field('receivedCurrency', t('l_currency'), { options: ALL })}</div>
    ${field('date', t('l_date'), { type: 'date' })}
    ${field('provider', t('l_provider'))}
    <div id="msg">${state.error ? `<div class="err">${esc(state.error)}</div>` : ''}</div>`;
  cta([`<button class="btn secondary back" data-go="step1" type="button">${esc(t('btn_back'))}</button>`,
    `<button class="btn primary" id="check" type="button">${esc(t('btn_check'))}</button>`]);
}

function paste() {
  $app.innerHTML = `
    <h2>${esc(t('paste_title'))}</h2>
    <p class="sub">${esc(t('paste_hint'))}</p>
    <label class="sr" for="paste-text">${esc(t('paste_title'))}</label>
    <textarea id="paste-text" placeholder="Amount to send: KRW 1,000,000&#10;Fee: 0&#10;Recipient gets: NPR 112,854&#10;2026-10-06"></textarea>
    <div id="msg"></div>`;
  cta([`<button class="btn secondary back" data-go="home" type="button">${esc(t('btn_back'))}</button>`,
    `<button class="btn primary" id="read-paste" type="button">${esc(t('btn_read'))}</button>`]);
}

function photo() {
  $app.innerHTML = `
    <h2>${esc(t('photo_title'))}</h2>
    <p class="sub">${esc(t('photo_hint'))}</p>
    <label class="field" for="photo-file"><span>${esc(t('btn_photo'))}</span><input id="photo-file" type="file" accept="image/*"></label>
    <div class="section" id="ocr-progress" hidden><div class="progress"><i></i></div><p class="caption" id="ocr-label"></p></div>
    <div id="msg"></div>`;
  cta([`<button class="btn secondary back" data-go="home" type="button">${esc(t('btn_back'))}</button>`]);
}

function loading() {
  $app.innerHTML = `<div aria-label="${esc(t('loading'))}" role="status">
    <div class="skeleton" style="height:20px;width:40%;margin-top:24px"></div>
    <div class="skeleton" style="height:44px;width:80%;margin-top:12px"></div>
    <div class="skeleton" style="height:16px;width:90%;margin-top:16px"></div>
    <div class="skeleton" style="height:160px;margin-top:24px"></div></div>`;
  cta([]);
}

function barHtml(a) {
  const fee = Math.max(0, a.cost.fee);
  const hidden = Math.max(0, (a.cost.hidden.low + a.cost.hidden.high) / 2);
  const sum = fee + hidden || 1;
  return `<div class="bar" role="img" aria-label="${esc(t('bar_fee'))} ${Math.round((fee / sum) * 100)}%, ${esc(t('bar_hidden'))} ${Math.round((hidden / sum) * 100)}%">
      <i class="fee" style="width:${(fee / sum) * 100}%"></i><i class="hidden" style="width:${(hidden / sum) * 100}%"></i></div>
    <div class="legend"><span><i style="background:var(--muted)"></i>${esc(t('bar_fee'))} ${esc(money(fee, a.cost.currency, locale))}</span>
      <span><i style="background:var(--no)"></i>${esc(t('bar_hidden'))} ${esc(moneyRange(a.cost.hidden, a.cost.currency, locale))}</span></div>`;
}

function benchHtml(r) {
  const a = r.audit;
  const from = r.receipt.sent.currency;
  const to = r.receipt.received.currency;
  const send = context && context.send[from];
  const recv = context && context.receive[to];
  const gdp = context && context.gdp_share[to];
  const youMid = Math.max(0, (a.cost.totalPct.low + a.cost.totalPct.high) / 2) * 100;
  const rows = [{ lab: t('you'), v: youMid, txt: pctRange(a.cost.totalPct, locale), you: true }, { lab: t('bench_sdg'), v: 3, txt: pct(0.03, locale, 0) }];
  if (send) rows.push({ lab: t('bench_send', { country: country(from) }), v: send.value, txt: pct(send.value / 100, locale) });
  if (recv) rows.push({ lab: t('bench_recv', { country: country(to) }), v: recv.value, txt: pct(recv.value / 100, locale) });
  const max = Math.max(...rows.map((x) => x.v), 1);
  const years = [send, recv].filter(Boolean).map((x) => x.year);
  const verdict = compareToBenchmarks(a.cost.totalPct, recv ? recv.value / 100 : null);
  return `<div class="card section"><h3>${esc(t('bench_title'))}</h3>
    <div class="bench">${rows.map((x) => `<div class="bench-row ${x.you ? 'you' : ''}"><span class="lab">${esc(x.lab)}</span>
      <span class="track"><i style="width:${Math.max(2, (x.v / max) * 100)}%"></i></span><span class="val">${esc(x.txt)}</span></div>`).join('')}</div>
    ${years.length ? `<p class="caption section" style="margin-top:12px">${esc(t('bench_note', { year: [...new Set(years)].join('/') }))}</p>` : ''}
    ${gdp ? `<p class="note" style="margin-top:12px">${esc(t('bench_gdp', { pct: pct(gdp.value / 100, locale, 1), country: country(to), year: gdp.year }))}</p>` : ''}
    <span hidden data-verdict="${verdict.sdg}"></span></div>`;
}

function yearHtml(r) {
  const cur = r.receipt.sent.currency;
  const m = state.monthly || String(r.receipt.sent.amount);
  const y = yearlyImpact(r.audit.cost.totalPct, Number(m));
  return `<div class="card section"><h3>${esc(t('year_title'))}</h3>
    <label class="caption" for="monthly">${esc(t('year_label'))} (${esc(cur)})</label>
    <div class="inline-input"><input id="monthly" inputmode="decimal" value="${esc(m)}"></div>
    <p class="verdict section" id="year-out" style="margin-top:12px">${y ? esc(t('year_result', { amt: moneyRange(y, cur, locale) })) : ''}</p>
    <p class="caption">${esc(t('year_note'))}</p></div>`;
}

function nextHtml(r) {
  const from = r.receipt.sent.currency;
  const to = r.receipt.received.currency;
  const mid = latestMid(r.band);
  const q = state.quotes;
  let quotes = '';
  if (q && q.quotes && q.quotes.length) {
    quotes = `<p class="caption" style="margin-top:16px">${esc(t('next_quotes', { amount: money(r.receipt.sent.amount, from, locale, { nice: false }) }))}</p>
      <table class="quotes"><tbody>${q.quotes.slice(0, 5).map((x) => `<tr><td>${esc(x.provider)}<br><span class="caption">${esc(t('q_fee'))} ${esc(money(x.fee, from, locale, { nice: false }))}</span></td>
        <td>${esc(t('q_received'))} ${esc(money(x.received, to, locale, { nice: false }))}</td></tr>`).join('')}</tbody></table>`;
  } else if (q) {
    quotes = `<p class="note" style="margin-top:16px">${esc(t('next_noquotes'))}</p>`;
  } else {
    quotes = '<div class="skeleton" style="height:80px;margin-top:16px"></div>';
  }
  return `<div class="card section"><h3>${esc(t('next_title'))}</h3>
    <p>${esc(t('next_mid', { date: mid.date, from, rate: rate(mid.rate, locale), to }))}</p>
    <p class="verdict">${esc(t('next_line', { rate: rate(mid.rate * 0.99, locale), to }))}</p>${quotes}</div>`;
}

function detailsHtml(r) {
  const names = r.band.sources.join(', ');
  const missing = r.missing.map((m) => m.source);
  return `<details><summary>${esc(t('details_title'))}</summary>
    <p class="src" style="margin-top:12px">${esc(t('details_formula', { sources: names }))}</p>
    <p class="src">${esc(t('term_mid'))}</p>
    <p class="src"><b>${esc(t('details_sources'))}</b></p>
    <ul class="src">${r.band.observations.map((o) => `<li>${esc(o.source)} · ${esc(o.date)} · 1 ${esc(r.receipt.sent.currency)} = ${esc(rate(o.rate, locale))} ${esc(r.receipt.received.currency)} · <a href="${esc(o.url)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>
    <p class="src">effective = ${esc(rate(r.audit.effectiveRate, locale))} · band ${esc(rate(r.band.min, locale))} – ${esc(rate(r.band.max, locale))}</p>
    ${missing.length ? `<p class="src">${esc(t('details_missing', { list: missing.join(', ') }))}</p>` : ''}
  </details>`;
}

function result() {
  const r = state.result;
  const a = r.audit;
  const cur = a.cost.currency;
  const feeTxt = money(a.cost.fee, cur, locale, { nice: false });
  let line;
  if (a.classification === 'better-than-mid') line = t('res_line_better');
  else if (a.classification === 'within-band') line = t('res_line_within');
  else line = t('res_line_markup', { pct: pctRange(a.cost.totalPct, locale), fee: feeTxt });
  const better = a.classification === 'better-than-mid';
  const family = better
    ? t('res_family_better', { amt: moneyRange({ low: -a.shortfall.high, high: -a.shortfall.low }, a.shortfall.currency, locale) })
    : t('res_family', { amt: moneyRange(a.shortfall, a.shortfall.currency, locale) });
  const share = pct(r.hiddenShare, locale, 0);
  $app.innerHTML = `
    <div class="card" style="margin-top:8px" id="result-card">
      <p class="caption">${esc(t('res_label'))}${r.receipt.provider ? ` · ${esc(r.receipt.provider)}` : ''} · ${esc(r.receipt.date)}</p>
      <div class="big ${better ? 'ok' : ''}" id="big-number">${esc(moneyRange(a.cost.total, cur, locale))}</div>
      <p class="verdict">${esc(line)}</p>
      ${a.classification === 'markup' ? `<p class="sub">${esc(t('hidden_share', { share }))}</p>` : ''}
      ${barHtml(a)}
      <p class="sub" style="margin-top:12px">${esc(family)}</p>
      ${state.sample ? `<p style="margin-top:8px"><span class="pill">${esc(t('sample_note', { provider: state.sample.input.provider, date: state.sample.input.date }))}</span></p>` : ''}
      ${detailsHtml(r)}
    </div>
    ${benchHtml(r)}
    ${yearHtml(r)}
    ${nextHtml(r)}
    <div class="section row">
      <button class="btn secondary" id="save" type="button">${esc(state.saved ? t('saved') : t('btn_save'))}</button>
      <button class="btn secondary" id="share" type="button">${esc(t('btn_share'))}</button>
    </div>
    <footer class="section caption">${esc(t('footer'))}</footer>`;
  cta([`<button class="btn primary" id="new" type="button">${esc(t('btn_new'))}</button>`]);
}

function ledger() {
  const entries = ledgerStore.load();
  const sums = yearlySummary(entries, today());
  $app.innerHTML = `<h2 style="margin-top:16px">${esc(t('ledger_title'))}</h2>
    ${sums.map((s) => `<p class="verdict">${esc(t('ledger_year', { n: s.count, amt: moneyRange(s, s.currency, locale) }))}</p>`).join('')}
    ${entries.length ? entries.map((e) => `<div class="ledger-item"><div><b>${esc(e.date)} · ${esc(e.sent.currency)} → ${esc(e.received.currency)}</b>
      <span class="caption">${esc(e.provider || '')} ${esc(money(e.sent.amount, e.sent.currency, locale, { nice: false }))}</span></div>
      <div style="text-align:right"><b>${esc(moneyRange(e.total, e.sent.currency, locale))}</b><button class="link" data-remove="${esc(e.id)}" type="button">${esc(t('btn_remove'))}</button></div></div>`).join('')
    : `<p class="note section">${esc(t('ledger_empty'))}</p>`}`;
  cta([`<button class="btn primary" data-go="home" type="button">${esc(t('btn_enter'))}</button>`]);
}

// ---------- actions ----------
function msg(text) { const m = document.getElementById('msg'); if (m) m.innerHTML = text ? `<div class="err">${esc(text)}</div>` : ''; }

async function runAudit() {
  state.error = null;
  const ready = readiness(state.draft);
  if (ready.unconfirmed.length) { msg(t('confirm_all_first')); return; }
  if (ready.missing.length) {
    const map = { sentAmount: 'SENT_POSITIVE', receivedAmount: 'RECEIVED_POSITIVE', sentCurrency: 'CURRENCY_FORMAT', receivedCurrency: 'CURRENCY_FORMAT', date: 'DATE_FORMAT' };
    msg(t('err_INVALID', { list: [...new Set(ready.missing.map((k) => t(`e_${map[k]}`)))].join(', ') }));
    return;
  }
  const input = toReceiptInput(state.draft);
  const back = state.screen;
  go('loading');
  const r = await auditTransfer(input, { rateSources, today: today() });
  if (!r.ok) {
    state.error = r.error === 'NO_REFERENCE' ? t('err_NO_REFERENCE') : t('err_INVALID', { list: r.details.map((c) => t(`e_${c}`)).join(', ') });
    if (back === 'home') { state.screen = 'step2'; } else { state.screen = back; }
    render();
    msg(state.error);
    return;
  }
  state.result = r;
  state.quotes = null;
  state.saved = false;
  state.monthly = String(r.receipt.sent.amount);
  go('result');
  quotesSource.getQuotes(r.receipt.sent.currency, r.receipt.received.currency, r.receipt.sent.amount)
    .catch(() => ({ quotes: [] }))
    .then((q) => { if (state.result === r) { state.quotes = q; if (state.screen === 'result') rerenderKeepScroll(); } });
}

function rerenderKeepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }

function readDraftInputs() {
  for (const el of $app.querySelectorAll('input[name], select[name]')) {
    const f = state.draft.fields[el.name];
    const v = el.value.trim();
    if (f && !f.confirmed && String(f.value) === v) continue; // untouched machine value stays unconfirmed
    if (!f && v === '') continue;
    state.draft = confirmField(state.draft, el.name, v);
  }
}

function startFromText(text, origin) {
  const { fields } = parseReceiptText(text);
  if (!Object.keys(fields).length) { msg(t('read_none')); return; }
  state.draft = createDraft(fields, origin);
  state.sample = null;
  go('step1');
}

function startSample(i) {
  const s = samples[i];
  state.sample = s;
  state.draft = createDraft(s.input, 'sample');
  runAudit();
}

async function shareResult() {
  const r = state.result;
  const a = r.audit;
  const text = t('share_text', { from: r.receipt.sent.currency, to: r.receipt.received.currency, cost: moneyRange(a.cost.total, a.cost.currency, locale),
    pct: pctRange(a.cost.totalPct, locale), fee: money(a.cost.fee, a.cost.currency, locale, { nice: false }) });
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) await navigator.share({ text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); document.getElementById('share').textContent = t('copied'); }
  } catch { /* user cancelled */ }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('button, [data-go]');
  if (!el) return;
  if (el.dataset.go) {
    if (state.screen === 'step1' || state.screen === 'step2') readDraftInputs();
    if (el.dataset.go === 'step1' && state.screen === 'home') { state.draft = createDraft({}, 'typed'); state.sample = null; }
    state.error = null;
    go(el.dataset.go);
    return;
  }
  if (el.dataset.sample !== undefined) { startSample(Number(el.dataset.sample)); return; }
  if (el.dataset.confirm) {
    readDraftInputs();
    const input = document.getElementById(`f-${el.dataset.confirm}`);
    state.draft = confirmField(state.draft, el.dataset.confirm, input ? input.value.trim() : undefined);
    rerenderKeepScroll();
    return;
  }
  if (el.dataset.remove) { removeEntry(ledgerStore, el.dataset.remove); render(); return; }
  switch (el.id) {
    case 'ledger-btn': go('ledger'); break;
    case 'next1': {
      readDraftInputs();
      const un = ['sentAmount', 'sentCurrency', 'fee'].filter((k) => state.draft.fields[k] && !state.draft.fields[k].confirmed);
      if (un.length) { msg(t('confirm_all_first')); break; }
      if (!state.draft.fields.sentAmount) { msg(t('err_INVALID', { list: t('e_SENT_POSITIVE') })); break; }
      go('step2');
      break;
    }
    case 'check': readDraftInputs(); runAudit(); break;
    case 'read-paste': startFromText(document.getElementById('paste-text').value, 'pasted'); break;
    case 'new': state.result = null; state.sample = null; state.draft = createDraft({}, 'typed'); go('home'); break;
    case 'save': ledgerStore && addEntry(ledgerStore, entryFromResult(state.result, new Date().toISOString())); state.saved = true; el.textContent = t('saved'); break;
    case 'share': shareResult(); break;
    default: break;
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'monthly') {
    state.monthly = ev.target.value;
    const r = state.result;
    const y = yearlyImpact(r.audit.cost.totalPct, Number(state.monthly));
    document.getElementById('year-out').textContent = y ? t('year_result', { amt: moneyRange(y, r.receipt.sent.currency, locale) }) : '';
  }
});

document.addEventListener('change', async (ev) => {
  if (ev.target.id !== 'photo-file' || !ev.target.files[0]) return;
  const box = document.getElementById('ocr-progress');
  const bar = box.querySelector('i');
  const label = document.getElementById('ocr-label');
  box.hidden = false;
  label.textContent = t('photo_progress', { p: 0 });
  try {
    const text = await recognizeImage(ev.target.files[0], {
      langs: OCR_LANGS[lang],
      onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; label.textContent = t('photo_progress', { p: Math.round(p * 100) }); },
    });
    startFromText(text, 'photo');
  } catch {
    msg(t('read_none'));
  }
});

$lang.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${v}</option>`).join('');
$lang.addEventListener('change', () => {
  if (state.screen === 'step1' || state.screen === 'step2') readDraftInputs();
  lang = $lang.value; t = translator(lang); locale = LOCALES[lang]; safeSet('remit-xray.lang', lang);
  rerenderKeepScroll();
});

async function boot() {
  const [s, c] = await Promise.all([
    fetch('data/samples.json').then((x) => x.json()).catch(() => []),
    fetch('data/context.json').then((x) => x.json()).catch(() => null),
  ]);
  samples = s; context = c;
  render();
  const want = params.get('sample');
  if (want !== null) {
    const i = samples.findIndex((x) => x.id === want || String(samples.indexOf(x)) === want);
    if (i >= 0) startSample(i);
  }
}
boot();
