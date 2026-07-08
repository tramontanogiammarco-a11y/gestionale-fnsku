# Gestionale Prep Center Amazon FBA — Documentazione per sviluppatori

> Pacchetto di handoff per lavorare sul codice (utilizzabile con Codex o altri assistenti).
> **Lingua del prodotto: Italiano.** Tutti i testi UI, i messaggi e i commenti sono in italiano.

## Cos'è
Gestionale web multi-tenant per un **prep center Amazon FBA**. Due aree:
- **Area Admin/Staff** (`/admin`): il prep center gestisce clienti, entrate merce, etichette FNSKU, composizione box, fatturazione.
- **Area Cliente** (`/app`): il venditore Amazon gestisce le proprie referenze, magazzino virtuale, preparazioni, box, spedizioni.

Flusso operativo:
`Referenze → Entrate (arrivo merce) → Ricezione → Magazzino virtuale → Preparazioni (lavorazioni: FNSKU/busta/nastratura/pluriball) → Composizione Box → Etichette Amazon/UPS → Spedizione → Fatturazione`

## Stack tecnologico
| Livello   | Tecnologia |
|-----------|------------|
| Frontend  | React 19 (Create React App + CRACO) + TailwindCSS + shadcn/ui + framer-motion |
| Backend   | FastAPI 0.110 (Python) |
| Database  | MongoDB (driver async `motor`) |
| Auth      | JWT custom email/password su cookie httpOnly (access 12h + refresh 7g) |
| PDF       | ReportLab (etichette Code128 FNSKU + fatture) |
| Import    | pandas/openpyxl (CSV/Excel) |

## Struttura del repository
```
/app
├── backend/                # FastAPI
│   ├── server.py           # app FastAPI, CORS, startup seeding
│   ├── auth.py             # login/logout/refresh/me, JWT, hashing bcrypt, dependency ruoli
│   ├── routes.py           # TUTTE le rotte di business (prefisso /api)
│   ├── models.py           # modelli Pydantic
│   ├── db.py               # connessione MongoDB (usa MONGO_URL, DB_NAME)
│   ├── seed.py             # seeding admin idempotente + indici
│   ├── importer.py         # parsing CSV/Excel referenze
│   ├── barcode_gen.py      # generazione PDF etichette FNSKU (Code128)
│   ├── invoice_gen.py      # generazione PDF fatture
│   ├── requirements.txt
│   └── .env                # MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, CORS_ORIGINS
└── frontend/               # React
    ├── src/
    │   ├── App.js          # routing (react-router-dom v7)
    │   ├── context/AuthContext.jsx
    │   ├── components/      # ProtectedRoute, StatusBadge, ui/ (shadcn)
    │   ├── layouts/         # AdminLayout, ClientLayout
    │   ├── lib/             # api.js (axios), statuses.js
    │   └── pages/           # admin/, client/, Login.jsx
    └── .env                # REACT_APP_BACKEND_URL
```

## Come eseguire (ambiente Emergent/Kubernetes)
I servizi sono gestiti da **supervisor** (NON avviare uvicorn/yarn a mano):
- Backend: `0.0.0.0:8001` — riavvio: `sudo supervisorctl restart backend`
- Frontend: `:3000` — riavvio: `sudo supervisorctl restart frontend`
- Hot reload attivo: riavvio necessario solo dopo modifiche a `.env` o nuove dipendenze.
- Log backend: `/var/log/supervisor/backend.*.log`

### Regole ambiente (IMPORTANTISSIME)
- Il frontend chiama SEMPRE `process.env.REACT_APP_BACKEND_URL` (mai URL hardcoded).
- Tutte le rotte backend hanno prefisso **`/api`** (routing K8s ingress → porta 8001).
- Il backend usa SOLO `MONGO_URL` e `DB_NAME` da `backend/.env`.
- Non modificare le chiavi protette nei `.env`.
- Dipendenze: backend `pip install ... && pip freeze > requirements.txt`; frontend `yarn add ...`.

## Documenti in questa cartella
- `ARCHITECTURE.md` — architettura, auth, multi-tenancy, logica di business (incl. Bundle).
- `DATA_MODELS.md` — collezioni MongoDB e modelli Pydantic.
- `API_REFERENCE.md` — elenco completo endpoint con esempi.
- `FRONTEND.md` — routing, pagine, convenzioni UI, data-testid.
- `CONVENTIONS.md` — regole di stile, do/don't, insidie note.
- `credentials.example.md` — credenziali di test (NON committare quelle reali).
