import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { InferenceClient } from "@huggingface/inference";
import type { Config } from "../config.js";
import { completeChat, type ChatMessage } from "./hfInference.js";

const MAX_DOC_LEN = 48_000;
const MAX_CONTEXT_MESSAGES = 40;

function buildSystemPrompt(resume: string, jobDescription: string): string {
  return `You are a professional hiring manager conducting a live phone-style interview for the role described below.

Rules:
- Stay in character as the interviewer. Be concise and natural, as on a phone call.
- Ask one focused question at a time. Listen to the candidate's answer before moving on.
- Base your questions on both the job requirements and the candidate's resume (probe gaps, depth, and fit).
- Do not fabricate facts about the candidate; only use what is in the resume text.
- If the candidate goes off-topic, gently steer back to the interview.

--- JOB DESCRIPTION ---
${jobDescription}

--- CANDIDATE RESUME ---
${resume}`;
}

function now(): number {
  return Date.now();
}

export function listSessions(db: Database.Database, userId: string) {
  const rows = db
    .prepare(
      `SELECT id, status, created_at, updated_at, outcome_summary
       FROM interviews WHERE user_id = ? ORDER BY updated_at DESC`
    )
    .all(userId) as {
    id: string;
    status: string;
    created_at: number;
    updated_at: number;
    outcome_summary: string | null;
  }[];
  return rows;
}

export async function startPhoneSession(
  db: Database.Database,
  hf: InferenceClient,
  config: Config,
  userId: string,
  resume: string,
  jobDescription: string
) {
  const id = randomUUID();
  const t = now();
  const systemContent = buildSystemPrompt(resume, jobDescription);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO interviews (id, user_id, resume, job_description, status, outcome_summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', NULL, ?, ?)`
    ).run(id, userId, resume, jobDescription, t, t);
    db.prepare(
      `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES (?, ?, 'system', ?, ?)`
    ).run(randomUUID(), id, systemContent, t);
  });
  tx();

  const kickoff: ChatMessage = {
    role: "user",
    content:
      "[Phone connected: the candidate just joined the line. Give a short professional greeting, say you will conduct the interview for this role, then ask your first question. Keep it brief.]",
  };

  const history: ChatMessage[] = [{ role: "system", content: systemContent }, kickoff];
  const reply = await completeChat(hf, config, history);

  db.prepare(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`
  ).run(randomUUID(), id, reply, now());
  db.prepare(`UPDATE interviews SET updated_at = ? WHERE id = ?`).run(now(), id);

  return {
    sessionId: id,
    assistantMessage: reply,
    createdAt: t,
  };
}

function loadMessagesForModel(db: Database.Database, interviewId: string): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT role, content FROM messages WHERE interview_id = ? ORDER BY created_at ASC`
    )
    .all(interviewId) as { role: string; content: string }[];

  const mapped = rows
    .filter((r) => r.role === "system" || r.role === "user" || r.role === "assistant")
    .map((r) => ({ role: r.role as ChatMessage["role"], content: r.content }));

  if (mapped.length > MAX_CONTEXT_MESSAGES) {
    const system = mapped.filter((m) => m.role === "system");
    const rest = mapped.filter((m) => m.role !== "system");
    const tail = rest.slice(-(MAX_CONTEXT_MESSAGES - system.length));
    return [...system, ...tail];
  }
  return mapped;
}

export async function appendCandidateTurn(
  db: Database.Database,
  hf: InferenceClient,
  config: Config,
  userId: string,
  sessionId: string,
  content: string
) {
  const row = db
    .prepare(`SELECT id, status FROM interviews WHERE id = ? AND user_id = ?`)
    .get(sessionId, userId) as { id: string; status: string } | undefined;
  if (!row) return { error: "not_found" as const };
  if (row.status !== "active") return { error: "not_active" as const };

  const t = now();
  db.prepare(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`
  ).run(randomUUID(), sessionId, content, t);

  const messages = loadMessagesForModel(db, sessionId);
  const reply = await completeChat(hf, config, messages);

  db.prepare(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`
  ).run(randomUUID(), sessionId, reply, now());
  db.prepare(`UPDATE interviews SET updated_at = ? WHERE id = ?`).run(now(), sessionId);

  return { assistantMessage: reply };
}

export function getSessionDetail(db: Database.Database, userId: string, sessionId: string) {
  const interview = db
    .prepare(
      `SELECT id, status, resume, job_description, outcome_summary, created_at, updated_at
       FROM interviews WHERE id = ? AND user_id = ?`
    )
    .get(sessionId, userId) as
    | {
        id: string;
        status: string;
        resume: string;
        job_description: string;
        outcome_summary: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!interview) return null;

  const transcript = db
    .prepare(
      `SELECT role, content, created_at FROM messages WHERE interview_id = ? ORDER BY created_at ASC`
    )
    .all(sessionId) as { role: string; content: string; created_at: number }[];

  const publicTranscript = transcript
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    }));

  return {
    id: interview.id,
    status: interview.status,
    resume: interview.resume,
    jobDescription: interview.job_description,
    outcomeSummary: interview.outcome_summary,
    createdAt: interview.created_at,
    updatedAt: interview.updated_at,
    transcript: publicTranscript,
  };
}

export async function completeSession(
  db: Database.Database,
  hf: InferenceClient,
  config: Config,
  userId: string,
  sessionId: string
) {
  const row = db
    .prepare(`SELECT id, status FROM interviews WHERE id = ? AND user_id = ?`)
    .get(sessionId, userId) as { id: string; status: string } | undefined;
  if (!row) return { error: "not_found" as const };
  if (row.status === "completed") {
    const detail = getSessionDetail(db, userId, sessionId);
    return { alreadyCompleted: true as const, session: detail };
  }

  const closer: ChatMessage = {
    role: "user",
    content:
      "[End of call: politely close the interview. Then provide a structured summary for HR with headings: Overall assessment, Strengths, Concerns, Recommendation (hire / no hire / need another round). Be specific and professional.]",
  };

  const base = loadMessagesForModel(db, sessionId);
  const messages: ChatMessage[] = [...base, closer];
  const summary = await completeChat(hf, config, messages);

  const t = now();
  db.prepare(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`
  ).run(randomUUID(), sessionId, summary, t);
  db.prepare(
    `UPDATE interviews SET status = 'completed', outcome_summary = ?, updated_at = ? WHERE id = ?`
  ).run(summary, now(), sessionId);

  const detail = getSessionDetail(db, userId, sessionId);
  return { session: detail };
}

export function assertDocSize(resume: string, jobDescription: string) {
  if (resume.length > MAX_DOC_LEN || jobDescription.length > MAX_DOC_LEN) {
    return false;
  }
  return true;
}
