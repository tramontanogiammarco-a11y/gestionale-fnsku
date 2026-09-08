const DOCUMENTS_PATTERN = /\[DOCUMENTI\]([\s\S]*?)\[\/DOCUMENTI\]/;

export function parseEntryDocuments(note = "") {
  const text = String(note || "");
  const match = text.match(DOCUMENTS_PATTERN);
  if (!match) return { cleanNote: text, documents: [] };

  let documents = [];
  try {
    const parsed = JSON.parse((match[1] || "").trim());
    if (Array.isArray(parsed)) documents = parsed;
  } catch (_) {
    documents = [];
  }

  return {
    cleanNote: text.replace(match[0], "").trim(),
    documents,
  };
}

export function entryDdtDocuments(note = "") {
  return parseEntryDocuments(note).documents.filter((document) => (
    String(document?.tipo || "").toLowerCase().includes("ddt")
  ));
}

export function buildEntryDocumentsNote(note = "", documents = []) {
  const cleanNote = parseEntryDocuments(note).cleanNote.trim();
  if (!documents.length) return cleanNote;
  const block = `[DOCUMENTI]\n${JSON.stringify(documents)}\n[/DOCUMENTI]`;
  return cleanNote ? `${cleanNote}\n\n${block}` : block;
}
