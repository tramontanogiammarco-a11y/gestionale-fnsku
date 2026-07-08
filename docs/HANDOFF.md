# HANDOFF — Gestionale Prep Center Amazon FBA

> File unico che raccoglie tutta la documentazione. Per lavorare sul codice, collega il repository GitHub a Codex.


---

# ==== README.md ====

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


---

# ==== ARCHITECTURE.md ====

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


---

# ==== DATA_MODELS.md ====

# Modelli dati

Tutti gli ID di business sono **UUID (stringa)**. Le date sono ISO 8601 UTC (`datetime.now(timezone.utc).isoformat()`).
Fonte: `backend/models.py`. Le collezioni Mongo hanno lo stesso nome plurale delle entità.

## Collezione `users` (auth — usa `_id` ObjectId)
Non è un modello Pydantic; gestita in `auth.py`/`seed.py`.
```
{
  _id: ObjectId,
  email: str (lowercase, unique),
  password_hash: str (bcrypt),
  name: str,
  role: "admin" | "staff" | "cliente",
  cliente_id: str | null,   # collega l'utente cliente al documento clienti
  created_at: iso str
}
```

## `clienti`
```
Cliente {
  id: uuid,
  ragione_sociale: str,
  email: str,
  user_id: str,             # _id (str) dell'utente auth collegato
  note: str?,
  listino: Listino,
  created_at: iso str
}
```
### Listino (prezzi in euro, per cliente)
```
Listino {
  fnsku: float = 0.10,        # €/pezzo etichettatura FNSKU
  busta: float = 0.0,         # €/pezzo busta trasparente
  nastratura: float = 0.0,    # €/pezzo
  pluriball: float = 0.0,     # €/pezzo
  inscatolamento: float = 0.0,# €/box spedito
  scatola_60: float = 0.0,    # €/scatola 60x40x40
  scatola_40: float = 0.0,    # €/scatola 40x30x30
  stoccaggio_pallet: float=0.0,# €/pallet al mese
  entrata_pallet: float = 0.0,# €/pallet in entrata
  entrata_scatola: float=0.0, # €/scatola in entrata
  iva: float = 22.0           # % IVA
}
```

## `referenze` (prodotti del cliente)
```
Referenza {
  id: uuid,
  cliente_id: str,
  ean: str,
  sku: str?,
  asin: str?,
  titolo: str,
  foto_url: str?,             # "/api/files/{id}"
  fnsku: str?,
  is_bundle: bool = false,    # ← bundle
  componenti: [ComponenteBundle] = [],  # ← solo se is_bundle
  origine: "manuale" | "import",
  created_at: iso str
}
ComponenteBundle { ean: str, quantita: int = 1 }  # quantità del componente per ogni bundle
```
Payload create/update: `ReferenzaCreate` (ean, titolo obbligatori; is_bundle, componenti opzionali), `ReferenzaUpdate` (tutti opzionali).

## `entrate` + `entrate_righe` (arrivo merce)
```
Entrata {
  id: uuid, cliente_id: str,
  tipo: "pallet" | "scatola",
  colli: int = 1,             # n. pallet/scatole in arrivo (per fatturazione entrata)
  ddt: str?, tracking: str?,
  stato: "in_attesa"|"ricevuto"|"in_lavorazione"|"pronto"|"spedito",
  data_annuncio: iso str,
  data_ricezione: iso str?,   # settato alla ricezione (per fatturazione)
  note: str?
}
RigaEntrata { id: uuid, entrata_id: str, ean: str, quantita: int, fnsku: str? }
```

## `box` (contenuto embedded)
```
Box {
  id: uuid,
  entrata_id: str?,           # box legato a un'entrata (legacy) ...
  preparazione_id: str?,      # ... oppure a una preparazione
  cliente_id: str,
  numero_box: str,
  peso_kg: float?, lunghezza_cm/larghezza_cm/altezza_cm: float?,
  stato: "in_preparazione"|"pronto"|"spedito",
  scatola_tipo: "cliente"|"60x40x40"|"40x30x30",
  etichetta_amazon_pdf_url: str?, etichetta_ups_pdf_url: str?,
  contenuto: [BoxContenuto],
  data_spedito: iso str?,     # per fatturazione
  created_at: iso str
}
BoxContenuto { ean: str, fnsku: str?, sku: str?, quantita: int }
```
> Per i bundle: `contenuto[].ean` è l'EAN del **bundle**; l'espansione nei componenti avviene solo nel calcolo giacenze.

## `preparazioni` + `preparazioni_righe`
```
Preparazione {
  id: uuid, cliente_id: str,
  stato: "richiesta"|"in_lavorazione"|"pronto"|"spedito",
  note: str?,
  data_pronto: iso str?,      # per fatturazione
  created_at: iso str
}
PrepRiga {
  id: uuid, preparazione_id: str,
  ean: str, sku: str?, quantita: int,
  servizi: [str]              # sottoinsieme di ["fnsku","busta","nastratura","pluriball"]
}
```

## `files`
```
{ id: uuid, filename: str, content_type: str, data: bytes, created_at: iso str }
```

## Indici (seed.py)
`users.email` (unique), `clienti.id` (unique), `referenze.cliente_id`, `entrate.cliente_id`, `entrate_righe.entrata_id`, `box.cliente_id`, `files.id` (unique).


---

# ==== API_REFERENCE.md ====

# API Reference

Base URL: `${REACT_APP_BACKEND_URL}/api`. Tutte le rotte richiedono cookie di sessione (httpOnly) tranne `login`.
Ruoli: 🌐 = qualsiasi utente autenticato · 🔒 = solo admin/staff.
I clienti vedono solo i propri dati (scoping automatico su `cliente_id`).

## Auth (`auth.py`)
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| POST | `/api/auth/login` | pubblico | body `{email, password}` → set-cookie + `{id,email,name,role,cliente_id}` |
| POST | `/api/auth/logout` | 🌐 | cancella cookie |
| GET  | `/api/auth/me` | 🌐 | utente corrente |
| POST | `/api/auth/refresh` | pubblico (usa cookie refresh) | rinnova access token |

## Clienti (`routes.py`) 🔒
| Metodo | Path | Note |
|---|---|---|
| POST | `/api/clienti` | crea cliente + utente auth. body `ClienteCreate {ragione_sociale,email,password,note?,listino?}` |
| GET  | `/api/clienti` | lista |
| GET  | `/api/clienti/{id}` | dettaglio |
| PUT  | `/api/clienti/{id}` | body `ClienteUpdate {ragione_sociale?,note?,listino?}` |

## Referenze
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET  | `/api/referenze?cliente_id=` | 🌐 | admin filtra per cliente; cliente vede le proprie |
| POST | `/api/referenze` | 🌐 | body `ReferenzaCreate`. Bundle: `is_bundle:true, componenti:[{ean,quantita}]` |
| PUT  | `/api/referenze/{id}` | 🌐 | body `ReferenzaUpdate` |
| DELETE | `/api/referenze/{id}` | 🌐 | |
| POST | `/api/referenze/{id}/foto` | 🌐 | multipart `file` |
| POST | `/api/referenze/import` | 🌐 | multipart `file` (CSV/Excel) + `cliente_id` (form, per admin) → `{inseriti,errori,totale_righe}` |

## Entrate
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET  | `/api/entrate?cliente_id=&stato=` | 🌐 | include `righe` e `cliente_ragione_sociale` |
| POST | `/api/entrate` | 🌐 | body `EntrataCreate {cliente_id?,tipo,colli,ddt?,tracking?,note?,righe:[{ean,quantita,fnsku?}]}` |
| GET  | `/api/entrate/{id}` | 🌐 | dettaglio |
| POST | `/api/entrate/{id}/ricevi` | 🔒 | stato→ricevuto + `data_ricezione` |
| PUT  | `/api/entrate/{id}/stato` | 🔒 | body `{stato}` |
| PUT  | `/api/entrate-righe/{riga_id}` | 🌐 | body `{fnsku}` |

## Box
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET  | `/api/box?cliente_id=&entrata_id=&preparazione_id=&stato=` | 🌐 | include `cliente_ragione_sociale` |
| POST | `/api/box` | 🔒 | body `BoxCreate`. Guardrail: contenuto ≤ merce imballabile (`_preparato_per_cliente`) |
| PUT  | `/api/box/{id}` | 🔒 | body `BoxUpdate` |
| PUT  | `/api/box/{id}/stato` | 🔒 | body `{stato}`; a `spedito` scarica giacenza + set `data_spedito` |
| POST | `/api/box/{id}/etichetta-amazon` | 🌐 | multipart `file` (PDF) |
| POST | `/api/box/{id}/etichetta-ups` | 🌐 | multipart `file` (PDF) |

## Magazzino / Preparato
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET  | `/api/magazzino?cliente_id=` | 🌐 | giacenze per EAN + linee bundle (`is_bundle`, `componenti`, `disponibile`=realizzabili) |
| GET  | `/api/preparato?cliente_id=` | 🌐 | merce imballabile (solo EAN in preparazioni pronte) |

## Preparazioni
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET  | `/api/preparazioni?cliente_id=&stato=` | 🌐 | include `righe` (arricchite con fnsku/titolo) |
| POST | `/api/preparazioni` | 🌐 | body `PreparazioneCreate {cliente_id?,note?,righe:[{ean,sku?,quantita,servizi:[]}]}` |
| GET  | `/api/preparazioni/{id}` | 🌐 | dettaglio |
| PUT  | `/api/preparazioni/{id}/stato` | 🔒 | body `{stato}`; a `pronto` set `data_pronto` |

## Etichette FNSKU 🔒
| Metodo | Path | Note |
|---|---|---|
| GET  | `/api/etichette/formati` | formati disponibili |
| POST | `/api/etichette/genera` | body `EtichetteRequest {items:[{fnsku,titolo?,copie}],formato,mostra_titolo}` → PDF stream |

## Fatturazione 🔒
| Metodo | Path | Note |
|---|---|---|
| GET  | `/api/fatturazione?cliente_id=&anno=&mese=&pallet=` | JSON `{righe, subtotale, iva_perc, iva_importo, totale, ...}` |
| GET  | `/api/fatturazione/pdf?...` | PDF fattura |

## Dashboard
| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET  | `/api/dashboard/stats` | 🌐 | conteggi entrate per stato, totali referenze/box/clienti |

## File
| Metodo | Path | Note |
|---|---|---|
| GET  | `/api/files/{id}` | serve il file binario (inline) |

## Esempio curl (login + magazzino)
```bash
API=$(grep REACT_APP_BACKEND_URL frontend/.env | cut -d '=' -f2)
curl -s -c cj.txt -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"ADMIN_EMAIL","password":"ADMIN_PASSWORD"}'
curl -s -b cj.txt "$API/api/magazzino?cliente_id=<CID>"
```


---

# ==== FRONTEND.md ====

# Frontend

React 19 (CRA + CRACO). Alias import: `@/` → `frontend/src/`.
Stato/routing: `react-router-dom` v7. HTTP: `axios` (`src/lib/api.js`). Toast: `sonner`. Icone: `lucide-react`. UI: shadcn (`src/components/ui/`). Animazioni: `framer-motion`.

## Routing (`src/App.js`)
- `/login` — pagina login (`pages/Login.jsx`).
- `/admin/*` — protetto ruoli `["admin","staff"]`, layout `AdminLayout`:
  - index Dashboard, `entrate`, `entrate/:id`, `composizione-box`, `box`, `referenze`, `etichette`, `preparazioni`, `preparazioni/:id`, `clienti`, `fatturazione`.
- `/app/*` — protetto ruolo `["cliente"]`, layout `ClientLayout`:
  - index Referenze, `magazzino`, `preparazioni`, `preparazioni/:id`, `entrate`, `entrate/:id`, `box`, `spedizioni`.
- `RootRedirect`: reindirizza in base al ruolo; `ProtectedRoute` gestisce auth/ruoli.

## Auth lato client
- `context/AuthContext.jsx` fornisce `user` (via `GET /api/auth/me`) e login/logout.
- `lib/api.js`: istanza axios con `withCredentials:true` (cookie). Interceptor: su 401 tenta UNA volta `POST /api/auth/refresh` e ripete; se fallisce redirige a `/login`.
- `fileUrl(path)` antepone `REACT_APP_BACKEND_URL` agli URL relativi dei file.
- `formatApiError(detail)` converte il `detail` di FastAPI (stringa o lista di errori) in testo leggibile.

## Pagine principali (`src/pages/`)
**Admin**
- `Dashboard.jsx` — KPI (usa `/dashboard/stats`).
- `Clienti.jsx` — CRUD clienti + editor `Listino`.
- `Entrate.jsx` / `EntrataDetail.jsx` — gestione arrivi, ricezione, FNSKU righe.
- `Referenze.jsx` — sola lettura, filtro per cliente, badge **Bundle** + componenti.
- `LabelGenerator.jsx` — generazione PDF etichette FNSKU.
- `Preparazioni.jsx` / `PreparazioneDetail.jsx` — avanzamento stati.
- `ComposizioneBox.jsx` — compone box dalla merce **in preparazione** (`/preparato`), con tipo scatola e guardrail quantità.
- `Fatturazione.jsx` — selezione cliente/periodo/pallet → anteprima + PDF.

**Cliente**
- `Referenze.jsx` — "Le mie referenze": aggiunta prodotto, **creazione bundle** (checkbox + componenti), import CSV/Excel, upload foto, edit FNSKU.
- `Magazzino.jsx` — giacenze per EAN; righe bundle con badge, componenti e "realizzabili".
- `Preparazioni.jsx` / `PreparazioneDetail.jsx` — richiesta lavorazioni dal magazzino (datalist EAN da `/magazzino`), servizi per riga.
- `Entrate.jsx` / `EntrataDetail.jsx` — annuncio arrivi.
- `Box.jsx` — "I miei box": upload etichette Amazon/UPS + **dettaglio contenuto** (titolo, EAN, SKU, FNSKU, quantità).
- `Spedizioni.jsx` — box spediti.

## Convenzioni UI
- Componenti shadcn da `@/components/ui/*`. Toast con `sonner` (`toast.success/error`).
- Badge stati: `components/StatusBadge.jsx` + mappe in `lib/statuses.js` (`STATI_ENTRATA`, `STATI_BOX`, `STATI_PREP`, `SERVIZI`, `FLUSSO_*`).
- Branding: colore teal `#1F9FB3` (scala Tailwind `blue` rimappata + `--primary`). Logo aimago. Tema chiaro/scuro.
- Tipografia: heading `font-heading`; gerarchia testo come da design guidelines.
- **Icone**: usare `lucide-react` (niente emoji).

## data-testid (obbligatori)
Ogni elemento interattivo e ogni dato critico ha un `data-testid` in kebab-case che descrive la funzione. Esempi presenti:
- `add-ref-btn`, `add-is-bundle`, `bundle-componenti`, `bundle-comp-ean-{i}`, `bundle-comp-qta-{i}`
- `mag-row-{ean}`, `cbox-{id}`, `cbox-contenuto-{id}`, `cbox-item-{id}-{i}`, `cbox-amazon-btn-{id}`
- `comp-cliente-select`, `comp-nuovo-box-btn`, `comp-cont-ean-{i}`, `prep-ean-{i}`, `prep-serv-{i}-{key}`
Mantenere questa convenzione per ogni nuovo elemento.

## Aggiungere una pagina (checklist)
1. Crea il componente in `pages/admin/` o `pages/client/` (export default).
2. Registra la route in `App.js` sotto il layout corretto.
3. Aggiungi la voce di navigazione nel layout (`layouts/AdminLayout.jsx` o `ClientLayout.jsx`).
4. Chiama le API con `api` da `@/lib/api` (mai fetch con URL hardcoded).
5. Aggiungi `data-testid` a tutti gli elementi interattivi/critici.


---

# ==== CONVENTIONS.md ====

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


---

# ==== credentials.example.md ====

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

