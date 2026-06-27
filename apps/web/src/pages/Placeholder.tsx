import { Card } from '../components/ui';

export function Placeholder({ title }: { title: string }) {
  return (
    <Card title={title}>
      <span className="muted">This section lands later in Sprint 09.</span>
    </Card>
  );
}
