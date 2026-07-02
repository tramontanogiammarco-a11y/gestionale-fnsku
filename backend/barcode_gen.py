"""Generazione etichette FNSKU con codice a barre Code128 in PDF.

Usa reportlab con unita' in millimetri REALI: la pagina PDF ha esattamente le
dimensioni fisiche dell'etichetta (es. 50x30 mm), quindi stampando "dimensioni
reali / 100%" il codice a barre risulta della misura corretta.
"""
import io
import re

from reportlab.graphics.barcode import code128
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

# Formati etichetta supportati (larghezza_mm, altezza_mm)
FORMATI = {
    "40x20": (40, 20),
    "50x30": (50, 30),
    "60x30": (60, 30),
    "100x50": (100, 50),
}

# Code128 accetta i caratteri ASCII stampabili (0x20-0x7E)
_VALID_CODE128 = re.compile(r"^[\x20-\x7E]+$")


def fnsku_valido(fnsku: str) -> bool:
    """Valida che l'FNSKU sia codificabile in Code128."""
    return bool(fnsku) and bool(_VALID_CODE128.match(fnsku))


def _draw_label(c: canvas.Canvas, w_mm: float, h_mm: float,
                fnsku: str, titolo: str, mostra_titolo: bool):
    w, h = w_mm * mm, h_mm * mm
    margin = 2 * mm
    avail_w = w - 2 * margin

    # Titolo prodotto (troncato) in alto
    top_y = h - margin
    if mostra_titolo and titolo:
        font_size = max(4, min(7, h_mm * 0.18))
        c.setFont("Helvetica", font_size)
        testo = titolo if len(titolo) <= 32 else titolo[:31] + "\u2026"
        c.drawCentredString(w / 2, top_y - font_size, testo)
        barcode_top = top_y - font_size - 2
    else:
        barcode_top = top_y

    # Testo FNSKU leggibile in basso (mono)
    fnsku_font = max(6, min(11, h_mm * 0.28))
    c.setFont("Courier-Bold", fnsku_font)
    fnsku_y = margin
    c.drawCentredString(w / 2, fnsku_y, fnsku)

    # Codice a barre nello spazio centrale
    bc_bottom = fnsku_y + fnsku_font + 1
    bar_height = max(6 * mm, barcode_top - bc_bottom)
    barcode = code128.Code128(fnsku, barHeight=bar_height, humanReadable=False)
    scale = avail_w / barcode.width if barcode.width > 0 else 1
    c.saveState()
    c.translate(margin, bc_bottom)
    c.scale(scale, 1)
    barcode.drawOn(c, 0, 0)
    c.restoreState()

    c.showPage()


def genera_etichette_pdf(items, formato: str = "50x30", mostra_titolo: bool = True) -> bytes:
    """Genera un PDF con una etichetta per pagina.

    items: list di oggetti con .fnsku, .titolo, .copie
    Ritorna i byte del PDF. Solleva ValueError se formato o FNSKU non validi.
    """
    if formato not in FORMATI:
        raise ValueError(f"Formato non valido: {formato}")
    w_mm, h_mm = FORMATI[formato]

    # Validazione preventiva di tutti gli FNSKU
    for it in items:
        if not fnsku_valido(it.fnsku):
            raise ValueError(f"FNSKU non valido per Code128: '{it.fnsku}'")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(w_mm * mm, h_mm * mm))
    for it in items:
        copie = max(1, int(it.copie or 1))
        for _ in range(copie):
            _draw_label(c, w_mm, h_mm, it.fnsku, it.titolo or "", mostra_titolo)
    c.save()
    return buffer.getvalue()
