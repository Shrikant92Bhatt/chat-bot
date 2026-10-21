import express from 'express';
import { executeSandboxedCode, SandboxLanguage } from './sandbox';

const app = express();
app.use(express.json({ limit: '1mb' }));

// The sandbox is routed internally through a Vercel service binding. It has no
// public rewrite; this secret is defense in depth, not the routing mechanism.
const SHARED_SECRET = process.env.CODE_SANDBOX_SERVICE_SECRET;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sandbox-service' });
});

app.post('/execute', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !SHARED_SECRET) {
    res.status(503).json({ error: 'Sandbox service is missing CODE_SANDBOX_SERVICE_SECRET.' });
    return;
  }

  if (SHARED_SECRET) {
    const provided = req.header('x-sandbox-secret');
    if (provided !== SHARED_SECRET) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const { code, language } = req.body ?? {};
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'Request body must include a "code" string.' });
    return;
  }

  try {
    const result = await executeSandboxedCode(code, {
      language: language as SandboxLanguage | undefined,
    });
    res.json(result);
  } catch (error) {
    // Keep unexpected backend errors from crashing the request handler.
    console.error('Sandbox execution failed:', error);
    res.status(500).json({ error: 'Sandbox execution failed.' });
  }
});

export default app;
