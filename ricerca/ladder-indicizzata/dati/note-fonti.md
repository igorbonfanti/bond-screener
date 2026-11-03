# Fonti dati per la scala indicizzata (verifica del 3/11/2026)

Tutti i valori qui sotto vengono da download fatti il 3/11/2026 (circa 13:30–13:55 UTC) tramite il proxy della sessione.
Il prototipo `fetch_inflation_proto.py` (solo standard library) li riscarica e scrive `hicp_xt.json`, `foi_xt.json`,
`estr.json` e `ci_mef.json`. Tempo totale: circa 2 minuti con `--mesi-ci 6`, quasi tutto per i CSV MEF.

## 1. HICP area euro ex-tabacco (Eurostat)

**Perché `prc_hicp_midx` + `I25` è vuoto:** `prc_hicp_midx` è la vecchia serie ECOICOP 1, ferma a dic 2025
(label "(1996-2025)", OBS_PERIOD_OVERALL_LATEST = 2025-12). Dal ribasamento (dati di gen 2026, diffusi il 25/2/2026)
le serie sono nei nuovi dataset **ECOICOP ver.2**, che hanno la dimensione **`coicop18`** (non `coicop`).

| uso | URL (API JSON-stat 2.0) |
|---|---|
| **prime pubblicazioni, base 2025** (quelle usate dal MEF) | `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_fpd?format=JSON&lang=EN&geo=EA&coicop18=TOT_X_TBC&unit=I25&release=FIN&sinceTimePeriod=2015-01` |
| valori rivisti, base 2025 | `.../data/prc_hicp_minr?format=JSON&lang=EN&geo=EA&coicop18=TOT_X_TBC&unit=I25&sinceTimePeriod=2015-01` |
| base 2015 (ECOICOP 1, fino a dic 2025) | `.../data/prc_hicp_midx?format=JSON&lang=EN&geo=EA&coicop=TOT_X_TBC&unit=I15&sinceTimePeriod=2000-01` |

- Codici: `coicop18=TOT_X_TBC` ("Overall index excluding tobacco"), `geo=EA` (area euro a composizione variabile:
  EA20 fino al 2025, EA21 dal 2026). È questa la serie del MEF: con EA i CI tornano al centesimo (vedi §5). EA20/EA21
  hanno valori leggermente diversi (es. gen 2026: EA 100,02, EA20 100,01, EA21 100,02).
  In `prc_hicp_minr`/`prc_hicp_fpd` c'è anche `unit=I15` (ECOICOP 2 in base 2015).
- `prc_hicp_fpd` ha la dimensione `release` con FIN (Final) e FLS (Flash). Per TOT_X_TBC le osservazioni FLS
  sono vuote: la stima flash non comprende l'indice ex-tabacco.
- Ultimi valori (prime pubblicazioni, I25): 2025-12 **100,61** · 2026-01 100,02 · 2026-02 100,66 · 2026-03 101,96 ·
  2026-04 103,02 · 2026-05 103,10 · 2026-06 102,98 · 2026-07 103,21 · 2026-08 103,66 · **2026-09 104,29**.
  Il dataset è aggiornato al 16/10/2026 (`updated` 2026-10-16T23:00+02:00). Il dato di ottobre esce a metà novembre.
- **Revisioni: ci sono.** Rivisti meno prima pubblicazione (I25): 2026-03 101,95 contro 101,96; 2026-04 103,01 contro 103,02;
  2026-05 103,09 contro 103,10 (anche 2019-11 81,78 contro 81,79). Ho verificato che i CI MEF di giu–nov 2026 tornano
  **solo** con le prime pubblicazioni (91 giorni su 91 discordanti con i valori rivisti). Quindi bisogna usare `prc_hicp_fpd&release=FIN`.
- **Eccezione gen 2026:** i CI MEF di aprile 2026 implicano gen 2026 = **100,01** (es. IT0005482994 al 1/4/2026:
  CI 1,18870 × IR base 84,13387 = 100,0099). Oggi `prc_hicp_fpd` riporta 100,02. Per il calcolo dei CI correnti non serve
  (usa m-3 ≥ ago 2026), ma serve per ricostruire lo storico di mar–apr 2026.
- **Raccordo 2015 → 2025.** Nella nota MEF (`https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/coefficienti_indicizzazione/BTPi-Nota-sul-ribasamento-dellIndice-IAPC-2025100.pdf`):
  CRB = IE dic2025(base 2025) / IE dic2025(base 2015) = **100,61 / 128,89**, presa senza arrotondamenti.
  IR_base2025 = IR_base2015 × CRB, troncato alla 6ª decimale e arrotondato alla 5ª.
  Il MEF dice che 128,89 è il valore "comunicato da Eurostat il 19 gennaio". **Oggi nessun dataset Eurostat dà 128,89:**
  `prc_hicp_midx` e `prc_hicp_fp` (ECOICOP 1) danno 128,91, `prc_hicp_fpd` I15 (ECOICOP 2) dà 128,90, EA20 128,92.
  I CI MEF tornano solo con 128,89: va tenuto come **costante**, non va riscaricato.
- Tempi di risposta: 0,5–1,3 s per richiesta. CORS: `Access-Control-Allow-Origin: *` (verificato), quindi si
  potrebbe anche leggere dal browser. Il catalogo TOC (`/catalogue/toc/txt`) risponde in circa 5 s.

## 2. FOI senza tabacchi (ISTAT SDMX)

| serie | URL |
|---|---|
| base 2025, dal 2026 | `https://esploradati.istat.it/SDMXWS/rest/data/169_748_DF_DCSP_FOI1B2025_1/M.IT.101.4.00ST?startPeriod=2026-01` |
| base 2015, 2016–2025 | `https://esploradati.istat.it/SDMXWS/rest/data/169_748_DF_DCSP_FOI1B2025_2/M.IT.55.4.00ST?startPeriod=2015-01` |

- Chiave: FREQ=M . REF_AREA=IT . DATA_TYPE (101 = FOI base 2025 mensile, 55 = FOI base 2015 mensile) .
  MEASURE=4 (numeri indici; 6 e 7 sono le variazioni congiunturale e tendenziale) . ECOICOP_2=**00ST** ("indice generale
  senza tabacchi"). La risposta è SDMX-ML Generic 2.1 (XML), che si legge con regex o ElementTree.
- Valori base 2025: 2026-01 100,4 · 02 100,9 · 03 101,5 · 04 102,5 · 05 102,8 · 06 102,8 · 07 103,1 · 08 103,7 · **09 104,3**.
  Base 2015: 2025-10 121,4 · 2025-11 121,3 · **2025-12 121,5**.
- **Coefficiente di raccordo ufficiale: 1,214** (FOI_2025 = FOI_2015 / 1,214). Fonte:
  `https://www.istat.it/notizia/indice-dei-prezzi-per-le-rivalutazioni-monetarie/` ("Indice generale FOI (base 2025=100,
  il coefficiente di raccordo con la precedente base 2015=100 è 1,214)"). Lo conferma l'avviso CDP
  `https://www.cdp.it/internet/public/cms/documents/Avviso-ribasamento-FOI-2026.pdf`. Dic 2025 in base 2025 = 121,5/1,214
  = 100,0824 (non arrotondato). La nota MEF `BTP-Italia-Nota-sul-ribasamento-dellIndice-FOI-2025100.pdf` usa lo stesso
  coefficiente: IR_base2025 = IR_base2015 / CR, troncato alla 6ª decimale e arrotondato alla 5ª.
- Revisioni: lo SDMX non ha un dataset "prime pubblicazioni". Gli Information Memorandum dei BTP Italia dicono:
  "qualora l'Indice FOI senza tabacchi subisca revisioni… si continuerà ad applicare l'Indice pubblicato prima della revisione".
  Il FOI non ha la stima flash e di norma non viene rivisto. Conviene comunque **congelare in JSON il primo valore letto**
  e non sovrascriverlo.
- **Tempi e problemi:** la lista dei dataflow (`/dataflow/IT1/all/latest?detail=allstubs`) ha impiegato 47 s; la DSD
  (`references=all`) 30 s e 10 MB; le query dati 0,8–2,5 s. Tramite il proxy della sessione 3 richieste su circa 8 sono state
  chiuse dopo circa 10 s (`Connection reset`, `ws_closed_mid_exchange`) e sono riuscite al tentativo successivo. ISTAT
  dichiara un limite di circa 5 richieste al minuto per IP, oltre il quale c'è il rischio di blocco temporaneo: nell'Action
  fare 2 sole richieste, distanziate (≥13 s), con 3–4 retry. `detail=referencepartial` sul dataflow dà **501**.
  Il CORS non è verificato: fare comunque tutto nell'Action.

## 3. Coefficienti di indicizzazione MEF

- Pagine indice:
  `https://www.dt.mef.gov.it/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btpei/` (14 sottopagine)
  e `.../coefficienti_di_indicizzazione_btp_italia/` (5 sottopagine). Ogni sottopagina ha un **CSV e un PDF per mese**
  (gen–nov 2026 visibili; lo storico è in `archivio_coefficienti_indicizzazione.html`).
  Esempio: `https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/coefficienti_indicizzazione/btpei_15_anni_20230515/Coefficienti-di-indicizzazione-BTPEi-15-anni-novembre-2026-base-15.05.2023.csv`
- Formato CSV: UTF-8 con BOM, CRLF, separatore `;`, decimale `,`. Le prime righe hanno titolo, indice, ISIN con descrizione e mese,
  poi `;DATA;BASE gg/mm/aaaa`. Le date sono `01-nov-26` per i BTP€i e `01/11/2026` per i BTP Italia. **I CI sono giornalieri**
  (tutti i giorni di calendario). Nei BTP Italia la colonna BASE è la data di stacco della cedola semestrale precedente e
  cambia ogni semestre: nel mese di stacco ci sono 2 colonne (es. 22/11/2028: BASE 22/05/2026 fino al 21/11, poi BASE 22/11/2026).
  I nomi dei file non sono prevedibili al 100% (cartelle `btpei_15_anni_20230515`, `btp_italia_20271028`; le sottopagine si chiamano
  sia `coefficenti_` che `coefficienti_`): **conviene leggere l'HTML delle sottopagine e prendere i link `.csv`**, come fa il prototipo.
- Pubblicazione: il CSV del mese m esce poco dopo l'uscita dell'indice di m-2. I file di novembre hanno
  `Last-Modified: 19 Oct 2026`. A inizio novembre c'è quindi già tutto novembre, ma non ancora dicembre.
  Tempi: 0,4–1,7 s per file. Nessun 403 (ho usato lo User-Agent "Mozilla/5.0"). **Nessun header CORS**, quindi il browser
  non può leggere i file e serve l'Action.
- Copertura dell'universo: tutti i 14 BTP€i sono presenti. Per i BTP Italia il MEF pubblica con l'ISIN "con Premio Finale Extra";
  l'ISIN negoziabile "senza Premio" ha lo stesso CI (Information Memorandum, art. "codici ISIN"): IT0005388175→IT0005388167,
  IT0005497000→IT0005496994, IT0005517195→IT0005517187, IT0005532723→IT0005532715, IT0005648255→IT0005648248.
  **IT0005713547 (BTP Italia Sì 23/06/2031, alias IT0005713539): il MEF non pubblica CI.** È un titolo diverso: non rivaluta
  il capitale e la cedola è la quota fissa più la "Componente Inflazione" = max(0, CI(d,m) − 1), con
  CI = NumeroIndice(d,m) / NumeroIndice alla cedola precedente o alla data di regolamento (23/06/2026), e stessa interpolazione FOI.
  Fonte: Information Memorandum, `https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/comunicazioni_emissioni/btp_italia_si_comunicazione_emissione/Information-Memorandum-BTP-Italia-Si-23.06.2031-1.pdf`.
  Calcolo mio, non ufficiale: IR(23/06/2026) = 101,5 + 22/30×1,0 = 102,23333; IR(3/11/2026) = 103,74; CI = 1,01474.
- Regola BTP Italia (Information Memorandum BTP Italia 04/06/2032): stessa interpolazione FOI m-3/m-2 di §5, con IR e CI troncati
  alla 6ª decimale e arrotondati alla 5ª. Il CI per il mercato secondario è IR(d)/IR(ultima data cedola). Per cedole e rivalutazione si applica il
  **floor**: se il CI semestrale è < 1 si pone = 1, e la base diventa il massimo tra gli IR delle date cedola precedenti.
  Il floor non vale per ratei e negoziazioni.

| ISIN | data base | IR base (base 2025)¹ | CI ufficiale 3/11/2026 |
|---|---|---|---|
| IT0003745541 | 15/09/2004 | 65,42310 (impl.) | 1,58510 |
| IT0004545890 | 15/09/2009 | 71,98379 (impl.) | 1,44063 |
| IT0005138828 | 15/09/2015 | 78,29443 (impl.) | 1,32451 |
| IT0005246134 | 15/11/2016 | 78,31380 (impl.) | 1,32419 |
| IT0005387052 | 15/05/2019 | 80,81051 (b2015 103,52516) | 1,28327 |
| IT0005436701 | 15/11/2020 | 81,56521 (impl.) | 1,27140 |
| IT0005482994 | 15/11/2021 | 84,13387 (b2015 107,78267, esempio MEF) | 1,23258 |
| IT0005543803 | 26/04/2023 | 94,27683 (b2015 120,77667) | 1,09997 |
| IT0005547812 | 15/05/2023 | 94,77800 (impl.) | 1,09416 |
| IT0005588881 | 15/11/2023 | 96,67324 (b2015 123,84667) | 1,07271 |
| IT0005647273 | 15/11/2024 | 98,44725 (b2015 126,11933) | 1,05338 |
| IT0005657348 | 27/06/2025 | 99,96420 (b2015 128,06267) | 1,03739 |
| IT0005706293 | 15/02/2026 | 100,52804 (b2015 128,78500) | 1,03157 |
| IT0005725160 | 30/07/2026 | 103,09484 | 1,00589 |
| IT0005388175 | 28/10/2026 (sem.) | 103,62258 | 1,00113 |
| IT0005497000 | 28/06/2026 (sem.) | 102,40000 | 1,01309 |
| IT0005517195 | 22/05/2026 (sem.) | 101,30645 | 1,02402 |
| IT0005532723 | 14/09/2026 (sem.) | 102,93000 | 1,00787 |
| IT0005648255 | 04/06/2026 (sem.) | 101,60000 | 1,02106 |

¹ Il MEF non pubblica l'IR base nei CSV/PDF dei CI; c'è solo nella pagina "esempi di calcolo" (107,78267 per IT0005482994).
"b2015" vuol dire ricalcolato da `prc_hicp_midx` I15 × 100,61/128,89. "impl." vuol dire ricavato dai CI ufficiali di mag–nov 2026:
è l'intervallo compatibile con tutti i giorni, largo ≤ 2e-5 (in `ci_mef.json`, campo `ir_base_implicito_mef`). Per i titoli con
godimento fino al 2016 l'IR base era in base 2005, poi ribasato nel 2016 (nota `BTPEi_Nota_Ribasamento_Indice_IAPC_2015x100.pdf`).
Per IT0005547812 e IT0005436701 la serie attuale è stata leggermente rivista. In tutti questi casi il ricalcolo non torna e l'IR base va
tenuto come costante.

## 4. €STR (BCE)

- `https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=60&format=csvdata`
  (oppure `format=jsondata`). CSV con colonne `TIME_PERIOD`, `OBS_VALUE`. Risposta in circa 3,7 s, con `Access-Control-Allow-Origin: *`.
- Ultimi valori: 27/10 2,440 · 28/10 2,439 · 29/10 2,439 · 30/10 2,440 · **02/11/2026 2,441 %**. Il tasso del giorno T
  esce alle 8:00 CET del giorno lavorativo T+1. OBS_STATUS A (le revisioni sono rare e fatte in giornata).

## 5. Verifica CI (giorno 3/11/2026)

Formula: IR(d,m) = I(m−3) + (d−1)/gg(m)·[I(m−2) − I(m−3)], con troncamento alla 6ª decimale e arrotondamento alla 5ª.
CI = IR(d)/IR(base), con lo stesso troncamento e arrotondamento.
Per novembre: HICP ago 103,66 e set 104,29, quindi IR = 103,70200. FOI ago 103,7 e set 104,3, quindi IR = 103,74000.
IR base calcolato **in modo indipendente** dai CI MEF:

| ISIN | IR base usato | CI calcolato | CI MEF | diff |
|---|---|---|---|---|
| IT0005482994 BTP€i | 84,13387 (107,78267×CRB) | 1,23258 | 1,23258 | 0 |
| IT0005387052 BTP€i | 80,81051 | 1,28327 | 1,28327 | 0 |
| IT0005543803 BTP€i | 94,27683 | 1,09997 | 1,09997 | 0 |
| IT0005588881 BTP€i | 96,67324 | 1,07271 | 1,07271 | 0 |
| IT0005647273 BTP€i | 98,44725 | 1,05338 | 1,05338 | 0 |
| IT0005657348 BTP€i | 99,96420 | 1,03739 | 1,03739 | 0 |
| IT0005706293 BTP€i | 100,52804 (con dic 2025 = 128,89) | 1,03157 | 1,03157 | 0 |
| IT0005725160 BTP€i | 103,09484 (apr/mag 2026 in base 2025) | 1,00589 | 1,00589 | 0 |
| IT0005547812 BTP€i | 94,78153 (serie attuale) | 1,09412 | 1,09416 | −0,00004 |
| IT0005436701 BTP€i | 81,56157 (serie attuale) | 1,27146 | 1,27140 | +0,00006 |
| IT0005138828 BTP€i | 78,40695 (serie attuale) | 1,32261 | 1,32451 | −0,00190 |
| IT0005246134 BTP€i | 78,41944 | 1,32240 | 1,32419 | −0,00179 |
| IT0003745541 BTP€i | 65,35968 | 1,58664 | 1,58510 | +0,00154 |
| IT0004545890 BTP€i | 71,86978 | 1,44292 | 1,44063 | +0,00229 |
| IT0005388175 BTP Italia | 103,62258 (lug/ago 2026, d=28) | 1,00113 | 1,00113 | 0 |
| IT0005497000 BTP Italia | 102,40000 | 1,01309 | 1,01309 | 0 |
| IT0005517195 BTP Italia | 101,30645 | 1,02402 | 1,02402 | 0 |
| IT0005532723 BTP Italia | 102,93000 | 1,00787 | 1,00787 | 0 |
| IT0005648255 BTP Italia | 101,60000 | 1,02106 | 1,02106 | 0 |

Con l'IR base costante corretto (impl.) anche le 6 righe non nulle tornano a 0. La conclusione è che la formula e i dati sono giusti; quello che
sbaglia è l'IR base ricalcolato dalla serie odierna per i titoli vecchi o per quelli i cui mesi base sono stati rivisti.
