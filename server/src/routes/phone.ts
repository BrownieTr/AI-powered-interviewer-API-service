import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Pool } from "pg";
import type { InferenceClient } from "@huggingface/inference";
import type { Config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { extractResumeText, ResumeParseError } from "../services/resumeExtraction.js";
import {
  assertE164Phone,
  getTwilioPublicBaseUrl,
  placeOutboundInterviewCall,
} from "../services/twilioOutboundService.js";
import { bindCallToInterview } from "../services/voiceGatewayService.js";
import {
  appendCandidateTurn,
  assertDocSize,
  completeSession,
  getSessionDetail,
  listSessions,
  startPhoneSession,
} from "../services/interviewService.js";

const startSchema = z.object({
  resume: z.string().trim().min(1).max(48_000).optional(),
  jobDescription: z.string().trim().min(1).max(48_000),
  candidatePhone: z.string().trim().min(8).max(20),
});

const messageSchema = z.object({
  content: z.string().min(1).max(8_000),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export function createPhoneRouter(db: Pool, hf: InferenceClient, config: Config) {
  const r = Router();
  const auth = requireAuth(config);
  r.use(auth);

  r.get(
    "/sessions",
    asyncHandler(async (req, res) => {
      const rows = await listSessions(db, req.auth!.sub);
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
    upload.single("resumeFile"),
    asyncHandler(async (req, res) => {
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }
      const { jobDescription, candidatePhone } = parsed.data;
      let resume = parsed.data.resume ?? "";

      if (!assertE164Phone(candidatePhone)) {
        res.status(400).json({
          error: "candidatePhone must be in E.164 format (for example, +16045559876).",
        });
        return;
      }

      if (req.file) {
        try {
          resume = await extractResumeText(req.file);
        } catch (error) {
          if (error instanceof ResumeParseError) {
            res.status(400).json({ error: error.message });
            return;
          }
          throw error;
        }
      }

      if (!resume.trim()) {
        res.status(400).json({ error: "Provide resume text or upload a resume file." });
        return;
      }

      if (!assertDocSize(resume, jobDescription)) {
        res.status(400).json({ error: "Resume or job description is too long" });
        return;
      }
      const out = await startPhoneSession(db, hf, config, req.auth!.sub, resume, jobDescription);

      try {
        const publicBaseUrl = getTwilioPublicBaseUrl(config);
        const dial = await placeOutboundInterviewCall(config, {
          toNumber: candidatePhone,
          publicBaseUrl,
        });

        await bindCallToInterview(db, {
          callSid: dial.callSid,
          interviewId: out.sessionId,
          userId: req.auth!.sub,
          fromNumber: config.TWILIO_PHONE_NUMBER,
          toNumber: candidatePhone,
          callStatus: "queued",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not initiate outbound call";
        res.status(201).json({
          ...out,
          sessionId: out.sessionId,
          callInitiated: false,
          warning: message,
        });
        return;
      }

      res.status(201).json({ ...out, callInitiated: true });
    })
  );

  r.get(
    "/sessions/:sessionId",
    asyncHandler(async (req, res) => {
      const detail = await getSessionDetail(db, req.auth!.sub, req.params.sessionId);
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
