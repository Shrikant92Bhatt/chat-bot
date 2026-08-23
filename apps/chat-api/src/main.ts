import './env'; // must be first: loads .env before any other module reads process.env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import chatRoutes from './routes/chat.routes';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import adminRoutes from './routes/admin.routes';

const app = express();
const PORT = process.env.PORT || 3000;

// Security hardening via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false, // Let SPA handle CSP or configure per frontend requirements
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Trust the X-Forwarded-For header set by Cloud Run / the load balancer so
// req.ip reflects the real client IP (used for the anonymous free-trial limit).
app.set('trust proxy', true);

// Enable CORS for frontend application.
// ALLOWED_ORIGIN should be set to the chat-client's deployed URL in production
// (comma-separated list supported); falls back to '*' for local development.
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
app.use('/api/v1/projects', projectRoutes);
// Admin analytics API. Every route inside is behind authenticateToken +
// requireAdmin (router-level, see routes/admin.routes.ts).
app.use('/api/v1/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Chat API Express Server running on port ${PORT}`);
  console.log(`📡 Healthcheck: http://localhost:${PORT}/health`);
  console.log(`🔑 GOOGLE_CLIENT_ID Loaded: ${process.env.GOOGLE_CLIENT_ID ? 'YES (' + process.env.GOOGLE_CLIENT_ID.slice(0, 12) + '...)' : 'NO (Check .env file)'}`);
  console.log(`=================================================`);
});
