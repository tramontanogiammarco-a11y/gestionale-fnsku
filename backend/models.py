"""Modelli Pydantic per il gestionale prep center.

Gli ID delle entita' di business sono UUID (stringhe) per evitare problemi di
serializzazione con ObjectId. La collezione `users` usa invece _id di Mongo
(gestita in auth.py secondo il playbook di autenticazione).
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field, EmailStr


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# CLIENTI
# ---------------------------------------------------------------------------
class Listino(BaseModel):
    """Prezzi personalizzati per cliente (in euro)."""
    fnsku: float = 0.10            # €/pezzo
    busta: float = 0.0            # €/pezzo (busta trasparente)
    nastratura: float = 0.0       # €/pezzo
    pluriball: float = 0.0        # €/pezzo
    inscatolamento: float = 0.0   # €/box spedito ad Amazon
    stoccaggio_pallet: float = 0.0  # €/pallet al mese
    entrata_pallet: float = 0.0   # €/pallet in entrata
    entrata_scatola: float = 0.0  # €/scatola in entrata
    iva: float = 22.0             # % IVA


class ClienteCreate(BaseModel):
    ragione_sociale: str
    email: EmailStr
    password: str
    note: Optional[str] = None
    listino: Optional[Listino] = None


class ClienteUpdate(BaseModel):
    ragione_sociale: Optional[str] = None
    note: Optional[str] = None
    listino: Optional[Listino] = None


class Cliente(BaseModel):
    id: str = Field(default_factory=_uuid)
    ragione_sociale: str
    email: str
    user_id: str
    note: Optional[str] = None
    listino: Listino = Field(default_factory=Listino)
    created_at: str = Field(default_factory=_now_iso)


# ---------------------------------------------------------------------------
# REFERENZE (prodotti del cliente)
# ---------------------------------------------------------------------------
class ReferenzaCreate(BaseModel):
    cliente_id: Optional[str] = None  # richiesto solo per admin
    ean: str
    sku: Optional[str] = None
    asin: Optional[str] = None
    titolo: str
    fnsku: Optional[str] = None
    foto_url: Optional[str] = None


class ReferenzaUpdate(BaseModel):
    ean: Optional[str] = None
    sku: Optional[str] = None
    asin: Optional[str] = None
    titolo: Optional[str] = None
    fnsku: Optional[str] = None
    foto_url: Optional[str] = None


class Referenza(BaseModel):
    id: str = Field(default_factory=_uuid)
    cliente_id: str
    ean: str
    sku: Optional[str] = None
    asin: Optional[str] = None
    titolo: str
    foto_url: Optional[str] = None
    fnsku: Optional[str] = None
    origine: str = "manuale"  # "manuale" | "import"
    created_at: str = Field(default_factory=_now_iso)


# ---------------------------------------------------------------------------
# ENTRATE (arrivi merce) + righe
# ---------------------------------------------------------------------------
class RigaEntrataInput(BaseModel):
    ean: str
    quantita: int
    fnsku: Optional[str] = None


class EntrataCreate(BaseModel):
    cliente_id: Optional[str] = None  # richiesto solo per admin
    tipo: str  # "pallet" | "scatola"
    colli: int = 1  # numero di pallet o scatole in arrivo (per fatturazione entrata)
    ddt: Optional[str] = None  # numero DDT (documento di trasporto)
    tracking: Optional[str] = None  # codice tracking corriere
    note: Optional[str] = None
    righe: List[RigaEntrataInput] = []


class Entrata(BaseModel):
    id: str = Field(default_factory=_uuid)
    cliente_id: str
    tipo: str
    colli: int = 1
    ddt: Optional[str] = None
    tracking: Optional[str] = None
    stato: str = "in_attesa"  # in_attesa|ricevuto|in_lavorazione|pronto|spedito
    data_annuncio: str = Field(default_factory=_now_iso)
    data_ricezione: Optional[str] = None
    note: Optional[str] = None


class RigaEntrata(BaseModel):
    id: str = Field(default_factory=_uuid)
    entrata_id: str
    ean: str
    quantita: int
    fnsku: Optional[str] = None


class RigaFnskuUpdate(BaseModel):
    fnsku: Optional[str] = None


class StatoUpdate(BaseModel):
    stato: str


# ---------------------------------------------------------------------------
# BOX + contenuto (contenuto embedded come array nel box)
# ---------------------------------------------------------------------------
class BoxContenutoInput(BaseModel):
    ean: str
    fnsku: Optional[str] = ""
    sku: Optional[str] = None
    quantita: int


class BoxCreate(BaseModel):
    entrata_id: Optional[str] = None
    preparazione_id: Optional[str] = None
    cliente_id: Optional[str] = None  # richiesto solo per admin se manca entrata_id/preparazione_id
    numero_box: str
    peso_kg: Optional[float] = None
    lunghezza_cm: Optional[float] = None
    larghezza_cm: Optional[float] = None
    altezza_cm: Optional[float] = None
    contenuto: List[BoxContenutoInput] = []


class BoxUpdate(BaseModel):
    numero_box: Optional[str] = None
    peso_kg: Optional[float] = None
    lunghezza_cm: Optional[float] = None
    larghezza_cm: Optional[float] = None
    altezza_cm: Optional[float] = None
    contenuto: Optional[List[BoxContenutoInput]] = None


class Box(BaseModel):
    id: str = Field(default_factory=_uuid)
    entrata_id: Optional[str] = None
    preparazione_id: Optional[str] = None
    cliente_id: str
    numero_box: str
    peso_kg: Optional[float] = None
    lunghezza_cm: Optional[float] = None
    larghezza_cm: Optional[float] = None
    altezza_cm: Optional[float] = None
    stato: str = "in_preparazione"  # in_preparazione|pronto|spedito
    etichetta_amazon_pdf_url: Optional[str] = None
    etichetta_ups_pdf_url: Optional[str] = None
    contenuto: List[BoxContenutoInput] = []
    data_spedito: Optional[str] = None  # quando il box passa a "spedito" (per fatturazione)
    created_at: str = Field(default_factory=_now_iso)


# ---------------------------------------------------------------------------
# GENERAZIONE ETICHETTE FNSKU
# ---------------------------------------------------------------------------
class EtichettaItem(BaseModel):
    fnsku: str
    titolo: Optional[str] = None
    copie: int = 1


class EtichetteRequest(BaseModel):
    items: List[EtichettaItem]
    formato: str = "50x30"  # 50x30 | 60x30 | 100x50 | 40x20
    mostra_titolo: bool = True


# ---------------------------------------------------------------------------
# PREPARAZIONI (richieste di preparazione del cliente dal magazzino virtuale)
# ---------------------------------------------------------------------------
class PrepRigaInput(BaseModel):
    ean: str
    sku: Optional[str] = None  # scelto dal cliente (un EAN può avere più SKU)
    quantita: int
    servizi: List[str] = []  # fnsku|busta|nastratura|pluriball


class PreparazioneCreate(BaseModel):
    cliente_id: Optional[str] = None  # richiesto solo per admin
    note: Optional[str] = None
    righe: List[PrepRigaInput] = []


class Preparazione(BaseModel):
    id: str = Field(default_factory=_uuid)
    cliente_id: str
    stato: str = "richiesta"  # richiesta|in_lavorazione|pronto|spedito
    note: Optional[str] = None
    data_pronto: Optional[str] = None  # quando diventa "pronto" (per fatturazione)
    created_at: str = Field(default_factory=_now_iso)


class PrepRiga(BaseModel):
    id: str = Field(default_factory=_uuid)
    preparazione_id: str
    ean: str
    sku: Optional[str] = None
    quantita: int
    servizi: List[str] = []
