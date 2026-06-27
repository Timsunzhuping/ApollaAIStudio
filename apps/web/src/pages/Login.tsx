import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Card, Field, ErrorMsg } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim());
    } catch {
      setError('Sign in failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Card title="Sign in to Apolla AI">
        <form className="col" onSubmit={submit}>
          <Field label="Email">
            <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button type="submit" disabled={busy || !email.trim()}>{busy ? 'Signing in…' : 'Continue'}</button>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <span className="muted">No password — any email creates a workspace (demo auth).</span>
        </form>
      </Card>
    </div>
  );
}
