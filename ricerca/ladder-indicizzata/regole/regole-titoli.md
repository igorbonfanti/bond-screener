# Regole dei titoli di Stato indicizzati per il modello a scenari d'inflazione

Ricerca del 3 novembre 2026, basata su fonti ufficiali: MEF – Dipartimento del Tesoro (dt.mef.gov.it) e Agenzia delle Entrate. I dati numerici vengono dai file MEF "Coefficienti di indicizzazione" di **novembre 2026**. Le formule sono riportate come nei decreti. Quello che le fonti non chiariscono è segnato **DA VERIFICARE**.

Versione per il codice: `titoli-indicizzati.json`, nella stessa cartella.

---

## 1. BTP€i (indice IAPC/HICP area euro, tabacco escluso)

### 1.1 Regole comuni (decreto di massima 19.12.2022 coordinato, artt. 16‑19; scheda MEF BTP€i)

| Elemento | Regola |
|---|---|
| Indice | IAPC (HICP) area euro tabacco escluso, pubblicato da Eurostat. Dal 1/3/2026 si usa la **base 2025=100**. |
| Inflazione di riferimento | `IR(d,m) = IE(m-3) + (d-1)/gg(m) · [IE(m-2) − IE(m-3)]`. Il valore si tronca alla 6ª cifra decimale e si arrotonda alla 5ª. Lag di 3 mesi con interpolazione giornaliera. |
| Coefficiente di indicizzazione | `CI(d) = IR(d) / IR(data di godimento)`. Si tronca alla 6ª cifra e si arrotonda alla 5ª. Il CI è **cumulativo dal godimento** e uguale per tutte le tranche. |
| Cedola | Semestrale posticipata: `cedola = (tasso reale/2) · 1000 · CI(data cedola)` per ogni taglio da 1.000 €. **Nessun floor sulle cedole.** Il decreto di massima, art. 18, precisa che anche l'ultima cedola usa il CI effettivo quando è < 1. |
| Rimborso | `100 · CI(scadenza)`. Se CI(scadenza) < 1 si rimborsa 100. Il **floor a 100 riguarda solo il capitale a scadenza** e si applica al CI cumulato dal godimento, non al prezzo pagato da chi compra sul secondario. |
| Rateo | `AC% · nominale · CI(regolamento)`, base giorni effettivi/effettivi. |
| Prezzo | Si quota in termini reali. Il controvalore è `prezzo reale · CI(regolamento)` più il rateo indicizzato. |
| Revisioni e indice mancante | Revisioni: si usa sempre l'indice della **prima pubblicazione**. Indice mancante: `IS = IE(m-1)·(IE(m-1)/IE(m-13))^(1/12)`, senza rettifiche successive. |
| Cambio base 2015→2025 | `IR_godimento(2025) = IR_godimento(2015) · CRB`, con `CRB = IE_dic2025(base 2025)/IE_dic2025(base 2015)` (il valore in base 2015 era 128,89). I valori riportati sotto sono **già ribasati**. |
| Lotto minimo | 1.000 € (anche sul MOT). |
| Premi fedeltà | **Nessuno.** |

### 1.2 Dati per titolo

IR base = Inflazione di Riferimento al godimento, in base 2025=100, presa dai file MEF di novembre 2026. CI 1/11/26 = coefficiente pubblicato dal MEF per quella data.

| ISIN | Scadenza | Cedola reale | Mesi di stacco | Godimento | IR base (2025=100) | CI 1/11/26 |
|---|---|---|---|---|---|---|
| IT0003745541 | 15/09/2035 | 2,35% | 15 mar / 15 set | 15/09/2004 | 65,42310 | 1,58446 |
| IT0004545890 | 15/09/2041 | 2,55% | 15 mar / 15 set ¹ | 15/09/2009 | 71,98379 | 1,44005 |
| IT0005138828 | 15/09/2032 | 1,25% | 15 mar / 15 set | 15/09/2015 | 78,29443 | 1,32398 |
| IT0005246134 | 15/05/2028 | 1,30% | 15 mag / 15 nov ¹ | 15/11/2016 | 78,31380 | 1,32365 |
| IT0005387052 | 15/05/2030 | 0,40% | 15 mag / 15 nov ¹ | 15/05/2019 | 80,81051 | 1,28275 |
| IT0005436701 | 15/05/2051 | 0,15% | 15 mag / 15 nov ¹ | 15/11/2020 | 81,56521 | 1,27088 |
| IT0005482994 | 15/05/2033 | 0,10% | 15 mag / 15 nov ¹ | 15/11/2021 | 84,13387 | 1,23208 |
| IT0005543803 | 15/05/2029 | 1,50% | 15 mag / 15 nov ¹ | 26/04/2023 | 94,27683 | 1,09953 |
| IT0005547812 | 15/05/2039 | 2,40% | 15 mag / 15 nov | 15/05/2023 | 94,77800 | 1,09371 |
| IT0005588881 | 15/05/2036 | 1,80% | 15 mag / 15 nov | 15/11/2023 | 96,67324 | 1,07227 |
| IT0005647273 | 15/05/2056 | 2,55% | 15 mag / 15 nov | 15/11/2024 | 98,44725 | 1,05295 |
| IT0005657348 | 15/08/2031 | 1,10% | 15 feb / 15 ago | 27/06/2025 | 99,96420 | 1,03697 |
| IT0005706293 | 15/02/2046 | 2,25% | 15 feb / 15 ago | 15/02/2026 | 100,52804 | 1,03116 |
| IT0005725160 | 15/02/2037 | 2,00% | 15 feb / 15 ago | 30/07/2026 | 103,09484 | 1,00548 |

¹ Mesi di stacco ricavati dalla convenzione: cedole nel giorno/mese della scadenza e sei mesi prima. Per questi titoli non ho trovato un comunicato 2026 che li confermi: **DA VERIFICARE** sul decreto di emissione. Gli altri mesi sono confermati dai comunicati MEF di emissione del 2026. Per il 2037 la prima cedola è stata corta (15/08/2026, 16 giorni); il 2046 e il 2031 sono partiti con la prima cedola il 15/08.

Floor del capitale: **sì** per tutti, `max(CI,1)` solo a scadenza. Con i CI attuali, tra 1,005 e 1,58, il floor conta in pratica solo per il 2037 e il 2046, e solo in scenari di deflazione cumulata.

---

## 2. BTP Italia (indice FOI senza tabacchi, ISTAT)

### 2.1 Regole comuni alle 5 emissioni classiche (2027, 2030, 2028‑nov, 2028‑mar, 2032)

Ho confrontato il testo degli Information Memorandum (IM) di tutte e cinque le emissioni: **la definizione è la stessa**.

| Elemento | Regola (dagli IM) |
|---|---|
| Numero indice giornaliero | `NI(d,m) = FOI(m-3) + (d-1)/gg(m) · [FOI(m-2) − FOI(m-3)]`. Si tronca alla 6ª cifra e si arrotonda alla 5ª. Lag di 3 mesi, come per il BTP€i. |
| CI semestrale | `CI_t = NI(data cedola t) / NIbase_t`, troncato alla 6ª e arrotondato alla 5ª. |
| Base | Prima cedola: NI alla data di regolamento. Cedole successive: **il maggiore tra NI alla data della cedola precedente e il più alto dei NI alle date cedola precedenti e al regolamento**, cioè il massimo storico. |
| Cedola | `cedola_t = tasso reale/2 · 1000 · max(CI_t, 1)` (floor sulla cedola). |
| Rivalutazione del capitale | `riv_t = 1000 · max(CI_t − 1, 0)`, **pagata ogni sei mesi** insieme alla cedola (floor sul capitale). |
| Arrotondamenti | Calcolo con almeno 10 decimali per taglio da 1.000 €, poi arrotondamento al centesimo. |
| Inflazione negativa | Nel semestre non si paga rivalutazione e non c'è addebito; la cedola usa il nominale non rivalutato. **La deflazione non si recupera:** la rivalutazione riprende solo quando l'indice supera il massimo precedente. Questo protegge l'emittente da un doppio pagamento; l'investitore non ottiene alcun "recupero" a proprio favore. |
| Rimborso | 100, valore nominale non rivalutato, perché la rivalutazione è già stata pagata ogni semestre. |
| Secondario | Il CI e i ratei del mercato secondario **non** applicano il floor. Il controvalore è `prezzo reale · CI(regolamento)` più i dietimi rivalutati. Rateo della rivalutazione: `RRC = nominale · Pr/100 · (CI − 1)`. |
| Revisioni e indice mancante | Come per il BTP€i (prima pubblicazione; `NIS = NI(m-1)·(NI(m-1)/NI(m-13))^(1/12)`). |
| Cambio base 2015→2025 | `NIbase(2025) = NIbase(2015) / CR_Istat`; i CI in base 2025 si applicano dal 1/3/2026. |
| Lotto minimo | 1.000 €. |
| "Tasso minimo garantito" | È solo il tasso reale minimo annunciato prima del collocamento: il tasso definitivo non può essere più basso. **Non è una cedola minima aggiuntiva.** La garanzia effettiva è `max(CI,1)`, cioè almeno il tasso reale sul nominale. |
| Premi | Spettano **solo** a chi ha comprato all'emissione, nella Prima Fase, con l'ISIN "speciale", e ha tenuto il titolo senza interruzioni. Se il titolo viene venduto, l'ISIN speciale è sostituito da quello di mercato. **Chi compra sul secondario non ha diritto al premio** (confermato dalle FAQ MEF e dalla Nota operatori 2025). |

**Vecchie e nuove emissioni.** Fra le cinque emissioni in esame (2019‑2025) **non cambia** la regola di indicizzazione e del floor. Cambiano solo il premio, la struttura del collocamento e il tasso:

| ISIN di mercato (ISIN premio) | Emiss. | Scadenza | Tasso reale | Mesi di stacco | Godimento | NI base del semestre corrente (2025=100) | Premio (solo emissione) |
|---|---|---|---|---|---|---|---|
| IT0005388175 (IT0005388167) | 15ª | 28/10/2027 | 0,65% | 28 apr / 28 ott | 28/10/2019 | 103,62258 (dal 28/10/2026 al 28/04/2027) | 0,4% finale |
| IT0005497000 (IT0005496994) | 17ª | 28/06/2030 | 1,60% | 28 giu / 28 dic | 28/06/2022 | 102,40000 (dal 28/06/2026 al 28/12/2026) | 0,4% intermedio, pagato il 28/06/2026, + 0,6% finale |
| IT0005517195 (IT0005517187) | 18ª | 22/11/2028 | 1,60% | 22 mag / 22 nov | 22/11/2022 | 104,12000 (dal 22/11/2026 al 22/05/2027). Il CI del 22/11/2026 per il pagamento è 1,02777, sulla base 101,30645 | 0,8% finale |
| IT0005532723 (IT0005532715) | 19ª | 14/03/2028 | 2,00% | 14 mar / 14 set | 14/03/2023 | 102,93000 (dal 14/09/2026 al 14/03/2027) | 0,8% finale |
| IT0005648255 (IT0005648248) | 20ª | 04/06/2032 | 1,85% | 4 giu / 4 dic | 04/06/2025 | 101,60000 (dal 04/06/2026 al 04/12/2026) | 1% finale extra |

NI di regolamento originario (in base 2010 o 2015) e massimo storico: non compaiono nei file correnti. Per un modello che parte dalla base del semestre corrente non servono. In uno scenario di deflazione la base successiva sarà `max(NI corrente, base corrente)`. Se servono i valori storici, vanno ricavati dall'archivio dei coefficienti MEF (**DA RICAVARE**).

### 2.2 BTP Italia Sì: IT0005713547 (ISIN di mercato; ISIN con premio IT0005713539)

Fonti: decreto di emissione del 12/06/2026, art. 4; decreto di accertamento; comunicato sui risultati.

| Elemento | Regola |
|---|---|
| Godimento / scadenza | 23/06/2026 – 23/06/2031. Cedole il 23 giugno e il 23 dicembre, la prima il 23/12/2026. |
| Tasso fisso definitivo | **1,60%** annuo, cioè 0,80% a semestre, garantito anche in deflazione. |
| Cedola | `cedola_t = 1000 · [1,60%/2 + max(0; NI(t)/NI(t-1) − 1)]` per taglio da 1.000 €. Il **capitale nominale non si rivaluta**: entrambe le componenti si applicano al nominale sottoscritto. |
| Base | NI(t-1) è l'indice alla data della cedola **immediatamente precedente** (per la prima cedola, il regolamento). **Non c'è la regola del massimo:** dopo un semestre di deflazione, che paga 0 sulla componente inflazione, il semestre seguente misura l'inflazione dal livello più basso. In pratica l'eventuale risalita viene pagata. |
| Floor | Componente inflazione ≥ 0, anche nel rateo del secondario. |
| NI al regolamento | **102,23333** (comunicato MEF sui risultati). La base non è indicata, ma con regolamento a giugno 2026 si tratta della base 2025=100 (dedotto). |
| Rimborso | 100. |
| Premio | 0,6% finale, solo con l'ISIN IT0005713539 tenuto fino a scadenza; **non spetta** a chi detiene IT0005713547 comprato sul secondario. |
| Lotto minimo | 1.000 €. |

---

## 3. Fisco (persona fisica residente, regime amministrato)

| Voce | Cosa dicono le fonti | Grado di certezza |
|---|---|---|
| Aliquota sui titoli di Stato | Interessi, premi e altri proventi sono redditi di capitale con imposta sostitutiva al **12,5%**, secondo il D.Lgs. 239/1996, richiamato nei decreti e negli IM. Dal 2026‑27 la norma è trasfusa nel D.Lgs. 33/2025 (Testo unico versamenti e riscossione): l'IM 2032 indica il 1/1/2026, l'IM Italia Sì il 1/1/2027, **DA VERIFICARE**. | Certo |
| Cedole BTP€i | Cedola indicizzata tassata al 12,5% quando viene pagata. Alla cessione, il rateo cedolare maturato è tassato al cedente (D.Lgs. 239/1996, art. 2, c. 1‑bis). | Certo |
| **Rivalutazione del capitale dei BTP€i: quando si tassa** | **Non si tassa ogni anno.** La "Nota esplicativa sul trattamento del BTP indicizzato all'inflazione" del MEF, citata testualmente dall'AdE nella Risposta n. 67/2022, dice che il prelievo del D.Lgs. 239 "non può che applicarsi a partire dal momento in cui detto incremento diviene conoscibile e cioè … (in prossimità della scadenza ma prima della stessa)". Fino a quel momento l'incremento prezzato dal mercato "determinerebbe soltanto un guadagno (o una perdita) in linea capitale", cioè redditi diversi, per chi vende. **Conseguenza:** chi vende prima della scadenza realizza una plusvalenza o minusvalenza (redditi diversi) sul controvalore indicizzato. Chi tiene il titolo a scadenza paga il 12,5% sul provento di rimborso. | Principio **certo** (fonte AdE/MEF). Non ho trovato il testo della Nota MEF: il contenuto è riportato da AdE. |
| Provento a scadenza del BTP€i (base imponibile) | Il D.Lgs. 239 tassa "ogni differenza tra il prezzo di emissione e quello di rimborso". In caso di riapertura conta il prezzo di aggiudicazione **della prima tranche** (D.Lgs. 239, art. 11 c. 2, e decreto di massima art. 4). Lettura: provento = 100·max(CI_T,1) − prezzo di emissione della prima tranche. Il cliente che ha comprato sul secondario a un CI alto paga quindi il 12,5% su tutta la rivalutazione dal godimento. La differenza fra il costo d'acquisto e il valore di rimborso al netto del provento diventa una **minusvalenza** (redditi diversi), che si compensa solo con plusvalenze future di natura finanziaria nei 4 anni successivi, nel 48,08% se nasce da titoli di Stato, e **non** con redditi di capitale come i guadagni su ETF. | **DA VERIFICARE**: se il prezzo di emissione rilevante sia reale o moltiplicato per il CI di regolamento della prima tranche, e come gli intermediari trattano il secondario e la finestra "in prossimità della scadenza". Va trattato come rischio fiscale dello scenario "tenuto a scadenza". |
| BTP Italia: rivalutazione semestrale | Il decreto di emissione, art. 5, applica il D.Lgs. 239 al "pagamento degli interessi, del premio, dell'importo di rivalutazione del capitale e del rimborso". La rivalutazione è un provento tassato al **12,5% quando viene pagata**, ogni sei mesi. | Certo (per il trattamento all'incasso). Per il rateo di rivalutazione alla cessione: **DA VERIFICARE**, perché il CI con floor e massimo non è certo prima della data cedola; per analogia con la Risposta 67/2022 potrebbe ricadere nella plus/minusvalenza. |
| BTP Italia Sì | Cedola (fissa più inflazione) e premio al 12,5% (decreto, art. 5). Non c'è rivalutazione del capitale. | Certo |
| Disaggio di emissione | BTP Italia e Italia Sì sono emessi a 100: nessun disaggio. BTP€i: vedi la riga sul provento a scadenza (si usa la prima tranche). | Come sopra |
| Plusvalenza sul secondario degli indicizzati | Redditi diversi (art. 67 c. 1 lett. c‑ter TUIR): differenza fra corrispettivo e costo (art. 68 c. 6 TUIR). Corrispettivo e costo sono i **controvalori indicizzati** (prezzo reale × CI), senza i ratei, che sono redditi di capitale. Aliquota 26% su una base del **48,08%**, cioè un effettivo 12,5%. Le minusvalenze valgono anch'esse al 48,08%. | Struttura certa (IM, sezione "Regime fiscale delle plusvalenze"). Lo scorporo esatto della componente di inflazione che si calcola l'intermediario: **DA VERIFICARE**. |
| Imposta di bollo | **0,2% annuo** sul valore di mercato dei prodotti finanziari a fine periodo; si usa il nominale o il valore di rimborso se manca il valore di mercato. Per le persone fisiche non c'è tetto. Norma: art. 13 c. 2‑ter, Tariffa DPR 642/1972 (Circ. AdE 48/E/2012), oggi trasfuso nel D.Lgs. 123/2025 (All. 3, Tariffa, art. 9 c. 4). | Aliquota e base certe. Il riferimento al D.Lgs. 123/2025 viene da una fonte secondaria: **DA VERIFICARE**. Per gli indicizzati si presume che il "valore di mercato" sia il controvalore indicizzato: **DA VERIFICARE** con l'intermediario. |
| ETF monetario armonizzato (es. XEON, UCITS lussemburghese a replica swap sull'€STR) | I proventi, compresa la differenza positiva fra valore di cessione o rimborso e costo, sono **redditi di capitale** (art. 44 c. 1 lett. g TUIR; Circ. AdE 33/E/2011, §3), con ritenuta del **26%**. Le perdite sono **redditi diversi** (minusvalenze: art. 67 c‑ter e art. 68 TUIR; Circ. 33/E §3.2.2). Ne segue che **un guadagno sull'ETF non si può compensare** con minusvalenze pregresse, comprese quelle create dai BTP€i a scadenza. Una perdita sull'ETF invece è compensabile con plusvalenze future. | Certo per il principio (Circ. 33/E). Restano **DA VERIFICARE**: la quota di proventi tassata al 12,5% per titoli di Stato e white list, che per un ETF sintetico dipende dal paniere ed è probabilmente trascurabile; ISIN e caratteristiche di XEON sul KID; l'eventuale riforma dei redditi finanziari prevista dalla legge delega 111/2023, il cui stato di attuazione non ho controllato. |

---

## 4. Fonti

MEF – Dipartimento del Tesoro
- Scheda BTP€i: https://www.dt.mef.gov.it/it/debito_pubblico/titoli_di_stato/quali_sono_titoli/btpei/
- Scheda BTP Italia: https://www.dt.mef.gov.it/it/debito_pubblico/titoli_di_stato/quali_sono_titoli/btp_italia/
- Decreto di massima coordinato (artt. 4, 16‑19): https://www.dt.mef.gov.it/modules/documenti_it/debito_pubblico/normativa_spalla_destra/Testo-coordinato-del-Decreto-di-massima-per-le-aste-dei-Titoli-di-Stato-del-19.12.2022-n.-0101633-e-s.m.i.pdf
- Coefficienti BTP€i, indice delle pagine per titolo e note sul ribasamento: https://www.dt.mef.gov.it/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btpei/
- Nota sul ribasamento IAPC 2025=100: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/coefficienti_indicizzazione/BTPi-Nota-sul-ribasamento-dellIndice-IAPC-2025100.pdf
- Comunicazioni di emissione BTP€i del 2026 (date cedola): https://www.dt.mef.gov.it/it/debito_pubblico/emissioni_titoli_di_stato_interni/comunicazioni_emissioni_ctz_e_btpei/
- Coefficienti BTP Italia (pagine per titolo): https://www.dt.mef.gov.it/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btp_italia/
- Nota sul ribasamento FOI 2025=100: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/coefficienti_indicizzazione/BTP-Italia-Nota-sul-ribasamento-dellIndice-FOI-2025100.pdf
- Information Memorandum BTP Italia: https://www.dt.mef.gov.it/it/debito_pubblico/normativa/doc_legale_btp_italia/information_memorandum.html
  - 2027: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/btp_italia/Information_Memorandum_BTP_Italia_28.10.2027.pdf
  - 2030: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/btp_italia/Information-Memorandum-BTP-Italia-28.06.2030-17.pdf
  - 2028 novembre: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/btp_italia/Information-Memorandum-BTP-Italia-22.11.2028-18.pdf
  - 2028 marzo: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/btp_italia/Information-Memorandum-BTP-Italia-14.03.2028-19.pdf
  - 2032: https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/btp_italia/Information-Memorandum-BTP-Italia-04.06.2032-20.pdf
- Decreti di emissione e di accertamento BTP Italia (tassi definitivi; art. 5 sul regime fiscale): https://www.dt.mef.gov.it/it/debito_pubblico/normativa/doc_legale_btp_italia/decreti_di_emissione.html e https://www.dt.mef.gov.it/it/debito_pubblico/normativa/doc_legale_btp_italia/decreti_di_accertamento.html
- Scheda informativa, Nota operatori e FAQ BTP Italia 2032 (premi, lotto, ISIN speciale): https://www.dt.mef.gov.it/it/debito_pubblico/emissioni_retail/btp_italia/comunicazioni_emissioni_btp_italia/
- BTP Italia Sì: decreto di emissione https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/normativa_spalla_destra/Decreto-di-emissione-BTP-Italia-Si-23.06.2031-1.pdf ; decreto di accertamento https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/normativa_spalla_destra/Decreto-di-Accertamento-BTP-Italia-Si-23.06.2031-1.pdf ; risultati (NI al regolamento, ISIN) https://www.dt.mef.gov.it/export/sites/sitodt/modules/documenti_it/debito_pubblico/risultati_aste/risultati_aste_btp_italia_si/BTP-Italia-Si-23.06.2031-1-Risultati-collocamento.pdf ; documenti https://www.dt.mef.gov.it/it/debito_pubblico/emissioni_retail/btp_italia_si/comunicazioni_btp_italia_si/

Agenzia delle Entrate e normativa
- Risposta a interpello n. 67/2022, che cita la Nota MEF sul BTP indicizzato: https://www.agenziaentrate.gov.it/portale/documents/20143/4169782/Risposta_67_03.02.2022.pdf/24f08069-072f-3c2f-130f-5991c1be53c6
- Circolare 33/E del 15/07/2011 (OICR: redditi di capitale e redditi diversi): https://agenziaentrate.gov.it/portale/documents/20143/299856/Circolare+33+del+15+07+2011_circ33e+del+15072011_2.pdf/f4459aed-cb83-6c2c-e312-fba44624ad26
- Circolare 48/E del 21/12/2012 (imposta di bollo 2‑ter), copia: https://www.dirittobancario.it/wp-content/uploads/sites/default/files/allegati/circolare_agenzia_delle_entrate_21_dicembre_2012_n._48_e.pdf (**DA VERIFICARE** sull'originale AdE)
- D.Lgs. 239/1996, D.Lgs. 461/1997 (artt. 5‑7) e TUIR artt. 44, 67, 68: citati negli IM e nei decreti MEF sopra.

## 5. Punti aperti (DA VERIFICARE)
1. Mesi di stacco dei BTP€i segnati con ¹ (convenzione non confermata da un comunicato).
2. Base imponibile del provento a scadenza dei BTP€i per chi compra sul secondario (prezzo della prima tranche: reale o indicizzato) e minusvalenza che ne nasce. Chiedere conferma all'intermediario o all'AdE.
3. Tassazione del rateo di rivalutazione dei BTP Italia quando il titolo si vende fra due cedole.
4. Valore usato per il bollo sugli indicizzati (si presume il controvalore indicizzato).
5. XEON: ISIN e KID, quota di proventi al 12,5%, stato della riforma dei redditi finanziari (legge 111/2023).
6. NI di regolamento originari e massimi storici dei BTP Italia (archivio coefficienti MEF), se servono per backtest.
