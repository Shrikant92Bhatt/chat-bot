import { Injectable, inject, signal } from '@angular/core';
import { getApiBaseUrl } from '../core/runtime-config';
import { AdminAuthService } from './admin-auth.service';

// ── Response shapes, mirroring apps/chat-api/src/routes/admin.routes.ts ──
// Not imported from libs/shared on purpose: these are admin-console-only
// view models, and adding them to the shared lib would put them in
// chat-client's build surface for no reason.

export interface AdminUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: 'user' | 'admin';
  lastLogin: number | null;
}

export interface UsageSummary {
  windowDays: number;
  since: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  activeUsers: number;
  truncated: boolean;
}

export interface DailyUsagePoint {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UserUsageAggregate {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  lastActivity: number | null;
}

export interface ModelUsageAggregate {
  model: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
}

export interface UsageRecord {
  requestId: string;
  userId: string | null;
  conversationId: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  estimatedCostUsd: number | null;
  timestamp: number;
}

export interface StorageMetrics {
  bucketName: string;
  totalSizeBytes: number;
  totalSizeMB: string;
  totalSizeGB: string;
  objectCount: number;
  estimatedMonthlyCostUSD: string;
  lastUpdated: string;
  configured: boolean;
}

/** Thrown for a non-2xx admin response, carrying the backend's own message
 *  so the UI can surface e.g. the last-admin guard verbatim. */
export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly auth = inject(AdminAuthService);

  /** True while at least one dashboard request is in flight. */
  public readonly isLoading = signal(false);

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.auth.getSessionToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${getApiBaseUrl()}/api/v1/admin${path}`, { ...init, headers });

    if (res.status === 401) {
      // Session gone/expired - back to the login screen.
      this.auth.handleUnauthorized();
      throw new AdminApiError(401, 'Unauthorized', 'Your session has expired. Please sign in again.');
    }

    if (res.status === 403) {
      // Authenticated but not an admin. Flip the app into the access-denied
      // state rather than redirecting, so the user sees WHICH account was
      // rejected instead of bouncing around a login loop.
      this.auth.markAccessDenied();
      throw new AdminApiError(403, 'Forbidden', 'Admin access required.');
    }

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body - fall through to the generic message below */
    }

    if (!res.ok) {
      throw new AdminApiError(
        res.status,
        body?.error || 'RequestFailed',
        body?.message || body?.error || `Request failed with status ${res.status}.`
      );
    }

    return body as T;
  }

  public getUsers(): Promise<{ users: AdminUser[]; count: number }> {
    return this.request('/users');
  }

  public setUserRole(uid: string, role: 'user' | 'admin'): Promise<{ success: boolean; user: AdminUser }> {
    return this.request(`/users/${encodeURIComponent(uid)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  public getUsageSummary(
    days: number
  ): Promise<{ summary: UsageSummary; daily: DailyUsagePoint[]; totalUsers: number }> {
    return this.request(`/usage/summary?days=${days}`);
  }

  public getUsageByUser(
    days: number
  ): Promise<{ windowDays: number; truncated: boolean; users: UserUsageAggregate[]; count: number }> {
    return this.request(`/usage/by-user?days=${days}`);
  }

  public getUsageByModel(
    days: number
  ): Promise<{ windowDays: number; truncated: boolean; models: ModelUsageAggregate[]; count: number }> {
    return this.request(`/usage/by-model?days=${days}`);
  }

  public getUsageRecords(
    days: number,
    userId?: string | null,
    limit = 25
  ): Promise<{ records: UsageRecord[]; count: number; totalMatching: number }> {
    const params = new URLSearchParams({ days: String(days), limit: String(limit) });
    if (userId) params.set('userId', userId);
    return this.request(`/usage/records?${params.toString()}`);
  }

  public getStorageMetrics(): Promise<StorageMetrics> {
    return this.request('/storage');
  }
}
