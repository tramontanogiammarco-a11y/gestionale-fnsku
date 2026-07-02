"""Backend regression tests for Prep Center FBA.

Covers: auth (login/me/logout), multi-tenancy scoping, dashboard stats,
referenze CRUD + import CSV, entrate + ricevi + stato + FNSKU, box create
+ stato + upload etichette, generazione etichette PDF, creazione cliente.
"""
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://prep-center-control.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@prepcenter.it"
ADMIN_PASSWORD = "Admin123!"
CLIENTE_EMAIL = "cliente@demo.it"
CLIENTE_PASSWORD = "Cliente123!"


# ------------------------------ FIXTURES ---------------------------------
def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s, r.json()


@pytest.fixture(scope="session")
def admin():
    s, u = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return s, u


@pytest.fixture(scope="session")
def cliente():
    s, u = _login(CLIENTE_EMAIL, CLIENTE_PASSWORD)
    return s, u


# ------------------------------ AUTH -------------------------------------
class TestAuth:
    def test_root_alive(self):
        r = requests.get(f"{API}/", timeout=15)
        assert r.status_code == 200

    def test_login_admin(self):
        s, u = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert u["role"] == "admin"
        assert u["email"] == ADMIN_EMAIL
        # cookies must be set (httpOnly cannot be read via JS, but the jar has it)
        assert "access_token" in s.cookies.get_dict()

    def test_login_cliente(self):
        s, u = _login(CLIENTE_EMAIL, CLIENTE_PASSWORD)
        assert u["role"] == "cliente"
        assert u.get("cliente_id")

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_admin(self, admin):
        s, _ = admin
        r = s.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"


# ------------------------------ DASHBOARD --------------------------------
class TestDashboard:
    def test_admin_stats(self, admin):
        s, _ = admin
        r = s.get(f"{API}/dashboard/stats", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "entrate_per_stato" in d
        assert set(["in_attesa", "ricevuto", "in_lavorazione", "pronto", "spedito"]) \
               <= set(d["entrate_per_stato"].keys())
        assert d.get("totale_clienti") is not None  # admin sees clients count

    def test_cliente_stats_no_clienti_count(self, cliente):
        s, _ = cliente
        r = s.get(f"{API}/dashboard/stats", timeout=15)
        assert r.status_code == 200
        assert r.json().get("totale_clienti") is None


# ------------------------------ MULTI-TENANCY -----------------------------
class TestMultiTenancy:
    def test_cliente_cannot_list_clienti(self, cliente):
        s, _ = cliente
        r = s.get(f"{API}/clienti", timeout=15)
        assert r.status_code == 403

    def test_cliente_only_sees_own_referenze(self, cliente, admin):
        sc, uc = cliente
        sa, _ = admin
        # cliente listing
        r_cli = sc.get(f"{API}/referenze", timeout=15)
        assert r_cli.status_code == 200
        cli_refs = r_cli.json()
        assert all(x["cliente_id"] == uc["cliente_id"] for x in cli_refs)
        # admin listing includes at least as many
        r_adm = sa.get(f"{API}/referenze", timeout=15)
        assert r_adm.status_code == 200
        assert len(r_adm.json()) >= len(cli_refs)

    def test_cliente_only_sees_own_entrate(self, cliente):
        sc, uc = cliente
        r = sc.get(f"{API}/entrate", timeout=15)
        assert r.status_code == 200
        for e in r.json():
            assert e["cliente_id"] == uc["cliente_id"]


# ------------------------------ REFERENZE --------------------------------
class TestReferenze:
    def test_cliente_create_and_get(self, cliente):
        s, u = cliente
        payload = {"ean": "8000000000001", "titolo": "TEST_Ref_A", "sku": "SKU1"}
        r = s.post(f"{API}/referenze", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ean"] == "8000000000001"
        assert d["cliente_id"] == u["cliente_id"]
        # verify via list
        r2 = s.get(f"{API}/referenze", timeout=15)
        assert any(x["id"] == d["id"] for x in r2.json())

    def test_import_csv_ok(self, cliente):
        s, _ = cliente
        csv_bytes = (
            "EAN,SKU,ASIN,Titolo\n"
            "8000000000010,SKU-A,B0AAA00001,TEST_ImpA\n"
            "8000000000011,SKU-B,B0BBB00002,TEST_ImpB\n"
            ",SKU-C,B0CCC00003,TEST_NoEan\n"
        ).encode("utf-8")
        files = {"file": ("ref.csv", csv_bytes, "text/csv")}
        r = s.post(f"{API}/referenze/import", files=files, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["inseriti"] == 2
        assert len(data["errori"]) == 1

    def test_import_csv_missing_ean_column(self, cliente):
        s, _ = cliente
        csv_bytes = b"SKU,Titolo\nSKU1,TEST_NoEAN\n"
        files = {"file": ("no_ean.csv", csv_bytes, "text/csv")}
        r = s.post(f"{API}/referenze/import", files=files, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["inseriti"] == 0
        assert any("EAN" in e.get("errore", "") for e in data["errori"])


# ------------------------------ ENTRATE + BOX end-to-end -----------------
# Combined into one class to keep on same xdist worker (loadscope) with shared state.
class TestEntrateBoxFlow:
    def test_full_flow_entrata_box(self, cliente, admin):
        sc, uc = cliente
        sa, _ = admin

        # 1) cliente creates entrata
        payload = {"tipo": "scatola", "note": "TEST_Entrata",
                   "righe": [{"ean": "8001234567890", "quantita": 10, "fnsku": "X001ABCDE1"}]}
        r = sc.post(f"{API}/entrate", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["stato"] == "in_attesa"
        assert d["cliente_id"] == uc["cliente_id"]
        assert len(d["righe"]) == 1
        eid = d["id"]
        riga_id = d["righe"][0]["id"]

        # 2) cliente CANNOT ricevi
        assert sc.post(f"{API}/entrate/{eid}/ricevi", timeout=15).status_code == 403

        # 3) admin marks ricevuto
        r = sa.post(f"{API}/entrate/{eid}/ricevi", timeout=15)
        assert r.status_code == 200
        assert r.json()["stato"] == "ricevuto"
        assert r.json()["data_ricezione"]

        # 4) update FNSKU on riga
        r = sa.put(f"{API}/entrate-righe/{riga_id}",
                   json={"fnsku": "X999NEWFN1"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["fnsku"] == "X999NEWFN1"

        # 5) invalid stato rejected
        r = sa.put(f"{API}/entrate/{eid}/stato",
                   json={"stato": "invalid_state"}, timeout=15)
        assert r.status_code == 400

        # 6) admin creates box on entrata
        r = sa.post(f"{API}/box", json={
            "entrata_id": eid, "numero_box": "TEST-BOX-1",
            "peso_kg": 3.5, "lunghezza_cm": 40, "larghezza_cm": 30, "altezza_cm": 25,
            "contenuto": [{"ean": "8001234567890", "fnsku": "X001ABCDE1", "quantita": 5}]
        }, timeout=15)
        assert r.status_code == 200, r.text
        box = r.json()
        assert box["stato"] == "in_preparazione"
        bid = box["id"]

        # 7) box -> pronto, entrata should become pronto
        r = sa.put(f"{API}/box/{bid}/stato", json={"stato": "pronto"}, timeout=15)
        assert r.status_code == 200
        e = sa.get(f"{API}/entrate/{eid}", timeout=15).json()
        assert e["stato"] == "pronto"

        # 8) cliente uploads amazon + ups labels
        pdf = b"%PDF-1.4\n%TEST\n"
        r = sc.post(f"{API}/box/{bid}/etichetta-amazon",
                    files={"file": ("a.pdf", pdf, "application/pdf")}, timeout=15)
        assert r.status_code == 200
        assert r.json()["etichetta_amazon_pdf_url"].startswith("/api/files/")
        r = sc.post(f"{API}/box/{bid}/etichetta-ups",
                    files={"file": ("u.pdf", pdf, "application/pdf")}, timeout=15)
        assert r.status_code == 200

        # 9) box -> spedito, entrata should sync to spedito
        r = sa.put(f"{API}/box/{bid}/stato", json={"stato": "spedito"}, timeout=15)
        assert r.status_code == 200
        e = sa.get(f"{API}/entrate/{eid}", timeout=15).json()
        assert e["stato"] == "spedito"


# ------------------------------ ETICHETTE FNSKU -------------------------
class TestEtichette:
    def test_formati(self, admin):
        s, _ = admin
        r = s.get(f"{API}/etichette/formati", timeout=15)
        assert r.status_code == 200
        formati = r.json()["formati"]
        for f in ["50x30", "60x30", "100x50", "40x20"]:
            assert f in formati

    def test_genera_pdf_ok(self, admin):
        s, _ = admin
        payload = {"items": [{"fnsku": "X001ABCDE1", "titolo": "TEST", "copie": 2}],
                   "formato": "50x30", "mostra_titolo": True}
        r = s.post(f"{API}/etichette/genera", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_genera_invalid_fnsku(self, admin):
        s, _ = admin
        # non-ASCII char (é) is not valid Code128
        payload = {"items": [{"fnsku": "X001\u00e9BAD", "titolo": "t", "copie": 1}],
                   "formato": "50x30"}
        r = s.post(f"{API}/etichette/genera", json=payload, timeout=15)
        assert r.status_code == 400
        assert "non validi" in r.json().get("detail", "").lower() \
               or "non valid" in r.json().get("detail", "").lower()

    def test_cliente_cannot_generate(self, cliente):
        s, _ = cliente
        payload = {"items": [{"fnsku": "X001ABCDE1"}], "formato": "50x30"}
        r = s.post(f"{API}/etichette/genera", json=payload, timeout=15)
        assert r.status_code == 403


# ------------------------------ CLIENTI CRUD ----------------------------
class TestClienti:
    def test_admin_create_cliente_and_login(self, admin):
        s, _ = admin
        unique = f"test{int(time.time())}@example.com"
        payload = {"ragione_sociale": "TEST_Cliente_SRL",
                   "email": unique, "password": "Testpass1!"}
        r = s.post(f"{API}/clienti", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == unique
        # new cliente can login
        s2, u2 = _login(unique, "Testpass1!")
        assert u2["role"] == "cliente"
        assert u2["cliente_id"] == d["id"]

    def test_admin_create_cliente_duplicate(self, admin):
        s, _ = admin
        r = s.post(f"{API}/clienti", json={
            "ragione_sociale": "dup", "email": ADMIN_EMAIL, "password": "x"
        }, timeout=15)
        assert r.status_code == 400
