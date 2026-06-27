import { useEffect, useRef } from 'react';

/**
 * Subscribe to a Server-Sent Events stream. When `url` is non-null an EventSource is opened and
 * each JSON message is parsed and handed to `onEvent`; the connection is ALWAYS closed on unmount
 * or when `url` changes (no leaks). Pass `url=null` to stay disconnected. The callback is kept in a
 * ref so updating it does not re-open the connection.
 */
export function useSSE<T = unknown>(url: string | null, onEvent: (event: T) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (m: MessageEvent) => {
      let parsed: T;
      try {
        parsed = JSON.parse(m.data as string) as T;
      } catch {
        return; // ignore malformed frames
      }
      cb.current(parsed);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [url]);
}
