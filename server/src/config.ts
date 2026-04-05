import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  PORT: z.coerce.number().positive().optional(),
  CLIENT_ORIGIN: z
    .string()
    .url()
    .transform((origin) => origin.replace(/\/+$/, ""))
    .optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  /** Hugging Face access token: https://huggingface.co/settings/tokens */
  HF_TOKEN: z.string().min(1, "HF_TOKEN is required"),
  /** Hub model id — must list Inference Providers on the model page (3B variant often has none). */
  HF_MODEL: z.string().default("Qwen/Qwen2.5-1.5B-Instruct"),
  /** Inference provider id, or "auto" (omit) to use HF router defaults */
  HF_PROVIDER: z.string().optional(),
  DATABASE_PATH: z.string().default("./data/app.db"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  /** Twilio auth token for webhook signature verification. */
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Twilio caller ID used as the From number for outbound interview calls. */
  TWILIO_PHONE_NUMBER: z.string().optional(),
  /** Public HTTPS base URL Twilio can reach (for webhook callbacks). */
  TWILIO_PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((origin) => origin.replace(/\/+$/, ""))
    .optional(),
  /** Optional voice mode default context when caller has no uploaded resume. */
  TWILIO_DEFAULT_RESUME: z.string().default(
    "No resume was uploaded for this phone interview. Gather candidate experience through interview questions."
  ),
  TWILIO_DEFAULT_JOB_DESCRIPTION: z.string().default(
    "General software developer interview. Assess fundamentals, communication, and problem solving."
  ),
  /** System user email for voice calls persisted in the same interview tables. */
  TWILIO_SYSTEM_USER_EMAIL: z.string().email().default("twilio.voice@local.invalid"),
});

export type Config = z.infer<typeof envSchema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  cached = parsed.data;
  return parsed.data;
}
