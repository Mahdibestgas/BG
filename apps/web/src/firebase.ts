/** Firebase sign-in in the browser. Firebase only proves who the person is; the company's own session cookie does the rest. */
type Mode = { kind: 'google' } | { kind: 'password'; email: string; password: string };

export async function firebaseIdToken(config: Record<string, string>, mode: Mode): Promise<string> {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
  const app = getApps()[0] || initializeApp(config);
  const auth = getAuth(app);
  const cred = mode.kind === 'google' ? await signInWithPopup(auth, new GoogleAuthProvider()) : await signInWithEmailAndPassword(auth, mode.email, mode.password);
  const token = await cred.user.getIdToken();
  await signOut(auth);                       // nothing to keep in the browser: our own httpOnly cookie is the session
  return token;
}
