// Reference band: the range of published mid-market rates around the transfer date.
// A range, not a point — we do not know the minute the provider priced the transfer.

/**
 * @param {Array<{source:string, date:string, rate:number, url?:string}>} observations
 * @returns {null | {min:number, max:number, observations:Array, sources:string[]}}
 */
export function createReferenceBand(observations) {
  const valid = (observations || []).filter((o) => Number.isFinite(o.rate) && o.rate > 0);
  if (!valid.length) return null;
  const seen = new Set();
  const unique = [];
  for (const o of valid) {
    const key = `${o.source}|${o.date}`;
    if (seen.has(key)) continue; // e.g. ECB returns Friday's fixing for Sat and Sun
    seen.add(key);
    unique.push(Object.freeze({ ...o }));
  }
  const rates = unique.map((o) => o.rate);
  return Object.freeze({
    min: Math.min(...rates),
    max: Math.max(...rates),
    observations: Object.freeze(unique),
    sources: Object.freeze([...new Set(unique.map((o) => o.source))]),
  });
}

/** Relative width of the band — how uncertain the reference is. */
export function bandSpread(band) {
  return band.max / band.min - 1;
}
