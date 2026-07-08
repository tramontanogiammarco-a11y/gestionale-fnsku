# Gestionale Prep Center Amazon FBA

Gestionale web per prep center Amazon FBA con **due aree**: admin/staff e area cliente.
Ogni cliente vede e gestisce **solo i propri dati**.

## Stack
- **Frontend:** React (CRA) + TailwindCSS + shadcn/ui — responsive (desktop/tablet)
- **Backend/database/auth:** Supabase (Postgres + Auth + Storage + Edge Functions)
- **Deploy:** codice su GitHub, ambiente dati e utenti su Supabase

> Migrazione in corso: il vecchio backend FastAPI/MongoDB resta nel repository solo come riferimento legacy.
> Il percorso attivo nuovo è Supabase. Vedi `SUPABASE_SETUP.md`.

## Ruoli e flusso
`admin`/`staff` → accesso completo. `cliente` → solo i propri dati.

Flusso: referenze (manuale o import CSV/Excel) → annuncio entrata (EAN+q.tà) → ricezione (admin) →
etichettatura FNSKU (PDF Code128) → preparazione box → upload etichette Amazon/UPS (cliente) → spedizione.
Gli stati dell'entrata si aggiornano automaticamente in base allo stato dei box.

## Setup locale
### Frontend
```bash
cd frontend
yarn install
# .env:
# REACT_APP_SUPABASE_URL=<Project URL Supabase>
# REACT_APP_SUPABASE_ANON_KEY=<anon public key Supabase>
yarn start
```

## Supabase

Segui `SUPABASE_SETUP.md` per:

- creare schema Postgres e RLS
- creare admin iniziale
- deployare la Edge Function `create-client`
- impostare le variabili frontend

## Account iniziale consigliato
- **Admin:** `admin@prepcenter.it` / `Admin123!`

Nuovi clienti si creano dal gestionale in **Clienti → Nuovo cliente**. La password viene creata su Supabase Auth tramite Edge Function protetta.

## Modello dati Supabase
Tabelle principali: `profiles`, `clienti`, `referenze`, `entrate`, `entrate_righe`, `preparazioni`, `preparazioni_righe`, `box`, `files`.

## Etichette FNSKU
- Formati: `40x20`, `50x30` (default), `60x30`, `100x50` mm — selezionabili.
- Output PDF con pagina della dimensione fisica esatta dell'etichetta → stampare al **100% / dimensioni reali**.
- Validazione caratteri Code128 prima della generazione.
- Generazione singola/batch e numero di copie per FNSKU.

## Note migrazione
- Login/logout passano da Supabase Auth.
- I dati principali passano da Supabase Postgres con RLS.
- Foto e PDF caricati passano da Supabase Storage.
- Generazione PDF FNSKU/fatture avanzata va completata come Edge Function Supabase.
