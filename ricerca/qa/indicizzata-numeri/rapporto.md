# Revisione indipendente: numeri e codice di «Affitto indicizzato»

Ramo `claude/passivita-indicizzata` (3 commit dopo `bfaa1a6`). Dati: STFI del 02/11/2026 (regolamento 04/11/2026) e `data/inflazione/inflazione.json` del 03/11/2026. Non ho modificato file sotto src/, scripts/ o tests/. I test esistenti passano (8 su 8).

## Script (tutti in questa cartella, si lanciano da qui)

| Script | Cosa fa |
|---|---|
| `flussi_app.mjs` | Scrive in `flussi_app.json` i flussi che `buildInstruments` produce con inflazione costante al 2% |
| `flussi_py.py` | Ricalcolo separato in Python con `Decimal`: CI MEF, cedole, rimborso, imposte, bollo, costo. Lo confronta con l'app |
| `piano_app.mjs '<json>' tag` | Esegue `computeIndexed` con `defaults()` più le modifiche indicate, poi scrive `piano_<tag>.json` |
| `sim_py.py tag [scenari]` | Ricalcola in Python i flussi degli indicizzati, le rate, XEON e il deflatore. Simula la cassa evento per evento e la confronta con `byScen[s][k].bal` |
| `casi_limite.py [tag…]` | Lancia i casi limite e controlla tempo, lotti, budget, quota indicizzata, tetto per titolo e copertura. Risultati in `casi_limite.out` |
| `base_btpitalia_stale.mjs` | Riproduce il rilievo C2 (base dei BTP Italia sfasata) |
| `test_fetch.py` | Prove offline di `fetch_inflation.py`: storico append-only e avanzamento della base |
| `highs_n0.mjs` | Verifica che HiGHS crei una colonna che compare solo nella sezione Bounds |

## Controlli

| # | Controllo | Esito | Valori |
|---|---|---|---|
| 1 | BTP€i IT0005547812, inflazione costante 2% | ✅ | CI di regolamento 1,09438 in entrambi. Costo per 100: 108,81117 in entrambi. 41 flussi, differenza massima 3e-14 |
| 2a | BTP Italia IT0005532723 | ✅ | CI 1,00806 in entrambi. Costo 103,33275 in entrambi. Differenza massima sui flussi 0,00087 per 100: l'app non arrotonda NI/base_t alla 5ª cifra |
| 2b | BTP Italia Sì IT0005713547 | ✅ ⚠️ | Costo 102,00915 in entrambi. Differenza massima sui flussi 0,00057. Rateo: vedi ⚠️1 |
| 2c | Basi BTP Italia ricavate dal FOI | ✅ | 102,93 · 103,62258 · 102,40 · 101,30645 · 101,60 · 102,23333 (Sì) · 104,12 (22/11/26): tutti coincidono con quelli ricalcolati |
| 3 | Piano predefinito (mincost, 2027→2046) | ✅ | 14 titoli, 282.744,57 € di cui 852,11 € in liquidità, 95% indicizzati, 3,9 s. Saldo dopo ogni rata uguale a `byScen.bal` entro 0,33 € in tutti e 5 gli scenari. Rate uguali (differenza 0). Saldo minimo negli scenari da coprire: base 40,93 €, alto 0,15 €, shock 0,25 € |
| 3b | Stessa simulazione su semestrale, maxscale, maxhorizon e «tutti robusti» | ✅ | Saldi uguali entro 0,43 €. Negli scenari da coprire il saldo minimo è ≥ −0,28 €, dentro la tolleranza di 0,5 € dell'app |
| 4 | Rendimento netto XEON | ✅ | (2,441% + 0,085% − 0,10%) × 0,74 − 0,2% = 1,59524%, uguale a `cash.xeon` |
| 4b | Crescita della liquidità fra due date | ✅ | Riprodotta esattamente. Con capitalizzazione annua «naturale» la differenza è al massimo 3,6 € in 20 anni (M4) |
| 4c | Deflatore («euro di oggi») | ✅ | Differenza ≤ 2e-15 (ma vedi B1 con HICP) |
| 5 | Casi limite: 21 casi | vedi rilievi | Nessun crash. Tempo massimo 13,7 s (maxscale semestrale con tetto, in Node). Lotti sempre interi. Tetto per titolo e quota indicizzata rispettati quando ci sono indicizzati |
| 6 | `fetch_inflation.py --dry-run` | ✅ | rc 0. HICP e FOI fino a 2026-09, €STR 2,441% del 02/11. Nessun errore. Il JSON salvato ha 19 CI su 19 uguali a quelli MEF |
| 6b | Storico append-only e avanzamento della base | ✅ | Un mese rivisto non viene sovrascritto e viene segnalato. La base si sposta il giorno della cedola (21/11 → 101,30645; 22/11 → 104,12) |

## Rilievi

| Id | Gravità | Rilievo | Come riprodurlo |
|---|---|---|---|
| B1 | **bloccante** | **«L'affitto segue: HICP» non ha effetto.** `liabilities()` legge `cfg.index`, mentre la configurazione passa `liabIndex`. L'affitto segue quindi sempre il FOI. Il deflatore e il testo della vista seguono invece `liabIndex` e dicono «cresce con l'inflazione europea (HICP)». Nello scenario «FOI +0,5%» la rata del 2046 risulta più alta di 2.450 € e il saldo finale sbaglia di 22.542 €. I test non lo vedono perché nella fixture FOI e HICP sono uguali | `node piano_app.mjs '{"alm":{"liabIndex":"HICP"}}' hicp && python3 sim_py.py hicp basis`: `diff_rate` 2450. Il piano con HICP è identico a quello con FOI (`casi_limite.out`). Correzione: in `prepare` usare `liabilities({ ...cfg, index: cfg.liabIndex }, …)` |
| C1 | da correggere | **maxhorizon può superare il budget.** La ricerca binaria verifica il budget sul programma rilassato, ma il programma intero che segue (mincost) non ha il vincolo di budget. Con budget 190.320 € il costo esce a 190.453,82 € | `python3 casi_limite.py maxhorizon_190320`. Correzione: aggiungere il vincolo di budget al programma intero oppure scendere all'anno prima |
| C2 | da correggere | **Base dei BTP Italia sfasata se una cedola cade fra la data del file d'inflazione e il regolamento STFI.** Il JSON porta `baseDal`, ma l'app non lo legge. Esempio: 22/11/2028 con regolamento 24/11/2026 e base non ancora spostata. CI 1,02817 invece di 1,00038, costo 104,82 invece di 101,99 per 100, prima rivalutazione 3,43 invece di 0,98. Il caso opposto (file STFI più vecchio, per esempio caricato a mano) fa perdere una rivalutazione. In più l'`avviso` di `roll_bases` («FOI mancante») non finisce fra gli errori, e il controllo dà `ok: true` | `node base_btpitalia_stale.mjs`. `python3 test_fetch.py` (riga 2026-12-23: avviso presente, nessun errore). Correzione: passare `baseDal` a `prepareInflation` e fermarsi (o rifare il conto) se c'è una cedola in (baseDal, settle] o se baseDal è dopo settle |
| C3 | da correggere | **Quota minima indicizzata senza indicizzati nel paniere.** Il vincolo vale sul costo dei titoli, quindi zero titoli lo rispettano. Con rating minimo AAA e quota 50% il risultato è 376.236 € tutti in XEON, quota 0%, e nessun avviso. Sempre con AAA ma senza quota, il costo di 351.365 € supera il budget di 300.000 € e non compare nessun avviso | `python3 casi_limite.py pochi_titoli_AAA_minLinker pochi_titoli_AAA` |
| M1 | minore | Il bollo dei BTP Italia classici usa il CI cumulato dalla base iniziale. Il controvalore vero usa la base del semestre in corso, che si azzera a ogni cedola, quindi il bollo è sovrastimato. Sul 2028: −0,2822 contro −0,2747 per 100. Cresce sui titoli lunghi (2032) | `python3 flussi_py.py`: `bollo_app` contro `bollo_base_corrente` |
| M2 | minore | Il primo anno può essere quello di oggi (`minYear` = anno di `refDate`). La rata del 1/1/2026, già passata, viene contata come pagata al regolamento, senza avviso. Lo stesso succede se il regolamento cade dopo il 1/1 (dati di fine dicembre) | `python3 casi_limite.py anno_da_oggi_2026` |
| M3 | minore | Il controllo «media 2025 = 100» non gira mai per il FOI: la serie salvata parte da 2026-01, quindi la condizione `len(y25) == 12` è falsa e il controllo salta senza dirlo. In `controlli` c'è solo `hicp_media_2025` | `inflazione.json` → `controlli` |
| M4 | minore | La cedola dei BTP Italia usa NI/base senza arrotondare il CI alla 5ª cifra (al massimo 0,0009 per 100). Il tasso XEON continuo ln(1+r)/365,25 dà in un anno di 365 giorni un rendimento un po' più basso (prudente, al massimo 3,6 € in 20 anni). Con il limite di tempo il programma intero non è deterministico: con `mip_1s` la scala fissa di confronto dà 20.283,92 € in un'esecuzione e 20.288,53 € in un'altra | `sim_py.py` (diff_saldo_annua), `casi_limite.out` |

### Punti ⚠️ (non sono errori dimostrati, vanno verificati)

1. **Rateo dell'inflazione del BTP Italia Sì.** L'app moltiplica la componente inflazione per la frazione di semestre trascorsa. È la lettura letterale del decreto di emissione, art. 4 («secondo le convenzioni BTP applicando … la somma della Componente Fissa e della Componente Inflazione»; testo in `dl/decreto_si.txt`). L'altra lettura, con la componente intera, porta il costo a 102,359 invece di 102,009 per 100. Conviene confrontarlo con un fissato bollato reale.
2. Plusvalenza a scadenza dei BTP Italia calcolata sul prezzo reale e non su prezzo × CI: sovrastima l'imposta, quindi è prudente.
3. Scenario «basso»: con il piano predefinito (95% indicizzati) i soldi finiscono già al 1/1/2028, con un ammanco di 347 €. Il valore è coerente con la mia simulazione: l'€STR più basso nello scenario e i floor contano più dell'affitto che cresce meno. Il punto è il comportamento: lo scenario non è fra quelli da coprire e la vista lo segnala.
4. Le basi dei BTP Italia sono il massimo storico solo se nessun NI precedente in base 2015 era più alto. Con i dati in mano non posso verificarlo (la ricerca lo segna DA RICAVARE).
