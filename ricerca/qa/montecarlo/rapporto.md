# Revisione del Monte Carlo «Affitto indicizzato» (ramo claude/montecarlo-affitto, 9cea0ea)

Dati: data/stfi-latest.csv (regolamento 2026-11-03), data/inflazione/inflazione.json (HICP/FOI fino a 2026-09, €STR 2,441%).
Impostazioni predefinite: affitto 15.000 € dal 2027 al 2046, FOI + 0,5%, scala 282.730 €, capitale complessivo 450.000 €.

## Come riprodurre

```
cd ricerca/qa/montecarlo
node export.mjs base '{"keep":[0,1,2,...,29]}'   # piano + MC originale + copia strumentata (mc_instr.mjs, solo import ed export/hook)
node gen.mjs 50000                               # 50.000 percorsi del generatore
./run_cases.sh                                   # casi limite (out/<caso>.json)
python3 check_generator.py                       # controllo 1
python3 check_walk.py out/<caso>.json            # controllo 2 (percorsi rifatti in Python)
python3 check_stats.py out/<caso>.json           # controllo 3
python3 check_stress.py                          # prove di stress
node timing.mjs                                  # tempi in Node
python3 -m http.server 8791 (dalla radice) ; node ui.cjs ; node ui_heavy.cjs ; node ui_queue.cjs   # browser
```

La copia strumentata dà gli stessi risultati del modulo originale in tutti i casi (`sameAsOriginal: true`).

## Controlli

| # | Controllo | Atteso (calcolo indipendente) | Visto | Esito |
|---|---|---|---|---|
| 1a | AR(1) inflazione, 50.000 percorsi | media 2,30%, dev. staz. 1,20%, φ 0,6, sd innovazione 0,96% | 2,301%, 1,200%, 0,5996, 0,960% | passa |
| 1b | media/sd per anno t=1,2,5 | 2,480/2,408/2,323%; 0,960/1,120/1,196% | 2,481/2,413/2,325%; 0,959/1,121/1,198% | passa |
| 1c | ETF: composto mediano pre-TER = 6%, dopo TER 5,85% | 6,00%, 5,85% | 5,993%, 5,843% | passa |
| 1d | ETF: sd del log 16%, z con varianza 1 | 0,16; 1 | 0,1597; 0,998 | passa |
| 1e | t5 normalizzata: quantili 0,1%/1%/5% | −4,565/−2,607/−1,561 | −4,514/−2,597/−1,560; KS p=0,37 (normale: p≈1e−272) | passa |
| 1f | i 2.000 percorsi del motore | come sopra | media infl. 2,31%, sd 1,19%, mediana eq 5,86% | passa |
| 2a | affitto, deflatore FOI, tasso XEON (€STR+0,5(π−μ)), dal percorso | formula | 0 differenze (30 percorsi base + 150 per caso, 10 casi) | passa |
| 2b | flusso a scadenza BTP€i 2033 e 2041 col CI MEF del percorso | 100·max(1,CI) − 12,5%·(… − prezzo emissione) + cedola | uguale a 1e−6 | passa |
| 2c | walk() rifatto (conto, ETF pro rata, bollo 31/12, vendite 26% costo medio, extra in € di oggi, fallimento) | — | 0 differenze su 3.360 simulazioni (fail, venduto, patrimonio ogni anno) | passa |
| 3a | paidTo, pAll, p10/p50/p90, soldShare, soldMedian da numpy | — | identici in tutti i casi | passa |
| 3b | KPI nel browser = statistiche | 100,0% / 94,4% / 40,0% / 262.390 € / 123.031 € | uguali | passa |
| 3c | patrimonio al 1/1/2027 ≈ capitale − prima rata | 450.000 − 15.000 = 435.000 | mediana 436.227 (scala+ETF), 435.656 (ETF) | passa |
| 3d | valore dei titoli al regolamento ≈ costo | 282.729 | mediana 283.270, ma p10–p90 268.455–299.960 | vedi D1 |
| 4a | capitale < costo | errore | messaggio di errore | passa (M5) |
| 4b | volatilità 0 | tutto ETF: fascia nulla | ETF 435.571 per tutti; scala+ETF 421–453 mila | vedi D1 |
| 4c | prove di stress | valori imposti | crollo −35/−10% su 2027–28; stagflazione 8,8,7,6,5% e borsa ≤0 | passa (M1, M2) |
| 4d | semestrali, «Quanto affitto», «Fino a quando» | coerenti | 0 differenze; pAll 1 / ETF 94,5%, 92,2%, 99,65% | passa |
| 5 | 390 e 1440 px, chiaro e scuro, console | — | nessun errore, nessuno scorrimento orizzontale | passa salvo D3, M6 |

## Rilievi

**B1 — bloccante. Il percorso «fallisce» per scoperti di pochi euro, e da lì il patrimonio vale 0 anche se si hanno ancora i titoli.**
Con capitale = costo della scala (282.730 €): «scala + ETF» 60,0% contro «tutto in ETF» 56,5%. Il 40% dei percorsi fallisce, ma lo scoperto mediano alla rata è 85 € (0,5% della rata, minimo 7,43 €; 76% sotto l'1%) mentre si hanno ancora titoli per 230.496 € di oggi (mediana). Patrimonio finale mediano 1.995 €. Con la spesa extra (40.000 €/anno 2035–2044) scala+ETF 9,9% contro ETF 25,8%: al fallimento restano titoli per 112 mila € di oggi (mediana). Il modello non vende mai i titoli e conta come «affitto non pagato» anche uno scoperto di pochi euro, quindi il KPI principale e il confronto con «tutto in ETF» risultano molto peggiori del vero. Correzione: vendere titoli (al valore teorico) quando conto ed ETF non bastano, oppure una tolleranza, e non azzerare il patrimonio dei percorsi falliti.
Per riprodurre: `node export.mjs eqcost '{"mc":{"total":282730},"keep":[0..149],"noPaths":true}'`, poi `python3 check_walk.py out/eqcost.json` (riepilogo dei fallimenti).

**D1 — da correggere. I titoli sono valutati con l'inflazione futura del percorso (che si conosce in anticipo) e scontati a un tasso nominale fisso.**
Al regolamento il valore va da 268 a 300 mila € (p10–p90) su un costo di 283 mila. La correlazione con l'inflazione media del percorso è 0,80. Con volatilità ETF 0, al 1/1/2027 la fascia di scala+ETF va da 421 a 453 mila €, mentre «tutto ETF» è un punto solo. In stagflazione il patrimonio mediano al 1/1/2027 è 487.000 €: più dei 450.000 € di partenza meno la rata, appena due mesi dopo. La nota «all'inizio valgono quanto sono costati» vale solo per la mediana. Correzione: tasso di sconto che segue l'inflazione realizzata fino alla data (per esempio rendimento reale + inflazione attesa a quella data), oppure contare solo i flussi già incassati.

**D2 — da correggere. L'importo della spesa extra si perde.** In settings.js i gestori degli anni e la casella `mcex` usano `ex`, preso al momento del disegno, mentre l'importo (`mcexa`) si salva senza ridisegnare il pannello. Per riprodurre: spunta «Spesa extra», scrivi 35.000, premi «+» sul primo anno: l'importo torna a 20.000 (ui.cjs, `extraStale`). Correzione: leggere `x.extra` dentro `setM`.

**D3 — da correggere. L'asse del grafico del patrimonio è tagliato.** Con M.l = 48 px, «1.000.000» e «500.000» escono dall'SVG. Sul telefono si legge «.000.000» (out/mc-tel-chiaro.png).

**D4 — da correggere. Tempi e limite di 30 s.** Il Monte Carlo aggiunge in Node 2,7 s (base), 5,0 s (semestrali), 11,6 s (semestrali al 2066). Nel browser, pagina compresa: 8,3 s, 12,1 s, 24,3 s, quindi vicino al limite di 30 s già su un computer veloce. Basta cambiare due impostazioni in fretta (rate semestrali, poi fine al 2066) per avere «il calcolo richiedeva troppo tempo ed è stato interrotto» (ui_queue.cjs), perché il guardiano conta anche l'attesa in coda nel worker. Dopo, quelle impostazioni restano segnate come «si blocca: cambiane una». Inoltre ogni modifica a un parametro del Monte Carlo rifà tutta l'ottimizzazione (3,6–11 s). Si potrebbe tenere il piano in cache e rifare solo il Monte Carlo.

**D5 — da correggere. Le spese extra non pagate contano come «affitto non pagato».** Il fallimento per la spesa extra va sulla rata dello stesso giorno, ma il KPI dice «Affitto pagato fino al…». Con la spesa extra serve un'etichetta diversa, per esempio «Spese pagate fino al…».

**Minori**
- M1: la stagflazione impone il 2027–2031, ma dal 2032 l'inflazione torna identica al percorso senza stress (media 2,31%; con l'AR(1) che riparte dal 5% sarebbe 3,92%). Inoltre la «borsa ferma» è 0 senza il TER.
- M2: il crollo cade nel 2027–2028, mentre novembre e dicembre 2026 restano casuali. Il −35% non toglie il TER.
- M3: `infl0` (2,6%, base del 2027) va al 2026; il 2027 è già casuale (media 2,48%). Il testo dice «partendo da quella base del primo anno».
- M4: il bollo dello 0,2% sull'ETF è intero al 31/12/2026 per due mesi (circa 280 € in più); sui titoli è pro rata.
- M5: il messaggio «capitale complessivo minore del costo» mostra numeri senza separatori («100000 €»), compare in «Da sapere» e non nel pannello Monte Carlo, e la scala si calcola lo stesso.
- M6: «2000 percorsi» nel pannello, «2.000» nelle impostazioni. Il grafico di sinistra non ha l'etichetta dell'ultimo anno (finisce a 2043, i dati al 2046) e i due grafici hanno assi x diversi (2046 e 2047). Il viewBox è largo 518 contro 506 px visualizzati (leggera riduzione). La regola CSS `.chart path.band.mc-a` è scritta due volte.
- M7: nel 2,8% degli anni l'inflazione è negativa e l'affitto scende; i canoni ISTAT di solito non scendono.
- M8: in «Quanto affitto» e «Fino a quando» ci sono due capitali («Capitale da investire» e «Capitale complessivo», 450.000 € di default, indipendente dal budget). Se il budget supera 450.000 € compare l'errore M5.
