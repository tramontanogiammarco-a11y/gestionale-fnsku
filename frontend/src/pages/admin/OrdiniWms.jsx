import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Download, Loader2, MapPin, PackageCheck, RefreshCw, ShoppingCart, Truck, TriangleAlert } from "lucide-react";

const WMS_STATI = [
  { key: "tutti", label: "Tutti" },
  { key: "da_preparare", label: "Da preparare" },
  { key: "in_preparazione", label: "In preparazione" },
  { key: "pronto", label: "Pronto" },
  { key: "spedito", label: "Spedito" },
];

const statusLabel = {
  da_preparare: "Da preparare",
  in_preparazione: "In preparazione",
  pronto: "Pronto",
  spedito: "Spedito",
  annullato: "Annullato",
};

export default function AdminOrdiniWms() {
  const [orders, setOrders] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [view, setView] = useState("da_preparare");
  const [creatingShipment, setCreatingShipment] = useState(null);
  const [updatingShipment, setUpdatingShipment] = useState(null);
  const [generatingLabel, setGeneratingLabel] = useState(null);

  const load = async () => {
    const [ordersResponse, shipmentsResponse] = await Promise.all([
      api.get("/shopify/orders"),
      api.get("/wms/spedizioni"),
    ]);
    setOrders(ordersResponse.data || []);
    setShipments(shipmentsResponse.data || []);
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const list = orders || [];
    return view === "tutti" ? list : list.filter((order) => order.wms_status === view);
  }, [orders, view]);

  const stats = useMemo(() => {
    const list = orders || [];
    const pezzi = list.reduce((sum, order) => sum + (order.items || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0);
    const righeNonCollegate = list.reduce((sum, order) => sum + (order.items || []).filter((item) => !item.referenza_id).length, 0);
    return {
      ordini: list.length,
      pezzi,
      daPreparare: list.filter((order) => order.wms_status === "da_preparare").length,
      righeNonCollegate,
    };
  }, [orders]);

  const shipmentByOrder = useMemo(() => {
    const map = {};
    for (const shipment of shipments || []) {
      if (!shipment.order_id) continue;
      map[shipment.order_id] = shipment;
    }
    return map;
  }, [shipments]);

  const handleCreateShipment = async (order, corriere = "manuale") => {
    setCreatingShipment(order.id);
    try {
      await api.post("/wms/spedizioni", {
        order_id: order.id,
        corriere,
        colli: 1,
      });
      toast.success("Bozza spedizione creata");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile creare la spedizione");
    } finally {
      setCreatingShipment(null);
    }
  };

  const handleGenerateLabel = async (shipment) => {
    setGeneratingLabel(shipment.id);
    try {
      const { data } = await api.post("/shippypro/label", {
        shipment_id: shipment.id,
      });
      toast.success(data?.tracking ? `Etichetta ShippyPro creata: ${data.tracking}` : "Etichetta ShippyPro creata");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile generare l'etichetta");
    } finally {
      setGeneratingLabel(null);
    }
  };

  const handleUpdateCarrier = async (shipment, corriere) => {
    setUpdatingShipment(shipment.id);
    try {
      await api.put(`/wms/spedizioni/${shipment.id}`, { corriere });
      toast.success(`Corriere aggiornato: ${corriere.toUpperCase()}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile cambiare corriere");
    } finally {
      setUpdatingShipment(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-ordini-wms">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-700">
              <ShoppingCart className="h-3.5 w-3.5" /> WMS
            </div>
            <h1 className="font-heading text-3xl font-black tracking-tight">Ordini WMS</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Ordini Shopify importati e pronti per picking, controllo referenze e preparazione.
            </p>
          </div>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" /> Aggiorna
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Ordini" value={stats.ordini} />
        <Metric label="Da preparare" value={stats.daPreparare} />
        <Metric label="Pezzi" value={stats.pezzi} />
        <Metric label="Righe da sistemare" value={stats.righeNonCollegate} tone={stats.righeNonCollegate ? "warn" : "ok"} />
      </div>

      {orders && (
        <div className="flex flex-wrap gap-2">
          {WMS_STATI.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={view === item.key ? "default" : "outline"}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}

      <Card>
        {!orders ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
                <TableRow>
                  <TableHead>Ordine</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Destinazione</TableHead>
                  <TableHead>Righe</TableHead>
                  <TableHead>Pezzi</TableHead>
                  <TableHead>Shopify</TableHead>
                  <TableHead>WMS</TableHead>
                  <TableHead>Spedizione</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    Nessun ordine in questa vista.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((order) => {
                const pezzi = (order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
                const missing = (order.items || []).filter((item) => !item.referenza_id).length;
                const shipment = shipmentByOrder[order.id];
                return (
                  <TableRow key={order.id} data-testid={`wms-order-${order.id}`}>
                    <TableCell>
                      <div className="font-heading text-base font-black">{order.order_name}</div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">{order.shop_domain}</div>
                      {missing > 0 && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                          <TriangleAlert className="h-3 w-3" /> {missing} righe senza referenza
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{order.cliente_ragione_sociale}</TableCell>
                    <TableCell>
                      {order.ship_city || order.ship_zip || order.ship_name ? (
                        <div className="max-w-[260px] text-sm">
                          <div className="flex items-center gap-1 font-semibold text-slate-900">
                            <MapPin className="h-3.5 w-3.5 text-teal-700" />
                            {order.ship_name || "Destinatario"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[order.ship_address1, order.ship_zip, order.ship_city, order.ship_province]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Da reimportare</span>
                      )}
                    </TableCell>
                    <TableCell>{order.items?.length || 0}</TableCell>
                    <TableCell>{pezzi}</TableCell>
                    <TableCell>
                      <div className="text-sm">{order.financial_status || "-"}</div>
                      <div className="text-xs text-muted-foreground">{order.fulfillment_status || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                        <PackageCheck className="h-3 w-3" /> {statusLabel[order.wms_status] || order.wms_status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {shipment ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-xs font-bold uppercase text-teal-700">
                            <Truck className="h-3 w-3" /> {shipment.corriere}
                          </span>
                          <div className="text-xs text-muted-foreground">{shipment.tracking || shipment.stato}</div>
                          {!shipment.label_url && shipment.stato !== "creata" && (
                            <div className="flex flex-wrap gap-1">
                              {shipment.corriere !== "gls" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingShipment === shipment.id}
                                  onClick={() => handleUpdateCarrier(shipment, "gls")}
                                >
                                  {updatingShipment === shipment.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                  Usa GLS
                                </Button>
                              )}
                              {shipment.corriere !== "brt" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingShipment === shipment.id}
                                  onClick={() => handleUpdateCarrier(shipment, "brt")}
                                >
                                  {updatingShipment === shipment.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                  Usa BRT
                                </Button>
                              )}
                            </div>
                          )}
                          {shipment.label_url ? (
                            <Button size="sm" variant="outline" asChild>
                              <a href={shipment.label_url} target="_blank" rel="noreferrer">
                                <Download className="mr-1 h-3 w-3" /> PDF
                              </a>
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={generatingLabel === shipment.id}
                              onClick={() => handleGenerateLabel(shipment)}
                            >
                              {generatingLabel === shipment.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Truck className="mr-1 h-3 w-3" />}
                              Genera etichetta
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={creatingShipment === order.id}
                            onClick={() => handleCreateShipment(order, "brt")}
                          >
                            {creatingShipment === order.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Truck className="mr-1 h-3 w-3" />}
                            BRT
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={creatingShipment === order.id}
                            onClick={() => handleCreateShipment(order, "gls")}
                          >
                            GLS
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{order.processed_at ? new Date(order.processed_at).toLocaleDateString("it-IT") : "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, tone }) {
  const toneClass = tone === "warn" ? "bg-amber-50 text-amber-700" : tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-lg border border-slate-200 p-4 shadow-sm ${toneClass}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-1 font-heading text-2xl font-black">{value}</div>
    </div>
  );
}
