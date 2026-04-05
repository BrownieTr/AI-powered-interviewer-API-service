import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
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

function toNum(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

type SessionListRow = {
  id: string;
  status: string;
  created_at: string | number;
  updated_at: string | number;
  outcome_summary: string | null;
};

export async function listSessions(db: Pool, userId: string) {
  const rows = await db.query<SessionListRow>(
    `SELECT id, status, created_at, updated_at, outcome_summary
     FROM interviews WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.rows.map((row) => ({
    ...row,
    created_at: toNum(row.created_at),
    updated_at: toNum(row.updated_at),
  }));
}

export async function startPhoneSession(
  db: Pool,
  hf: InferenceClient,
  config: Config,
  userId: string,
  resume: string,
  jobDescription: string
) {
  const id = randomUUID();
  const t = now();
  const systemContent = buildSystemPrompt(resume, jobDescription);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO interviews (id, user_id, resume, job_description, status, outcome_summary, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', NULL, $5, $6)`,
      [id, userId, resume, jobDescription, t, t]
    );
    await client.query(
      `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES ($1, $2, 'system', $3, $4)`,
      [randomUUID(), id, systemContent, t]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const kickoff: ChatMessage = {
    role: "user",
    content:
      "[Phone connected: the candidate just joined the line. Give a short professional greeting, say you will conduct the interview for this role, then ask your first question. Keep it brief.]",
  };

  const history: ChatMessage[] = [{ role: "system", content: systemContent }, kickoff];
  const reply = await completeChat(hf, config, history);

  await db.query(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES ($1, $2, 'assistant', $3, $4)`,
    [randomUUID(), id, reply, now()]
  );
  await db.query(`UPDATE interviews SET updated_at = $1 WHERE id = $2`, [now(), id]);

  return {
    sessionId: id,
    assistantMessage: reply,
    createdAt: t,
  };
}

async function loadMessagesForModel(db: Pool, interviewId: string): Promise<ChatMessage[]> {
  const rows = await db.query<{ role: string; content: string }>(
    `SELECT role, content FROM messages WHERE interview_id = $1 ORDER BY created_at ASC`,
    [interviewId]
  );

  const mapped = rows.rows
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
  db: Pool,
  hf: InferenceClient,
  config: Config,
  userId: string,
  sessionId: string,
  content: string
) {
  const rowQuery = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM interviews WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId]
  );
  const row = rowQuery.rows[0];
  if (!row) return { error: "not_found" as const };
  if (row.status !== "active") return { error: "not_active" as const };

  const t = now();
  await db.query(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES ($1, $2, 'user', $3, $4)`,
    [randomUUID(), sessionId, content, t]
  );

  const messages = await loadMessagesForModel(db, sessionId);
  const reply = await completeChat(hf, config, messages);

  await db.query(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES ($1, $2, 'assistant', $3, $4)`,
    [randomUUID(), sessionId, reply, now()]
  );
  await db.query(`UPDATE interviews SET updated_at = $1 WHERE id = $2`, [now(), sessionId]);

  return { assistantMessage: reply };
}

export async function getSessionDetail(db: Pool, userId: string, sessionId: string) {
  const interviewQuery = await db.query<{
    id: string;
    status: string;
    resume: string;
    job_description: string;
    outcome_summary: string | null;
    created_at: string | number;
    updated_at: string | number;
  }>(
    `SELECT id, status, resume, job_description, outcome_summary, created_at, updated_at
     FROM interviews WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId]
  );

  const interview = interviewQuery.rows[0];
  if (!interview) return null;

  const transcriptQuery = await db.query<{ role: string; content: string; created_at: string | number }>(
    `SELECT role, content, created_at FROM messages WHERE interview_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );

  const publicTranscript = transcriptQuery.rows
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: toNum(m.created_at),
    }));

  return {
    id: interview.id,
    status: interview.status,
    resume: interview.resume,
    jobDescription: interview.job_description,
    outcomeSummary: interview.outcome_summary,
    createdAt: toNum(interview.created_at),
    updatedAt: toNum(interview.updated_at),
    transcript: publicTranscript,
  };
}

export async function completeSession(
  db: Pool,
  hf: InferenceClient,
  config: Config,
  userId: string,
  sessionId: string
) {
  const rowQuery = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM interviews WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId]
  );
  const row = rowQuery.rows[0];
  if (!row) return { error: "not_found" as const };
  if (row.status === "completed") {
    const detail = await getSessionDetail(db, userId, sessionId);
    return { alreadyCompleted: true as const, session: detail };
  }

  const closer: ChatMessage = {
    role: "user",
    content:
      "[End of call: politely close the interview. Then provide a structured summary for HR with headings: Overall assessment, Strengths, Concerns, Recommendation (hire / no hire / need another round). Be specific and professional.]",
  };

  const base = await loadMessagesForModel(db, sessionId);
  const messages: ChatMessage[] = [...base, closer];
  const summary = await completeChat(hf, config, messages);

  const t = now();
  await db.query(
    `INSERT INTO messages (id, interview_id, role, content, created_at) VALUES ($1, $2, 'assistant', $3, $4)`,
    [randomUUID(), sessionId, summary, t]
  );
  await db.query(
    `UPDATE interviews SET status = 'completed', outcome_summary = $1, updated_at = $2 WHERE id = $3`,
    [summary, now(), sessionId]
  );

  const detail = await getSessionDetail(db, userId, sessionId);
  return { session: detail };
}

export function assertDocSize(resume: string, jobDescription: string) {
  if (resume.length > MAX_DOC_LEN || jobDescription.length > MAX_DOC_LEN) {
    return false;
  }
  return true;
}
