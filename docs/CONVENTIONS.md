# Convenzioni e insidie note

## Regole d'oro (rompere = bug)
1. **Prefisso `/api`** su TUTTE le rotte backend (routing K8s ingress → porta 8001).
2. **Frontend**: usa SEMPRE `process.env.REACT_APP_BACKEND_URL` per l'URL API. Mai hardcoded.
3. **Backend DB**: usa SOLO `os.environ["MONGO_URL"]` e `os.environ["DB_NAME"]`. Non cambiare `DB_NAME`.
4. **`.env`**: non rimuovere chiavi esistenti, niente commenti, niente valori di default hardcoded nel codice (config mancante = fail fast). Modifica i `.env` solo con editor, mai con `echo`/heredoc.
5. **Servizi**: gestiti da supervisor. Non avviare uvicorn/yarn manualmente. Riavvio solo dopo modifiche `.env` o nuove dipendenze.
6. **Dipendenze**: backend → `pip install X && pip freeze > requirements.txt`; frontend → `yarn add X` (NON npm). Non riscrivere a mano requirements.txt/package.json.

## MongoDB
- ID business = UUID stringa (`models._uuid()`), NON ObjectId. Solo `users` usa `_id` ObjectId.
- Rimuovere `_id` prima di restituire documenti (`_clean(doc)`).
- Date: `datetime.now(timezone.utc).isoformat()`, mai `utcnow()`.
- Evitare `.to_list(None)` (fetch illimitato): usare limiti espliciti (nel codice si usa 5000/50000).

## Auth (attenzione)
- Modifiche a login/hashing/JWT/seed vanno trattate come integrazione critica.
- bcrypt: la password nel `.env` in produzione può arrivare con virgolette → `seed._clean_env()` le rimuove. Il seed reimposta la password admin se non combacia (idempotente).
- NON suggerire "svuota cache/incognito" come fix per bug auth. Controllare i log backend e le credenziali reali.

## Ambienti
- **PREVIEW** (dev): dove si sviluppa e si testa.
- **PRODUZIONE**: `https://prep-center-control.emergent.host` — ambiente separato (DB + env dedicati). Le modifiche al codice si pubblicano con **Redeploy/"Ridistribuisci le modifiche"** dalla piattaforma Emergent.
- Se un problema è solo in produzione (env var, dominio): contattare il supporto Emergent.

## Lingua
- Prodotto in **italiano**: UI, messaggi di errore, toast, label, commenti. Mantenere l'italiano in ogni nuova stringa rivolta all'utente.

## Testing
- Backend: curl verso `${REACT_APP_BACKEND_URL}/api/...` con cookie jar (`-c`/`-b`).
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
