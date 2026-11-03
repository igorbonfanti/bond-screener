/* Parametri fiscali della modalità «Passività indicizzata» (persona fisica residente, regime amministrato).
   Le regole che le fonti non chiariscono sono parametri espliciti, segnati DA VERIFICARE: l'app non sceglie in
   silenzio, li mostra nelle impostazioni e nei risultati. Valori di default prudenziali. */

export const FISCO_DEFAULT = {
  // Titoli di Stato italiani e white list, sovranazionali: cedole, disaggio e plusvalenze al 12,5% (verificato).
  aliquotaTitoliStato: 0.125,

  // Quando si tassa la rivalutazione del capitale dei BTP€i.
  //  'scadenza' = al rimborso (default): così la Nota MEF riportata dall'Agenzia delle Entrate nella Risposta
  //               n. 67/2022 («il prelievo si applica dal momento in cui l'incremento diviene conoscibile», cioè
  //               in prossimità della scadenza). Il testo originale della Nota non è stato trovato: DA VERIFICARE;
  //  'annuale'  = ogni 31/12 il 12,5% sull'aumento della rivalutazione dell'anno (anticipa l'uscita di cassa).
  rivalutazioneBtpEi: 'scadenza',

  // DA VERIFICARE (commercialista / intermediario): base imponibile del provento a scadenza dei BTP€i comprati sul
  // secondario. 'emissione' (default, prudente) = 100 × max(CI,1) − prezzo di emissione della prima tranche
  // (D.Lgs. 239/96, art. 11 c. 2); la minusvalenza che ne nasce non si compensa con i guadagni dell'ETF e qui non
  // si usa. 'acquisto' = imposta solo sulla differenza fra rimborso e prezzo pagato.
  baseImponibileBtpEi: 'emissione',

  // DA VERIFICARE: chi compra un BTP Italia paga nel prezzo la rivalutazione già maturata (prezzo × (CI − 1)) e poi
  // la incassa tutta alla cedola, tassata. 'nessuno' (default, prudente) = nessun credito d'imposta su quella parte;
  // 'credito' = credito come per il rateo cedolare.
  rateoRivalutazioneBtpItalia: 'nessuno',

  // Imposta di bollo sul valore di mercato dei titoli e dell'ETF di liquidità (verificato): 0,2% l'anno.
  bollo: 0.002,

  // ETF di liquidità (XEON): plusvalenza tassata al 26% come reddito di capitale, non compensabile (verificato).
  // Nel modello il 26% si applica al rendimento di ogni periodo (semplificazione: in realtà si paga alla vendita).
  aliquotaEtf: 0.26
};

/** Rendimento netto annuo della liquidità su XEON: (€STR + 0,085% − TER 0,10%) × (1 − 26%) − bollo 0,2%. */
export function xeonNet(estr, f = FISCO_DEFAULT, { spread = 0.00085, ter = 0.001 } = {}) {
  return (estr + spread - ter) * (1 - f.aliquotaEtf) - f.bollo;
}
