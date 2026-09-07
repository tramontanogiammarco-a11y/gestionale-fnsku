import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";
import { isNativeApp } from "@/lib/nativeApp";
import NativeAppBridge from "@/components/wms/NativeAppBridge";

const Login = lazy(() => import("@/pages/Login"));
const AdminLayout = lazy(() => import("@/layouts/AdminLayout"));
const ClientLayout = lazy(() => import("@/layouts/ClientLayout"));
const WmsDesktopLayout = lazy(() => import("@/layouts/WmsDesktopLayout"));
const WmsPackingStationLayout = lazy(() => import("@/layouts/WmsPackingStationLayout"));
const WmsAppLayout = lazy(() => import("@/layouts/WmsAppLayout"));

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminEntrate = lazy(() => import("@/pages/admin/Entrate"));
const AdminEntrataDetail = lazy(() => import("@/pages/admin/EntrataDetail"));
const AdminReferenze = lazy(() => import("@/pages/admin/Referenze"));
const AdminEtichette = lazy(() => import("@/pages/admin/LabelGenerator"));
const AdminClienti = lazy(() => import("@/pages/admin/Clienti"));
const AdminClienteDetail = lazy(() => import("@/pages/admin/ClienteDetail"));
const AdminMagazzino = lazy(() => import("@/pages/admin/Magazzino"));
const AdminPreparazioni = lazy(() => import("@/pages/admin/Preparazioni"));
const AdminPreparazioneDetail = lazy(() => import("@/pages/admin/PreparazioneDetail"));
const AdminComposizioneBox = lazy(() => import("@/pages/admin/ComposizioneBox"));
const AdminFatturazione = lazy(() => import("@/pages/admin/Fatturazione"));
const AdminIntegrazioni = lazy(() => import("@/pages/admin/Integrazioni"));
const AdminWmsInbound = lazy(() => import("@/pages/admin/WmsInbound"));
const WmsPricing = lazy(() => import("@/pages/admin/WmsPricing"));
const AdminWmsWarehouseMap = lazy(() => import("@/pages/admin/WmsWarehouseMap"));

const ControlOverview = lazy(() => import("@/pages/control/ControlOverview"));
const ControlStock = lazy(() => import("@/pages/control/ControlStock"));
const ControlOrders = lazy(() => import("@/pages/control/ControlOrders"));
const ControlExceptions = lazy(() => import("@/pages/control/ControlExceptions"));
const ControlShipments = lazy(() => import("@/pages/control/ControlShipments"));
const ControlReturns = lazy(() => import("@/pages/control/ControlReturns"));
const ControlBilling = lazy(() => import("@/pages/control/ControlBilling"));
const ControlTickets = lazy(() => import("@/pages/control/ControlTickets"));
const WmsControlRoom = lazy(() => import("@/pages/control/WmsControlRoom"));

const ClientDashboard = lazy(() => import("@/pages/client/Dashboard"));
const ClientReferenze = lazy(() => import("@/pages/client/Referenze"));
const ClientEntrate = lazy(() => import("@/pages/client/Entrate"));
const ClientEntrataDetail = lazy(() => import("@/pages/client/EntrataDetail"));
const ClientBox = lazy(() => import("@/pages/client/Box"));
const ClientSpedizioni = lazy(() => import("@/pages/client/Spedizioni"));
const ClientMagazzino = lazy(() => import("@/pages/client/Magazzino"));
const ClientPreparazioni = lazy(() => import("@/pages/client/Preparazioni"));
const ClientPreparazioneDetail = lazy(() => import("@/pages/client/PreparazioneDetail"));
const ClientIntegrazioni = lazy(() => import("@/pages/client/Integrazioni"));

const WmsAppDashboard = lazy(() => import("@/pages/wms/WmsAppDashboard"));
const WmsAppHome = lazy(() => import("@/pages/wms/WmsAppHome"));
const WmsAppInbound = lazy(() => import("@/pages/wms/WmsAppInbound"));
const WmsAppInventory = lazy(() => import("@/pages/wms/WmsAppInventory"));
const WmsAppInventoryCount = lazy(() => import("@/pages/wms/WmsAppInventoryCount"));
const WmsAppLocations = lazy(() => import("@/pages/wms/WmsAppLocations"));
const WmsAppOrders = lazy(() => import("@/pages/wms/WmsAppOrders"));
const WmsAppPicking = lazy(() => import("@/pages/wms/WmsAppPicking"));
const WmsAppMassPicking = lazy(() => import("@/pages/wms/WmsAppMassPicking"));
const WmsAppGalluse = lazy(() => import("@/pages/wms/WmsAppGalluse"));
const WmsAppBagHistory = lazy(() => import("@/pages/wms/WmsAppBagHistory"));
const WmsAppProductSearch = lazy(() => import("@/pages/wms/WmsAppProductSearch"));
const WmsAppTools = lazy(() => import("@/pages/wms/WmsAppTools"));
const WmsAppSettings = lazy(() => import("@/pages/wms/WmsAppSettings"));
const WmsAppCartBags = lazy(() => import("@/pages/wms/WmsAppCartBags"));
const WmsAppStockMovement = lazy(() => import("@/pages/wms/WmsAppStockMovement"));
const WmsAppPackagingLabels = lazy(() => import("@/pages/wms/WmsAppPackagingLabels"));
const WmsAppRefill = lazy(() => import("@/pages/wms/WmsAppRefill"));
const WmsAppPackingRemote = lazy(() => import("@/pages/wms/WmsAppPackingRemote"));
const WmsOperators = lazy(() => import("@/pages/wms/WmsOperators"));

// Reindirizza dalla root all'area corretta
function RootRedirect() {
  const { user } = useAuth();
  const nativeApp = isNativeApp();
  const wmsOnly = nativeApp || process.env.REACT_APP_WMS_ONLY === "true"
    || window.location.hostname === "aimago-prep-wms.vercel.app";
  if (user === null)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={wmsOnly ? { from: nativeApp ? "/wms-app" : "/wms" } : undefined} />;
  return <Navigate to={(nativeApp && user.role !== "cliente") || user.is_operator ? "/wms-app" : "/wms"} replace />;
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
        <NativeAppBridge />
        <BrowserRouter>
          <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
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
              <Route path="prep" element={<ProtectedRoute roles={["cliente"]}><Navigate to="/wms/prep/preparazioni" replace /></ProtectedRoute>} />
              <Route path="prep/referenze" element={<ProtectedRoute roles={["cliente"]}><ClientReferenze /></ProtectedRoute>} />
              <Route path="prep/entrate" element={<ProtectedRoute roles={["cliente"]}><ClientEntrate basePath="/wms/prep" /></ProtectedRoute>} />
              <Route path="prep/entrate/:id" element={<ProtectedRoute roles={["cliente"]}><ClientEntrataDetail basePath="/wms/prep" /></ProtectedRoute>} />
              <Route path="prep/preparazioni" element={<ProtectedRoute roles={["cliente"]}><ClientPreparazioni basePath="/wms/prep" /></ProtectedRoute>} />
              <Route path="prep/preparazioni/:id" element={<ProtectedRoute roles={["cliente"]}><ClientPreparazioneDetail basePath="/wms/prep" /></ProtectedRoute>} />
              <Route path="prep/box" element={<ProtectedRoute roles={["cliente"]}><ClientBox /></ProtectedRoute>} />
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
              <Route path="picking-mono" element={<WmsAppMassPicking mode="mono" />} />
              <Route path="picking-mono/:batchId" element={<WmsAppMassPicking mode="mono" />} />
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
              <Route path="packing-remoto" element={<WmsAppPackingRemote />} />
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
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
