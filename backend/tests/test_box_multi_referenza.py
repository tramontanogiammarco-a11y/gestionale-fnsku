"""Iteration 8: verify Box creation supports multi-referenza (contenuto list of >1 EAN)."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://prep-center-control.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("aimagosrl@gmail.com", "Aimago123@!")
CLI = ("cliente@demo.it", "Cliente123!")


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def cliente():
    return _login(*CLI)


def test_referenze_endpoint_admin_filter_by_cliente(admin, cliente):
    sa, _ = admin
    sc, uc = cliente
    r = sa.get(f"{API}/referenze?cliente_id={uc['cliente_id']}", timeout=15)
    assert r.status_code == 200, r.text
    refs = r.json()
    # demo has 3 referenze
    eans = {x["ean"] for x in refs}
    assert "8001234567890" in eans
    assert "8009876543210" in eans
    # ensure FNSKU present per demo (may be null on some)
    ref_map = {x["ean"]: x for x in refs}
    assert ref_map["8001234567890"]["fnsku"] == "X001ABCDE1"
    assert ref_map["8009876543210"]["fnsku"] == "X002FGHIJ2"


def test_create_box_multi_referenza_persists_two_items(admin, cliente):
    sa, _ = admin
    sc, uc = cliente
    # 1) cliente creates entrata with the two EAN used later in the box
    payload = {
        "tipo": "scatola",
        "note": "TEST_Iter8_multi",
        "righe": [
            {"ean": "8001234567890", "quantita": 5, "fnsku": "X001ABCDE1"},
            {"ean": "8009876543210", "quantita": 7, "fnsku": "X002FGHIJ2"},
        ],
    }
    r = sc.post(f"{API}/entrate", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    # 2) admin marks ricevuto
    r = sa.post(f"{API}/entrate/{eid}/ricevi", timeout=15)
    assert r.status_code == 200
    assert r.json()["stato"] == "ricevuto"
    # 3) admin creates box with dims + weight + 2 references
    numero = f"TEST-MULTI-{int(time.time())}"
    box_payload = {
        "entrata_id": eid,
        "numero_box": numero,
        "peso_kg": 14,
        "lunghezza_cm": 60,
        "larghezza_cm": 40,
        "altezza_cm": 40,
        "contenuto": [
            {"ean": "8001234567890", "fnsku": "X001ABCDE1", "quantita": 3},
            {"ean": "8009876543210", "fnsku": "X002FGHIJ2", "quantita": 4},
        ],
    }
    r = sa.post(f"{API}/box", json=box_payload, timeout=15)
    assert r.status_code == 200, r.text
    box = r.json()
    assert box["numero_box"] == numero
    assert box["peso_kg"] == 14
    assert box["lunghezza_cm"] == 60
    assert box["larghezza_cm"] == 40
    assert box["altezza_cm"] == 40
    assert len(box["contenuto"]) == 2
    cont_map = {c["ean"]: c for c in box["contenuto"]}
    assert cont_map["8001234567890"]["quantita"] == 3
    assert cont_map["8001234567890"]["fnsku"] == "X001ABCDE1"
    assert cont_map["8009876543210"]["quantita"] == 4
    assert cont_map["8009876543210"]["fnsku"] == "X002FGHIJ2"
    # 4) verify GET /box?entrata_id
    r = sa.get(f"{API}/box?entrata_id={eid}", timeout=15)
    assert r.status_code == 200
    boxes = r.json()
    match = [b for b in boxes if b["id"] == box["id"]]
    assert len(match) == 1
    b = match[0]
    assert len(b["contenuto"]) == 2
    assert b["peso_kg"] == 14
    assert b["lunghezza_cm"] == 60


def test_create_box_third_ean_without_fnsku(admin, cliente):
    sa, _ = admin
    sc, uc = cliente
    # entrata with a third ean, no FNSKU in referenze
    r = sc.post(f"{API}/entrate", json={
        "tipo": "scatola", "note": "TEST_Iter8_noFnsku",
        "righe": [{"ean": "8005556667778", "quantita": 2}],
    }, timeout=15)
    eid = r.json()["id"]
    sa.post(f"{API}/entrate/{eid}/ricevi", timeout=15)
    r = sa.post(f"{API}/box", json={
        "entrata_id": eid, "numero_box": f"TEST-NOFN-{int(time.time())}",
        "peso_kg": 2, "lunghezza_cm": 20, "larghezza_cm": 20, "altezza_cm": 20,
        "contenuto": [{"ean": "8005556667778", "fnsku": "", "quantita": 2}],
    }, timeout=15)
    assert r.status_code == 200, r.text
    box = r.json()
    assert len(box["contenuto"]) == 1
    assert box["contenuto"][0]["ean"] == "8005556667778"
