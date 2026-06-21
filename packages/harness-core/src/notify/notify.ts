import { randomUUID } from 'node:crypto';
import type { Notification, Job } from '@apolla/contracts';

export interface NotificationRepository {
  create(n: Notification): Promise<void>;
  list(ownerId: string): Promise<Notification[]>;
  markRead(ownerId: string, id: string): Promise<void>;
}

/** Out-of-band delivery (webhook/email). Pluggable; stub is the offline default. */
export interface NotificationDelivery {
  deliver(n: Notification): Promise<void>;
}

/** Records deliveries — offline/test default. */
export class StubDelivery implements NotificationDelivery {
  readonly sent: Notification[] = [];
  async deliver(n: Notification): Promise<void> {
    this.sent.push(n);
  }
}

/** POSTs the notification to a webhook URL. */
export class WebhookDelivery implements NotificationDelivery {
  constructor(private readonly url: string) {}
  async deliver(n: Notification): Promise<void> {
    await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(n) });
  }
}

export interface NotifyDeps {
  repo: NotificationRepository;
  delivery?: NotificationDelivery;
  idGen?: () => string;
}

/** Create + deliver a notification when a background job reaches a terminal state (S5-T5). */
export async function notifyJobComplete(job: Job, deps: NotifyDeps): Promise<void> {
  const n: Notification = {
    id: (deps.idGen ?? randomUUID)(),
    ownerId: job.ownerId,
    kind: job.status === 'done' ? 'job-done' : 'job-failed',
    title: `${job.kind} ${job.status}`,
    body: job.error,
    jobId: job.id,
    read: false,
  };
  await deps.repo.create(n);
  await deps.delivery?.deliver(n);
}
