import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Outgoing email and SMS transports.
//
// MAIL_TRANSPORT="console" (default, development): messages are printed to
// the server console and saved in .outbox/. Addresses ending in
// "@bounce.example" simulate a permanent bounce so the retry/bounce handling
// can be tried without a real mail server.
//
// MAIL_TRANSPORT="smtp": sends through SMTP_HOST / SMTP_PORT / SMTP_USER /
// SMTP_PASS (SMTP_SECURE="true" for port 465) from MAIL_FROM. Use a sending
// domain with SPF and DKIM set up so reports don't land in spam (PRD §12).
//
// SMS uses the console in every environment until a provider is chosen
// (PRD open question 5); plug the provider's API into sendSms().

export type Mail = { to: string; subject: string; text: string; html?: string };
export type SendResult = { ok: true } | { ok: false; permanent: boolean; error: string };

const transport = () => process.env.MAIL_TRANSPORT ?? "console";

async function writeOutbox(kind: "email" | "sms", to: string, content: string) {
  const dir = path.join(process.cwd(), ".outbox");
  await mkdir(dir, { recursive: true });
  const safeTo = to.replace(/[^a-zA-Z0-9@._+-]/g, "_");
  await writeFile(path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${kind}-${safeTo}.txt`), content, "utf8");
}

type SmtpTransporter = { sendMail: (m: Record<string, unknown>) => Promise<unknown> };
let smtp: SmtpTransporter | null = null;
async function smtpTransport(): Promise<SmtpTransporter> {
  if (smtp) return smtp;
  const nodemailer = await import("nodemailer");
  smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  }) as unknown as SmtpTransporter;
  return smtp;
}

/** Sends one email. Never throws; the caller decides whether to retry. */
export async function deliverMail(mail: Mail): Promise<SendResult> {
  try {
    if (transport() === "console") {
      if (/@bounce\.example$/i.test(mail.to)) return { ok: false, permanent: true, error: "550 Mailbox does not exist (simulated bounce)" };
      console.info(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
      await writeOutbox("email", mail.to, `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
      return { ok: true };
    }
    if (transport() === "smtp") {
      const t = await smtpTransport();
      await t.sendMail({ from: process.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return { ok: true };
    }
    return { ok: false, permanent: true, error: `Unknown MAIL_TRANSPORT "${transport()}"` };
  } catch (err) {
    const e = err as { responseCode?: number; message?: string };
    // SMTP 5xx replies are permanent (bad address, rejected); others are worth retrying.
    return { ok: false, permanent: (e.responseCode ?? 0) >= 500, error: (e.message ?? String(err)).slice(0, 500) };
  }
}

/** Immediate send for one-time codes; throws on failure so the user sees an error. */
export async function sendMail(mail: Mail): Promise<void> {
  const result = await deliverMail(mail);
  if (!result.ok) throw new Error(`Email could not be sent: ${result.error}`);
}

export async function sendSms(to: string, text: string): Promise<void> {
  console.info(`[sms] to=${to}\n${text}\n`);
  await writeOutbox("sms", to, `To: ${to}\n\n${text}\n`);
}
