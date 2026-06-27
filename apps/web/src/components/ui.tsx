import type { ReactNode } from 'react';

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card col">
      {(title || actions) && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          {title ? <h3 style={{ margin: 0 }}>{title}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children = 'Nothing here yet.' }: { children?: ReactNode }) {
  return <div className="muted">{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="muted" role="status">{label}</div>;
}

export function ErrorMsg({ children }: { children: ReactNode }) {
  return <div className="error" role="alert">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="col" style={{ gap: '0.25rem' }}>
      <span>{label}</span>
      {children}
    </label>
  );
}
