import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import "./InterviewForm.css";

export function NewInterviewPage() {
  const navigate = useNavigate();
  const [resume, setResume] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resume.trim() && !resumeFile) {
      setError("Provide resume text or upload a resume file.");
      return;
    }
    if (!candidatePhone.trim()) {
      setError("Provide the candidate phone number in E.164 format (for example, +16045559876).");
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.append("jobDescription", jobDescription);
      body.append("candidatePhone", candidatePhone.trim());
      if (resume.trim()) {
        body.append("resume", resume);
      }
      if (resumeFile) {
        body.append("resumeFile", resumeFile);
      }

      const res = await api<{ sessionId: string }>("/api/phone/sessions", {
        method: "POST",
        body,
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
        Paste resume text or upload a resume file (PDF, DOCX, TXT), then add the job description. The AI will
        call the candidate phone number and open the interview with a greeting and first question.
      </p>
      <form onSubmit={onSubmit} className="interview-form">
        <label>
          Candidate phone (E.164)
          <input
            type="tel"
            value={candidatePhone}
            onChange={(e) => setCandidatePhone(e.target.value)}
            required
            placeholder="+16045559876"
          />
        </label>
        <label>
          Resume text (optional if file is uploaded)
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            rows={10}
            placeholder="Full resume text…"
          />
        </label>
        <label>
          Resume file (optional)
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setResumeFile(next);
            }}
          />
          <span className="file-hint">
            {resumeFile
              ? `Selected: ${resumeFile.name}`
              : "Supported formats: PDF, DOCX, TXT (up to 5 MB)."}
          </span>
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
