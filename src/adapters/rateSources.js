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
    official: false, // community aggregator
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
    official: true,
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
    official: false,
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

const NRB_CURRENCIES = new Set('INR USD EUR GBP CHF AUD CAD SGD JPY CNY SAR QAR THB AED MYR KRW SEK DKK HKD KWD BHD OMR'.split(' '));

/**
 * Nepal Rastra Bank (central bank of Nepal) — daily buy/sell reference rates against NPR; we use the mid.
 * https://www.nrb.org.np/forex/ · CORS-open JSON API.
 */
export function nrbSource(fetchFn = globalThis.fetch.bind(globalThis)) {
  return {
    name: 'Nepal Rastra Bank',
    official: true,
    home: 'https://www.nrb.org.np/forex/',
    supports: (from, to) => (to === 'NPR' && NRB_CURRENCIES.has(from)) || (from === 'NPR' && NRB_CURRENCIES.has(to)),
    async getRate(from, to, date) {
      const url = `https://www.nrb.org.np/api/forex/v1/rates?from=${date}&to=${date}&per_page=10&page=1`;
      const j = await getJson(fetchFn, url);
      const day = j && j.data && j.data.payload && j.data.payload[0];
      if (!day) return null;
      const other = from === 'NPR' ? to : from;
      const row = day.rates.find((r) => r.currency.iso3 === other);
      if (!row) return null;
      const nprPerUnit = (Number(row.buy) + Number(row.sell)) / 2 / Number(row.currency.unit);
      if (!(nprPerUnit > 0)) return null;
      return { rate: from === 'NPR' ? 1 / nprPerUnit : nprPerUnit, date: day.date, url };
    },
  };
}

const CBU_CURRENCIES = new Set('USD EUR GBP JPY KRW CNY RUB KZT KGS TJS TRY AED SAR CHF CAD AUD SGD MYR INR'.split(' '));

/**
 * Central Bank of the Republic of Uzbekistan — official daily rate against UZS.
 * https://cbu.uz/en/arkhiv-kursov-valyut/ · CORS-open JSON.
 */
export function cbuSource(fetchFn = globalThis.fetch.bind(globalThis)) {
  return {
    name: 'Central Bank of Uzbekistan',
    official: true,
    home: 'https://cbu.uz/en/arkhiv-kursov-valyut/',
    supports: (from, to) => (to === 'UZS' && CBU_CURRENCIES.has(from)) || (from === 'UZS' && CBU_CURRENCIES.has(to)),
    async getRate(from, to, date) {
      const other = from === 'UZS' ? to : from;
      const url = `https://cbu.uz/en/arkhiv-kursov-valyut/json/${other}/${date}/`;
      const j = await getJson(fetchFn, url);
      const row = Array.isArray(j) && j.find((r) => r.Ccy === other);
      if (!row) return null;
      const uzsPerUnit = Number(row.Rate) / Number(row.Nominal || 1);
      if (!(uzsPerUnit > 0)) return null;
      const [d, m, y] = String(row.Date).split('.');
      return { rate: from === 'UZS' ? 1 / uzsPerUnit : uzsPerUnit, date: `${y}-${m}-${d}`, url };
    },
  };
}

/**
 * Replays observations recorded when a sample quote was collected (one source per recorded source name).
 * For a requested date it answers with the latest recorded observation on or before that date, like the live APIs do.
 */
export function frozenSources(observations) {
  const names = [...new Set(observations.map((o) => o.source))];
  return names.map((name) => ({
    name,
    supports: () => true,
    async getRate(from, to, date) {
      const hit = observations.filter((o) => o.source === name && o.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return hit ? { rate: hit.rate, date: hit.date, url: hit.url } : null;
    },
  }));
}
