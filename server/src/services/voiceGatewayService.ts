import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import type { InferenceClient } from "@huggingface/inference";
import type { Config } from "../config.js";
import {
  appendCandidateTurn,
  completeSession,
  getSessionDetail,
  startPhoneSession,
} from "./interviewService.js";

type CallSessionRow = {
  call_sid: string;
  interview_id: string;
  user_id: string;
  call_status: string;
};

const SYSTEM_USER_PASSWORD = "twilio-system-user-not-for-login";

function now(): number {
  return Date.now();
}

async function ensureVoiceSystemUser(db: Database.Database, config: Config): Promise<{ id: string }> {
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(config.TWILIO_SYSTEM_USER_EMAIL.toLowerCase()) as { id: string } | undefined;

  if (existing) {
    return existing;
  }

  const id = randomUUID();
  const createdAt = now();
  const hash = await bcrypt.hash(SYSTEM_USER_PASSWORD, 12);

  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    config.TWILIO_SYSTEM_USER_EMAIL.toLowerCase(),
    hash,
    createdAt
  );

  return { id };
}

function upsertCallSession(
  db: Database.Database,
  input: {
    callSid: string;
    interviewId: string;
    userId: string;
    fromNumber?: string;
    toNumber?: string;
    callStatus: string;
  }
) {
  const timestamp = now();
  db.prepare(
    `INSERT INTO call_sessions (
      call_sid,
      interview_id,
      user_id,
      from_number,
      to_number,
      call_status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(call_sid) DO UPDATE SET
      interview_id = excluded.interview_id,
      user_id = excluded.user_id,
      from_number = excluded.from_number,
      to_number = excluded.to_number,
      call_status = excluded.call_status,
      updated_at = excluded.updated_at`
  ).run(
    input.callSid,
    input.interviewId,
    input.userId,
    input.fromNumber ?? null,
    input.toNumber ?? null,
    input.callStatus,
    timestamp,
    timestamp
  );
}

function getCallSession(db: Database.Database, callSid: string): CallSessionRow | null {
  const row = db
    .prepare("SELECT call_sid, interview_id, user_id, call_status FROM call_sessions WHERE call_sid = ?")
    .get(callSid) as CallSessionRow | undefined;
  return row ?? null;
}

function latestAssistantLine(sessionId: string, db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT content
       FROM messages
       WHERE interview_id = ? AND role = 'assistant'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(sessionId) as { content: string } | undefined;
  return row?.content ?? null;
}

function ensureCallSid(callSid: string | undefined): string {
  if (!callSid || !callSid.trim()) {
    throw new Error("Missing CallSid in Twilio webhook payload");
  }
  return callSid;
}

export function bindCallToInterview(
  db: Database.Database,
  input: {
    callSid: string;
    interviewId: string;
    userId: string;
    fromNumber?: string;
    toNumber?: string;
    callStatus?: string;
  }
): void {
  upsertCallSession(db, {
    callSid: input.callSid,
    interviewId: input.interviewId,
    userId: input.userId,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    callStatus: input.callStatus ?? "queued",
  });
}

export async function initVoiceCall(
  db: Database.Database,
  hf: InferenceClient,
  config: Config,
  input: {
    callSid?: string;
    fromNumber?: string;
    toNumber?: string;
    callStatus?: string;
  }
): Promise<{ callSid: string; interviewId: string; assistantMessage: string }> {
  const callSid = ensureCallSid(input.callSid);
  const existing = getCallSession(db, callSid);

  if (existing) {
    const existingMessage = latestAssistantLine(existing.interview_id, db);
    if (existingMessage) {
      upsertCallSession(db, {
        callSid,
        interviewId: existing.interview_id,
        userId: existing.user_id,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        callStatus: input.callStatus ?? existing.call_status,
      });
      return {
        callSid,
        interviewId: existing.interview_id,
        assistantMessage: existingMessage,
      };
    }
  }

  const systemUser = await ensureVoiceSystemUser(db, config);
  const opened = await startPhoneSession(
    db,
    hf,
    config,
    systemUser.id,
    config.TWILIO_DEFAULT_RESUME,
    config.TWILIO_DEFAULT_JOB_DESCRIPTION
  );

  upsertCallSession(db, {
    callSid,
    interviewId: opened.sessionId,
    userId: systemUser.id,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    callStatus: input.callStatus ?? "in-progress",
  });

  return {
    callSid,
    interviewId: opened.sessionId,
    assistantMessage: opened.assistantMessage,
  };
}

export async function handleVoiceTurn(
  db: Database.Database,
  hf: InferenceClient,
  config: Config,
  input: {
    callSid?: string;
    speechResult?: string;
    callStatus?: string;
  }
): Promise<{ assistantMessage: string; interviewCompleted: boolean }> {
  const callSid = ensureCallSid(input.callSid);
  const call = getCallSession(db, callSid);
  if (!call) {
    throw new Error("No interview session found for this call. Start the call again.");
  }

  const transcript = (input.speechResult ?? "").trim();
  if (!transcript) {
    return {
      assistantMessage: "I did not catch that. Please repeat your answer.",
      interviewCompleted: false,
    };
  }

  const out = await appendCandidateTurn(db, hf, config, call.user_id, call.interview_id, transcript);
  if ("error" in out && out.error === "not_active") {
    const detail = getSessionDetail(db, call.user_id, call.interview_id);
    return {
      assistantMessage:
        detail?.outcomeSummary ?? "This interview has already ended. Thank you for your time today.",
      interviewCompleted: true,
    };
  }
  if ("error" in out) {
    throw new Error("Unable to append candidate turn for this call");
  }

  upsertCallSession(db, {
    callSid,
    interviewId: call.interview_id,
    userId: call.user_id,
    callStatus: input.callStatus ?? call.call_status,
  });

  return {
    assistantMessage: out.assistantMessage,
    interviewCompleted: false,
  };
}

export async function markCallStatus(
  db: Database.Database,
  hf: InferenceClient,
  config: Config,
  input: { callSid?: string; callStatus?: string }
): Promise<void> {
  const callSid = ensureCallSid(input.callSid);
  const call = getCallSession(db, callSid);
  if (!call) {
    return;
  }

  const status = (input.callStatus ?? call.call_status).toLowerCase();
  upsertCallSession(db, {
    callSid,
    interviewId: call.interview_id,
    userId: call.user_id,
    callStatus: status,
  });

  if (["completed", "canceled", "busy", "failed", "no-answer"].includes(status)) {
    await completeSession(db, hf, config, call.user_id, call.interview_id);
  }
}
