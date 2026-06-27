import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { MockEventSource } from './mockSSE';

// jsdom has no EventSource; install the mock so useSSE works in tests.
globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

afterEach(() => {
  cleanup();
  MockEventSource.instances.length = 0;
});
