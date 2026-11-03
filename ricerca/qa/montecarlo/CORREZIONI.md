# Correzioni dopo il controllo del Monte Carlo

| Rilievo | Correzione | Verifica |
|---|---|---|
| B1 percorso «fallito» per pochi euro, titoli mai venduti | Se conto ed ETF non bastano si vende una quota dei titoli della scala al loro valore; il percorso fallisce solo se non resta nulla | capitale = costo della scala: scala 98,3% contro tutto ETF 60,2% (prima 60,0% contro 56,5%); test «senza ETF la scala vende titoli» |
| D1 titoli valutati conoscendo l'inflazione futura | Flussi degli indicizzati portati all'inflazione attesa (media), poi scontati al rendimento della scala | test: fascia iniziale del patrimonio sotto l'8% del costo |
| D2 importo della spesa extra perso | I gestori leggono lo stato corrente | Playwright: 35.000, «+» sul primo anno → resta 35.000 |
| D3 asse tagliato | Margine sinistro in base alla lunghezza delle etichette | screenshot a 390 e 1440 px |
| D4 tempi | La scala e il confronto a importo fisso si ricalcolano solo se cambiano paniere, affitto o vincoli; 1.000 percorsi oltre 30 rate; limite 60 s nella scheda 6; deflatore precalcolato | |
| D5 spesa extra non pagata contata come affitto | Contata a parte (KPI «Spese extra non pagate»), l'affitto prosegue | |
| M1 stagflazione | L'inflazione riparte dal 5%; borsa ferma meno il TER | |
| M2 crollo | Testo «primi due anni interi»; TER tolto anche nel crollo | |
| M3 inflazione del primo anno | Quella base vale per il resto dell'anno in corso e per il primo anno di rate, poi AR(1) | |
| M4 bollo ETF | Proporzionale ai giorni del primo anno | |
| M5 messaggio capitale minore | Nel pannello Monte Carlo, con i numeri formattati | |
| M6 testi e grafici | «2.000», etichetta dell'ultimo anno, regola CSS doppia tolta | |

M7 risolto su decisione di Igor: con inflazione negativa l'affitto resta fermo (scala e Monte Carlo).
Non corretti: M8 (in «Quanto affitto» e «Fino a quando» il capitale complessivo è un campo separato dal capitale da investire: ora la nota lo dice).
Nota: gli script `check_walk.py` e `export.mjs` rifanno il modello di prima della correzione B1/D1: sul nuovo codice differiscono per costruzione.
