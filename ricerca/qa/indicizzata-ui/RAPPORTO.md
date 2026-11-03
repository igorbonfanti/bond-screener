# Revisione dell'interfaccia: scheda «6 Affitto indicizzato»

Ramo `claude/passivita-indicizzata`. La revisione è partita su `c685649`. Durante il lavoro sono arrivati i commit
`2b36a91`, `c9ec7a1` e `b30aea4`, che cambiano solo il motore: le prove su funzioni e numeri (`03-funzioni.cjs`)
sono state rifatte su `b30aea4`. I risultati precedenti sono in `prima-di-b30aea4/`.
Server `python3 -m http.server 8790`, Chromium di Playwright, deviceScaleFactor 1.

Script: `01-layout.cjs` (4 larghezze × 2 temi), `02-mobile-pannelli.cjs` (ritagli dei pannelli),
`03-funzioni.cjs` (25 casi di impostazioni con controlli di coerenza automatici), `04-interazioni.cjs`
(scenari, unità, CSV, Copia ISIN, condivisione, guida, comandi, timeout), `05-regressione.cjs` (schede 1–5 a
confronto con `bfaa1a6`, stessi dati).

## Cosa funziona
- Console senza errori né avvisi in tutte le prove (8 layout, 25 casi, interazioni, regressione).
- Nessuno scroll orizzontale della pagina a 1440, 1280, 390 e 360 px, in tema scuro e chiaro. Al telefono le tabelle larghe scorrono dentro il loro riquadro (`.tscroll`).
- Cambio di scenario e di unità: grafico, tooltip, intestazione e tabella «Rata per rata» cambiano insieme, e la scelta resta dopo un ricalcolo.
- Coerenza dei numeri: il capitale è uguale a titoli + liquidità (con 1 € di arrotondamento). La somma della lista d'acquisto è uguale al totale e al KPI «in titoli». Prima e ultima rata coincidono fra KPI, frase introduttiva, tabella e prova di stress. Gli scenari coperti coincidono con le righe «tutte pagate». La liquidità finale coincide fra frase, tabella e prova di stress. Il conteggio dei titoli indicizzati è giusto. Gli scenari «da coprire» risultano sempre pagati.
- Scarica CSV: il file `scala-affitto-AAAA-MM-GG.csv` ha BOM e separatore `;`. Copia ISIN e nominali copia righe nel formato ISIN, tabulazione, nominale. I comandi `IND`, `AFFITTO` e il tasto `6` aprono la scheda.
- Regressione: le schede 1–5 danno gli stessi KPI, pannelli e larghezze di `bfaa1a6` a 1440 e 390 px, senza errori.
- Correzioni arrivate con `b30aea4`: il primo anno nel passato ora dà un messaggio chiaro, e lo dà anche il capitale insufficiente in «Fino a quando».

## Rilievi

### Bloccanti
1. **I campi «Inflazione attesa» del 2028 e di «poi» sono illeggibili.** Succede a tutte le larghezze, in tutti e due i temi. Il campo del 2027 è largo 200 px, gli altri due sono schiacciati a 20–55 px e mostrano solo «2» invece di «2,10» e «2,30». Riproduzione: aprire `#/indicizzata` e guardare il pannello «Inflazione e scenari». Screenshot: `desk1440-dark-campo-inflazione.png`, `desk1440-light-campo-inflazione.png`, `tel360-dark-campo-inflazione.png`.
2. **Vincoli incompatibili o paniere vuoto non danno un messaggio: esce una «scala» fatta solo di liquidità.**
   - Riproduzione A: «Quota minima di indicizzati» 100 e poi «Tetto per l'Italia» 30. Riproduzione B: spegnere «Stati area euro» e «Sovranazionali».
   - Risultato: 376.236 € tutti in liquidità e 0 titoli. KPI «Quota indicizzata 0%» con un minimo chiesto del 100%. «Scenari coperti 5/5 tutti», nota «OK La scala regge in tutti gli 5 scenari». La lista d'acquisto è vuota.
   - Il messaggio «Nessuna combinazione di titoli rispetta tutti i vincoli…» (`infeasibleText`) in pratica non si vede mai, perché la sola liquidità soddisfa sempre i vincoli.
   - Screenshot: `f-incompatibili-min100-italia30.png`, `f-nessun-emittente.png`.
3. **«Salva la scala» non funziona nella scheda 6 (verificato leggendo il codice; senza accesso a Firebase non l'ho provato).**
   - `buildDoc` in `src/main.js:515-533` legge `p.bond.isin`, `plan.schedule` e `plan.summary`. Il piano indicizzato ha invece `p.b` e non ha né `schedule` né `summary`: dopo l'accesso il salvataggio si ferma con l'errore «Cannot read properties of undefined».
   - Il nome proposto sarebbe «Rendita NaN €/mese» (`main.js:542`).
   - Il pulsante resta visibile e porta all'accesso. Screenshot: `i-salva.png`.

### Da correggere
4. **Il calcolo va in timeout e restano i risultati vecchi senza avviso duraturo.** Riproduzione: «Tetto per singolo titolo» 1. Dopo 30 s compare per 3 s il toast «il calcolo richiedeva troppo tempo…», poi «con queste impostazioni il calcolo si blocca». La vista continua a mostrare la scala precedente (282.730 €) mentre il campo dice 1%. Screenshot: `i-tetto-titolo-1.png`.
5. **Il link condiviso dalla scheda 6 apre la scheda 1.** In `main.js:252` il reindirizzamento considera solo `income` e `capital`. Riproduzione: «Condividi il link» e poi aprire l'URL: si arriva su `#/capitale`. Screenshot: `i-link-condiviso.png`.
6. **€STR diverso fra impostazioni e calcolo.** Il campo mostra 2,40 (valore di ripiego fisso, perché `ctx.estr` non viene mai valorizzato in `settings.js:235`). Il calcolo usa invece 2,44% (dato BCE del 02/11/2026), come dice il pannello «Liquidità: XEON o BOT». Screenshot: `desk1440-dark-full.png`.
7. **Negli scenari scoperti il grafico mostra tutte le rate pagate.**
   - Esempio, scenario «FOI +0,5% su HICP»: i soldi finiscono al 2030, ma le colonne 2031–2046 sono piene.
   - Il tooltip del 2036 dice «Dalla liquidità 876 €» e insieme «Liquidità dopo la rata −815 €».
   - Manca la parte non pagata. Screenshot: `i-tooltip.png`.
8. **«Soldi finiti» descrive male un ammanco temporaneo.** Nello scenario «Basso 1%» l'esito è «soldi finiti al 2030», ma la «Liquidità finale» è 11.713 € e il «Capitale che manca» 441 €. È un buco di cassa di un anno, non la fine dei soldi. Meglio un'espressione come «manca liquidità nel 2030». Screenshot: `desk1440-dark-top.png`.
9. **Le righe di «Rata per rata» non tornano.** Liquidità precedente + rimborsi + cedole + bollo e tasse − affitto è sempre più basso del valore mostrato. Per esempio nel 2042 la differenza è 622 €, e nel caso «ultimo anno 2080» 10.654 € nel 2057. È l'interesse netto di XEON, che non compare in nessuna colonna. Serve una colonna «Interessi XEON» o una nota. Dati in `03-funzioni.json` (rilievi «riga …»).
10. **La nota «Gli indicizzati pesano poco: la scala costa meno nello scenario base… aggiungi «Alto»…» compare a sproposito.** Esce anche quando l'utente ha escluso gli indicizzati, quando non c'è nessun titolo o quando la scala costa di più (317.946 € contro 282.730 €), e suggerisce «Alto» che è già fra gli scenari coperti. Inoltre cita «Quota minima indicizzata», ma il campo si chiama «Quota minima di indicizzati». Screenshot: `f-senza-indicizzati.png`.
11. **Testi rimasti dalle schede 1–2.**
    - Nelle opzioni avanzate «Includi BTP Italia e BTP€i» spiega «non è confrontabile con gli altri»: qui, togliendo la spunta, si tolgono tutti gli indicizzati.
    - La guida («Cosa non è incluso») dice che BTP Italia e BTP€i «sono esclusi di default», ma nella scheda 6 sono inclusi.
    - «Ho minusvalenze da recuperare» non spiega se vale anche per gli indicizzati.
12. **Il confronto con la scala a importo fisso non dice chi regge meglio.** Con le impostazioni di default la scala fissa regge meglio della scala indicizzata in «Basso 1%» («basta» contro «soldi finiti al 2030») e in «FOI +0,5%» (fino al 2046 contro 2030). Nella frase «nello scenario base basta, con inflazione alta al 2043» manca il verbo.
13. **Termini per un non esperto.**
    - «Liquidità» ha due significati nella stessa schermata: XEON nei risultati, classe di volume nel filtro «Liquidità minima» e nel glossario.
    - «€ di oggi» non è spiegato: la prima rata appare 14.939 invece dei 15.000 scritti.
    - Il glossario non ha CI, FOI, HICP, €STR, XEON, BTP€i.
    - «Duration» nel glossario è quella modificata (sensibilità del prezzo ai tassi); qui è la durata media dei flussi.
    - La guida usa «programma lineare (solver HiGHS)».

### Minori
14. A 1280 px il sesto KPI («Scenari coperti») finisce da solo su una seconda riga. Screenshot: `desk1280-light-top.png`.
15. Arrotondamenti: «Quota indicizzata 95%» contro la composizione 81% + 15% = 96%. Il capitale differisce di 1 € dalla somma delle sue parti.
16. Forma dei testi:
    - «tutti gli 5 scenari»;
    - «0 indicizzati su 1 titoli»;
    - «dal 2027 al 2027… da 15.000 € a 15.000 €»;
    - «Affitto sostenibile 40 € · 0% di 15.000 €» con capitale 1000 € (dovrebbe dire che il capitale è troppo basso).
17. Nella lista d'acquisto le descrizioni STFI «BTP Italia … 0,65%(senza indicizzazione)» confondono proprio in questa scheda. Manca anche lo spazio prima della parentesi. Screenshot: `tel360-light-lista.png`.
18. Pannello «Liquidità: XEON o BOT»:
    - consiglia «un BOT», ma elenca OAT e Bund;
    - «FRANCIA 25/10/2027 2,75% 2,80%» mette due percentuali una dopo l'altra senza dire quale è la cedola.
19. Nomi diversi per lo stesso scenario: «FOI +0,5%» nel chip, «FOI +0,5% su HICP» nei risultati.
20. Al telefono i chip sono alti 23 px e i pulsanti degli anni 30×27. Sono misure del design system, uguali nelle altre schede. Screenshot: `tel390-dark-pannello-affitto.png`.
21. Codice: `loadSettings` (`state.js:86-92`) riallinea gli anni passati solo per capitale e rendita, non per `indexed`. Ora il motore dà un messaggio, ma l'anno salvato non si aggiorna da solo.
