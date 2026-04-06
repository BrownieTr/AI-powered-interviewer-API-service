import nodemailer from "nodemailer";
import type { Config } from "../config.js";

export function isPasswordResetEmailEnabled(config: Config): boolean {
  return Boolean(
    config.SMTP_HOST &&
      config.SMTP_PORT &&
      config.SMTP_USER &&
      config.SMTP_PASS &&
      config.SMTP_FROM &&
      config.RESET_PASSWORD_BASE_URL
  );
}

export async function sendPasswordResetEmail(
  config: Config,
  input: { to: string; resetLink: string; ttlMinutes: number }
): Promise<void> {
  if (!isPasswordResetEmailEnabled(config)) {
    throw new Error("Password reset email is not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE ?? false,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: input.to,
    subject: "Reset your AI Phone Interviewer password",
    text: `You requested a password reset. Use this secure link to set a new password:\n\n${input.resetLink}\n\nThis link expires in ${input.ttlMinutes} minutes. If you did not request this, you can ignore this email.`,
    html: `<p>You requested a password reset.</p><p>Use this secure link to set a new password:</p><p><a href="${input.resetLink}">${input.resetLink}</a></p><p>This link expires in ${input.ttlMinutes} minutes. If you did not request this, you can ignore this email.</p>`,
  });
}
