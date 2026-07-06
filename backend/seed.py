"""Seeding: crea l'account admin e dati di esempio (idempotente)."""
import os
from datetime import datetime, timezone

from db import db
from auth import hash_password, verify_password
import models as M


def _clean_env(v: str) -> str:
    """Rimuove spazi e virgolette residue (in produzione il valore del .env
    può arrivare con le virgolette incluse, causando password non corrispondenti)."""
    if v is None:
        return v
    return v.strip().strip('"').strip("'")


async def _ensure_admin():
    email = _clean_env(os.environ.get("ADMIN_EMAIL", "admin@prepcenter.it")).lower()
    password = _clean_env(os.environ.get("ADMIN_PASSWORD", "Admin123!"))
    existing = await db.users.find_one({"email": email})
    if existing is None:
        await db.users.insert_one({
            "email": email, "password_hash": hash_password(password),
            "name": "Admin Prep Center", "role": "admin",
            "created_at": M._now_iso(),
        })
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email},
                                  {"$set": {"password_hash": hash_password(password)}})


async def _ensure_demo_data():
    """Crea un cliente demo con referenze, un'entrata e un box (solo se assente)."""
    demo_email = "cliente@demo.it"
    if await db.users.find_one({"email": demo_email}):
        return

    cliente = M.Cliente(ragione_sociale="Demo Store SRL", email=demo_email,
                        user_id="", note="Cliente di esempio")
    res = await db.users.insert_one({
        "email": demo_email, "password_hash": hash_password("Cliente123!"),
        "name": "Demo Store SRL", "role": "cliente", "cliente_id": cliente.id,
        "created_at": M._now_iso(),
    })
    cliente.user_id = str(res.inserted_id)
    await db.clienti.insert_one(cliente.model_dump())

    referenze = [
        M.Referenza(cliente_id=cliente.id, ean="8001234567890", sku="TSHIRT-BL-M",
                    asin="B08XYZ1234", titolo="T-Shirt Cotone Blu Taglia M",
                    fnsku="X001ABCDE1", origine="manuale"),
        M.Referenza(cliente_id=cliente.id, ean="8009876543210", sku="MUG-CER-01",
                    asin="B09ABC5678", titolo="Tazza Ceramica 350ml",
                    fnsku="X002FGHIJ2", origine="manuale"),
        M.Referenza(cliente_id=cliente.id, ean="8005556667778", sku="CABLE-USBC",
                    asin="B07QWE9012", titolo="Cavo USB-C 2m",
                    origine="import"),
    ]
    for r in referenze:
        await db.referenze.insert_one(r.model_dump())

    entrata = M.Entrata(cliente_id=cliente.id, tipo="pallet",
                        note="Primo invio di prova")
    await db.entrate.insert_one(entrata.model_dump())
    righe = [
        M.RigaEntrata(entrata_id=entrata.id, ean="8001234567890",
                      quantita=50, fnsku="X001ABCDE1"),
        M.RigaEntrata(entrata_id=entrata.id, ean="8009876543210",
                      quantita=30, fnsku="X002FGHIJ2"),
        M.RigaEntrata(entrata_id=entrata.id, ean="8005556667778",
                      quantita=100, fnsku=None),
    ]
    for rg in righe:
        await db.entrate_righe.insert_one(rg.model_dump())


async def _ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.clienti.create_index("id", unique=True)
    await db.referenze.create_index("cliente_id")
    await db.entrate.create_index("cliente_id")
    await db.entrate_righe.create_index("entrata_id")
    await db.box.create_index("cliente_id")
    await db.files.create_index("id", unique=True)


async def _write_test_credentials():
    path = "/app/memory/test_credentials.md"
    content = f"""# Test Credentials

## Admin (staff)
- Email: {_clean_env(os.environ.get('ADMIN_EMAIL', 'admin@prepcenter.it'))}
- Password: {_clean_env(os.environ.get('ADMIN_PASSWORD', 'Admin123!'))}
- Role: admin

## Clienti
- Gestiti dall'admin (password impostata alla creazione)

## Auth endpoints
- POST /api/auth/login
- POST /api/auth/logout
- GET  /api/auth/me
- POST /api/auth/refresh
"""
    try:
        with open(path, "w") as f:
            f.write(content)
    except Exception:
        pass


async def run_seed():
    await _ensure_indexes()
    await _ensure_admin()
    await _write_test_credentials()
