# Convenzioni e insidie note

## Regole d'oro (rompere = bug)
1. **Frontend pubblico**: deploy su Vercel dal repository GitHub.
2. **Database/Auth/Storage**: Supabase e Supabase Auth sono la fonte dati attiva.
3. **Frontend env**: usa `REACT_APP_SUPABASE_URL` e `REACT_APP_SUPABASE_ANON_KEY`. Mai hardcoded.
4. **Backend legacy**: FastAPI/Mongo resta solo come riferimento storico finché non viene eliminato del tutto.
5. **`.env`**: non committare segreti. La service role key va usata solo lato Supabase Edge Function, mai nel frontend.
6. **Dipendenze**: frontend → `npm install --legacy-peer-deps` quando serve aggiornare `package-lock`; Supabase → migrazioni SQL in `supabase/migrations`.

## Supabase
- ID business = UUID generati dal database.
- Le regole multi-tenant vivono in RLS e nelle policy SQL.
- Le azioni admin sensibili vanno spostate in Edge Function o RPC protette.
- Storage applicativo nel bucket `gestionale-files`.

## Auth (attenzione)
- Modifiche a login/hashing/JWT/seed vanno trattate come integrazione critica.
- Le credenziali sono gestite da Supabase Auth.
- L'utente admin va creato in Supabase Auth e collegato alla tabella `profiles`.
- NON suggerire "svuota cache/incognito" come fix per bug auth. Controllare i log backend e le credenziali reali.

## Ambienti
- **Repository**: GitHub.
- **Frontend produzione**: Vercel, progetto `gestionale-fnsku-web`.
- **Dati/Auth**: Supabase.
- Le modifiche al codice si pubblicano con commit + push su `main`; Vercel ridistribuisce automaticamente.

## Lingua
- Prodotto in **italiano**: UI, messaggi di errore, toast, label, commenti. Mantenere l'italiano in ogni nuova stringa rivolta all'utente.

## Testing
- Supabase: verificare RLS e policy con utenti admin/staff/cliente.
- Frontend: verifica con screenshot/e2e; controllare layout e coerenza immagini.
- Dopo feature medie/grandi o CRUD completi: usare un giro di test end-to-end.

## Insidie specifiche di questo progetto
- **Giacenze**: lo scarico avviene SOLO quando il box passa a `spedito`. Finché è `in_preparazione`/`pronto` la merce è "impegnata" ma non scaricata.
- **Composizione box**: può usare SOLO merce di preparazioni in stato `pronto` (guardrail server-side). Non aggirare lato frontend.
- **Bundle**: nei box si salva l'EAN del bundle; l'espansione nei componenti avviene solo in `_magazzino_per_cliente`. Se aggiungi nuovi calcoli di giacenza, ricordati di espandere i bundle.
- **Fatturazione bundle**: i servizi si contano per numero di bundle (quantità di riga preparazione), non per componente.
- **Stati genitore**: non impostare a mano lo stato di entrata/preparazione se hai box collegati; usa/aggiorna `_sync_stato_*`.

## Dove intervenire per task tipici
| Task | File |
|---|---|
| Nuovo endpoint di business | `backend/routes.py` (+ modello in `models.py`) |
| Nuovo campo su entità | `models.py` (Create/Update/entity) + route create/update + UI |
| Logica giacenze/bundle | `backend/routes.py` → `_magazzino_per_cliente` / `_preparato_per_cliente` |
| Fatturazione | `backend/routes.py` → `_calcola_fattura` + `invoice_gen.py` |
| Etichette FNSKU | `backend/barcode_gen.py` |
| Import file | `backend/importer.py` |
| Nuova pagina UI | `frontend/src/pages/**` + route in `App.js` + nav nel layout |
| Stati/badge | `frontend/src/lib/statuses.js` + `components/StatusBadge.jsx` |
