import { useEffect, useState } from 'react';
import { api, type BillingInfo } from '../lib/api';
import { Card, Loading, ErrorMsg } from '../components/ui';

export function Billing() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.billing().then(setInfo).catch((e) => setError(String(e.message ?? e)));
  useEffect(() => { void load(); }, []);

  const upgrade = async (plan: string) => {
    setBusy(true);
    try {
      const r = await api.checkout(plan);
      if (r.activated) await load(); // stub/demo: activated immediately
      else window.location.href = r.url; // real provider: hosted checkout
    } catch (e) {
      setError(e instanceof Error ? e.message : 'checkout failed');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => { setBusy(true); try { await api.cancelBilling(); await load(); } finally { setBusy(false); } };

  if (error) return <div className="col"><ErrorMsg>{error}</ErrorMsg></div>;
  if (!info) return <Loading label="Loading billing…" />;
  const pct = info.usage.limit ? Math.min(100, Math.round((info.usage.used / info.usage.limit) * 100)) : 0;

  return (
    <div className="col">
      <Card title="Your plan">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{info.plan.name}</strong>
          {info.plan.id !== 'free' && <button className="ghost" disabled={busy} onClick={() => void cancel()}>Cancel subscription</button>}
        </div>
        <div className="muted">Usage: {info.usage.used} / {info.usage.limit} tasks</div>
        <div style={{ height: 8, background: 'var(--panel-2)', borderRadius: 999 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
        </div>
      </Card>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
        {info.plans.map((p) => (
          <Card key={p.id} title={p.name}>
            <div className="cost">{p.priceUsd ? `$${p.priceUsd}/mo` : 'Free'}</div>
            <div className="muted">{p.taskLimit.toLocaleString()} tasks</div>
            <div className="muted">{p.features.join(', ')}</div>
            {p.id === info.plan.id ? (
              <span className="badge">current</span>
            ) : p.id !== 'free' ? (
              <button disabled={busy} onClick={() => void upgrade(p.id)}>Upgrade to {p.name}</button>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
