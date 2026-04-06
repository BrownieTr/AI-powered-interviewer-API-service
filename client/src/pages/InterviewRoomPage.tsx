import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import "./InterviewRoom.css";

type TranscriptLine = { role: string; content: string; createdAt: number };

type SessionDetail = {
  id: string;
  status: string;
  outcomeSummary: string | null;
  transcript: TranscriptLine[];
};

const LIVE_POLL_MS = 1500;

export function InterviewRoomPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const startState = (location.state as
    | {
        callInitiated?: boolean;
        warning?: string;
        warningCode?: string;
        warningStatus?: number;
        warningMoreInfo?: string;
      }
    | null) ?? null;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const data = await api<SessionDetail>(`/api/phone/sessions/${sessionId}`);
    setSession(data);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) return;
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load session");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.transcript]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !draft.trim() || session?.status !== "active") return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    setDraft("");
    try {
      await api<{ assistantMessage: string }>(`/api/phone/sessions/${sessionId}/messages`, {
        method: "POST",
        body: { content: text },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Send failed");
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function endInterview() {
    if (!sessionId) return;
    setCompleting(true);
    setError(null);
    try {
      await api<{ session: SessionDetail }>(`/api/phone/sessions/${sessionId}/complete`, {
        method: "POST",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete interview");
    } finally {
      setCompleting(false);
    }
  }

  useEffect(() => {
    if (!sessionId || !session || session.status === "completed") return;
    const timer = setInterval(() => {
      void load().catch(() => {
        // Keep silent polling failures from interrupting the live transcript view.
      });
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, session, load]);

  if (error && !session) {
    return (
      <p className="page-error">
        {error} — <Link to="/">Back to list</Link>
      </p>
    );
  }

  if (!session) {
    return <p className="page-muted">Loading session…</p>;
  }

  const active = session.status === "active";

  return (
    <div className="room">
      <div className="room-toolbar">
        <Link to="/" className="room-back">
          ← Sessions
        </Link>
        {active && (
          <button type="button" className="room-end" onClick={endInterview} disabled={completing}>
            {completing ? "Ending…" : "End call & summary"}
          </button>
        )}
      </div>
      <h1>Interview</h1>
      <p className="page-muted room-status">
        Status: <strong>{session.status}</strong>
        {active ? " — respond as the candidate." : " — transcript and outcome below."}
      </p>
      {startState && startState.callInitiated === false && startState.warning && (
        <p className="form-error">
          Call was not initiated: {startState.warning}
          {startState.warningCode ? ` (code: ${startState.warningCode})` : ""}
          {startState.warningStatus ? ` (status: ${startState.warningStatus})` : ""}
          {startState.warningMoreInfo ? ` ${startState.warningMoreInfo}` : ""}
        </p>
      )}
      {error && <p className="form-error">{error}</p>}

      <div className="transcript" role="log" aria-live="polite">
        {session.transcript.map((line, i) => (
          <div key={`${line.createdAt}-${i}`} className={`bubble bubble--${line.role}`}>
            <span className="bubble-label">{line.role === "assistant" ? "Interviewer" : "You"}</span>
            <p className="bubble-text">{line.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {session.outcomeSummary && (
        <section className="outcome">
          <h2>Outcome</h2>
          <pre className="outcome-body">{session.outcomeSummary}</pre>
        </section>
      )}

      {active && (
        <form onSubmit={sendMessage} className="composer">
          <label className="sr-only" htmlFor="reply">
            Your answer
          </label>
          <textarea
            id="reply"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your answer (simulating the candidate on the line)…"
            disabled={sending}
          />
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}
