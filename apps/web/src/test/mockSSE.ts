/** Minimal EventSource stand-in for tests: capture instances + push events manually. */
export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    MockEventSource.instances.push(this);
  }
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close(): void {
    this.closed = true;
  }
  static last(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1]!;
  }
}
