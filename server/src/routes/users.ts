import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export function createUsersRouter(db: Database.Database, config: Config) {
  const r = Router();
  const auth = requireAuth(config);

  r.use(auth);

  r.get(
    "/me",
    asyncHandler(async (req, res) => {
      const userId = req.auth!.sub;
      const row = db
        .prepare(`SELECT id, email, created_at FROM users WHERE id = ?`)
        .get(userId) as { id: string; email: string; created_at: number } | undefined;
      if (!row) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({
        id: row.id,
        email: row.email,
        createdAt: row.created_at,
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
      const user = db
        .prepare(`SELECT password_hash FROM users WHERE id = ?`)
        .get(userId) as { password_hash: string } | undefined;
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
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(nextHash, userId);
      res.json({ ok: true });
    })
  );

  return r;
}
