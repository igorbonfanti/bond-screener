/* "Come funziona": metodo, fiscalità e limiti, in breve. */
import { h } from './dom.js';
import { openSheet } from './sheet.js';

const SECTIONS = [
  ['Da dove arrivano i dati',
    'Dal file "Rendimenti e durate calcolati End of Day" di simpletoolsforinvestors.eu: prezzi di chiusura del giorno e rendimenti lordi, netti e "super netti" calcolati da STFI. Ogni sera un\'automazione lo scarica e lo pubblica qui, e all\'avvio l\'app usa quello; un file caricato a mano resta in uso solo se è più recente. Toccando l\'indicatore dei dati in alto vedi quale file stai usando e puoi riscaricare il file automatico, caricarne uno tuo, salvare il CSV o cancellare la copia nel browser. Gli acquisti si intendono con valuta a due giorni lavorativi (T+2).'],
  ['Capitale a scadenza',
    'Per ogni scadenza (un anno, un semestre o una data precisa) l\'app guarda i titoli del paniere che scadono in quella finestra e sceglie la combinazione con il rendimento netto più alto, rispettando la quota massima per emittente (con un algoritmo esatto: non lascia mai scoperta una scadenza che si può coprire). Poi calcola quanto comprare partendo dall\'ultima scadenza: ogni importo è il rimborso del suo titolo più le cedole incassate nel periodo da tutti i titoli (se l\'opzione è attiva), arrotondato al lotto minimo. Con le date precise conta il "rendimento effettivo alla data": se il titolo scade prima, i soldi restano fermi fino a quel giorno.'],
  ['Rendita mensile',
    'Un calcolo di programmazione lineare massimizza la cedola netta del mese più povero, cioè la rendita che ricevi ogni mese; a parità sceglie il rendimento complessivo più alto. Rispetta la distribuzione delle scadenze negli anni, la quota per emittente e per titolo, poi toglie le posizioni troppo piccole e arrotonda ai lotti spostando i lotti dove la rendita resta più regolare. Il cursore "Priorità" permette di rinunciare a un po\' di regolarità in cambio di più rendimento.'],
  ['Tasse (persona fisica, regime amministrato)',
    '12,5% su titoli di Stato e sovranazionali, 26% sugli altri. Le cedole sono tassate alla fonte; sulla prima si paga solo la parte maturata dopo l\'acquisto. La plusvalenza a scadenza (100 − prezzo) è tassata; con "Ho minusvalenze da recuperare" si usa il rendimento super netto di STFI, perché la plusvalenza compensa lo zainetto. Chi compra sopra la pari ha una minusvalenza a scadenza che non si compensa con le cedole: per questo di norma il paniere ammette solo titoli sotto la pari.'],
  ['Cosa non è incluso',
    'Commissioni, imposta di bollo (0,20% annuo sul valore) e differenza fra prezzo di chiusura e prezzo lettera a cui compri davvero. Per i BTP step-up le cedole future sono stimate con la cedola attuale (per prudenza). I BTP Italia e BTP€i sono esclusi di default perché nel file il loro rendimento è "senza indicizzazione". Tutti i calcoli sono indicativi e non sono consulenza finanziaria.']
];

export function openHelp() {
  openSheet({
    title: 'Come sceglie i titoli',
    sub: 'Metodo, tasse e limiti in breve',
    body: h('div', { class: 'stack' }, SECTIONS.map(([t, txt]) => h('div', null,
      h('h4', { style: { fontSize: '14px', marginBottom: '4px' }, text: t }), h('p', { class: 'muted', style: { fontSize: '13px' }, text: txt }))))
  });
}
