// RateSource adapters (port defined in application/auditTransfer.js).
// Both are free, keyless and CORS-open, so the page needs no backend.

const ECB_CURRENCIES = new Set('AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR'.split(' '));

async function getJson(fetchFn, url) {
  const res = await fetchFn(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** fawazahmed0/currency-api — daily rates for ~300 currencies, served by jsDelivr (mirror: Cloudflare Pages). */
export function currencyApiSource(fetchFn = globalThis.fetch.bind(globalThis)) {
  const urls = (from, date) => [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${from}.min.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/${from}.min.json`,
  ];
  return {
    name: 'currency-api',
    home: 'https://github.com/fawazahmed0/exchange-api',
    supports: () => true,
    async getRate(from, to, date) {
      const f = from.toLowerCase();
      const t = to.toLowerCase();
      let lastErr = null;
      for (const url of urls(f, date)) {
        try {
          const j = await getJson(fetchFn, url);
          if (!j) continue;
          const rate = j[f] && j[f][t];
          if (!(rate > 0)) return null;
          return { rate, date: j.date, url };
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;
      return null;
    },
  };
}

/** Frankfurter — European Central Bank reference rates (≈30 major currencies, business days). */
export function frankfurterSource(fetchFn = globalThis.fetch.bind(globalThis)) {
  return {
    name: 'ECB (Frankfurter)',
    home: 'https://frankfurter.dev',
    supports: (from, to) => ECB_CURRENCIES.has(from) && ECB_CURRENCIES.has(to),
    async getRate(from, to, date) {
      const url = `https://api.frankfurter.dev/v1/${date}?base=${from}&symbols=${to}`;
      const j = await getJson(fetchFn, url);
      if (!j || !j.rates || !(j.rates[to] > 0)) return null;
      return { rate: j.rates[to], date: j.date, url };
    },
  };
}

/**
 * ExchangeRate-API open access — one daily snapshot ("latest" only, ~160 currencies incl. VND, NPR, UZS).
 * Useful as a second source for recent receipts in corridors the ECB does not cover.
 * Attribution required: "Rates By Exchange Rate API".
 */
export function openErApiSource(fetchFn = globalThis.fetch.bind(globalThis)) {
  const cache = new Map();
  return {
    name: 'ExchangeRate-API',
    home: 'https://www.exchangerate-api.com',
    supports: () => true,
    async getRate(from, to, date) {
      const url = `https://open.er-api.com/v6/latest/${from}`;
      if (!cache.has(url)) cache.set(url, getJson(fetchFn, url));
      const j = await cache.get(url);
      if (!j || j.result !== 'success' || !(j.rates && j.rates[to] > 0)) return null;
      const published = new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10);
      if (published !== date) return null; // a "latest" snapshot only speaks for its own day
      return { rate: j.rates[to], date: published, url };
    },
  };
}
