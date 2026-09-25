# Bond Ladder — v3.4.0

App web per costruire una **scala di titoli di Stato** (bond ladder) con i dati giornalieri di
[simpletoolsforinvestors.eu](https://www.simpletoolsforinvestors.eu/documentivari.php) e la fiscalità
italiana già calcolata. Riprogettata da zero rispetto alla v2 attorno a un'unica domanda:
**che cosa deve fare la scala?**

- **Capitale a scadenza** — avere somme disponibili a date precise (università, casa, auto…) oppure la
  stessa cifra ogni anno o semestre. Si può partire dagli importi che servono o dal capitale che si ha.
- **Rendita mensile** — incassare cedole ogni mese nel modo più regolare possibile; il capitale torna man
  mano che i titoli scadono. Si può partire dal capitale o dalla rendita desiderata (€/mese).

## Come si usa
1. **Scheda**: `1 Capitale a scadenza`, `2 Rendita mensile` oppure `3 Le mie scale` (le scale salvate).
2. **Importi e scadenze**: anni della scala (o date precise con la flessibilità ammessa, "fino a N mesi prima").
3. **Titoli ammessi**: aree (area euro, sovranazionali, altri Stati in euro), rating minimo, emittenti uno per uno,
   solo sotto la pari, liquidità minima, quota massima per emittente.

La proposta si aggiorna mentre modifichi i parametri. Per ogni scadenza puoi **cambiare titolo** (elenco delle
alternative o tocco sulla mappa dei rendimenti). La proposta si salva, si stampa, si esporta in CSV e si condivide.

Dalla tastiera: `1`–`3` cambiano scheda (anche ← → sulle schede), `/` porta alla barra comandi, `?` apre la guida.
Nella barra comandi: `CAP`, `REN`, `SCALE` per le viste, `DATI` per i dati del giorno, `CVD` per i colori per
daltonici, `CHIARO` / `SCURO` per il tema, `HELP` per la guida, oppure un **ISIN** per trovare il titolo nella
proposta. Le scorciatoie da un tasto si spengono dalla guida.

## Aspetto: design system «Terminale ambra»
L'interfaccia segue il design system «Terminale ambra»: `css/terminale.css` (il kit, da non modificare) più gli
stili propri dell'app in `styles/app.css`; font IBM Plex Sans Condensed e IBM Plex Mono in `fonts/` (SIL OFL,
licenza in `fonts/LICENSE-IBM-Plex.txt`), senza richieste a servizi esterni. Cornice `.term` con barra comandi,
schede numerate, pannelli e riga di stato con fonte, data dei dati e avvertenza. Regole di colore: **ambra** solo
per navigare (marchio, schede, titoli, codici, focus, selezione), **blu** per il segnale del progetto (l'obiettivo
di ogni scadenza), **verde/rosso** con ▲ ▼ solo per le variazioni di prezzo o di valore (il pulsante CVD li passa ad
azzurro e rosso), testo nero sui riempimenti colorati, numeri all'italiana con il segno meno tipografico (−).

**Tema chiaro**: l'interruttore `CHIARO` nella barra comandi (o i comandi `CHIARO` / `SCURO`) passa al fondo bianco
con le stesse regole. Il sistema nasce scuro, quindi il tema chiaro è ricavato qui (`styles/app.css`): ambra più scura
per testi e linee (almeno 4,5:1 sul bianco), riempimenti in ambra viva con testo nero, verde e rosso più scuri come
testo. La scelta è salvata nel browser con la chiave `antigravity-theme`, condivisa con le altre app del sito.

## Metodo in breve
- **Flussi e tasse**: calendario cedole dai mesi di stacco del file, rateo ACT/ACT, valuta T+2, ritenuta 12,5%
  (Stati e sovranazionali) o 26%, credito d'imposta sul rateo pagato, tassa sulla plusvalenza a scadenza
  (azzerata con l'opzione "zainetto", che usa il rendimento *super netto* di STFI). I rendimenti ricalcolati
  coincidono con quelli di STFI per oltre il 97% dei titoli entro 0,05 punti (test sui dati reali).
- **Capitale a scadenza**: *cash-flow matching* all'indietro (dall'ultima scadenza alla prima: rimborso + cedole
  del periodo). Il periodo di una scadenza è il suo anno o semestre (con le date precise, i 12 mesi prima della
  data): le cedole incassate prima della scala, o fra due date lontane, non contano per gli importi — resterebbero
  ferme per anni e in una scala che parte tardi toglierebbero il primo titolo — e sono indicate a parte come
  entrata in più. Con l'opzione **"Accantona le cedole di prima"** restano invece da parte (senza interessi) e
  pagano in ordine le prime scadenze, con l'avanzo che passa alla successiva (punto fisso: la cassa dipende dai
  titoli e i titoli dalla cassa). La scelta dei titoli è **esatta**: flusso a costo minimo con importi uguali, branch & bound
  altrimenti; prima si coprono tutte le scadenze coperte possibili, poi si massimizza il rendimento netto nel
  rispetto della quota per emittente. Con le date precise conta il rendimento effettivo alla data.
- **Rendita mensile**: programmazione lineare (javascript-lp-solver) che massimizza la cedola netta del mese più
  povero e poi il rendimento; scadenze distribuite negli anni, quote per emittente e per titolo, pulizia delle
  posizioni piccole senza mai scoprire un mese, arrotondamento ai lotti con scambi locali.
- Esclusi dai calcoli: commissioni, imposta di bollo, spread denaro-lettera. BTP Italia/BTP€i esclusi di default
  (rendimento "senza indicizzazione"); step-up stimati con la cedola attuale.

## Dati: aggiornamento automatico
Il workflow `.github/workflows/stfi-data.yml` gira ogni sera nei giorni lavorativi. Legge `documentivari.php`,
trova il pulsante **"Dati End of Day"** (il link `…/data/export/<codice>.csv` cambia nel tempo), scarica il file,
lo valida e lo salva in `data/stfi-latest.csv` + `data/stfi-latest.json`. Sui branch di lavoro fa solo una prova
a vuoto. Si può lanciare a mano da *Actions → Dati STFI giornalieri → Run workflow*.

All'avvio l'app scarica il file automatico (dal sito o, se più aggiornato, dal repository) e ne tiene una copia nel
browser per l'uso offline. Un file **caricato a mano** resta in uso solo finché è più recente del file automatico;
a parità di data vince il file automatico.

Nella barra comandi la **data EOD** dice di quando sono i prezzi e se sono aggiornati (*Aggiornato*, *1 seduta
indietro*, *N sedute indietro*, contando i giorni di borsa). Toccandola (o con il comando `DATI`) si apre il dialogo
che dice sempre quale file è in uso — *file automatico* (scaricato adesso), *copia salvata nel browser* (quando il
sito non risponde) o *file caricato da te* — e lo confronta con il file automatico pubblicato. Da lì si può
**riscaricare e usare il file automatico**, **caricare un CSV**, **scaricare il CSV in uso** e **cancellare la copia
nel browser**. Accanto alla data compare l'etichetta *manuale* o *copia locale* quando i dati non sono il file
automatico appena scaricato. Il service worker non mette mai in cache i file di `data/`: "scaricato adesso" vuol
dire davvero dalla rete.

> I dati sono di simpletoolsforinvestors.eu: il repository è pubblico, quindi il file scaricato è consultabile da
> chiunque. Se preferisci non ripubblicarlo, disattiva il workflow e carica il file a mano, oppure chiedi il
> consenso all'autore del sito.

## Salvataggio, condivisione, monitoraggio
- **Salva**: su Firebase (progetto `igorbonfanti-screener`, collezione `bond_ladders`), con titoli, nominali e
  prezzi del giorno. Lettura libera, scrittura solo dopo l'accesso (`auth-opzionale.js`, regole in
  `firestore.rules`).
- **Le mie scale**: ogni scala salvata è confrontata con i prezzi di oggi — valore attuale, cedole e rimborsi
  già incassati, plus/minus, rendimento annualizzato dall'acquisto — e si può ricostruire con i dati del giorno.
  Anche le scale salvate con la v2 sono leggibili.
- **Condividi**: link con la configurazione (chi lo apre vede la stessa scala con i dati del giorno); ogni scala
  salvata ha anche il suo link.

## Struttura
```
index.html, sw.js, manifest.json, assets/   interfaccia (moduli ES, nessuna build)
css/terminale.css, fonts/   design system «Terminale ambra» e font IBM Plex (SIL OFL)
styles/app.css         stili propri dell'app sopra il design system
src/main.js            avvio, dati, calcolo nel Web Worker, schede e barra comandi, dialoghi
src/engine.js          impostazioni → proposta (usato dal worker)
src/data/              lettura del CSV STFI, sorgenti dati
src/core/              date, flussi e tasse, paniere, selezione (flusso/B&B), capitale, rendita, LP
src/ui/                pannello, risultati, grafici SVG, dialoghi, le mie scale, guida
vendor/lp-solver.mjs   javascript-lp-solver 1.0.3 (Unlicense)
scripts/fetch_stfi.py  download giornaliero dei dati
tests/                 test del motore (node --test) con un file STFI sintetico
v2/, v1/               versioni precedenti, congelate
```

## Sviluppo
```
python3 -m http.server 8000        # poi http://localhost:8000
npm test                           # test del motore (fuso Europe/Rome)
STFI_CSV=/percorso/file.csv npm test   # in più: confronto con un file STFI reale
node tests/fixtures/make-synthetic.mjs # rigenera il file di prova (titoli inventati)
```
Per provare in locale con i dati veri basta mettere il file scaricato in `data/stfi-latest.csv`
(oppure caricarlo dalla data EOD nella barra comandi dell'app).

## Versioni precedenti
- [`/v2/`](./v2/) — screener + ladder greedy/ottimizzato (v2.2.1), congelata.
- [`/v1/`](./v1/) — prima versione (v1.0.0), congelata.
