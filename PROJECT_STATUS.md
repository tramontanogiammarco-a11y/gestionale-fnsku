# PROJECT_STATUS.md

Aggiornato al 2 settembre 2026.

## Sintesi

Aimago Prep WMS e una piattaforma logistica unificata, multi-tenant e gia distribuita in produzione. Riunisce la Control Tower per Aimago e clienti, l'app mobile di magazzino, la Packing Station, il modulo Amazon Prep e il magazzino 3D.

Il prodotto e in una fase avanzata di prototipo operativo: molti flussi sono utilizzabili e collegati ai dati reali Supabase, ma servono stabilizzazione, test automatici, consolidamento delle integrazioni corriere e riduzione del debito tecnico prima di considerarlo un WMS pienamente production-grade.

## Produzione

- URL canonico: `https://aimago-prep-wms.vercel.app`
- Progetto Vercel: `aimago-prep-wms`
- Vercel project ID: `prj_WfKHjZoPtaIzGktp1rHdDC01CK2O`
- Vercel org ID: `team_6L8NmbyP5T1oDOVT5Wd6BMKs`
- Ultimo deployment verificato: `dpl_4svwTyZ6QcxRNLZXvmAt1418bGi5`
- Supabase project ref: `ryprjuqfervusppnedsz`
- Migrazioni repository: `001` - `076`

Le route SPA vengono riscritte verso `index.html`, quindi i link diretti alle aree React devono funzionare su Vercel.

## Baseline Git

La baseline Git e completata:

- repository corretto verificato: `gestionale-fnsku-wms`;
- branch corrente: `main`;
- branch allineato a `origin/main`;
- working tree pulito;
- ultimo commit funzionale: `49a1406 checkpoint WMS functional development`.

## Aree disponibili

### Control Tower `/wms`

- Panoramica con KPI e grafici.
- Stock catalogo, disponibilita, impegnato e dettaglio referenza.
- Ordini con filtri per stato, dettaglio, modifica, costi e ticket.
- Eccezioni indirizzo/stock e coda refill.
- Spedizioni, resi e tracking.
- Fatturazione per periodo e categorie di costo.
- Ticket cliente-logistica.
- Integrazioni Shopify e importazioni.
- Gestione clienti, operatori, prezzari e magazzino 3D per ruoli autorizzati.

### App operativa `/wms-app`

- Ricezione e put-away.
- Inventario e conteggi.
- Scanner universale.
- Modifica quantita, scambio slot e spostamenti parziali.
- Trasferimenti pallet-slot e refill.
- Picking singolo, massivo e metodo Galluse.
- Foto prodotto durante il picking.
- Comandi rapidi quantita e avanzamento automatico.
- Gestione carrelli/bag e layout visuale.
- Generazione e stampa ubicazioni, bag e barcode imballaggi.
- Storico bag, ricerca prodotto e strumenti operativi.

### Packing Station `/packing-station`

- Input scanner USB sempre pronto e fotocamera opzionale.
- Apertura tramite carrello o bag.
- Layout carrello coerente con quello definito nell'app.
- Doppio controllo bag.
- Contenuto bag visibile e prioritario.
- Scansione imballaggio.
- Etichetta corriere e completamento tramite scansione.
- Liberazione automatica della bag.
- Zebra Browser Print con fallback browser/PDF.

### Amazon Prep

- Area amministrativa `/admin`.
- Area cliente `/app`.
- Entrate merce, referenze/FNSKU, preparazioni e composizione box.
- Upload documenti ed etichette.
- Correzione ammanchi per chiudere preparazioni con ricevuto reale inferiore al richiesto.
- Report economici storici del modulo Prep.

### Magazzino 3D `/wms/mappa`

- Pianta 18 x 60 m con griglia da 10 cm.
- Creazione blocchi slot e portapallet con dimensioni reali.
- Livelli e posizioni interne al blocco.
- Coordinate manuali, rotazione e lato di prelievo.
- Calamita di allineamento su X e Z.
- Rimozione visuale senza cancellazione dello stock.
- Segnalazione di stock in ubicazioni non presenti nella mappa.
- Snapshot e ripristino layout.
- Percorso breve calcolato sugli spazi liberi tra ostacoli.

## Flusso ordini corrente

1. L'ordine arriva da Shopify, CSV o inserimento collegato.
2. Entra in verifica.
3. Vengono controllati indirizzo/CAP e disponibilita stock.
4. Se l'ATP negli slot e sufficiente passa a `Nuovo`/preparabile.
5. Se il totale slot+pallet e sufficiente ma lo slot non basta passa a `In attesa refill`.
6. Se lo stock totale non basta passa a `Eccezione`.
7. All'avvio picking passa a `In preparazione` e non e piu modificabile dal cliente.
8. Dopo picking passa a `Pronto da imballare`.
9. La Packing Station associa imballaggio ed etichetta.
10. Dopo scansione etichetta passa a `Imballato`; il tracking lo porta a `Spedito` e agli stati successivi.

Il cliente puo mettere un ordine in `HOLD` o annullarlo prima che inizi la lavorazione, secondo i vincoli applicativi.

## Stati implementati

Stati ordine principali:

- `in_verifica`
- `eccezione`
- `in_attesa_refill`
- `da_preparare`
- `hold`
- `in_preparazione`
- `in_attesa_packing`
- `in_packing`
- `imballato`
- `spedito`
- `annullato`

Stati del gate:

- `da_verificare`
- `verifica_indirizzo`
- `eccezione_indirizzo`
- `verifica_stock`
- `eccezione_stock`
- `attesa_refill`
- `sbloccato`
- `hold_cliente`
- `ignorato`

## Stock e ubicazioni

Il modello corrente separa stock fisico, impegnato, disponibile ATP, ubicato e non ubicato. La migrazione `076` ha introdotto `wms_stock_placements` per rappresentare la collocazione dello stock storico senza creare nuove unita.

Il piano picking considera le prenotazioni dei task attivi e delle code precedenti. Lo stock su pallet puo generare refill invece di mandare l'operatore verso uno slot vuoto.

Per Relifebattery sono stati importati catalogo, immagini e giacenze di test. Gli ultimi dati storici non ubicati sono stati collocati fino a 100 pezzi per referenza su pallet tramite il backfill della migrazione `076`; la logica frontend consuma prima le collocazioni senza duplicare la disponibilita.

## Catalogo e prodotti

- Import referenze Shopify.
- Visualizzazione anche delle referenze con stock zero.
- EAN e SKU distinti in tabella.
- Dettaglio prodotto con ubicazioni e storico movimenti.
- Modifica amministrativa EAN/SKU.
- Peso e dimensioni per quotazione spedizione.
- Immagini prodotto da Shopify o URL esterni.
- Supporto futuro/iniziale per bundle e materiali di imballaggio.

## Corrieri e costi

- Tabelle prezzari cliente per GLS e BRT.
- Fasce peso: 0-3, 3-5, 5-10, 10-20 e 20-30 kg.
- Zone nazionale e disagiata basate sui CAP importati.
- Preventivo corriere per ordine.
- Selezione predefinita del corriere piu economico e possibilita di cambio prima del packing.
- Costi ordine: prima unita, unita aggiuntive, imballaggio e spedizione.
- Layout di test distinti per etichette GLS/BRT.

Le funzioni per ShippyPro e Sendcloud esistono, ma il flusso reale richiede credenziali, configurazione mittente, verifica contratti/listini e certificazione end-to-end. Le etichette demo non equivalgono ancora a una integrazione corriere certificata in produzione.

## Imballaggi

Tipi iniziali:

- `SCATOLA-PICCOLA`
- `SCATOLA-MEDIA`
- `SCATOLA-GRANDE`
- `BUSTA-CORRIERE`

La scansione in packing associa l'imballaggio all'ordine, scala il materiale e registra il costo. I barcode possono essere inviati alla Packing Station per la stampa.

## Bag e carrelli

- Carrelli configurabili con griglia e posizioni bag.
- Packing Station allineata visivamente alla griglia del carrello.
- Bag generate con codice `B-` + 5 caratteri alfanumerici casuali.
- Codice univoco, attivazione immediata e stampa singola.
- QR e barcode contengono lo stesso codice bag.
- Le bag completate vengono liberate e riutilizzate.

## Autenticazione

L'autenticazione usa Supabase Auth. Il profilo applicativo viene letto da `profiles`.

Campi rilevanti:

- `id`
- `email`
- `name`
- `role`
- `cliente_id`
- `is_operator`
- `operator_active`

Ruoli:

| Profilo | Accesso |
| --- | --- |
| `admin` | Tutti i clienti, Control Tower completa, operatori, prezzari, mappa e aree operative |
| `staff` | Funzioni Aimago operative e di controllo consentite |
| `cliente` | Solo dati del proprio `cliente_id`, portale cliente e funzioni autorizzate |
| operatore attivo | Solo app operativa e Packing Station |

`tramontano.giammarco@gmail.com` e configurato dalle migrazioni come amministratore globale, senza vincolo a un singolo cliente.

Le password sono gestite da Supabase Auth e non sono leggibili. Gli amministratori possono generare reset o password temporanee, non visualizzare password esistenti.

## Supabase

### Tabelle principali

Core Amazon Prep:

- `profiles`, `clienti`, `referenze`
- `entrate`, `entrate_righe`
- `preparazioni`, `preparazioni_righe`, `preparazioni_rettifiche`
- `box`, `files`

Ordini e cliente e-commerce:

- `shopify_connections`
- `shopify_orders`, `shopify_order_items`
- `wms_shipments`, `wms_returns`
- `support_tickets`, `support_ticket_messages`

Stock e inventario:

- `wms_locations`
- `wms_stock_placements`
- `wms_inbound_sessions`, `wms_inbound_movements`
- `wms_outbound_movements`
- `wms_stock_transfers`
- `wms_inventory_sessions`, `wms_inventory_counts`
- `wms_settings`

Picking e packing:

- `wms_pick_tasks`, `wms_pick_lines`
- `wms_packing_sessions`, `wms_packing_lines`
- `wms_bags`, `wms_carts`, `wms_cart_bag_positions`
- `wms_mass_pick_batches`, `wms_mass_pick_lines`, `wms_mass_pick_orders`
- `wms_galluse_batches`, `wms_galluse_lines`, `wms_galluse_orders`
- `wms_galluse_allocations`, `wms_galluse_cart_positions`

Layout, prezzi e audit:

- `wms_warehouse_map`, `wms_warehouse_map_snapshots`
- `italian_postal_codes`, `carrier_postal_zones`, `client_carrier_rates`
- `wms_packaging_types`, `wms_order_packaging_usage`
- `wms_packaging_stock_movements`
- `wms_operational_events`, `wms_order_gate_events`

### Edge Functions

- `create-client`
- `manage-operator`
- `reset-client-password`
- `sendcloud-create-label`
- `shippypro-carriers`
- `shippypro-create-label`
- `shopify-import`
- `shopify-import-orders`
- `shopify-oauth-start`, `shopify-oauth-callback`, `shopify-orders-webhook`
- `wms-import-csv-orders`
- `wms-update-client-order`
- `wms-validate-address`

### Sicurezza

RLS e abilitata sulle aree multi-tenant. Le policy usano funzioni come `is_staff()` e `owns_cliente()`. I segreti amministrativi e delle integrazioni devono restare nelle Edge Functions.

Variabili frontend previste:

- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- opzionale `REACT_APP_WMS_ONLY`

Segreti server-side tipici:

- `SUPABASE_SERVICE_ROLE_KEY`
- credenziali Shopify
- chiavi ShippyPro/Sendcloud
- configurazione mittente corriere

## Ultime modifiche rilevanti

- `068`: rettifiche ammanchi Amazon Prep.
- `069`: registro append-only degli eventi operativi.
- `070`: bag casuali univoche e stampa singola.
- `071`: caricamento slot Relifebattery.
- `072`: gate e coda refill.
- `073`: accesso amministratore globale.
- `074`: lettura cliente degli imballaggi associati.
- `075`: stato HOLD cliente.
- `076`: collocazioni stock e backfill stock storico Relifebattery.

Correzione recente verificata in produzione:

- Gli ordini 14-17 risultavano in eccezione stock nonostante giacenze presenti.
- Cause: stock storico non ubicato e ricontrollo limitato ai soli ordini pendenti.
- La collocazione e la pianificazione prenotazioni sono state corrette.
- Il comando `Ricontrolla e sblocca` ora puo rivalutare anche le eccezioni esistenti.
- Gli ordini interessati sono passati da `Eccezione` a `Nuovo` con costo e preventivo visibili.

## Verifiche eseguite

- Build frontend completata con successo.
- Deploy Vercel completato e alias canonico aggiornato.
- Migrazione `076` applicata al progetto Supabase collegato.
- Ricontrollo live degli ordini con precedente eccezione stock completato.

## Bug e rischi aperti

1. **URL Auth Supabase non allineato.** `supabase/config.toml` contiene ancora `https://gestionale-fnsku-web.vercel.app` come `site_url` e redirect localhost. Verificare anche il dashboard Supabase e allineare reset password/OAuth a `https://aimago-prep-wms.vercel.app`.
2. **Corrieri reali non certificati.** Quotazioni e layout demo funzionano, ma GLS/BRT reali richiedono credenziali, mapping servizi, error handling e test con etichette vere.
3. **Zebra dipende dal computer locale.** La stampa diretta richiede Browser Print attivo, stampante predefinita, certificato/host autorizzato e rete locale funzionante.
4. **Logica concentrata nel frontend.** `frontend/src/lib/api.js` e molto grande e contiene logica critica che dovrebbe migrare gradualmente verso RPC/Edge Functions transazionali.
5. **Copertura test insufficiente.** Non e presente una suite automatica completa per gate ordini, RLS, refill, picking, packing e costi.
6. **Bundle frontend grande.** La build segnala un bundle principale di circa 644 KB gzip; servono code splitting e lazy loading.
7. **Warning build.** ZXing genera warning sulle source map; `PreparazioneDetail.jsx` segnala una dipendenza hook mancante (`load`).
8. **Dipendenze npm.** L'audit installazione ha rilevato 34 vulnerabilita (12 low, 6 moderate, 16 high). Aggiornare in modo controllato, evitando `force` senza regressioni testate.
9. **Documentazione storica obsoleta.** Alcuni file in `docs/` descrivono ancora il vecchio backend.
10. **Dati storici stock.** La migrazione `076` sistema il caso noto Relifebattery, ma serve una riconciliazione generale per tutti i clienti tra ricevuto, spedito, riservato, ubicato e disponibile.
11. **Worktree non pulito.** Sono presenti numerose modifiche funzionali e migrazioni non ancora consolidate in un commit di baseline. Non perderle e non sovrascriverle accidentalmente.
