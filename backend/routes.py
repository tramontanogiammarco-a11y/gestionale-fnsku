"""Rotte API di business del gestionale prep center.

Regole multi-tenant:
- admin/staff: accesso a tutti i dati (possono filtrare per cliente_id)
- cliente: accesso SOLO alle righe con cliente_id corrispondente al proprio
"""
from typing import Optional

from fastapi import (APIRouter, Depends, HTTPException, UploadFile, File,
                     Form, Query)
from fastapi.responses import StreamingResponse, Response
import io

from db import db
from auth import (get_current_user, require_admin, is_staff, hash_password)
from bson import ObjectId
import models as M
import barcode_gen
import invoice_gen
from importer import parse_referenze_file

router = APIRouter(prefix="/api", tags=["app"])

STATI_ENTRATA = ["in_attesa", "ricevuto", "in_lavorazione", "pronto", "spedito"]
STATI_BOX = ["in_preparazione", "pronto", "spedito"]
STATI_PREP = ["richiesta", "in_lavorazione", "pronto", "spedito"]


# --- Helper multi-tenant -----------------------------------------------------
def _scope(user: dict) -> dict:
    """Filtro Mongo in base al ruolo."""
    if is_staff(user):
        return {}
    return {"cliente_id": user.get("cliente_id")}


def _resolve_cliente_id(user: dict, provided: Optional[str]) -> str:
    """Determina il cliente_id da usare in creazione."""
    if is_staff(user):
        if not provided:
            raise HTTPException(status_code=400, detail="cliente_id richiesto")
        return provided
    cid = user.get("cliente_id")
    if not cid:
        raise HTTPException(status_code=403, detail="Utente cliente senza cliente_id")
    return cid


async def _assert_owns_cliente(user: dict, cliente_id: str):
    if not is_staff(user) and user.get("cliente_id") != cliente_id:
        raise HTTPException(status_code=403, detail="Accesso negato")


def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


def _optional_text(value):
    text = str(value or "").strip()
    return text or None


def _normalize_referenza_updates(updates: dict) -> dict:
    for key in ("ean", "sku", "asin", "fnsku", "foto_url"):
        if key in updates:
            updates[key] = _optional_text(updates[key])
    if "titolo" in updates:
        updates["titolo"] = str(updates["titolo"] or "").strip()
    return updates


async def _ensure_referenze_for_entrata(cid: str, righe):
    rows = []
    for r in righe:
        ean = _optional_text(getattr(r, "ean", None))
        if ean:
            rows.append({
                "ean": ean,
                "titolo": _optional_text(getattr(r, "titolo", None)),
                "sku": _optional_text(getattr(r, "sku", None)),
                "fnsku": _optional_text(getattr(r, "fnsku", None)),
            })
    eans = sorted({r["ean"] for r in rows})
    if not eans:
        return

    refs = await db.referenze.find({"cliente_id": cid, "ean": {"$in": eans}}).to_list(5000)
    by_ean = {r.get("ean"): r for r in refs if r.get("ean")}
    for row in rows:
        found = by_ean.get(row["ean"])
        if not found:
            ref = M.Referenza(
                cliente_id=cid,
                ean=row["ean"],
                sku=row["sku"],
                titolo=row["titolo"] or row["ean"],
                fnsku=row["fnsku"],
                origine="entrata",
            )
            doc = ref.model_dump()
            await db.referenze.insert_one(doc)
            by_ean[row["ean"]] = doc
            continue

        patch = {}
        if row["titolo"] and (not found.get("titolo") or found.get("titolo") == found.get("ean")):
            patch["titolo"] = row["titolo"]
        if row["sku"] and not found.get("sku"):
            patch["sku"] = row["sku"]
        if row["fnsku"] and not found.get("fnsku"):
            patch["fnsku"] = row["fnsku"]
        if patch:
            await db.referenze.update_one({"id": found["id"]}, {"$set": patch})
            found.update(patch)


async def _cascade_referenza_ean(cid: str, old_ean: str, new_ean: str):
    if not cid or not old_ean or not new_ean or old_ean == new_ean:
        return

    entrate = await db.entrate.find({"cliente_id": cid}, {"id": 1}).to_list(50000)
    entrata_ids = [e["id"] for e in entrate]
    if entrata_ids:
        await db.entrate_righe.update_many(
            {"entrata_id": {"$in": entrata_ids}, "ean": old_ean},
            {"$set": {"ean": new_ean}},
        )

    preparazioni = await db.preparazioni.find({"cliente_id": cid}, {"id": 1}).to_list(50000)
    prep_ids = [p["id"] for p in preparazioni]
    if prep_ids:
        await db.preparazioni_righe.update_many(
            {"preparazione_id": {"$in": prep_ids}, "ean": old_ean},
            {"$set": {"ean": new_ean}},
        )

    boxes = await db.box.find({"cliente_id": cid, "contenuto.ean": old_ean}).to_list(50000)
    for box in boxes:
        contenuto = [
            {**item, "ean": new_ean} if item.get("ean") == old_ean else item
            for item in box.get("contenuto", [])
        ]
        await db.box.update_one({"id": box["id"]}, {"$set": {"contenuto": contenuto}})


# ============================================================================
# FILE STORAGE (foto prodotti, PDF etichette) — salvati in MongoDB
# ============================================================================
async def _save_file(upload: UploadFile) -> str:
    data = await upload.read()
    file_id = M._uuid()
    await db.files.insert_one({
        "id": file_id,
        "filename": upload.filename,
        "content_type": upload.content_type or "application/octet-stream",
        "data": data,
        "created_at": M._now_iso(),
    })
    return f"/api/files/{file_id}"


@router.get("/files/{file_id}")
async def get_file(file_id: str):
    f = await db.files.find_one({"id": file_id})
    if not f:
        raise HTTPException(status_code=404, detail="File non trovato")
    return Response(content=f["data"], media_type=f["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{f["filename"]}"'})


# ============================================================================
# CLIENTI (solo admin/staff)
# ============================================================================
@router.post("/clienti")
async def crea_cliente(payload: M.ClienteCreate, user: dict = Depends(require_admin)):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email gia' registrata")

    cliente = M.Cliente(ragione_sociale=payload.ragione_sociale, email=email,
                        user_id="", note=payload.note,
                        listino=payload.listino or M.Listino())
    # crea utente auth con ruolo cliente collegato al cliente
    res = await db.users.insert_one({
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.ragione_sociale,
        "role": "cliente",
        "cliente_id": cliente.id,
        "created_at": M._now_iso(),
    })
    cliente.user_id = str(res.inserted_id)
    await db.clienti.insert_one(cliente.model_dump())
    return cliente.model_dump()


@router.get("/clienti")
async def lista_clienti(user: dict = Depends(require_admin)):
    docs = await db.clienti.find().sort("created_at", -1).to_list(1000)
    return [_clean(d) for d in docs]


@router.get("/clienti/{cliente_id}")
async def dettaglio_cliente(cliente_id: str, user: dict = Depends(require_admin)):
    d = await db.clienti.find_one({"id": cliente_id})
    if not d:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    return _clean(d)


@router.put("/clienti/{cliente_id}")
async def aggiorna_cliente(cliente_id: str, payload: M.ClienteUpdate,
                           user: dict = Depends(require_admin)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.clienti.update_one({"id": cliente_id}, {"$set": updates})
    d = await db.clienti.find_one({"id": cliente_id})
    if not d:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    return _clean(d)


# ============================================================================
# REFERENZE
# ============================================================================
@router.get("/referenze")
async def lista_referenze(cliente_id: Optional[str] = Query(None),
                          user: dict = Depends(get_current_user)):
    q = _scope(user)
    if is_staff(user) and cliente_id:
        q["cliente_id"] = cliente_id
    docs = await db.referenze.find(q).sort("created_at", -1).to_list(5000)
    return [_clean(d) for d in docs]


@router.post("/referenze")
async def crea_referenza(payload: M.ReferenzaCreate, user: dict = Depends(get_current_user)):
    cid = _resolve_cliente_id(user, payload.cliente_id)
    values = _normalize_referenza_updates(payload.model_dump())
    ref = M.Referenza(
        cliente_id=cid, ean=values.get("ean"), sku=values.get("sku"), asin=values.get("asin"),
        titolo=values.get("titolo"), fnsku=values.get("fnsku"), foto_url=values.get("foto_url"),
        is_bundle=values.get("is_bundle", False),
        componenti=values.get("componenti") if values.get("is_bundle") else [],
        origine="manuale",
    )
    await db.referenze.insert_one(ref.model_dump())
    return ref.model_dump()


@router.put("/referenze/{ref_id}")
async def aggiorna_referenza(ref_id: str, payload: M.ReferenzaUpdate,
                             user: dict = Depends(get_current_user)):
    d = await db.referenze.find_one({"id": ref_id})
    if not d:
        raise HTTPException(status_code=404, detail="Referenza non trovata")
    await _assert_owns_cliente(user, d["cliente_id"])
    updates = _normalize_referenza_updates(payload.model_dump(exclude_unset=True))
    if updates:
        await db.referenze.update_one({"id": ref_id}, {"$set": updates})
        if updates.get("ean") and d.get("ean") and updates["ean"] != d["ean"]:
            await _cascade_referenza_ean(d["cliente_id"], d["ean"], updates["ean"])
    d = await db.referenze.find_one({"id": ref_id})
    return _clean(d)


@router.delete("/referenze/{ref_id}")
async def elimina_referenza(ref_id: str, user: dict = Depends(get_current_user)):
    d = await db.referenze.find_one({"id": ref_id})
    if not d:
        raise HTTPException(status_code=404, detail="Referenza non trovata")
    await _assert_owns_cliente(user, d["cliente_id"])
    await db.referenze.delete_one({"id": ref_id})
    return {"ok": True}


@router.post("/referenze/{ref_id}/foto")
async def upload_foto(ref_id: str, file: UploadFile = File(...),
                      user: dict = Depends(get_current_user)):
    d = await db.referenze.find_one({"id": ref_id})
    if not d:
        raise HTTPException(status_code=404, detail="Referenza non trovata")
    await _assert_owns_cliente(user, d["cliente_id"])
    url = await _save_file(file)
    await db.referenze.update_one({"id": ref_id}, {"$set": {"foto_url": url}})
    return {"foto_url": url}


@router.post("/referenze/import")
async def import_referenze(file: UploadFile = File(...),
                           cliente_id: Optional[str] = Form(None),
                           user: dict = Depends(get_current_user)):
    cid = _resolve_cliente_id(user, cliente_id)
    content = await file.read()
    righe, errori = parse_referenze_file(content, file.filename)

    inseriti = 0
    for r in righe:
        ref = M.Referenza(cliente_id=cid, ean=r["ean"], sku=r["sku"] or None,
                          asin=r["asin"] or None, titolo=r["titolo"], origine="import")
        await db.referenze.insert_one(ref.model_dump())
        inseriti += 1

    return {"inseriti": inseriti, "errori": errori,
            "totale_righe": inseriti + len(errori)}


# ============================================================================
# ENTRATE
# ============================================================================
async def _entrata_con_righe(entrata: dict) -> dict:
    righe = await db.entrate_righe.find({"entrata_id": entrata["id"]}).to_list(1000)
    entrata = _clean(entrata)
    entrata["righe"] = [_clean(r) for r in righe]
    return entrata


@router.get("/entrate")
async def lista_entrate(cliente_id: Optional[str] = Query(None),
                        stato: Optional[str] = Query(None),
                        user: dict = Depends(get_current_user)):
    q = _scope(user)
    if is_staff(user) and cliente_id:
        q["cliente_id"] = cliente_id
    if stato:
        q["stato"] = stato
    docs = await db.entrate.find(q).sort("data_annuncio", -1).to_list(2000)
    entrata_ids = [d["id"] for d in docs]
    cliente_ids = list({d["cliente_id"] for d in docs})
    # Batch fetch righe e clienti per evitare query N+1
    righe_map = {}
    if entrata_ids:
        all_righe = await db.entrate_righe.find({"entrata_id": {"$in": entrata_ids}}).to_list(50000)
        for r in all_righe:
            righe_map.setdefault(r["entrata_id"], []).append(_clean(r))
    clienti_map = {}
    if cliente_ids:
        all_cli = await db.clienti.find({"id": {"$in": cliente_ids}}).to_list(50000)
        clienti_map = {c["id"]: c for c in all_cli}
    result = []
    for d in docs:
        d = _clean(d)
        d["righe"] = righe_map.get(d["id"], [])
        cli = clienti_map.get(d["cliente_id"])
        d["cliente_ragione_sociale"] = cli["ragione_sociale"] if cli else None
        result.append(d)
    return result


@router.post("/entrate")
async def crea_entrata(payload: M.EntrataCreate, user: dict = Depends(get_current_user)):
    cid = _resolve_cliente_id(user, payload.cliente_id)
    await _ensure_referenze_for_entrata(cid, payload.righe)
    entrata = M.Entrata(cliente_id=cid, tipo=payload.tipo, colli=payload.colli,
                        ddt=payload.ddt, tracking=payload.tracking, note=payload.note)
    await db.entrate.insert_one(entrata.model_dump())
    for r in payload.righe:
        riga = M.RigaEntrata(entrata_id=entrata.id, ean=r.ean,
                             quantita=r.quantita, fnsku=r.fnsku)
        await db.entrate_righe.insert_one(riga.model_dump())
    return await _entrata_con_righe(await db.entrate.find_one({"id": entrata.id}))


@router.get("/entrate/{entrata_id}")
async def dettaglio_entrata(entrata_id: str, user: dict = Depends(get_current_user)):
    d = await db.entrate.find_one({"id": entrata_id})
    if not d:
        raise HTTPException(status_code=404, detail="Entrata non trovata")
    await _assert_owns_cliente(user, d["cliente_id"])
    out = await _entrata_con_righe(d)
    cli = await db.clienti.find_one({"id": d["cliente_id"]})
    out["cliente_ragione_sociale"] = cli["ragione_sociale"] if cli else None
    return out


@router.post("/entrate/{entrata_id}/ricevi")
async def ricevi_entrata(entrata_id: str, user: dict = Depends(require_admin)):
    d = await db.entrate.find_one({"id": entrata_id})
    if not d:
        raise HTTPException(status_code=404, detail="Entrata non trovata")
    await db.entrate.update_one({"id": entrata_id},
                                {"$set": {"stato": "ricevuto",
                                          "data_ricezione": M._now_iso()}})
    return await _entrata_con_righe(await db.entrate.find_one({"id": entrata_id}))


@router.put("/entrate/{entrata_id}/stato")
async def cambia_stato_entrata(entrata_id: str, payload: M.StatoUpdate,
                               user: dict = Depends(require_admin)):
    if payload.stato not in STATI_ENTRATA:
        raise HTTPException(status_code=400, detail="Stato non valido")
    d = await db.entrate.find_one({"id": entrata_id})
    if not d:
        raise HTTPException(status_code=404, detail="Entrata non trovata")
    updates = {"stato": payload.stato}
    if payload.stato == "ricevuto" and not d.get("data_ricezione"):
        updates["data_ricezione"] = M._now_iso()
    await db.entrate.update_one({"id": entrata_id}, {"$set": updates})
    return await _entrata_con_righe(await db.entrate.find_one({"id": entrata_id}))


@router.put("/entrate-righe/{riga_id}")
async def aggiorna_riga_fnsku(riga_id: str, payload: M.RigaFnskuUpdate,
                              user: dict = Depends(get_current_user)):
    riga = await db.entrate_righe.find_one({"id": riga_id})
    if not riga:
        raise HTTPException(status_code=404, detail="Riga non trovata")
    entrata = await db.entrate.find_one({"id": riga["entrata_id"]})
    await _assert_owns_cliente(user, entrata["cliente_id"])
    await db.entrate_righe.update_one({"id": riga_id},
                                      {"$set": {"fnsku": payload.fnsku}})
    return _clean(await db.entrate_righe.find_one({"id": riga_id}))


# ============================================================================
# BOX
# ============================================================================
async def _sync_stato_entrata(entrata_id: str):
    """Se tutti i box dell'entrata sono pronti->entrata pronto; se tutti spediti->spedito."""
    if not entrata_id:
        return
    box_list = await db.box.find({"entrata_id": entrata_id}).to_list(1000)
    if not box_list:
        return
    stati = [b["stato"] for b in box_list]
    if all(s == "spedito" for s in stati):
        await db.entrate.update_one({"id": entrata_id}, {"$set": {"stato": "spedito"}})
    elif all(s in ("pronto", "spedito") for s in stati):
        await db.entrate.update_one({"id": entrata_id}, {"$set": {"stato": "pronto"}})
    else:
        await db.entrate.update_one({"id": entrata_id}, {"$set": {"stato": "in_lavorazione"}})


async def _sync_stato_preparazione(preparazione_id: str):
    """Sincronizza lo stato della preparazione in base allo stato dei suoi box."""
    if not preparazione_id:
        return
    box_list = await db.box.find({"preparazione_id": preparazione_id}).to_list(1000)
    if not box_list:
        return
    stati = [b["stato"] for b in box_list]
    if all(s == "spedito" for s in stati):
        nuovo = "spedito"
    elif all(s in ("pronto", "spedito") for s in stati):
        nuovo = "pronto"
    else:
        nuovo = "in_lavorazione"
    upd = {"stato": nuovo}
    if nuovo == "pronto":
        pd = await db.preparazioni.find_one({"id": preparazione_id}, {"data_pronto": 1})
        if pd and not pd.get("data_pronto"):
            upd["data_pronto"] = M._now_iso()
    await db.preparazioni.update_one({"id": preparazione_id}, {"$set": upd})


@router.get("/box")
async def lista_box(cliente_id: Optional[str] = Query(None),
                    entrata_id: Optional[str] = Query(None),
                    preparazione_id: Optional[str] = Query(None),
                    stato: Optional[str] = Query(None),
                    user: dict = Depends(get_current_user)):
    q = _scope(user)
    if is_staff(user) and cliente_id:
        q["cliente_id"] = cliente_id
    if entrata_id:
        q["entrata_id"] = entrata_id
    if preparazione_id:
        q["preparazione_id"] = preparazione_id
    if stato:
        q["stato"] = stato
    docs = await db.box.find(q).sort("created_at", -1).to_list(2000)
    cliente_ids = list({d["cliente_id"] for d in docs})
    clienti_map = {}
    if cliente_ids:
        all_cli = await db.clienti.find({"id": {"$in": cliente_ids}}).to_list(50000)
        clienti_map = {c["id"]: c for c in all_cli}
    result = []
    for d in docs:
        d = _clean(d)
        cli = clienti_map.get(d["cliente_id"])
        d["cliente_ragione_sociale"] = cli["ragione_sociale"] if cli else None
        result.append(d)
    return result


@router.post("/box")
async def crea_box(payload: M.BoxCreate, user: dict = Depends(require_admin)):
    cid = payload.cliente_id
    if payload.entrata_id:
        entrata = await db.entrate.find_one({"id": payload.entrata_id})
        if not entrata:
            raise HTTPException(status_code=404, detail="Entrata non trovata")
        cid = entrata["cliente_id"]
    if payload.preparazione_id:
        prep = await db.preparazioni.find_one({"id": payload.preparazione_id})
        if not prep:
            raise HTTPException(status_code=404, detail="Preparazione non trovata")
        cid = prep["cliente_id"]
    if not cid:
        raise HTTPException(status_code=400, detail="cliente_id, entrata_id o preparazione_id richiesto")

    # Guardrail: nella composizione a livello cliente si può imballare SOLO la
    # merce in preparazione (somma richiesta dalle preparazioni attive) meno
    # quanto già inserito in box non spediti.
    if payload.contenuto and not payload.entrata_id and not payload.preparazione_id:
        prep = await _preparato_per_cliente(cid)
        disp = {p["ean"]: p["disponibile"] for p in prep}
        for c in payload.contenuto:
            avail = disp.get(c.ean, 0)
            if c.quantita > avail:
                raise HTTPException(
                    status_code=400,
                    detail=f"EAN {c.ean}: puoi imballare solo la merce in preparazione (richiesti {c.quantita}, imballabili {avail}).")

    # Scatola: se "nostra", precompila le dimensioni standard del collo.
    dims = {"lunghezza_cm": payload.lunghezza_cm, "larghezza_cm": payload.larghezza_cm, "altezza_cm": payload.altezza_cm}
    if payload.scatola_tipo == "60x40x40":
        dims = {"lunghezza_cm": 60, "larghezza_cm": 40, "altezza_cm": 40}
    elif payload.scatola_tipo == "40x30x30":
        dims = {"lunghezza_cm": 40, "larghezza_cm": 30, "altezza_cm": 30}
    box = M.Box(entrata_id=payload.entrata_id, preparazione_id=payload.preparazione_id,
                cliente_id=cid, numero_box=payload.numero_box, peso_kg=payload.peso_kg,
                scatola_tipo=payload.scatola_tipo or "cliente",
                contenuto=payload.contenuto, **dims)
    await db.box.insert_one(box.model_dump())
    if payload.entrata_id:
        await _sync_stato_entrata(payload.entrata_id)
    if payload.preparazione_id:
        await _sync_stato_preparazione(payload.preparazione_id)
    return _clean(await db.box.find_one({"id": box.id}))


@router.put("/box/{box_id}")
async def aggiorna_box(box_id: str, payload: M.BoxUpdate,
                       user: dict = Depends(require_admin)):
    d = await db.box.find_one({"id": box_id})
    if not d:
        raise HTTPException(status_code=404, detail="Box non trovato")
    updates = {}
    for k, v in payload.model_dump().items():
        if v is not None:
            updates[k] = v
    if updates:
        await db.box.update_one({"id": box_id}, {"$set": updates})
    return _clean(await db.box.find_one({"id": box_id}))


@router.put("/box/{box_id}/stato")
async def cambia_stato_box(box_id: str, payload: M.StatoUpdate,
                           user: dict = Depends(require_admin)):
    if payload.stato not in STATI_BOX:
        raise HTTPException(status_code=400, detail="Stato non valido")
    d = await db.box.find_one({"id": box_id})
    if not d:
        raise HTTPException(status_code=404, detail="Box non trovato")
    box_upd = {"stato": payload.stato}
    if payload.stato == "spedito" and not d.get("data_spedito"):
        box_upd["data_spedito"] = M._now_iso()
    await db.box.update_one({"id": box_id}, {"$set": box_upd})
    await _sync_stato_entrata(d.get("entrata_id"))
    await _sync_stato_preparazione(d.get("preparazione_id"))
    return _clean(await db.box.find_one({"id": box_id}))


@router.post("/box/{box_id}/etichetta-amazon")
async def upload_etichetta_amazon(box_id: str, file: UploadFile = File(...),
                                  user: dict = Depends(get_current_user)):
    d = await db.box.find_one({"id": box_id})
    if not d:
        raise HTTPException(status_code=404, detail="Box non trovato")
    await _assert_owns_cliente(user, d["cliente_id"])
    url = await _save_file(file)
    await db.box.update_one({"id": box_id}, {"$set": {"etichetta_amazon_pdf_url": url}})
    return {"etichetta_amazon_pdf_url": url}


@router.post("/box/{box_id}/etichetta-ups")
async def upload_etichetta_ups(box_id: str, file: UploadFile = File(...),
                               user: dict = Depends(get_current_user)):
    d = await db.box.find_one({"id": box_id})
    if not d:
        raise HTTPException(status_code=404, detail="Box non trovato")
    await _assert_owns_cliente(user, d["cliente_id"])
    url = await _save_file(file)
    await db.box.update_one({"id": box_id}, {"$set": {"etichetta_ups_pdf_url": url}})
    return {"etichetta_ups_pdf_url": url}


# ============================================================================
# ETICHETTE FNSKU (generazione PDF Code128) — solo admin/staff
# ============================================================================
@router.get("/etichette/formati")
async def formati_etichette(user: dict = Depends(get_current_user)):
    return {"formati": list(barcode_gen.FORMATI.keys())}


@router.post("/etichette/genera")
async def genera_etichette(payload: M.EtichetteRequest, user: dict = Depends(require_admin)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Nessun FNSKU fornito")
    # validazione preventiva con messaggi chiari
    non_validi = [it.fnsku for it in payload.items if not barcode_gen.fnsku_valido(it.fnsku)]
    if non_validi:
        raise HTTPException(status_code=400,
                            detail=f"FNSKU non validi per Code128: {', '.join(non_validi)}")
    try:
        pdf = barcode_gen.genera_etichette_pdf(payload.items, payload.formato,
                                               payload.mostra_titolo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": "inline; filename=etichette_fnsku.pdf"})


# ============================================================================
# DASHBOARD
# ============================================================================
@router.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    q = _scope(user)
    conteggi = {s: 0 for s in STATI_ENTRATA}
    docs = await db.entrate.find(q, {"stato": 1}).to_list(5000)
    for d in docs:
        st = d.get("stato")
        if st in conteggi:
            conteggi[st] += 1
    tot_referenze = await db.referenze.count_documents(q)
    tot_box = await db.box.count_documents(q)
    tot_clienti = await db.clienti.count_documents({}) if is_staff(user) else None
    return {"entrate_per_stato": conteggi, "totale_entrate": len(docs),
            "totale_referenze": tot_referenze, "totale_box": tot_box,
            "totale_clienti": tot_clienti}



# ============================================================================
# MAGAZZINO VIRTUALE (giacenze per EAN) + PREPARAZIONI
# ============================================================================
async def _magazzino_per_cliente(cid: str):
    """Calcola la giacenza per EAN di un cliente.

    ricevuto  = somma quantità delle entrate ricevute (stato != in_attesa)
    spedito   = somma quantità nei box SPEDITI (scarico giacenza solo a 'spedito')
    in_prep   = somma quantità nei box non ancora spediti (impegnato)
    disponibile = ricevuto - spedito
    """
    # Entrate del cliente già ricevute
    entrate = await db.entrate.find(
        {"cliente_id": cid, "stato": {"$in": ["ricevuto", "in_lavorazione", "pronto", "spedito"]}},
        {"id": 1}).to_list(5000)
    entrata_ids = [e["id"] for e in entrate]
    ricevuto = {}
    if entrata_ids:
        righe = await db.entrate_righe.find({"entrata_id": {"$in": entrata_ids}}).to_list(50000)
        for r in righe:
            ricevuto[r["ean"]] = ricevuto.get(r["ean"], 0) + int(r.get("quantita", 0))

    # Referenze per titolo + elenco SKU per EAN + mappa bundle
    refs = await db.referenze.find({"cliente_id": cid}).to_list(5000)
    titolo_map, sku_map, bundle_map, bundle_refs = {}, {}, {}, []
    for rf in refs:
        if not rf.get("ean"):
            continue
        titolo_map.setdefault(rf["ean"], rf.get("titolo"))
        if rf.get("sku"):
            sku_map.setdefault(rf["ean"], set()).add(rf["sku"])
        if rf.get("is_bundle") and rf.get("componenti"):
            bundle_map[rf["ean"]] = rf["componenti"]
            bundle_refs.append(rf)

    # Box del cliente: spediti -> scarico; non spediti -> impegnato.
    # I bundle vengono espansi nei loro componenti (lo scarico avviene sui
    # prodotti reali X e Y, non sull'EAN virtuale del bundle).
    spedito, in_prep = {}, {}
    bundle_spedito, bundle_in_prep = {}, {}
    box_list = await db.box.find({"cliente_id": cid}).to_list(5000)
    for b in box_list:
        is_sped = b.get("stato") == "spedito"
        for c in b.get("contenuto", []):
            ean = c["ean"]
            qta = int(c.get("quantita", 0))
            if ean in bundle_map:
                btarget = bundle_spedito if is_sped else bundle_in_prep
                btarget[ean] = btarget.get(ean, 0) + qta
                for comp in bundle_map[ean]:
                    cq = qta * int(comp.get("quantita", 1) or 1)
                    target = spedito if is_sped else in_prep
                    target[comp["ean"]] = target.get(comp["ean"], 0) + cq
            else:
                target = spedito if is_sped else in_prep
                target[ean] = target.get(ean, 0) + qta

    # Linee prodotti singoli / componenti (esclusi gli EAN dei bundle)
    eans = (set(ricevuto) | set(spedito) | set(in_prep) | set(titolo_map)) - set(bundle_map)
    result, disp_comp = [], {}
    for ean in sorted(eans):
        ric = ricevuto.get(ean, 0)
        spe = spedito.get(ean, 0)
        disp = ric - spe
        disp_comp[ean] = disp
        result.append({
            "ean": ean,
            "titolo": titolo_map.get(ean),
            "skus": sorted(sku_map.get(ean, [])),
            "ricevuto": ric,
            "spedito": spe,
            "in_preparazione": in_prep.get(ean, 0),
            "disponibile": disp,
            "is_bundle": False,
            "componenti": [],
        })

    # Linee bundle (virtuali): realizzabile = min su ogni componente di
    # floor(disponibile_componente / quantita_per_bundle)
    for rf in bundle_refs:
        comps = bundle_map[rf["ean"]]
        realizzabile, comp_out = None, []
        for comp in comps:
            ceq = int(comp.get("quantita", 1) or 1)
            cdisp = disp_comp.get(comp["ean"], ricevuto.get(comp["ean"], 0) - spedito.get(comp["ean"], 0))
            possibile = cdisp // ceq if ceq else 0
            realizzabile = possibile if realizzabile is None else min(realizzabile, possibile)
            comp_out.append({"ean": comp["ean"], "quantita": ceq,
                             "titolo": titolo_map.get(comp["ean"]), "disponibile": cdisp})
        realizzabile = max(0, realizzabile if realizzabile is not None else 0)
        result.append({
            "ean": rf["ean"],
            "titolo": rf.get("titolo"),
            "skus": sorted(sku_map.get(rf["ean"], [])),
            "ricevuto": 0,
            "spedito": bundle_spedito.get(rf["ean"], 0),
            "in_preparazione": bundle_in_prep.get(rf["ean"], 0),
            "disponibile": realizzabile,
            "is_bundle": True,
            "componenti": comp_out,
        })
    return result


@router.get("/magazzino")
async def magazzino(cliente_id: Optional[str] = Query(None),
                    user: dict = Depends(get_current_user)):
    if is_staff(user):
        if not cliente_id:
            raise HTTPException(status_code=400, detail="cliente_id richiesto")
        cid = cliente_id
    else:
        cid = user.get("cliente_id")
    return await _magazzino_per_cliente(cid)


async def _preparato_per_cliente(cid: str):
    """Merce IMBALLABILE per un cliente: solo ciò che è stato messo in preparazione.

    richiesto   = somma quantità richieste nelle preparazioni attive (non spedite)
    in_box      = somma quantità già inserite in box non spediti
    disponibile = richiesto - in_box (quantità ancora da imballare)
    Vengono restituiti SOLO gli EAN presenti in almeno una preparazione attiva.
    """
    preps = await db.preparazioni.find(
        {"cliente_id": cid, "stato": "pronto"},
        {"id": 1}).to_list(5000)
    prep_ids = [p["id"] for p in preps]
    richiesto, sku_map = {}, {}
    if prep_ids:
        righe = await db.preparazioni_righe.find({"preparazione_id": {"$in": prep_ids}}).to_list(50000)
        for r in righe:
            richiesto[r["ean"]] = richiesto.get(r["ean"], 0) + int(r.get("quantita", 0))
            if r.get("sku"):
                sku_map.setdefault(r["ean"], set()).add(r["sku"])

    in_box = {}
    box_list = await db.box.find({"cliente_id": cid}).to_list(5000)
    for b in box_list:
        for c in b.get("contenuto", []):
            in_box[c["ean"]] = in_box.get(c["ean"], 0) + int(c.get("quantita", 0))

    refs = await db.referenze.find({"cliente_id": cid}).to_list(5000)
    titolo_map, bundle_map = {}, {}
    for rf in refs:
        if not rf.get("ean"):
            continue
        titolo_map.setdefault(rf["ean"], rf.get("titolo"))
        if rf.get("is_bundle") and rf.get("componenti"):
            bundle_map[rf["ean"]] = rf["componenti"]

    result = []
    for ean in sorted(richiesto):
        ric = richiesto[ean]
        ib = in_box.get(ean, 0)
        result.append({
            "ean": ean,
            "titolo": titolo_map.get(ean),
            "skus": sorted(sku_map.get(ean, [])),
            "richiesto": ric,
            "in_box": ib,
            "disponibile": ric - ib,
            "is_bundle": ean in bundle_map,
            "componenti": bundle_map.get(ean, []),
        })
    return result


@router.get("/preparato")
async def preparato(cliente_id: Optional[str] = Query(None),
                    user: dict = Depends(get_current_user)):
    if is_staff(user):
        if not cliente_id:
            raise HTTPException(status_code=400, detail="cliente_id richiesto")
        cid = cliente_id
    else:
        cid = user.get("cliente_id")
    return await _preparato_per_cliente(cid)


async def _prep_con_righe(prep: dict) -> dict:
    righe = await db.preparazioni_righe.find({"preparazione_id": prep["id"]}).to_list(1000)
    # Arricchisci ogni riga con FNSKU/titolo/referenza dalla referenza del cliente
    refs = await db.referenze.find({"cliente_id": prep["cliente_id"]}).to_list(5000)
    by_ean_sku, by_ean = {}, {}
    for rf in refs:
        if not rf.get("ean"):
            continue
        by_ean.setdefault(rf["ean"], rf)
        if rf.get("sku"):
            by_ean_sku[(rf["ean"], rf["sku"])] = rf
    prep = _clean(prep)
    out = []
    for r in righe:
        r = _clean(r)
        ref = by_ean_sku.get((r["ean"], r.get("sku"))) or by_ean.get(r["ean"])
        r["fnsku"] = ref.get("fnsku") if ref else None
        r["titolo"] = ref.get("titolo") if ref else None
        r["referenza_id"] = ref.get("id") if ref else None
        out.append(r)
    prep["righe"] = out
    return prep


@router.get("/preparazioni")
async def lista_preparazioni(cliente_id: Optional[str] = Query(None),
                             stato: Optional[str] = Query(None),
                             user: dict = Depends(get_current_user)):
    q = _scope(user)
    if is_staff(user) and cliente_id:
        q["cliente_id"] = cliente_id
    if stato:
        q["stato"] = stato
    docs = await db.preparazioni.find(q).sort("created_at", -1).to_list(2000)
    prep_ids = [d["id"] for d in docs]
    cliente_ids = list({d["cliente_id"] for d in docs})
    righe_map = {}
    if prep_ids:
        all_righe = await db.preparazioni_righe.find({"preparazione_id": {"$in": prep_ids}}).to_list(50000)
        for r in all_righe:
            righe_map.setdefault(r["preparazione_id"], []).append(_clean(r))
    clienti_map = {}
    if cliente_ids:
        all_cli = await db.clienti.find({"id": {"$in": cliente_ids}}).to_list(50000)
        clienti_map = {c["id"]: c for c in all_cli}
    result = []
    for d in docs:
        d = _clean(d)
        d["righe"] = righe_map.get(d["id"], [])
        cli = clienti_map.get(d["cliente_id"])
        d["cliente_ragione_sociale"] = cli["ragione_sociale"] if cli else None
        result.append(d)
    return result


@router.post("/preparazioni")
async def crea_preparazione(payload: M.PreparazioneCreate, user: dict = Depends(get_current_user)):
    cid = _resolve_cliente_id(user, payload.cliente_id)
    prep = M.Preparazione(cliente_id=cid, note=payload.note)
    await db.preparazioni.insert_one(prep.model_dump())
    for r in payload.righe:
        riga = M.PrepRiga(preparazione_id=prep.id, ean=r.ean, sku=r.sku, quantita=r.quantita, servizi=r.servizi)
        await db.preparazioni_righe.insert_one(riga.model_dump())
    return await _prep_con_righe(await db.preparazioni.find_one({"id": prep.id}))


@router.get("/preparazioni/{prep_id}")
async def dettaglio_preparazione(prep_id: str, user: dict = Depends(get_current_user)):
    d = await db.preparazioni.find_one({"id": prep_id})
    if not d:
        raise HTTPException(status_code=404, detail="Preparazione non trovata")
    await _assert_owns_cliente(user, d["cliente_id"])
    out = await _prep_con_righe(d)
    cli = await db.clienti.find_one({"id": d["cliente_id"]})
    out["cliente_ragione_sociale"] = cli["ragione_sociale"] if cli else None
    return out


@router.put("/preparazioni/{prep_id}/stato")
async def cambia_stato_preparazione(prep_id: str, payload: M.StatoUpdate,
                                    user: dict = Depends(require_admin)):
    if payload.stato not in STATI_PREP:
        raise HTTPException(status_code=400, detail="Stato non valido")
    d = await db.preparazioni.find_one({"id": prep_id})
    if not d:
        raise HTTPException(status_code=404, detail="Preparazione non trovata")
    updates = {"stato": payload.stato}
    if payload.stato == "pronto" and not d.get("data_pronto"):
        updates["data_pronto"] = M._now_iso()
    await db.preparazioni.update_one({"id": prep_id}, {"$set": updates})
    return await _prep_con_righe(await db.preparazioni.find_one({"id": prep_id}))


# ============================================================================
# FATTURAZIONE (calcolo costi + PDF) — solo admin/staff
# ============================================================================
_SERV_LABEL = {"fnsku": "Etichettatura FNSKU", "busta": "Busta trasparente",
               "nastratura": "Nastratura", "pluriball": "Protezione pluriball"}


async def _calcola_fattura(cid: str, anno: int, mese: int, pallet: int):
    cli = await db.clienti.find_one({"id": cid})
    if not cli:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    listino = cli.get("listino") or {}

    def prezzo(k):
        return float(listino.get(k, 0) or 0)

    period = f"{anno:04d}-{mese:02d}"
    righe_out = []

    # Servizi dalle preparazioni diventate "pronto" nel periodo
    serv_qty = {"fnsku": 0, "busta": 0, "nastratura": 0, "pluriball": 0}
    preps = await db.preparazioni.find(
        {"cliente_id": cid, "stato": {"$in": ["pronto", "spedito"]}}).to_list(5000)
    prep_ids = [p["id"] for p in preps if (p.get("data_pronto") or "").startswith(period)]
    if prep_ids:
        prighe = await db.preparazioni_righe.find({"preparazione_id": {"$in": prep_ids}}).to_list(50000)
        for r in prighe:
            for s in r.get("servizi", []):
                if s in serv_qty:
                    serv_qty[s] += int(r.get("quantita", 0))
    for s in ["fnsku", "busta", "nastratura", "pluriball"]:
        if serv_qty[s] > 0:
            righe_out.append({"descrizione": _SERV_LABEL[s], "quantita": serv_qty[s],
                              "prezzo": prezzo(s), "importo": round(serv_qty[s] * prezzo(s), 2)})

    # Inscatolamento + costo scatole nostre (box spediti nel periodo)
    box_sped = await db.box.find({"cliente_id": cid, "stato": "spedito"}).to_list(5000)
    box_periodo = [b for b in box_sped if (b.get("data_spedito") or "").startswith(period)]
    nbox = len(box_periodo)
    if nbox > 0:
        righe_out.append({"descrizione": "Inscatolamento (box spediti)", "quantita": nbox,
                          "prezzo": prezzo("inscatolamento"), "importo": round(nbox * prezzo("inscatolamento"), 2)})
    n60 = sum(1 for b in box_periodo if b.get("scatola_tipo") == "60x40x40")
    n40 = sum(1 for b in box_periodo if b.get("scatola_tipo") == "40x30x30")
    if n60 > 0:
        righe_out.append({"descrizione": "Scatola 60×40×40", "quantita": n60,
                          "prezzo": prezzo("scatola_60"), "importo": round(n60 * prezzo("scatola_60"), 2)})
    if n40 > 0:
        righe_out.append({"descrizione": "Scatola 40×30×30", "quantita": n40,
                          "prezzo": prezzo("scatola_40"), "importo": round(n40 * prezzo("scatola_40"), 2)})

    # Entrata merce ricevuta nel periodo (pallet / scatole)
    entrate = await db.entrate.find({"cliente_id": cid}).to_list(5000)
    pallet_colli = scatola_colli = 0
    for e in entrate:
        if (e.get("data_ricezione") or "").startswith(period):
            n = int(e.get("colli", 1) or 1)
            if e.get("tipo") == "pallet":
                pallet_colli += n
            else:
                scatola_colli += n
    if pallet_colli > 0:
        righe_out.append({"descrizione": "Entrata merce (pallet)", "quantita": pallet_colli,
                          "prezzo": prezzo("entrata_pallet"), "importo": round(pallet_colli * prezzo("entrata_pallet"), 2)})
    if scatola_colli > 0:
        righe_out.append({"descrizione": "Entrata merce (scatole)", "quantita": scatola_colli,
                          "prezzo": prezzo("entrata_scatola"), "importo": round(scatola_colli * prezzo("entrata_scatola"), 2)})

    # Stoccaggio: numero pallet (input admin) × prezzo pallet/mese
    if pallet and pallet > 0 and prezzo("stoccaggio_pallet") > 0:
        righe_out.append({"descrizione": "Stoccaggio (pallet/mese)", "quantita": pallet,
                          "prezzo": prezzo("stoccaggio_pallet"), "importo": round(pallet * prezzo("stoccaggio_pallet"), 2)})

    subtotale = round(sum(r["importo"] for r in righe_out), 2)
    iva_perc = float(listino.get("iva", 22) or 0)
    iva_importo = round(subtotale * iva_perc / 100, 2)
    totale = round(subtotale + iva_importo, 2)
    return {"cliente_id": cid, "ragione_sociale": cli.get("ragione_sociale"),
            "periodo": f"{mese:02d}/{anno}", "righe": righe_out,
            "subtotale": subtotale, "iva_perc": iva_perc,
            "iva_importo": iva_importo, "totale": totale}


@router.get("/fatturazione")
async def fatturazione(cliente_id: str = Query(...), anno: int = Query(...),
                       mese: int = Query(...), pallet: int = Query(0),
                       user: dict = Depends(require_admin)):
    return await _calcola_fattura(cliente_id, anno, mese, pallet)


@router.get("/fatturazione/pdf")
async def fatturazione_pdf(cliente_id: str = Query(...), anno: int = Query(...),
                           mese: int = Query(...), pallet: int = Query(0),
                           user: dict = Depends(require_admin)):
    f = await _calcola_fattura(cliente_id, anno, mese, pallet)
    pdf = invoice_gen.genera_fattura_pdf(
        f["ragione_sociale"], f["periodo"], f["righe"],
        f["subtotale"], f["iva_perc"], f["iva_importo"], f["totale"])
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"inline; filename=fattura_{f['periodo'].replace('/', '_')}.pdf"})
