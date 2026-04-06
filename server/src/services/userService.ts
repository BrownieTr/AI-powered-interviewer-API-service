import type { Pool } from "pg";

export type UserRole = "user" | "admin";

export type UserAuthRecord = {
    id: string;
    email: string;
    role: UserRole;
    passwordHash: string;
    freeCallsUsed: number;
    freeCallsLimit: number;
};

export type UserProfileRecord = {
    id: string;
    email: string;
    role: UserRole;
    freeCallsUsed: number;
    freeCallsLimit: number;
    createdAt: number;
};

function toNumber(value: string | number): number {
    return typeof value === "number" ? value : Number(value);
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export async function getUserIdByEmail(db: Pool, email: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
        `SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
        [normalizeEmail(email)]
    );
    return result.rows[0]?.id ?? null;
}

export async function getUserRoleById(db: Pool, userId: string): Promise<UserRole | null> {
    const result = await db.query<{ role: UserRole }>(
        `SELECT role
        FROM users
        WHERE id = $1
        LIMIT 1`,
        [userId]
    );
    return result.rows[0]?.role ?? null;
}

export async function getUserForAuthByEmail(db: Pool, email: string): Promise<UserAuthRecord | null> {
    const result = await db.query<{
        id: string;
        email: string;
        role: UserRole;
        password_hash: string;
        free_calls_used: string | number;
        free_calls_limit: string | number;
    }>(
        `SELECT id, email, role, password_hash, free_calls_used, free_calls_limit
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
        [normalizeEmail(email)]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
        id: row.id,
        email: row.email,
        role: row.role,
        passwordHash: row.password_hash,
        freeCallsUsed: toNumber(row.free_calls_used),
        freeCallsLimit: toNumber(row.free_calls_limit),
    };
}

export async function getUserProfileById(db: Pool, userId: string): Promise<UserProfileRecord | null> {
    const result = await db.query<{
        id: string;
        email: string;
        role: UserRole;
        free_calls_used: string | number;
        free_calls_limit: string | number;
        created_at: string | number;
    }>(
        `SELECT id, email, role, free_calls_used, free_calls_limit, created_at
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
        freeCallsUsed: toNumber(row.free_calls_used),
        freeCallsLimit: toNumber(row.free_calls_limit),
        createdAt: toNumber(row.created_at),
    };
}

export async function createUser(db: Pool, input: {
    id: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    freeCallsUsed?: number;
    freeCallsLimit: number;
    createdAt: number;
    }): Promise<void> {
    await db.query(
        `INSERT INTO users (id, email, password_hash, role, free_calls_used, free_calls_limit, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
        input.id,
        normalizeEmail(input.email),
        input.passwordHash,
        input.role ?? "user",
        input.freeCallsUsed ?? 0,
        input.freeCallsLimit,
        input.createdAt,
        ]
    );
}
