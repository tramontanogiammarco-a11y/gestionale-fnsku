# Gestionale Prep Center Amazon FBA

Gestionale web per prep center Amazon FBA con **due aree**: backend (admin/staff) e area cliente.
Ogni cliente vede e gestisce **solo i propri dati**.

## Stack
- **Frontend:** React (CRA) + TailwindCSS + shadcn/ui — responsive (desktop/tablet)
- **Backend:** FastAPI (Python)
- **Database:** MongoDB
- **Auth:** JWT email/password con ruoli (`admin`, `staff`, `cliente`) via cookie httpOnly
- **Barcode:** `reportlab` — Code128 in PDF con dimensioni **reali in mm** (50x30 di default, parametrico)

> Nota: il progetto è stato realizzato su stack React + FastAPI + MongoDB (runtime della piattaforma).
> L'isolamento multi-tenant, richiesto originariamente come RLS Supabase, è garantito lato backend:
> ogni query di un utente `cliente` è filtrata sul suo `cliente_id`; admin/staff vedono tutto.
> La logica di import è isolata in `backend/importer.py` per aggiungere in futuro un import via Amazon SP-API.

## Ruoli e flusso
`admin`/`staff` → accesso completo. `cliente` → solo i propri dati.

Flusso: referenze (manuale o import CSV/Excel) → annuncio entrata (EAN+q.tà) → ricezione (admin) →
etichettatura FNSKU (PDF Code128) → preparazione box → upload etichette Amazon/UPS (cliente) → spedizione.
Gli stati dell'entrata si aggiornano automaticamente in base allo stato dei box.

## Setup locale
### Backend
```bash
cd backend
pip install -r requirements.txt
# configura .env (vedi .env.example)
```
Variabili `.env`:
- `MONGO_URL`, `DB_NAME`
- `JWT_SECRET` (stringa casuale: `python -c "import secrets; print(secrets.token_hex(32))"`)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` (admin creato automaticamente all'avvio)
- `CORS_ORIGINS` (origine del frontend)

### Frontend
```bash
cd frontend
yarn install
# .env: REACT_APP_BACKEND_URL=<url backend>
yarn start
```

## Account di default (seeding automatico)
- **Admin:** `admin@prepcenter.it` / `Admin123!`
- **Cliente demo:** `cliente@demo.it` / `Cliente123!` (con referenze ed entrata di esempio)

Nuovi clienti si creano dal backend in **Clienti → Nuovo cliente** (l'admin assegna email/password).

## Modello dati (collezioni MongoDB)
`users`, `clienti`, `referenze`, `entrate`, `entrate_righe`, `box` (con `contenuto` embedded), `files`.

## Etichette FNSKU
- Formati: `40x20`, `50x30` (default), `60x30`, `100x50` mm — selezionabili.
- Output PDF con pagina della dimensione fisica esatta dell'etichetta → stampare al **100% / dimensioni reali**.
- Validazione caratteri Code128 prima della generazione.
- Generazione singola/batch e numero di copie per FNSKU.

## API principali (prefisso `/api`)
- `auth/login`, `auth/me`, `auth/logout`
- `clienti` (admin), `referenze` (+ `/import`, `/{id}/foto`)
- `entrate` (+ `/{id}/ricevi`, `/{id}/stato`), `entrate-righe/{id}`
- `box` (+ `/{id}/stato`, `/{id}/etichetta-amazon`, `/{id}/etichetta-ups`)
- `etichette/genera`, `etichette/formati`
- `dashboard/stats`, `files/{id}`
