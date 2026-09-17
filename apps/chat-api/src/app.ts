import './env'; // must be first: loads .env before any other module reads process.env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import chatRoutes from './routes/chat.routes';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import adminRoutes from './routes/admin.routes';

const app = express();

// Security hardening via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false, // Let SPA handle CSP or configure per frontend requirements
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Trust the X-Forwarded-For header set by Cloud Run / Vercel / the load
// balancer so req.ip reflects the real client IP (used for the anonymous
// free-trial limit).
app.set('trust proxy', true);

// Enable CORS for frontend application.
// Only needed when chat-client is served from a different origin than
// chat-api (e.g. the old two-Cloud-Run-service setup). When both are
// deployed together behind one Vercel project, requests are same-origin
// and this is effectively a no-op. ALLOWED_ORIGIN should be set to the
// deployed chat-client URL(s) in that split-origin case (comma-separated
// list supported); falls back to '*' for local development.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    // PUT/PATCH/DELETE are used by the thread-save and project CRUD routes;
    // without them listed here the browser's preflight rejects those calls
    // whenever ALLOWED_ORIGIN is set to a real origin (i.e. in production).
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// Healthcheck Endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'chat-api' });
});

// Register Routes
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', projectRoutes);
// Admin analytics API. Every route inside is behind authenticateToken +
// requireAdmin (router-level, see routes/admin.routes.ts).
app.use('/api/v1/admin', adminRoutes);

export default app;
