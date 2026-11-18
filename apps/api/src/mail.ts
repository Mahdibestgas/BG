// Outgoing email through Resend (https://resend.com). Configure in the host's environment:
//   RESEND_API_KEY  the API key from the Resend dashboard (never in the repository)
//   MAIL_FROM       e.g. "Best Gas Budgeting <no-reply@bestgas.sa>" once the domain is verified in Resend;
//                   without it Resend's test sender is used, which only delivers to the Resend account's own email.
import { AppError } from './http';

export const mailReady = () => !!process.env.RESEND_API_KEY;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new AppError('email_not_configured', 503);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'Best Gas Budgeting <onboarding@resend.dev>', to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => null);
  if (!r || !r.ok) throw new AppError('email_send_failed', 503);
}
