// Configurazione stati e badge colorati (allineata alle design guidelines)

export const STATI_ENTRATA = {
  in_attesa: { label: "In attesa", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  ricevuto: { label: "Arrivato", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  in_lavorazione: { label: "In lavorazione", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  pronto: { label: "Pronto", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  spedito: { label: "Spedito", cls: "bg-slate-100 text-slate-700 border-slate-200" },
};

export const STATI_BOX = {
  in_preparazione: { label: "In preparazione", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  pronto: { label: "Pronto", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  spedito: { label: "Spedito", cls: "bg-slate-100 text-slate-700 border-slate-200" },
};

export const STATI_PREP = {
  richiesta: { label: "Richiesta", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  in_lavorazione: { label: "In lavorazione", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  pronto: { label: "Pronto", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  spedito: { label: "Spedito", cls: "bg-slate-100 text-slate-700 border-slate-200" },
};

// Servizi di lavorazione richiedibili sulle righe di preparazione
export const SERVIZI = {
  fnsku: { label: "FNSKU" },
  busta: { label: "Busta trasparente" },
  nastratura: { label: "Nastratura" },
  pluriball: { label: "Pluriball" },
};

export const FLUSSO_PREP = ["richiesta", "in_lavorazione", "pronto", "spedito"];

export const FLUSSO_ENTRATA = ["in_attesa", "ricevuto"];
