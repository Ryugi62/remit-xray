// Audit of one transfer: how much was taken through the exchange rate, on top of the stated fee.

/** received ÷ (sent − fee): what each unit actually converted at. */
export function effectiveRate(receipt) {
  return receipt.received.amount / (receipt.sent.amount - receipt.fee.amount);
}

/**
 * @param receipt from createTransferReceipt
 * @param band from createReferenceBand
 */
export function auditReceipt(receipt, band) {
  const eff = effectiveRate(receipt);
  const converted = receipt.sent.amount - receipt.fee.amount;
  // markup = 1 − eff / reference. Lower reference → lower markup.
  const markup = { low: 1 - eff / band.min, high: 1 - eff / band.max };

  let classification = 'markup';
  if (eff > band.max) classification = 'better-than-mid';
  else if (eff >= band.min) classification = 'within-band';

  const hidden = { low: converted * markup.low, high: converted * markup.high };
  const fee = receipt.fee.amount;
  const total = { low: fee + hidden.low, high: fee + hidden.high };
  const sent = receipt.sent.amount;
  return Object.freeze({
    effectiveRate: eff,
    band: { min: band.min, max: band.max },
    markup,
    classification,
    cost: {
      currency: receipt.sent.currency,
      fee,
      feePct: fee / sent,
      hidden,
      total,
      totalPct: { low: total.low / sent, high: total.high / sent },
    },
    shortfall: {
      currency: receipt.received.currency,
      low: converted * band.min - receipt.received.amount,
      high: converted * band.max - receipt.received.amount,
    },
  });
}

/** Share of the total cost that the "fee" line did not show (0..1), using the band midpoint. */
export function hiddenShare(audit) {
  const hiddenMid = (audit.cost.hidden.low + audit.cost.hidden.high) / 2;
  const totalMid = audit.cost.fee + hiddenMid;
  if (totalMid <= 0) return 0;
  return Math.max(0, Math.min(1, hiddenMid / totalMid));
}
