// My transfers: audited receipts kept on this device only, summed over the last 12 months.
// Port LedgerStore { load(): Array, save(entries: Array): void }

import { shiftDate } from '../domain/receipt.js';

export function entryFromResult(result, savedAt) {
  const { receipt, audit } = result;
  return {
    id: `${receipt.date}-${receipt.sent.currency}${receipt.sent.amount}-${receipt.received.currency}${receipt.received.amount}`,
    savedAt,
    provider: receipt.provider,
    date: receipt.date,
    sent: { ...receipt.sent },
    received: { ...receipt.received },
    fee: receipt.fee.amount,
    hidden: { ...audit.cost.hidden },
    total: { ...audit.cost.total },
    totalPct: { ...audit.cost.totalPct },
    classification: audit.classification,
  };
}

export function addEntry(store, entry) {
  const entries = store.load().filter((e) => e.id !== entry.id);
  entries.push(entry);
  entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  store.save(entries);
  return entries;
}

export function removeEntry(store, id) {
  const entries = store.load().filter((e) => e.id !== id);
  store.save(entries);
  return entries;
}

/** Sum of total cost per sending currency for transfers dated within 365 days of `today`. */
export function yearlySummary(entries, today) {
  const since = shiftDate(today, -365);
  const byCurrency = {};
  for (const e of entries) {
    if (e.date <= since || e.date > today) continue;
    const c = (byCurrency[e.sent.currency] ||= { currency: e.sent.currency, count: 0, sent: 0, low: 0, high: 0, fee: 0 });
    c.count += 1;
    c.sent += e.sent.amount;
    c.fee += e.fee;
    c.low += Math.max(0, e.total.low);
    c.high += Math.max(0, e.total.high);
  }
  return Object.values(byCurrency);
}
