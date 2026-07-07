# PRD — Gestionale Prep Center Amazon FBA

## Problem statement (originale)
Gestionale web per prep center Amazon FBA con due aree (backend admin/staff e area cliente).
Multi-tenant: ogni cliente vede SOLO i propri dati. Flusso: referenze -> entrate -> ricezione ->
etichettatura FNSKU (Code128 PDF) -> box -> upload etichette Amazon/UPS -> spedizione.
Stack richiesto originale: React+Vite+Tailwind + Supabase + Vercel.

## Architettura realizzata (scelte)
- Frontend: React (CRA) + TailwindCSS + shadcn/ui
- Backend: FastAPI + MongoDB (motor)
- Auth: JWT email/password via cookie httpOnly, ruoli admin/staff/cliente
- Barcode: reportlab, Code128 PDF con dimensioni reali in mm (parametrico)
- Multi-tenant: scoping backend su cliente_id (equivalente funzionale a RLS)
- Import isolato in importer.py (predisposto per futuro import SP-API)

## User personas
- Admin (titolare prep center): accesso completo, crea clienti, riceve merce, etichette, box, spedizione
- Staff: come admin (campo ruolo predisposto)
- Cliente (venditore Amazon): gestisce solo proprie referenze, entrate, box, spedizioni

## Core requirements (statici)
- Isolamento dati per cliente
- Flusso stati entrata: in_attesa->ricevuto->in_lavorazione->pronto->spedito (derivati da box)
- Generazione etichette FNSKU Code128 PDF (formati 40x20/50x30/60x30/100x50), copie, batch/singolo
- Import referenze CSV/Excel tollerante + aggiunta manuale con foto
- Upload PDF etichette Amazon/UPS lato cliente

## Implementato (2026-07-02) — MVP completo e testato (21/21 backend, 100% frontend)
- Auth JWT + ruoli + seeding admin e cliente demo
- Aree admin (Dashboard, Entrate, Dettaglio entrata, Box, Referenze, Etichette FNSKU, Clienti)
- Area cliente (Referenze, Entrate, Box, Spedizioni)
- Generazione PDF Code128 con validazione, upload file su MongoDB, dashboard con contatori
- Sync automatico stato entrata da stato box

## Iterazioni successive (2026-07-02)
- Entrata con DDT/tracking; cliente riapre entrata e gestisce FNSKU dal dettaglio; upload etichette per box dal dettaglio entrata
- Fix generazione etichette: messaggi d'errore chiari (FNSKU mancante/non valido)
- Gestione errori azioni admin (no crash su 403); guard "pronto" senza box
- Ottimizzazione query N+1 (entrate/box) per deploy readiness
- **Magazzino virtuale + Preparazioni**: giacenze per EAN (ricevuto/in_preparazione/spedito/disponibile); cliente crea preparazioni (EAN+SKU da dropdown+quantità); box legato alla preparazione (multi-arrivo); scarico giacenza a "spedito"; aree admin e cliente dedicate. Testato 28/28 backend.

## Iterazioni (2026-07-03)
- **Dettaglio Entrata (admin)** ripulito: rimossa gestione Box; resta ricezione merce + FNSKU + generazione etichette Code128.
- **Nuova sezione admin "Composizione Box"** (`/admin/composizione-box`): seleziona cliente → componi box multi-referenza a livello cliente, mescolando SKU di preparazioni diverse. Endpoint `GET /api/preparato?cliente_id=`.
- **Regola imballaggio**: nella composizione a livello cliente si può imballare SOLO la merce in preparazione (somma richiesta dalle preparazioni attive − già in box non spediti). Guardrail backend in `POST /api/box` (400 se oltre quota o EAN non in preparazione). Aggiunto campo `sku` al contenuto box.
- **RESET dati**: cancellati tutti i clienti/dati tranne l'account admin e il cliente **avesta**. Disattivato re-seed del cliente demo.

## Iterazioni (2026-07-03) — Servizi di lavorazione + Fatturazione automatica
FASE A:
- **Servizi per riga di preparazione** (lato cliente): fnsku, busta trasparente, nastratura, pluriball. Campo `servizi` su `PrepRiga`. Badge visibili lato cliente e admin.
- **FNSKU spostato in Preparazioni (admin)**: la pagina Dettaglio Preparazione genera i PDF FNSKU (Code128) dalle righe (FNSKU letto/salvato sulla referenza). Ricezione merce (Dettaglio Entrata) ora è SOLA LETTURA (arrivo + Segna Arrivato + righe).
- **Composizione Box** ora considera imballabile SOLO le preparazioni in stato **"Pronto"** (`_preparato_per_cliente` filtra stato=pronto; in_box conta tutti i box). Timestamp `data_pronto` su preparazione, `data_spedito` su box.
FASE B — Fatturazione:
- **Listino prezzi per cliente** (`Cliente.listino`): fnsku, busta, nastratura, pluriball (€/pezzo), inscatolamento (€/box), stoccaggio_pallet (€/pallet·mese), entrata_pallet, entrata_scatola (€/collo), iva (%). Creazione + modifica da pagina Clienti.
- **Entrata**: campo `colli` (n. pallet/scatole) per il costo entrata merce.
- **Fatturazione automatica** (`GET /api/fatturazione`, `GET /api/fatturazione/pdf`): servizi addebitati quando la preparazione è "Pronto" (per mese via `data_pronto`); inscatolamento = box spediti nel mese; entrata = colli × prezzo per tipo; stoccaggio = n. pallet (input admin) × prezzo. Imponibile + IVA + Totale. PDF estratto conto mensile (`invoice_gen.py`). Nuova pagina admin **Fatturazione**.
- Testato E2E (testing agent, iter 10): 100% flussi OK; backend curl-verificato (breakdown corretto + PDF application/pdf).

## Iterazioni (2026-07-06) — Branding, Redesign, Deploy readiness
- **Branding aimago**: logo cliente + colore brand teal #1F9FB3 (scala `blue` Tailwind rimappata + `--primary`/`--ring` teal). Login chiaro con logo grande trasparente + glow teal; sidebar admin chiara con logo trasparente; area cliente glass. Badge maiuscoli, KPI "control room", animazioni fade-up.
- **Fix login produzione**: `seed.py` hardening — `_clean_env()` rimuove virgolette/spazi da `ADMIN_EMAIL`/`ADMIN_PASSWORD` (il valore .env può arrivare con le virgolette in produzione) + email lowercase; reset idempotente password admin all'avvio. Password cliente avesta reimpostata (Avesta123!).
- **Deploy readiness**: deployment agent = PASS. Query `.to_list(None)` sostituite con `.to_list(50000)` (routes.py) per evitare fetch illimitati. App deployata in produzione su https://prep-center-control.emergent.host (ambiente separato: DB + env dedicati; le modifiche vanno rilasciate con redeploy).
- Verificato (testing agent iter 12): login admin/cliente, errore password errata, logout+re-login, caricamento liste — 100% (5/5).

## Iterazione (2026-07-07) — Bundle (Boundle) [FATTO]
- **Modello**: `Referenza` estesa con `is_bundle: bool` + `componenti: [{ean, quantita}]` (models.py: `ComponenteBundle`). Il bundle è una referenza Amazon a sé (EAN + FNSKU propri).
- **Creazione**: cliente crea il bundle da "Le mie referenze" (checkbox "Questo è un bundle" + selezione prodotti esistenti e quantità per bundle). Bundle immutabile: le varianti = nuovi bundle.
- **Scarico giacenza** (`_magazzino_per_cliente`, routes.py): i box che contengono l'EAN bundle vengono ESPANSI nei componenti → lo scarico avviene su X e Y (non sull'EAN virtuale). Linea bundle virtuale con `disponibile` = min floor(disp_componente / qta) = "realizzabili".
- **Preparazioni/Box**: il cliente ordina l'EAN del bundle; box e composizione usano l'EAN bundle direttamente (nessuna doppia richiesta dei componenti). `_preparato_per_cliente` espone `is_bundle`.
- **Fatturazione**: lavorazioni conteggiate PER bundle assemblato (es. 30 bundle nastratura = 30 nastrature). Nessuna modifica a `_calcola_fattura` necessaria (riga prep quantita = n. bundle).
- **Verifica curl e2e**: bundle Z=X1+Y2, entrata X100/Y100 → Z realizzabile 50; spediti 10 bundle → X disp90, Y disp80, Z realizzabile 40, Z sped10, fattura Nastratura 10. ✅ Smoke UI dialog bundle ✅.


## Backlog concordato con l'utente (da implementare)
- FASE A servizi/box: **scatola nel box** (cliente / nostra 60×40×40 o 40×30×30) + voci listino Scatola_60 e Scatola_40 in fatturazione.
- F1: ricerca/filtri liste (entrate/preparazioni/box), campo **corriere** entrate (GLS/BRT/…).
- F2: preventivo automatico costo in fase di preparazione (lato cliente).
- F3: reset password cliente da admin; storico fatture salvate/riscaricabili; dashboard fatturato mensile.
- F4: box "spedito" → chiude preparazione (solo se tutta la merce pronta è nei box) + notifica cliente (scelta a/b/c in sospeso).
- F5: import massivo referenze (Excel/CSV).
- Fattura "vera": dati fiscali azienda (P.IVA, indirizzo, logo) + numerazione progressiva sul PDF.

## Backlog / prossime fasi (non implementate — fuori scope MVP)
- P1: Import via Amazon SP-API (agganciare a importer.py)
- P1: Brute-force lockout su login (5 tentativi), reset password via email
- P2: Fatturazione/pagamenti, calcolo tariffe prep
- P2: Realtime push (websocket) al posto del refresh su azione
- P2: Gestione staff senza permessi su account clienti

## Next tasks
- Raccogliere feedback utente sull'MVP
- Eventuale export storage su object storage per file di grandi dimensioni
