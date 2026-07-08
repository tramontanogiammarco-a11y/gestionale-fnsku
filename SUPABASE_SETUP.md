# Setup Supabase

Questa versione usa Supabase per:

- email/password degli utenti
- ruoli `admin`, `staff`, `cliente`
- dati del gestionale in Postgres
- file/foto/etichette in Supabase Storage
- funzione protetta per creare clienti con password

## 1. Crea progetto Supabase

Vai su https://supabase.com/dashboard e crea un progetto.

Conserva:

- Project URL
- anon public key
- service role key

## 2. Crea schema database

Apri Supabase Dashboard -> SQL Editor.

Esegui tutto il contenuto di:

```text
supabase/migrations/001_initial_schema.sql
```

## 3. Crea admin iniziale

Apri Supabase Dashboard -> Authentication -> Users -> Add user.

Usa:

```text
Email: admin@prepcenter.it
Password: Admin123!
Email confirmed: true
```

Poi apri SQL Editor ed esegui:

```sql
insert into public.profiles (id, email, name, role)
select id, email, 'Admin Prep Center', 'admin'
from auth.users
where email = 'admin@prepcenter.it'
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  role = excluded.role;
```

## 4. Deploy Edge Function

Installa/usa Supabase CLI e collega il progetto:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy create-client
```

La funzione usa automaticamente:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 5. Variabili Vercel frontend

Nel progetto Vercel `gestionale-fnsku-web`, aggiungi:

```text
REACT_APP_SUPABASE_URL=<Project URL>
REACT_APP_SUPABASE_ANON_KEY=<anon public key>
```

Poi fai un nuovo deploy.

## 6. Creazione clienti

Accedi al gestionale come admin:

```text
admin@prepcenter.it
Admin123!
```

Vai in `Clienti -> Nuovo cliente` e crea email/password per il cliente.
