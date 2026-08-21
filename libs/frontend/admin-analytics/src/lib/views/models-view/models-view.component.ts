import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../services/admin-api.service';
import { ModelConfigDto, OpenRouterModelCatalogItem, SelectableModel } from '@chat-monorepo/shared';

@Component({
  selector: 'lib-models-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './models-view.component.html',
})
export class ModelsViewComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  public readonly configuredModels = signal<SelectableModel[]>([]);
  public readonly defaultModel = signal<string>('');
  public readonly catalog = signal<OpenRouterModelCatalogItem[]>([]);

  public readonly isLoadingConfig = signal(true);
  public readonly isLoadingCatalog = signal(false);
  public readonly isSaving = signal(false);
  public readonly isRefreshingCatalog = signal(false);

  public readonly searchQuery = signal('');
  public readonly selectedProviderFilter = signal<string>('all');
  public readonly selectedStatusFilter = signal<'all' | 'enabled' | 'disabled'>('all');

  public readonly isDirty = signal(false);
  public readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  private toastTimer: any = null;

  // Add custom model modal state
  public readonly showAddModal = signal(false);
  public readonly customId = signal('');
  public readonly customName = signal('');
  public readonly customProvider = signal('Custom');
  public readonly customDescription = signal('');
  public readonly customPromptCost = signal('0.001');
  public readonly customCompletionCost = signal('0.003');

  // Computed properties
  public readonly enabledCount = computed(() => this.configuredModels().filter((m) => m.enabled !== false).length);

  public readonly providersList = computed(() => {
    const set = new Set<string>();
    this.configuredModels().forEach((m) => {
      if (m.provider) set.add(m.provider);
    });
    return ['all', ...Array.from(set).sort()];
  });

  public readonly filteredModels = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const provider = this.selectedProviderFilter();
    const status = this.selectedStatusFilter();

    return this.configuredModels().filter((m) => {
      // Search match
      const matchesSearch =
        !q ||
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.provider && m.provider.toLowerCase().includes(q)) ||
        (m.description && m.description.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      // Provider match
      if (provider !== 'all' && m.provider !== provider) {
        return false;
      }

      // Status match
      const isEnabled = m.enabled !== false;
      if (status === 'enabled' && !isEnabled) return false;
      if (status === 'disabled' && isEnabled) return false;

      return true;
    });
  });

  // Catalog items not yet added to configured models
  public readonly availableFromCatalog = computed(() => {
    const existingIds = new Set(this.configuredModels().map((m) => m.id));
    const q = this.searchQuery().toLowerCase().trim();

    return this.catalog()
      .filter((c) => !existingIds.has(c.id))
      .filter((c) => {
        if (!q) return true;
        return c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q));
      })
      .slice(0, 30); // show top 30 matches
  });

  ngOnInit(): void {
    void this.loadConfig();
    void this.loadCatalog();
  }

  public async loadConfig(): Promise<void> {
    this.isLoadingConfig.set(true);
    try {
      const config = await this.api.getModelConfig();
      this.configuredModels.set(config.models);
      this.defaultModel.set(config.defaultModel);
      this.isDirty.set(false);
    } catch (e: any) {
      this.showToast('error', e.message || 'Failed to load model config.');
    } finally {
      this.isLoadingConfig.set(false);
    }
  }

  public async loadCatalog(forceRefresh = false): Promise<void> {
    if (forceRefresh) {
      this.isRefreshingCatalog.set(true);
    } else {
      this.isLoadingCatalog.set(true);
    }

    try {
      const res = await this.api.getModelCatalog(forceRefresh);
      this.catalog.set(res.models || []);
      if (forceRefresh) {
        this.showToast('success', `Fetched ${res.models?.length || 0} models from OpenRouter.`);
      }
    } catch (e: any) {
      if (forceRefresh) {
        this.showToast('error', 'Failed to refresh catalog from OpenRouter.');
      }
    } finally {
      this.isLoadingCatalog.set(false);
      this.isRefreshingCatalog.set(false);
    }
  }

  public toggleModel(modelId: string): void {
    this.configuredModels.update((models) =>
      models.map((m) => {
        if (m.id !== modelId) return m;
        const newEnabled = m.enabled === false;
        // If disabling the default model, pick another enabled model as default
        if (!newEnabled && this.defaultModel() === modelId) {
          const nextDefault = models.find((other) => other.id !== modelId && other.enabled !== false);
          if (nextDefault) {
            this.defaultModel.set(nextDefault.id);
          }
        }
        return { ...m, enabled: newEnabled };
      })
    );
    this.isDirty.set(true);
  }

  /** Daily reply cap per signed-in user for one model - blank/0 means
   *  unlimited. Never blocks a reply on its own when hit; graph.ts falls
   *  back to a cheaper model instead (see orchestration/graph.ts
   *  checkModelQuota). */
  public updateDailyLimit(modelId: string, value: number | null): void {
    this.configuredModels.update((models) =>
      models.map((m) => (m.id === modelId ? { ...m, dailyLimitPerUser: value && value > 0 ? value : null } : m))
    );
    this.isDirty.set(true);
  }

  public setDefaultModel(modelId: string): void {
    this.defaultModel.set(modelId);
    // Ensure the default model is enabled
    this.configuredModels.update((models) =>
      models.map((m) => (m.id === modelId ? { ...m, enabled: true } : m))
    );
    this.isDirty.set(true);
  }

  public removeModel(modelId: string): void {
    if (this.defaultModel() === modelId) {
      this.showToast('error', 'Cannot remove the default model. Set another model as default first.');
      return;
    }
    this.configuredModels.update((models) => models.filter((m) => m.id !== modelId));
    this.isDirty.set(true);
    this.showToast('success', `Removed model ${modelId}. Click "Save Changes" to apply.`);
  }

  public addFromCatalogItem(item: OpenRouterModelCatalogItem): void {
    const promptPrice = item.pricing?.prompt ? parseFloat(item.pricing.prompt) * 1000 : 0.001;
    const completionPrice = item.pricing?.completion ? parseFloat(item.pricing.completion) * 1000 : 0.003;

    const newModel: SelectableModel = {
      id: item.id,
      name: item.name || item.id,
      provider: this.extractProvider(item.id),
      description: item.description,
      contextLength: item.context_length,
      pricing: {
        prompt: promptPrice,
        completion: completionPrice,
      },
      enabled: true,
    };

    this.configuredModels.update((list) => [newModel, ...list]);
    this.isDirty.set(true);
    this.showToast('success', `Added ${item.name || item.id} to your models.`);
  }

  public openAddModal(): void {
    this.customId.set('');
    this.customName.set('');
    this.customProvider.set('Custom');
    this.customDescription.set('');
    this.customPromptCost.set('0.001');
    this.customCompletionCost.set('0.003');
    this.showAddModal.set(true);
  }

  public closeAddModal(): void {
    this.showAddModal.set(false);
  }

  public submitCustomModel(): void {
    const id = this.customId().trim();
    const name = this.customName().trim() || id;
    if (!id) {
      this.showToast('error', 'Model ID is required.');
      return;
    }

    if (this.configuredModels().some((m) => m.id === id)) {
      this.showToast('error', `Model ID "${id}" is already configured.`);
      return;
    }

    const newModel: SelectableModel = {
      id,
      name,
      provider: this.customProvider().trim() || 'Custom',
      description: this.customDescription().trim() || undefined,
      pricing: {
        prompt: parseFloat(this.customPromptCost()) || 0.001,
        completion: parseFloat(this.customCompletionCost()) || 0.003,
      },
      enabled: true,
    };

    this.configuredModels.update((list) => [newModel, ...list]);
    this.isDirty.set(true);
    this.showAddModal.set(false);
    this.showToast('success', `Added custom model ${name}. Click "Save Changes" to apply.`);
  }

  public async saveChanges(): Promise<void> {
    this.isSaving.set(true);
    try {
      const configDto: ModelConfigDto = {
        defaultModel: this.defaultModel(),
        models: this.configuredModels(),
        updatedAt: Date.now(),
      };

      const res = await this.api.saveModelConfig(configDto);
      this.configuredModels.set(res.config.models);
      this.defaultModel.set(res.config.defaultModel);
      this.isDirty.set(false);
      this.showToast('success', 'Model configuration saved successfully!');
    } catch (e: any) {
      this.showToast('error', e.message || 'Failed to save model configuration.');
    } finally {
      this.isSaving.set(false);
    }
  }

  public formatTokens(tokens?: number): string {
    if (!tokens) return '—';
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return String(tokens);
  }

  public formatCost(val?: number): string {
    if (val === undefined || val === null) return '—';
    if (val === 0) return 'Free';
    return `$${val.toFixed(val < 0.001 ? 5 : 4)}`;
  }

  private extractProvider(id: string): string {
    if (id.startsWith('google/')) return 'Google';
    if (id.startsWith('openai/')) return 'OpenAI';
    if (id.startsWith('anthropic/')) return 'Anthropic';
    if (id.startsWith('meta-llama/')) return 'Meta';
    if (id.startsWith('mistralai/')) return 'Mistral';
    if (id.startsWith('x-ai/')) return 'xAI';
    if (id.startsWith('deepseek/')) return 'DeepSeek';
    if (id.startsWith('qwen/')) return 'Qwen';
    if (id.startsWith('cohere/')) return 'Cohere';
    return 'Custom';
  }

  private showToast(type: 'success' | 'error', message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set({ type, message });
    this.toastTimer = setTimeout(() => {
      this.toast.set(null);
    }, 4000);
  }
}
