import { Router, Response } from 'express';
import multer from 'multer';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { ProjectService } from '../projects/project.service';
import { extractDocumentText } from '../rag/document-extractor';
import { RagRetriever } from '../rag/retriever';
import { GcsUploader } from '../storage/uploader';
import { SystemLimitsService } from '../services/system-limits.service';

const router = Router();
// 50MB is a fixed safety ceiling only - the admin-editable
// documentUploadMaxBytes (see system-limits.service.ts, same value used by
// POST /api/chat/documents) is what's actually enforced, in-handler below.
const HARD_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_MAX_DOCUMENT_BYTES } });

/**
 * Project CRUD + project-scoped file ingestion.
 *
 * Mounted at /api/v1/projects (see main.ts). Every route is behind
 * authenticateToken and every read/write goes through ProjectService, which
 * checks ownerId — a project id belonging to another user is indistinguishable
 * from a nonexistent one (404), so ids can't be probed.
 */

/** POST /api/v1/projects — create a project. */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { name, instructions } = req.body ?? {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Invalid request: "name" is required.' });
    return;
  }

  try {
    const project = await ProjectService.createProject(req.user!.uid, name, instructions ?? '');
    res.status(201).json({ project });
  } catch (error) {
    console.error('[Project Route] Failed to create project:', error);
    res.status(500).json({ error: 'Failed to create project.' });
  }
});

/** GET /api/v1/projects — list the caller's projects. */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projects = await ProjectService.listProjects(req.user!.uid);
    res.json({ projects });
  } catch (error) {
    console.error('[Project Route] Failed to list projects:', error);
    res.status(500).json({ error: 'Failed to load projects.' });
  }
});

/** GET /api/v1/projects/:id — one project plus its file metadata. */
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await ProjectService.getProject(req.user!.uid, req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const files = await ProjectService.listFiles(project.id);
    res.json({ project, files });
  } catch (error) {
    console.error('[Project Route] Failed to load project:', error);
    res.status(500).json({ error: 'Failed to load project.' });
  }
});

/** PATCH /api/v1/projects/:id — rename / edit instructions. */
router.patch('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { name, instructions } = req.body ?? {};

  if (name === undefined && instructions === undefined) {
    res.status(400).json({ error: 'Invalid request: provide "name" and/or "instructions".' });
    return;
  }

  try {
    const project = await ProjectService.updateProject(req.user!.uid, req.params.id, { name, instructions });
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project });
  } catch (error) {
    console.error('[Project Route] Failed to update project:', error);
    res.status(500).json({ error: 'Failed to update project.' });
  }
});

/** DELETE /api/v1/projects/:id — deletes the project and its file subcollection. */
router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deleted = await ProjectService.deleteProject(req.user!.uid, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Project Route] Failed to delete project:', error);
    res.status(500).json({ error: 'Failed to delete project.' });
  }
});

/** GET /api/v1/projects/:id/files */
router.get('/:id/files', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await ProjectService.getProject(req.user!.uid, req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ files: await ProjectService.listFiles(project.id) });
  } catch (error) {
    console.error('[Project Route] Failed to list project files:', error);
    res.status(500).json({ error: 'Failed to load project files.' });
  }
});

/**
 * POST /api/v1/projects/:id/files
 *
 * Same pipeline as POST /api/chat/documents (extract text -> RAG ingest),
 * but the document is ingested with this project's id, so it is only ever
 * retrievable from conversations scoped to the project. The raw file is
 * also archived to GCS when configured, and its extracted text is stored on
 * the file document so the in-process vector store can be rehydrated after
 * a restart.
 */
router.post('/:id/files', authenticateToken, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await ProjectService.getProject(req.user!.uid, req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file was uploaded (expected multipart field "file").' });
      return;
    }

    const limits = await SystemLimitsService.getLimits();
    if (file.size > limits.documentUploadMaxBytes) {
      res.status(400).json({
        error: `File is too large - documents must be ${Math.round(limits.documentUploadMaxBytes / (1024 * 1024))}MB or smaller.`,
      });
      return;
    }

    const text = await extractDocumentText(file.buffer, file.originalname, file.mimetype);

    let storageUrl: string | null = null;
    const uploader = new GcsUploader();
    if (uploader.isReady()) {
      try {
        storageUrl = await uploader.uploadFile(
          file.buffer,
          `projects/${project.id}/${Date.now()}-${file.originalname}`,
          file.mimetype
        );
      } catch (error) {
        // Archiving is a nice-to-have; the ingested text is what powers RAG.
        console.error('[Project Route] GCS archive failed (continuing):', error);
      }
    }

    const metadata = await ProjectService.addFile(project.id, { fileName: file.originalname, text, storageUrl });

    const ragRetriever = new RagRetriever();
    await ragRetriever.ingest(
      metadata.id,
      req.user!.uid,
      text,
      { fileName: file.originalname, projectId: project.id },
      project.id
    );

    res.status(201).json({ success: true, file: metadata });
  } catch (error) {
    console.error('[Project Route] Project file upload error:', error);
    res.status(400).json({ error: (error as Error).message || 'Failed to process file.' });
  }
});

export default router;
