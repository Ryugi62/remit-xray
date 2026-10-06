// Browser-only adapters: on-device storage and on-device OCR.

/** LedgerStore on localStorage; never throws (private mode, blocked storage → empty ledger). */
export function localLedgerStore(key = 'remit-xray.ledger.v1', storage = globalThis.localStorage) {
  return {
    load() {
      try { return JSON.parse(storage.getItem(key) || '[]'); } catch { return []; }
    },
    save(entries) {
      try { storage.setItem(key, JSON.stringify(entries)); } catch { /* storage unavailable */ }
    },
  };
}

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.Tesseract) return resolve(globalThis.Tesseract);
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(globalThis.Tesseract);
    s.onerror = () => reject(new Error('OCR_LOAD_FAILED'));
    document.head.appendChild(s);
  });
}

/**
 * Reads text from an image entirely in the browser (tesseract.js, loaded only on demand).
 * The image never leaves the device; only the OCR engine and language data are downloaded.
 */
export async function recognizeImage(file, { langs = 'eng', onProgress } = {}) {
  const Tesseract = await loadScript(TESSERACT);
  const { data } = await Tesseract.recognize(file, langs, {
    logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
  });
  return data.text;
}
