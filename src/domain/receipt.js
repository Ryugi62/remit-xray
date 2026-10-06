// Transfer receipt: what the sender actually paid and what actually arrived.
// Pure domain code — no I/O, no framework.

const ISO = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * @param {{provider?:string, sentAmount:number, sentCurrency:string, fee?:number,
 *          receivedAmount:number, receivedCurrency:string, date:string}} input
 * @param {{today?:string}} [opts] today as YYYY-MM-DD (UTC+14 safe upper bound is the caller's job)
 */
export function createTransferReceipt(input, opts = {}) {
  const errors = [];
  const sentCurrency = String(input.sentCurrency || '').trim().toUpperCase();
  const receivedCurrency = String(input.receivedCurrency || '').trim().toUpperCase();
  const sent = Number(input.sentAmount);
  const fee = input.fee === undefined || input.fee === null || input.fee === '' ? 0 : Number(input.fee);
  const received = Number(input.receivedAmount);
  const date = String(input.date || '').trim();

  if (!(sent > 0) || !Number.isFinite(sent)) errors.push('SENT_POSITIVE');
  if (!(received > 0) || !Number.isFinite(received)) errors.push('RECEIVED_POSITIVE');
  if (!(fee >= 0) || !Number.isFinite(fee)) errors.push('FEE_NONNEGATIVE');
  else if (sent > 0 && fee >= sent) errors.push('FEE_LT_SENT');
  if (!ISO.test(sentCurrency) || !ISO.test(receivedCurrency)) errors.push('CURRENCY_FORMAT');
  else if (sentCurrency === receivedCurrency) errors.push('SAME_CURRENCY');
  if (!isValidDate(date)) errors.push('DATE_FORMAT');
  else if (opts.today && date > opts.today) errors.push('DATE_FUTURE');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    receipt: Object.freeze({
      provider: String(input.provider || '').trim(),
      sent: Object.freeze({ amount: sent, currency: sentCurrency }),
      fee: Object.freeze({ amount: fee, currency: sentCurrency }),
      received: Object.freeze({ amount: received, currency: receivedCurrency }),
      date,
    }),
  };
}

export function corridorOf(receipt) {
  return { from: receipt.sent.currency, to: receipt.received.currency };
}

/** Days before `date` (YYYY-MM-DD), as YYYY-MM-DD. */
export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
