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
- **Regola imballaggio**: nella composizione a livello cliente si può imballare SOLO la merce in preparazione (somma richiesta dalle preparazioni attive − già in box non spediti). Guardrail backend in `POST /api/box` (400 se oltre quota o EAN non in preparazione). Aggiunto campo `sku` al contenuto box. Testato via curl (valido/oltre-quota/non-in-prep).

## Backlog / prossime fasi (non implementate — fuori scope MVP)
- P1: Import via Amazon SP-API (agganciare a importer.py)
- P1: Brute-force lockout su login (5 tentativi), reset password via email
- P2: Fatturazione/pagamenti, calcolo tariffe prep
- P2: Realtime push (websocket) al posto del refresh su azione
- P2: Gestione staff senza permessi su account clienti

## Next tasks
- Raccogliere feedback utente sull'MVP
- Eventuale export storage su object storage per file di grandi dimensioni
