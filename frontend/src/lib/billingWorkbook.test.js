import ExcelJS from "exceljs";
import { buildBillingWorkbook } from "./billingWorkbook";

jest.setTimeout(30000);

test("builds a readable billing workbook with operational detail", async () => {
  const invoice = {
    ragione_sociale: "Cliente Test",
    periodo: "2026-09",
    iva_perc: 22,
    righe: [{ descrizione: "Gestione ordine", quantita: 1, prezzo: 1, importo: 1 }],
    dettaglio: {
      ordini_imballati: {
        dettaglio: [{
          order_name: "#1001",
          shopify_order_id: "SHP-1001",
          shop_domain: "shop.example",
          packed_at: "2026-09-07T10:00:00Z",
          tracking: "TRACK-1001",
          recipient: { name: "Mario Rossi", address1: "Via Roma 69", zip: "00162", city: "Roma" },
          carrier: "gls",
          shipment: { service: "Nazionale", status: "creata" },
          shipping_zone: "nazionale",
          billable_weight_kg: 1.5,
          products_summary: "Prodotto Test x1",
          products: [{ title: "Prodotto Test", sku: "SKU-1", ean: "EAN-1", fnsku: "FNSKU-1", quantity: 1 }],
          pieces: 1,
          packaging: { name: "Scatola piccola" },
          costs: { shipping: 4, base_fee: 1, extra_quantity: 0, extra_total: 0, packaging: 1 },
        }],
      },
      entrate: [{
        id: "IN-1",
        data_ricezione: "2026-09-01T08:00:00Z",
        tipo: "scatola",
        colli: 1,
        pezzi: 10,
        stato: "ricevuto",
        righe: [{ titolo: "Prodotto Test", quantita: 10 }],
        costo: { quantita: 1, prezzo: 2 },
      }],
      preparazioni: [],
      stoccaggio: { pallet: 2, prezzo: 5, registrato_il: "2026-09-07T10:00:00Z" },
    },
  };

  const generated = await buildBillingWorkbook(invoice);
  const buffer = await generated.xlsx.writeBuffer();
  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.load(buffer);

  expect(parsed.worksheets.map((sheet) => sheet.name)).toEqual([
    "Riepilogo", "Spedizioni", "Prodotti", "Entrate", "Prep FBA", "Stoccaggio",
  ]);
  expect(parsed.getWorksheet("Spedizioni").getCell("F5").value).toBe("Mario Rossi");
  expect(parsed.getWorksheet("Spedizioni").getCell("M5").value).toBe("Prodotto Test x1");
  expect(parsed.getWorksheet("Spedizioni").getCell("Y5").value.formula).toContain("S5");
  expect(parsed.getWorksheet("Stoccaggio").getCell("D5").value.formula).toBe("B5*C5");
});
