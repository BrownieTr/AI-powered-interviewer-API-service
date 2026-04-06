import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import type { Pool } from "pg";
import type { Config } from "../config.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createUser, getUserForAuthByEmail, normalizeEmail } from "../services/userService.js";
import { consumePasswordResetToken, createPasswordResetToken } from "../services/passwordResetService.js";
import { isPasswordResetEmailEnabled, sendPasswordResetEmail } from "../services/mailService.js";

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32).max(512),
  newPassword: z.string().min(8).max(128),
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
      const normalizedEmail = normalizeEmail(email);
      const id = randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      const t = Date.now();
      try {
        await createUser(db, {
          id,
          email: normalizedEmail,
          passwordHash,
          role: "user",
          freeCallsUsed: 0,
          freeCallsLimit: config.FREE_CALLS_LIMIT_DEFAULT,
          createdAt: t,
        });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505") {
          res.status(409).json({ error: "Email already registered" });
          return;
        }
        throw e;
      }
      const signOpts: SignOptions = { expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
      const token = jwt.sign({ sub: id, email: normalizedEmail, role: "user" }, config.JWT_SECRET, signOpts);
      res.status(201).json({
        token,
        user: {
          id,
          email: normalizedEmail,
          role: "user",
          freeCallsUsed: 0,
          freeCallsLimit: config.FREE_CALLS_LIMIT_DEFAULT,
        },
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
      const user = await getUserForAuthByEmail(db, parsed.data.email);
      const hash = user?.passwordHash ?? DUMMY_HASH;
      const ok = await bcrypt.compare(parsed.data.password, hash);
      if (!user || !ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const signOpts: SignOptions = { expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
      const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.JWT_SECRET, signOpts);
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          freeCallsUsed: user.freeCallsUsed,
          freeCallsLimit: user.freeCallsLimit,
        },
      });
    })
  );

  r.post(
    "/forgot-password",
    asyncHandler(async (req, res) => {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      if (!isPasswordResetEmailEnabled(config)) {
        res.status(503).json({ error: "Password reset is not configured." });
        return;
      }

      const user = await getUserForAuthByEmail(db, parsed.data.email);
      if (user) {
        const token = await createPasswordResetToken(db, user.id, config.RESET_PASSWORD_TOKEN_TTL_MIN);
        const resetLink = `${config.RESET_PASSWORD_BASE_URL}?token=${encodeURIComponent(token)}`;
        await sendPasswordResetEmail(config, {
          to: user.email,
          resetLink,
          ttlMinutes: config.RESET_PASSWORD_TOKEN_TTL_MIN,
        });
      }

      // Always return a generic response to avoid user enumeration.
      res.status(202).json({
        ok: true,
        message: "If the email exists, a password reset link has been sent.",
      });
    })
  );

  r.post(
    "/reset-password",
    asyncHandler(async (req, res) => {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const nextPasswordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      const ok = await consumePasswordResetToken(db, parsed.data.token, nextPasswordHash);
      if (!ok) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      res.json({ ok: true });
    })
  );

  return r;
}
