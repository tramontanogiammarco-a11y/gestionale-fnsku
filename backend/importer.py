"""Modulo di import referenze — parsing tollerante di file Excel/CSV.

Isolato di proposito: in futuro sara' facile aggiungere un import via Amazon
SP-API creando una nuova funzione che ritorna la stessa struttura
(list[dict], list[errori]) senza toccare il resto dell'applicazione.
"""
import io
from typing import List, Tuple

import pandas as pd


# Sinonimi comuni delle intestazioni (normalizzate: minuscolo, senza spazi/underscore/trattini)
_COLUMN_SYNONYMS = {
    "ean": ["ean", "barcode", "codicebarre", "eancode", "upc", "gtin", "productid"],
    "sku": ["sku", "sellersku", "merchantsku", "codicesku", "sellersku1"],
    "asin": ["asin", "asin1", "asinvalue"],
    "titolo": ["titolo", "title", "productname", "itemname", "name",
               "descrizione", "description", "productnametitle"],
}


def _normalize(col: str) -> str:
    return "".join(str(col).lower().split()).replace("_", "").replace("-", "")


def _map_columns(columns: List[str]) -> dict:
    """Ritorna mappatura {campo_interno: nome_colonna_originale} riconosciuta."""
    mapping = {}
    normalized = {_normalize(c): c for c in columns}
    for field, synonyms in _COLUMN_SYNONYMS.items():
        for syn in synonyms:
            if syn in normalized:
                mapping[field] = normalized[syn]
                break
    return mapping


def _read_dataframe(content: bytes, filename: str) -> pd.DataFrame:
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(content), dtype=str)
    # default: CSV — prova separatori comuni
    text = content.decode("utf-8-sig", errors="replace")
    for sep in [",", ";", "\t"]:
        try:
            df = pd.read_csv(io.StringIO(text), sep=sep, dtype=str)
            if df.shape[1] > 1:
                return df
        except Exception:
            continue
    return pd.read_csv(io.StringIO(text), dtype=str)


def parse_referenze_file(content: bytes, filename: str) -> Tuple[List[dict], List[dict]]:
    """Legge il file e ritorna (righe_valide, errori).

    - righe_valide: list di dict {ean, sku, asin, titolo}
    - errori: list di dict {riga, errore} per le righe scartate
    """
    try:
        df = _read_dataframe(content, filename)
    except Exception as e:
        return [], [{"riga": 0, "errore": f"Impossibile leggere il file: {e}"}]

    df = df.fillna("")
    mapping = _map_columns(list(df.columns))

    if "ean" not in mapping:
        return [], [{"riga": 0,
                     "errore": "Colonna EAN non trovata. Intestazioni attese: EAN, SKU, ASIN, Titolo."}]

    righe_valide: List[dict] = []
    errori: List[dict] = []

    for idx, row in df.iterrows():
        numero_riga = int(idx) + 2  # +1 header, +1 base-1
        ean = str(row[mapping["ean"]]).strip()
        if not ean:
            errori.append({"riga": numero_riga, "errore": "EAN mancante"})
            continue

        titolo = str(row[mapping["titolo"]]).strip() if "titolo" in mapping else ""
        if not titolo:
            titolo = ean  # fallback: usa l'EAN come titolo per non scartare la riga

        righe_valide.append({
            "ean": ean,
            "sku": str(row[mapping["sku"]]).strip() if "sku" in mapping else "",
            "asin": str(row[mapping["asin"]]).strip() if "asin" in mapping else "",
            "titolo": titolo,
        })

    return righe_valide, errori
