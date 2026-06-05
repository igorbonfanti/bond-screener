# Bond Screener — Antigravity · v2.2.0

App web per analizzare obbligazioni governative/sovranazionali e costruire **bond ladder**,
evoluzione del notebook Colab "bond screener".

> La versione **v1.0.0** congelata resta disponibile nella sottocartella [`/v1/`](./v1/) (e nel tag git `v1.0.0`).

## Novità v2.2.0
- **Tema chiaro/scuro**: interruttore (☀/☾) nell'header, scelta salvata nel browser.
  I grafici seguono il tema (colori letti dalle variabili CSS). Default: scuro.

## Novità v2.1.0
- **Analizza un ladder esistente**: incolli i bond che già possiedi (`ISIN` o `ISIN;nominale€`),
  vengono agganciati ai dati del giorno e analizzati ai valori attuali — yield/duration **ponderati
  per valore di mercato**, cedola netta in €, valore di mercato totale, scadenze, flussi mensili,
  esposizioni per emittente/paese. Gli ISIN non presenti nei dati vengono segnalati.

## Novità v2.0.0
- **Obiettivo selezionabile** nel ladder: *Massimizza Yield totale* oppure *Massimizza Cedole nette*
  (ottimizzazione lessicografica: a parità di cedola netta sceglie lo yield più alto).
- **Vincolo di duration media di portafoglio** (≤ X anni) nell'ottimizzatore (branch & bound).
- **Cedola netta** calcolata per bond: 12,5% per titoli di Stato/sovranazionali whitelist, 26% altrimenti;
  report con lordo · imposta · netto in € e rendita mensile.
- **Esposizione in %** per emittente/paese (con l'equipeso, max bond/emittente = cap di esposizione).
- Sempre **equipesato** per gradino (distribuzione del rischio robusta).

## Cosa fa
1. **Dati & Filtri** — carichi il file bond aggiornato (CSV `;` o Excel), l'app pulisce i dati
   (virgola→punto, date `gg/mm/aaaa`, rating S&P→score) e li filtra con un pannello visuale
   (emittente, valuta, paese, duration, prezzo, scadenza, yield, cedola, volume, rating, ricerca).
2. **Bond Ladder** — generi il ladder con 3 metodi:
   - **Greedy** (come il notebook: miglior yield per step entro la tolleranza)
   - **Ottimizzato** (branch & bound: massimizza il rendimento totale rispettando i vincoli)
   - **Manuale** (scegli bond per bond dai menu a tendina)
   Con metriche (yield/duration/cedola medi), avvisi di diversificazione e grafici
   (scadenze, flussi cedolari, esposizione per paese/emittente).
3. **Storico** — ogni caricamento è salvabile come **snapshot** su cloud; i ladder costruiti
   si salvano e si possono **confrontare con i dati correnti** per vedere come yield/duration/prezzo
   sono cambiati giorno per giorno, senza perdere il lavoro precedente.

## Stack
Vanilla JS (no build) · SheetJS 0.20.1 · Chart.js 4 · Firebase 8.10.1 (Firestore + Storage) · PWA.
Design system Antigravity (dark, accent ambra). Deploy su GitHub Pages.

## Storage cloud
Progetto Firebase condiviso `magazzino-edile-pos`, namespacato:
- Firestore: `bond_snapshots` (metadati), `bond_ladders` (ladder salvati)
- Storage: `bond_screener/snapshots/<id>/` (dati JSON normalizzati + file grezzo)

## Colonne attese nel file
`isincode, description, redemptiondate, referencedate, issuercode, currencycode, price,
grossytm, grossduration, currentcouponrate, ratingsp, volumevalue` (+ le altre del file Colab).
Colonne mancanti vengono semplicemente ignorate.

## Sviluppo
File statici: aprire `index.html` con un server locale (`npx serve` o `python -m http.server`).
Deploy: push su `main`, GitHub Pages serve la root.
