export class SlidingWindowLimiter {
  private readonly timestamps: number[] = [];
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.pump();
    });
  }

  tryAcquire(): boolean {
    this.pruneExpired();
    if (this.timestamps.length >= this.limit) return false;
    this.timestamps.push(Date.now());
    return true;
  }

  private pruneExpired(): void {
    const now = Date.now();
    while (this.timestamps.length > 0 && now - this.timestamps[0]! >= this.windowMs) {
      this.timestamps.shift();
    }
  }

  private pump(): void {
    const now = Date.now();
    this.pruneExpired();

    while (this.queue.length > 0 && this.timestamps.length < this.limit) {
      this.timestamps.push(now);
      const resolve = this.queue.shift();
      resolve?.();
    }

    if (this.queue.length > 0) {
      const waitMs = this.windowMs - (now - this.timestamps[0]!) + 5;
      setTimeout(() => this.pump(), Math.max(waitMs, 50));
    }
  }
}

// Shared across every tenant: the provider caps requests per minute regardless
// of who is asking, so this must be one bucket, not one per tenant.
export const llmRateLimiter = new SlidingWindowLimiter(40, 60_000);

export async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function runNext(): Promise<void> {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}

// Interleaves cases across tenants so one tenant with a large backlog cannot
// starve the others within a single tick.
export function roundRobinByTenant<T extends { tenantId: string }>(rows: T[]): T[] {
  const byTenant = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byTenant.get(row.tenantId);
    if (bucket) bucket.push(row);
    else byTenant.set(row.tenantId, [row]);
  }

  const buckets = [...byTenant.values()];
  const ordered: T[] = [];
  for (let i = 0; ordered.length < rows.length; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) ordered.push(bucket[i]!);
    }
  }
  return ordered;
}
