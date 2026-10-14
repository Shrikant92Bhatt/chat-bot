/**
 * Reliability building blocks for the tool executor (plan §12): provider
 * quotas, a per-user result cache, a circuit breaker and output truncation.
 */

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; resetAt: number }>;
}

/** Production limiter: the existing Firestore-backed counter, so quotas hold across instances. */
export class FirestoreRateLimiter implements RateLimiter {
  async consume(key: string, limit: number, windowMs: number) {
    const { AnonUsageService } = require('../services/anon-usage.service') as typeof import('../services/anon-usage.service');
    const result = await AnonUsageService.checkAndConsume(key, limit, windowMs);
    return { allowed: result.allowed, resetAt: result.resetAt };
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async consume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, resetAt: now + windowMs };
    }
    if (w.count >= limit) return { allowed: false, resetAt: w.resetAt };
    w.count += 1;
    return { allowed: true, resetAt: w.resetAt };
  }
}

/**
 * Small in-process TTL cache. Keys always include the owner uid and
 * connection id (see tool-executor.ts), so a private result can never be
 * served to another user; entries are dropped on disconnect.
 */
export class ResultCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly maxEntries = 500) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  deleteWhere(predicate: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) if (predicate(key)) this.entries.delete(key);
  }
}

/** Opens after `threshold` consecutive provider failures; half-opens after `coolDownMs`. */
export class CircuitBreaker {
  private readonly state = new Map<string, { failures: number; openUntil: number }>();

  constructor(
    private readonly threshold = 5,
    private readonly coolDownMs = 30_000
  ) {}

  isOpen(key: string): boolean {
    const s = this.state.get(key);
    return Boolean(s && s.openUntil > Date.now());
  }

  success(key: string): void {
    this.state.delete(key);
  }

  failure(key: string): void {
    const s = this.state.get(key) ?? { failures: 0, openUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.threshold) {
      s.openUntil = Date.now() + this.coolDownMs;
      s.failures = 0;
    }
    this.state.set(key, s);
  }
}

/**
 * Shrinks a JSON-able value until its serialization fits `maxChars`:
 * arrays are cut and long strings clipped, progressively. Returns whether
 * anything was dropped so the result can be flagged `truncated` - nothing is
 * ever silently cut (AGENTS.md: no silent truncation).
 */
export function fitToBudget<T>(value: T, maxChars: number): { value: T; truncated: boolean } {
  if (JSON.stringify(value).length <= maxChars) return { value, truncated: false };
  let arrayCap = 50;
  let stringCap = 4000;
  let current = value;
  for (let i = 0; i < 8; i++) {
    current = shrink(value, arrayCap, stringCap) as T;
    if (JSON.stringify(current).length <= maxChars) return { value: current, truncated: true };
    arrayCap = Math.max(1, Math.floor(arrayCap / 2));
    stringCap = Math.max(200, Math.floor(stringCap / 2));
  }
  return { value: current, truncated: true };
}

function shrink(value: unknown, arrayCap: number, stringCap: number): unknown {
  if (typeof value === 'string') return value.length > stringCap ? `${value.slice(0, stringCap)}…` : value;
  if (Array.isArray(value)) return value.slice(0, arrayCap).map((v) => shrink(v, arrayCap, stringCap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shrink(v, arrayCap, stringCap)]));
  }
  return value;
}
