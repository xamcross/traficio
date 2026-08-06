import { API_BASE } from '../config';
import { AssessmentStatus } from '../api/types';

/**
 * The subset of the browser EventSource surface that openAssessmentStream needs. A real
 * EventSource satisfies this structurally; tests substitute a hand-rolled fake via
 * setEventSourceFactory(), with no cast required.
 */
export interface EventSourceLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

/** Test seam: overridden in specs to hand back a fake instead of a real EventSource. */
export let eventSourceFactory: (url: string) => EventSourceLike = (url) =>
  new EventSource(url, { withCredentials: true });

export function setEventSourceFactory(factory: (url: string) => EventSourceLike): void {
  eventSourceFactory = factory;
}

/**
 * Opens the assessment status SSE stream. Each `message` frame is parsed as {status} and
 * forwarded to onStatus. The backend closes the stream at terminal status, when the assessment
 * disappears, or at its own time cap - there is no terminating event, so the browser's
 * EventSource reports that close as an error (and would otherwise auto-reconnect). This wrapper
 * closes the source and calls onClose exactly once when that happens.
 *
 * The returned cleanup function closes the source WITHOUT calling onClose, for use on component
 * teardown where no further reaction is wanted.
 */
export function openAssessmentStream(
  id: string,
  onStatus: (status: AssessmentStatus) => void,
  onClose: () => void,
): () => void {
  const source = eventSourceFactory(`${API_BASE}/v1/assessments/${id}/events`);
  let closed = false;

  source.onmessage = (event: MessageEvent) => {
    if (closed) return;
    try {
      const frame = JSON.parse(event.data as string) as { status: AssessmentStatus };
      onStatus(frame.status);
    } catch {
      // Malformed frame; ignore and wait for the next one.
    }
  };

  source.onerror = () => {
    if (closed) return;
    closed = true;
    source.close();
    onClose();
  };

  return () => {
    if (closed) return;
    closed = true;
    source.close();
  };
}
