import { buildWmsDiagnostics } from "./wmsDiagnostics";

const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("buildWmsDiagnostics", () => {
  test("finds a stalled order and an inconsistent gate", () => {
    const result = buildWmsDiagnostics({
      now: NOW,
      orders: [{
        id: "order-1",
        order_name: "#1001",
        wms_status: "da_preparare",
        gate_status: "attesa_refill",
        updated_at: "2026-09-04T09:00:00.000Z",
      }, {
        id: "order-2",
        order_name: "#1002",
        wms_status: "in_verifica",
        gate_status: "verifica_stock",
        updated_at: "2026-09-04T09:30:00.000Z",
      }],
    });

    expect(result.issues.map((row) => row.id)).toEqual(expect.arrayContaining([
      "order-gate:order-1",
      "order-verification:order-2",
    ]));
  });

  test("does not report an occupied bag when it belongs to active work", () => {
    const result = buildWmsDiagnostics({
      now: NOW,
      bags: [{ id: "bag-1", codice: "B-AAAA1", stato: "in_packing", updated_at: "2026-09-04T08:00:00.000Z" }],
      activeBagCodes: ["B-AAAA1"],
    });

    expect(result.summary.bags).toBe(0);
  });

  test("reports orphan and prematurely released bags", () => {
    const result = buildWmsDiagnostics({
      now: NOW,
      bags: [
        { id: "bag-1", codice: "B-AAAA1", stato: "in_packing", updated_at: "2026-09-04T08:00:00.000Z" },
        { id: "bag-2", codice: "B-BBBB2", stato: "disponibile", updated_at: "2026-09-04T09:59:00.000Z" },
      ],
      activeBagCodes: ["B-BBBB2"],
    });

    expect(result.summary.bags).toBe(2);
    expect(result.summary.critical).toBe(2);
  });

  test("detects mixed stock and assignment conflicts in a slot", () => {
    const result = buildWmsDiagnostics({
      locations: [{
        id: "slot-1",
        codice: "S101+A1",
        tipo: "slot",
        contenuto: [
          { cliente_id: "client-1", fnsku: "FNSKU-A" },
          { cliente_id: "client-1", fnsku: "FNSKU-B" },
        ],
      }],
      slotAssignments: [{ location_id: "slot-1", cliente_id: "client-1", product_key: "fnsku:fnsku-a" }],
    });

    expect(result.issues.some((row) => row.id === "slot-mixed:slot-1")).toBe(true);
    expect(result.issues.some((row) => row.id === "slot-conflict:slot-1:fnsku:fnsku-b")).toBe(true);
  });

  test("returns a healthy snapshot when the main invariants hold", () => {
    const result = buildWmsDiagnostics({
      now: NOW,
      orders: [{ id: "order-1", wms_status: "da_preparare", gate_status: "sbloccato" }],
      bags: [{ id: "bag-1", codice: "B-AAAA1", stato: "disponibile", updated_at: NOW.toISOString() }],
      locations: [{
        id: "slot-1",
        codice: "S101+A1",
        tipo: "slot",
        contenuto: [{ cliente_id: "client-1", fnsku: "FNSKU-A" }],
      }],
      slotAssignments: [{ location_id: "slot-1", cliente_id: "client-1", product_key: "fnsku:fnsku-a" }],
    });

    expect(result.summary.total).toBe(0);
  });
});
