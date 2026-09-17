import express from 'express';
import { executeSandboxedCode, SandboxLanguage } from './sandbox';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8080;
// Shared secret between chat-api and this service - required in production
// so this endpoint can't be used as an open code-execution-as-a-service by
// anyone who finds the URL. Generate with `openssl rand -hex 32` and set the
// same value as CODE_SANDBOX_SERVICE_SECRET on both services.
const SHARED_SECRET = process.env.CODE_SANDBOX_SERVICE_SECRET;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sandbox-service' });
});

app.post('/execute', async (req, res) => {
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

  const result = await executeSandboxedCode(code, {
    language: language as SandboxLanguage | undefined,
  });
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`sandbox-service listening on port ${PORT}`);
});
