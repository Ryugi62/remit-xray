// UI controller: screens, events, rendering. All decisions live in domain/application.
import { auditTransfer, collectBand } from '../application/auditTransfer.js';
import { createDraft, confirmField, confirmFields, suggestField, addFeeOnTop, readiness, toReceiptInput } from '../application/draft.js';
import { providerMessage, ledgerText } from '../application/report.js';
import { encodeReceipt, decodeReceipt } from '../application/share.js';
import { entryFromResult, addEntry, removeEntry, yearlySummary } from '../application/ledger.js';
import { parseReceiptText, parseAmount } from '../domain/parse.js';
import { yearlyImpact, compareToBenchmarks, SDG_TARGET } from '../domain/impact.js';
import { compareWithQuotes, quoteCostRange, scaleQuote, savingVs } from '../domain/quotes.js';
import { currencyApiSource, frankfurterSource, nrbSource, cbuSource, openErApiSource, frozenSources } from '../adapters/rateSources.js';
import { wiseQuotes } from '../adapters/marketQuotes.js';
import { localLedgerStore, recognizeImage } from '../adapters/browser.js';
import { LANGS, LOCALES, translator, detectLang } from './i18n.js';
import { money, moneyRange, rangeParts, approx, pct, pctRange, rate, latestMid } from './format.js';

const SEND = ['KRW', 'USD', 'GBP', 'EUR', 'AUD', 'JPY', 'CAD', 'SGD', 'AED', 'SAR', 'MYR', 'HKD', 'NZD', 'CHF', 'TWD', 'QAR', 'KWD', 'ILS'];
const RECV = ['VND', 'NPR', 'UZS', 'PHP', 'IDR', 'KHR', 'LKR', 'BDT', 'THB', 'INR', 'PKR', 'MXN', 'NGN', 'KGS', 'TJS', 'MNT', 'CNY', 'KES', 'GHS', 'EGP', 'MAD', 'COP', 'GTQ', 'USD', 'EUR'];
const ALL = [...new Set([...SEND, ...RECV])].sort();
const ISO2 = { KRW: 'KR', USD: 'US', GBP: 'GB', JPY: 'JP', AUD: 'AU', SGD: 'SG', CAD: 'CA', SAR: 'SA', AED: 'AE', VND: 'VN', NPR: 'NP',
  UZS: 'UZ', PHP: 'PH', IDR: 'ID', KHR: 'KH', LKR: 'LK', BDT: 'BD', THB: 'TH', INR: 'IN', MXN: 'MX', NGN: 'NG', PKR: 'PK',
  KGS: 'KG', TJS: 'TJ', MNT: 'MN', CNY: 'CN' };
const STEP_FIELDS = { step1: ['sentAmount', 'sentCurrency', 'fee'], step2: ['receivedAmount', 'receivedCurrency', 'date', 'provider'] };
const AMOUNT_FIELDS = { sentAmount: 'sentCurrency', fee: 'sentCurrency', receivedAmount: 'receivedCurrency' };
// Receipts from Korean apps are in Korean whatever language the sender reads, so Korean is always loaded.
const OCR_LANGS = { en: 'eng+kor', ko: 'eng+kor', vi: 'eng+vie+kor', ne: 'eng+kor', uz: 'eng+kor' };
const KR_ROUTES = new Set(['VND', 'NPR', 'UZS']);

const rateSources = [currencyApiSource(), frankfurterSource(), nrbSource(), cbuSource(), openErApiSource()];
const OFFICIAL = new Set(rateSources.filter((s) => s.official).map((s) => s.name));
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

const fresh = () => ({ draft: createDraft({}, 'typed'), result: null, error: null, quotes: null, quotesAsked: false, askOpen: false,
  monthly: '', sample: null, saved: false, machine: false, hints: [], feeAnswered: false, dateOptions: null, mode: 'audit', shared: false });
const state = { screen: 'home', ...fresh() };
let samples = [];
let krQuotes = [];
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
function longDate(iso) {
  try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)); } catch { return iso; }
}
function reset() { Object.assign(state, fresh()); }

// ---------- rendering ----------
function go(screen) { state.screen = screen; render(); window.scrollTo(0, 0); }

function cta(buttons) {
  $cta.innerHTML = buttons.length ? `<div class="cta-inner">${buttons.join('')}</div>` : '';
}

function render() {
  document.documentElement.lang = lang;
  $ledgerBtn.textContent = t('ledger_btn');
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
    <button class="btn ghost block" id="quote-mode" type="button" style="margin-top:12px">${esc(t('btn_quote_mode'))}</button>
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
    ${machine ? `<div class="machine">⚠ ${esc(t('machine_tag'))}</div>` : ''}
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</label>`;
}

// fields the "All correct" button may confirm on this step (an ambiguous date needs its own choice)
function confirmableOnStep(step) {
  return STEP_FIELDS[step].filter((n) => !(n === 'date' && state.dateOptions));
}

function machineBanner(step) {
  const open = confirmableOnStep(step).filter((n) => state.draft.fields[n] && !state.draft.fields[n].confirmed);
  if (!open.length) return '';
  return `<div class="banner" role="note"><p>${esc(t('machine_banner'))}</p>
    <button class="btn small primary" type="button" data-confirm-step="${step}">${esc(t('btn_all_right'))}</button></div>`;
}

function feeTopQuestion() {
  const f = state.draft.fields;
  if (!state.hints.includes('CHECK_FEE_INCLUDED') || state.feeAnswered || !f.fee || !(Number(f.fee.value) > 0) || !f.sentAmount) return '';
  const cur = f.sentCurrency ? f.sentCurrency.value : '';
  const q = t('fee_top_q', { fee: money(Number(f.fee.value), cur, locale, { nice: false }), amt: money(Number(f.sentAmount.value), cur, locale, { nice: false }) });
  return `<div class="banner" role="group" id="fee-top"><p>${esc(q)}</p><span class="banner-btns">
    <button class="btn small primary" type="button" data-fee-top="yes">${esc(t('fee_top_yes'))}</button>
    <button class="btn small secondary" type="button" data-fee-top="no">${esc(t('fee_top_no'))}</button></span></div>`;
}

function feeOtherCurrency() {
  if (!state.hints.includes('FEE_OTHER_CURRENCY') || state.draft.fields.fee) return '';
  const cur = state.draft.fields.sentCurrency ? state.draft.fields.sentCurrency.value : '';
  return `<div class="banner" role="note"><p>${esc(t('fee_other', { cur }))}</p></div>`;
}

function datePicker() {
  if (!state.dateOptions) return '';
  return `<div class="banner" role="group" id="date-pick"><p>${esc(t('date_pick'))}</p><span class="banner-btns">
    ${state.dateOptions.map((d) => `<button class="btn small secondary" type="button" data-date-pick="${esc(d)}">${esc(longDate(d))}</button>`).join('')}</span></div>`;
}

// Defaults the user did not type: confirmed for a typed draft, yellow (unconfirmed) for a machine-read one.
function ensureDefault(name, value) {
  if (state.draft.fields[name]) return;
  state.draft = state.machine ? suggestField(state.draft, name, value) : confirmField(state.draft, name, value);
}

function step1() {
  ensureDefault('sentCurrency', lang === 'en' ? 'USD' : 'KRW');
  const quote = state.mode === 'quote';
  $app.innerHTML = `
    <p class="caption">${esc(t('step', { n: 1 }))}</p>
    <h2>${esc(t(quote ? 'q_paid_quote' : 'q_paid'))}</h2>
    <p class="sub">${esc(t(quote ? 'q_paid_hint_quote' : 'q_paid_hint'))}</p>
    ${machineBanner('step1')}
    ${state.hints.includes('DOLLAR_AMBIGUOUS') ? `<div class="banner" role="note"><p>${esc(t('dollar_check'))}</p></div>` : ''}
    <div class="row">${field('sentAmount', t('l_amount'), { inputmode: 'decimal' })}${field('sentCurrency', t('l_currency'), { options: ALL })}</div>
    ${field('fee', t('l_fee'), { inputmode: 'decimal', hint: t('fee_hint') })}
    ${feeOtherCurrency()}
    ${feeTopQuestion()}
    <div id="msg"></div>`;
  cta([`<button class="btn secondary back" data-go="home" type="button">${esc(t('btn_back'))}</button>`,
    `<button class="btn primary" id="next1" type="button">${esc(t('btn_next'))}</button>`]);
}

function step2() {
  ensureDefault('receivedCurrency', state.draft.fields.sentCurrency && state.draft.fields.sentCurrency.value === 'VND' ? 'KRW' : 'VND');
  const quote = state.mode === 'quote';
  if (quote) state.draft = confirmField(state.draft, 'date', today());
  else ensureDefault('date', today());
  $app.innerHTML = `
    <p class="caption">${esc(t('step', { n: 2 }))}</p>
    <h2>${esc(t(quote ? 'q_arrived_quote' : 'q_arrived'))}</h2>
    ${machineBanner('step2')}
    <div class="row">${field('receivedAmount', t('l_received'), { inputmode: 'decimal' })}${field('receivedCurrency', t('l_currency'), { options: ALL })}</div>
    ${quote ? '' : field('date', t('l_date'), { type: 'date' })}
    ${quote ? '' : datePicker()}
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
  const line = verdict.sdg === 'above-target' ? t('bench_x_goal', { x: (youMid / 100 / SDG_TARGET).toLocaleString(locale, { maximumFractionDigits: 1 }) })
    : verdict.sdg === 'straddles-target' ? t('bench_around_goal') : t('bench_below_goal');
  return `<div class="card section"><h3>${esc(t('bench_title'))}</h3>
    <p class="verdict ${verdict.sdg === 'above-target' ? 'warn-ink' : ''}" id="bench-verdict">${esc(line)}</p>
    ${verdict.above5 ? `<p class="sub" id="bench-over5">${esc(t('bench_over5'))}</p>` : ''}
    <div class="bench">${rows.map((x) => `<div class="bench-row ${x.you ? 'you' : ''}"><span class="lab">${esc(x.lab)}</span>
      <span class="track"><i style="width:${Math.max(2, (x.v / max) * 100)}%"></i></span><span class="val">${esc(x.txt)}</span></div>`).join('')}</div>
    ${years.length ? `<p class="caption section" style="margin-top:12px">${esc(t('bench_note', { year: [...new Set(years)].join('/') }))} ${esc(t('bench_size_note'))}</p>` : ''}
    ${gdp ? `<p class="note" style="margin-top:12px">${esc(t('bench_gdp', { pct: pct(gdp.value / 100, locale, 1), country: country(to), year: gdp.year }))}</p>` : ''}
    </div>`;
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

// ---------- comparison: other quotes on the same cost scale ----------
// Three sources, all scored as fee + margin against a mid-market range:
//  · a sample: the other quotes collected the same day for the same amount, against the sample's recorded band
//  · KRW → VND/NPR/UZS: the Korean apps' calculators (2026-10-06), rescaled to your amount
//  · anything else: Wise's public comparison for today, against today's band — fetched only when asked
function comparison(r) {
  const from = r.receipt.sent.currency;
  const to = r.receipt.received.currency;
  const amount = r.receipt.sent.amount;
  if (state.sample && state.sample.quotes && state.sample.quotes.length) {
    return { kind: 'same-day', when: r.receipt.date, rows: state.sample.quotes.map((q) => ({ provider: q.provider, fee: q.fee, totalPct: quoteCostRange(q, r.band) })) };
  }
  if (from === 'KRW' && KR_ROUTES.has(to)) {
    const rows = krQuotes.filter((q) => q.from === from && q.to === to && !(q.provider === r.receipt.provider && q.received === r.receipt.received.amount))
      .map((q) => ({ provider: q.provider, fee: q.fee, totalPct: scaleQuote(q, amount), when: q.date })).filter((q) => q.totalPct);
    return rows.length ? { kind: 'kr', when: rows[0].when, rows } : null;
  }
  const q = state.quotes;
  if (!q || !q.band) return null;
  return { kind: 'today', when: q.date, rows: q.quotes.slice(0, 6).map((x) => ({ provider: x.provider, fee: x.fee, totalPct: quoteCostRange({ sent: amount, received: x.received }, q.band) })) };
}

function savingHtml(r, data) {
  if (!data || !data.rows.length || r.audit.classification === 'better-than-mid') return '';
  const cmp = compareWithQuotes(r.audit.cost.totalPct, data.rows);
  if (!cmp.cheapest) return '';
  const s = savingVs(r.audit.cost.totalPct, Math.max(0, cmp.cheapestMid), r.receipt.sent.amount);
  if (!s) return '';
  return esc(t('saving_line', { provider: cmp.cheapest.provider, amt: approx(s, r.receipt.sent.currency, locale), when: data.when }));
}

function quotesTable(r, data) {
  const from = r.receipt.sent.currency;
  const cmp = compareWithQuotes(r.audit.cost.totalPct, data.rows);
  const head = data.kind === 'kr' ? t('quotes_kr_scaled', { date: data.when })
    : data.kind === 'same-day' ? t('quotes_same_day') : t('quotes_today_note', { date: r.receipt.date });
  const amount = r.receipt.sent.amount;
  const save = cmp.cheapest ? savingVs(r.audit.cost.totalPct, Math.max(0, cmp.cheapestMid), amount) : null;
  const offerSave = cmp.offer ? savingVs(r.audit.cost.totalPct, (cmp.offer.totalPct.low + cmp.offer.totalPct.high) / 2, amount) : null;
  const diffLine = !cmp.cheapest ? '' : save
    ? t('quotes_cheaper', { provider: cmp.cheapest.provider, pp: ((cmp.youMid - Math.max(0, cmp.cheapestMid)) * 100).toLocaleString(locale, { maximumFractionDigits: 1 }), amt: approx(save, from, locale) })
    : t('quotes_you_cheapest');
  return `<p class="caption" style="margin-top:16px">${esc(head)}</p>
    <table class="quotes"><tbody>${cmp.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${esc(x.you ? t('you_row', { date: r.receipt.date }) : x.provider)}${x.you ? '' : `<br><span class="caption">${esc(t('q_fee'))} ${esc(money(x.fee, from, locale, { nice: false }))}</span>`}</td>
      <td>${esc(x.promo ? t('quote_promo') : pctRange(x.totalPct, locale))}</td></tr>`).join('')}</tbody></table>
    ${diffLine ? `<p class="verdict" style="margin-top:12px">${esc(diffLine)}</p>` : ''}
    ${cmp.offer && offerSave ? `<p class="caption" style="margin-top:8px">${esc(t('offer_line', { provider: cmp.offer.provider, amt: approx(offerSave, from, locale) }))}</p>` : ''}`;
}

function nextHtml(r) {
  const to = r.receipt.received.currency;
  const from = r.receipt.sent.currency;
  const mid = latestMid(r.band);
  const data = comparison(r);
  let quotes;
  if (data && data.rows.length) quotes = quotesTable(r, data);
  else if (state.quotesAsked && !state.quotes) quotes = '<div class="skeleton" style="height:80px;margin-top:16px"></div>';
  else if (state.quotesAsked) quotes = `<p class="note" style="margin-top:16px">${esc(t('next_noquotes'))}</p>`;
  else quotes = `<div class="section"><button class="btn secondary block" id="quotes" type="button">${esc(t('quotes_btn'))}</button>
    <p class="caption" style="margin-top:8px">${esc(t('quotes_privacy'))}</p></div>`;
  return `<div class="card section" id="next-card"><h3>${esc(t('next_title'))}</h3>${quotes}
    <p style="margin-top:16px">${esc(t('next_mid', { date: mid.date, from, rate: rate(mid.rate, locale), to }))}</p>
    <p class="verdict">${esc(t('next_line', { rate: rate(mid.rate * 0.99, locale), to }))}</p></div>`;
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
    ${context && context.calibration ? `<p class="src">${esc(t('details_tolerance', { n: context.calibration.n, loro: context.calibration.loro }))}</p>` : ''}
    ${missing.length ? `<p class="src">${esc(t('details_missing', { list: missing.join(', ') }))}</p>` : ''}
  </details>`;
}

function askHtml(r) {
  if (!state.askOpen) return `<div class="section"><button class="btn secondary block" id="ask" type="button">${esc(t('ask_btn'))}</button></div>`;
  return `<div class="card section" id="ask-card"><h3>${esc(t('ask_btn'))}</h3><p class="caption">${esc(t('ask_hint'))}</p>
    <label class="sr" for="ask-text">${esc(t('ask_btn'))}</label><textarea id="ask-text" readonly>${esc(providerMessage(r))}</textarea>
    <button class="btn secondary block" id="copy-ask" type="button" style="margin-top:12px">${esc(t('btn_copy'))}</button></div>`;
}

function verdictLine(a, feeTxt) {
  switch (a.classification) {
    case 'better-than-mid': return t('res_line_better');
    case 'within-band': return t('res_line_within');
    case 'inconclusive': return t('res_line_inconclusive', { low: pct(Math.max(0, a.markup.low), locale), high: pct(a.markup.high, locale) });
    default: return t('res_line_markup', { pct: pctRange(a.cost.totalPct, locale), fee: feeTxt });
  }
}

function result() {
  const r = state.result;
  const a = r.audit;
  const cur = a.cost.currency;
  const feeTxt = money(a.cost.fee, cur, locale, { nice: false });
  const better = a.classification === 'better-than-mid';
  const charged = a.classification === 'markup' || a.classification === 'inconclusive';
  const family = better
    ? t('res_family_better', { amt: moneyRange({ low: -a.shortfall.high, high: -a.shortfall.low }, a.shortfall.currency, locale) })
    : t('res_family', { amt: moneyRange(a.shortfall, a.shortfall.currency, locale) });
  const nSources = r.band.sources.length;
  const parts = rangeParts(a.cost.total, cur, locale);
  const caption = [parts.join(' – '), nSources === 1 ? t('sources_one') : t('sources_n', { n: nSources })];
  if (!r.band.sources.some((n) => OFFICIAL.has(n))) caption.push(t('sources_no_official'));
  if (state.sample) {
    const key = state.sample.origin.startsWith('Wise') ? 'sample_note_wise' : 'sample_note_calc';
    caption.push(t(key, { provider: state.sample.input.provider, date: state.sample.input.date }));
  }
  if (state.shared) caption.push(t('shared_note'));
  const yearly = yearlyImpact(a.cost.totalPct, r.receipt.sent.amount);
  const label = state.mode === 'quote' ? t('res_label_quote') : t('res_label');
  $app.innerHTML = `
    <div class="card" style="margin-top:8px" id="result-card">
      <p class="caption">${esc(label)}${r.receipt.provider ? ` · ${esc(r.receipt.provider)}` : ''} · ${esc(r.receipt.date)}</p>
      <div class="big ${better ? 'ok' : ''}" id="big-number">${parts.length > 1 ? '≈ ' : ''}${esc(parts.length > 1 ? approx(a.cost.total, cur, locale) : parts[0])}</div>
      <p class="caption ${nSources === 1 ? 'warn-ink' : ''}" id="cost-caption">${esc(caption.join(' · '))}</p>
      <p class="verdict" style="margin-top:8px">${esc(verdictLine(a, feeTxt))}</p>
      ${charged && yearly ? `<p class="sub" id="year-line">${esc(t('res_year_line', { amt: moneyRange(yearly, cur, locale) }))}</p>` : ''}
      ${a.classification === 'markup' ? `<p class="sub">${esc(t('hidden_share', { share: pct(r.hiddenShare, locale, 0) }))}</p>` : ''}
      ${barHtml(a)}
      <p class="sub" style="margin-top:12px">${esc(family)}</p>
      <p class="verdict good-ink" id="saving-line">${savingHtml(r, comparison(r))}</p>
      ${charged ? `<p class="note" style="margin-top:12px" id="eu-line">${esc(t('res_markup_eu', { pct: pctRange({ low: Math.max(0, a.markup.low), high: a.markup.high }, locale) }))}</p>` : ''}
      ${detailsHtml(r)}
    </div>
    ${nextHtml(r)}
    ${charged ? askHtml(r) : ''}
    ${benchHtml(r)}
    ${yearHtml(r)}
    <div class="section row">
      ${state.mode === 'quote' ? '' : `<button class="btn secondary" id="save" type="button">${esc(state.saved ? t('saved') : t('btn_save'))}</button>`}
      <button class="btn secondary" id="share" type="button">${esc(t('btn_share'))}</button>
    </div>
    <button class="btn primary block section" id="new" type="button">${esc(t('btn_new'))}</button>
    <footer class="section caption">${esc(t('footer'))}</footer>`;
  cta([]); // no floating button over the result: actions stay readable
}

function ledger() {
  const entries = ledgerStore.load();
  const sums = yearlySummary(entries, today());
  $app.innerHTML = `<h2 style="margin-top:16px">${esc(t('ledger_title'))}</h2>
    ${sums.map((s) => `<p class="verdict">${esc(t('ledger_year', { n: s.count, amt: moneyRange(s, s.currency, locale) }))}</p>`).join('')}
    ${entries.length ? entries.map((e) => `<div class="ledger-item"><div><b>${esc(e.date)} · ${esc(e.sent.currency)} → ${esc(e.received.currency)}</b>
      <span class="caption">${esc(e.provider || '')} ${esc(money(e.sent.amount, e.sent.currency, locale, { nice: false }))}</span></div>
      <div style="text-align:right"><b>${esc(moneyRange(e.total, e.sent.currency, locale))}</b><button class="link" data-remove="${esc(e.id)}" type="button">${esc(t('btn_remove'))}</button></div></div>`).join('')
    : `<p class="note section">${esc(t('ledger_empty'))}</p>`}
    ${entries.length ? `<div class="section"><button class="btn secondary block" id="ledger-copy" type="button">${esc(t('ledger_copy'))}</button></div>` : ''}`;
  cta([`<button class="btn primary" data-go="home" type="button">${esc(t('btn_enter'))}</button>`]);
}

// ---------- actions ----------
function msg(text) { const m = document.getElementById('msg'); if (m) m.innerHTML = text ? `<div class="err">${esc(text)}</div>` : ''; }

async function runAudit(sources = rateSources) {
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
  const r = await auditTransfer(input, { rateSources: sources, today: today() });
  if (!r.ok) {
    if (r.error === 'NO_REFERENCE') state.error = t('err_NO_REFERENCE');
    else if (r.error === 'IMPLAUSIBLE') state.error = t('err_IMPLAUSIBLE', { pct: pct((r.audit.markup.low + r.audit.markup.high) / 2, locale, 0) });
    else state.error = t('err_INVALID', { list: r.details.map((c) => t(`e_${c}`)).join(', ') });
    state.screen = back === 'home' ? 'step2' : back;
    render();
    msg(state.error);
    return;
  }
  state.result = r;
  state.quotes = null;
  state.quotesAsked = false;
  state.askOpen = false;
  state.saved = false;
  state.monthly = String(r.receipt.sent.amount);
  go('result');
}

// Today's quotes are fetched only when asked: the request tells Wise the route and amount.
// They are scored against today's mid-market range from the same public sources as your transfer.
function askQuotes() {
  const r = state.result;
  const { currency: from, amount } = r.receipt.sent;
  const to = r.receipt.received.currency;
  const day = today();
  state.quotesAsked = true;
  replaceCard('next-card', nextHtml(r));
  Promise.all([
    quotesSource.getQuotes(from, to, amount).catch(() => ({ quotes: [] })),
    collectBand(from, to, day, rateSources).catch(() => ({ band: null })),
  ]).then(([q, b]) => {
    if (state.result !== r) return;
    state.quotes = { quotes: q.quotes || [], band: b.band, date: day };
    replaceCard('next-card', nextHtml(r));
    const line = document.getElementById('saving-line');
    if (line) line.innerHTML = savingHtml(r, comparison(r));
  });
}

// Replace one card only: an opened <details> or a half-typed monthly amount must survive.
function replaceCard(id, html) {
  const card = document.getElementById(id);
  if (state.screen === 'result' && card) card.outerHTML = html;
}

async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = t('copied'); } catch { /* clipboard blocked: the text stays selectable */ }
}

function rerenderKeepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }

function readDraftInputs() {
  for (const el of $app.querySelectorAll('input[name], select[name]')) {
    const f = state.draft.fields[el.name];
    let v = el.value.trim();
    if (f && !f.confirmed && String(f.value) === v) continue; // untouched machine value stays unconfirmed
    if (!f && v === '') continue;
    if (AMOUNT_FIELDS[el.name] && v !== '') {
      // "1,000,000" · "1.000.000" · "2,5": read the way receipts print amounts
      const curField = state.draft.fields[AMOUNT_FIELDS[el.name]];
      const n = parseAmount(v, curField ? curField.value : null);
      if (n !== null) v = n;
    }
    state.draft = confirmField(state.draft, el.name, v);
  }
}

function startFromText(text, origin) {
  const { fields, hints, dateOptions } = parseReceiptText(text);
  if (!Object.keys(fields).length) { msg(t('read_none')); return; }
  reset();
  state.draft = createDraft(fields, origin);
  state.machine = true;
  state.hints = hints;
  state.dateOptions = dateOptions || null;
  go('step1');
}

function startSample(i) {
  const s = samples[i];
  reset();
  state.sample = s;
  state.draft = createDraft(s.input, 'sample');
  // samples replay the rates recorded when the quote was collected: same answer on any day, even offline
  runAudit(s.observations ? frozenSources(s.observations) : rateSources);
}

function startShared(input) {
  reset();
  state.shared = true;
  state.draft = createDraft(input, 'typed');
  runAudit();
}

async function shareResult() {
  const r = state.result;
  const a = r.audit;
  const text = t('share_text', { from: r.receipt.sent.currency, to: r.receipt.received.currency, cost: moneyRange(a.cost.total, a.cost.currency, locale),
    pct: pctRange(a.cost.totalPct, locale), fee: money(a.cost.fee, a.cost.currency, locale, { nice: false }) });
  const input = { provider: r.receipt.provider, sentAmount: r.receipt.sent.amount, sentCurrency: r.receipt.sent.currency, fee: r.receipt.fee.amount,
    receivedAmount: r.receipt.received.amount, receivedCurrency: r.receipt.received.currency, date: r.receipt.date };
  // a sample shares its id (it replays the recorded rates); anything else shares the receipt itself
  const url = state.sample ? `${location.origin}${location.pathname}?sample=${encodeURIComponent(state.sample.id)}`
    : `${location.origin}${location.pathname}?r=${encodeReceipt(input)}`;
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
    if (el.dataset.go === 'step1' && state.screen === 'home') reset();
    state.error = null;
    go(el.dataset.go);
    return;
  }
  if (el.dataset.sample !== undefined) { startSample(Number(el.dataset.sample)); return; }
  if (el.dataset.confirmStep) {
    readDraftInputs();
    state.draft = confirmFields(state.draft, confirmableOnStep(el.dataset.confirmStep));
    rerenderKeepScroll();
    return;
  }
  if (el.dataset.feeTop) {
    readDraftInputs();
    if (el.dataset.feeTop === 'yes') state.draft = addFeeOnTop(state.draft);
    state.feeAnswered = true;
    rerenderKeepScroll();
    return;
  }
  if (el.dataset.datePick) {
    readDraftInputs();
    state.draft = confirmField(state.draft, 'date', el.dataset.datePick);
    state.dateOptions = null;
    rerenderKeepScroll();
    return;
  }
  if (el.dataset.remove) { removeEntry(ledgerStore, el.dataset.remove); render(); return; }
  switch (el.id) {
    case 'ledger-btn': go('ledger'); break;
    case 'quote-mode': reset(); state.mode = 'quote'; go('step1'); break;
    case 'next1': {
      readDraftInputs();
      const un = STEP_FIELDS.step1.filter((k) => state.draft.fields[k] && !state.draft.fields[k].confirmed);
      if (un.length) { msg(t('confirm_all_first')); break; }
      if (!state.draft.fields.sentAmount) { msg(t('err_INVALID', { list: t('e_SENT_POSITIVE') })); break; }
      // any fee, typed or read: ask once whether it was charged on top (it changes what was paid)
      const fee = state.draft.fields.fee;
      if (fee && Number(fee.value) > 0 && !state.feeAnswered && !state.hints.includes('SENT_IS_TOTAL')) {
        if (!state.hints.includes('CHECK_FEE_INCLUDED')) state.hints = [...state.hints, 'CHECK_FEE_INCLUDED'];
        rerenderKeepScroll();
        const q = document.getElementById('fee-top');
        if (q) q.scrollIntoView({ block: 'center' });
        break;
      }
      go('step2');
      break;
    }
    case 'check':
      readDraftInputs();
      if (state.dateOptions) { msg(t('date_pick')); break; }
      runAudit();
      break;
    case 'read-paste': startFromText(document.getElementById('paste-text').value, 'pasted'); break;
    case 'new': reset(); go('home'); break;
    case 'save': ledgerStore && addEntry(ledgerStore, entryFromResult(state.result, new Date().toISOString())); state.saved = true; el.textContent = t('saved'); break;
    case 'share': shareResult(); break;
    case 'quotes': askQuotes(); break;
    case 'ask': state.askOpen = true; rerenderKeepScroll(); break;
    case 'copy-ask': copyText(document.getElementById('ask-text').value, el); break;
    case 'ledger-copy': copyText(ledgerText(ledgerStore.load(), today()), el); break;
    default: break;
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'monthly') {
    state.monthly = ev.target.value;
    const r = state.result;
    const m = parseAmount(state.monthly.trim(), r.receipt.sent.currency);
    const y = yearlyImpact(r.audit.cost.totalPct, m);
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
  const [s, c, kr] = await Promise.all([
    fetch('data/samples.json').then((x) => x.json()).catch(() => []),
    fetch('data/context.json').then((x) => x.json()).catch(() => null),
    fetch('data/quotes-kr.json').then((x) => x.json()).catch(() => ({ quotes: [] })),
  ]);
  samples = s; context = c; krQuotes = kr.quotes || [];
  render();
  const shared = params.get('r') && decodeReceipt(params.get('r'));
  if (shared) { startShared(shared); return; }
  const want = params.get('sample');
  if (want !== null) {
    const i = samples.findIndex((x) => x.id === want || String(samples.indexOf(x)) === want);
    if (i >= 0) startSample(i);
  }
}
boot();
