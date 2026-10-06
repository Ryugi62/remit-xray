// Reads a pasted receipt / SMS / OCR text into *candidate* fields.
// Every value it returns is a guess: the application layer marks them unconfirmed.

const CURRENCIES = new Set(('USD EUR GBP JPY KRW CNY HKD SGD AUD NZD CAD CHF SEK NOK DKK PLN CZK HUF RON TRY ' +
  'INR NPR PKR BDT LKR VND PHP IDR THB MYR KHR MMK LAK MNG MNT UZS KZT KGS TJS RUB UAH ' +
  'MXN BRL COP PEN CLP ARS GTQ HNL DOP NGN GHS KES UGX TZS ZAR EGP MAD AED SAR QAR KWD ILS').split(' '));

const ZERO_DECIMAL = new Set('KRW VND JPY UZS IDR KHR MMK LAK CLP UGX TZS MNT PYG'.split(' '));

const SYMBOLS = [
  ['₩', 'KRW'], ['원', 'KRW'], ['₫', 'VND'], ['đồng', 'VND'], ['đ', 'VND'], ['₱', 'PHP'],
  ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ["so'm", 'UZS'], ['сўм', 'UZS'], ['сум', 'UZS'],
  ['US$', 'USD'], ['$', 'USD'],
];

const LABELS = {
  total: /(\btotal\b(?!\s*(fee|charge))|amount paid|you paid|you pay\b|총 ?(결제|출금|송금)?금액|결제 ?금액|합계|tổng)/i,
  fee: /(fee|charge|commission|수수료|phí)/i,
  rate: /(exchange rate|\brate\b|환율|tỷ giá|kurs)/i,
  received: /(receiv|recipient gets|they get|payout|deliver|받는 ?(분|금액)|수취 ?금액|입금 ?금액|받을 ?금액|nhận|qabul)/i,
  sent: /(you send|you sent|send amount|amount sent|sending amount|transfer amount|amount to send|\bsend\b|\bsent\b|송금 ?금액|송금액|보내는 ?금액|보낸 ?금액|số tiền gửi|tiền gửi|jo'nat)/i,
};

const PROVIDERS = ['Western Union', 'MoneyGram', 'Wise', 'Remitly', 'Xoom', 'WorldRemit', 'Instarem', 'PayPal',
  'OFX', 'Hanpass', 'GME', 'E9pay', 'Sentbe', 'WireBarley', 'Hana', 'KB', 'Shinhan', 'Woori', 'NongHyup', 'Ria'];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const NUM = "[0-9](?:[0-9.,' \\u00a0]*[0-9])?";
const SYM = SYMBOLS.map(([s]) => s.replace(/[$]/g, '\\$')).join('|');
const CODE = '[A-Z]{3}';
const PREFIX_RE = new RegExp(`(${CODE}|${SYM})\\s?(${NUM})`, 'g');
const SUFFIX_RE = new RegExp(`(${NUM})\\s?(${CODE}|${SYM})(?![A-Za-z])`, 'g');

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
    const thousands = parts.length > 2 || (last.length === 3 && ZERO_DECIMAL.has(currency));
    s = thousands ? parts.join('') : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** All (amount, currency) pairs in a line, in order of appearance. */
export function findAmounts(line) {
  // A line is written either "USD 500" (prefix) or "500 USD" (suffix) style.
  // Matching both would pair a number with its neighbour's code, so pick the style that starts first.
  const byStyle = (re, prefix) => {
    const hits = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const cur = symbolToCode(prefix ? m[1] : m[2]);
      if (!cur) continue;
      const amount = parseAmount(prefix ? m[2] : m[1], cur);
      if (amount === null) continue;
      hits.push({ index: m.index, amount, currency: cur });
    }
    return hits;
  };
  const pre = byStyle(PREFIX_RE, true);
  const suf = byStyle(SUFFIX_RE, false);
  let hits;
  if (!pre.length) hits = suf;
  else if (!suf.length) hits = pre;
  else hits = pre[0].index < suf[0].index ? pre : suf;
  return hits.map(({ amount, currency }) => ({ amount, currency }));
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
  m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return { value: iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), confidence: 'high' };
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return { value: iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), confidence: 'high' };
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const a = +m[1]; const b = +m[2]; const y = +m[3];
    const dayFirst = /ngày/i.test(text) || a > 12;
    if (dayFirst) return { value: iso(y, b, a), confidence: a > 12 ? 'high' : 'low' };
    return { value: iso(y, a, b), confidence: b > 12 ? 'high' : 'low' };
  }
  return null;
}

function findProvider(text) {
  const lower = text.toLowerCase();
  const hit = PROVIDERS.find((p) => new RegExp(`\\b${p.toLowerCase()}\\b`).test(lower));
  return hit || null;
}

function labelOf(line) {
  for (const key of ['total', 'fee', 'rate', 'received', 'sent']) {
    if (LABELS[key].test(line)) return key;
  }
  return null;
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

  for (const line of lines) {
    const amounts = findAmounts(line);
    if (!amounts.length) continue;
    const label = labelOf(line);
    if (label === 'rate') continue; // "1 USD = 1,346 KRW" is not an amount
    if (label && !labelled[label]) labelled[label] = amounts[0];
    else unlabelled.push(...amounts);
  }

  let sent = labelled.total || labelled.sent;
  let received = labelled.received;
  if (!sent && unlabelled.length) sent = unlabelled.find((a) => !received || a.currency !== received.currency);
  if (!received && sent) received = unlabelled.find((a) => a.currency !== sent.currency);

  const conf = (x, isLabelled) => (isLabelled ? 'high' : 'low');
  if (sent) {
    fields.sentAmount = { value: sent.amount, confidence: conf(sent, sent === labelled.total || sent === labelled.sent) };
    fields.sentCurrency = { value: sent.currency, confidence: 'high' };
  }
  if (received) {
    fields.receivedAmount = { value: received.amount, confidence: conf(received, received === labelled.received) };
    fields.receivedCurrency = { value: received.currency, confidence: 'high' };
  }
  if (labelled.fee) fields.fee = { value: labelled.fee.amount, confidence: 'high' };
  else if (/(no fee|zero fee|fee\s*[:：]?\s*(0|free)|수수료\s*(무료|0)|miễn phí)/i.test(text)) fields.fee = { value: 0, confidence: 'high' };

  if (labelled.sent && labelled.total) hints.push('USED_TOTAL_AS_SENT');
  if (labelled.fee && !labelled.total) hints.push('CHECK_FEE_INCLUDED');

  const date = findDate(text);
  if (date && date.value) fields.date = date;
  const provider = findProvider(text);
  if (provider) fields.provider = { value: provider, confidence: 'high' };
  return { fields, hints };
}
