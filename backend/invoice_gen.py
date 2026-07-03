"""Generazione PDF estratto conto / fattura mensile per cliente."""
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def genera_fattura_pdf(ragione_sociale: str, periodo: str, righe: list,
                       subtotale: float, iva_perc: float, iva_importo: float,
                       totale: float) -> bytes:
    """righe: list di dict {descrizione, quantita, prezzo, importo}."""
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    w, h = A4
    x = 20 * mm
    y = h - 25 * mm

    c.setFont("Helvetica-Bold", 18)
    c.drawString(x, y, "Estratto conto / Fattura")
    y -= 8 * mm
    c.setFont("Helvetica", 10)
    c.drawString(x, y, "Prep Center — servizi FBA")
    y -= 12 * mm

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x, y, f"Cliente: {ragione_sociale}")
    c.drawRightString(w - 20 * mm, y, f"Periodo: {periodo}")
    y -= 10 * mm

    # Intestazione tabella
    c.setFillColorRGB(0.93, 0.95, 0.98)
    c.rect(x, y - 2 * mm, w - 40 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + 2 * mm, y, "Descrizione")
    c.drawRightString(x + 105 * mm, y, "Q.tà")
    c.drawRightString(x + 135 * mm, y, "Prezzo")
    c.drawRightString(w - 22 * mm, y, "Importo")
    y -= 9 * mm

    c.setFont("Helvetica", 9)
    for r in righe:
        if y < 40 * mm:
            c.showPage(); y = h - 25 * mm; c.setFont("Helvetica", 9)
        c.drawString(x + 2 * mm, y, str(r["descrizione"])[:60])
        c.drawRightString(x + 105 * mm, y, f"{r['quantita']:g}")
        c.drawRightString(x + 135 * mm, y, f"€ {r['prezzo']:.2f}")
        c.drawRightString(w - 22 * mm, y, f"€ {r['importo']:.2f}")
        y -= 7 * mm

    if not righe:
        c.drawString(x + 2 * mm, y, "Nessun costo nel periodo selezionato.")
        y -= 7 * mm

    y -= 4 * mm
    c.line(x, y, w - 20 * mm, y)
    y -= 8 * mm
    c.setFont("Helvetica", 10)
    c.drawRightString(x + 135 * mm, y, "Imponibile:")
    c.drawRightString(w - 22 * mm, y, f"€ {subtotale:.2f}")
    y -= 7 * mm
    c.drawRightString(x + 135 * mm, y, f"IVA {iva_perc:g}%:")
    c.drawRightString(w - 22 * mm, y, f"€ {iva_importo:.2f}")
    y -= 8 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(x + 135 * mm, y, "TOTALE:")
    c.drawRightString(w - 22 * mm, y, f"€ {totale:.2f}")

    c.save()
    return buffer.getvalue()
