import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import type { Config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const rangeSchema = z.object({
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().nonnegative().optional(),
});

const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export function createAdminRouter(db: Pool, config: Config) {
    const r = Router();

    r.use(requireAuth(config));
    r.use(requireAdmin(db));

    r.get(
        "/usage/summary",
        asyncHandler(async (req, res) => {
            const parsed = rangeSchema.safeParse(req.query);
            if (!parsed.success) {
                res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
                return;
            }

            const from = parsed.data.from ?? 0;
            const to = parsed.data.to ?? Date.now();

            const totals = await db.query<{
                total_users: string | number;
                admin_users: string | number;
                total_ai_calls: string | number;
                quota_tracked_calls: string | number;
            }>(
                `SELECT
                     COUNT(*) FILTER (WHERE role IN ('user', 'admin')) AS total_users,
                     COUNT(*) FILTER (WHERE role = 'admin') AS admin_users,
                     COALESCE((
                         SELECT SUM(billable_units)
                         FROM usage_events
                         WHERE created_at BETWEEN $1 AND $2
                     ), 0) AS total_ai_calls,
                     COALESCE((
                         SELECT SUM(billable_units)
                         FROM usage_events
                         WHERE included_in_quota = true
                             AND created_at BETWEEN $1 AND $2
                     ), 0) AS quota_tracked_calls
                 FROM users`,
                [from, to]
            );

            const interviews = await db.query<{ total_interviews: string | number }>(
                `SELECT COUNT(*) AS total_interviews
                 FROM interviews
                 WHERE created_at BETWEEN $1 AND $2`,
                [from, to]
            );

            res.json({
                range: { from, to },
                totals: {
                    totalUsers: Number(totals.rows[0]?.total_users ?? 0),
                    adminUsers: Number(totals.rows[0]?.admin_users ?? 0),
                    totalInterviews: Number(interviews.rows[0]?.total_interviews ?? 0),
                    totalAiCalls: Number(totals.rows[0]?.total_ai_calls ?? 0),
                    quotaTrackedCalls: Number(totals.rows[0]?.quota_tracked_calls ?? 0),
                },
            });
        })
    );

    r.get(
        "/usage/users",
        asyncHandler(async (req, res) => {
            const parsed = paginationSchema.safeParse(req.query);
            if (!parsed.success) {
                res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
                return;
            }

            const rows = await db.query<{
                id: string;
                email: string;
                role: "user" | "admin";
                free_calls_used: string | number;
                free_calls_limit: string | number;
                ai_calls: string | number;
                last_usage_at: string | number | null;
            }>(
                `SELECT
                     u.id,
                     u.email,
                     u.role,
                     u.free_calls_used,
                     u.free_calls_limit,
                     COALESCE(SUM(ue.billable_units), 0) AS ai_calls,
                     MAX(ue.created_at) AS last_usage_at
                 FROM users u
                 LEFT JOIN usage_events ue ON ue.user_id = u.id
                 GROUP BY u.id, u.email, u.role, u.free_calls_used, u.free_calls_limit
                 ORDER BY u.created_at DESC
                 LIMIT $1 OFFSET $2`,
                [parsed.data.limit, parsed.data.offset]
            );

            res.json({
                limit: parsed.data.limit,
                offset: parsed.data.offset,
                users: rows.rows.map((row) => ({
                    id: row.id,
                    email: row.email,
                    role: row.role,
                    freeCallsUsed: Number(row.free_calls_used),
                    freeCallsLimit: Number(row.free_calls_limit),
                    freeCallsRemaining:
                        row.role === "admin"
                            ? null
                            : Math.max(0, Number(row.free_calls_limit) - Number(row.free_calls_used)),
                    totalAiCalls: Number(row.ai_calls),
                    lastUsageAt: row.last_usage_at ? Number(row.last_usage_at) : null,
                })),
            });
        })
    );

    return r;
}
