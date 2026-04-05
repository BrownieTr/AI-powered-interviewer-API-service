import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";

type SessionRow = {
  id: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  hasOutcome: boolean;
};

export function DashboardPage() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ sessions: SessionRow[] }>("/api/phone/sessions");
        if (!cancelled) setSessions(res.sessions);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load sessions");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="page-error">{error}</p>;
  }

  if (!sessions) {
    return <p className="page-muted">Loading sessions…</p>;
  }

  return (
    <div className="dashboard">
      <h1>Interview sessions</h1>
      <p className="page-lead">
        Each session is a phone-style interview driven by your resume and job description. Open a session to
        continue or review the transcript.
      </p>
      {sessions.length === 0 ? (
        <p className="page-muted">
          No sessions yet.{" "}
          <Link to="/interview/new">Start a new interview</Link>.
        </p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link to={`/interview/${s.id}`} className="session-link">
                <span className={`session-status session-status--${s.status}`}>{s.status}</span>
                <span className="session-meta">
                  {new Date(s.updatedAt).toLocaleString()}
                  {s.hasOutcome ? " · outcome recorded" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
