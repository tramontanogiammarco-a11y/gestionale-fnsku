import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Search, Loader2, ArrowUpRight } from "lucide-react";

function includes(value, q) {
  return String(value || "").toLowerCase().includes(q);
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get("/clienti"),
      api.get("/referenze"),
      api.get("/entrate"),
      api.get("/preparazioni"),
      api.get("/box"),
    ]).then(([clienti, referenze, entrate, preparazioni, box]) => {
      setData({
        clienti: clienti.data || [],
        referenze: referenze.data || [],
        entrate: entrate.data || [],
        preparazioni: preparazioni.data || [],
        box: box.data || [],
      });
    }).catch(() => setData({ clienti: [], referenze: [], entrate: [], preparazioni: [], box: [] }));
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    const rows = [];
    data.clienti.forEach((c) => {
      if (includes(c.ragione_sociale, q) || includes(c.email, q)) {
        rows.push({ type: "Cliente", title: c.ragione_sociale, meta: c.email, to: `/admin/clienti/${c.id}` });
      }
    });
    data.referenze.forEach((r) => {
      if (includes(r.ean, q) || includes(r.fnsku, q) || includes(r.sku, q) || includes(r.titolo, q) || includes(r.asin, q)) {
        rows.push({ type: "Referenza", title: r.titolo || r.ean, meta: `EAN ${r.ean}${r.fnsku ? ` · FNSKU ${r.fnsku}` : ""}`, to: `/admin/referenze?cliente_id=${r.cliente_id}` });
      }
    });
    data.entrate.forEach((e) => {
      const righeMatch = (e.righe || []).some((r) => includes(r.ean, q) || includes(r.fnsku, q));
      if (includes(e.cliente_ragione_sociale, q) || includes(e.ddt, q) || includes(e.tracking, q) || righeMatch) {
        rows.push({ type: "Entrata", title: e.cliente_ragione_sociale || "Entrata", meta: `${e.tipo} · ${new Date(e.data_annuncio).toLocaleDateString("it-IT")}`, to: `/admin/entrate/${e.id}` });
      }
    });
    data.preparazioni.forEach((p) => {
      const righeMatch = (p.righe || []).some((r) => includes(r.ean, q) || includes(r.fnsku, q) || includes(r.titolo, q));
      if (includes(p.cliente_ragione_sociale, q) || righeMatch) {
        rows.push({ type: "Preparazione", title: p.cliente_ragione_sociale || "Preparazione", meta: `${p.righe?.length || 0} righe · ${p.stato}`, to: `/admin/preparazioni/${p.id}` });
      }
    });
    data.box.forEach((b) => {
      const righeMatch = (b.contenuto || []).some((r) => includes(r.ean, q) || includes(r.fnsku, q) || includes(r.sku, q));
      if (includes(b.numero_box, q) || includes(b.cliente_ragione_sociale, q) || righeMatch) {
        rows.push({ type: "Box", title: b.numero_box, meta: `${b.cliente_ragione_sociale || ""} · ${b.stato}`, to: "/admin/box" });
      }
    });
    return rows.slice(0, 8);
  }, [data, query]);

  const go = (to) => {
    navigate(to);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/85 px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Cerca cliente, EAN, FNSKU, tracking..."
          className="h-7 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
          data-testid="global-search"
        />
        {!data && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          {results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Nessun risultato.</div>
          ) : (
            <div className="max-h-96 divide-y divide-slate-100 overflow-auto">
              {results.map((item, index) => (
                <button
                  key={`${item.type}-${item.to}-${index}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item.to)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  data-testid={`global-search-result-${index}`}
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-teal-700">{item.type}</span>
                    <span className="block truncate text-sm font-semibold text-slate-950">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.meta}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
