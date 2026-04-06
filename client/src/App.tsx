import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { DashboardPage } from "./pages/DashboardPage";
import { AdminDashboard } from "./pages/AdminDashboardPage";
import { InterviewRoomPage } from "./pages/InterviewRoomPage";
import { LoginPage } from "./pages/LoginPage";
import { NewInterviewPage } from "./pages/NewInterviewPage";
import { RegisterPage } from "./pages/RegisterPage";
import "./App.css";

function Protected({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();
  if (!ready) {
    return (
      <div className="app-loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Layout>{children}</Layout>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();
  if (!ready) {
    return (
      <div className="app-loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (token) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/interview/new"
        element={
          <Protected>
            <NewInterviewPage />
          </Protected>
        }
      />
      <Route
        path="/interview/:sessionId"
        element={
          <Protected>
            <InterviewRoomPage />
          </Protected>
        }
      />
      <Route
        path="/admin/dashboard"
        element={
          <Protected>
            <AdminDashboard />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
