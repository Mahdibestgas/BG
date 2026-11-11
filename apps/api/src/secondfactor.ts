import type { Account } from '@prisma/client';
import { Db } from './db';
import { AppError } from './http';
import { sha256 } from './security';
import { openSecret, verifyTotp } from './totp';

/**
 * The second step of sign-in for an account with two-factor on. A missing code is reported (so the screen can ask for it) only after the
 * password is right. A wrong code is a failed sign-in. A code is accepted once (its time step is remembered); a recovery code once, then it is gone.
 */
export async function requireSecondFactor(db: Db, acc: Account, code: unknown): Promise<void> {
  if (!acc.totpEnabled || !acc.totpSecret) return;
  const c = typeof code === 'string' ? code.replace(/\s|-/g, '') : '';
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
