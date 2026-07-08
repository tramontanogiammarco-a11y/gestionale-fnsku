# Architettura e logica di business

## Autenticazione (auth.py)
- Login `POST /api/auth/login` → verifica bcrypt → imposta cookie httpOnly `access_token` (12h) e `refresh_token` (7g), `secure=True`, `samesite=lax`.
- `get_current_user` legge il token dal cookie (fallback header `Authorization: Bearer`), decodifica JWT, carica l'utente dalla collezione `users` (`_id` ObjectId), rimuove `password_hash`.
- Ruoli: `admin`, `staff`, `cliente`.
  - `require_admin` → consente solo `admin`/`staff`.
  - `is_staff(user)` → True per admin/staff.
- `POST /api/auth/refresh` rinnova l'access token dal refresh token. Il frontend (`lib/api.js`) intercetta il 401 e ritenta UNA volta dopo refresh.
- Seeding admin (`seed.py`): idempotente all'avvio. Legge `ADMIN_EMAIL`/`ADMIN_PASSWORD` da `.env` con `_clean_env()` che rimuove virgolette/spazi (in produzione il valore può arrivare quotato). Reimposta la password admin se non combacia.

> ⚠️ **Auth è un'integrazione critica**: modifiche a login/hashing/JWT/seeding vanno fatte con cautela (bcrypt, timing di `load_dotenv`, idempotenza seed).

## Multi-tenancy (routes.py)
Ogni entità di business ha `cliente_id`. Il filtro dipende dal ruolo:
```python
def _scope(user):
    if is_staff(user): return {}                 # admin/staff: tutti i dati
    return {"cliente_id": user.get("cliente_id")} # cliente: solo i propri
```
- In creazione, `_resolve_cliente_id(user, provided)`: per admin il `cliente_id` è obbligatorio nel payload; per il cliente è preso dal suo utente.
- `_assert_owns_cliente(user, cliente_id)`: blocca l'accesso incrociato tra clienti.
- ID entità = UUID stringa (`models._uuid()`), NON ObjectId, per evitare problemi di serializzazione. Solo la collezione `users` usa `_id` ObjectId.
- Helper `_clean(doc)` rimuove `_id` prima di restituire i documenti Mongo.

## Stati (macchine a stati)
- **Entrata**: `in_attesa → ricevuto → in_lavorazione → pronto → spedito`
- **Box**: `in_preparazione → pronto → spedito`
- **Preparazione**: `richiesta → in_lavorazione → pronto → spedito`

Sincronizzazioni automatiche in `routes.py`:
- `_sync_stato_entrata(entrata_id)` e `_sync_stato_preparazione(preparazione_id)`: quando cambiano gli stati dei box collegati, aggiornano lo stato del genitore (tutti spediti → spedito; tutti pronti/spediti → pronto; altrimenti in_lavorazione). Alla transizione a `pronto` viene salvato `data_pronto` (usato in fatturazione).
- Alla transizione box → `spedito` viene salvato `data_spedito`.

## Magazzino virtuale (calcolo giacenze)
Funzione chiave: `_magazzino_per_cliente(cid)` in `routes.py`.
- `ricevuto[ean]` = somma quantità delle righe delle **entrate** con stato ≠ `in_attesa`.
- `spedito[ean]` = somma quantità nei **box spediti** (lo scarico giacenza avviene SOLO a stato `spedito`).
- `in_preparazione[ean]` = somma quantità nei box **non spediti** (merce impegnata).
- `disponibile = ricevuto - spedito`.

`_preparato_per_cliente(cid)` = merce **imballabile** nella Composizione Box: solo EAN presenti in preparazioni con stato `pronto`.
- `richiesto` (dalle preparazioni pronte) − `in_box` (già inserito nei box) = `disponibile` da imballare.

## Composizione Box (guardrail)
- Il box a livello cliente può contenere **solo** merce presente nelle preparazioni pronte. Guardrail in `POST /api/box`: per ogni riga di contenuto, `quantita ≤ disponibile` da `_preparato_per_cliente`, altrimenti 400.
- Tipo scatola: `cliente` (nessun costo) | `60x40x40` | `40x30x30` (scatole del prep center, con costo a listino). Le dimensioni standard vengono precompilate.

## Bundle (Boundle) — feature recente
Un **bundle** è una referenza Amazon a sé (EAN + FNSKU propri) che rappresenta l'unione di più prodotti esistenti.
- Modello: `Referenza.is_bundle: bool` + `componenti: List[ComponenteBundle]` dove `ComponenteBundle = {ean, quantita}` (quantità per singolo bundle).
- Creazione: lato cliente in "Le mie referenze" (checkbox "Questo è un bundle" + selezione prodotti componenti e quantità). Il bundle è immutabile: una variante = un nuovo bundle.
- **Scarico giacenza**: nei box il contenuto memorizza l'EAN del bundle. In `_magazzino_per_cliente`, i box che contengono un EAN bundle vengono **espansi nei componenti**: lo scarico (`spedito`/`in_preparazione`) viene applicato ai prodotti reali X e Y (`qta_box × qta_per_bundle`), NON all'EAN virtuale del bundle.
- Linea bundle virtuale nel magazzino: `disponibile = realizzabili = min su ogni componente di floor(disponibile_componente / qta_per_bundle)`. Campi `is_bundle` e `componenti` (con titolo/disponibile) esposti per la UI.
- `_preparato_per_cliente` espone anche `is_bundle` e `componenti`.
- **Fatturazione**: le lavorazioni sul bundle si conteggiano **per bundle assemblato** (una riga di preparazione con EAN bundle e `quantita = N` genera N unità di servizio). Nessuna logica dedicata: `_calcola_fattura` somma i servizi per `quantita` di riga.

Esempio verificato: Bundle Z = 1×X + 2×Y. Con 100 X e 100 Y → Z realizzabili = 50. Spedendo 10 bundle Z → X disponibile 90, Y disponibile 80, Z realizzabili 40, e in fattura "Nastratura ×10".

## Fatturazione (routes.py `_calcola_fattura`)
Calcolo mensile per cliente (`anno`, `mese`, `pallet` in input admin). Voci:
- Servizi (fnsku/busta/nastratura/pluriball): somma delle quantità dalle righe di preparazioni diventate `pronto`/`spedito` nel periodo (`data_pronto` inizia con `YYYY-MM`).
- Inscatolamento: n. box spediti nel periodo (`data_spedito`).
- Scatole nostre 60×40×40 / 40×30×30: conteggio per tipo scatola dei box spediti.
- Entrata merce: pallet/scatole ricevuti nel periodo (`data_ricezione`) × prezzo `entrata_pallet`/`entrata_scatola`.
- Stoccaggio: `pallet` (input) × `stoccaggio_pallet`.
- Subtotale → IVA (% da listino, default 22) → Totale.
- Listino prezzi per cliente: modello `Listino` (vedi DATA_MODELS.md), salvato in `clienti.listino`.
- PDF: `GET /api/fatturazione/pdf` via `invoice_gen.genera_fattura_pdf`.

## Etichette FNSKU (barcode_gen.py)
- `POST /api/etichette/genera` (solo staff): valida i FNSKU per Code128, genera PDF con formati `50x30 | 60x30 | 100x50 | 40x20` (mm), opzione `mostra_titolo`.

## File storage
File (foto prodotti, PDF etichette Amazon/UPS) salvati **dentro MongoDB** (collezione `files`): `{id, filename, content_type, data(bytes), created_at}`. Serviti da `GET /api/files/{file_id}`. Nel DB l'URL è relativo (`/api/files/{id}`); il frontend antepone `REACT_APP_BACKEND_URL` con `fileUrl()`.

> 💡 Per file di grandi dimensioni valutare un object storage esterno (backlog).
