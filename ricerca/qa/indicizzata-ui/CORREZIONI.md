# Correzioni dopo la revisione dell'interfaccia

| # | Rilievo | Correzione | Verifica |
|---|---|---|---|
| 1 | Campi «Inflazione attesa» illeggibili | Tre campi affiancati, ognuno con il suo anno sopra (`.infl3`) | larghezze 94/94/94 px a 1440, valori 2,60 · 2,10 · 2,30 |
| 2 | Vincoli incompatibili / paniere vuoto senza messaggio | Nessun titolo → pannello «Nessun titolo rispetta insieme filtri e vincoli…»; quota indicizzata sotto il minimo → avviso rosso | `03-funzioni.cjs`: casi `incompatibili-min100-italia30` e `nessun-emittente` ora VUOTO con messaggio |
| 3 | «Salva la scala» rotto nella scheda 6 | Pulsante tolto da questa scheda (restano Condividi e Stampa) | `04-interazioni.cjs` si ferma proprio perché non lo trova |
| 4 | Timeout con tetto per titolo 1% e risultati vecchi | Tetto per titolo con una variabile del totale (righe da 2 termini, non n); soluzione intera al limite di tempo scartata se oltre il 2% dall'ottimo; ripiego per difetto + liquidità; in caso d'errore i risultati vecchi si tolgono | `tetto-titolo-1` calcolato in 6,2 s, 327.749 € |
| 5 | Link condiviso apre la scheda 1 | La route condivisa tiene `indexed` | il link apre `#/indicizzata` |
| 6 | €STR diverso fra campo e calcolo | Campo vuoto = ultimo valore BCE (segnaposto «ultimo BCE») | |
| 7 | Grafico: rate pagate negli scenari scoperti | Serie «non pagato» tratteggiata; tooltip «Conto XEON dopo la rata» | 4 colonne tratteggiate nello scenario «FOI +0,5% su HICP» |
| 8 | «Soldi finiti al …» | «N rate scoperte su M, dalla …» | |
| 9 | Righe di «Rata per rata» non tornano | Colonna «Interessi XEON» | saldo prima + entrate + interessi − affitto = saldo dopo, scarto massimo 2 € (arrotondamenti) |
| 10 | Nota sugli indicizzati a sproposito | Solo se nel paniere ci sono indicizzati; suggerisce gli scenari non ancora coperti; nome del campo corretto | |
| 11 | Testi delle viste 1–2 | Spiegazione di «Includi BTP Italia e BTP€i» propria della scheda 6; guida corretta | |
| 12 | Confronto con la scala fissa | Frase con dove regge meglio e peggio; etichetta nella prova di stress | |
| 13 | Termini | «Conto XEON» al posto di «liquidità»; «€ di oggi» spiegato nella legenda; glossario con HICP, FOI, BTP€i/BTP Italia, CI, €STR e XEON, euro di oggi; «duration» sostituita da «incassi in media fra N anni» | |
| 16 | Forma dei testi | «tutti e 5», plurali, «nel 2027» | |
| 17 | «(senza indicizzazione)» nella lista | tolto dalla descrizione nella scheda 6 | |
| 18 | BOT con titoli francesi | «titoli di Stato in scadenza entro un anno», «titolo → rendimento» | |
| 19 | Due nomi per lo stesso scenario | «FOI +0,5% su HICP» ovunque | |
| 21 | Anni passati salvati | `loadSettings` riallinea anche la scheda 6 | |

Non corretti (minori): 14 (sesto KPI a capo a 1280 px), 15 (arrotondamenti delle quote), 20 (misure del design system, uguali nelle altre schede).
