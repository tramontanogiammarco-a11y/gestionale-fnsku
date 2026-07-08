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
