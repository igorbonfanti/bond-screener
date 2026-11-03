/* BTP Italia (indice FOI senza tabacchi, ISTAT): flussi netti per 100 nominale in uno scenario d'inflazione.
   Regole dagli Information Memorandum MEF (ricerca/ladder-indicizzata/regole/regole-titoli.md, §2):

   BTP Italia «classici» (2027, 2028 mar e nov, 2030, 2032): a ogni cedola semestrale t
     CI_t = NI(t) / base_t;  cedola = tasso/2 × max(CI_t, 1);  rivalutazione = 100 × max(CI_t − 1, 0), pagata subito;
     base_{t+1} = max(base_t, NI(t)) (regola del massimo: la deflazione non si addebita e non si recupera);
     rimborso 100. NI(d) = FOI(m−3) + (d−1)/gg × [FOI(m−2) − FOI(m−3)], come l'IR dei BTP€i.
     Si parte dalla base del semestre in corso (dato MEF, base 2025=100): è già il massimo storico.
   BTP Italia Sì (IT0005713547): capitale mai rivalutato;
     cedola = tasso/2 + 100 × max(0, NI(t)/NI(t−1) − 1), con NI(t−1) l'indice alla cedola precedente (senza massimo).
   Premi fedeltà: solo a chi ha comprato all'emissione con l'ISIN speciale. Sul secondario non spettano: esclusi.
   Fisco: 12,5% su cedole e rivalutazioni quando vengono pagate (certo). Il resto è nei parametri DA VERIFICARE di
   fisco-parametri.js. */
import { couponDates, accrued } from './bond.js';

/** Dal JSON dei dati d'inflazione: le funzioni per i BTP Italia, o null se mancano le basi. */
export function btpItaliaFlowsFor(j) {
  const any = Object.values((j && j.titoli) || {}).some(t => t.tipo === 'BTPITALIA' && Number.isFinite(t.irBase));
  return any ? { flows: btpItaliaFlows, cost: btpItaliaCost } : null;
}

const isSi = info => info && info.sottotipo === 'BTP_ITALIA_SI';

/** Costo vero per 100 nominale e CI di regolamento (senza floor, come sul secondario). */
export function btpItaliaCost(b, settle, ci, f, info) {
  const t = f.aliquotaTitoliStato;
  const acc = accrued(b, settle);
  if (isSi(info)) {
    // prezzo e rateo fisso sul nominale; rateo della componente inflazione (con floor a 0) dalla cedola precedente
    const accInfl = 100 * Math.max(0, ci(settle) - 1) * fraction(b, settle);
    return { ciSettle: 1, cost: b.price + acc + accInfl - (acc + accInfl) * t };
  }
  const c = ci(settle);
  // controvalore = prezzo reale × CI + rateo rivalutato; il rateo cedolare dà il credito d'imposta (lo paga il venditore)
  let cost = (b.price + acc) * c - acc * c * t;
  // DA VERIFICARE: anche la parte di rivalutazione già maturata nel prezzo (prezzo × (CI − 1)) dà un credito?
  if (f.rateoRivalutazioneBtpItalia === 'credito') cost -= b.price * Math.max(0, c - 1) * t;
  return { ciSettle: c, cost };
}

/** Frazione del semestre in corso già maturata al regolamento (per il rateo della componente inflazione). */
function fraction(b, settle) {
  const next = couponDates(b, settle, settle + 400)[0];
  if (next == null) return 0;
  const prev = couponDates(b, settle - 400, settle).pop() ?? next - 182;
  return Math.max(0, Math.min(1, (settle - prev) / Math.max(1, next - prev)));
}

/** Flussi netti per 100 nominale. ci(d) = NI(d) / info.irBase nello scenario. */
export function btpItaliaFlows(b, settle, ci, ciSettle, f, info) {
  const t = f.aliquotaTitoliStato, out = [];
  const NI = d => ci(d) * info.irBase;
  let base = info.irBase;
  for (const c of couponDates(b, settle, b.maturity)) {
    const ni = NI(c);
    if (isSi(info)) {
      const g = b.coupon / b.freq + 100 * Math.max(0, ni / base - 1);
      out.push({ day: c, kind: 'coupon', net: g * (1 - t) });
      base = ni;                                            // nessuna regola del massimo
    } else {
      const k = ni / base;
      out.push({ day: c, kind: 'coupon', net: b.coupon / b.freq * Math.max(k, 1) * (1 - t) });
      const riv = 100 * Math.max(k - 1, 0);
      if (riv > 0) out.push({ day: c, kind: 'rivalutazione', net: riv * (1 - t) });
      base = Math.max(base, ni);
    }
  }
  // a scadenza 100; plusvalenza sul prezzo reale (redditi diversi al 26% sul 48,08% = 12,5%); minusvalenza non usata
  out.push({ day: b.maturity, kind: 'redemption', net: 100 - Math.max(0, 100 - b.price) * t });
  return out;
}
