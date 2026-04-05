import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import type { Pool } from "pg";
import type { Config } from "../config.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Valid bcrypt hash so compare() never throws when the user row is missing. */
const DUMMY_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export function createAuthRouter(db: Pool, config: Config) {
  const r = Router();

  r.post(
    "/register",
    asyncHandler(async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }
      const { email, password } = parsed.data;
      const id = randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      const t = Date.now();
      try {
        await db.query(
          `INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)`,
          [id, email.toLowerCase(), passwordHash, t]
        );
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505") {
          res.status(409).json({ error: "Email already registered" });
          return;
        }
        throw e;
      }
      const signOpts: SignOptions = { expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
      const token = jwt.sign({ sub: id, email: email.toLowerCase() }, config.JWT_SECRET, signOpts);
      res.status(201).json({
        token,
        user: { id, email: email.toLowerCase() },
      });
    })
  );

  r.post(
    "/login",
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }
      const email = parsed.data.email.toLowerCase();
      const userQuery = await db.query<{ id: string; email: string; password_hash: string }>(
        `SELECT id, email, password_hash FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
      );
      const user = userQuery.rows[0];
      const hash = user?.password_hash ?? DUMMY_HASH;
      const ok = await bcrypt.compare(parsed.data.password, hash);
      if (!user || !ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const signOpts: SignOptions = { expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
      const token = jwt.sign({ sub: user.id, email: user.email }, config.JWT_SECRET, signOpts);
      res.json({ token, user: { id: user.id, email: user.email } });
    })
  );

  return r;
}
