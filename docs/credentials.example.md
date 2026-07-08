# Credenziali di test (esempio)

> ⚠️ NON committare credenziali reali in un repo pubblico. Sostituisci con i tuoi valori.
> Admin è definito da `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env` (seed idempotente all'avvio).

## Admin / Staff
- Email: `<ADMIN_EMAIL dal backend/.env>`
- Password: `<ADMIN_PASSWORD dal backend/.env>`
- Fallback di sviluppo (se .env non impostato): `admin@prepcenter.it` / `Admin123!`

## Cliente demo
- Le password dei clienti sono impostate dall'admin alla creazione del cliente
  (`POST /api/clienti` con campo `password`).

## Endpoint auth
- POST `/api/auth/login`  (body `{email, password}`)
- POST `/api/auth/logout`
- GET  `/api/auth/me`
- POST `/api/auth/refresh`
