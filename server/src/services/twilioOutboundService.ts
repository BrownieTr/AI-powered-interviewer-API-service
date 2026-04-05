import twilio from "twilio";
import type { Config } from "../config.js";

const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

export function assertE164Phone(phone: string): boolean {
  return E164_PHONE_REGEX.test(phone.trim());
}

export function getTwilioPublicBaseUrl(config: Config, fallbackBaseUrl?: string): string {
  const base = config.TWILIO_PUBLIC_BASE_URL ?? fallbackBaseUrl;
  if (!base) {
    throw new Error("TWILIO_PUBLIC_BASE_URL is required to place outbound calls.");
  }

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error("TWILIO_PUBLIC_BASE_URL must be a valid URL (for example, https://your-domain.ngrok-free.app).");
  }

  const host = parsed.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      "TWILIO_PUBLIC_BASE_URL cannot use localhost. Use a public HTTPS URL (for example, an ngrok URL)."
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error("TWILIO_PUBLIC_BASE_URL must use https:// so Twilio can call your webhook.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function assertTwilioOutboundReady(config: Config): void {
  if (!config.TWILIO_ACCOUNT_SID) {
    throw new Error("TWILIO_ACCOUNT_SID is required to place outbound calls.");
  }
  if (!config.TWILIO_AUTH_TOKEN) {
    throw new Error("TWILIO_AUTH_TOKEN is required to place outbound calls.");
  }
  if (!config.TWILIO_PHONE_NUMBER) {
    throw new Error("TWILIO_PHONE_NUMBER is required to place outbound calls.");
  }
  if (!assertE164Phone(config.TWILIO_PHONE_NUMBER)) {
    throw new Error("TWILIO_PHONE_NUMBER must be in E.164 format (for example, +16045551234).");
  }
}

export async function placeOutboundInterviewCall(
  config: Config,
  input: {
    toNumber: string;
    publicBaseUrl: string;
  }
): Promise<{ callSid: string }> {
  assertTwilioOutboundReady(config);

  const toNumber = input.toNumber.trim();
  if (!assertE164Phone(toNumber)) {
    throw new Error("candidatePhone must be in E.164 format (for example, +16045559876).");
  }

  const client = twilio(config.TWILIO_ACCOUNT_SID!, config.TWILIO_AUTH_TOKEN!);
  const incomingUrl = `${input.publicBaseUrl}/api/twilio/voice/incoming`;
  const statusUrl = `${input.publicBaseUrl}/api/twilio/voice/status`;

  const call = await client.calls.create({
    to: toNumber,
    from: config.TWILIO_PHONE_NUMBER!,
    url: incomingUrl,
    method: "POST",
    statusCallback: statusUrl,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });

  return { callSid: call.sid };
}
