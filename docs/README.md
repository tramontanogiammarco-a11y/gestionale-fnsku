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
| Database  | Supabase Postgres |
| Auth      | Supabase Auth |
| Storage   | Supabase Storage |
| Funzioni  | Supabase Edge Functions |
| Deploy    | GitHub + Vercel |

## Struttura del repository
```
├── frontend/               # React
    ├── src/
    │   ├── App.js          # routing (react-router-dom v7)
    │   ├── context/AuthContext.jsx # sessione Supabase Auth
    │   ├── components/      # ProtectedRoute, StatusBadge, ui/ (shadcn)
    │   ├── layouts/         # AdminLayout, ClientLayout
    │   ├── lib/             # api.js (adapter Supabase), supabase.js, statuses.js
    │   └── pages/           # admin/, client/, Login.jsx
    └── .env                # REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY
├── supabase/
│   ├── migrations/          # schema SQL, RLS e policy
│   └── functions/           # Edge Functions protette
└── backend/                 # legacy FastAPI/Mongo: riferimento storico
```

## Come eseguire
- Frontend locale: `cd frontend && npm run dev`
- Build frontend: `cd frontend && npm run build`
- Setup Supabase: seguire `SUPABASE_SETUP.md`
- Deploy frontend: push su GitHub, poi Vercel ridistribuisce automaticamente.

### Regole ambiente (IMPORTANTISSIME)
- Il frontend usa solo `REACT_APP_SUPABASE_URL` e `REACT_APP_SUPABASE_ANON_KEY`.
- La Supabase service role key non va mai esposta nel frontend.
- Le regole di accesso dati vanno gestite con RLS/policy SQL.
- Per creare clienti con credenziali usare la Edge Function `create-client`.

## Documenti in questa cartella
- `ARCHITECTURE.md` — architettura, auth, multi-tenancy, logica di business (incl. Bundle).
- `DATA_MODELS.md` — collezioni MongoDB e modelli Pydantic.
- `API_REFERENCE.md` — elenco completo endpoint con esempi.
- `FRONTEND.md` — routing, pagine, convenzioni UI, data-testid.
- `CONVENTIONS.md` — regole di stile, do/don't, insidie note.
- `credentials.example.md` — credenziali di test (NON committare quelle reali).
