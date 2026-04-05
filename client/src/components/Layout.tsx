import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Layout.css";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

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
