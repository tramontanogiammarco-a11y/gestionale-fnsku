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
