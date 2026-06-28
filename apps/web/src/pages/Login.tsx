import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { api, isMfaRequired } from '../lib/api';
import { Card, Field, ErrorMsg } from '../components/ui';

const PROVIDER_LABEL: Record<string, string> = { google: 'Continue with Google', github: 'Continue with GitHub', stub: 'Continue with Demo SSO' };

export function Login() {
  const { login, register, completeMfa, loginWithMagicToken } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [pendingToken, setPendingToken] = useState<string | null>(null); // MFA challenge (S20)
  const [mfaCode, setMfaCode] = useState('');
  const [magicSent, setMagicSent] = useState(false);

  useEffect(() => {
    api.authProviders().then((r) => setProviders(r.providers ?? [])).catch(() => setProviders([]));
    // Magic-link landing: /auth/magic?token=… → verify + sign in.
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) void run(() => loginWithMagicToken(token));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'register') return void run(() => register(email.trim(), password));
    void run(async () => {
      const result = await login(email.trim(), password);
      if (isMfaRequired(result)) setPendingToken(result.pendingToken); // ask for the second factor
    });
  };

  const submitMfa = (e: FormEvent) => {
    e.preventDefault();
    void run(() => completeMfa(pendingToken!, mfaCode.trim()));
  };

  const requestMagicLink = () => void run(async () => { await api.magicLinkRequest(email.trim()); setMagicSent(true); });

  // Second-factor challenge screen.
  if (pendingToken) {
    return (
      <div className="login">
        <Card title="Two-factor authentication">
          <form className="col" onSubmit={submitMfa}>
            <span className="muted">Enter the 6-digit code from your authenticator app (or a recovery code).</span>
            <Field label="Code"><input autoFocus inputMode="numeric" placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} /></Field>
            <button type="submit" disabled={busy || !mfaCode.trim()}>{busy ? 'Verifying…' : 'Verify'}</button>
            {error && <ErrorMsg>{error}</ErrorMsg>}
            <button type="button" className="ghost" onClick={() => { setPendingToken(null); setMfaCode(''); setError(null); }}>Back</button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="login">
      <Card title={mode === 'register' ? 'Create your Apolla account' : 'Sign in to Apolla AI'}>
        <form className="col" onSubmit={submit}>
          <Field label="Email">
            <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input type="password" required minLength={8} placeholder="at least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button type="submit" disabled={busy || !email.trim() || password.length < 8}>
            {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
              {mode === 'login' ? 'Create an account' : 'Have an account? Sign in'}
            </button>
            <button type="button" className="ghost" disabled={busy || !email.trim()} onClick={() => void run(async () => { await login(email.trim()); })} title="Demo mode only">
              Continue as demo
            </button>
          </div>
          <span className="muted">Demo mode allows passwordless sign-in; production requires a password.</span>
          {mode === 'login' && (
            magicSent
              ? <span className="badge">✓ If that email exists, a sign-in link is on its way.</span>
              : <button type="button" className="ghost" disabled={busy || !email.trim()} onClick={requestMagicLink}>✉ Email me a sign-in link</button>
          )}
        </form>
        {providers.length > 0 && (
          <div className="col" style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            <span className="muted">or</span>
            {providers.map((p) => (
              <a key={p} className="button ghost" role="button" href={api.oauthStartUrl(p)}>
                {PROVIDER_LABEL[p] ?? `Continue with ${p}`}
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
