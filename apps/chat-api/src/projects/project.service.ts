import { Project, ProjectFile } from '@chat-monorepo/shared';
import { query } from '../db/postgres';

const MAX_NAME_LENGTH = 120;
const MAX_INSTRUCTIONS_LENGTH = 8000;

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  instructions: string;
  created_at: number;
  updated_at: number;
  file_count: number;
}

interface ProjectFileRow {
  id: string;
  project_id: string;
  file_name: string;
  characters: number;
  uploaded_at: number;
  storage_url: string | null;
  text: string | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    instructions: row.instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileCount: row.file_count,
  };
}

function toProjectFile(row: ProjectFileRow): ProjectFile {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    characters: row.characters,
    uploadedAt: row.uploaded_at,
    storageUrl: row.storage_url,
  };
}

/**
 * Projects: a user-owned workspace carrying custom instructions plus its own
 * scoped set of ingested files.
 *
 * `project_files.text` holds the extracted document text alongside its
 * metadata - storing it here is what lets project knowledge survive a
 * restart: the vector store (rag/vector-db.ts) is rehydrated from it on
 * demand - see rag/retriever.ts `ensureProjectHydrated()`.
 */
export class ProjectService {
  static async createProject(ownerId: string, name: string, instructions = ''): Promise<Project> {
    const now = Date.now();
    const id = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const trimmedName = (name || 'Untitled project').trim().slice(0, MAX_NAME_LENGTH);
    const trimmedInstructions = (instructions || '').slice(0, MAX_INSTRUCTIONS_LENGTH);

    await query(
      `INSERT INTO projects (id, owner_id, name, instructions, created_at, updated_at, file_count)
       VALUES ($1, $2, $3, $4, $5, $5, 0)`,
      [id, ownerId, trimmedName, trimmedInstructions, now]
    );

    return { id, ownerId, name: trimmedName, instructions: trimmedInstructions, createdAt: now, updatedAt: now, fileCount: 0 };
  }

  static async listProjects(ownerId: string): Promise<Project[]> {
    const rows = await query<ProjectRow>('SELECT * FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
    return rows.map(toProject);
  }

  /** Returns null both for "not found" and "owned by someone else" — callers must not distinguish them. */
  static async getProject(ownerId: string, projectId: string): Promise<Project | null> {
    if (!projectId) return null;
    const rows = await query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId]);
    const project = rows[0];
    return project && project.owner_id === ownerId ? toProject(project) : null;
  }

  static async updateProject(
    ownerId: string,
    projectId: string,
    updates: { name?: string; instructions?: string }
  ): Promise<Project | null> {
    const existing = await this.getProject(ownerId, projectId);
    if (!existing) return null;

    const name = typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim().slice(0, MAX_NAME_LENGTH) : existing.name;
    const instructions =
      typeof updates.instructions === 'string' ? updates.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH) : existing.instructions;
    const updatedAt = Date.now();

    await query('UPDATE projects SET name = $2, instructions = $3, updated_at = $4 WHERE id = $1', [
      projectId,
      name,
      instructions,
      updatedAt,
    ]);

    return { ...existing, name, instructions, updatedAt };
  }

  static async deleteProject(ownerId: string, projectId: string): Promise<boolean> {
    const existing = await this.getProject(ownerId, projectId);
    if (!existing) return false;

    // project_files has ON DELETE CASCADE on project_id, so this one
    // statement removes the project's files with it - the Firestore
    // version needed an explicit batch delete of the files subcollection
    // first because Firestore never cascades a parent-doc delete.
    //
    // rag_documents has no FK here (personal, non-project documents don't
    // belong to any project_files row at all, so a FK couldn't require
    // project_id to always reference one) - deleted explicitly instead, so
    // a project's ingested vectors don't outlive the project that owned them.
    await query('DELETE FROM rag_documents WHERE project_id = $1', [projectId]);
    await query('DELETE FROM projects WHERE id = $1', [projectId]);
    return true;
  }

  static async addFile(
    projectId: string,
    file: { fileName: string; text: string; storageUrl?: string | null }
  ): Promise<ProjectFile> {
    const now = Date.now();
    const id = `pf-${now}-${Math.random().toString(36).slice(2, 8)}`;

    await query(
      `INSERT INTO project_files (id, project_id, file_name, characters, uploaded_at, storage_url, text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, projectId, file.fileName, file.text.length, now, file.storageUrl ?? null, file.text]
    );

    const countRows = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM project_files WHERE project_id = $1', [
      projectId,
    ]);
    await query('UPDATE projects SET file_count = $2, updated_at = $3 WHERE id = $1', [projectId, countRows[0]?.count ?? 0, now]);

    return { id, projectId, fileName: file.fileName, characters: file.text.length, uploadedAt: now, storageUrl: file.storageUrl ?? null };
  }

  static async listFiles(projectId: string): Promise<ProjectFile[]> {
    const rows = await query<ProjectFileRow>(
      'SELECT id, project_id, file_name, characters, uploaded_at, storage_url FROM project_files WHERE project_id = $1 ORDER BY uploaded_at DESC',
      [projectId]
    );
    return rows.map(toProjectFile);
  }

  /** Files WITH their extracted text — used to rehydrate the vector store. */
  static async listFileContents(projectId: string): Promise<Array<{ id: string; fileName: string; text: string }>> {
    const rows = await query<{ id: string; file_name: string; text: string | null }>(
      'SELECT id, file_name, text FROM project_files WHERE project_id = $1 AND text IS NOT NULL',
      [projectId]
    );
    return rows.map((r) => ({ id: r.id, fileName: r.file_name, text: r.text as string }));
  }
}
