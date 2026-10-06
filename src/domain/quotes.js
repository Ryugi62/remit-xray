// Published quotes and your transfer on one scale: total cost (fee + exchange-rate margin) as % of what is paid.

/**
 * @param {{sent:number, fee:number, received:number, mid:number}} q  mid = mid-market rate (received per 1 sent)
 * @returns {{totalPct:number, feePct:number}}
 */
export function quoteCost({ sent, fee, received, mid }) {
  return { totalPct: (sent - received / mid) / sent, feePct: fee / sent };
}

const midOf = (r) => (r.low + r.high) / 2;

/**
 * @param yourTotalPct {low, high}
 * @param quotes Array<{provider, totalPct:{low,high}, ...}>
 * @returns {{rows:Array, youMid:number, cheapestMid:number|null}} rows sorted cheapest first, your row marked `you`
 */
export function compareWithQuotes(yourTotalPct, quotes) {
  const rows = [...quotes.map((q) => ({ ...q })), { you: true, totalPct: { ...yourTotalPct } }]
    .sort((a, b) => midOf(a.totalPct) - midOf(b.totalPct));
  const others = quotes.map((q) => midOf(q.totalPct));
  return { rows, youMid: midOf(yourTotalPct), cheapestMid: others.length ? Math.min(...others) : null };
}
