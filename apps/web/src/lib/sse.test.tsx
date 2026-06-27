import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { useSSE } from './sse';
import { MockEventSource } from '../test/mockSSE';

function Probe({ url }: { url: string | null }) {
  const [items, setItems] = useState<string[]>([]);
  useSSE<{ text: string }>(url, (e) => setItems((xs) => [...xs, e.text]));
  return <div data-testid="out">{items.join(',')}</div>;
}

describe('useSSE', () => {
  it('opens a connection, parses JSON events into the callback', () => {
    render(<Probe url="/api/x/events" />);
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => {
      MockEventSource.last().emit({ text: 'a' });
      MockEventSource.last().emit({ text: 'b' });
    });
    expect(screen.getByTestId('out').textContent).toBe('a,b');
  });

  it('ignores malformed frames', () => {
    render(<Probe url="/api/x/events" />);
    act(() => MockEventSource.last().onmessage?.({ data: 'not json' }));
    expect(screen.getByTestId('out').textContent).toBe('');
  });

  it('does not connect when url is null and closes on unmount', () => {
    const empty = render(<Probe url={null} />);
    expect(MockEventSource.instances).toHaveLength(0);
    empty.unmount();

    const live = render(<Probe url="/api/x/events" />);
    const es = MockEventSource.last();
    expect(es.closed).toBe(false);
    live.unmount();
    expect(es.closed).toBe(true);
  });
});
