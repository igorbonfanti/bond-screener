# Bond Ladder — v3.6.0

App web per costruire una **scala di titoli di Stato** (bond ladder) con i dati giornalieri di
[simpletoolsforinvestors.eu](https://www.simpletoolsforinvestors.eu/documentivari.php) e la fiscalità
italiana già calcolata. Riprogettata da zero rispetto alla v2 attorno a un'unica domanda:
**che cosa deve fare la scala?**

- **Capitale a scadenza** — avere somme disponibili a date precise (università, casa, auto…) oppure la
  stessa cifra ogni anno o semestre. Si può partire dagli importi che servono o dal capitale che si ha.
- **Rendita mensile** — incassare cedole ogni mese nel modo più regolare possibile; il capitale torna man
  mano che i titoli scadono. Si può partire dal capitale o dalla rendita desiderata (€/mese).
- **Portafoglio** — i titoli che hai già (export della banca, per esempio Fineco in Excel, testo incollato o
  inserimento a mano). Le due viste costruiscono la scala **attorno** a questi titoli, senza venderli: si compra
  solo la differenza.

## Come si usa
1. **Scheda**: `1 Capitale a scadenza`, `2 Rendita mensile`, `3 Portafoglio` (i titoli che hai già) oppure
   `4 Le mie scale` (le scale salvate).
2. **Importi e scadenze**: anni della scala (o date precise con la flessibilità ammessa, "fino a N mesi prima").
   Con le scadenze annuali puoi dire **entro quale mese** ti servono i soldi (rette, affitti, tasse): ogni anno il
   titolo scade nei 12 mesi prima della fine di quel mese e contano le cedole di quei 12 mesi.
3. **Titoli ammessi**: aree (area euro, sovranazionali, altri Stati in euro), rating minimo, emittenti uno per uno,
   solo sotto la pari, liquidità minima, quota massima per emittente.

La proposta si aggiorna mentre modifichi i parametri. Per ogni scadenza puoi **cambiare titolo** (elenco delle
alternative o tocco sulla mappa dei rendimenti). **Confronta le alternative** ricalcola la proposta cambiando una
impostazione alla volta (quota per emittente, eccedenze, cedole di prima, mese delle scadenze…) e la applica con un
clic. Il pannello **Movimenti di cassa** mostra i soldi che arrivano prima che servano: entrate, prelievi, saldo e
attesa. La proposta si salva, si stampa, si esporta in CSV e si condivide.

Dalla tastiera: `1`–`4` cambiano scheda (anche ← → sulle schede), `/` porta alla barra comandi, `?` apre la guida.
Nella barra comandi: `CAP`, `REN`, `PTF`, `SCALE` per le viste, `DATI` per i dati del giorno, `CVD` per i colori per
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
- **Flussi e tasse** (D.Lgs. 239/1996): calendario cedole dai mesi di stacco del file, rateo ACT/ACT, valuta T+2
  sul calendario TARGET (T+1 dall'11/10/2027),
  ritenuta 12,5% (Stati e sovranazionali) o 26%. All'acquisto il credito d'imposta sul rateo e sul disaggio di
  emissione già maturato riduce il costo; a scadenza si paga l'imposta su tutto il disaggio e sulla plusvalenza
  rispetto al prezzo teorico (emissione + disaggio maturato; azzerata con l'opzione "zainetto", che usa il rendimento
  *super netto* di STFI). Il disaggio maturato si ricava dal super netto di STFI (il file non ha la data di
  emissione). BTP Valore, Più e Futura comprati sul mercato: cedole dal calendario degli scalini (`retail-btp.js`).
  I rendimenti ricalcolati coincidono con quelli di STFI entro 0,01 punti per oltre il 99% dei titoli di Stato e
  sovranazionali (test sui dati reali).
- **Capitale a scadenza**: *cash-flow matching* all'indietro (dall'ultima scadenza alla prima: rimborso + cedole
  del periodo). Il periodo di una scadenza è il suo anno o semestre (con le date precise, i 12 mesi prima della
  data): le cedole incassate prima della scala, o fra due date lontane, non contano per gli importi — resterebbero
  ferme per anni e in una scala che parte tardi toglierebbero il primo titolo — e sono indicate a parte come
  entrata in più. Con l'opzione **"Accantona le cedole di prima"** restano invece da parte (senza interessi) e
  pagano in ordine le prime scadenze, con l'avanzo che passa alla successiva (punto fisso: la cassa dipende dai
  titoli e i titoli dalla cassa). La scelta parte da quella **esatta** per rendimento: flusso a costo minimo con
  importi uguali, branch & bound altrimenti; prima si coprono tutte le scadenze coperte possibili, poi si massimizza il
  rendimento netto nel rispetto della quota per emittente (con le date precise conta il rendimento effettivo alla
  data). Poi la scelta si migliora **per costo**: il rendimento a scadenza presume le cedole reinvestite allo stesso
  tasso, mentre nella scala quelle che arrivano dove i soldi non servono restano in cassa allo 0%, e i lotti
  arrotondano. Discesa per coordinate (un titolo alla volta fra i migliori 6-16 candidati della scadenza; nelle scale
  fino a 8 scadenze anche a coppie e con ripartenze), valutata prima sul costo senza lotti (limite inferiore) e poi a
  lotti interi; si tiene un cambio solo se tutta la scala costa meno con ogni scadenza coperta come prima. I lotti
  interi si fissano per eccesso, poi si tolgono quelli di troppo e si scambiano lotti fra scadenze (la cassa porta le
  eccedenze a quelle dopo, le cedole di un titolo pagano quelle prima). Nessun limite di tempo: stessa proposta su ogni
  dispositivo. Sui dati del 30/09/2026, 24 scale senza portafoglio: capitale −2,2% in mediana (da −0,2% a −5,1%), mai
  di più, stesse somme garantite; buona parte del risparmio è denaro che prima tornava come eccedenza alle scadenze.
  Partendo dal capitale, la somma per scadenza è la più alta che i titoli scelti **garantiscono a ogni scadenza** con i
  lotti interi (bisezione), poi la scelta si migliora per costo e la somma sale.
  Il **rendimento alle scadenze** va dal capitale di oggi alle somme alle date che servono, più i soldi che tornano
  liberi (la cassa ferma rende zero): a parità di somme ordina le proposte come il costo, ed è quello del confronto.
- **Rendita mensile**: programmazione lineare (javascript-lp-solver) che massimizza la cedola netta del mese più
  povero e poi il rendimento; scadenze distribuite negli anni, quote per emittente e per titolo, pulizia delle
  posizioni piccole senza mai scoprire un mese, arrotondamento ai lotti con scambi locali. Ogni soluzione del
  risolutore si verifica sui vincoli (se non li rispetta non si usa); i BTP a cedola crescente contano nell'anno tipo
  con la cedola più bassa dell'orizzonte; la rendita si mostra anche anno per anno, fino all'ultima scadenza.
- Esclusi dai calcoli: commissioni, imposta di bollo, spread denaro-lettera. BTP Italia/BTP€i esclusi di default
  (rendimento "senza indicizzazione"); step-up fuori tabella stimati con la cedola attuale (e scelti con il rendimento
  di quei flussi, per coerenza).

## Il portafoglio che hai già
- **Caricamento** (vista `3 Portafoglio`): export della banca in Excel (`.xls` binario, `.xlsx`, Excel XML), CSV o
  tabella HTML salvata come `.xls`, testo incollato da Excel o dalla pagina della banca, oppure ISIN e nominale a
  mano. Le intestazioni si riconoscono da sole (ISIN, quantità o nominale, prezzo medio di carico, prezzo, valore),
  anche se non sono alla prima riga; quantità in pezzi convertite in nominale; righe di totale, azioni, fondi e
  titoli non in euro saltati con il motivo. I file Excel si leggono con SheetJS Community Edition 0.20.3
  (`vendor/xlsx.mjs`, Apache 2.0, caricato solo quando serve); CSV e testo li legge l'app, con la codifica giusta.
- **Privacy**: il portafoglio resta **solo in questo browser** (`localStorage`). Non va nel cloud, né nelle scale
  salvate (che contengono solo i titoli da comprare) né nei link condivisi.
- **Tasse dei titoli posseduti**: cedole future tassate per intero; plusvalenza sul prezzo di **carico**, non su quello
  di oggi; scarto di emissione sempre tassato a scadenza (il credito per la parte maturata prima dell'acquisto è
  arrivato allora). Senza data d'acquisto è il minimo esatto: chi ha comprato dopo l'emissione un titolo emesso sotto
  la pari può pagare un po' di più.
- **BTP per i risparmiatori** (`src/data/retail-btp.js`): Valore, Più, Italia, Italia Sì e Futura con calendario delle
  cedole crescenti e premio fedeltà (fonti: Dipartimento del Tesoro). Ogni emissione ha due ISIN: quello di mercato
  (nei dati STFI) e quello «con premio», del collocamento, che STFI non ha; il premio vale solo con il secondo.
  Stime prudenti: inflazione futura zero, premio legato al PIL al minimo garantito.
- **Capitale a scadenza attorno al portafoglio**: i flussi netti dei titoli posseduti sono fissi (niente vendite); per
  ogni scadenza si compra solo il fabbisogno residuo, che è anche il peso nella scelta dei titoli. Le eccedenze di una
  scadenza e i rimborsi che arrivano fuori dai periodi vanno in **cassa** (senza interessi) e pagano le scadenze dopo;
  l'app misura la **cassa ferma** (euro × anni) e calcola anche la scelta opposta (eccedenze restituite, scadenze
  scoperte coperte con acquisti di oggi). Il confronto è un **investimento**: senza la cassa si spende ΔC in più oggi e
  tornano ΔR più avanti; l'app ne dà il rendimento (TIR) e lo confronta con la mediana dei rendimenti netti dei titoli
  del paniere che scadono entro 6 mesi dalla data media dei soldi che tornano (soglia ±0,25 punti). Gli «interessi
  persi» sulla cassa ferma, da soli, ingannano: senza cassa servono più acquisti oggi, che rendono anch'essi.
  Partendo dal capitale, la somma per scadenza si trova per
  **bisezione** (il costo non è più proporzionale all'importo). Il limite per emittente vale sul **portafoglio
  complessivo**. La preferenza per i propri titoli è un piccolo vantaggio di rendimento nella scelta (0,10 punti con
  «Equilibrato»; «I miei titoli» li preferisce sempre, anche fuori dai filtri del paniere), che nella scelta per costo
  diventa uno sconto equivalente (0,10% del costo per anno di durata). Il branch & bound usa un
  limite superiore dinamico (il miglior candidato che ci sta ancora): stesso ottimo, molti meno nodi.
- **Rendita mensile attorno al portafoglio**: le cedole nette dei titoli posseduti sono una base fissa di ogni mese
  nel modello lineare (il mese più povero è base + nuovo); quote per emittente e per titolo e distribuzione delle
  scadenze contano anche i posseduti; i titoli che scadono prima dell'orizzonte non entrano nell'anno tipo. Con la
  rendita desiderata il capitale si trova per bisezione sul modello lineare, correggendo la perdita dovuta a lotti e
  pulizia delle posizioni piccole.
- Senza portafoglio i motori sono quelli di sempre, con le correzioni della v3.6 (scelta per costo nel capitale,
  verifica delle soluzioni del programma lineare nella rendita): i test confrontano ogni proposta con i vincoli
  (scadenze coperte, capitale, quote, identità dei flussi) su configurazioni casuali con i dati reali.

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
src/main.js            avvio, dati, calcolo nel Web Worker (con guardiano), schede e barra comandi, dialoghi
src/engine.js          impostazioni → proposta (usato dal worker)
src/portfolio.js       portafoglio posseduto: salvataggio nel browser, flussi netti e tasse dei titoli
src/data/              lettura del CSV STFI, sorgenti dati, lettura degli export della banca, BTP retail
src/core/              date, flussi e tasse, paniere, selezione (flusso/B&B), capitale, rendita, LP
src/ui/                pannello, risultati, grafici SVG, dialoghi, le mie scale, guida
vendor/lp-solver.mjs   javascript-lp-solver 1.0.3 (Unlicense)
vendor/xlsx.mjs        SheetJS Community Edition 0.20.3 (Apache 2.0), solo per leggere gli Excel
scripts/fetch_stfi.py  download giornaliero dei dati
tests/                 test del motore (node --test) con un file STFI sintetico e portafogli inventati
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
