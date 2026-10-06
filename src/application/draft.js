// Draft receipt: every field remembers where it came from and whether a human confirmed it.
// Values read by a machine (paste parser, OCR) are never audited until confirmed (AC-6).

export const FIELDS = ['sentAmount', 'sentCurrency', 'fee', 'receivedAmount', 'receivedCurrency', 'date', 'provider'];
const REQUIRED = ['sentAmount', 'sentCurrency', 'receivedAmount', 'receivedCurrency', 'date'];
const MACHINE = new Set(['pasted', 'photo']);

/**
 * @param {Object<string, any|{value:any}>} values
 * @param {'typed'|'sample'|'pasted'|'photo'} origin
 */
export function createDraft(values = {}, origin = 'typed') {
  const fields = {};
  for (const name of FIELDS) {
    if (!(name in values)) continue;
    const raw = values[name];
    const value = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    if (value === undefined || value === null || value === '') continue;
    fields[name] = Object.freeze({ value, origin, confirmed: !MACHINE.has(origin) });
  }
  return Object.freeze({ fields: Object.freeze(fields) });
}

/** The user typed or accepted a value: it becomes confirmed. */
export function confirmField(draft, name, value) {
  if (!FIELDS.includes(name)) throw new Error(`unknown field ${name}`);
  const prev = draft.fields[name];
  const v = value === undefined ? prev && prev.value : value;
  const fields = { ...draft.fields };
  if (v === undefined || v === null || v === '') delete fields[name];
  else fields[name] = Object.freeze({ value: v, origin: prev ? prev.origin : 'typed', confirmed: true });
  return Object.freeze({ fields: Object.freeze(fields) });
}

export function confirmAll(draft) {
  return Object.keys(draft.fields).reduce((d, name) => confirmField(d, name), draft);
}

export function readiness(draft) {
  const missing = REQUIRED.filter((n) => !draft.fields[n]);
  const unconfirmed = Object.keys(draft.fields).filter((n) => !draft.fields[n].confirmed);
  return { ok: missing.length === 0 && unconfirmed.length === 0, missing, unconfirmed };
}

/** Plain values for createTransferReceipt — refuses unconfirmed drafts. */
export function toReceiptInput(draft) {
  const r = readiness(draft);
  if (!r.ok) {
    const err = new Error('DRAFT_NOT_READY');
    err.readiness = r;
    throw err;
  }
  const out = {};
  for (const [k, f] of Object.entries(draft.fields)) out[k] = f.value;
  return out;
}
