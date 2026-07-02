import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

// Guardia di rotta con controllo ruolo
export function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();

  if (user === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    // reindirizza all'area corretta in base al ruolo
    const home = user.role === "cliente" ? "/app" : "/admin";
    return <Navigate to={home} replace />;
  }

  return children;
}
