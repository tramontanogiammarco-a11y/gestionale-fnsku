import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";

import Login from "@/pages/Login";
import AdminLayout from "@/layouts/AdminLayout";
import ClientLayout from "@/layouts/ClientLayout";

import AdminDashboard from "@/pages/admin/Dashboard";
import AdminEntrate from "@/pages/admin/Entrate";
import AdminEntrataDetail from "@/pages/admin/EntrataDetail";
import AdminReferenze from "@/pages/admin/Referenze";
import AdminEtichette from "@/pages/admin/LabelGenerator";
import AdminClienti from "@/pages/admin/Clienti";
import AdminClienteDetail from "@/pages/admin/ClienteDetail";
import AdminMagazzino from "@/pages/admin/Magazzino";
import AdminPreparazioni from "@/pages/admin/Preparazioni";
import AdminPreparazioneDetail from "@/pages/admin/PreparazioneDetail";
import AdminComposizioneBox from "@/pages/admin/ComposizioneBox";
import AdminFatturazione from "@/pages/admin/Fatturazione";
import AdminIntegrazioni from "@/pages/admin/Integrazioni";
import AdminWmsInbound from "@/pages/admin/WmsInbound";
import WmsDesktopLayout from "@/layouts/WmsDesktopLayout";
import WmsPackingStationLayout from "@/layouts/WmsPackingStationLayout";
import ControlOverview from "@/pages/control/ControlOverview";
import ControlStock from "@/pages/control/ControlStock";
import ControlOrders from "@/pages/control/ControlOrders";
import ControlExceptions from "@/pages/control/ControlExceptions";
import ControlShipments from "@/pages/control/ControlShipments";
import ControlReturns from "@/pages/control/ControlReturns";
import ControlBilling from "@/pages/control/ControlBilling";
import ControlTickets from "@/pages/control/ControlTickets";
import WmsControlRoom from "@/pages/control/WmsControlRoom";
import WmsOperators from "@/pages/wms/WmsOperators";
import WmsPricing from "@/pages/admin/WmsPricing";

import ClientDashboard from "@/pages/client/Dashboard";
import ClientReferenze from "@/pages/client/Referenze";
import ClientEntrate from "@/pages/client/Entrate";
import ClientEntrataDetail from "@/pages/client/EntrataDetail";
import ClientBox from "@/pages/client/Box";
import ClientSpedizioni from "@/pages/client/Spedizioni";
import ClientMagazzino from "@/pages/client/Magazzino";
import ClientPreparazioni from "@/pages/client/Preparazioni";
import ClientPreparazioneDetail from "@/pages/client/PreparazioneDetail";
import ClientIntegrazioni from "@/pages/client/Integrazioni";
import WmsAppLayout from "@/layouts/WmsAppLayout";
import WmsAppDashboard from "@/pages/wms/WmsAppDashboard";
import WmsAppHome from "@/pages/wms/WmsAppHome";
import WmsAppInbound from "@/pages/wms/WmsAppInbound";
import WmsAppInventory from "@/pages/wms/WmsAppInventory";
import WmsAppInventoryCount from "@/pages/wms/WmsAppInventoryCount";
import WmsAppLocations from "@/pages/wms/WmsAppLocations";
import WmsAppOrders from "@/pages/wms/WmsAppOrders";
import WmsAppPicking from "@/pages/wms/WmsAppPicking";
import WmsAppMassPicking from "@/pages/wms/WmsAppMassPicking";
import WmsAppGalluse from "@/pages/wms/WmsAppGalluse";
import WmsAppBagHistory from "@/pages/wms/WmsAppBagHistory";
import WmsAppProductSearch from "@/pages/wms/WmsAppProductSearch";
import WmsAppTools from "@/pages/wms/WmsAppTools";
import WmsAppSettings from "@/pages/wms/WmsAppSettings";
import WmsAppCartBags from "@/pages/wms/WmsAppCartBags";
import WmsAppStockMovement from "@/pages/wms/WmsAppStockMovement";
import WmsAppPackagingLabels from "@/pages/wms/WmsAppPackagingLabels";
import WmsAppRefill from "@/pages/wms/WmsAppRefill";

const AdminWmsWarehouseMap = lazy(() => import("@/pages/admin/WmsWarehouseMap"));

// Reindirizza dalla root all'area corretta
function RootRedirect() {
  const { user } = useAuth();
  const wmsOnly = process.env.REACT_APP_WMS_ONLY === "true"
    || window.location.hostname === "aimago-prep-wms.vercel.app";
  if (user === null)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={wmsOnly ? { from: "/wms" } : undefined} />;
  return <Navigate to={user.is_operator ? "/wms-app" : "/wms"} replace />;
}

function LegacyWmsInboundRedirect() {
  const { id } = useParams();
  return <Navigate to={`/wms/inbound/${id}`} replace />;
}

function WmsIntegrationsRoute() {
  const { user } = useAuth();
  return user?.role === "cliente" ? <ClientIntegrazioni /> : <Navigate to="/admin/integrazioni" replace />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<Login />} />

            {/* Area WMS indipendente dal gestionale FNSKU. */}
            <Route
              path="/wms"
              element={
                <ProtectedRoute roles={["admin", "staff", "cliente"]}>
                  <WmsDesktopLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<ControlOverview />} />
              <Route path="stock" element={<ControlStock />} />
              <Route path="orders" element={<ControlOrders />} />
              <Route path="exceptions" element={<ControlExceptions />} />
              <Route path="shipments" element={<ControlShipments />} />
              <Route path="returns" element={<ControlReturns />} />
              <Route path="billing" element={<ControlBilling />} />
              <Route path="tickets" element={<ControlTickets />} />
              <Route path="integrations" element={<WmsIntegrationsRoute />} />
              <Route path="control-room" element={<ProtectedRoute roles={["admin", "staff"]}><WmsControlRoom /></ProtectedRoute>} />
              <Route path="operatori" element={<ProtectedRoute roles={["admin"]}><WmsOperators /></ProtectedRoute>} />
              <Route path="prezzari" element={<ProtectedRoute roles={["admin", "staff"]}><WmsPricing /></ProtectedRoute>} />
              <Route path="mappa" element={<ProtectedRoute roles={["admin", "staff"]}><Suspense fallback={<div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}><AdminWmsWarehouseMap /></Suspense></ProtectedRoute>} />
              <Route path="inbound/:id" element={<ProtectedRoute roles={["admin", "staff"]}><AdminWmsInbound /></ProtectedRoute>} />
              <Route path="ordini" element={<Navigate to="/wms/orders" replace />} />
            </Route>

            <Route
              path="/packing-station"
              element={
                <ProtectedRoute roles={["admin", "staff"]}>
                  <WmsPackingStationLayout />
                </ProtectedRoute>
              }
            />

            {/* App mobile dedicata agli operatori di magazzino */}
            <Route
              path="/wms-app"
              element={
                <ProtectedRoute roles={["admin", "staff"]}>
                  <WmsAppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<WmsAppDashboard />} />
              <Route path="arrivi" element={<WmsAppHome />} />
              <Route path="inbound/:id" element={<WmsAppInbound />} />
              <Route path="inventario" element={<WmsAppInventory />} />
              <Route path="inventario/:id" element={<WmsAppInventoryCount />} />
              <Route path="ubicazioni" element={<WmsAppLocations />} />
              <Route path="movimenta-stock" element={<WmsAppStockMovement />} />
              <Route path="refill" element={<WmsAppRefill />} />
              <Route path="ordini" element={<WmsAppOrders />} />
              <Route path="picking/:orderId" element={<WmsAppPicking />} />
              <Route path="picking-massivo" element={<WmsAppMassPicking />} />
              <Route path="picking-massivo/:batchId" element={<WmsAppMassPicking />} />
              <Route path="picking-galluse" element={<WmsAppGalluse />} />
              <Route path="picking-galluse/:batchId" element={<WmsAppGalluse />} />
              <Route path="packing" element={<Navigate to="/packing-station" replace />} />
              <Route path="packing/bag/:bagCode" element={<Navigate to="/packing-station" replace />} />
              <Route path="packing/:orderId" element={<Navigate to="/packing-station" replace />} />
              <Route path="bag-storico" element={<WmsAppBagHistory />} />
              <Route path="cerca-prodotto" element={<WmsAppProductSearch />} />
              <Route path="strumenti" element={<WmsAppTools />} />
              <Route path="carrelli-bag" element={<WmsAppCartBags />} />
              <Route path="barcode-imballaggi" element={<WmsAppPackagingLabels />} />
              <Route path="configurazione" element={<WmsAppSettings />} />
            </Route>

            {/* Area backend (admin/staff) */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={["admin", "staff"]}>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="entrate" element={<AdminEntrate />} />
              <Route path="entrate/:id" element={<AdminEntrataDetail />} />
              <Route path="magazzino" element={<AdminMagazzino />} />
              <Route path="composizione-box" element={<AdminComposizioneBox />} />
              <Route path="box" element={<Navigate to="/admin/composizione-box" replace />} />
              <Route path="referenze" element={<AdminReferenze />} />
              <Route path="etichette" element={<AdminEtichette />} />
              <Route path="preparazioni" element={<AdminPreparazioni />} />
              <Route path="preparazioni/:id" element={<AdminPreparazioneDetail />} />
              <Route path="clienti" element={<AdminClienti />} />
              <Route path="clienti/:id" element={<AdminClienteDetail />} />
              <Route path="fatturazione" element={<AdminFatturazione />} />
              <Route path="integrazioni" element={<AdminIntegrazioni />} />
              <Route path="wms" element={<Navigate to="/wms" replace />} />
              <Route path="wms/mappa" element={<Navigate to="/wms/mappa" replace />} />
              <Route path="wms/inbound/:id" element={<LegacyWmsInboundRedirect />} />
              <Route path="ordini-wms" element={<Navigate to="/wms/orders" replace />} />
            </Route>

            {/* Area cliente */}
            <Route
              path="/app"
              element={
                <ProtectedRoute roles={["cliente"]}>
                  <ClientLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<ClientDashboard />} />
              <Route path="referenze" element={<ClientReferenze />} />
              <Route path="magazzino" element={<ClientMagazzino />} />
              <Route path="preparazioni" element={<ClientPreparazioni />} />
              <Route path="preparazioni/:id" element={<ClientPreparazioneDetail />} />
              <Route path="entrate" element={<ClientEntrate />} />
              <Route path="entrate/:id" element={<ClientEntrataDetail />} />
              <Route path="box" element={<ClientBox />} />
              <Route path="spedizioni" element={<ClientSpedizioni />} />
              <Route path="fatturazione" element={<AdminFatturazione clientMode />} />
              <Route path="integrazioni" element={<ClientIntegrazioni />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
