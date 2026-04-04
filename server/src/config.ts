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
