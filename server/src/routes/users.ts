import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Pool } from "pg";
import type { Config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getUserProfileById } from "../services/userService.js";

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export function createUsersRouter(db: Pool, config: Config) {
  const r = Router();
  const auth = requireAuth(config);

  r.use(auth);

  r.get(
    "/me",
    asyncHandler(async (req, res) => {
      const userId = req.auth!.sub;
      const profile = await getUserProfileById(db, userId);
      if (!profile) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({
        id: profile.id,
        email: profile.email,
        role: profile.role,
        freeCallsUsed: profile.freeCallsUsed,
        freeCallsLimit: profile.freeCallsLimit,
        createdAt: profile.createdAt,
      });
    })
  );

  r.patch(
    "/me/password",
    asyncHandler(async (req, res) => {
      const parsed = passwordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }
      const userId = req.auth!.sub;
      const userQuery = await db.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const user = userQuery.rows[0];
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const ok = await bcrypt.compare(parsed.data.currentPassword, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
      const nextHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [nextHash, userId]);
      res.json({ ok: true });
    })
  );

  return r;
}
