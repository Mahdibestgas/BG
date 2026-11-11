import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError } from './http';

/**
 * Firebase Authentication, verified the way Google documents for custom backends: the ID token is a JWT signed by
 * Google (RS256). We check the signature against Google's public keys, the issuer and audience (our Firebase project),
 * the expiry and the auth time. No Firebase secret or service account is needed on this server, only the project id.
 * A verified token is linked to an EXISTING account by its verified email; it never creates a company or an account.
 */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let resolver: JWTVerifyGetKey | null = null;

/** For tests: use a local key instead of Google's. */
export function setFirebaseKeyResolver(r: JWTVerifyGetKey | null) { resolver = r; }
export const firebaseProject = () => (process.env.FIREBASE_PROJECT_ID || '').trim();

/** The web config the browser needs (public identifiers: apiKey, authDomain, projectId, appId). Null when Firebase is not set up. */
export function firebaseWebConfig(): Record<string, string> | null {
  if (!firebaseProject()) return null;
  try {
    const c = JSON.parse(process.env.FIREBASE_WEB_CONFIG || '{}');
    if (typeof c?.apiKey === 'string' && typeof c?.authDomain === 'string') return { apiKey: c.apiKey, authDomain: c.authDomain, projectId: firebaseProject(), ...(typeof c.appId === 'string' ? { appId: c.appId } : {}) };
  } catch { /* fall through */ }
  return null;
}

export interface FirebaseIdentity { uid: string; email: string; emailVerified: boolean; provider: string }

export async function verifyFirebaseToken(token: unknown): Promise<FirebaseIdentity> {
  const pid = firebaseProject();
  if (!pid) throw new AppError('firebase_not_configured', 503);
  if (typeof token !== 'string' || token.length < 100 || token.length > 8000) throw new AppError('invalid_token', 401);
  const keys = resolver || (resolver = createRemoteJWKSet(new URL(JWKS_URL), { cooldownDuration: 30_000 }));
  let p: JWTPayload;
  try {
    ({ payload: p } = await jwtVerify(token, keys, { issuer: 'https://securetoken.google.com/' + pid, audience: pid, algorithms: ['RS256'], clockTolerance: 5 }));
  } catch { throw new AppError('invalid_token', 401); }
  const authTime = Number((p as any).auth_time);
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) throw new AppError('invalid_token', 401);
  if (!Number.isFinite(authTime) || authTime > Math.floor(Date.now() / 1000) + 5) throw new AppError('invalid_token', 401);
  const email = typeof (p as any).email === 'string' ? (p as any).email.trim().toLowerCase() : '';
  return { uid: p.sub, email, emailVerified: (p as any).email_verified === true, provider: String((p as any).firebase?.sign_in_provider || 'unknown').slice(0, 40) };
}
