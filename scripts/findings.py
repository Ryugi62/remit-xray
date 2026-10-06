"""Prints the headline numbers quoted in README.md from vectors/receipts.json (no network).

Run: python3 scripts/findings.py
"""
import json
import statistics as st
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOL = 0.30  # percentage points, src/domain/audit.js MEASUREMENT_TOLERANCE


def mid(e):
    return (e["total_pct_low"] + e["total_pct_high"]) / 2


def main():
    v = json.loads((ROOT / "vectors/receipts.json").read_text())["vectors"]
    corridors = {x["input"]["sentCurrency"] + "-" + x["input"]["receivedCurrency"] for x in v}
    providers = {x["input"]["provider"] for x in v}
    days = Counter(x["input"]["date"] for x in v)
    wise_cmp = [x for x in v if x["origin"].startswith("Wise comparison")]
    print(f"- {len(v)} real quotes · {len(providers)} provider names · {len(corridors)} corridors · "
          + ", ".join(f"{n} priced on {d}" for d, n in sorted(days.items())))
    print(f"  ({len(wise_cmp)} collected by Wise's public comparison API — Wise is itself a provider; "
          f"{len(v) - len(wise_cmp)} read from the Hanpass, GME Remit and E9pay public calculators. "
          "NatWest and RBS belong to one banking group and quote the same price.)")
    zero = [x for x in v if x["input"]["fee"] == 0]
    zero_markup = [x for x in zero if x["expected"]["classification"] == "markup"]
    key = lambda x: (x["input"]["sentCurrency"], x["input"]["receivedCurrency"], x["input"]["date"], x["input"]["sentAmount"], x["input"]["fee"], x["input"]["receivedAmount"])
    dz, dzm = {key(x) for x in zero}, {key(x) for x in zero_markup}
    print(f"- distinct prices only (banks of one group quoting the identical price counted once): {len(dzm)} of {len(dz)} zero-fee prices cost money")
    print(f"- {len(zero_markup)} of {len(zero)} \"zero-fee\" quotes still cost money through the rate: "
          f"median {st.median(mid(x['expected']) for x in zero_markup):.2f}%, "
          f"up to {max(x['expected']['total_pct_high'] for x in zero_markup):.2f}%")
    for x in sorted(zero_markup, key=lambda x: -mid(x["expected"]))[:3]:
        e = x["expected"]
        print(f"    {x['id']}: {e['total_pct_low']:.2f}–{e['total_pct_high']:.2f}%")
    paid = [x for x in v if x["input"]["fee"] > 0 and x["expected"]["classification"] == "markup"]
    share = []
    for x in paid:
        e = x["expected"]
        total = (e["total_cost_low"] + e["total_cost_high"]) / 2
        share.append((total - x["input"]["fee"]) / total)
    print(f"- quotes that DO show a fee and also take a margin: in {sum(h > 0.5 for h in share)} of {len(paid)}, "
          f"the margin was the bigger part of the cost (median {st.median(share) * 100:.0f}% of the total)")
    pub = [x for x in v if isinstance(x.get("published_markup_pct"), (int, float))]
    inside = [x for x in pub if x["expected"]["markup_low_pct"] <= x["published_markup_pct"] <= x["expected"]["markup_high_pct"]]
    miss = [max(x["expected"]["markup_low_pct"] - x["published_markup_pct"], x["published_markup_pct"] - x["expected"]["markup_high_pct"], 0) for x in pub]
    print(f"- calibration vs Wise's own published markups ({len(pub)} quotes): {len(inside)} inside our range, "
          f"{sum(m <= TOL for m in miss)} within ±{TOL:.2f} pp (largest miss {max(miss):.2f} pp) — the tolerance was SET from this miss")
    route = lambda x: x["input"]["sentCurrency"] + "-" + x["input"]["receivedCurrency"]
    signed = lambda x: (x["published_markup_pct"] - x["expected"]["markup_high_pct"]) if x["published_markup_pct"] > x["expected"]["markup_high_pct"] else \
        (x["published_markup_pct"] - x["expected"]["markup_low_pct"]) if x["published_markup_pct"] < x["expected"]["markup_low_pct"] else 0.0
    covered = 0
    for r in sorted({route(x) for x in pub}):
        held = [x for x in pub if route(x) == r]
        tol = max(max(x["expected"]["markup_low_pct"] - x["published_markup_pct"], x["published_markup_pct"] - x["expected"]["markup_high_pct"], 0)
                  for x in pub if route(x) != r)
        ok = sum(abs(signed(x)) <= tol + 1e-9 for x in held)
        covered += ok
        print(f"    {r}: {len(held)} quotes, offset of misses {min(map(signed, held)):+.2f}…{max(map(signed, held)):+.2f} pp; "
              f"tolerance fitted on the other routes = {tol:.2f} pp covers {ok}/{len(held)}")
    print(f"  held out by route: {covered}/{len(pub)} covered by a tolerance that never saw their route")
    allmid = sorted(mid(x["expected"]) for x in v)
    kr = [x for x in v if x["input"]["sentCurrency"] == "KRW"]
    print(f"- median total cost across all {len(v)} quotes: {st.median(allmid):.2f}%; Korean apps (9 quotes) "
          f"{min(mid(x['expected']) for x in kr):.2f}–{max(mid(x['expected']) for x in kr):.2f}% (mid-points)")


if __name__ == "__main__":
    main()
