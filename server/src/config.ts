import dotenv from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

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
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return value;
      const trimmed = value.trim();
      // App platform values may be pasted with wrapping quotes.
      return trimmed.replace(/^['\"]|['\"]$/g, "");
    }),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  PGHOST: z.string().optional(),
  PGPORT: z.coerce.number().int().positive().optional(),
  PGDATABASE: z.string().optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  FREE_CALLS_LIMIT_DEFAULT: z.coerce.number().int().nonnegative().default(25),
  RESET_PASSWORD_BASE_URL: z
    .string()
    .url()
    .transform((origin) => origin.replace(/\/+$/, ""))
    .optional(),
  RESET_PASSWORD_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(30),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().min(8).max(128).optional(),
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
  const rawClientOrigin = process.env.CLIENT_ORIGIN;
  const rawClientOriginDashed = process.env["CLIENT-ORIGIN"];
  const rawClientOriginLower = process.env.client_origin;
  const normalizedEnv = {
    ...process.env,
    CLIENT_ORIGIN: rawClientOrigin ?? rawClientOriginDashed ?? rawClientOriginLower,
  };
  const parsed = envSchema.safeParse(normalizedEnv);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.CLIENT_ORIGIN &&
    /^https?:\/\/localhost(?::\d+)?$/i.test(parsed.data.CLIENT_ORIGIN)
  ) {
    const originSource =
      rawClientOrigin === parsed.data.CLIENT_ORIGIN
        ? "CLIENT_ORIGIN"
        : rawClientOriginDashed === parsed.data.CLIENT_ORIGIN
          ? "CLIENT-ORIGIN"
          : rawClientOriginLower === parsed.data.CLIENT_ORIGIN
            ? "client_origin"
            : "unknown";
    throw new Error(
      `Invalid environment: CLIENT_ORIGIN cannot be localhost in production (received: ${parsed.data.CLIENT_ORIGIN}, source: ${originSource}).`
    );
  }
  if ((parsed.data.ADMIN_SEED_EMAIL && !parsed.data.ADMIN_SEED_PASSWORD) || (!parsed.data.ADMIN_SEED_EMAIL && parsed.data.ADMIN_SEED_PASSWORD)) {
    throw new Error("Invalid environment: set both ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD together, or omit both.");
  }
  const hasAnySmtp = Boolean(
    parsed.data.SMTP_HOST ||
      parsed.data.SMTP_PORT ||
      parsed.data.SMTP_USER ||
      parsed.data.SMTP_PASS ||
      parsed.data.SMTP_FROM
  );
  const hasFullSmtp = Boolean(
    parsed.data.SMTP_HOST &&
      parsed.data.SMTP_PORT &&
      parsed.data.SMTP_USER &&
      parsed.data.SMTP_PASS &&
      parsed.data.SMTP_FROM
  );
  if (hasAnySmtp && !hasFullSmtp) {
    throw new Error(
      "Invalid environment: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM must all be set together for forgot-password email."
    );
  }
  if (hasFullSmtp && !parsed.data.RESET_PASSWORD_BASE_URL) {
    throw new Error(
      "Invalid environment: RESET_PASSWORD_BASE_URL is required when SMTP is configured."
    );
  }
  cached = parsed.data;
  return parsed.data;
}
