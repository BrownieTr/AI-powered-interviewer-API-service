import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import type { InferenceClient } from "@huggingface/inference";
import type { Config } from "../config.js";
import {
  appendCandidateTurn,
  completeSession,
  getSessionDetail,
  startPhoneSession,
} from "./interviewService.js";
import { createUser, getUserIdByEmail } from "./userService.js";

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

async function ensureVoiceSystemUser(db: Pool, config: Config): Promise<{ id: string }> {
  const existingId = await getUserIdByEmail(db, config.TWILIO_SYSTEM_USER_EMAIL);

  if (existingId) {
    return { id: existingId };
  }

  const id = randomUUID();
  const createdAt = now();
  const hash = await bcrypt.hash(SYSTEM_USER_PASSWORD, 12);

  await createUser(db, {
    id,
    email: config.TWILIO_SYSTEM_USER_EMAIL,
    passwordHash: hash,
    role: "user",
    freeCallsUsed: 0,
    freeCallsLimit: config.FREE_CALLS_LIMIT_DEFAULT,
    createdAt,
  });

  return { id };
}

async function upsertCallSession(
  db: Pool,
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
  await db.query(
    `INSERT INTO call_sessions (
      call_sid,
      interview_id,
      user_id,
      from_number,
      to_number,
      call_status,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(call_sid) DO UPDATE SET
      interview_id = excluded.interview_id,
      user_id = excluded.user_id,
      from_number = excluded.from_number,
      to_number = excluded.to_number,
      call_status = excluded.call_status,
      updated_at = excluded.updated_at`,
    [
      input.callSid,
      input.interviewId,
      input.userId,
      input.fromNumber ?? null,
      input.toNumber ?? null,
      input.callStatus,
      timestamp,
      timestamp,
    ]
  );
}

async function getCallSession(db: Pool, callSid: string): Promise<CallSessionRow | null> {
  const row = await db.query<CallSessionRow>(
    "SELECT call_sid, interview_id, user_id, call_status FROM call_sessions WHERE call_sid = $1 LIMIT 1",
    [callSid]
  );
  return row.rows[0] ?? null;
}

async function latestAssistantLine(sessionId: string, db: Pool): Promise<string | null> {
  const row = await db.query<{ content: string }>(
    `SELECT content
      FROM messages
      WHERE interview_id = $1 AND role = 'assistant'
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId]
  );
  return row.rows[0]?.content ?? null;
}

function ensureCallSid(callSid: string | undefined): string {
  if (!callSid || !callSid.trim()) {
    throw new Error("Missing CallSid in Twilio webhook payload");
  }
  return callSid;
}

export async function bindCallToInterview(
  db: Pool,
  input: {
    callSid: string;
    interviewId: string;
    userId: string;
    fromNumber?: string;
    toNumber?: string;
    callStatus?: string;
  }
): Promise<void> {
  await upsertCallSession(db, {
    callSid: input.callSid,
    interviewId: input.interviewId,
    userId: input.userId,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    callStatus: input.callStatus ?? "queued",
  });
}

export async function initVoiceCall(
  db: Pool,
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
  const existing = await getCallSession(db, callSid);

  if (existing) {
    const existingMessage = await latestAssistantLine(existing.interview_id, db);
    if (existingMessage) {
      await upsertCallSession(db, {
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
  if ("error" in opened) {
    throw new Error("Unable to start interview session for this call.");
  }

  await upsertCallSession(db, {
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
  db: Pool,
  hf: InferenceClient,
  config: Config,
  input: {
    callSid?: string;
    speechResult?: string;
    callStatus?: string;
  }
): Promise<{ assistantMessage: string; interviewCompleted: boolean }> {
  const callSid = ensureCallSid(input.callSid);
  const call = await getCallSession(db, callSid);
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
    const detail = await getSessionDetail(db, call.user_id, call.interview_id);
    return {
      assistantMessage:
        detail?.outcomeSummary ?? "This interview has already ended. Thank you for your time today.",
      interviewCompleted: true,
    };
  }
  if ("error" in out && out.error === "quota_exceeded") {
    return {
      assistantMessage:
        "This interview session has reached its free AI quota. Please contact the administrator to continue.",
      interviewCompleted: true,
    };
  }
  if ("error" in out) {
    throw new Error("Unable to append candidate turn for this call");
  }

  await upsertCallSession(db, {
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
  db: Pool,
  hf: InferenceClient,
  config: Config,
  input: { callSid?: string; callStatus?: string }
): Promise<void> {
  const callSid = ensureCallSid(input.callSid);
  const call = await getCallSession(db, callSid);
  if (!call) {
    return;
  }

  const status = (input.callStatus ?? call.call_status).toLowerCase();
  await upsertCallSession(db, {
    callSid,
    interviewId: call.interview_id,
    userId: call.user_id,
    callStatus: status,
  });

  if (["completed", "canceled", "busy", "failed", "no-answer"].includes(status)) {
    await completeSession(db, hf, config, call.user_id, call.interview_id);
  }
}
