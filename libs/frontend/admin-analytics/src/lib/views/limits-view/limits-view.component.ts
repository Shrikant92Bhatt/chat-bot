import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../services/admin-api.service';
import { RateLimitUsageEntry, SystemLimitsDto } from '@chat-monorepo/shared';

/** Editable form state - bytes fields are edited in MB for a human-friendly
 *  UI, converted back to bytes only when saving. */
interface LimitsFormState {
  anonTrialMessageLimit: number;
  authDailyMessageLimit: number;
  rateLimitWindowHours: number;
  documentUploadMaxMb: number;
  attachmentMaxMb: number;
  attachmentMaxCount: number;
}

function toFormState(limits: SystemLimitsDto): LimitsFormState {
  return {
    anonTrialMessageLimit: limits.anonTrialMessageLimit,
    authDailyMessageLimit: limits.authDailyMessageLimit,
    rateLimitWindowHours: limits.rateLimitWindowHours,
    documentUploadMaxMb: Math.round(limits.documentUploadMaxBytes / (1024 * 1024)),
    attachmentMaxMb: Math.round(limits.attachmentMaxBytes / (1024 * 1024)),
    attachmentMaxCount: limits.attachmentMaxCount,
  };
}

/**
 * Admin-editable operational limits - the rate-limit and upload-size/count
 * constants that used to be hardcoded (or env-only) across anon-usage.service.ts
 * and chat.routes.ts. Same shape as ModelsViewComponent: load, edit locally
 * (isDirty gate), save on demand. authDailyMessageLimit is the hard
 * signed-in ceiling (429). Per-model dailyLimitPerUser on the Models tab
 * still falls back to a cheaper model instead of blocking.
 * The second half of this view is read-only: a live snapshot of how much
 * of today's quota every active IP/user-model pair has used, so an admin
 * can see whether a limit is actually biting before changing it.
 */
@Component({
  selector: 'lib-limits-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './limits-view.component.html',
})
export class LimitsViewComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  public readonly form = signal<LimitsFormState | null>(null);
  public readonly isLoading = signal(true);
  public readonly isSaving = signal(false);
  public readonly isDirty = signal(false);
  public readonly loadError = signal<string | null>(null);

  public readonly usageEntries = signal<RateLimitUsageEntry[]>([]);
  public readonly isLoadingUsage = signal(true);
  public readonly usageError = signal<string | null>(null);

  public readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  private toastTimer: any = null;

  public readonly atCapCount = computed(() => this.usageEntries().filter((e) => e.percent >= 1).length);
  public readonly nearCapCount = computed(
    () => this.usageEntries().filter((e) => e.percent >= 0.8 && e.percent < 1).length
  );

  ngOnInit(): void {
    void this.loadLimits();
    void this.loadUsage();
  }

  public async loadLimits(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(null);
    try {
      const limits = await this.api.getLimits();
      this.form.set(toFormState(limits));
      this.isDirty.set(false);
    } catch (e: any) {
      this.loadError.set(e.message || 'Failed to load limits.');
    } finally {
      this.isLoading.set(false);
    }
  }

  public async loadUsage(): Promise<void> {
    this.isLoadingUsage.set(true);
    this.usageError.set(null);
    try {
      const res = await this.api.getLimitsUsage();
      this.usageEntries.set(res.entries);
    } catch (e: any) {
      this.usageError.set(e.message || 'Failed to load usage.');
    } finally {
      this.isLoadingUsage.set(false);
    }
  }

  public updateField<K extends keyof LimitsFormState>(key: K, value: number): void {
    const current = this.form();
    if (!current) return;
    this.form.set({ ...current, [key]: value });
    this.isDirty.set(true);
  }

  public async saveChanges(): Promise<void> {
    const current = this.form();
    if (!current) return;

    this.isSaving.set(true);
    try {
      const res = await this.api.saveLimits({
        anonTrialMessageLimit: current.anonTrialMessageLimit,
        authDailyMessageLimit: current.authDailyMessageLimit,
        rateLimitWindowHours: current.rateLimitWindowHours,
        documentUploadMaxBytes: current.documentUploadMaxMb * 1024 * 1024,
        attachmentMaxBytes: current.attachmentMaxMb * 1024 * 1024,
        attachmentMaxCount: current.attachmentMaxCount,
      });
      this.form.set(toFormState(res.limits));
      this.isDirty.set(false);
      this.showToast('success', 'Limits saved. Takes effect within a minute (cache TTL) for requests already in flight.');
    } catch (e: any) {
      this.showToast('error', e.message || 'Failed to save limits.');
    } finally {
      this.isSaving.set(false);
    }
  }

  public formatKey(entry: RateLimitUsageEntry): string {
    // Backend already returns just the uid/ip (see anon-usage.service.ts
    // listUsageSnapshot) - append the model for 'auth' entries, since each
    // one is now a per-model count, not a single per-user total.
    if (entry.kind === 'auth' && entry.modelId === 'all-models') {
      return `${entry.key} · daily total`;
    }
    return entry.kind === 'auth' && entry.modelId ? `${entry.key} · ${entry.modelId}` : entry.key;
  }

  public formatResetAt(resetAt: number): string {
    const diffMs = resetAt - Date.now();
    if (diffMs <= 0) return 'resets now';
    const hours = Math.round(diffMs / (60 * 60 * 1000));
    if (hours < 1) return `resets in ${Math.max(1, Math.round(diffMs / 60000))}m`;
    return `resets in ${hours}h`;
  }

  public barWidthPercent(percent: number): number {
    return Math.min(100, Math.max(0, percent * 100));
  }

  public barColor(percent: number): string {
    if (percent >= 1) return 'bg-accentRose';
    if (percent >= 0.8) return 'bg-accentAmber';
    return 'bg-accentCyan';
  }

  private showToast(type: 'success' | 'error', message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set({ type, message });
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }
}
