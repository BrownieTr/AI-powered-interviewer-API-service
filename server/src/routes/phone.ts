import { Router } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { InferenceClient } from "@huggingface/inference";
import type { Config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  appendCandidateTurn,
  assertDocSize,
  completeSession,
  getSessionDetail,
  listSessions,
  startPhoneSession,
} from "../services/interviewService.js";

const startSchema = z.object({
  resume: z.string().min(1).max(48_000),
  jobDescription: z.string().min(1).max(48_000),
});

const messageSchema = z.object({
  content: z.string().min(1).max(8_000),
});

export function createPhoneRouter(db: Database.Database, hf: InferenceClient, config: Config) {
  const r = Router();
  const auth = requireAuth(config);
  r.use(auth);

  r.get(
    "/sessions",
    asyncHandler(async (req, res) => {
      const rows = listSessions(db, req.auth!.sub);
      res.json({
        sessions: rows.map((s) => ({
          id: s.id,
          status: s.status,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
          hasOutcome: Boolean(s.outcome_summary),
        })),
      });
    })
  );

  r.post(
    "/sessions",
    asyncHandler(async (req, res) => {
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }
      const { resume, jobDescription } = parsed.data;
      if (!assertDocSize(resume, jobDescription)) {
        res.status(400).json({ error: "Resume or job description is too long" });
        return;
      }
      const out = await startPhoneSession(db, hf, config, req.auth!.sub, resume, jobDescription);
      res.status(201).json(out);
    })
  );

  r.get(
    "/sessions/:sessionId",
    asyncHandler(async (req, res) => {
      const detail = getSessionDetail(db, req.auth!.sub, req.params.sessionId);
      if (!detail) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(detail);
    })
  );

  r.post(
    "/sessions/:sessionId/messages",
    asyncHandler(async (req, res) => {
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }
      const result = await appendCandidateTurn(
        db,
        hf,
        config,
        req.auth!.sub,
        req.params.sessionId,
        parsed.data.content
      );
      if (result.error === "not_found") {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (result.error === "not_active") {
        res.status(409).json({ error: "This interview is already completed" });
        return;
      }
      res.json({ assistantMessage: result.assistantMessage });
    })
  );

  r.post(
    "/sessions/:sessionId/complete",
    asyncHandler(async (req, res) => {
      const result = await completeSession(db, hf, config, req.auth!.sub, req.params.sessionId);
      if (result.error === "not_found") {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if ("alreadyCompleted" in result && result.alreadyCompleted) {
        res.json({ session: result.session, alreadyCompleted: true });
        return;
      }
      res.json({ session: result.session });
    })
  );

  return r;
}
