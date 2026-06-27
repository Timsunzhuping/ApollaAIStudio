import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Card, Field, ErrorMsg } from '../components/ui';

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      </Card>
    </div>
  );
}
