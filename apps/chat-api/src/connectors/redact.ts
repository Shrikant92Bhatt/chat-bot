import crypto from 'crypto';

/**
 * Redaction helpers for anything that leaves a connector call as a log line,
 * an audit record or telemetry (plan §6, §12). The rule: record the SHAPE of
 * what happened (which keys, how long, a digest to correlate), never the
 * values - email bodies, repository content, tokens and codes stay out.
 */

const SECRET_PATTERNS: RegExp[] = [
  /gh[opsur]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /ya29\.[A-Za-z0-9._-]{20,}/g, // Google access tokens
  /1\/\/[A-Za-z0-9._-]{20,}/g, // Google refresh tokens
  /Bearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];

/** Strips token-looking substrings from free text (error messages, provider responses). */
export function scrubSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), text);
}

/** Stable, order-independent JSON for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Audit-safe description of a tool input: field names and value sizes, never values. */
export function describeInputShape(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const shape: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') shape[key] = `string(${value.length})`;
    else if (Array.isArray(value)) shape[key] = `array(${value.length})`;
    else shape[key] = typeof value;
  }
  return shape;
}

/** Safe, user-facing provider error text: scrubbed and bounded. */
export function safeErrorMessage(error: unknown, fallback = 'The provider request failed.'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const cleaned = scrubSecrets(raw).trim();
  return cleaned ? cleaned.slice(0, 300) : fallback;
}
