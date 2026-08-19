import { Project, ProjectFile } from '@chat-monorepo/shared';
import { firestore } from '../db/firestore';

const PROJECTS_COLLECTION = 'projects';
const FILES_SUBCOLLECTION = 'files';

const MAX_NAME_LENGTH = 120;
const MAX_INSTRUCTIONS_LENGTH = 8000;

/**
 * Projects: a user-owned workspace carrying custom instructions plus its own
 * scoped set of ingested files.
 *
 * Firestore layout — a top-level `projects` collection (queried by an
 * `ownerId` field, a single-field filter that needs no composite index),
 * with a `files` subcollection per project holding both the file metadata
 * AND the extracted text. Storing the text here is what lets project
 * knowledge survive a restart: the in-process vector store
 * (rag/vector-db.ts) is rehydrated from it on demand — see
 * rag/retriever.ts `ensureProjectHydrated()`.
 */
export class ProjectService {
  private static collection() {
    return firestore.collection(PROJECTS_COLLECTION);
  }

  private static filesCollection(projectId: string) {
    return this.collection().doc(projectId).collection(FILES_SUBCOLLECTION);
  }

  static async createProject(ownerId: string, name: string, instructions = ''): Promise<Project> {
    const now = Date.now();
    const id = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const project: Project = {
      id,
      ownerId,
      name: (name || 'Untitled project').trim().slice(0, MAX_NAME_LENGTH),
      instructions: (instructions || '').slice(0, MAX_INSTRUCTIONS_LENGTH),
      createdAt: now,
      updatedAt: now,
      fileCount: 0,
    };
    await this.collection().doc(id).set(project);
    return project;
  }

  static async listProjects(ownerId: string): Promise<Project[]> {
    const snapshot = await this.collection().where('ownerId', '==', ownerId).get();
    return snapshot.docs
      .map((doc) => doc.data() as Project)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  /** Returns null both for "not found" and "owned by someone else" — callers must not distinguish them. */
  static async getProject(ownerId: string, projectId: string): Promise<Project | null> {
    if (!projectId) return null;
    const snapshot = await this.collection().doc(projectId).get();
    if (!snapshot.exists) return null;
    const project = snapshot.data() as Project;
    return project.ownerId === ownerId ? project : null;
  }

  static async updateProject(
    ownerId: string,
    projectId: string,
    updates: { name?: string; instructions?: string }
  ): Promise<Project | null> {
    const existing = await this.getProject(ownerId, projectId);
    if (!existing) return null;

    const patch: Partial<Project> = { updatedAt: Date.now() };
    if (typeof updates.name === 'string' && updates.name.trim()) {
      patch.name = updates.name.trim().slice(0, MAX_NAME_LENGTH);
    }
    if (typeof updates.instructions === 'string') {
      patch.instructions = updates.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH);
    }

    await this.collection().doc(projectId).set(patch, { merge: true });
    return { ...existing, ...patch } as Project;
  }

  static async deleteProject(ownerId: string, projectId: string): Promise<boolean> {
    const existing = await this.getProject(ownerId, projectId);
    if (!existing) return false;

    // Subcollections are not deleted with their parent in Firestore.
    const files = await this.filesCollection(projectId).get();
    const batch = firestore.batch();
    files.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(this.collection().doc(projectId));
    await batch.commit();
    return true;
  }

  static async addFile(
    projectId: string,
    file: { fileName: string; text: string; storageUrl?: string | null }
  ): Promise<ProjectFile> {
    const now = Date.now();
    const id = `pf-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const metadata: ProjectFile = {
      id,
      projectId,
      fileName: file.fileName,
      characters: file.text.length,
      uploadedAt: now,
      storageUrl: file.storageUrl ?? null,
    };

    // `text` lives on the doc but is intentionally NOT part of the
    // ProjectFile DTO — it is server-side only (rehydration source) and
    // would otherwise be shipped to the client on every list call.
    await this.filesCollection(projectId).doc(id).set({ ...metadata, text: file.text });

    const files = await this.filesCollection(projectId).get();
    await this.collection().doc(projectId).set({ fileCount: files.size, updatedAt: now }, { merge: true });

    return metadata;
  }

  static async listFiles(projectId: string): Promise<ProjectFile[]> {
    const snapshot = await this.filesCollection(projectId).get();
    return snapshot.docs
      .map((doc) => {
        const { text, ...metadata } = doc.data() as ProjectFile & { text?: string };
        return metadata as ProjectFile;
      })
      .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  }

  /** Files WITH their extracted text — used to rehydrate the vector store. */
  static async listFileContents(projectId: string): Promise<Array<{ id: string; fileName: string; text: string }>> {
    const snapshot = await this.filesCollection(projectId).get();
    return snapshot.docs
      .map((doc) => doc.data() as ProjectFile & { text?: string })
      .filter((d) => !!d.text)
      .map((d) => ({ id: d.id, fileName: d.fileName, text: d.text as string }));
  }
}
