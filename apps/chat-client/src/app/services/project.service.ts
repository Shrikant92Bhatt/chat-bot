import { Injectable, computed, effect, signal } from '@angular/core';
import { Project, ProjectFile } from '@chat-monorepo/shared';
import { AuthService } from './auth.service';
import { getApiBaseUrl } from '../core/runtime-config';

/**
 * Client for the /api/v1/projects API.
 *
 * A project bundles custom instructions plus its own uploaded files; a
 * conversation scoped to a project gets both injected into the model's
 * context server-side (see chat-api context/context-builder.ts). This
 * service owns only project state — the "which project is this thread in"
 * link lives on ChatThread.projectId, owned by ChatService.
 */
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private get apiUrl() {
    return `${getApiBaseUrl()}/api/v1/projects`;
  }

  public projects = signal<Project[]>([]);
  public isLoading = signal<boolean>(false);
  public error = signal<string | null>(null);

  /** Files of the project currently open in the Projects modal. */
  public selectedProjectId = signal<string | null>(null);
  public selectedProjectFiles = signal<ProjectFile[]>([]);
  public isUploadingFile = signal<boolean>(false);

  public selectedProject = computed(() => {
    const id = this.selectedProjectId();
    return this.projects().find((p) => p.id === id) ?? null;
  });

  constructor(private authService: AuthService) {
    effect(
      () => {
        const user = this.authService.userSignal();
        if (user?.uid) {
          this.loadProjects();
        } else {
          this.projects.set([]);
          this.selectedProjectId.set(null);
          this.selectedProjectFiles.set([]);
        }
      },
      { allowSignalWrites: true }
    );
  }

  public getProjectName(projectId: string | null | undefined): string | null {
    if (!projectId) return null;
    return this.projects().find((p) => p.id === projectId)?.name ?? null;
  }

  private authHeaders(json = true): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.authService.getIdToken()}` };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  /** Returns parsed JSON, or throws with the API's error message. 401 raises the session-expired modal. */
  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);

    if (response.status === 401) {
      this.authService.notifySessionExpired();
      throw new Error('Your session has expired. Please sign in again.');
    }

    const data = response.status === 204 ? ({} as T) : await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || `Request failed (${response.status}).`);
    }
    return data as T;
  }

  public async loadProjects(): Promise<void> {
    if (!this.authService.userSignal()) return;
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const data = await this.request<{ projects: Project[] }>(this.apiUrl, { headers: this.authHeaders(false) });
      this.projects.set(data.projects ?? []);
    } catch (e: any) {
      console.error('[ProjectService] Failed to load projects:', e);
      this.error.set(e.message || 'Failed to load projects.');
    } finally {
      this.isLoading.set(false);
    }
  }

  public async createProject(name: string, instructions = ''): Promise<Project | null> {
    this.error.set(null);
    try {
      const data = await this.request<{ project: Project }>(this.apiUrl, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ name, instructions }),
      });
      this.projects.update((list) => [data.project, ...list]);
      this.selectProject(data.project.id);
      return data.project;
    } catch (e: any) {
      this.error.set(e.message || 'Failed to create project.');
      return null;
    }
  }

  public async updateProject(id: string, updates: { name?: string; instructions?: string }): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.request<{ project: Project }>(`${this.apiUrl}/${id}`, {
        method: 'PATCH',
        headers: this.authHeaders(),
        body: JSON.stringify(updates),
      });
      this.projects.update((list) => list.map((p) => (p.id === id ? data.project : p)));
    } catch (e: any) {
      this.error.set(e.message || 'Failed to save project.');
    }
  }

  public async deleteProject(id: string): Promise<void> {
    this.error.set(null);
    try {
      await this.request(`${this.apiUrl}/${id}`, { method: 'DELETE', headers: this.authHeaders(false) });
      this.projects.update((list) => list.filter((p) => p.id !== id));
      if (this.selectedProjectId() === id) {
        this.selectedProjectId.set(null);
        this.selectedProjectFiles.set([]);
      }
    } catch (e: any) {
      this.error.set(e.message || 'Failed to delete project.');
    }
  }

  public selectProject(id: string | null): void {
    this.selectedProjectId.set(id);
    this.selectedProjectFiles.set([]);
    if (id) this.loadProjectFiles(id);
  }

  public async loadProjectFiles(id: string): Promise<void> {
    try {
      const data = await this.request<{ files: ProjectFile[] }>(`${this.apiUrl}/${id}/files`, {
        headers: this.authHeaders(false),
      });
      this.selectedProjectFiles.set(data.files ?? []);
    } catch (e: any) {
      console.error('[ProjectService] Failed to load project files:', e);
      this.error.set(e.message || 'Failed to load project files.');
    }
  }

  public async uploadFile(projectId: string, file: File): Promise<void> {
    this.isUploadingFile.set(true);
    this.error.set(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const data = await this.request<{ file: ProjectFile }>(`${this.apiUrl}/${projectId}/files`, {
        method: 'POST',
        headers: this.authHeaders(false),
        body: formData,
      });

      this.selectedProjectFiles.update((files) => [data.file, ...files]);
      this.projects.update((list) =>
        list.map((p) => (p.id === projectId ? { ...p, fileCount: (p.fileCount ?? 0) + 1 } : p))
      );
    } catch (e: any) {
      this.error.set(e.message || 'Failed to upload file.');
    } finally {
      this.isUploadingFile.set(false);
    }
  }
}
