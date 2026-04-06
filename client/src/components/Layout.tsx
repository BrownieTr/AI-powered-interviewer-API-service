import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Layout.css";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const freeCallsRemaining =
    user && typeof user.freeCallsLimit === "number" && typeof user.freeCallsUsed === "number"
      ? Math.max(0, user.freeCallsLimit - user.freeCallsUsed)
      : null;

  return (
    <div className="layout">
      <header className="layout-header">
        <Link to="/" className="layout-brand">
          AI Phone Interviewer
        </Link>
        <nav className="layout-nav">
          {user && (
            <>
              <Link to="/">Sessions</Link>
              <Link to="/interview/new">New interview</Link>
              {user.role === "admin" ? (
                <span className="layout-quota">Admin · unlimited calls</span>
              ) : (
                <span className="layout-quota">
                  Free calls left: {freeCallsRemaining ?? "..."}
                </span>
              )}
              <span className="layout-email">{user.email}</span>
              <button type="button" className="layout-logout" onClick={logout}>
                Log out
              </button>
            </>
          )}
        </nav>
      </header>
      <main className="layout-main">{children}</main>
    </div>
  );
}
