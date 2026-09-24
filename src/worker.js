/* Web Worker: tiene i dati del giorno e calcola le proposte senza bloccare l'interfaccia. */
import { loadText } from './data/stfi.js';
import { enrich } from './core/basket.js';
import { compute } from './engine.js';

let ds = null;

self.onmessage = (e) => {
  const { type, id } = e.data;
  try {
    if (type === 'load') {
      ds = enrich(loadText(e.data.text));
      self.postMessage({ type: 'loaded', id });
    } else if (type === 'compute') {
      if (!ds) throw new Error('Dati non caricati.');
      self.postMessage({ type: 'result', id, result: compute(ds, e.data.settings) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) });
  }
};
