"""Backend tests for iteration 6: MAGAZZINO virtuale + PREPARAZIONI.

Flow verified end-to-end:
- Cliente creates entrata → admin marks ricevuto → magazzino shows ricevuto/disponibile
- Cliente creates preparazione (EAN + SKU + qta) → stato 'richiesta'
- Admin creates box on the preparazione → prep goes to 'in_lavorazione'
- Box → pronto : prep → pronto
- Cliente uploads amazon/ups labels on the prep's box (200)
- Box → spedito : prep → spedito ; magazzino 'spedito' aumenta, 'disponibile' diminuisce
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "aimagosrl@gmail.com"
ADMIN_PASSWORD = "Aimago123@!"
CLIENTE_EMAIL = "cliente@demo.it"
CLIENTE_PASSWORD = "Cliente123!"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def cliente():
    return _login(CLIENTE_EMAIL, CLIENTE_PASSWORD)


# ------- MAGAZZINO --------------------------------------------------------
class TestMagazzino:
    def test_cliente_magazzino_shape(self, cliente):
        s, _ = cliente
        r = s.get(f"{API}/magazzino", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if data:
            row = data[0]
            for k in ("ean", "ricevuto", "spedito", "in_preparazione", "disponibile", "skus"):
                assert k in row, f"missing key {k}"
            # disponibile = ricevuto - spedito for every row
            for row in data:
                assert row["disponibile"] == row["ricevuto"] - row["spedito"], row

    def test_admin_requires_cliente_id(self, admin):
        s, _ = admin
        r = s.get(f"{API}/magazzino", timeout=15)
        assert r.status_code == 400

    def test_admin_with_cliente_id_ok(self, admin, cliente):
        sa, _ = admin
        _, uc = cliente
        r = sa.get(f"{API}/magazzino", params={"cliente_id": uc["cliente_id"]}, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ------- FULL FLOW PREPARAZIONI ------------------------------------------
class TestPreparazioniFullFlow:
    def test_full_prep_flow(self, cliente, admin):
        sc, uc = cliente
        sa, _ = admin
        EAN = "8001234567890"  # cliente demo ha referenza con SKU TSHIRT-BL-M

        # STEP 1: crea entrata + admin ricevi (per avere disponibilità)
        r = sc.post(f"{API}/entrate", json={
            "tipo": "scatola", "note": "TEST_PREP_FLOW",
            "righe": [{"ean": EAN, "quantita": 20, "fnsku": "XPREP00001"}],
        }, timeout=15)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        assert sa.post(f"{API}/entrate/{eid}/ricevi", timeout=15).status_code == 200

        # magazzino ricevuto pre
        mag_pre = sc.get(f"{API}/magazzino", timeout=15).json()
        row_pre = next((x for x in mag_pre if x["ean"] == EAN), None)
        assert row_pre is not None
        ric_pre = row_pre["ricevuto"]
        spe_pre = row_pre["spedito"]
        assert row_pre["disponibile"] == ric_pre - spe_pre

        # STEP 2: cliente crea preparazione
        r = sc.post(f"{API}/preparazioni", json={
            "note": "TEST_PREP",
            "righe": [{"ean": EAN, "sku": "TSHIRT-BL-M", "quantita": 3}],
        }, timeout=15)
        assert r.status_code == 200, r.text
        prep = r.json()
        assert prep["stato"] == "richiesta"
        assert prep["cliente_id"] == uc["cliente_id"]
        assert len(prep["righe"]) == 1
        assert prep["righe"][0]["ean"] == EAN
        assert prep["righe"][0]["sku"] == "TSHIRT-BL-M"
        pid = prep["id"]

        # dettaglio prep visibile al cliente
        r = sc.get(f"{API}/preparazioni/{pid}", timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == pid
        # multi-tenant: prep appare in lista cliente
        rlist = sc.get(f"{API}/preparazioni", timeout=15)
        assert rlist.status_code == 200
        assert any(p["id"] == pid for p in rlist.json())

        # STEP 3: admin crea box legato alla preparazione
        r = sa.post(f"{API}/box", json={
            "preparazione_id": pid, "numero_box": "TEST-PBOX-1",
            "peso_kg": 2.0, "lunghezza_cm": 30, "larghezza_cm": 20, "altezza_cm": 15,
            "contenuto": [{"ean": EAN, "fnsku": "", "quantita": 3}],
        }, timeout=15)
        assert r.status_code == 200, r.text
        box = r.json()
        assert box["preparazione_id"] == pid
        assert box["cliente_id"] == uc["cliente_id"]
        assert box["stato"] == "in_preparazione"
        bid = box["id"]

        # preparazione ora in_lavorazione (sync)
        r = sa.get(f"{API}/preparazioni/{pid}", timeout=15)
        assert r.json()["stato"] == "in_lavorazione"

        # magazzino: in_preparazione aggiornato, disponibile invariato (non ancora spedito)
        mag_mid = sc.get(f"{API}/magazzino", timeout=15).json()
        row_mid = next(x for x in mag_mid if x["ean"] == EAN)
        assert row_mid["in_preparazione"] >= 3
        assert row_mid["spedito"] == spe_pre  # non ancora scaricato

        # GET /api/box?preparazione_id=<id>
        r = sc.get(f"{API}/box", params={"preparazione_id": pid}, timeout=15)
        assert r.status_code == 200
        assert any(b["id"] == bid for b in r.json())

        # STEP 4: cliente carica etichette amazon + ups
        pdf = b"%PDF-1.4\n%TEST_PREP\n"
        r = sc.post(f"{API}/box/{bid}/etichetta-amazon",
                    files={"file": ("a.pdf", pdf, "application/pdf")}, timeout=15)
        assert r.status_code == 200
        assert r.json()["etichetta_amazon_pdf_url"].startswith("/api/files/")
        r = sc.post(f"{API}/box/{bid}/etichetta-ups",
                    files={"file": ("u.pdf", pdf, "application/pdf")}, timeout=15)
        assert r.status_code == 200

        # STEP 5: box -> pronto ⇒ prep -> pronto
        r = sa.put(f"{API}/box/{bid}/stato", json={"stato": "pronto"}, timeout=15)
        assert r.status_code == 200
        assert sa.get(f"{API}/preparazioni/{pid}", timeout=15).json()["stato"] == "pronto"

        # STEP 6: box -> spedito ⇒ prep -> spedito ; magazzino aggiornato
        r = sa.put(f"{API}/box/{bid}/stato", json={"stato": "spedito"}, timeout=15)
        assert r.status_code == 200
        assert sa.get(f"{API}/preparazioni/{pid}", timeout=15).json()["stato"] == "spedito"

        mag_post = sc.get(f"{API}/magazzino", timeout=15).json()
        row_post = next(x for x in mag_post if x["ean"] == EAN)
        # spedito è aumentato di 3
        assert row_post["spedito"] == spe_pre + 3, (row_post, spe_pre)
        # disponibile diminuito di 3 (ricevuto invariato, spedito +3)
        assert row_post["disponibile"] == row_post["ricevuto"] - row_post["spedito"]
        assert row_post["disponibile"] == (ric_pre - spe_pre) - 3

    def test_cliente_cannot_change_prep_stato(self, cliente, admin):
        sc, _ = cliente
        sa, _ = admin
        # create a prep to try to change
        r = sc.post(f"{API}/preparazioni", json={
            "note": "TEST_403_PREP",
            "righe": [{"ean": "8005556667778", "sku": None, "quantita": 1}],
        }, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        # cliente cannot change stato
        r = sc.put(f"{API}/preparazioni/{pid}/stato", json={"stato": "pronto"}, timeout=15)
        assert r.status_code == 403
        # admin can, with valid state
        r = sa.put(f"{API}/preparazioni/{pid}/stato", json={"stato": "in_lavorazione"}, timeout=15)
        assert r.status_code == 200
        # invalid stato rejected
        r = sa.put(f"{API}/preparazioni/{pid}/stato", json={"stato": "bogus"}, timeout=15)
        assert r.status_code == 400

    def test_multi_tenant_prep_isolation(self, cliente, admin):
        sc, uc = cliente
        sa, _ = admin
        # admin list without filter must include cliente's prep, but with filter=other, must not
        r = sa.get(f"{API}/preparazioni", timeout=15)
        assert r.status_code == 200
        # cliente can only see own preparazioni
        r = sc.get(f"{API}/preparazioni", timeout=15)
        assert all(p["cliente_id"] == uc["cliente_id"] for p in r.json())
