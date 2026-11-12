import "server-only";
import { deliverMail } from "./mailer";
import { APP_NAME, COLLEGE_NAME } from "./config";

/**
 * Emails a new or reset temporary password to the user (FR-1). Never throws:
 * returns whether the message went out so the admin can fall back to giving
 * the password in person.
 */
export async function sendCredentialsEmail(opts: {
  to: string | null | undefined;
  name: string;
  collegeId: string;
  tempPassword: string;
  reset?: boolean;
}): Promise<{ sent: boolean; error?: string }> {
  if (!opts.to) return { sent: false, error: "No email address on file." };
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const intro = opts.reset
    ? `Your ${APP_NAME} password was reset by the college office.`
    : `An account has been created for you on ${APP_NAME} (${COLLEGE_NAME}).`;
  const text = [
    `Hello ${opts.name},`,
    "",
    intro,
    "",
    `Sign in at: ${base}/login`,
    `College ID: ${opts.collegeId}`,
    `Temporary password: ${opts.tempPassword}`,
    "",
    "On your first sign-in we will send a verification code to this email and ask you to choose your own password.",
    `If you forget your password later, use "Forgot password" on the sign-in page: ${base}/account/recover`,
    "",
    "Do not share this password with anyone.",
  ].join("\n");
  const result = await deliverMail({ to: opts.to, subject: `Your ${APP_NAME} login details`, text });
  return result.ok ? { sent: true } : { sent: false, error: result.error };
}
