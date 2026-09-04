# NEXT_STEPS.md

Aggiornato al 4 settembre 2026.

## Obiettivo

Portare l'attuale prototipo operativo a una piattaforma stabile, verificabile e gestibile quotidianamente senza introdurre regressioni nei flussi gia funzionanti.

## Priorita 0 - Supabase e stato dati

- Esportare schema e backup Supabase prima di nuovi backfill o cambi di stato massivi.
- Verificare che tutte le migrazioni `001`-`105` risultino applicate e nello stesso ordine in produzione.
- Allineare Supabase Auth Site URL e redirect URL al dominio canonico `aimago-prep-wms.vercel.app`.
- Eseguire una riconciliazione stock per tutti i clienti:
  - ricevuto;
  - spedito;
  - rettificato;
  - impegnato;
  - ubicato;
  - non ubicato;
  - disponibile ATP.
- Segnalare e correggere quantita negative, doppie prenotazioni e stock fisico senza collocazione.
- Verificare che il ricontrollo manuale processi anche ordini gia in eccezione e attesa refill.

## Priorita 1 - Test end-to-end dei flussi critici

Creare test automatici e una checklist manuale ripetibile per:

- login admin, staff, cliente e operatore;
- isolamento RLS tra due clienti diversi;
- import prodotti Shopify con stock zero;
- import ordini Shopify e CSV;
- controllo indirizzo e CAP;
- ordine con stock slot sufficiente;
- ordine con stock solo pallet, quindi refill;
- ordine senza stock, quindi eccezione;
- rientro automatico da eccezione dopo un ricevimento;
- HOLD, rilascio HOLD e annullamento;
- picking singolo, massivo e Galluse;
- assegnazione corretta alle bag;
- packing completo con scansione imballaggio;
- stampa/scansione etichetta e liberazione bag;
- conteggio costi ordine e fatturazione;
- rettifica ammanchi Amazon Prep;
- audit operatore su prelievi, conteggi e trasferimenti.

Una release non dovrebbe essere promossa se fallisce uno di questi percorsi.

## Priorita 1 - Rendere affidabile la logica stock

- Spostare il calcolo ATP e l'allocazione ordine in una RPC transazionale Supabase.
- Estendere l'atomicita gia applicata agli incrementi picking e al completamento packing anche a prenotazione, rilascio e completamento refill.
- Validare i nuovi vincoli sulle quantita storiche e aggiungere un vincolo esplicito contro saldi fisici negativi dopo la riconciliazione.
- Definire una fonte unica per il saldo fisico per referenza/ubicazione.
- Automatizzare il ricalcolo degli ordini interessati dopo entrate, rettifiche, conteggi e refill.
- Aggiungere una vista amministrativa di riconciliazione con differenze spiegate.
- Estendere il backfill di `wms_stock_placements` a tutti i clienti solo dopo un report di anteprima.

## Priorita 1 - Corrieri reali

- Scegliere il provider operativo definitivo: API dirette, ShippyPro o Sendcloud.
- Configurare credenziali e mittente esclusivamente come secret server-side.
- Mappare servizi GLS/BRT, supplementi, CAP disagiati, peso volumetrico e limiti.
- Salvare preventivo scelto e motivazione del cambio corriere.
- Bloccare il cambio quando il packing e iniziato.
- Generare etichette reali in ambiente test dei corrieri.
- Validare formato Zebra, tracking e webhook di aggiornamento stati.
- Gestire annullamento etichetta, ristampa autorizzata e fallimenti API senza completare erroneamente l'ordine.

## Priorita 1 - Packing Station e Zebra

- Preparare una procedura unica di installazione per Mac:
  - Zebra Browser Print;
  - driver ZD421;
  - stampante predefinita;
  - host accettato;
  - formato carta 15 x 10 cm;
  - test ZPL.
- Mostrare uno stato connessione affidabile con diagnostica dettagliata.
- Evitare che la UI dichiari la station collegata prima di una risposta reale.
- Verificare che una stampa produca una sola etichetta e nessuna pagina bianca.
- Conservare il fallback PDF/browser, ma non completare automaticamente il packing se la stampa fallisce.
- Aggiungere una coda locale di ristampa controllata per errori hardware, distinta dalla ristampa bag vietata.

## Priorita 2 - Modularizzare il frontend

- Dividere `frontend/src/lib/api.js` per domini:
  - auth/clienti;
  - catalogo/stock;
  - ordini/gate;
  - picking/packing;
  - pricing/corrieri;
  - Amazon Prep;
  - mappa/layout.
- Spostare le operazioni privilegiate e transazionali in RPC o Edge Functions.
- Introdurre lazy loading per Control Tower, app operativa, mappa Three.js e Amazon Prep.
- Ridurre il bundle principale e misurare tempo di caricamento su iPhone e PC packing.
- Risolvere il warning hook in `PreparazioneDetail.jsx`.
- Valutare la configurazione source map di ZXing senza nascondere warning utili.

## Priorita 2 - Esperienza operatore

- Terminare l'audit delle schermate per uso con una sola mano e senza scroll.
- Rendere ogni errore operativo azionabile: causa, posizione, quantita e passo successivo.
- Evitare azioni duplicate tra scanner universale, stock e inventario.
- Aggiungere feedback sonoro/vibrazione differenziato per successo, errore e quantita completata.
- Mantenere il focus automatico sul campo scanner dopo ogni passaggio.
- Verificare che apostrofi o caratteri trasformati dallo scanner vengano normalizzati senza ambiguita.
- Mostrare sempre foto, nome, ubicazione, quantita e bag nello stesso viewport del picking.

## Priorita 2 - Magazzino 3D e routing

- Validare il pathfinding con layout reali e casi di scaffali attaccati/sovrapposti.
- Impedire salvataggi con collisioni non intenzionali, mantenendo la calamita.
- Aggiungere undo/redo e confronto prima/dopo per spostamenti massivi.
- Ottimizzare salvataggi grandi con batch transazionali invece di limiti UI elevati.
- Mostrare chiaramente blocchi non mappati e stock escluso dalle rotte.
- Collegare il percorso suggerito al piano picking effettivo e al lato di prelievo.
- Testare una rotta nota con punti di controllo e distanza attesa.

## Priorita 2 - Portale cliente

- Rendere il dettaglio ordine la fonte principale per:
  - righe e quantita;
  - indirizzo;
  - stato e timeline;
  - corriere e preventivi;
  - imballaggio usato;
  - costi dettagliati;
  - tracking;
  - ticket collegati.
- Bloccare modifiche non consentite con una spiegazione chiara.
- Mostrare in fatturazione il totale progressivo fino all'ultimo ordine imballato, separato per spedizione, prima unita, unita extra, imballaggio e altri servizi.
- Aggiungere esportazione CSV/PDF riconciliabile con le singole righe ordine.

## Priorita 2 - Operatori e audit

- Completare la pagina operatori con attivazione, disattivazione e reset credenziali.
- Creare un registro consultabile per operatore, intervallo, azione, ordine, SKU e ubicazione.
- Registrare login station, avvio/fine picking, conteggi, trasferimenti, refill, packing e anomalie.
- Aggiungere KPI produttivita senza permettere la modifica degli eventi storici.
- Definire conservazione e accesso ai log nel rispetto della privacy.

## Priorita 3 - Sicurezza e manutenzione

- Revisionare le 34 vulnerabilita npm una dipendenza alla volta, con build e regressione dopo ogni gruppo.
- Aggiungere lint e controlli CI per build, migrazioni, segreti e TypeScript/PropTypes dove utile.
- Verificare che nessuna service role o credenziale sia finita nella cronologia Git.
- Aggiungere rate limiting e audit alle Edge Functions amministrative.
- Definire backup, restore e disaster recovery Supabase.
- Aggiornare o archiviare i documenti storici che descrivono FastAPI/Mongo come backend attivo.
- Introdurre monitoraggio errori frontend/Edge Function e alert su fallimenti di stampa, import e carrier API.

## Priorita 3 - Integrazioni e automazioni

- Rendere Shopify incrementale con webhook idempotenti per prodotti, ordini, annullamenti e modifiche.
- Gestire mapping SKU/EAN mancanti prima che un ordine entri nel gate.
- Aggiungere report import con righe accettate, scartate e motivazione.
- Collegare tracking reale agli stati spedito, consegnato, giacenza ed eccezioni.
- Definire workflow resi con ricezione, controllo, reintegro o scarto.
- Implementare bundle e distinta materiali con disponibilita calcolata correttamente.

## Criteri per una release stabile

La release puo essere considerata stabile quando:

- schema e migrazioni sono allineati tra repository e produzione;
- riconciliazione stock non presenta differenze inspiegate;
- RLS impedisce accessi incrociati tra clienti;
- tutti i flussi critici hanno test automatici e prova manuale documentata;
- una intera giornata di picking/packing pilota non richiede correzioni dirette al database;
- Zebra stampa una sola etichetta per evento e gestisce chiaramente i guasti;
- preventivi ed etichette corriere sono verificati con account reali;
- costi ordine e fatturazione sono riconciliabili riga per riga;
- errori applicativi sono monitorati e attribuibili a ordine, operatore e azione;
- esiste un backup verificato con prova di ripristino.

## Ordine consigliato di esecuzione

1. Backup e verifica schema Supabase.
2. Verifica allineamento migrazioni `001`-`105`.
3. Verifica redirect/Auth Supabase.
4. Riconciliazione stock multi-cliente.
5. Test end-to-end dei flussi critici.
6. Completamento delle operazioni stock tramite RPC transazionali; picking e chiusura packing sono gia stati consolidati nella `101`.
7. Stabilizzazione Zebra/Packing Station.
8. Integrazione corrieri reali.
9. Dettaglio costi e fatturazione riconciliabile.
10. Modularizzazione, routing 3D, audit operatori e automazioni avanzate.
