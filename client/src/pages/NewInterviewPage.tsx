import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import "./InterviewForm.css";

export function NewInterviewPage() {
  const navigate = useNavigate();
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await api<{ sessionId: string }>("/api/phone/sessions", {
        method: "POST",
        body: { resume, jobDescription },
      });
      navigate(`/interview/${res.sessionId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start session");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="interview-form-page">
      <h1>New phone interview</h1>
      <p className="page-lead">
        Paste a candidate resume and the job description. The AI will act as the interviewer and open the call
        with a greeting and first question.
      </p>
      <form onSubmit={onSubmit} className="interview-form">
        <label>
          Resume
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            rows={10}
            required
            placeholder="Full resume text…"
          />
        </label>
        <label>
          Job description
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            rows={10}
            required
            placeholder="Role, responsibilities, requirements…"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Connecting…" : "Start interview call"}
        </button>
      </form>
    </div>
  );
}
