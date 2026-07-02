"""Iteration 7 tests: auto-refresh on 401 + 403/404 handling on deep-link detail endpoints."""
import os
import time
import pytest
import requests
from pathlib import Path

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v: return v
    env = Path("/app/frontend/.env")
    for line in env.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("REACT_APP_BACKEND_URL non trovato")

BASE_URL = _load_backend_url().rstrip("/") + "/api"
ADMIN = {"email": "aimagosrl@gmail.com", "password": "Aimago123@!"}
CLIENTE = {"email": "cliente@demo.it", "password": "Cliente123!"}
AVESTA_ENTRATA = "8bc9cd30-0543-4a06-9af8-2f88c51187f3"


def _login(payload):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/auth/login", json=payload, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    assert "access_token" in s.cookies, "access_token cookie missing"
    assert "refresh_token" in s.cookies, "refresh_token cookie missing"
    return s


# --- 1. Login sets httpOnly cookies & /auth/me works ------------------------
def test_login_sets_cookies_and_me_works():
    s = _login(CLIENTE)
    me = s.get(f"{BASE_URL}/auth/me", timeout=15)
    assert me.status_code == 200
    data = me.json()
    assert data["email"] == CLIENTE["email"]
    assert data["role"] == "cliente"


# --- 2. Refresh flow: POST /auth/refresh renews access_token ---------------
def test_refresh_endpoint_renews_access_token():
    s = _login(CLIENTE)
    old_access = s.cookies.get("access_token")
    # sleep 1s so exp field differs
    time.sleep(1)
    r = s.post(f"{BASE_URL}/auth/refresh", timeout=15)
    assert r.status_code == 200, r.text
    new_access = s.cookies.get("access_token")
    assert new_access, "new access_token cookie not set"
    assert new_access != old_access, "access_token should be rotated"
    # refresh_token should still be present
    assert s.cookies.get("refresh_token"), "refresh_token should persist"
    # protected call still works
    me = s.get(f"{BASE_URL}/auth/me", timeout=15)
    assert me.status_code == 200


def test_refresh_without_refresh_token_returns_401():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/auth/refresh", timeout=15)
    assert r.status_code == 401


def test_refresh_rejects_access_token_as_refresh():
    s = _login(CLIENTE)
    access = s.cookies.get("access_token")
    # send access token in the refresh_token cookie slot
    s2 = requests.Session()
    s2.cookies.set("refresh_token", access, domain=s.cookies.list_domains()[0])
    r = s2.post(f"{BASE_URL}/auth/refresh", timeout=15)
    assert r.status_code == 401


# --- 3. Auto-refresh simulation: expired access + valid refresh -----------
def test_expired_access_with_valid_refresh_allows_recovery():
    """Simula quello che l'axios interceptor fa: access invalido -> 401 -> POST /auth/refresh -> retry."""
    s = _login(CLIENTE)
    # forgio un access_token invalido: rimuovo quello valido e ne setto uno rotto
    del s.cookies["access_token"]
    s.cookies.set("access_token", "invalid.jwt.token", domain=list(s.cookies.list_domains())[0], path="/")
    # richiesta protetta -> 401
    r1 = s.get(f"{BASE_URL}/auth/me", timeout=15)
    assert r1.status_code == 401
    # ora chiama /auth/refresh -> deve tornare 200 e reimpostare access_token
    r2 = s.post(f"{BASE_URL}/auth/refresh", timeout=15)
    assert r2.status_code == 200, r2.text
    new_access = r2.cookies.get("access_token") or s.cookies.get("access_token")
    assert new_access and new_access != "invalid.jwt.token"
    # retry con nuova session pulita che ha solo il nuovo access_token
    s2 = requests.Session()
    domain = list(s.cookies.list_domains())[0]
    s2.cookies.set("access_token", new_access, domain=domain, path="/")
    r3 = s2.get(f"{BASE_URL}/auth/me", timeout=15)
    assert r3.status_code == 200


# --- 4. Deep-link: entrata di altro cliente -> 403 ------------------------
def test_deeplink_entrata_altro_cliente_returns_403():
    s = _login(CLIENTE)
    r = s.get(f"{BASE_URL}/entrate/{AVESTA_ENTRATA}", timeout=15)
    # Deve essere 403 (accessibile ma non tuo) o 404 se non esiste
    assert r.status_code in (403, 404), f"got {r.status_code}: {r.text}"


def test_deeplink_entrata_inesistente_returns_404():
    s = _login(CLIENTE)
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = s.get(f"{BASE_URL}/entrate/{fake_id}", timeout=15)
    assert r.status_code == 404


def test_deeplink_preparazione_inesistente_returns_404():
    s = _login(CLIENTE)
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = s.get(f"{BASE_URL}/preparazioni/{fake_id}", timeout=15)
    assert r.status_code == 404


# --- 5. Regressione: admin + cliente login + endpoints principali ---------
def test_admin_login_and_endpoints():
    s = _login(ADMIN)
    me = s.get(f"{BASE_URL}/auth/me").json()
    assert me["role"] in ("admin", "staff")
    for path in ("/clienti", "/entrate", "/preparazioni"):
        r = s.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} -> {r.status_code}"


def test_cliente_endpoints_ok():
    s = _login(CLIENTE)
    for path in ("/referenze", "/entrate", "/magazzino", "/preparazioni"):
        r = s.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} -> {r.status_code}"


# --- 6. Anti-loop: /auth/refresh senza cookie non deve loopare -----------
def test_no_infinite_loop_on_refresh_failure():
    """Se /auth/refresh torna 401, l'interceptor NON deve richiamarsi (isAuthCall guard)."""
    s = requests.Session()
    # 3 chiamate sequenziali - devono tutte tornare 401 velocemente
    for _ in range(3):
        r = s.post(f"{BASE_URL}/auth/refresh", timeout=10)
        assert r.status_code == 401
