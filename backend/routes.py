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
from importer import parse_referenze_file

router = APIRouter(prefix="/api", tags=["app"])

STATI_ENTRATA = ["in_attesa", "ricevuto", "in_lavorazione", "pronto", "spedito"]
STATI_BOX = ["in_preparazione", "pronto", "spedito"]


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
                        user_id="", note=payload.note)
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
    ref = M.Referenza(
        cliente_id=cid, ean=payload.ean, sku=payload.sku, asin=payload.asin,
        titolo=payload.titolo, fnsku=payload.fnsku, foto_url=payload.foto_url,
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
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.referenze.update_one({"id": ref_id}, {"$set": updates})
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
        all_righe = await db.entrate_righe.find({"entrata_id": {"$in": entrata_ids}}).to_list(None)
        for r in all_righe:
            righe_map.setdefault(r["entrata_id"], []).append(_clean(r))
    clienti_map = {}
    if cliente_ids:
        all_cli = await db.clienti.find({"id": {"$in": cliente_ids}}).to_list(None)
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
    entrata = M.Entrata(cliente_id=cid, tipo=payload.tipo, ddt=payload.ddt,
                        tracking=payload.tracking, note=payload.note)
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


@router.get("/box")
async def lista_box(cliente_id: Optional[str] = Query(None),
                    entrata_id: Optional[str] = Query(None),
                    stato: Optional[str] = Query(None),
                    user: dict = Depends(get_current_user)):
    q = _scope(user)
    if is_staff(user) and cliente_id:
        q["cliente_id"] = cliente_id
    if entrata_id:
        q["entrata_id"] = entrata_id
    if stato:
        q["stato"] = stato
    docs = await db.box.find(q).sort("created_at", -1).to_list(2000)
    cliente_ids = list({d["cliente_id"] for d in docs})
    clienti_map = {}
    if cliente_ids:
        all_cli = await db.clienti.find({"id": {"$in": cliente_ids}}).to_list(None)
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
    if not cid:
        raise HTTPException(status_code=400, detail="cliente_id o entrata_id richiesto")

    box = M.Box(entrata_id=payload.entrata_id, cliente_id=cid,
                numero_box=payload.numero_box, peso_kg=payload.peso_kg,
                lunghezza_cm=payload.lunghezza_cm, larghezza_cm=payload.larghezza_cm,
                altezza_cm=payload.altezza_cm, contenuto=payload.contenuto)
    await db.box.insert_one(box.model_dump())
    if payload.entrata_id:
        await _sync_stato_entrata(payload.entrata_id)
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
    await db.box.update_one({"id": box_id}, {"$set": {"stato": payload.stato}})
    await _sync_stato_entrata(d.get("entrata_id"))
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
