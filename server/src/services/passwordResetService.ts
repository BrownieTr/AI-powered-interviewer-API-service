import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Pool } from "pg";

function now(): number {
    return Date.now();
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function generatePasswordResetToken(): string {
    return randomBytes(32).toString("hex");
}

export async function createPasswordResetToken(
    db: Pool,
    userId: string,
    tokenTtlMinutes: number
    ): Promise<string> {
    const token = generatePasswordResetToken();
    const tokenHash = hashToken(token);
    const createdAt = now();
    const expiresAt = createdAt + tokenTtlMinutes * 60_000;

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query(
        `UPDATE password_reset_tokens
        SET used_at = $2
        WHERE user_id = $1
            AND used_at IS NULL`,
        [userId, createdAt]
        );
        await client.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
        VALUES ($1, $2, $3, $4, NULL, $5)`,
        [randomUUID(), userId, tokenHash, expiresAt, createdAt]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    return token;
}

export async function consumePasswordResetToken(
    db: Pool,
    rawToken: string,
    nextPasswordHash: string
    ): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    const timestamp = now();

    const client = await db.connect();
    try {
        await client.query("BEGIN");

        const tokenResult = await client.query<{
        id: string;
        user_id: string;
        expires_at: string | number;
        used_at: string | number | null;
        }>(
        `SELECT id, user_id, expires_at, used_at
        FROM password_reset_tokens
        WHERE token_hash = $1
        FOR UPDATE
        LIMIT 1`,
        [tokenHash]
        );

        const tokenRow = tokenResult.rows[0];
        if (!tokenRow) {
        await client.query("ROLLBACK");
        return false;
        }

        const expiresAt = Number(tokenRow.expires_at);
        const isUsed = tokenRow.used_at !== null;
        if (isUsed || expiresAt < timestamp) {
        await client.query("ROLLBACK");
        return false;
        }

        await client.query(
        `UPDATE users
        SET password_hash = $2
        WHERE id = $1`,
        [tokenRow.user_id, nextPasswordHash]
        );

        await client.query(
        `UPDATE password_reset_tokens
        SET used_at = $2
        WHERE id = $1`,
        [tokenRow.id, timestamp]
        );

        await client.query(
        `UPDATE password_reset_tokens
        SET used_at = $2
        WHERE user_id = $1
            AND used_at IS NULL`,
        [tokenRow.user_id, timestamp]
        );

        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
