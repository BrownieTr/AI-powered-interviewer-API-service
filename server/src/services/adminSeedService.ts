import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import type { Config } from "../config.js";
import { createUser, getUserIdByEmail, normalizeEmail } from "./userService.js";

export async function ensureSeedAdminUser(db: Pool, config: Config): Promise<void> {
    if (!config.ADMIN_SEED_EMAIL || !config.ADMIN_SEED_PASSWORD) {
        return;
    }

    const email = normalizeEmail(config.ADMIN_SEED_EMAIL);
    const existingId = await getUserIdByEmail(db, email);

    if (existingId) {
        await db.query(
            `UPDATE users
             SET role = 'admin',
                     free_calls_limit = GREATEST(free_calls_limit, $2)
             WHERE id = $1`,
            [existingId, config.FREE_CALLS_LIMIT_DEFAULT]
        );
        return;
    }

    const hash = await bcrypt.hash(config.ADMIN_SEED_PASSWORD, 12);
    await createUser(db, {
        id: randomUUID(),
        email,
        passwordHash: hash,
        role: "admin",
        freeCallsUsed: 0,
        freeCallsLimit: config.FREE_CALLS_LIMIT_DEFAULT,
        createdAt: Date.now(),
    });
}
