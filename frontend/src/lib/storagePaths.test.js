import { storageObjectPath } from "./storagePaths";

describe("storageObjectPath", () => {
  const bucket = "gestionale-files";

  test("keeps a storage path already stored without a public URL", () => {
    expect(storageObjectPath("cliente/box/etichette.pdf", bucket))
      .toBe("cliente/box/etichette.pdf");
  });

  test("extracts and decodes a path from a Supabase public URL", () => {
    expect(storageObjectPath(
      "https://project.supabase.co/storage/v1/object/public/gestionale-files/cliente/box/Etichette%20UPS.pdf",
      bucket
    )).toBe("cliente/box/Etichette UPS.pdf");
  });

  test("does not treat an external URL as a managed storage object", () => {
    expect(storageObjectPath("https://example.com/etichette.pdf", bucket)).toBeNull();
  });
});
