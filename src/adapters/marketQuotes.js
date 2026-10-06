// "Next time" quotes: what providers publish today for the same corridor and amount.
// Source: Wise comparison API (public, CORS-open). Wise is itself a provider — the UI says so.

export function wiseQuotes(fetchFn = globalThis.fetch.bind(globalThis)) {
  return {
    name: 'Wise comparison API',
    async getQuotes(from, to, amount) {
      const url = `https://api.wise.com/v4/comparisons/?sourceCurrency=${from}&targetCurrency=${to}&sendAmount=${amount}`;
      const res = await fetchFn(url);
      if (!res.ok) return { url, quotes: [] };
      const j = await res.json();
      const quotes = (j.providers || []).flatMap((p) => (p.quotes || []).slice(0, 1)
        .filter((q) => q.receivedAmount > 0)
        .map((q) => ({
          provider: p.name,
          fee: q.fee,
          rate: q.rate,
          received: q.receivedAmount,
          markupPct: q.markup,
          collectedAt: q.dateCollected,
        })));
      quotes.sort((a, b) => b.received - a.received);
      return { url, quotes };
    },
  };
}
