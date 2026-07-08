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
