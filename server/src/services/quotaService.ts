import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Config } from "../config.js";

type UserQuotaRow = {
    id: string;
    email: string;
    role: "user" | "admin";
    free_calls_used: number;
    free_calls_limit: number;
};

type QuotaState = {
    role: "user" | "admin";
    freeCallsUsed: number;
    freeCallsLimit: number;
    freeCallsRemaining: number;
};

export type UsageEventType = "session_start" | "message_turn" | "session_complete";

function toNumber(value: string | number): number {
    return typeof value === "number" ? value : Number(value);
}

function isSystemVoiceUser(userEmail: string, config: Config): boolean {
    return userEmail.toLowerCase() === config.TWILIO_SYSTEM_USER_EMAIL.toLowerCase();
}

async function getQuotaRow(db: Pool, userId: string): Promise<UserQuotaRow | null> {
    const result = await db.query<{
        id: string;
        email: string;
        role: "user" | "admin";
        free_calls_used: string | number;
        free_calls_limit: string | number;
    }>(
        `SELECT id, email, role, free_calls_used, free_calls_limit
        FROM users
        WHERE id = $1
        LIMIT 1`,
        [userId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
        id: row.id,
        email: row.email,
        role: row.role,
        free_calls_used: toNumber(row.free_calls_used),
        free_calls_limit: toNumber(row.free_calls_limit),
    };
}

export async function getUserQuotaState(
    db: Pool,
    userId: string,
    config: Config
): Promise<QuotaState | null> {
    const row = await getQuotaRow(db, userId);
    if (!row) return null;

    const limit = Math.max(0, row.free_calls_limit);
    const used = Math.max(0, row.free_calls_used);

    if (row.role === "admin" || isSystemVoiceUser(row.email, config)) {
        return {
            role: row.role,
            freeCallsUsed: used,
            freeCallsLimit: limit,
            freeCallsRemaining: Number.MAX_SAFE_INTEGER,
        };
    }

    return {
        role: row.role,
        freeCallsUsed: used,
        freeCallsLimit: limit,
        freeCallsRemaining: Math.max(0, limit - used),
    };
}

export async function assertCanUseAi(
    db: Pool,
    userId: string,
    config: Config
): Promise<
    | { ok: true; quota: QuotaState }
    | { ok: false; reason: "not_found" | "quota_exceeded"; quota?: QuotaState }
> {
    const quota = await getUserQuotaState(db, userId, config);
    if (!quota) return { ok: false, reason: "not_found" };
    if (quota.freeCallsRemaining <= 0) {
        return { ok: false, reason: "quota_exceeded", quota };
    }
    return { ok: true, quota };
}

export async function recordAiUsage(
    db: Pool,
    config: Config,
    input: {
        userId: string;
        interviewId: string;
        eventType: UsageEventType;
    }
): Promise<
    | { ok: true; quota: QuotaState }
    | { ok: false; reason: "not_found" | "quota_exceeded"; quota?: QuotaState }
> {
    const client = await db.connect();
    try {
        await client.query("BEGIN");

        const userResult = await client.query<{
            id: string;
            email: string;
            role: "user" | "admin";
            free_calls_used: string | number;
            free_calls_limit: string | number;
        }>(
            `SELECT id, email, role, free_calls_used, free_calls_limit
            FROM users
            WHERE id = $1
            FOR UPDATE`,
            [input.userId]
        );

        const user = userResult.rows[0];
        if (!user) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }

        const used = toNumber(user.free_calls_used);
        const limit = toNumber(user.free_calls_limit);
        const quotaApplies = user.role !== "admin" && !isSystemVoiceUser(user.email, config);

        if (quotaApplies && used >= limit) {
            await client.query("ROLLBACK");
            return {
                ok: false,
                reason: "quota_exceeded",
                quota: {
                    role: user.role,
                    freeCallsUsed: used,
                    freeCallsLimit: limit,
                    freeCallsRemaining: 0,
                },
            };
        }

        if (quotaApplies) {
            await client.query(
                `UPDATE users
                SET free_calls_used = free_calls_used + 1
                WHERE id = $1`,
                [input.userId]
            );
        }

        await client.query(
            `INSERT INTO usage_events (id, user_id, interview_id, event_type, billable_units, included_in_quota, created_at)
            VALUES ($1, $2, $3, $4, 1, $5, $6)`,
            [randomUUID(), input.userId, input.interviewId, input.eventType, quotaApplies, Date.now()]
        );

        const nextUsed = quotaApplies ? used + 1 : used;
        const quota: QuotaState = {
            role: user.role,
            freeCallsUsed: nextUsed,
            freeCallsLimit: limit,
            freeCallsRemaining: quotaApplies ? Math.max(0, limit - nextUsed) : Number.MAX_SAFE_INTEGER,
        };

        await client.query("COMMIT");
        return { ok: true, quota };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
