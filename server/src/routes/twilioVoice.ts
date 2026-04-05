import { Router, type Request, type Response, type NextFunction } from "express";
import type Database from "better-sqlite3";
import type { InferenceClient } from "@huggingface/inference";
import twilio from "twilio";
import type { Config } from "../config.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { handleVoiceTurn, initVoiceCall, markCallStatus } from "../services/voiceGatewayService.js";

function xmlEscape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getPublicUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function asTwilioParams(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const entries = Object.entries(body as Record<string, unknown>);
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value ?? "")]));
}

function twimlGather(actionUrl: string, prompt: string): string {
  const safePrompt = xmlEscape(prompt);
  const safeAction = xmlEscape(actionUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" method="POST" action="${safeAction}" speechTimeout="auto" language="en-US">
    <Say>${safePrompt}</Say>
  </Gather>
  <Redirect method="POST">${safeAction}</Redirect>
</Response>`;
}

function twimlSayAndHangup(message: string): string {
  const safe = xmlEscape(message);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${safe}</Say>
  <Hangup/>
</Response>`;
}

function twilioSignatureGuard(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.TWILIO_AUTH_TOKEN) {
      next();
      return;
    }

    const signature = req.header("x-twilio-signature");
    if (!signature) {
      res.status(401).json({ error: "Missing Twilio signature header" });
      return;
    }

    const webhookUrl = `${getPublicUrl(req)}${req.originalUrl}`;
    const params = asTwilioParams(req.body);
    const valid = twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, webhookUrl, params);

    if (!valid) {
      res.status(403).json({ error: "Invalid Twilio request signature" });
      return;
    }

    next();
  };
}

export function createTwilioVoiceRouter(db: Database.Database, hf: InferenceClient, config: Config) {
  const r = Router();
  const guard = twilioSignatureGuard(config);

  r.post(
    "/incoming",
    guard,
    asyncHandler(async (req, res) => {
      const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : undefined;
      const from = typeof req.body?.From === "string" ? req.body.From : undefined;
      const to = typeof req.body?.To === "string" ? req.body.To : undefined;
      const callStatus = typeof req.body?.CallStatus === "string" ? req.body.CallStatus : "in-progress";

      const out = await initVoiceCall(db, hf, config, {
        callSid,
        fromNumber: from,
        toNumber: to,
        callStatus,
      });

      const actionUrl = `${getPublicUrl(req)}/api/twilio/voice/process`;
      res.type("text/xml").send(twimlGather(actionUrl, out.assistantMessage));
    })
  );

  r.post(
    "/process",
    guard,
    asyncHandler(async (req, res) => {
      const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : undefined;
      const speechResult = typeof req.body?.SpeechResult === "string" ? req.body.SpeechResult : "";
      const callStatus = typeof req.body?.CallStatus === "string" ? req.body.CallStatus : "in-progress";

      const out = await handleVoiceTurn(db, hf, config, {
        callSid,
        speechResult,
        callStatus,
      });

      if (out.interviewCompleted) {
        res.type("text/xml").send(twimlSayAndHangup(out.assistantMessage));
        return;
      }

      const actionUrl = `${getPublicUrl(req)}/api/twilio/voice/process`;
      res.type("text/xml").send(twimlGather(actionUrl, out.assistantMessage));
    })
  );

  r.post(
    "/status",
    guard,
    asyncHandler(async (req, res) => {
      const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : undefined;
      const callStatus = typeof req.body?.CallStatus === "string" ? req.body.CallStatus : undefined;

      await markCallStatus(db, hf, config, { callSid, callStatus });
      res.status(204).send();
    })
  );

  return r;
}
