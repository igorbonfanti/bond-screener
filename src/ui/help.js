/* Guida: dialogo modale con viste, metodo, tasse, glossario e tasti; si spengono qui le
   scorciatoie da un tasto. Il focus torna al pulsante che l'ha aperta. */
import { h } from './dom.js';
import { openSheet } from './sheet.js';

export const KEYS_PREF = 'bondladder.keys';
export function shortcutsOn() { try { return localStorage.getItem(KEYS_PREF) !== '0'; } catch { return true; } }

const SECTIONS = [
  ['Le viste', [
    ['1 Capitale a scadenza', 'somme disponibili a date precise (università, casa, auto…) oppure la stessa cifra ogni anno o semestre. Parti dagli importi che servono o dal capitale che hai.'],
    ['2 Rendita mensile', 'cedole ogni mese nel modo più regolare possibile; il capitale torna man mano che i titoli scadono.'],
    ['3 Le mie scale', 'le scale salvate, confrontate con i prezzi di oggi: valore, cedole e rimborsi incassati, risultato.']]],
  ['Da dove arrivano i dati',
    'Dal file "Rendimenti e durate calcolati End of Day" di simpletoolsforinvestors.eu: prezzi di chiusura e rendimenti lordi, netti e "super netti" del giorno. Ogni sera un\'automazione lo scarica e lo pubblica qui, e all\'avvio l\'app usa quello; un file caricato a mano resta in uso solo se è più recente. La data EOD in alto dice di quando sono i prezzi e se sono aggiornati; toccandola vedi quale file stai usando e puoi riscaricarlo, caricarne uno tuo, salvarlo o cancellare la copia nel browser. Gli acquisti si intendono con valuta a due giorni lavorativi (T+2).'],
  ['Capitale a scadenza',
    'Per ogni scadenza (un anno, un semestre o una data precisa) l\'app guarda i titoli del paniere che scadono in quella finestra e sceglie la combinazione con il rendimento netto più alto, rispettando la quota massima per emittente (con un algoritmo esatto: non lascia mai scoperta una scadenza che si può coprire). Poi calcola quanto comprare partendo dall\'ultima scadenza: ogni importo è il rimborso del suo titolo più le cedole incassate da tutti i titoli nel suo periodo, cioè il suo anno o semestre o i 12 mesi prima della data (se l\'opzione è attiva), arrotondato al lotto minimo. Le cedole incassate prima della scala, o fra due date lontane, non contano: restano a te. Con «Accantona le cedole di prima» restano invece da parte, senza interessi, e pagano in ordine le prime scadenze. Con le date precise conta il "rendimento effettivo alla data": se il titolo scade prima, i soldi restano fermi fino a quel giorno.'],
  ['Rendita mensile',
    'Un calcolo di programmazione lineare massimizza la cedola netta del mese più povero, cioè la rendita che ricevi ogni mese; a parità sceglie il rendimento complessivo più alto. Rispetta la distribuzione delle scadenze negli anni, la quota per emittente e per titolo, poi toglie le posizioni troppo piccole e arrotonda ai lotti spostando i lotti dove la rendita resta più regolare. Il cursore «Priorità» concede un po\' di regolarità in cambio di rendimento.'],
  ['Tasse (persona fisica, regime amministrato)',
    '12,5% su titoli di Stato e sovranazionali, 26% sugli altri. Le cedole sono tassate alla fonte; sulla prima si paga solo la parte maturata dopo l\'acquisto. La plusvalenza a scadenza (100 − prezzo) è tassata; con «Ho minusvalenze da recuperare» si usa il rendimento super netto di STFI, perché la plusvalenza compensa lo zainetto. Chi compra sopra la pari ha una minusvalenza a scadenza che non si compensa con le cedole: per questo di norma il paniere ammette solo titoli sotto la pari.'],
  ['Cosa non è incluso',
    'Commissioni, imposta di bollo (0,20% annuo sul valore) e differenza fra prezzo di chiusura e prezzo lettera a cui compri davvero. Per i BTP step-up le cedole future sono stimate con la cedola attuale (per prudenza). I BTP Italia e BTP€i sono esclusi di default perché nel file il loro rendimento è "senza indicizzazione".']
];

const GLOSS = [
  ['Rendimento netto', 'rendimento annuo a scadenza dopo le tasse su cedole e plusvalenza, al prezzo del file.'],
  ['Super netto', 'come il netto, ma senza la tassa sulla plusvalenza: vale se hai minusvalenze da compensare.'],
  ['Obiettivo', 'l\'importo che vuoi a ogni scadenza: nei grafici è la linea blu.'],
  ['Sotto la pari', 'prezzo sotto 100: a scadenza incassi più di quanto hai pagato.'],
  ['Duration', 'durata finanziaria media (modificata), in anni: quanto il prezzo reagisce ai tassi.'],
  ['Lotto minimo', 'il taglio minimo acquistabile; i nominali sono multipli del lotto.'],
  ['Liquidità', 'classe di volume STFI da 0 a 4 (media di 20 giorni): quanto il titolo si scambia.'],
  ['Colori', 'ambra per navigare; blu per l\'obiettivo; verde e rosso, con ▲ ▼, solo per variazioni di prezzo o di valore (CVD li passa ad azzurro e rosso).']
];

export function openHelp() {
  const kb = h('input', { type: 'checkbox', checked: shortcutsOn(), on: { change: e => { try { localStorage.setItem(KEYS_PREF, e.target.checked ? '1' : '0'); } catch { /* */ } } } });
  const body = h('div', { class: 'help' },
    SECTIONS.map(([t, txt]) => [h('h3', { text: t }), Array.isArray(txt)
      ? h('ul', null, txt.map(([b, d]) => h('li', null, h('b', { text: b }), `: ${d}`)))
      : h('p', { text: txt })]),
    h('h3', { text: 'Glossario' }),
    h('dl', { class: 'gloss' }, GLOSS.map(([t, d]) => [h('dt', { text: t }), h('dd', { text: d })])),
    h('h3', { text: 'Tasti e comandi' }),
    h('p', null, 'Tasti: ', h('kbd', { text: '1' }), '–', h('kbd', { text: '3' }), ' viste (anche con ← → sulle schede) · ', h('kbd', { text: '/' }), ' comando · ', h('kbd', { text: '?' }), ' guida · ', h('kbd', { text: 'Esc' }), ' chiude.'),
    h('p', null, 'Comandi (poi Invio): ', h('b', { text: 'CAP' }), ', ', h('b', { text: 'REN' }), ', ', h('b', { text: 'SCALE' }), ' per le viste; ', h('b', { text: 'DATI' }), ' per i dati del giorno; ', h('b', { text: 'CVD' }), ' per i colori per daltonici; ', h('b', { text: 'HELP' }), ' per questa guida; un ', h('b', { text: 'ISIN' }), ' per trovare il titolo nella proposta.'),
    h('label', { class: 'kbopt' }, kb, h('span', { text: 'Scorciatoie da un tasto attive' })),
    h('p', { class: 'note', text: 'Strumento di studio: non è consulenza finanziaria né una raccomandazione di investimento. I rendimenti passati non indicano quelli futuri.' }));
  openSheet({ title: 'Guida', sub: 'metodo, tasse, tasti', body });
}
