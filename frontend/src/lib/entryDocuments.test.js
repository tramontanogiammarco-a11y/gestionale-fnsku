import { buildEntryDocumentsNote, entryDdtDocuments, parseEntryDocuments } from "./entryDocuments";

describe("entry documents", () => {
  test("keeps the visible note and parses attached documents", () => {
    const note = `Consegna al piano terra\n\n[DOCUMENTI]\n${JSON.stringify([
      { tipo: "Foto DDT", nome: "ddt.jpg" },
      { tipo: "Foto merce", nome: "merce.jpg" },
    ])}\n[/DOCUMENTI]`;

    expect(parseEntryDocuments(note)).toEqual({
      cleanNote: "Consegna al piano terra",
      documents: [
        { tipo: "Foto DDT", nome: "ddt.jpg" },
        { tipo: "Foto merce", nome: "merce.jpg" },
      ],
    });
    expect(entryDdtDocuments(note)).toEqual([{ tipo: "Foto DDT", nome: "ddt.jpg" }]);
  });

  test("does not break a normal note or a malformed document block", () => {
    expect(parseEntryDocuments("Solo una nota")).toEqual({ cleanNote: "Solo una nota", documents: [] });
    expect(parseEntryDocuments("Nota\n[DOCUMENTI]non-json[/DOCUMENTI]")).toEqual({ cleanNote: "Nota", documents: [] });
  });

  test("preserves documents when the visible note changes", () => {
    const documents = [{ tipo: "Foto DDT", nome: "ddt.jpg" }];
    expect(buildEntryDocumentsNote("Nuova nota", documents)).toBe(
      `Nuova nota\n\n[DOCUMENTI]\n${JSON.stringify(documents)}\n[/DOCUMENTI]`,
    );
  });
});
