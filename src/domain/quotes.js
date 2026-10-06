// Published quotes and your transfer on one scale: total cost (fee + exchange-rate margin) as % of what is paid.

/**
 * @param {{sent:number, fee:number, received:number, mid:number}} q  mid = mid-market rate (received per 1 sent)
 * @returns {{totalPct:number, feePct:number}}
 */
export function quoteCost({ sent, fee, received, mid }) {
  return { totalPct: (sent - received / mid) / sent, feePct: fee / sent };
}

/** The same quote against a reference band {min, max}: a cost range, like your own transfer's. */
export function quoteCostRange({ sent, received }, band) {
  return { low: (sent - received / band.min) / sent, high: (sent - received / band.max) / sent };
}

/**
 * A quote recorded at one amount, rescaled to yours: its fee is fixed, its margin (fraction of the converted amount) is not.
 * @param {{fee:number, markup:{low:number, high:number}}} q
 * @returns {{low:number, high:number}|null} total cost as fraction of `amount`; null if the fee alone exceeds the amount
 */
export function scaleQuote({ fee, markup }, amount) {
  if (!(amount > fee)) return null;
  const converted = amount - fee;
  return { low: (fee + converted * markup.low) / amount, high: (fee + converted * markup.high) / amount };
}

const midOf = (r) => (r.low + r.high) / 2;
const isPromo = (q) => q.totalPct.high < 0; // better than mid-market: usually a first-transfer promotion

/**
 * @param yourTotalPct {low, high}
 * @param quotes Array<{provider, totalPct:{low,high}, ...}>
 * @returns rows sorted cheapest first (your row marked `you`), and the cheapest non-promotional quote
 */
export function compareWithQuotes(yourTotalPct, quotes) {
  const rows = [...quotes.map((q) => ({ ...q, promo: isPromo(q) })), { you: true, totalPct: { ...yourTotalPct } }]
    .sort((a, b) => midOf(a.totalPct) - midOf(b.totalPct));
  const regular = quotes.filter((q) => !isPromo(q)).sort((a, b) => midOf(a.totalPct) - midOf(b.totalPct));
  const cheapest = regular[0] || null;
  return { rows, youMid: midOf(yourTotalPct), cheapest, cheapestMid: cheapest ? midOf(cheapest.totalPct) : null };
}

/** What the cheapest listed option would have kept for the same amount (sent currency); null if you were already as cheap. */
export function savingVs(yourTotalPct, cheapestPct, amount) {
  const low = (yourTotalPct.low - cheapestPct) * amount;
  const high = (yourTotalPct.high - cheapestPct) * amount;
  if (!(high > 0)) return null;
  return { low: Math.max(0, low), high };
}
