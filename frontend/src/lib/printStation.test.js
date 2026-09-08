import {
  getPairedPrintStationCode,
  normalizePrintStationCode,
  pairPrintStation,
  printStationQrValue,
} from "./printStation";

describe("Packing Station QR", () => {
  const stationCode = "STATION-D9EFDE6AD7";

  beforeEach(() => {
    window.localStorage.clear();
  });

  test("genera un payload interno che non e un URL", () => {
    const value = printStationQrValue(stationCode);

    expect(value).toBe(`AIMAGO-WMS:PACKING-STATION:${stationCode}`);
    expect(value).not.toMatch(/^https?:/i);
  });

  test("riconosce codice diretto e payload interno", () => {
    expect(normalizePrintStationCode(stationCode.toLowerCase())).toBe(stationCode);
    expect(normalizePrintStationCode(`aimago-wms:packing-station:${stationCode.toLowerCase()}`)).toBe(stationCode);
  });

  test("mantiene compatibilita con il vecchio QR URL", () => {
    expect(normalizePrintStationCode(`https://aimago-prep-wms.vercel.app/wms-app/packing-remoto?station=${stationCode}`)).toBe(stationCode);
  });

  test("salva il collegamento per packing e stampe successive", () => {
    const qrValue = printStationQrValue(stationCode);

    expect(pairPrintStation(qrValue)).toBe(stationCode);
    expect(getPairedPrintStationCode()).toBe(stationCode);
  });

  test("rifiuta URL e payload non appartenenti alla Packing Station", () => {
    expect(normalizePrintStationCode(`https://example.com/?station=${stationCode}`)).toBe("");
    expect(normalizePrintStationCode(`AIMAGO-WMS:OTHER:${stationCode}`)).toBe("");
    expect(normalizePrintStationCode("STATION-CORTA")).toBe("");
  });
});
