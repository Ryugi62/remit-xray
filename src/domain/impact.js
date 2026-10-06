// What one receipt means over a year, and how it compares with public benchmarks.

export const SDG_TARGET = 0.03; // SDG 10.c: remittance cost below 3%

/** totalPct range × monthly amount × 12 — an estimate, labelled as such. */
export function yearlyImpact(totalPct, monthlyAmount) {
  const m = Number(monthlyAmount);
  if (!(m > 0)) return null;
  return {
    low: Math.max(0, totalPct.low) * m * 12,
    high: Math.max(0, totalPct.high) * m * 12,
    estimate: true,
  };
}

/**
 * @param totalPct {low, high} as fractions
 * @param benchmark fraction or null (e.g. World Bank average for the corridor)
 * @returns 'below-target' | 'above-target' | 'straddles-target', plus vs benchmark
 */
export function compareToBenchmarks(totalPct, benchmark = null) {
  const sdg = totalPct.high <= SDG_TARGET ? 'below-target'
    : totalPct.low > SDG_TARGET ? 'above-target' : 'straddles-target';
  let vsAverage = null;
  if (Number.isFinite(benchmark)) {
    vsAverage = totalPct.low > benchmark ? 'above-average'
      : totalPct.high < benchmark ? 'below-average' : 'around-average';
  }
  return { sdg, vsAverage };
}
