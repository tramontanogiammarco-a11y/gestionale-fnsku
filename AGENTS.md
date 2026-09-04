# AGENTS.md

## Scopo

Questo file contiene le regole operative per chi modifica il progetto Aimago Logistics / Aimago Prep WMS. Vale per tutto il repository, salvo un eventuale `AGENTS.md` piu specifico in una sottocartella.

Prima di intervenire leggere anche:

- `PROJECT_STATUS.md` per lo stato reale dell'applicazione e dell'infrastruttura.
- `NEXT_STEPS.md` per priorita e lavoro ancora da fare.

In caso di conflitto con documenti storici in `docs/`, questo file e `PROJECT_STATUS.md` descrivono l'architettura corrente. Alcuni documenti precedenti citano ancora FastAPI, MongoDB, Axios o cookie auth e non sono piu la fonte principale.

## Prodotto

Il repository ospita una piattaforma logistica multi-tenant composta da:

- Control Tower web per amministratori Aimago e clienti e-commerce.
- App operativa mobile scanner-first per operatori di magazzino.
- Packing Station desktop, pensata per scanner USB e Zebra.
- Modulo Amazon Prep per entrate, preparazioni e composizione box.
- Magazzino 3D con layout fisico, blocchi, ubicazioni e rotte di picking.

L'applicazione pubblica canonica e `https://aimago-prep-wms.vercel.app`.

## Stack attivo

- Frontend: React 19, Create React App e CRACO.
- Routing: React Router 7.
- UI: Tailwind CSS, Radix/shadcn, Lucide, Phosphor e Framer Motion.
- Backend attivo: Supabase Postgres, Auth, Storage, RLS, RPC ed Edge Functions.
- Magazzino 3D: Three.js.
- Barcode e QR: ZXing.
- CSV: PapaParse.
- Stampa diretta: Zebra Browser Print, con fallback stampa browser/PDF.
- Hosting frontend: Vercel.

La cartella `backend/` contiene codice FastAPI/Mongo storico o di riferimento. Non introdurre nuove dipendenze da quel backend senza una decisione architetturale esplicita.

## Struttura principale

- `frontend/src/App.js`: routing e protezione delle aree.
- `frontend/src/context/AuthContext.jsx`: sessione Supabase e profilo applicativo.
- `frontend/src/lib/api.js`: adapter Supabase e logica applicativa compatibile con le vecchie chiamate API.
- `frontend/src/lib/zebraPrinter.js`: collegamento Zebra Browser Print.
- `frontend/src/lib/printStation.js`: collegamento app mobile / Packing Station.
- `frontend/src/pages/control/`: Control Tower.
- `frontend/src/pages/wms/`: app operativa e Packing Station.
- `frontend/src/pages/admin/`: Amazon Prep amministrativo.
- `frontend/src/pages/client/`: Amazon Prep cliente.
- `supabase/migrations/`: schema e cambiamenti dati versionati.
- `supabase/functions/`: Edge Functions server-side.
- `docs/`: documentazione storica e di supporto.

## Comandi

Eseguire dal repository indicato sopra, salvo dove specificato:

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
npm run build
```

Per Supabase e Vercel usare i progetti gia collegati. Prima di un push database o deploy verificare sempre il progetto di destinazione.

## Regole di modifica

- Leggere il codice circostante e riusare pattern, componenti e helper esistenti.
- Limitare ogni modifica al comportamento richiesto; niente refactor laterali non necessari.
- Usare API strutturate e RPC per dati complessi, non manipolazioni testuali fragili.
- Aggiungere una migrazione nuova; non riscrivere migrazioni gia applicate in produzione.
- Mantenere retrocompatibili i dati storici quando si aggiungono campi o stati.
- Non cancellare o ripristinare modifiche presenti nel worktree che non appartengono al proprio intervento.
- Non includere segreti, token, password o chiavi nei file versionati, nei log o nella documentazione.
- Le password non sono leggibili: implementare reset o credenziali temporanee, mai visualizzazione delle password degli utenti.

## Autenticazione e permessi

I ruoli applicativi validi sono `admin`, `staff` e `cliente`. Un profilo puo inoltre essere un operatore tramite `is_operator` e `operator_active`.

- `admin`: accesso globale e gestione clienti/operatori.
- `staff`: operazioni Aimago consentite, senza tutte le funzioni amministrative.
- `cliente`: vede solo il proprio `cliente_id`.
- `operator`: usa soltanto `/wms-app` e `/packing-station`; un operatore disattivato deve essere espulso.

Regole inderogabili:

- Non affidarsi soltanto ai controlli React: RLS, RPC ed Edge Functions devono proteggere i dati.
- Ogni query cliente deve essere isolata tramite `cliente_id`.
- La service role Supabase deve esistere solo lato server/Edge Function.
- Nel frontend sono ammesse soltanto URL Supabase e anon/publishable key.
- Ogni nuova tabella multi-tenant deve avere RLS, policy e indici coerenti.

## Invarianti ordini

Gli stati WMS correnti comprendono:

`in_verifica`, `eccezione`, `in_attesa_refill`, `da_preparare`, `hold`, `in_preparazione`, `in_attesa_packing`, `in_packing`, `imballato`, `spedito`, `annullato`.

Il gate ordini comprende almeno:

`da_verificare`, `verifica_indirizzo`, `eccezione_indirizzo`, `verifica_stock`, `eccezione_stock`, `attesa_refill`, `sbloccato`, `hold_cliente`, `ignorato`.

Non rompere queste regole:

- Un ordine entra in verifica, poi passa al controllo indirizzo e disponibilita.
- Se l'ATP negli slot basta, l'ordine puo diventare preparabile.
- Se lo stock totale basta ma gli slot non bastano, l'ordine va in attesa refill.
- Se lo stock totale non basta, l'ordine va in eccezione stock.
- Il cliente puo modificare o mettere in HOLD l'ordine solo prima dell'avvio picking.
- Picking avviato, packing e spedizione bloccano le modifiche incompatibili.
- Una verifica manuale deve poter rivalutare anche ordini gia in `eccezione_stock`, non solo quelli pendenti.
- Ogni transizione importante deve essere tracciabile negli eventi operativi/gate.

## Invarianti stock

Distinguere sempre:

- stock fisico lordo;
- stock impegnato/prenotato;
- stock disponibile ATP;
- stock ubicato;
- stock storico non ancora ubicato.

Non mostrare o usare la quantita fisica di uno slot come se fosse automaticamente ATP libero. Le prenotazioni di task attivi e precedenti devono essere considerate prima di sbloccare nuovi ordini.

I movimenti tra pallet e slot devono:

- conservare la quantita totale;
- registrare origine, destinazione, quantita, operatore e data;
- non creare stock dal nulla;
- non rendere negativo lo stock sorgente;
- aggiornare il piano refill e la disponibilita degli ordini interessati.

La rimozione di un blocco dalla mappa 3D e solo visiva/di routing: non deve eliminare ubicazioni, prodotti o movimenti. Se esiste stock in ubicazioni non mappate, l'interfaccia deve segnalarlo.

## Ubicazioni e mappa

- I codici scanner degli slot iniziano con `S`.
- I codici scanner dei pallet iniziano con `P`.
- Il testo leggibile rappresenta blocco, livello e posizione; QR e barcode devono codificare lo stesso identificativo.
- Griglia fisica: 18 x 60 metri, celle da 10 cm.
- Blocco slot: 160 x 50 cm.
- Portapallet: 270 x 120 cm e visivamente piu alto degli slot.
- Magnetismo: entro 20 cm deve allineare correttamente sia l'asse X sia l'asse Z.
- Il routing deve usare gli spazi liberi e gli ostacoli reali; blocchi attaccati non lasciano passaggio.
- Le coordinate manuali devono accettare valori digitati e incrementi da 0,01 m.

## Picking, carrelli e bag

- Il picking deve essere scanner-first e compatto, soprattutto su mobile.
- Il metodo Galluse deve indicare immediatamente in quale bag inserire ogni quantita.
- I comandi rapidi `+1`, `+5`, `+10` completano automaticamente la riga quando raggiungono la quantita richiesta.
- Il layout del carrello configurato nell'app deve essere riprodotto identico nella Packing Station.
- I codici bag generati sono nel formato `B-` seguito da 5 caratteri alfanumerici casuali e univoci.
- Una bag generata e subito attiva per picking e packing.
- L'etichetta di una bag puo essere stampata una sola volta; non permettere ristampe accidentali.
- Completato il packing, la bag viene liberata e torna riutilizzabile senza cambiare identita.

## Packing e stampa

Il flusso mouseless previsto e:

1. scansione carrello o bag;
2. scansione/riscansione di conferma bag;
3. visualizzazione evidente del contenuto;
4. scansione imballaggio;
5. generazione e stampa etichetta corriere;
6. scansione etichetta e completamento.

Imballaggi gestiti: scatola piccola, media, grande e busta corriere. L'uso deve scalare lo stock imballaggi e alimentare i costi.

La stampa silenziosa richiede Zebra Browser Print attivo sul computer, stampante predefinita e host Vercel autorizzato. Conservare sempre un fallback browser/PDF comprensibile. Evitare pagine bianche aggiuntive e verificare il formato 15 x 10 cm.

## UI e accessibilita operativa

- Le schermate operative devono privilegiare scansione, leggibilita e velocita rispetto alla decorazione.
- Picking e packing devono mostrare nello stesso viewport istruzione, posizione/bag, prodotto, foto e quantita essenziali.
- Evitare card annidate, duplicazioni di azioni e testi descrittivi inutili durante il lavoro.
- Usare icone della libreria esistente, controlli coerenti e target touch adeguati.
- Verificare desktop e mobile; nessun testo o controllo deve sovrapporsi.
- Non cambiare il design system in una singola pagina senza allineare il resto dell'area.

## Supabase e migrazioni

- Il progetto Supabase corrente ha ref `ryprjuqfervusppnedsz`.
- Le migrazioni presenti arrivano alla `105`.
- Prima di applicare migrazioni: controllare schema remoto, constraint sugli stati e impatto RLS.
- Preferire operazioni idempotenti per backfill e correzioni dati.
- Per grandi aggiornamenti usare batch, transazioni o RPC; non aumentare semplicemente limiti UI senza valutare timeout e atomicita.
- Dopo ogni modifica dati verificare almeno un caso admin, cliente e operatore.

## Verifica prima della consegna

Per modifiche frontend:

```bash
cd frontend
npm run build
```

Inoltre verificare, in base all'area toccata:

- login e routing per tutti i ruoli;
- isolamento multi-tenant/RLS;
- conteggi stock, ATP, refill e prenotazioni;
- transizioni ordine;
- picking e packing scanner-first;
- stampa Zebra e fallback;
- visualizzazione mobile e desktop;
- migrazioni applicate nello stesso ordine localmente e in produzione.

Non considerare chiuso un intervento che modifica un flusso operativo senza una prova end-to-end del percorso interessato.
