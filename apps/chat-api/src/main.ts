import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import chatRoutes from './routes/chat.routes';

// Load .env from root workspace directory and current process CWD.
// .env.local is gitignored and holds real local secrets (e.g. GOOGLE_CLIENT_ID),
// so it's loaded last with override so it wins over any committed .env defaults.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend application
app.use(
  cors({
    origin: '*', // Adjust for production environments
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// Healthcheck Endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'chat-api' });
});

// Register Chat Routes
app.use('/api/chat', chatRoutes);

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Chat API Express Server running on port ${PORT}`);
  console.log(`📡 Healthcheck: http://localhost:${PORT}/health`);
  console.log(`🔑 GOOGLE_CLIENT_ID Loaded: ${process.env.GOOGLE_CLIENT_ID ? 'YES (' + process.env.GOOGLE_CLIENT_ID.slice(0, 12) + '...)' : 'NO (Check .env file)'}`);
  console.log(`=================================================`);
});
