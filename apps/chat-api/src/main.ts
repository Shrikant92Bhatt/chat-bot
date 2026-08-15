import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRoutes from './routes/chat.routes';

dotenv.config();

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
  console.log(`=================================================`);
});
