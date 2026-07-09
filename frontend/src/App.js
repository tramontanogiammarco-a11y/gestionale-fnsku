import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import AdminBox from "@/pages/admin/BoxList";
import AdminReferenze from "@/pages/admin/Referenze";
import AdminEtichette from "@/pages/admin/LabelGenerator";
import AdminClienti from "@/pages/admin/Clienti";
import AdminPreparazioni from "@/pages/admin/Preparazioni";
import AdminPreparazioneDetail from "@/pages/admin/PreparazioneDetail";
import AdminComposizioneBox from "@/pages/admin/ComposizioneBox";
import AdminFatturazione from "@/pages/admin/Fatturazione";

import ClientDashboard from "@/pages/client/Dashboard";
import ClientReferenze from "@/pages/client/Referenze";
import ClientEntrate from "@/pages/client/Entrate";
import ClientEntrataDetail from "@/pages/client/EntrataDetail";
import ClientBox from "@/pages/client/Box";
import ClientSpedizioni from "@/pages/client/Spedizioni";
import ClientMagazzino from "@/pages/client/Magazzino";
import ClientPreparazioni from "@/pages/client/Preparazioni";
import ClientPreparazioneDetail from "@/pages/client/PreparazioneDetail";

// Reindirizza dalla root all'area corretta
function RootRedirect() {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "cliente" ? "/app" : "/admin"} replace />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<Login />} />

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
              <Route path="composizione-box" element={<AdminComposizioneBox />} />
              <Route path="box" element={<AdminBox />} />
              <Route path="referenze" element={<AdminReferenze />} />
              <Route path="etichette" element={<AdminEtichette />} />
              <Route path="preparazioni" element={<AdminPreparazioni />} />
              <Route path="preparazioni/:id" element={<AdminPreparazioneDetail />} />
              <Route path="clienti" element={<AdminClienti />} />
              <Route path="fatturazione" element={<AdminFatturazione />} />
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
