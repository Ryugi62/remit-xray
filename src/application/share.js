// Share links: the receipt (and nothing else) in the URL, so anyone can re-run the same audit — no server.
// Only sent when the user taps "Share"; the share text says the amounts are in the link.

const KEYS = ['provider', 'sentAmount', 'sentCurrency', 'fee', 'receivedAmount', 'receivedCurrency', 'date'];

function toB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeReceipt(input) {
  return toB64url(new TextEncoder().encode(JSON.stringify(KEYS.map((k) => input[k] ?? ''))));
}

/** @returns the receipt fields, or null if the code is not a well-formed receipt */
export function decodeReceipt(code) {
  try {
    if (!/^[A-Za-z0-9_-]{8,600}$/.test(code)) return null;
    const arr = JSON.parse(new TextDecoder().decode(fromB64url(code)));
    if (!Array.isArray(arr) || arr.length !== KEYS.length) return null;
    const r = Object.fromEntries(KEYS.map((k, i) => [k, arr[i]]));
    const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    if (typeof r.provider !== 'string' || r.provider.length > 60) return null;
    r.provider = r.provider.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ''); // no bidi tricks in a name shown as a heading
    if (!num(r.sentAmount) || !num(r.fee) || !num(r.receivedAmount)) return null;
    if (!/^[A-Z]{3}$/.test(r.sentCurrency) || !/^[A-Z]{3}$/.test(r.receivedCurrency)) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
    return r;
  } catch {
    return null;
  }
}
