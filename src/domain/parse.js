// Reads a pasted receipt / SMS / OCR text into *candidate* fields.
// Every value it returns is a guess: the application layer marks them unconfirmed.

const CURRENCIES = new Set(('USD EUR GBP JPY KRW CNY HKD SGD AUD NZD CAD CHF SEK NOK DKK PLN CZK HUF RON TRY ' +
  'INR NPR PKR BDT LKR VND PHP IDR THB MYR KHR MMK LAK MNG MNT UZS KZT KGS TJS RUB UAH ' +
  'MXN BRL COP PEN CLP ARS GTQ HNL DOP NGN GHS KES UGX TZS ZAR EGP MAD AED SAR QAR KWD ILS TWD').split(' '));

const ZERO_DECIMAL = new Set('KRW VND JPY UZS IDR KHR MMK LAK CLP UGX TZS MNT PYG'.split(' '));
const THREE_DECIMAL = new Set('KWD BHD OMR JOD TND IQD LYD'.split(' '));

const SYMBOLS = [
  ['₩', 'KRW'], ['원', 'KRW'], ['₫', 'VND'], ['đồng', 'VND'], ['đ', 'VND'], ['₱', 'PHP'],
  ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ["so'm", 'UZS'], ['сўм', 'UZS'], ['сум', 'UZS'],
  ['US$', 'USD'], ['MX$', 'MXN'], ['A$', 'AUD'], ['C$', 'CAD'], ['S$', 'SGD'], ['HK$', 'HKD'], ['NT$', 'TWD'],
  ['Rp', 'IDR'], ['৳', 'BDT'], ['円', 'JPY'], ['VNĐ', 'VND'], ['VNđ', 'VND'], ['vnđ', 'VND'], ['동', 'VND'],
  ['NRs', 'NPR'], ['रु', 'NPR'], ['Rs.', 'RS?'], ['Rs', 'RS?'], ['$', 'USD'],
];
// "Rs" is a rupee: Nepal's or India's, decided by the rest of the text.
const NEPAL_HINT = /nepal|\bNPR\b|नेपाल|रु|kathmandu/i;
// A bare "$": the dollar of the provider's country when we know it, else US — always flagged for the user to check.
const DOLLAR_COUNTRY = [
  [/commonwealth bank|commbank|westpac|\banz\b|\bnab\b|australia/i, 'AUD'],
  [/\brbc\b|\btd bank|scotiabank|\bbmo\b|canada/i, 'CAD'],
  [/\bdbs\b|\bocbc\b|\buob\b|singapore/i, 'SGD'],
  [/kiwibank|\basb\b|new zealand/i, 'NZD'],
];

const LABELS = {
  total: /(\btotal\b(?!\s*(?:to\s+)?(?:fee|charge|receiv|recipient|beneficiary|payout))|amount paid|you paid|you pay\b|debited|withdrawn|총 ?(결제|출금|송금)?금액|결제 ?금액|출금 ?금액|출금액|출금|합계|tổng)/gi,
  fee: /(fee|charge|commission|수수료|phí)/gi,
  rate: /(exchange rate|\brate\b|환율|tỷ giá|kurs)/gi,
  received: /(receiv|\brecipient\b|beneficiary|they get|payout|deliver|받는 ?(분|금액)|수취 ?금액|입금 ?금액|받을 ?금액|nhận|qabul)/gi,
  // a bare "Amount" is the amount sent unless another word says otherwise ("Total amount", "Amount received")
  sentLoose: /(?<!(?:total|transfer|send|sending|sent|receive|received|recipient|paid|fee)\s)\bamount\b(?!\s*(?:received|to\s+receive|paid|due|sent|to\s+send))/gi,
  sent: /(you send|you sent|send amount|amount sent|sending amount|transfer amount|amount to send|\bsend\b|\bsent\b|송금 ?금액|송금액|보내는 ?금액|보낸 ?금액|số tiền gửi|tiền gửi|jo'nat)/gi,
};

const PROVIDERS = ['Commonwealth Bank', 'Westpac', 'ANZ', 'NAB', 'Wells Fargo', 'Chase', 'Western Union', 'MoneyGram', 'Wise', 'Remitly', 'Xoom', 'WorldRemit', 'Instarem', 'PayPal',
  'OFX', 'Hanpass', 'GME', 'E9pay', 'Sentbe', 'WireBarley', 'Hana', 'KB', 'Shinhan', 'Woori', 'NongHyup', 'Ria'];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// A number is either grouped in threes ("1,000,000" · "1.000.000" · "1 000" · "1,234.56") or plain ("500" · "500.00").
// A separator must be followed by exactly three digits, so "14:32 1,000" or "2026 1,000" are never merged.
const NUM_RE = /(?<![0-9.,])(?:[0-9]{1,3}(?:[,.' \u00a0][0-9]{3})+(?:[.,][0-9]+)?|[0-9]+(?:[.,][0-9]+)?)(?![0-9])/g;
const CODE_RE = /^[A-Z]{3}$/;
const SYM_SORTED = [...SYMBOLS].sort((a, b) => b[0].length - a[0].length);

/** Currency token immediately before (dir −1) or after (dir +1) a number, allowing one space. */
function tokenAround(line, start, end, dir) {
  if (dir > 0) {
    const rest = line.slice(end).replace(/^[ \u00a0]?/, '');
    const code = rest.match(/^([A-Z]{3})(?![\p{L}])/u);
    if (code && CURRENCIES.has(code[1])) return { cur: code[1], explicit: true };
    for (const [sym, cur] of SYM_SORTED) if (rest.startsWith(sym) && !/^[\p{L}]/u.test(rest.slice(sym.length))) return { cur, explicit: false, sym };
    return null;
  }
  const head = line.slice(0, start).replace(/[ \u00a0]?$/, '');
  const code = head.match(/(?<![\p{L}])([A-Z]{3})$/u);
  if (code && CURRENCIES.has(code[1])) return { cur: code[1], explicit: true };
  for (const [sym, cur] of SYM_SORTED) if (head.endsWith(sym) && !/[\p{L}]$/u.test(head.slice(0, head.length - sym.length))) return { cur, explicit: false, sym };
  return null;
}

function symbolToCode(tok) {
  if (CURRENCIES.has(tok)) return tok;
  const hit = SYMBOLS.find(([s]) => s === tok);
  return hit ? hit[1] : null;
}

/** Parse "1,000,000" / "1.000.000" / "500.00" / "1.234,56" / "1 000" into a number. */
export function parseAmount(raw, currency = null) {
  let s = String(raw).replace(/[\s ']/g, '');
  if (!/^[0-9][0-9.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const thousands = parts.length > 2 || parts[parts.length - 1].length === 3;
    s = thousands ? parts.join('') : parts.join('.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    const last = parts[parts.length - 1];
    const thousands = parts.length > 2 || (last.length === 3 && !THREE_DECIMAL.has(currency));
    s = thousands ? parts.join('') : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** All (amount, currency) pairs in a line, in order of appearance. */
export function findAmounts(line) {
  return scanAmounts(line).map(({ amount, currency }) => ({ amount, currency }));
}

function scanAmounts(line) {
  const nums = [];
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(line))) {
    nums.push({ raw: m[0], start: m.index, end: m.index + m[0].length, before: tokenAround(line, m.index, 0, -1), after: tokenAround(line, 0, m.index + m[0].length, 1) });
  }
  // A line is written "USD 500 … PHP 30,000" (prefix) or "500 USD … 30,000 PHP" (suffix): the first number tells which.
  const first = nums.find((x) => x.before || x.after);
  const prefixStyle = first ? Boolean(first.before) : true;
  const hits = [];
  for (const x of nums) {
    let tok = null;
    if (x.before && x.after) {
      if (x.after.explicit && !x.before.explicit) tok = x.after; // "$8,450.10 MXN" → MXN
      else if (x.before.explicit && !x.after.explicit) tok = x.before;
      else tok = prefixStyle ? x.before : x.after;
    } else tok = x.before || x.after;
    if (!tok) continue;
    const amount = parseAmount(x.raw, tok.cur);
    if (amount === null) continue;
    hits.push({ amount, currency: tok.cur, index: x.start, dollar: tok.sym === '$' });
  }
  return hits;
}

function pad(n) { return String(n).padStart(2, '0'); }
function iso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** First date in the text, as {value:'YYYY-MM-DD', confidence}. */
export function findDate(text) {
  let m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return { value: iso(+m[1], +m[2], +m[3]), confidence: 'high' };
  m = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return { value: iso(+m[1], +m[2], +m[3]), confidence: 'high' };
  m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) return { value: iso(+m[3], +m[2], +m[1]), confidence: 'high' };
  m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return { value: iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), confidence: 'high' };
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return { value: iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), confidence: 'high' };
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const a = +m[1]; const b = +m[2]; const y = +m[3];
    const dayFirst = /ngày/i.test(text) || a > 12;
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    const options = ambiguous ? [iso(y, b, a), iso(y, a, b)] : undefined;
    if (dayFirst) return { value: iso(y, b, a), confidence: a > 12 ? 'high' : 'low', options };
    return { value: iso(y, a, b), confidence: b > 12 ? 'high' : 'low', options };
  }
  return null;
}

function findProvider(text) {
  const lower = text.toLowerCase();
  const hit = PROVIDERS.find((p) => new RegExp(`\\b${p.toLowerCase()}\\b`).test(lower));
  return hit || null;
}

/** Label occurrences in a line, ordered by position (overlaps keep the earliest, then the longest). */
function labelsIn(line) {
  const found = [];
  for (const name of ['total', 'fee', 'rate', 'received', 'sent', 'sentLoose']) {
    const re = LABELS[name];
    const key = name === 'sentLoose' ? 'sent' : name;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) found.push({ key, index: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out = [];
  for (const f of found) if (!out.length || f.index >= out[out.length - 1].end) out.push(f);
  return out;
}

/**
 * @returns {{fields: Object<string,{value:any, confidence:'high'|'low'}>, hints:string[]}}
 */
export function parseReceiptText(text) {
  const fields = {};
  const hints = [];
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const labelled = { total: null, fee: null, received: null, sent: null };
  const unlabelled = [];

  const rupee = NEPAL_HINT.test(text) ? 'NPR' : 'INR';
  for (const line of lines) {
    if (/(^|[^0-9.,])1(?:[.,]0+)?\s*(?:[A-Z]{3}|[^\s\d=]{1,3})\s*=\s*[0-9]/.test(line)) continue; // "1 USD = 18.92 MXN" is a rate, not an amount
    const amounts = scanAmounts(line);
    if (!amounts.length) continue;
    const labels = labelsIn(line);
    for (const a of amounts) {
      // the nearest label before the amount; a lone amount with one label after it ("1,000원 송금") uses that one
      let label = null;
      for (const l of labels) if (l.index < a.index) label = l.key;
      if (!label && labels.length === 1 && amounts.length === 1) label = labels[0].key;
      if (label === 'rate') continue;
      const amt = { amount: a.amount, currency: a.currency === 'RS?' ? rupee : a.currency, dollar: a.dollar };
      if (label && !labelled[label]) labelled[label] = amt;
      else unlabelled.push(amt);
    }
  }

  let sent = labelled.total || labelled.sent;
  let received = labelled.received;
  if (!sent && unlabelled.length) sent = unlabelled.find((a) => !received || a.currency !== received.currency);
  if (!received && sent) received = unlabelled.find((a) => a.currency !== sent.currency);

  const conf = (x, isLabelled) => (isLabelled ? 'high' : 'low');
  const dollarOf = () => (DOLLAR_COUNTRY.find(([re]) => re.test(text)) || [null, null])[1];
  const currencyField = (x) => {
    if (!x.dollar) return { value: x.currency, confidence: 'high' };
    const known = dollarOf();
    if (!known) hints.push('DOLLAR_AMBIGUOUS');
    return { value: known || 'USD', confidence: 'low' };
  };
  if (sent) {
    fields.sentAmount = { value: sent.amount, confidence: conf(sent, sent === labelled.total || sent === labelled.sent) };
    fields.sentCurrency = currencyField(sent);
  }
  if (received) {
    fields.receivedAmount = { value: received.amount, confidence: conf(received, received === labelled.received) };
    fields.receivedCurrency = currencyField(received);
  }
  if (labelled.fee && sent && labelled.fee.currency !== sent.currency && !(labelled.fee.dollar && sent.dollar)) hints.push('FEE_OTHER_CURRENCY'); // never relabel 5 USD as 5 KRW
  else if (labelled.fee) fields.fee = { value: labelled.fee.amount, confidence: 'high' };
  else if (/(no fee|zero fee|fee\s*[:：]?\s*(0|free)|수수료\s*(무료|0)|miễn phí)/i.test(text)) fields.fee = { value: 0, confidence: 'high' };

  if (labelled.total && sent === labelled.total) hints.push('SENT_IS_TOTAL');
  if (labelled.sent && labelled.total) hints.push('USED_TOTAL_AS_SENT');
  if (fields.fee && !labelled.total) hints.push('CHECK_FEE_INCLUDED');

  const date = findDate(text);
  let dateOptions;
  if (date && date.value) {
    fields.date = { value: date.value, confidence: date.confidence };
    dateOptions = date.options;
  }
  const provider = findProvider(text);
  if (provider) fields.provider = { value: provider, confidence: 'high' };
  return dateOptions ? { fields, hints, dateOptions } : { fields, hints };
}
