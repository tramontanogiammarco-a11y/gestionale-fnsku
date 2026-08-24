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
import AdminOrdiniWms from "@/pages/admin/OrdiniWms";
import AdminWmsControl from "@/pages/admin/WmsControl";
import AdminWmsInbound from "@/pages/admin/WmsInbound";
import WmsDesktopLayout from "@/layouts/WmsDesktopLayout";
import WmsPackingStationLayout from "@/layouts/WmsPackingStationLayout";

import ClientDashboard from "@/pages/client/Dashboard";
import ClientReferenze from "@/pages/client/Referenze";
import ClientEntrate from "@/pages/client/Entrate";
import ClientEntrataDetail from "@/pages/client/EntrataDetail";
import ClientBox from "@/pages/client/Box";
import ClientSpedizioni from "@/pages/client/Spedizioni";
import ClientMagazzino from "@/pages/client/Magazzino";
import ClientPreparazioni from "@/pages/client/Preparazioni";
import ClientPreparazioneDetail from "@/pages/client/PreparazioneDetail";
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
import WmsAppBagHistory from "@/pages/wms/WmsAppBagHistory";
import WmsAppProductSearch from "@/pages/wms/WmsAppProductSearch";
import WmsAppTools from "@/pages/wms/WmsAppTools";
import WmsAppSettings from "@/pages/wms/WmsAppSettings";

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
  if (!user) return <Navigate to="/login" replace state={wmsOnly ? { from: "/wms-app" } : undefined} />;
  if (wmsOnly && user.role !== "cliente") return <Navigate to="/wms-app" replace />;
  return <Navigate to={user.role === "cliente" ? "/app" : "/admin"} replace />;
}

function LegacyWmsInboundRedirect() {
  const { id } = useParams();
  return <Navigate to={`/wms/inbound/${id}`} replace />;
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
                <ProtectedRoute roles={["admin", "staff"]}>
                  <WmsDesktopLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminWmsControl />} />
              <Route path="mappa" element={<Suspense fallback={<div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}><AdminWmsWarehouseMap /></Suspense>} />
              <Route path="inbound/:id" element={<AdminWmsInbound />} />
              <Route path="ordini" element={<AdminOrdiniWms />} />
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
              <Route path="ordini" element={<WmsAppOrders />} />
              <Route path="picking/:orderId" element={<WmsAppPicking />} />
              <Route path="picking-massivo" element={<WmsAppMassPicking />} />
              <Route path="picking-massivo/:batchId" element={<WmsAppMassPicking />} />
              <Route path="packing" element={<Navigate to="/packing-station" replace />} />
              <Route path="packing/bag/:bagCode" element={<Navigate to="/packing-station" replace />} />
              <Route path="packing/:orderId" element={<Navigate to="/packing-station" replace />} />
              <Route path="bag-storico" element={<WmsAppBagHistory />} />
              <Route path="cerca-prodotto" element={<WmsAppProductSearch />} />
              <Route path="strumenti" element={<WmsAppTools />} />
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
              <Route path="ordini-wms" element={<Navigate to="/wms/ordini" replace />} />
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
