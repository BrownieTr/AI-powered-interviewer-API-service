import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import "./AdminUsagePage.css";

type UsageSummary = {
  range: { from: number; to: number };
  totals: {
    totalUsers: number;
    adminUsers: number;
    totalInterviews: number;
    totalAiCalls: number;
    quotaTrackedCalls: number;
  };
};

type UsageUser = {
  id: string;
  email: string;
  role: "user" | "admin";
  freeCallsUsed: number;
  freeCallsLimit: number;
  freeCallsRemaining: number | null;
  totalAiCalls: number;
  lastUsageAt: number | null;
};

export function AdminUsagePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [users, setUsers] = useState<UsageUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summaryRes, usersRes] = await Promise.all([
          api<UsageSummary>("/api/admin/usage/summary"),
          api<{ users: UsageUser[] }>("/api/admin/usage/users?limit=100&offset=0"),
        ]);
        if (cancelled) return;
        setSummary(summaryRes);
        setUsers(usersRes.users);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof ApiError ? e.message : "Failed to load admin usage";
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (user?.role !== "admin") {
    return <p className="page-error">Admin role required to view usage monitoring.</p>;
  }

  if (error) {
    return <p className="page-error">{error}</p>;
  }

  if (!summary || !users) {
    return <p className="page-muted">Loading admin usage…</p>;
  }

  return (
    <div className="admin-usage">
      <h1>Admin usage monitor</h1>
      <p className="page-lead">
        Track API consumption and free-call usage across all users.
      </p>

      <section className="admin-usage-cards">
        <article className="admin-card">
          <h2>Total users</h2>
          <p>{summary.totals.totalUsers}</p>
        </article>
        <article className="admin-card">
          <h2>Total interviews</h2>
          <p>{summary.totals.totalInterviews}</p>
        </article>
        <article className="admin-card">
          <h2>Total AI calls</h2>
          <p>{summary.totals.totalAiCalls}</p>
        </article>
        <article className="admin-card">
          <h2>Quota-tracked calls</h2>
          <p>{summary.totals.quotaTrackedCalls}</p>
        </article>
      </section>

      <section>
        <h2>User consumption</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Free used</th>
                <th>Free limit</th>
                <th>Free remaining</th>
                <th>Total AI calls</th>
                <th>Last usage</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.freeCallsUsed}</td>
                  <td>{u.freeCallsLimit}</td>
                  <td>{u.freeCallsRemaining ?? "unlimited"}</td>
                  <td>{u.totalAiCalls}</td>
                  <td>{u.lastUsageAt ? new Date(u.lastUsageAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
