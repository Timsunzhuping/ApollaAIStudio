import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Card, Field, ErrorMsg } from '../components/ui';

const PROVIDER_LABEL: Record<string, string> = { google: 'Continue with Google', github: 'Continue with GitHub', stub: 'Continue with Demo SSO' };

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    api.authProviders().then((r) => setProviders(r.providers ?? [])).catch(() => setProviders([]));
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
    void run(() => (mode === 'register' ? register(email.trim(), password) : login(email.trim(), password)));
  };

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
            <button type="button" className="ghost" disabled={busy || !email.trim()} onClick={() => void run(() => login(email.trim()))} title="Demo mode only">
              Continue as demo
            </button>
          </div>
          <span className="muted">Demo mode allows passwordless sign-in; production requires a password.</span>
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
