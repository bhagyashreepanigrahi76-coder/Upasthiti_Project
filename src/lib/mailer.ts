import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Outgoing email and SMS. In development (MAIL_TRANSPORT=console, the default)
// messages are printed to the server console and saved as text files in
// .outbox/ so you can read OTP codes. A real SMTP / SMS provider is wired in
// on Day 9 (PRD open question 5).

export type Mail = { to: string; subject: string; text: string };

const transport = () => process.env.MAIL_TRANSPORT ?? "console";

async function writeOutbox(kind: "email" | "sms", to: string, content: string) {
  const dir = path.join(process.cwd(), ".outbox");
  await mkdir(dir, { recursive: true });
  const safeTo = to.replace(/[^a-zA-Z0-9@._+-]/g, "_");
  await writeFile(path.join(dir, `${Date.now()}-${kind}-${safeTo}.txt`), content, "utf8");
}

export async function sendMail(mail: Mail): Promise<void> {
  if (transport() === "console") {
    console.info(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    await writeOutbox("email", mail.to, `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }
  throw new Error(`MAIL_TRANSPORT "${transport()}" is not set up yet. Use "console" until Day 9.`);
}

export async function sendSms(to: string, text: string): Promise<void> {
  if (transport() === "console") {
    console.info(`[sms] to=${to}\n${text}\n`);
    await writeOutbox("sms", to, `To: ${to}\n\n${text}\n`);
    return;
  }
  throw new Error(`SMS transport is not set up yet. Use MAIL_TRANSPORT="console" until Day 9.`);
}
