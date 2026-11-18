import crypto from 'node:crypto';
import type { Account } from '@prisma/client';
import { Db } from './db';
import { AppError } from './http';
import { sendMail } from './mail';
import { signInCodeEmail } from './mailTemplates';
import { sha256 } from './security';
import { openSecret, verifyTotp } from './totp';

const EMAIL_CODE_MINUTES = 10;
const EMAIL_CODE_RESEND_SECONDS = 60;
const emailCodeHash = (accountId: string, code: string) => sha256(accountId + ':' + code);

/**
 * The second step of sign-in for an account with two-factor on. A missing code is reported (so the screen can ask for it) only after the
 * password is right. A wrong code is a failed sign-in. A code is accepted once (its time step is remembered); a recovery code once, then it is gone.
 * Authenticator app first; otherwise, with email codes on, a six-digit code is emailed and must come back within ten minutes.
 */
export async function requireSecondFactor(db: Db, acc: Account, code: unknown): Promise<void> {
  const c = typeof code === 'string' ? code.replace(/\s|-/g, '') : '';
  if (acc.totpEnabled && acc.totpSecret) {
    if (!c) throw new AppError('totp_required', 401);
    if (/^\d{6}$/.test(c)) {
      const step = verifyTotp(openSecret(acc.totpSecret), c);
      if (step !== null && (acc.totpLastStep === null || step > acc.totpLastStep)) {
        await db.account.update({ where: { id: acc.id }, data: { totpLastStep: step } });
        return;
      }
    } else {
      const codes = (acc.recoveryCodes as string[] | null) || [];
      const h = sha256(c.toLowerCase());
      if (codes.includes(h)) { await db.account.update({ where: { id: acc.id }, data: { recoveryCodes: codes.filter((x) => x !== h) } }); return; }
    }
    throw new AppError('invalid_credentials', 401);
  }
  if (!acc.emailOtpEnabled || process.env.CF13_EMAIL_OTP === 'off') return;   // CF13_EMAIL_OTP=off is the emergency switch if email stops working
  const now = Date.now();
  if (!c) {
    const live = acc.emailOtpExpires && acc.emailOtpExpires.getTime() > now;
    const recent = live && acc.emailOtpExpires!.getTime() - EMAIL_CODE_MINUTES * 60000 > now - EMAIL_CODE_RESEND_SECONDS * 1000;
    if (!recent) {   // one email a minute at most, whatever is clicked
      const fresh = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await db.account.update({ where: { id: acc.id }, data: { emailOtpHash: emailCodeHash(acc.id, fresh), emailOtpExpires: new Date(now + EMAIL_CODE_MINUTES * 60000) } });
      const mail = signInCodeEmail(acc.name, fresh, EMAIL_CODE_MINUTES);
      await sendMail(acc.email, mail.subject, mail.text, mail.html);
    }
    throw new AppError('email_code_required', 401);
  }
  const ok = /^\d{6}$/.test(c) && acc.emailOtpHash && acc.emailOtpExpires && acc.emailOtpExpires.getTime() > now
    && crypto.timingSafeEqual(Buffer.from(acc.emailOtpHash), Buffer.from(emailCodeHash(acc.id, c)));
  if (!ok) throw new AppError('invalid_credentials', 401);
  await db.account.update({ where: { id: acc.id }, data: { emailOtpHash: null, emailOtpExpires: null } });
}
